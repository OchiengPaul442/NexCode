import { TerminalTool } from "./terminalTool";
import { ToolResult } from "../types";

export class TestRunnerTool {
  public constructor(private readonly terminal: TerminalTool) {}

  public run(command?: string): Promise<ToolResult> {
    if (command && command.trim().length > 0) {
      return this.terminal.run(command.trim(), 60_000);
    }

    return this.terminal.run("npm test", 60_000);
  }
}
