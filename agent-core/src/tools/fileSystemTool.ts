import fs from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
import { ProposedEdit, ToolResult } from "../types";
import { createPatch } from "../utils/diff";

export class FileSystemTool {
  public constructor(private readonly workspaceRoot: string) {}

  public async readFile(targetPath: string): Promise<ToolResult> {
    try {
      const absolutePath = await this.resolveWorkspacePathSafe(targetPath);
      const output = await fs.readFile(absolutePath, "utf8");
      return {
        ok: true,
        output,
      };
    } catch (error) {
      return {
        ok: false,
        output: String(error),
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
        output: String(error),
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
        output: String(error),
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
        output: String(error),
      };
    }
  }

  public async deletePath(targetPath: string): Promise<ToolResult> {
    try {
      const absolutePath = await this.resolveWorkspacePathSafe(targetPath);
      this.ensureNotWorkspaceRoot(absolutePath, targetPath);
      await fs.rm(absolutePath, { recursive: true, force: true });
      return {
        ok: true,
        output: `Deleted ${targetPath}`,
      };
    } catch (error) {
      return {
        ok: false,
        output: String(error),
      };
    }
  }

  public async clearDirectory(targetPath: string): Promise<ToolResult> {
    try {
      const absolutePath = await this.resolveWorkspacePathSafe(targetPath);
      this.ensureNotWorkspaceRoot(absolutePath, targetPath);
      const entries = await fs.readdir(absolutePath, { withFileTypes: true });

      for (const entry of entries) {
        await fs.rm(path.join(absolutePath, entry.name), {
          recursive: true,
          force: true,
        });
      }

      return {
        ok: true,
        output: `Cleared ${targetPath}`,
      };
    } catch (error) {
      return {
        ok: false,
        output: String(error),
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
    const absolutePath = path.isAbsolute(targetPath)
      ? path.normalize(targetPath)
      : path.normalize(path.join(this.workspaceRoot, targetPath));

    let resolvedPath: string;
    try {
      resolvedPath = await fs.realpath(absolutePath);
    } catch {
      // Path doesn't exist yet - use normalized path for writes
      // For reads, this will fail with ENOENT which is correct
      resolvedPath = absolutePath;
    }

    const relative = path.relative(this.workspaceRoot, resolvedPath);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error(`Path escapes workspace root: ${targetPath}`);
    }

    return resolvedPath;
  }

  public resolveWorkspacePath(targetPath: string): string {
    const absolutePath = path.isAbsolute(targetPath)
      ? path.normalize(targetPath)
      : path.normalize(path.join(this.workspaceRoot, targetPath));

    const relative = path.relative(this.workspaceRoot, absolutePath);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error(`Path escapes workspace root: ${targetPath}`);
    }

    return absolutePath;
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
