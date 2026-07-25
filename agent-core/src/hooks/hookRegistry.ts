import { type ToolResult } from "../types";

export interface HookEvent {
  toolName: string;
  args: string;
  result?: ToolResult;
  timestamp: string;
}

export interface Hook {
  name: string;
  description: string;
  /** Called before tool execution. Return false to prevent execution. */
  before?: (event: HookEvent) => Promise<boolean | void>;
  /** Called after tool execution. */
  after?: (event: HookEvent) => Promise<void>;
  /** Tool patterns this hook applies to. Empty = all tools. */
  toolPatterns?: string[];
}

/**
 * Registry for tool execution hooks.
 * Supports pre/post execution hooks for auto-formatting, validation, logging, etc.
 */
export class HookRegistry {
  private hooks: Hook[] = [];

  register(hook: Hook): void {
    this.hooks.push(hook);
  }

  unregister(name: string): void {
    this.hooks = this.hooks.filter(h => h.name !== name);
  }

  /**
   * Execute all matching before hooks for a tool call.
   * Returns false if any hook prevents execution.
   */
  async executeBefore(toolName: string, args: string): Promise<boolean> {
    const event: HookEvent = {
      toolName,
      args,
      timestamp: new Date().toISOString(),
    };

    for (const hook of this.hooks) {
      if (hook.before && this.matchesTool(hook, toolName)) {
        try {
          const result = await hook.before(event);
          if (result === false) {
            return false;
          }
        } catch (error) {
          console.warn(`[hooks] Error in before hook "${hook.name}":`, error);
        }
      }
    }

    return true;
  }

  /**
   * Execute all matching after hooks for a tool call.
   */
  async executeAfter(toolName: string, args: string, result: ToolResult): Promise<void> {
    const event: HookEvent = {
      toolName,
      args,
      result,
      timestamp: new Date().toISOString(),
    };

    for (const hook of this.hooks) {
      if (hook.after && this.matchesTool(hook, toolName)) {
        try {
          await hook.after(event);
        } catch (error) {
          console.warn(`[hooks] Error in after hook "${hook.name}":`, error);
        }
      }
    }
  }

  private matchesTool(hook: Hook, toolName: string): boolean {
    if (!hook.toolPatterns || hook.toolPatterns.length === 0) {
      return true;
    }
    return hook.toolPatterns.some(pattern => {
      if (pattern.endsWith("*")) {
        return toolName.startsWith(pattern.slice(0, -1));
      }
      return toolName === pattern;
    });
  }
}

// Built-in hooks

/**
 * Auto-format hook: runs prettier/eslint after file writes.
 */
export function createAutoFormatHook(formatCommand: string): Hook {
  return {
    name: "auto-format",
    description: "Auto-format files after write/patch operations",
    toolPatterns: ["write", "patch", "append"],
    after: async (event) => {
      const filePath = event.args.split("|||")[0]?.trim();
      if (filePath && event.result?.ok) {
        try {
          // Use execFile (async) to avoid blocking the event loop
          const { execFile: execFileCb } = await import("child_process");
          const { promisify } = await import("util");
          const execFileAsync = promisify(execFileCb);
          await execFileAsync(formatCommand, [filePath], { timeout: 10000 });
        } catch {
          // Best effort — don't fail if formatting fails
        }
      }
    },
  };
}

/**
 * Audit log hook: logs all tool executions.
 */
export function createAuditLogHook(logFile: string): Hook {
  return {
    name: "audit-log",
    description: "Log all tool executions to a file",
    after: async (event) => {
      try {
        const fs = await import("fs/promises");
        const entry = JSON.stringify({
          timestamp: event.timestamp,
          tool: event.toolName,
          args: event.args.slice(0, 200),
          success: event.result?.ok ?? false,
        }) + "\n";
        await fs.appendFile(logFile, entry, "utf8");
      } catch {
        // Best effort
      }
    },
  };
}

/**
 * Validation hook: validates file writes against patterns.
 */
export function createValidationHook(config: {
  blockedPatterns?: RegExp[];
  requireApproval?: string[];
}): Hook {
  return {
    name: "validation",
    description: "Validate tool calls against patterns",
    before: async (event) => {
      if (config.blockedPatterns) {
        for (const pattern of config.blockedPatterns) {
          if (pattern.test(event.args)) {
            return false;
          }
        }
      }
      return true;
    },
  };
}

/**
 * Verification hook: verifies tool execution results.
 * Runs after tool execution and can flag suspicious results.
 */
export function createVerificationHook(config?: {
  /** Patterns that indicate suspicious output */
  suspiciousPatterns?: RegExp[];
  /** Maximum output length before flagging */
  maxOutputLength?: number;
}): Hook {
  const suspiciousPatterns = config?.suspiciousPatterns ?? [
    /permission denied/i,
    /access denied/i,
    /not found/i,
    /no such file/i,
  ];
  const maxOutputLength = config?.maxOutputLength ?? 10000;

  return {
    name: "verification",
    description: "Verify tool execution results",
    after: async (event) => {
      if (!event.result) return;

      // Check for suspicious patterns in output
      for (const pattern of suspiciousPatterns) {
        if (pattern.test(event.result.output)) {
          console.warn(`[verification] Suspicious output detected for ${event.toolName}: ${event.result.output.slice(0, 200)}`);
        }
      }

      // Check for excessively long output
      if (event.result.output.length > maxOutputLength) {
        console.warn(`[verification] Excessive output length (${event.result.output.length} chars) for ${event.toolName}`);
      }
    },
  };
}
