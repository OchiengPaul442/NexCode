import { TerminalTool } from "./terminalTool";
import { ToolResult } from "../types";

export class GitTool {
  public constructor(private readonly terminal: TerminalTool) {}

  public status(): Promise<ToolResult> {
    return this.terminal.run("git status --short");
  }

  public diff(): Promise<ToolResult> {
    return this.terminal.run("git --no-pager diff");
  }

  public branch(): Promise<ToolResult> {
    return this.terminal.run("git branch --show-current");
  }

  public stage(paths: string[]): Promise<ToolResult> {
    if (!paths.length) {
      return Promise.resolve({ ok: false, output: "No paths provided." });
    }
    return this.terminal.run(`git add -- ${paths.map(p => `"${p}"`).join(" ")}`);
  }

  public unstage(paths: string[]): Promise<ToolResult> {
    if (!paths.length) {
      return Promise.resolve({ ok: false, output: "No paths provided." });
    }
    return this.terminal.run(`git reset HEAD -- ${paths.map(p => `"${p}"`).join(" ")}`);
  }

  public commit(message: string): Promise<ToolResult> {
    if (!message || !message.trim()) {
      return Promise.resolve({ ok: false, output: "Commit message cannot be empty." });
    }
    const escaped = message.replace(/"/g, '\\"');
    return this.terminal.run(`git commit -m "${escaped}"`);
  }

  public createBranch(name: string): Promise<ToolResult> {
    if (!name || !name.trim()) {
      return Promise.resolve({ ok: false, output: "Branch name cannot be empty." });
    }
    if (!/^[a-zA-Z0-9._\-/]+$/.test(name)) {
      return Promise.resolve({ ok: false, output: "Invalid branch name. Use only letters, digits, hyphens, underscores, dots, and slashes." });
    }
    return this.terminal.run(`git checkout -b ${name}`);
  }

  public log(count: number = 10): Promise<ToolResult> {
    return this.terminal.run(`git log --oneline -n ${count}`);
  }

  public show(ref: string): Promise<ToolResult> {
    if (!ref || !ref.trim()) {
      return Promise.resolve({ ok: false, output: "Ref cannot be empty." });
    }
    return this.terminal.run(`git show ${ref}`);
  }
}
