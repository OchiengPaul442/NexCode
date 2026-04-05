import { TerminalTool } from "./terminalTool";
import { ToolResult } from "../types";

export class SearchTool {
  public constructor(private readonly terminal: TerminalTool) {}

  public async search(query: string): Promise<ToolResult> {
    if (!query.trim()) {
      return {
        ok: false,
        output: "Search query cannot be empty.",
      };
    }

    const escaped = query.replace(/"/g, '\\"');
    const rgResult = await this.terminal.run(
      `rg --line-number --no-heading "${escaped}" .`,
    );

    if (rgResult.ok) {
      return rgResult;
    }

    return this.terminal.run(`grep -R -n "${escaped}" .`);
  }
}
