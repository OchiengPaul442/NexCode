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
}
