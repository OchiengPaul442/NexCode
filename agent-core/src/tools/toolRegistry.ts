import { ToolResult } from "../types";
import { FileSystemTool } from "./fileSystemTool";
import { GitTool } from "./gitTool";
import { McpRegistry } from "../mcp/mcpRegistry";
import { SearchTool } from "./searchTool";
import { TerminalTool } from "./terminalTool";
import { TestRunnerTool } from "./testRunnerTool";

interface ToolRegistryOptions {
  tavilyApiKey?: string;
  tavilyBaseUrl?: string;
  mcpRegistry?: McpRegistry;
}

export class ToolRegistry {
  public readonly filesystem: FileSystemTool;
  public readonly terminal: TerminalTool;
  public readonly git: GitTool;
  public readonly test: TestRunnerTool;
  public readonly search: SearchTool;
  private readonly mcpRegistry?: McpRegistry;

  public constructor(workspaceRoot: string, options: ToolRegistryOptions = {}) {
    this.filesystem = new FileSystemTool(workspaceRoot);
    this.terminal = new TerminalTool(workspaceRoot);
    this.git = new GitTool(this.terminal);
    this.test = new TestRunnerTool(this.terminal);
    this.search = new SearchTool(this.terminal, {
      tavilyApiKey: options.tavilyApiKey,
      tavilyBaseUrl: options.tavilyBaseUrl,
    });
    this.mcpRegistry = options.mcpRegistry;
  }

  public async runToolCall(input: string): Promise<ToolResult> {
    const trimmed = input.trim();
    if (!trimmed) {
      return {
        ok: false,
        output: "Tool command cannot be empty.",
      };
    }

    const firstSpace = trimmed.indexOf(" ");
    const toolName =
      firstSpace === -1
        ? trimmed.toLowerCase()
        : trimmed.slice(0, firstSpace).toLowerCase();
    const arg = firstSpace === -1 ? "" : trimmed.slice(firstSpace + 1).trim();

    switch (toolName) {
      case "search":
        return this.search.search(arg);
      case "web-search":
      case "search-web":
      case "online-search":
        return this.search.webSearch(arg);
      case "terminal":
        return this.terminal.run(arg);
      case "git-status":
        return this.git.status();
      case "git-diff":
        return this.git.diff();
      case "git-branch":
        return this.git.branch();
      case "test":
        return this.test.run(arg);
      case "read":
        return this.filesystem.readFile(arg);
      case "write": {
        const writeMatch = arg.match(/^(.+?)\s*::\s*([\s\S]*)$/);
        if (!writeMatch) {
          return {
            ok: false,
            output: "Use: write <path> :: <content>",
          };
        }

        return this.filesystem.writeFile(
          writeMatch[1].trim(),
          writeMatch[2] ?? "",
        );
      }
      case "append": {
        const appendMatch = arg.match(/^(.+?)\s*::\s*([\s\S]*)$/);
        if (!appendMatch) {
          return {
            ok: false,
            output: "Use: append <path> :: <content>",
          };
        }

        return this.filesystem.appendFile(
          appendMatch[1].trim(),
          appendMatch[2] ?? "",
        );
      }
      case "move": {
        const moveMatch = arg.match(/^(.+?)\s*::\s*(.+)$/);
        if (!moveMatch) {
          return {
            ok: false,
            output: "Use: move <source> :: <destination>",
          };
        }

        return this.filesystem.movePath(
          moveMatch[1].trim(),
          moveMatch[2].trim(),
        );
      }
      case "delete":
        return this.filesystem.deletePath(arg);
      case "delete-contents":
        return this.filesystem.clearDirectory(arg);
      case "mcp": {
        if (!this.mcpRegistry) {
          return {
            ok: false,
            output:
              "MCP registry is not configured. Register adapters before using /tool mcp.",
          };
        }

        const parsed = arg.match(
          /^([a-zA-Z0-9._-]+):([a-zA-Z0-9._-]+)\s*::\s*([\s\S]*)$/,
        );
        if (!parsed) {
          return {
            ok: false,
            output: "Use: mcp <server>:<tool> :: <input>",
          };
        }

        const result = await this.mcpRegistry.call({
          server: parsed[1],
          tool: parsed[2],
          input: parsed[3] ?? "",
        });

        return {
          ok: result.ok,
          output: result.ok
            ? `${result.output}\n\n[latency ${result.latencyMs}ms]`
            : result.output,
        };
      }
      default:
        return {
          ok: false,
          output:
            "Unknown tool command. Use one of: search, web-search, terminal, git-status, git-diff, git-branch, test, read, write, append, move, delete, delete-contents, mcp",
        };
    }
  }
}
