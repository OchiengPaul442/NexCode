import fs from "fs/promises";
import path from "path";
import { ProposedEdit, ToolResult } from "../types";
import { createPatch } from "../utils/diff";

export class FileSystemTool {
  public constructor(private readonly workspaceRoot: string) {}

  public async readFile(targetPath: string): Promise<ToolResult> {
    try {
      const absolutePath = this.resolveWorkspacePath(targetPath);
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
      const absolutePath = this.resolveWorkspacePath(targetPath);
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
      const absolutePath = this.resolveWorkspacePath(targetPath);
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

  public async makeProposedEdit(
    targetPath: string,
    newText: string,
    summary: string,
  ): Promise<ProposedEdit> {
    const absolutePath = this.resolveWorkspacePath(targetPath);
    let oldText = "";

    try {
      oldText = await fs.readFile(absolutePath, "utf8");
    } catch {
      oldText = "";
    }

    return {
      id: `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`,
      filePath: path
        .relative(this.workspaceRoot, absolutePath)
        .replace(/\\/g, "/"),
      summary,
      oldText,
      newText,
      patch: createPatch(oldText, newText),
    };
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
}
