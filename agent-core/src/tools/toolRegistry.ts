import { ToolResult } from "../types";
import { FileSystemTool } from "./fileSystemTool";
import { GitTool } from "./gitTool";
import { SearchTool } from "./searchTool";
import { TerminalTool } from "./terminalTool";
import { TestRunnerTool } from "./testRunnerTool";

export class ToolRegistry {
  public readonly filesystem: FileSystemTool;
  public readonly terminal: TerminalTool;
  public readonly git: GitTool;
  public readonly test: TestRunnerTool;
  public readonly search: SearchTool;

  public constructor(workspaceRoot: string) {
    this.filesystem = new FileSystemTool(workspaceRoot);
    this.terminal = new TerminalTool(workspaceRoot);
    this.git = new GitTool(this.terminal);
    this.test = new TestRunnerTool(this.terminal);
    this.search = new SearchTool(this.terminal);
  }

  public async runToolCall(input: string): Promise<ToolResult> {
    const [toolName, ...rest] = input.trim().split(" ");
    const arg = rest.join(" ").trim();

    switch (toolName) {
      case "search":
        return this.search.search(arg);
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
            "Unknown tool command. Use one of: search, terminal, git-status, git-diff, git-branch, test, read",
        };
    }
  }
}
