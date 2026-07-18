import fs from "fs/promises";
import path from "path";
import { RequestAttachment, OrchestratorRequest } from "../types";
import { ContextCache } from "../utils/contextCache";
import { checkPathWithinWorkspace } from "../utils/pathContainment";
import { TokenCounter } from "../utils/tokenCounter";

const workspaceContextCache = new ContextCache(30000);
const fileTreeCache = new ContextCache(30_000);
const manifestCache = new ContextCache(300_000);
const recentlyModifiedCache = new ContextCache(30_000);

const MAX_WORKSPACE_CONTEXT_CHARS = 12_000;
const MAX_MEMORY_CONTEXT_CHARS = 4_000;
const MAX_TOOL_OUTPUT_CHARS = 16_000;
const MAX_ACTIVE_SNIPPET_CHARS = 3_200;
const MAX_REFERENCED_FILE_SNIPPET_CHARS = 1_600;
const MAX_ATTACHMENT_TEXT_CHARS = 3_000;
const MAX_FILE_TREE_FILES = 500;
const MAX_ABBREVIATED_TREE_FILES = 100;
const MAX_WORKSPACE_TOKEN_BUDGET = 3000;

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
  contextWindowTokens?: number,
): Promise<string> {
  const workspaceRoot = request.workspaceRoot ?? defaultWorkspaceRoot;
  const cacheKey = `workspace:${workspaceRoot}:${request.activeFilePath ?? ""}:${request.prompt?.slice(0, 100) ?? ""}`;
  const cached = workspaceContextCache.get(cacheKey);
  if (cached) return cached;

  const sections: string[] = [];
  const osPlatform = process.platform === 'win32' ? 'Windows' : process.platform === 'darwin' ? 'macOS' : 'Linux';
  sections.push(`OS: ${osPlatform}`);
  sections.push(`Workspace root: ${workspaceRoot}`);

  try {
    const manifest = await detectProjectManifest(workspaceRoot);
    if (manifest) {
      sections.push(manifest);
    }
  } catch {}

  try {
    const files = await getWorkspaceFileTree(workspaceRoot);
    if (files.length <= MAX_ABBREVIATED_TREE_FILES) {
      sections.push(`Project files (${files.length}):\n${files.map((f) => `  ${f}`).join("\n")}`);
    } else {
      const abbreviated = formatFileTreeAsAbbreviated(files);
      sections.push(`Project files (${files.length} total, abbreviated):\n${abbreviated}`);
    }
  } catch {}

  try {
    const recent = await getRecentlyModifiedFiles(workspaceRoot);
    if (recent.length > 0) {
      sections.push(`Recently modified:\n${recent.map((f) => `  ${f}`).join("\n")}`);
    }
  } catch {}

  if (request.activeFilePath) {
    const absoluteActivePath = resolvePathWithinWorkspaceRoot(
      workspaceRoot,
      request.activeFilePath,
    );

    if (absoluteActivePath) {
      try {
        const fileContent = await fs.readFile(absoluteActivePath, "utf8");
        const snippet = request.selectedText && request.selectedText.trim().length > 0
          ? clampText(request.selectedText.trim(), MAX_ACTIVE_SNIPPET_CHARS, "Selected text trimmed")
          : extractRelevantSnippet(fileContent, request.prompt, MAX_ACTIVE_SNIPPET_CHARS);

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
      const snippet = extractRelevantSnippet(
        referencedContent,
        request.prompt,
        MAX_REFERENCED_FILE_SNIPPET_CHARS,
      );
      sections.push(`Referenced file: ${referencedRelativePath}`);
      sections.push(`Referenced snippet:\n${snippet}`);
    } catch {
      // Ignore referenced file read failures.
    }
  }

  if ((request.attachments?.length ?? 0) > 0) {
    sections.push(buildAttachmentContext(request.attachments ?? []));
  }

  const workspaceTokenBudget = contextWindowTokens
    ? Math.floor(contextWindowTokens * 0.1)
    : MAX_WORKSPACE_TOKEN_BUDGET;
  const joined = sections.join("\n\n");
  const localTokenCounter = new TokenCounter();
  const estimatedTokens = localTokenCounter.estimateTokens(joined);
  if (estimatedTokens > workspaceTokenBudget) {
    const result = truncateToFitTokenBudget(
      joined,
      workspaceTokenBudget,
      localTokenCounter,
      "Workspace context truncated to fit token budget",
    );
    workspaceContextCache.set(cacheKey, result);
    return result;
  }
  workspaceContextCache.set(cacheKey, joined);
  return joined;
}

function extractRelevantSnippet(
  content: string,
  query: string,
  maxChars: number,
): string {
  if (content.length <= maxChars) {
    return content;
  }

  const keywords = query
    .toLowerCase()
    .replace(/[^a-z0-9_\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2);

  if (keywords.length === 0) {
    return clampText(content, maxChars, "File content trimmed");
  }

  const lines = content.split("\n");
  const scoredLines: Array<{ index: number; score: number }> = [];

  for (let i = 0; i < lines.length; i++) {
    const lower = lines[i].toLowerCase();
    let score = 0;
    for (const kw of keywords) {
      if (lower.includes(kw)) {
        score += 1;
      }
    }
    if (score > 0) {
      scoredLines.push({ index: i, score });
    }
  }

  if (scoredLines.length === 0) {
    return clampText(content, maxChars, "File content trimmed");
  }

  scoredLines.sort((a, b) => b.score - a.score);

  const selectedIndices = new Set<number>();
  let totalChars = 0;

  for (const { index } of scoredLines) {
    if (totalChars >= maxChars) {
      break;
    }

    const contextStart = Math.max(0, index - 5);
    const contextEnd = Math.min(lines.length, index + 10);

    for (let i = contextStart; i < contextEnd; i++) {
      if (selectedIndices.has(i)) {
        continue;
      }
      if (totalChars + lines[i].length + 1 > maxChars) {
        break;
      }
      selectedIndices.add(i);
      totalChars += lines[i].length + 1;
    }
  }

  if (selectedIndices.size === 0) {
    return clampText(content, maxChars, "File content trimmed");
  }

  const sortedIndices = [...selectedIndices].sort((a, b) => a - b);
  const selectedLines: string[] = [];
  let prevIndex = -1;

  for (const idx of sortedIndices) {
    if (prevIndex !== -1 && idx > prevIndex + 1) {
      selectedLines.push(`... (${idx - prevIndex - 1} lines omitted) ...`);
    }
    selectedLines.push(lines[idx]);
    prevIndex = idx;
  }

  const result = selectedLines.join("\n");
  if (result.length < content.length) {
    return `${result}\n\n[Extracted relevant sections from ${lines.length} lines]`;
  }
  return result;
}

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "__pycache__",
  ".next",
  "coverage",
  ".vscode",
  ".idea",
  ".cache",
  "out",
  ".turbo",
  ".vercel",
  ".netlify",
  "vendor",
  "target",
  ".gradle",
  ".maven",
]);

async function getWorkspaceFileTree(
  workspaceRoot: string,
): Promise<string[]> {
  const cacheKey = `filetree:${workspaceRoot}`;
  const cached = fileTreeCache.get(cacheKey);
  if (cached) {
    return JSON.parse(cached);
  }

  const files: string[] = [];

  async function walk(dir: string, relativeBase: string): Promise<void> {
    if (files.length >= MAX_FILE_TREE_FILES) {
      return;
    }

    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      if (files.length >= MAX_FILE_TREE_FILES) {
        return;
      }

      if (entry.name.startsWith(".") && entry.name !== ".env.example" && entry.name !== ".gitignore" && entry.name !== ".eslintrc" && entry.name !== ".prettierrc") {
        if (SKIP_DIRS.has(entry.name)) {
          continue;
        }
      }

      if (SKIP_DIRS.has(entry.name)) {
        continue;
      }

      const rel = relativeBase
        ? `${relativeBase}/${entry.name}`
        : entry.name;

      if (entry.isDirectory()) {
        await walk(path.join(dir, entry.name), rel);
      } else {
        files.push(rel);
      }
    }
  }

  await walk(workspaceRoot, "");

  fileTreeCache.set(cacheKey, JSON.stringify(files));
  return files;
}

function formatFileTreeAsAbbreviated(files: string[]): string {
  const tree: Record<string, string[]> = {};

  for (const file of files) {
    const parts = file.split("/");
    if (parts.length <= 1) {
      const key = "(root)";
      if (!tree[key]) tree[key] = [];
      tree[key].push(file);
    } else {
      const dir = parts[0];
      if (!tree[dir]) tree[dir] = [];
      tree[dir].push(parts.slice(1).join("/"));
    }
  }

  const lines: string[] = [];
  for (const [dir, dirFiles] of Object.entries(tree).sort(([a], [b]) => a.localeCompare(b))) {
    if (dir === "(root)") {
      for (const f of dirFiles.sort()) {
        lines.push(`  ${f}`);
      }
    } else {
      lines.push(`  ${dir}/`);
      const subDirs: Record<string, string[]> = {};
      const rootFiles: string[] = [];
      for (const f of dirFiles) {
        const parts = f.split("/");
        if (parts.length > 1) {
          const subDir = parts[0];
          if (!subDirs[subDir]) subDirs[subDir] = [];
          subDirs[subDir].push(parts.slice(1).join("/"));
        } else {
          rootFiles.push(f);
        }
      }
      for (const rf of rootFiles.sort()) {
        lines.push(`    ${rf}`);
      }
      for (const [sd, sdFiles] of Object.entries(subDirs).sort(([a], [b]) => a.localeCompare(b))) {
        lines.push(`    ${sd}/ (${sdFiles.length} files)`);
      }
    }
  }

  return lines.join("\n");
}

async function detectProjectManifest(
  workspaceRoot: string,
): Promise<string | null> {
  const cacheKey = `manifest:${workspaceRoot}`;
  const cached = manifestCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const summary = await readManifest(workspaceRoot);
  if (summary) {
    manifestCache.set(cacheKey, summary);
  }
  return summary;
}

async function readManifest(workspaceRoot: string): Promise<string | null> {
  try {
    const raw = await fs.readFile(path.join(workspaceRoot, "package.json"), "utf8");
    const pkg = JSON.parse(raw);
    const depCount = Object.keys(pkg.dependencies ?? {}).length +
      Object.keys(pkg.devDependencies ?? {}).length;
    const scriptCount = Object.keys(pkg.scripts ?? {}).length;
    return `Project: ${pkg.name ?? "unknown"} (Node.js), ${depCount} dependencies, ${scriptCount} scripts`;
  } catch {}

  try {
    const raw = await fs.readFile(path.join(workspaceRoot, "pyproject.toml"), "utf8");
    const nameMatch = raw.match(/^name\s*=\s*"([^"]+)"/m);
    const deps = (raw.match(/(?:dependencies|requires)\s*=\s*\[/g) ?? []).length;
    return `Project: ${nameMatch?.[1] ?? "unknown"} (Python), ~${deps} dependency block(s)`;
  } catch {}

  try {
    const raw = await fs.readFile(path.join(workspaceRoot, "go.mod"), "utf8");
    const modMatch = raw.match(/^module\s+(\S+)/m);
    return `Project: ${modMatch?.[1] ?? "unknown"} (Go)`;
  } catch {}

  try {
    const raw = await fs.readFile(path.join(workspaceRoot, "Cargo.toml"), "utf8");
    const nameMatch = raw.match(/^name\s*=\s*"([^"]+)"/m);
    return `Project: ${nameMatch?.[1] ?? "unknown"} (Rust)`;
  } catch {}

  try {
    const files = await fs.readdir(workspaceRoot);
    const soln = files.find((f) => f.endsWith(".sln"));
    if (soln) {
      return `Project: ${soln.replace(/\.sln$/, "")} (C#/.NET)`;
    }
    const csproj = files.find((f) => f.endsWith(".csproj"));
    if (csproj) {
      return `Project: ${csproj.replace(/\.csproj$/, "")} (C#/.NET)`;
    }
  } catch {}

  try {
    const files = await fs.readdir(workspaceRoot);
    const hasGradle = files.includes("build.gradle") || files.includes("build.gradle.kts");
    const hasPom = files.includes("pom.xml");
    if (hasGradle || hasPom) {
      return `Project: (Java/${hasGradle ? "Gradle" : "Maven"})`;
    }
  } catch {}

  return null;
}

async function getRecentlyModifiedFiles(
  workspaceRoot: string,
): Promise<string[]> {
  const cacheKey = `recent:${workspaceRoot}`;
  const cached = recentlyModifiedCache.get(cacheKey);
  if (cached) {
    return JSON.parse(cached);
  }

  const files = await getWorkspaceFileTree(workspaceRoot);
  const candidates = files.slice(0, 200);

  const withMtime: Array<{ file: string; mtime: number }> = [];

  for (const file of candidates) {
    try {
      const stat = await fs.stat(path.join(workspaceRoot, file));
      withMtime.push({ file, mtime: stat.mtimeMs });
    } catch {}
  }

  withMtime.sort((a, b) => b.mtime - a.mtime);
  const recent = withMtime.slice(0, 10).map((e) => e.file);

  recentlyModifiedCache.set(cacheKey, JSON.stringify(recent));
  return recent;
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
  return checkPathWithinWorkspace(workspaceRoot, rawPath);
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

function truncateToFitTokenBudget(
  text: string,
  maxTokens: number,
  tokenCounter: TokenCounter,
  noticeLabel: string,
): string {
  if (!text) return "";
  const estimatedTokens = tokenCounter.estimateTokens(text);
  if (estimatedTokens <= maxTokens) return text;

  const maxChars = maxTokens * 4;
  return clampText(text, maxChars, noticeLabel);
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
  getWorkspaceFileTree,
  detectProjectManifest,
  getRecentlyModifiedFiles,
  resolvePathWithinWorkspaceRoot,
  clampText,
  extractLikelyFileReferences,
  buildAttachmentContext,
  normalizeActivityPath,
};
