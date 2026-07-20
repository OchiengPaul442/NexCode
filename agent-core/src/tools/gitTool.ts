import { TerminalTool } from "./terminalTool";
import { ToolResult } from "../types";

export class GitTool {
  public constructor(private readonly terminal: TerminalTool) {}

  public status(signal?: AbortSignal): Promise<ToolResult> {
    return this.terminal.runSafe("git", ["status", "--short"], 30_000, signal);
  }

  public diff(signal?: AbortSignal): Promise<ToolResult> {
    return this.terminal.runSafe("git", ["--no-pager", "diff"], 30_000, signal);
  }

  public branch(signal?: AbortSignal): Promise<ToolResult> {
    return this.terminal.runSafe("git", ["branch", "--show-current"], 30_000, signal);
  }

  public stage(paths: string[], signal?: AbortSignal): Promise<ToolResult> {
    if (!paths.length) {
      return Promise.resolve({ ok: false, output: "No paths provided." });
    }
    return this.terminal.runSafe("git", ["add", "--", ...paths], 30_000, signal);
  }

  public unstage(paths: string[], signal?: AbortSignal): Promise<ToolResult> {
    if (!paths.length) {
      return Promise.resolve({ ok: false, output: "No paths provided." });
    }
    return this.terminal.runSafe("git", ["reset", "HEAD", "--", ...paths], 30_000, signal);
  }

  public commit(message: string, signal?: AbortSignal): Promise<ToolResult> {
    if (!message || !message.trim()) {
      return Promise.resolve({ ok: false, output: "Commit message cannot be empty." });
    }
    return this.terminal.runSafe("git", ["commit", "-m", message], 30_000, signal);
  }

  public createBranch(name: string, signal?: AbortSignal): Promise<ToolResult> {
    if (!name || !name.trim()) {
      return Promise.resolve({ ok: false, output: "Branch name cannot be empty." });
    }
    if (!/^[a-zA-Z0-9._\-/]+$/.test(name)) {
      return Promise.resolve({ ok: false, output: "Invalid branch name. Use only letters, digits, hyphens, underscores, dots, and slashes." });
    }
    return this.terminal.runSafe("git", ["checkout", "-b", name], 30_000, signal);
  }

  public log(count: number = 10, signal?: AbortSignal): Promise<ToolResult> {
    const safeCount = Math.min(Math.max(1, count), 100);
    return this.terminal.runSafe("git", ["log", "--oneline", "-n", String(safeCount)], 30_000, signal);
  }

  public show(ref: string, signal?: AbortSignal): Promise<ToolResult> {
    if (!ref || !ref.trim()) {
      return Promise.resolve({ ok: false, output: "Ref cannot be empty." });
    }
    return this.terminal.runSafe("git", ["show", ref], 30_000, signal);
  }
}
