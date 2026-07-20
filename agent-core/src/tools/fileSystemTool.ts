import fs from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
import { ProposedEdit, ToolResult } from "../types";
import { createPatch } from "../utils/diff";
import { ContextCompressor } from "../utils/contextCompressor";
import { resolveWorkspacePath } from "../utils/pathContainment";

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
      await fs.mkdir(path.dirname(absolutePath), { recursive: true });
      await fs.writeFile(absolutePath, content, "utf8");
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

      const newContent = content.replace(oldText, () => newText);
      await fs.writeFile(absolutePath, newContent, "utf8");

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
        // Path doesn't exist — let rm handle the error.
        await fs.rm(absolutePath, { recursive: true, force: true });
        return { ok: true, output: `Deleted ${targetPath}` };
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
      oldText = "";
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
