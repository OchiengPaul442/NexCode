import fs from "fs/promises";
import path from "path";
import { ToolResult } from "../types";
import { FileSystemTool } from "./fileSystemTool";
import { GitTool } from "./gitTool";
import { McpRegistry } from "../mcp/mcpRegistry";
import { FilesystemAdapter } from "../mcp/adapters/filesystemAdapter";
import { SearchTool } from "./searchTool";
import { TerminalTool } from "./terminalTool";
import { TestRunnerTool } from "./testRunnerTool";
import { DefaultToolApprovalPolicy, ToolApprovalPolicy } from "./toolApprovalPolicy";
import {
  StructuredToolResult,
  ToolResultError,
  createStructuredResult,
  validateInput,
} from "./toolProtocol";
import { getToolDefinition, TOOL_DEFINITIONS } from "./toolDefinitions";
import { AuditLog } from "./auditLog";

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
  auditLog?: AuditLog;
}

export class ToolRegistry {
  public readonly filesystem: FileSystemTool;
  public readonly terminal: TerminalTool;
  public readonly git: GitTool;
  public readonly test: TestRunnerTool;
  public readonly search: SearchTool;
  private readonly mcpRegistry?: McpRegistry;
  private readonly approvalPolicy: ToolApprovalPolicy;
  private readonly approvedCalls = new Set<string>();
  public auditLog?: AuditLog;

  public constructor(workspaceRoot: string, options: ToolRegistryOptions = {}) {
    this.filesystem = new FileSystemTool(workspaceRoot);
    this.terminal = new TerminalTool(workspaceRoot);
    this.git = new GitTool(this.terminal);
    this.test = new TestRunnerTool(this.terminal);
    this.search = new SearchTool(this.terminal, {
      tavilyApiKey: options.tavilyApiKey,
      tavilyBaseUrl: options.tavilyBaseUrl,
    });
    if (options.mcpRegistry) {
      this.mcpRegistry = options.mcpRegistry;
    } else {
      const mcp = new McpRegistry();
      mcp.register(new FilesystemAdapter(workspaceRoot));
      this.mcpRegistry = mcp;
    }
    this.approvalPolicy = options.approvalPolicy ?? new DefaultToolApprovalPolicy();
    this.auditLog = options.auditLog;
  }

  public markApproved(toolName: string, arg: string): void {
    this.approvedCalls.add(`${toolName}::${arg}`);
  }

  public requiresApproval(toolName: string, arg: string): boolean {
    if (this.approvedCalls.has(`${toolName}::${arg}`)) {
      return false;
    }
    return this.approvalPolicy.requiresApproval(toolName, arg);
  }

  public getToolRiskLevel(toolName: string, arg: string): "safe" | "low-risk" | "destructive" {
    return this.approvalPolicy.getToolRiskLevel(toolName, arg);
  }

  public isAutoExecutable(toolName: string, arg: string): boolean {
    return this.approvalPolicy.isAutoExecutable(toolName, arg);
  }

  private emitAudit(
    toolName: string,
    arg: string,
    approved: boolean,
    approvalRequired: boolean,
    ok: boolean,
    output: string,
    start: number,
  ): void {
    if (!this.auditLog) return;
    this.auditLog.log({
      timestamp: new Date().toISOString(),
      toolName,
      arg,
      approved,
      approvalRequired,
      ok,
      outputPreview: output.substring(0, 200),
      durationMs: Date.now() - start,
    });
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
    const auditStart = Date.now();
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
      const r = { ok: false, output: `Invalid input: ${validationError}` };
      this.emitAudit(toolName, arg, false, false, false, r.output, auditStart);
      return r;
    }

    if (this.requiresApproval(toolName, arg)) {
      const r = {
        ok: false,
        output: "AWAITING_APPROVAL",
        requiresApproval: true,
        toolName,
        pendingArg: arg,
      } as ToolApprovalRequiredResult;
      this.emitAudit(toolName, arg, false, true, false, r.output, auditStart);
      return r;
    }

    let result: ToolResult;
    switch (toolName) {
      case "search":
        result = await this.search.search(arg);
        break;
      case "web-search":
      case "search-web":
      case "online-search":
        result = await this.search.webSearch(arg);
        break;
      case "terminal":
        result = await this.terminal.run(arg);
        break;
      case "git-status":
        result = await this.git.status();
        break;
      case "git-diff":
        result = await this.git.diff();
        break;
      case "git-branch":
        result = await this.git.branch();
        break;
      case "git-stage": {
        const stagePaths = this.parsePathList(arg);
        if (!stagePaths) {
          result = { ok: false, output: "Use: git-stage <path1> [path2] ..." };
        } else {
          result = await this.git.stage(stagePaths);
        }
        break;
      }
      case "git-unstage": {
        const unstagePaths = this.parsePathList(arg);
        if (!unstagePaths) {
          result = { ok: false, output: "Use: git-unstage <path1> [path2] ..." };
        } else {
          result = await this.git.unstage(unstagePaths);
        }
        break;
      }
      case "git-commit":
        result = await this.git.commit(arg);
        break;
      case "git-create-branch":
        result = await this.git.createBranch(arg);
        break;
      case "git-log":
        result = await this.git.log(arg ? parseInt(arg, 10) || 10 : 10);
        break;
      case "git-show":
        result = await this.git.show(arg);
        break;
      case "test":
        result = await this.test.run(arg);
        break;
      case "read":
        result = await this.filesystem.readFile(arg);
        break;
      case "write": {
        const writeMatch = arg.match(/^(.+?)\s*::\s*([\s\S]*)$/);
        if (!writeMatch) {
          result = {
            ok: false,
            output: "Use: write <path> :: <content>",
          };
        } else {
          result = await this.filesystem.writeFile(
            writeMatch[1].trim(),
            writeMatch[2] ?? "",
          );
        }
        break;
      }
      case "append": {
        const appendMatch = arg.match(/^(.+?)\s*::\s*([\s\S]*)$/);
        if (!appendMatch) {
          result = {
            ok: false,
            output: "Use: append <path> :: <content>",
          };
        } else {
          result = await this.filesystem.appendFile(
            appendMatch[1].trim(),
            appendMatch[2] ?? "",
          );
        }
        break;
      }
      case "move": {
        const moveMatch = arg.match(/^(.+?)\s*::\s*(.+)$/);
        if (!moveMatch) {
          result = {
            ok: false,
            output: "Use: move <source> :: <destination>",
          };
        } else {
          result = await this.filesystem.movePath(
            moveMatch[1].trim(),
            moveMatch[2].trim(),
          );
        }
        break;
      }
      case "patch": {
        const patchMatch = arg.match(/^(.+?)\s*::\s*(.+?)\s*::\s*([\s\S]*)$/);
        if (!patchMatch) {
          result = { ok: false, output: "Use: patch <path> :: <old text> :: <new text>" };
        } else {
          result = await this.filesystem.patchFile(
            patchMatch[1].trim(),
            patchMatch[2],
            patchMatch[3] ?? "",
          );
        }
        break;
      }
      case "delete":
        result = await this.filesystem.deletePath(arg);
        break;
      case "delete-contents":
        result = await this.filesystem.clearDirectory(arg);
        break;
      case "batch_edit": {
        try {
          const batchArgs = JSON.parse(arg);
          const results: ToolResult[] = [];

          for (const edit of batchArgs.edits) {
            const batchResult = await this.executeBatchEditItem(edit);
            results.push(batchResult);
          }

          const successCount = results.filter(r => r.ok).length;
          result = {
            ok: successCount === results.length,
            output: `Batch edit: ${successCount}/${results.length} succeeded`,
          };
        } catch (error) {
          result = { ok: false, output: `Batch edit failed: ${error}` };
        }
        break;
      }
      case "mcp": {
        if (!this.mcpRegistry) {
          result = {
            ok: false,
            output:
              "MCP registry is not configured. Register adapters before using /tool mcp.",
          };
        } else {
          const parsed = arg.match(
            /^([a-zA-Z0-9._-]+):([a-zA-Z0-9._-]+)\s*::\s*([\s\S]*)$/,
          );
          if (!parsed) {
            result = {
              ok: false,
              output: "Use: mcp <server>:<tool> :: <input>",
            };
          } else {
            const mcpResult = await this.mcpRegistry.call({
              server: parsed[1],
              tool: parsed[2],
              input: parsed[3] ?? "",
            });

            result = {
              ok: mcpResult.ok,
              output: mcpResult.ok
                ? `${mcpResult.output}\n\n[latency ${mcpResult.latencyMs}ms]`
                : mcpResult.output,
            };
          }
        }
        break;
      }
      default:
        result = {
          ok: false,
          output:
            "Unknown tool command. Use one of: search, web-search, terminal, git-status, git-diff, git-branch, git-stage, git-unstage, git-commit, git-create-branch, git-log, git-show, test, read, write, append, patch, move, delete, delete-contents, mcp, batch_edit",
        };
    }

    this.emitAudit(toolName, arg, true, false, result.ok, result.output, auditStart);
    return result;
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

    if (this.requiresApproval(toolName, arg)) {
      this.emitAudit(toolName, arg, false, true, false, `Awaiting approval for ${toolName}`, startTime);
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
      "git-stage": "GIT_STAGE_FAILED",
      "git-unstage": "GIT_UNSTAGE_FAILED",
      "git-commit": "GIT_COMMIT_FAILED",
      "git-create-branch": "GIT_CREATE_BRANCH_FAILED",
      "git-log": "GIT_LOG_FAILED",
      "git-show": "GIT_SHOW_FAILED",
      patch: "PATCH_FAILED",
      mcp: "MCP_CALL_FAILED",
    };
    return map[toolName] ?? "TOOL_FAILED";
  }

  private extractAffectedFiles(toolName: string, arg: string): string[] | undefined {
    const pathTools = ["read", "write", "append", "move", "delete", "delete-contents", "patch"];
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

  private parsePathList(arg: string): string[] | null {
    const trimmed = arg.trim();
    if (!trimmed) return null;
    return trimmed.split(/\s+/).filter(Boolean);
  }

  private async executeBatchEditItem(edit: { filePath: string; content: string; operation: string }): Promise<ToolResult> {
    try {
      const absolutePath = await this.filesystem.resolveWorkspacePathSafe(edit.filePath);

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
          this.filesystem.ensureNotWorkspaceRootPublic(absolutePath, edit.filePath);
          await fs.rm(absolutePath, { recursive: true, force: true });
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
