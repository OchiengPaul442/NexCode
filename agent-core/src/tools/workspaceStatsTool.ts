import fs from "fs/promises";
import path from "path";
import { ToolResult } from "../types";

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  "coverage",
  "__pycache__",
  ".cache",
  "tmp",
  ".tox",
  ".mypy_cache",
  ".pytest_cache",
  "venv",
  ".venv",
  "vendor",
  "target",
]);

export interface WorkspaceStats {
  totalFiles: number;
  totalDirectories: number;
  filesByExtension: Record<string, number>;
  skippedDirectories: string[];
}

async function walkDir(
  dir: string,
  rootDir: string,
  stats: WorkspaceStats,
  depth: number = 0,
): Promise<void> {
  if (depth > 20) return;

  let entries: import("fs").Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) {
        const relative = path.relative(rootDir, fullPath);
        if (!stats.skippedDirectories.includes(relative)) {
          stats.skippedDirectories.push(relative);
        }
        continue;
      }
      stats.totalDirectories++;
      await walkDir(fullPath, rootDir, stats, depth + 1);
    } else if (entry.isFile()) {
      stats.totalFiles++;
      const ext = path.extname(entry.name).toLowerCase() || "(no extension)";
      stats.filesByExtension[ext] = (stats.filesByExtension[ext] ?? 0) + 1;
    }
  }
}

export async function getWorkspaceStats(workspaceRoot: string): Promise<ToolResult> {
  try {
    const stats: WorkspaceStats = {
      totalFiles: 0,
      totalDirectories: 0,
      filesByExtension: {},
      skippedDirectories: [],
    };

    await walkDir(workspaceRoot, workspaceRoot, stats);

    const sortedExtensions = Object.entries(stats.filesByExtension)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 30)
      .map(([ext, count]) => `  ${ext}: ${count}`)
      .join("\n");

    const output = [
      `Workspace: ${workspaceRoot}`,
      "",
      `Total files: ${stats.totalFiles}`,
      `Total directories: ${stats.totalDirectories}`,
      `Skipped directories: ${stats.skippedDirectories.length}`,
      "",
      "Files by extension:",
      sortedExtensions || "  (none)",
      "",
      `Skipped: ${stats.skippedDirectories.join(", ") || "(none)"}`,
    ].join("\n");

    return { ok: true, output };
  } catch (error) {
    return { ok: false, output: `Failed to collect workspace stats: ${String(error)}` };
  }
}
