import fs from "fs/promises";
import path from "path";
import { ToolResult } from "../types";
import { FileSystemTool } from "./fileSystemTool";
import { GitTool } from "./gitTool";
import { McpRegistry } from "../mcp/mcpRegistry";
import { SearchTool } from "./searchTool";
import { TerminalTool } from "./terminalTool";
import { TestRunnerTool } from "./testRunnerTool";
import { ToolApprovalPolicy } from "./toolApprovalPolicy";
import {
  StructuredToolResult,
  ToolResultError,
  createStructuredResult,
  validateInput,
} from "./toolProtocol";
import { getToolDefinition, TOOL_DEFINITIONS } from "./toolDefinitions";

export interface ToolApprovalRequiredResult extends ToolResult {
  requiresApproval: true;
  toolName: string;
  pendingArg: string;
}

interface ToolRegistryOptions {
  tavilyApiKey?: string;
  tavilyBaseUrl?: string;
  mcpRegistry?: McpRegistry;
  approvalPolicy?: ToolApprovalPolicy;
}

export class ToolRegistry {
  public readonly filesystem: FileSystemTool;
  public readonly terminal: TerminalTool;
  public readonly git: GitTool;
  public readonly test: TestRunnerTool;
  public readonly search: SearchTool;
  private readonly mcpRegistry?: McpRegistry;
  private readonly approvalPolicy?: ToolApprovalPolicy;

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
    this.approvalPolicy = options.approvalPolicy;
  }

  public requiresApproval(toolName: string, arg: string): boolean {
    if (!this.approvalPolicy) {
      return false;
    }
    return this.approvalPolicy.requiresApproval(toolName, arg);
  }

  public getToolRiskLevel(toolName: string, arg: string): "safe" | "low-risk" | "destructive" {
    if (!this.approvalPolicy) {
      return "safe";
    }
    return this.approvalPolicy.getToolRiskLevel(toolName, arg);
  }

  public isAutoExecutable(toolName: string, arg: string): boolean {
    if (!this.approvalPolicy) {
      return true;
    }
    return this.approvalPolicy.isAutoExecutable(toolName, arg);
  }

  public getToolDefinition(name: string) {
    return getToolDefinition(name);
  }

  public getAllToolDefinitions() {
    return [...TOOL_DEFINITIONS];
  }

  public validateToolInput(name: string, input: Record<string, unknown>): ReturnType<typeof validateInput> {
    const def = getToolDefinition(name);
    if (!def) {
      return [{ field: "_", message: `Unknown tool: ${name}` }];
    }
    return validateInput(input, def.inputSchema);
  }

  public validateToolArg(toolName: string, arg: string): string | null {
    const definition = getToolDefinition(toolName);
    if (!definition) return null;

    try {
      const args = JSON.parse(arg);
      const errors = validateInput(args, definition.inputSchema);
      if (errors.length > 0) {
        return errors.map((e) => `${e.field}: ${e.message}`).join(", ");
      }
    } catch {
      // If arg is not JSON, skip schema validation
    }

    return null;
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

    const validationError = this.validateToolArg(toolName, arg);
    if (validationError) {
      return {
        ok: false,
        output: `Invalid input: ${validationError}`,
      };
    }

    if (
      this.approvalPolicy &&
      this.approvalPolicy.requiresApproval(toolName, arg)
    ) {
      return {
        ok: false,
        output: "AWAITING_APPROVAL",
        requiresApproval: true,
        toolName,
        pendingArg: arg,
      } as ToolApprovalRequiredResult;
    }

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
      case "batch_edit": {
        try {
          const batchArgs = JSON.parse(arg);
          const results: ToolResult[] = [];

          for (const edit of batchArgs.edits) {
            const result = await this.executeBatchEditItem(edit);
            results.push(result);
          }

          const successCount = results.filter(r => r.ok).length;
          return {
            ok: successCount === results.length,
            output: `Batch edit: ${successCount}/${results.length} succeeded`,
          };
        } catch (error) {
          return { ok: false, output: `Batch edit failed: ${error}` };
        }
      }
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
            "Unknown tool command. Use one of: search, web-search, terminal, git-status, git-diff, git-branch, test, read, write, append, move, delete, delete-contents, mcp, batch_edit",
        };
    }
  }

  public async runToolCallStructured(input: string): Promise<StructuredToolResult> {
    const startTime = Date.now();
    const trimmed = input.trim();
    if (!trimmed) {
      return createStructuredResult(
        false,
        "Empty command",
        startTime,
        undefined,
        { code: "EMPTY_INPUT", message: "Tool command cannot be empty.", retryable: false },
      );
    }

    const firstSpace = trimmed.indexOf(" ");
    const toolName =
      firstSpace === -1
        ? trimmed.toLowerCase()
        : trimmed.slice(0, firstSpace).toLowerCase();
    const arg = firstSpace === -1 ? "" : trimmed.slice(firstSpace + 1).trim();

    const def = getToolDefinition(toolName);
    if (!def) {
      return createStructuredResult(
        false,
        `Unknown tool: ${toolName}`,
        startTime,
        undefined,
        {
          code: "UNKNOWN_TOOL",
          message: `Unknown tool command "${toolName}". Use one of: ${TOOL_DEFINITIONS.map((d) => d.name).join(", ")}`,
          retryable: false,
        },
      );
    }

    if (
      this.approvalPolicy &&
      this.approvalPolicy.requiresApproval(toolName, arg)
    ) {
      return createStructuredResult(
        false,
        `Awaiting approval for ${toolName}`,
        startTime,
        undefined,
        { code: "APPROVAL_REQUIRED", message: `Tool "${toolName}" requires user approval.`, retryable: false },
      );
    }

    const basic = await this.runToolCall(input);
    const affectedFiles = this.extractAffectedFiles(toolName, arg);

    return createStructuredResult(
      basic.ok,
      basic.output.substring(0, 200),
      startTime,
      basic.output,
      basic.ok
        ? undefined
        : {
            code: this.errorCodeForTool(toolName),
            message: basic.output,
            retryable: false,
          },
      affectedFiles,
    );
  }

  private errorCodeForTool(toolName: string): string {
    const map: Record<string, string> = {
      read: "READ_FAILED",
      write: "WRITE_FAILED",
      append: "APPEND_FAILED",
      move: "MOVE_FAILED",
      delete: "DELETE_FAILED",
      "delete-contents": "CLEAR_FAILED",
      terminal: "TERMINAL_FAILED",
      test: "TEST_FAILED",
      search: "SEARCH_FAILED",
      "web-search": "WEB_SEARCH_FAILED",
      "git-status": "GIT_STATUS_FAILED",
      "git-diff": "GIT_DIFF_FAILED",
      "git-branch": "GIT_BRANCH_FAILED",
      mcp: "MCP_CALL_FAILED",
    };
    return map[toolName] ?? "TOOL_FAILED";
  }

  private extractAffectedFiles(toolName: string, arg: string): string[] | undefined {
    const pathTools = ["read", "write", "append", "move", "delete", "delete-contents"];
    if (!pathTools.includes(toolName)) return undefined;

    const writeMatch = arg.match(/^(.+?)\s*::/);
    const moveMatch = arg.match(/^(.+?)\s*::\s*(.+)$/);

    if (toolName === "move" && moveMatch) {
      return [moveMatch[1].trim(), moveMatch[2].trim()];
    }
    if (writeMatch) {
      return [writeMatch[1].trim()];
    }
    if (arg) {
      return [arg.trim()];
    }
    return undefined;
  }

  private async executeBatchEditItem(edit: { filePath: string; content: string; operation: string }): Promise<ToolResult> {
    try {
      const absolutePath = this.filesystem.resolveWorkspacePath(edit.filePath);

      switch (edit.operation) {
        case "create": {
          await fs.mkdir(path.dirname(absolutePath), { recursive: true });
          await fs.writeFile(absolutePath, edit.content, "utf8");
          return { ok: true, output: `Created ${edit.filePath}` };
        }
        case "update": {
          await fs.writeFile(absolutePath, edit.content, "utf8");
          return { ok: true, output: `Updated ${edit.filePath}` };
        }
        case "delete": {
          await fs.rm(absolutePath, { force: true });
          return { ok: true, output: `Deleted ${edit.filePath}` };
        }
        default:
          return { ok: false, output: `Unknown operation: ${edit.operation}` };
      }
    } catch (error) {
      return { ok: false, output: `Failed to ${edit.operation} ${edit.filePath}: ${String(error)}` };
    }
  }
}
