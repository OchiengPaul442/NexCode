import { TerminalTool } from "./terminalTool";
import { ToolResult } from "../types";

export class GitTool {
  public constructor(private readonly terminal: TerminalTool) {}

  public status(): Promise<ToolResult> {
    return this.terminal.runSafe("git", ["status", "--short"]);
  }

  public diff(): Promise<ToolResult> {
    return this.terminal.runSafe("git", ["--no-pager", "diff"]);
  }

  public branch(): Promise<ToolResult> {
    return this.terminal.runSafe("git", ["branch", "--show-current"]);
  }

  public stage(paths: string[]): Promise<ToolResult> {
    if (!paths.length) {
      return Promise.resolve({ ok: false, output: "No paths provided." });
    }
    return this.terminal.runSafe("git", ["add", "--", ...paths]);
  }

  public unstage(paths: string[]): Promise<ToolResult> {
    if (!paths.length) {
      return Promise.resolve({ ok: false, output: "No paths provided." });
    }
    return this.terminal.runSafe("git", ["reset", "HEAD", "--", ...paths]);
  }

  public commit(message: string): Promise<ToolResult> {
    if (!message || !message.trim()) {
      return Promise.resolve({ ok: false, output: "Commit message cannot be empty." });
    }
    return this.terminal.runSafe("git", ["commit", "-m", message]);
  }

  public createBranch(name: string): Promise<ToolResult> {
    if (!name || !name.trim()) {
      return Promise.resolve({ ok: false, output: "Branch name cannot be empty." });
    }
    if (!/^[a-zA-Z0-9._\-/]+$/.test(name)) {
      return Promise.resolve({ ok: false, output: "Invalid branch name. Use only letters, digits, hyphens, underscores, dots, and slashes." });
    }
    return this.terminal.runSafe("git", ["checkout", "-b", name]);
  }

  public log(count: number = 10): Promise<ToolResult> {
    const safeCount = Math.min(Math.max(1, count), 100);
    return this.terminal.runSafe("git", ["log", "--oneline", "-n", String(safeCount)]);
  }

  public show(ref: string): Promise<ToolResult> {
    if (!ref || !ref.trim()) {
      return Promise.resolve({ ok: false, output: "Ref cannot be empty." });
    }
    return this.terminal.runSafe("git", ["show", ref]);
  }
}
