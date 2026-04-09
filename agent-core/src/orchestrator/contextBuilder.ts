import fs from "fs/promises";
import path from "path";
import { RequestAttachment, OrchestratorRequest } from "../types";

const MAX_WORKSPACE_CONTEXT_CHARS = 12_000;
const MAX_MEMORY_CONTEXT_CHARS = 4_000;
const MAX_TOOL_OUTPUT_CHARS = 16_000;
const MAX_ACTIVE_SNIPPET_CHARS = 3_200;
const MAX_REFERENCED_FILE_SNIPPET_CHARS = 1_600;
const MAX_ATTACHMENT_TEXT_CHARS = 3_000;

interface WorkspaceSnapshotCache {
  workspaceRoot: string;
  entries: string[];
  expiresAt: number;
}

export let workspaceSnapshotCache: WorkspaceSnapshotCache | null = null;

export function getWorkspaceSnapshotCache() {
  return workspaceSnapshotCache;
}

export function setWorkspaceSnapshotCache(
  cache: WorkspaceSnapshotCache | null,
) {
  workspaceSnapshotCache = cache;
}

export async function buildWorkspaceContext(
  request: OrchestratorRequest,
  defaultWorkspaceRoot: string,
): Promise<string> {
  const workspaceRoot = request.workspaceRoot ?? defaultWorkspaceRoot;
  const sections: string[] = [];

  try {
    const names = await getWorkspaceTopLevelEntries(workspaceRoot);
    sections.push(`Workspace root: ${workspaceRoot}`);
    sections.push(`Top-level entries: ${names.join(", ")}`);
  } catch {
    // Best-effort context only.
  }

  if (request.activeFilePath) {
    const absoluteActivePath = resolvePathWithinWorkspaceRoot(
      workspaceRoot,
      request.activeFilePath,
    );

    if (absoluteActivePath) {
      try {
        const fileContent = await fs.readFile(absoluteActivePath, "utf8");
        const snippet = clampText(
          request.selectedText && request.selectedText.trim().length > 0
            ? request.selectedText.trim()
            : fileContent,
          MAX_ACTIVE_SNIPPET_CHARS,
          "Active snippet trimmed",
        );

        sections.push(
          `Active file: ${path.relative(workspaceRoot, absoluteActivePath).replace(/\\/g, "/")}`,
        );
        sections.push(`Active snippet:\n${snippet}`);
      } catch {
        // Ignore active file read failures.
      }
    }
  }

  const activeRelativePath = normalizeActivityPath(
    request.activeFilePath,
    workspaceRoot,
  );
  const referencedFiles = extractLikelyFileReferences(request.prompt)
    .map((candidate) => normalizeActivityPath(candidate, workspaceRoot))
    .filter(
      (candidate): candidate is string =>
        Boolean(candidate) && candidate !== activeRelativePath,
    );

  const dedupedReferenced = [...new Set(referencedFiles)].slice(0, 3);
  for (const referencedRelativePath of dedupedReferenced) {
    const absoluteReferencedPath = resolvePathWithinWorkspaceRoot(
      workspaceRoot,
      referencedRelativePath,
    );
    if (!absoluteReferencedPath) {
      continue;
    }

    try {
      const referencedContent = await fs.readFile(
        absoluteReferencedPath,
        "utf8",
      );
      sections.push(`Referenced file: ${referencedRelativePath}`);
      sections.push(
        `Referenced snippet:\n${clampText(referencedContent, MAX_REFERENCED_FILE_SNIPPET_CHARS, "Referenced snippet trimmed")}`,
      );
    } catch {
      // Ignore referenced file read failures.
    }
  }

  if ((request.attachments?.length ?? 0) > 0) {
    sections.push(buildAttachmentContext(request.attachments ?? []));
  }

  return sections.join("\n\n");
}

async function getWorkspaceTopLevelEntries(
  workspaceRoot: string,
): Promise<string[]> {
  const now = Date.now();
  if (
    workspaceSnapshotCache &&
    workspaceSnapshotCache.workspaceRoot === workspaceRoot &&
    workspaceSnapshotCache.expiresAt > now
  ) {
    return workspaceSnapshotCache.entries;
  }

  const topLevel = await fs.readdir(workspaceRoot, {
    withFileTypes: true,
  });
  const entries = topLevel
    .slice(0, 24)
    .map((entry) => (entry.isDirectory() ? `${entry.name}/` : entry.name));

  workspaceSnapshotCache = {
    workspaceRoot,
    entries,
    expiresAt: now + 15_000,
  };

  return entries;
}

function resolvePathWithinWorkspaceRoot(
  workspaceRoot: string,
  rawPath: string,
): string | null {
  const trimmed = rawPath.trim().replace(/^['"`]|['"`]$/g, "");
  if (!trimmed) {
    return null;
  }

  const absolutePath = path.isAbsolute(trimmed)
    ? path.normalize(trimmed)
    : path.normalize(path.join(workspaceRoot, trimmed));

  const relative = path.relative(workspaceRoot, absolutePath);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    return null;
  }

  return absolutePath;
}

function extractLikelyFileReferences(prompt: string): string[] {
  const matches = prompt.match(/[A-Za-z0-9._/-]+\.[a-z0-9]{1,8}/gi) ?? [];
  return matches
    .map((match) => match.trim())
    .filter((match) => match.length > 2)
    .slice(0, 8);
}

function clampText(
  value: string,
  maxChars: number,
  noticeLabel: string,
): string {
  const text = value ?? "";
  if (!text) {
    return "";
  }

  if (text.length <= maxChars) {
    return text;
  }

  const omittedChars = text.length - maxChars;
  return `${text.slice(0, maxChars)}\n\n[${noticeLabel}; ${omittedChars} characters omitted]`;
}

function buildAttachmentContext(attachments: RequestAttachment[]): string {
  const lines: string[] = ["User attachments:"];
  const bounded = attachments.slice(0, 8);

  for (const attachment of bounded) {
    const sizeLabel = attachment.byteSize
      ? ` (${attachment.byteSize} bytes)`
      : "";
    lines.push(
      `- ${attachment.fileName} [${attachment.kind}, ${attachment.mimeType}]${sizeLabel}`,
    );

    if (attachment.kind === "text" && attachment.textContent) {
      const snippet = clampText(
        attachment.textContent,
        MAX_ATTACHMENT_TEXT_CHARS,
        "Attachment snippet trimmed",
      );
      lines.push(`  Text snippet:\n${snippet}`);
    } else if (attachment.kind === "image" && attachment.base64Data) {
      const preview = attachment.base64Data.slice(0, 320);
      lines.push(
        `  Image base64 preview (first 320 chars): ${preview}${attachment.base64Data.length > 320 ? "..." : ""}`,
      );
    } else if (attachment.base64Data) {
      lines.push(
        `  Binary base64 preview (first 160 chars): ${attachment.base64Data.slice(0, 160)}${attachment.base64Data.length > 160 ? "..." : ""}`,
      );
    }
  }

  if (attachments.length > bounded.length) {
    lines.push(
      `- ... ${attachments.length - bounded.length} more attachment(s) omitted`,
    );
  }

  return lines.join("\n");
}

function normalizeActivityPath(
  rawPath: string | undefined,
  workspaceRoot: string,
): string | undefined {
  if (!rawPath) {
    return undefined;
  }

  const absolute = resolvePathWithinWorkspaceRoot(workspaceRoot, rawPath);
  if (!absolute) {
    return undefined;
  }

  return path.relative(workspaceRoot, absolute).replace(/\\/g, "/");
}

export {
  getWorkspaceTopLevelEntries,
  resolvePathWithinWorkspaceRoot,
  clampText,
  extractLikelyFileReferences,
  buildAttachmentContext,
  normalizeActivityPath,
};
