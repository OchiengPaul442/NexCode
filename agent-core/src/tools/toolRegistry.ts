import fs from "fs/promises";
import path from "path";
import { ToolResult } from "../types";
import { FileSystemTool, atomicWriteFile } from "./fileSystemTool";
import { GitTool } from "./gitTool";
import { McpRegistry } from "../mcp/mcpRegistry";
import { FilesystemAdapter } from "../mcp/adapters/filesystemAdapter";
import { SearchTool } from "./searchTool";
import { TerminalTool } from "./terminalTool";
import { TestRunnerTool } from "./testRunnerTool";
import { getWorkspaceStats } from "./workspaceStatsTool";
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
  searchProvider?: string;
  searchApiKey?: string;
  searchBaseUrl?: string;
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
      searchProvider: options.searchProvider as any,
      searchApiKey: options.searchApiKey,
      searchBaseUrl: options.searchBaseUrl,
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

  public getApprovalPolicy(): import('./toolApprovalPolicy').ToolApprovalPolicy {
    return this.approvalPolicy;
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
      // NC-016: If arg is not JSON, validate command-string format for tools
      // with structured schemas. This catches cases where structured args
      // are converted back to command strings without schema validation.
      const structuredTools: Record<string, (a: string) => string | null> = {
        write: (a) => a.includes("::") ? null : "Use: write <path> :: <content>",
        append: (a) => a.includes("::") ? null : "Use: append <path> :: <content>",
        patch: (a) => {
          const parts = a.split("::");
          return parts.length >= 2 ? null : "Use: patch <path> :: <oldText> :: <newText>";
        },
        move: (a) => a.includes("::") ? null : "Use: move <source> :: <destination>",
        batch_edit: (a) => {
          // batch_edit requires JSON args — reject command strings
          try { JSON.parse(a); return null; } catch { return "batch_edit requires JSON arguments"; }
        },
        mcp: (a) => a.includes("::") ? null : "Use: mcp <server>:<tool> :: <input>",
      };
      const formatCheck = structuredTools[toolName];
      if (formatCheck) {
        const err = formatCheck(arg);
        if (err) return err;
      }
    }

    return null;
  }

  public async runToolCall(input: string, signal?: AbortSignal): Promise<ToolResult> {
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
    try {
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
        result = await this.terminal.run(arg, 30_000, signal);
        break;
      case "git-status":
        result = await this.git.status(signal);
        break;
      case "git-diff":
        result = await this.git.diff(signal);
        break;
      case "git-branch":
        result = await this.git.branch(signal);
        break;
      case "git-stage": {
        const stagePaths = this.parsePathList(arg);
        if (!stagePaths) {
          result = { ok: false, output: "Use: git-stage <path1> [path2] ..." };
        } else {
          result = await this.git.stage(stagePaths, signal);
        }
        break;
      }
      case "git-unstage": {
        const unstagePaths = this.parsePathList(arg);
        if (!unstagePaths) {
          result = { ok: false, output: "Use: git-unstage <path1> [path2] ..." };
        } else {
          result = await this.git.unstage(unstagePaths, signal);
        }
        break;
      }
      case "git-commit":
        result = await this.git.commit(arg, signal);
        break;
      case "git-create-branch":
        result = await this.git.createBranch(arg, signal);
        break;
      case "git-log":
        result = await this.git.log(arg ? parseInt(arg, 10) || 10 : 10, signal);
        break;
      case "git-show":
        result = await this.git.show(arg, signal);
        break;
      case "test":
        result = await this.test.run(arg, signal);
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
          const edits: Array<{ filePath: string; content: string; operation: string }> = batchArgs.edits;

          // Phase 1: Pre-validate the full edit set before writing anything.
          const resolvedPaths = new Map<number, string>();
          const seenPaths = new Set<string>();
          const validationErrors: string[] = [];

          for (let i = 0; i < edits.length; i++) {
            const edit = edits[i];
            try {
              const absolutePath = await this.filesystem.resolveWorkspacePathSafe(edit.filePath);
              resolvedPaths.set(i, absolutePath);
              const normalized = path.normalize(absolutePath);
              if (seenPaths.has(normalized)) {
                validationErrors.push(`Duplicate path in batch: ${edit.filePath}`);
              }
              seenPaths.add(normalized);
            } catch (error) {
              validationErrors.push(`Path ${edit.filePath}: ${String(error)}`);
            }
          }

          if (validationErrors.length > 0) {
            result = {
              ok: false,
              output: `Batch edit rejected during pre-validation:\n${validationErrors.join("\n")}`,
            };
            break;
          }

          // Phase 2: Save original content for rollback and execute edits.
          // Rollback info: for each edit, store what needs to be undone.
          const rollbackActions: Array<() => Promise<void>> = [];
          const results: ToolResult[] = [];
          let failed = false;

          for (let i = 0; i < edits.length; i++) {
            if (failed) break;
            const edit = edits[i];
            const absolutePath = resolvedPaths.get(i)!;

            try {
              switch (edit.operation) {
                case "create": {
                  // Save rollback: delete the file we're about to create (if it didn't exist).
                  let existedBefore = false;
                  try {
                    await fs.access(absolutePath);
                    existedBefore = true;
                  } catch {
                    // File doesn't exist — good, we'll create it.
                  }
                  if (!existedBefore) {
                    rollbackActions.push(async () => {
                      try { await fs.rm(absolutePath, { force: true }); } catch { /* best effort */ }
                    });
                  }
                  await atomicWriteFile(absolutePath, edit.content);
                  results.push({ ok: true, output: `Created ${edit.filePath}` });
                  break;
                }
                case "update": {
                  // Save original content for rollback.
                  let originalContent: string;
                  try {
                    originalContent = await fs.readFile(absolutePath, "utf8");
                  } catch {
                    rollbackActions.push(async () => {
                      try { await fs.rm(absolutePath, { force: true }); } catch { /* best effort */ }
                    });
                    originalContent = "";
                  }
                  const capturedOriginal = originalContent!;
                  const capturedPath = absolutePath;
                  rollbackActions.push(async () => {
                    try {
                      await atomicWriteFile(capturedPath, capturedOriginal);
                    } catch { /* best effort rollback */ }
                  });
                  await atomicWriteFile(absolutePath, edit.content);
                  results.push({ ok: true, output: `Updated ${edit.filePath}` });
                  break;
                }
                case "delete": {
                  // Save original content for rollback (re-create the file/dir).
                  let deletedContent: string | null = null;
                  let deletedWasDir = false;
                  try {
                    const stat = await fs.stat(absolutePath);
                    if (stat.isDirectory()) {
                      deletedWasDir = true;
                    } else {
                      deletedContent = await fs.readFile(absolutePath, "utf8");
                    }
                  } catch {
                    // File doesn't exist — delete is a no-op, rollback is no-op.
                  }
                  if (deletedContent !== null) {
                    const capturedPath2 = absolutePath;
                    const capturedContent2 = deletedContent;
                    rollbackActions.push(async () => {
                      try { await atomicWriteFile(capturedPath2, capturedContent2); } catch { /* best effort */ }
                    });
                  } else if (deletedWasDir) {
                    // Cannot meaningfully rollback a directory delete; skip.
                  }
                  this.filesystem.ensureNotWorkspaceRootPublic(absolutePath, edit.filePath);
                  await fs.rm(absolutePath, { recursive: true, force: true });
                  results.push({ ok: true, output: `Deleted ${edit.filePath}` });
                  break;
                }
                default:
                  results.push({ ok: false, output: `Unknown operation: ${edit.operation}` });
                  failed = true;
                  break;
              }
            } catch (error) {
              results.push({ ok: false, output: `Failed to ${edit.operation} ${edit.filePath}: ${String(error)}` });
              failed = true;
            }
          }

          // Phase 3: Roll back all changes if any edit failed.
          if (failed && rollbackActions.length > 0) {
            const rollbackErrors: string[] = [];
            // Roll back in reverse order.
            for (let r = rollbackActions.length - 1; r >= 0; r--) {
              try {
                await rollbackActions[r]();
              } catch (rollbackError) {
                rollbackErrors.push(`Rollback ${r}: ${String(rollbackError)}`);
              }
            }
            const successCount = results.filter(r => r.ok).length;
            const rollbackNote = rollbackErrors.length > 0
              ? `\nRollback errors: ${rollbackErrors.join("; ")}`
              : "\nAll changes rolled back successfully.";
            result = {
              ok: false,
              output: `Batch edit: ${successCount}/${results.length} succeeded before failure.${rollbackNote}`,
            };
          } else {
            const successCount = results.filter(r => r.ok).length;
            result = {
              ok: successCount === results.length,
              output: `Batch edit: ${successCount}/${results.length} succeeded`,
            };
          }
        } catch (error) {
          result = { ok: false, output: `Batch edit failed: ${error}` };
        }
        break;
      }
      case "workspace-stats": {
        result = await getWorkspaceStats(this.filesystem.workspaceRoot);
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
            "Unknown tool command. Use one of: search, web-search, terminal, git-status, git-diff, git-branch, git-stage, git-unstage, git-commit, git-create-branch, git-log, git-show, test, read, write, append, patch, move, delete, delete-contents, mcp, batch_edit, workspace-stats",
        };
    }
    } catch (error) {
      const errorStr = String(error);
      let hint = "";
      if (errorStr.includes("command not found") || errorStr.includes("is not recognized")) {
        hint = " The command may not be available on this platform. Check the [HINT] in the error output for alternatives.";
      }
      result = {
        ok: false,
        output: `Tool execution failed: ${errorStr}${hint}`,
      };
    }

    this.emitAudit(toolName, arg, true, false, result.ok, result.output, auditStart);
    return result;
  }

  public async runToolCallStructured(input: string, signal?: AbortSignal): Promise<StructuredToolResult> {
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

    const basic = await this.runToolCall(input, signal);
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

}
