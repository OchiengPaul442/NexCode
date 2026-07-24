/**
 * Orchestrator Intent Parser
 *
 * Extracted from orchestrator.ts to reduce module size.
 * Contains pure parsing/inference functions that convert natural language
 * prompts into structured intents (tool commands, edit requests, stat requests).
 */

import path from "path";
import {
  extractLikelyFileReferences,
  normalizeActivityPath,
} from "./contextBuilder";

export interface InferredEditRequest {
  filePath: string;
  instruction: string;
}

/**
 * Infer an edit request from natural-language prose.
 * Returns null when the prompt is clearly not an edit request.
 */
export function inferNaturalLanguageEditRequest(
  prompt: string,
  workspaceRoot: string,
  activeFilePath?: string,
): InferredEditRequest | null {
  const normalized = prompt.trim();
  if (!normalized || normalized.startsWith("/")) {
    return null;
  }

  if (
    /\b(explain|describe|summari[sz]e|review|analy[sz]e|read|open|show|search|find|run|execute|test)\b/i.test(
      normalized,
    ) &&
    !/\b(refactor|rewrite|modify|change|update|fix|rename|remove|delete|add|implement|improve|clean up)\b/i.test(
      normalized,
    )
  ) {
    return null;
  }

  const hasEditVerb =
    /\b(refactor|rewrite|modify|change|update|fix|rename|remove|delete|add|implement|improve|clean up)\b/i.test(
      normalized,
    );
  if (!hasEditVerb) {
    return null;
  }

  const referencedFiles = extractLikelyFileReferences(normalized)
    .map((candidate) => normalizeActivityPath(candidate, workspaceRoot))
    .filter((candidate): candidate is string => Boolean(candidate));
  const mentionsFileContext =
    referencedFiles.length > 0 ||
    /\b(file|component|module|function|class|screen|service)\b/i.test(
      normalized,
    ) ||
    /\b(this|current|active|selected|attached)\s+file\b/i.test(normalized);

  if (!mentionsFileContext) {
    return null;
  }

  const filePath = resolvePromptTargetPath(
    normalized,
    workspaceRoot,
    activeFilePath,
  );
  if (!filePath) {
    return null;
  }

  return {
    filePath,
    instruction: normalized,
  };
}

/**
 * Resolve a file path from a prompt string.
 */
export function resolvePromptTargetPath(
  prompt: string,
  workspaceRoot: string,
  activeFilePath?: string,
): string | null {
  const referencedFiles = extractLikelyFileReferences(prompt)
    .map((candidate) => normalizeActivityPath(candidate, workspaceRoot))
    .filter((candidate): candidate is string => Boolean(candidate));

  if (referencedFiles.length > 0) {
    return referencedFiles[0];
  }

  const normalizedActivePath = normalizeActivityPath(
    activeFilePath,
    workspaceRoot,
  );
  if (!normalizedActivePath) {
    return null;
  }

  if (
    /\b(this|current|active|selected|attached)\s+file\b/i.test(prompt) ||
    /\b(refactor|rewrite|modify|change|update|fix|rename|remove|delete|add|implement|improve|clean up)\b/i.test(
      prompt,
    )
  ) {
    return normalizedActivePath;
  }

  return null;
}

/**
 * Normalize a user-provided file/folder path.
 */
export function normalizeRequestedPath(
  rawPath: string,
  workspaceRoot: string,
  activeFilePath?: string,
): string | null {
  const cleaned = rawPath.trim().replace(/[.]+$/, "");
  if (!cleaned) {
    return null;
  }

  const normalizedActivePath = normalizeActivityPath(
    activeFilePath,
    workspaceRoot,
  );

  if (
    /^(?:the\s+)?(?:this|current|active|selected|attached)\s+file$/i.test(
      cleaned,
    )
  ) {
    return normalizedActivePath ?? null;
  }

  if (
    /^(?:the\s+)?(?:this|current|active|selected|attached)\s+(?:folder|directory)$/i.test(
      cleaned,
    )
  ) {
    return normalizedActivePath
      ? path.dirname(normalizedActivePath).replace(/\\/g, "/")
      : null;
  }

  const withoutKindPrefix = cleaned.replace(
    /^(?:the\s+)?(?:file|folder|directory)\s+/i,
    "",
  );

  return normalizeActivityPath(withoutKindPrefix, workspaceRoot) ?? null;
}

/**
 * Extract a tool command request from natural-language prose.
 */
export function extractToolCommandRequest(
  prompt: string,
  workspaceRoot: string,
  activeFilePath?: string,
): string | null {
  const terminalCommand = extractTerminalCommandRequest(prompt);
  if (terminalCommand) {
    return `terminal ${terminalCommand}`;
  }

  const normalized = prompt.trim();
  if (!normalized) {
    return null;
  }

  const readFileMatch = normalized.match(
    /^(?:please\s+)?(?:read|open|show)\s+(?:the\s+)?file\s+(.+)$/i,
  );
  if (readFileMatch) {
    return `read ${readFileMatch[1].trim()}`;
  }

  const readPathMatch = normalized.match(
    /^(?:please\s+)?(?:read|open|show)\s+(?:the\s+)?([a-z0-9_./\\-]+\.\w+)$/i,
  );
  if (readPathMatch) {
    return `read ${readPathMatch[1].trim()}`;
  }

  const searchMatch = normalized.match(
    /^(?:please\s+)?(?:search|find)\s+(?:for\s+)?(.+)$/i,
  );
  if (searchMatch && !/\b(command|terminal|shell)\b/i.test(normalized)) {
    const searchQuery = searchMatch[1].trim();
    const shouldInferSearch =
      /["'`]/.test(searchQuery) ||
      /\b(file|symbol|text|string|pattern|repo|repository|workspace|codebase)\b/i.test(
        searchQuery,
      );

    if (shouldInferSearch) {
      return `search ${searchQuery}`;
    }
  }

  const testMatch = normalized.match(
    /^(?:please\s+)?(?:run|execute)\s+(?:the\s+)?tests?(?:\s+with\s+(.+))?$/i,
  );
  if (testMatch) {
    const args = testMatch[1]?.trim();
    return args && args.length > 0 ? `test ${args}` : "test";
  }

  const moveMatch = normalized.match(
    /^(?:please\s+)?(?:move|rename)\s+(.+?)\s+(?:to|into)\s+(.+)$/i,
  );
  if (moveMatch) {
    const sourcePath = normalizeRequestedPath(
      moveMatch[1],
      workspaceRoot,
      activeFilePath,
    );
    const destinationPath = normalizeRequestedPath(
      moveMatch[2],
      workspaceRoot,
      activeFilePath,
    );

    if (sourcePath && destinationPath) {
      return `move ${sourcePath} ||| ${destinationPath}`;
    }
  }

  const clearMatch = normalized.match(
    /^(?:please\s+)?(?:clear|empty|delete\s+contents\s+of|remove\s+contents\s+of)\s+(.+)$/i,
  );
  if (clearMatch) {
    const targetPath = normalizeRequestedPath(
      clearMatch[1],
      workspaceRoot,
      activeFilePath,
    );

    if (targetPath) {
      return `delete-contents ${targetPath}`;
    }
  }

  // C-01 FIX: Natural-language delete inference removed.
  // Destructive operations must use structured tool calls, not prose parsing.

  return null;
}

/**
 * Extract a terminal command request from prompt text.
 */
export function extractTerminalCommandRequest(prompt: string): string | null {
  const raw = prompt.trim();
  if (!raw) {
    return null;
  }

  const singleLineDirect = normalizeCommandCandidate(raw);
  if (singleLineDirect) {
    return singleLineDirect;
  }

  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];

    const bareCandidate = normalizeCommandCandidate(line);
    if (bareCandidate) {
      return bareCandidate;
    }

    const inline = line.match(
      /^(?:please\s+)?(?:help\s+)?(?:run|execute)(?:\s+this)?(?:\s+command)?\s*[:-]\s*(.+)$/i,
    );
    if (inline) {
      const candidate = normalizeCommandCandidate(inline[1]);
      if (candidate) {
        return candidate;
      }
    }

    if (
      /^(?:please\s+)?(?:help\s+)?(?:run|execute)(?:\s+this)?(?:\s+command)?\s*[:-]?$/i.test(
        line,
      )
    ) {
      const nextLine = lines[index + 1];
      if (!nextLine) {
        continue;
      }

      const candidate = normalizeCommandCandidate(nextLine);
      if (candidate) {
        return candidate;
      }
    }
  }

  return null;
}

/**
 * Extract a workspace stats request from prompt text.
 */
export function extractWorkspaceStatsRequest(prompt: string): string | null {
  const normalized = prompt.toLowerCase().trim();
  if (!normalized) return null;

  const patterns = [
    /\b(?:how many|count|number of)\s+(?:files?|folders?|directories?|dirs?)\b/i,
    /\b(?:file|folder|directory|dir)\s+(?:count|stats?|statistics|breakdown)\b/i,
    /\bworkspace\s+(?:stats?|statistics|summary|overview)\b/i,
    /\b(?:what|show)\s+(?:is|are)\s+the\s+(?:file|folder|directory)\s+(?:count|stats?|breakdown)\b/i,
    /\b(?:list|give|show)\s+(?:me\s+)?(?:workspace\s+)?(?:file|folder|directory)\s+(?:count|stats?|statistics|breakdown)\b/i,
  ];

  for (const pattern of patterns) {
    if (pattern.test(normalized)) {
      return "workspace-stats";
    }
  }

  return null;
}

/**
 * Normalize and validate a string as a known command starter.
 */
export function normalizeCommandCandidate(candidate: string): string | null {
  const trimmed = candidate
    .trim()
    .replace(/^`+/, "")
    .replace(/`+$/, "")
    .trim();

  if (!trimmed || trimmed.length > 1_800) {
    return null;
  }

  if (/\r|\n/.test(trimmed)) {
    return null;
  }

  const commandStarter =
    /^(pnpm|npm|npx|yarn|bun|node|python|pip|pip3|uv|poetry|go|cargo|dotnet|mvn|gradle|java|javac|git|docker|kubectl|terraform|make|cmake|pwsh|powershell|bash|sh|cmd|ls|dir|mkdir|touch|cat|type)\b/i;

  return commandStarter.test(trimmed) ? trimmed : null;
}
