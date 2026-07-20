import type { ActivityFile, ProposedEdit } from "../types";
import { normalizeActivityPath } from "./contextBuilder";

export function parseEditCommand(
  prompt: string,
): { filePath: string; instruction: string } | null {
  const match = prompt.match(/^\s*\/edit\s+(.+?)\s*::\s*([\s\S]+)$/);
  if (!match) {
    return null;
  }

  return {
    filePath: match[1].trim(),
    instruction: match[2].trim(),
  };
}

export function buildActivityFilesFromProposedEdits(
  edits: ProposedEdit[],
  workspaceRoot: string,
): ActivityFile[] {
  const deduped = new Map<string, ActivityFile>();

  for (const edit of edits) {
    const normalizedPath = normalizeActivityPath(edit.filePath, workspaceRoot);
    if (!normalizedPath) {
      continue;
    }

    deduped.set(normalizedPath, {
      path: normalizedPath,
      status: "modified",
      summary: edit.summary || "Proposed edit generated",
    });
  }

  return [...deduped.values()];
}

export function inferActivityFilesFromToolCommand(
  toolCommand: string,
  workspaceRoot: string,
): ActivityFile[] {
  const trimmed = toolCommand.trim();
  if (!trimmed) {
    return [];
  }

  const readMatch = trimmed.match(/^read\s+(.+)$/i);
  if (readMatch) {
    const filePath = normalizeActivityPath(readMatch[1], workspaceRoot);
    if (filePath) {
      return [
        {
          path: filePath,
          status: "viewed",
          summary: "Reading file",
        },
      ];
    }
  }

  const searchMatch = trimmed.match(/^search\s+(.+)$/i);
  if (searchMatch) {
    return [
      {
        path: "workspace",
        status: "viewed",
        summary: `Searching for: ${searchMatch[1].trim()}`,
      },
    ];
  }

  const terminalMatch = trimmed.match(/^terminal\s+(.+)$/i);
  if (terminalMatch) {
    return [
      {
        path: "terminal",
        status: "in-progress",
        summary: terminalMatch[1].trim(),
      },
    ];
  }

  const moveMatch = trimmed.match(/^move\s+(.+?)\s*::\s*(.+)$/i);
  if (moveMatch) {
    return [
      {
        path: normalizeActivityPath(moveMatch[1], workspaceRoot) ?? moveMatch[1].trim(),
        status: "modified",
        summary: `Moved to ${moveMatch[2].trim()}`,
      },
      {
        path: normalizeActivityPath(moveMatch[2], workspaceRoot) ?? moveMatch[2].trim(),
        status: "modified",
        summary: `Created from move ${moveMatch[1].trim()}`,
      },
    ];
  }

  const deleteMatch = trimmed.match(/^delete\s+(.+)$/i);
  if (deleteMatch) {
    const targetPath =
      normalizeActivityPath(deleteMatch[1], workspaceRoot) ?? deleteMatch[1].trim();
    return [
      {
        path: targetPath,
        status: "modified",
        summary: "Deleting path",
      },
    ];
  }

  const clearMatch = trimmed.match(/^delete-contents\s+(.+)$/i);
  if (clearMatch) {
    const targetPath =
      normalizeActivityPath(clearMatch[1], workspaceRoot) ?? clearMatch[1].trim();
    return [
      {
        path: targetPath,
        status: "modified",
        summary: "Clearing directory contents",
      },
    ];
  }

  const mcpMatch = trimmed.match(/^mcp\s+([^:\s]+:[^\s]+).*$/i);
  if (mcpMatch) {
    return [
      {
        path: "mcp",
        status: "in-progress",
        summary: `Calling ${mcpMatch[1]}`,
      },
    ];
  }

  return [];
}

export function inferActivityFilesFromPrompt(
  prompt: string,
  workspaceRoot: string,
  activeFilePath?: string,
): ActivityFile[] {
  const files: ActivityFile[] = [];
  const seen = new Set<string>();

  const parsedEdit = parseEditCommand(prompt);
  if (parsedEdit) {
    const editPath = normalizeActivityPath(parsedEdit.filePath, workspaceRoot);
    if (editPath) {
      files.push({
        path: editPath,
        status: "in-progress",
        summary: "Preparing edit",
      });
      seen.add(editPath);
    }
  }

  const pathLikeMatches = prompt.match(/[\w./\\-]+\.[a-z0-9]{1,8}/gi) ?? [];
  for (const match of pathLikeMatches.slice(0, 4)) {
    const normalizedPath = normalizeActivityPath(match, workspaceRoot);
    if (!normalizedPath || seen.has(normalizedPath)) {
      continue;
    }

    files.push({
      path: normalizedPath,
      status: "viewed",
      summary: "Referenced in prompt",
    });
    seen.add(normalizedPath);
  }

  const normalizedActivePath = normalizeActivityPath(
    activeFilePath,
    workspaceRoot,
  );
  if (normalizedActivePath && !seen.has(normalizedActivePath)) {
    files.push({
      path: normalizedActivePath,
      status: "viewed",
      summary: "Active editor context",
    });
  }

  return files.slice(0, 6);
}
