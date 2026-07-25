import { type McpAdapter, type McpToolCall, type McpToolResult } from "../types";
import { type GitTool } from "../../tools/gitTool";

/**
 * Git MCP adapter that wraps the existing GitTool.
 * Provides Git operations through the MCP interface.
 */
export class GitMcpAdapter implements McpAdapter {
  public readonly id = "git";

  private readonly git: GitTool;

  constructor(git: GitTool) {
    this.git = git;
  }

  async listTools(): Promise<string[]> {
    return [
      "git-status",
      "git-diff",
      "git-log",
      "git-show",
      "git-branch",
      "git-stage",
      "git-unstage",
      "git-commit",
      "git-create-branch",
    ];
  }

  async callTool(call: McpToolCall): Promise<McpToolResult> {
    const startedAt = Date.now();
    try {
      let result;
      switch (call.tool) {
        case "git-status":
          result = await this.git.status();
          break;
        case "git-diff":
          result = await this.git.diff();
          break;
        case "git-log":
          const count = parseInt(call.input, 10) || 10;
          result = await this.git.log(count);
          break;
        case "git-show":
          result = await this.git.show(call.input);
          break;
        case "git-branch":
          result = await this.git.branch();
          break;
        case "git-stage":
          const stagePaths = call.input.split(/\s+/).filter(Boolean);
          result = await this.git.stage(stagePaths);
          break;
        case "git-unstage":
          const unstagePaths = call.input.split(/\s+/).filter(Boolean);
          result = await this.git.unstage(unstagePaths);
          break;
        case "git-commit":
          result = await this.git.commit(call.input);
          break;
        case "git-create-branch":
          result = await this.git.createBranch(call.input);
          break;
        default:
          return {
            ok: false,
            output: `Unknown git tool: ${call.tool}`,
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
