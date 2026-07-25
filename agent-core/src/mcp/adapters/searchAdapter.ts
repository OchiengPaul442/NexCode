import { type McpAdapter, type McpToolCall, type McpToolResult } from "../types";
import { type SearchTool } from "../../tools/searchTool";

/**
 * Search MCP adapter that wraps the existing SearchTool.
 * Provides web search and code search through the MCP interface.
 */
export class SearchMcpAdapter implements McpAdapter {
  public readonly id = "search";

  private readonly search: SearchTool;

  constructor(search: SearchTool) {
    this.search = search;
  }

  async listTools(): Promise<string[]> {
    return ["search", "web-search"];
  }

  async callTool(call: McpToolCall): Promise<McpToolResult> {
    const startedAt = Date.now();
    try {
      let result;
      switch (call.tool) {
        case "search":
          result = await this.search.search(call.input);
          break;
        case "web-search":
          result = await this.search.webSearch(call.input);
          break;
        default:
          return {
            ok: false,
            output: `Unknown search tool: ${call.tool}`,
            latencyMs: Date.now() - startedAt,
          };
      }
      return {
        ...result,
        latencyMs: Date.now() - startedAt,
      };
    } catch (error) {
      return {
        ok: false,
        output: String(error),
        latencyMs: Date.now() - startedAt,
      };
    }
  }
}
