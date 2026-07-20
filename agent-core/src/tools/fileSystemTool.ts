import fs from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
import { type ProposedEdit, type ToolResult } from "../types";
import { createPatch } from "../utils/diff";
import { ContextCompressor } from "../utils/contextCompressor";
import { resolveWorkspacePath } from "../utils/pathContainment";

/**
 * Atomically write content to a file by writing to a temp file first, then
 * renaming over the target. This prevents truncation on crash: the rename is
 * atomic on POSIX (and near-atomic on NTFS), so the target is never left in a
 * half-written state.
 *
 * Preserves the existing file's permissions if it exists; otherwise uses
 * default mode.
 */
export async function atomicWriteFile(
  absolutePath: string,
  content: string,
): Promise<void> {
  const dir = path.dirname(absolutePath);
  const tmpName = `.nexcode-tmp-${randomUUID()}`;
  const tmpPath = path.join(dir, tmpName);

  // Ensure the parent directory exists.
  await fs.mkdir(dir, { recursive: true });

  // Try to preserve existing file permissions.
  let mode: number | undefined;
  try {
    const stat = await fs.stat(absolutePath);
    mode = stat.mode;
  } catch {
    // File doesn't exist yet; use default permissions.
  }

  try {
    await fs.writeFile(tmpPath, content, { encoding: "utf8", mode });
    // fs.rename is atomic on POSIX and near-atomic on NTFS (within the same
    // volume). On Windows across volumes it falls back to copy+delete which is
    // still safer than direct writeFile truncation.
    await fs.rename(tmpPath, absolutePath);
  } catch (err) {
    // Clean up the temp file on failure.
    try {
      await fs.unlink(tmpPath);
    } catch {
      // Ignore cleanup errors — the original file is still intact.
    }
    throw err;
  }
}

function enhanceFileSystemError(error: unknown, operation: string, targetPath: string): string {
  const msg = String(error);
  if (msg.includes("ENOENT") || msg.includes("no such file") || msg.includes("cannot find")) {
    return `${operation} failed: File or directory not found: ${targetPath}. Verify the path exists and is correct.`;
  }
  if (msg.includes("EACCES") || msg.includes("permission denied") || msg.includes("EPERM")) {
    return `${operation} failed: Permission denied for ${targetPath}. The file may be read-only or locked by another process.`;
  }
  if (msg.includes("EISDIR")) {
    return `${operation} failed: ${targetPath} is a directory, not a file.`;
  }
  if (msg.includes("ENOTDIR")) {
    return `${operation} failed: A component of ${targetPath} is not a directory.`;
  }
  if (msg.includes("EMFILE") || msg.includes("ENFILE")) {
    return `${operation} failed: Too many open files. Close some files and try again.`;
  }
  return `${operation} failed: ${msg}`;
}

export class FileSystemTool {
  private readonly compressor = new ContextCompressor(8000);

  public constructor(public readonly workspaceRoot: string) {}

  public async readFile(targetPath: string): Promise<ToolResult> {
    try {
      const absolutePath = await this.resolveWorkspacePathSafe(targetPath);
      const content = await fs.readFile(absolutePath, "utf8");
      const compressed = this.compressor.compressFileContent(content, targetPath);
      return {
        ok: true,
        output: compressed,
      };
    } catch (error) {
      return {
        ok: false,
        output: enhanceFileSystemError(error, "Read", targetPath),
      };
    }
  }

  public async writeFile(
    targetPath: string,
    content: string,
  ): Promise<ToolResult> {
    try {
      const absolutePath = await this.resolveWorkspacePathSafe(targetPath);
      await atomicWriteFile(absolutePath, content);
      return {
        ok: true,
        output: `Wrote ${targetPath}`,
      };
    } catch (error) {
      return {
        ok: false,
        output: enhanceFileSystemError(error, "Write", targetPath),
      };
    }
  }

  public async appendFile(
    targetPath: string,
    content: string,
  ): Promise<ToolResult> {
    try {
      const absolutePath = await this.resolveWorkspacePathSafe(targetPath);
      await fs.mkdir(path.dirname(absolutePath), { recursive: true });
      await fs.appendFile(absolutePath, content, "utf8");
      return {
        ok: true,
        output: `Appended to ${targetPath}`,
      };
    } catch (error) {
      return {
        ok: false,
        output: enhanceFileSystemError(error, "Append", targetPath),
      };
    }
  }

  public async patchFile(
    targetPath: string,
    oldText: string,
    newText: string,
  ): Promise<ToolResult> {
    try {
      const absolutePath = await this.resolveWorkspacePathSafe(targetPath);
      const content = await fs.readFile(absolutePath, "utf8");

      if (!content.includes(oldText)) {
        return {
          ok: false,
          output: `Could not find the specified old text in ${targetPath}. The file may have been modified. Read the file and try again with the current content.`,
        };
      }

      // Count occurrences of oldText to require an unambiguous (unique) match.
      const matchCount = content.split(oldText).length - 1;
      if (matchCount > 1) {
        return {
          ok: false,
          output: `The old text appears ${matchCount} times in ${targetPath}. Provide a unique snippet to avoid ambiguity. Include surrounding context to disambiguate.`,
        };
      }

      const newContent = content.replace(oldText, () => newText);
      await atomicWriteFile(absolutePath, newContent);

      return {
        ok: true,
        output: `Patched ${targetPath} (${content.length} -> ${newContent.length} bytes)`,
      };
    } catch (error) {
      return {
        ok: false,
        output: enhanceFileSystemError(error, "Patch", targetPath),
      };
    }
  }

  public async movePath(
    sourcePath: string,
    destinationPath: string,
  ): Promise<ToolResult> {
    try {
      const absoluteSource = await this.resolveWorkspacePathSafe(sourcePath);
      const absoluteDestination = await this.resolveWorkspacePathSafe(destinationPath);
      await fs.mkdir(path.dirname(absoluteDestination), { recursive: true });
      await fs.rename(absoluteSource, absoluteDestination);
      return {
        ok: true,
        output: `Moved ${sourcePath} -> ${destinationPath}`,
      };
    } catch (error) {
      return {
        ok: false,
        output: enhanceFileSystemError(error, "Move", `${sourcePath} -> ${destinationPath}`),
      };
    }
  }

  public async deletePath(targetPath: string): Promise<ToolResult> {
    try {
      const absolutePath = await this.resolveWorkspacePathSafe(targetPath);
      this.ensureNotWorkspaceRoot(absolutePath, targetPath);

      // Use lstat to detect symlinks without following them.
      // Unlink the symlink itself rather than deleting its target.
      let stat: import("fs").Stats;
      try {
        stat = await fs.lstat(absolutePath);
      } catch {
        // C-01: Path doesn't exist — return NOT_FOUND, never false success.
        return {
          ok: false,
          output: `Nothing was deleted because ${targetPath} does not exist.`,
        };
      }

      if (stat.isSymbolicLink()) {
        await fs.unlink(absolutePath);
      } else {
        await fs.rm(absolutePath, { recursive: true, force: true });
      }

      return {
        ok: true,
        output: `Deleted ${targetPath}`,
      };
    } catch (error) {
      return {
        ok: false,
        output: enhanceFileSystemError(error, "Delete", targetPath),
      };
    }
  }

  public async clearDirectory(targetPath: string): Promise<ToolResult> {
    try {
      const absolutePath = await this.resolveWorkspacePathSafe(targetPath);
      this.ensureNotWorkspaceRoot(absolutePath, targetPath);
      const entries = await fs.readdir(absolutePath, { withFileTypes: true });

      for (const entry of entries) {
        const entryPath = path.join(absolutePath, entry.name);

        if (entry.isSymbolicLink()) {
          // Symlink: resolve target for containment check, but unlink the
          // symlink itself rather than deleting the resolved target.
          let resolvedTarget: string;
          try {
            resolvedTarget = await fs.realpath(entryPath);
          } catch {
            // Broken symlink — resolve target failed; still safe to unlink.
            await fs.unlink(entryPath);
            continue;
          }
          const relative = path.relative(this.workspaceRoot, resolvedTarget);
          if (relative.startsWith("..") || path.isAbsolute(relative)) {
            continue; // skip symlinks whose target escapes workspace
          }
          await fs.unlink(entryPath);
        } else if (entry.isDirectory()) {
          // Real directory (not a symlink): check containment then remove.
          const relative = path.relative(this.workspaceRoot, entryPath);
          if (relative.startsWith("..") || path.isAbsolute(relative)) {
            continue;
          }
          await fs.rm(entryPath, { recursive: true, force: true });
        } else {
          // Regular file: check containment then remove.
          const relative = path.relative(this.workspaceRoot, entryPath);
          if (relative.startsWith("..") || path.isAbsolute(relative)) {
            continue;
          }
          await fs.rm(entryPath, { force: true });
        }
      }

      return {
        ok: true,
        output: `Cleared ${targetPath}`,
      };
    } catch (error) {
      return {
        ok: false,
        output: enhanceFileSystemError(error, "Clear directory", targetPath),
      };
    }
  }

  public async makeProposedEdit(
    targetPath: string,
    newText: string,
    summary: string,
  ): Promise<ProposedEdit> {
    const absolutePath = await this.resolveWorkspacePathSafe(targetPath);
    let oldText = "";

    try {
      oldText = await fs.readFile(absolutePath, "utf8");
    } catch {
      // File doesn't exist yet, use empty string
    }

    return {
      id: randomUUID(),
      filePath: path
        .relative(this.workspaceRoot, absolutePath)
        .replace(/\\/g, "/"),
      summary,
      oldText,
      newText,
      patch: createPatch(oldText, newText),
    };
  }

  public async resolveWorkspacePathSafe(targetPath: string): Promise<string> {
    return resolveWorkspacePath(this.workspaceRoot, targetPath);
  }

  public ensureNotWorkspaceRootPublic(
    absolutePath: string,
    requestedPath: string,
  ): void {
    this.ensureNotWorkspaceRoot(absolutePath, requestedPath);
  }

  private ensureNotWorkspaceRoot(
    absolutePath: string,
    requestedPath: string,
  ): void {
    if (path.resolve(absolutePath) === path.resolve(this.workspaceRoot)) {
      throw new Error(
        `Refusing to delete the workspace root directly: ${requestedPath}`,
      );
    }
  }
}
