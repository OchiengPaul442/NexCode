import { TerminalTool } from "./terminalTool";
import { ToolResult } from "../types";

export class TestRunnerTool {
  public constructor(private readonly terminal: TerminalTool) {}

  public resolveCommand(command?: string): string {
    return command && command.trim().length > 0 ? command.trim() : "npm test";
  }

  public run(command?: string): Promise<ToolResult> {
    return this.terminal.run(this.resolveCommand(command), 60_000);
  }

  public stream(command?: string): AsyncGenerator<string, ToolResult> {
    return this.terminal.stream(this.resolveCommand(command), 60_000);
  }
}
