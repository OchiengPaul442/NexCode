import { ToolResult } from "../types";
import { FileSystemTool } from "./fileSystemTool";
import { GitTool } from "./gitTool";
import { SearchTool } from "./searchTool";
import { TerminalTool } from "./terminalTool";
import { TestRunnerTool } from "./testRunnerTool";

interface ToolRegistryOptions {
  tavilyApiKey?: string;
  tavilyBaseUrl?: string;
}

export class ToolRegistry {
  public readonly filesystem: FileSystemTool;
  public readonly terminal: TerminalTool;
  public readonly git: GitTool;
  public readonly test: TestRunnerTool;
  public readonly search: SearchTool;

  public constructor(workspaceRoot: string, options: ToolRegistryOptions = {}) {
    this.filesystem = new FileSystemTool(workspaceRoot);
    this.terminal = new TerminalTool(workspaceRoot);
    this.git = new GitTool(this.terminal);
    this.test = new TestRunnerTool(this.terminal);
    this.search = new SearchTool(this.terminal, {
      tavilyApiKey: options.tavilyApiKey,
      tavilyBaseUrl: options.tavilyBaseUrl,
    });
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
      default:
        return {
          ok: false,
          output:
            "Unknown tool command. Use one of: search, web-search, terminal, git-status, git-diff, git-branch, test, read",
        };
    }
  }
}
