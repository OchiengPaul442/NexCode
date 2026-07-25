import { SAFE_PATTERNS } from './terminalTool';
import { minimatch } from 'minimatch';

export interface ToolApprovalPolicy {
  requiresApproval(toolName: string, arg: string): boolean;
  isAutoExecutable(toolName: string, arg: string): boolean;
  getToolRiskLevel(toolName: string, arg: string): "safe" | "low-risk" | "destructive";
}

export type ApprovalCallback = (
  toolName: string,
  arg: string,
) => Promise<boolean>;

const SAFE_TOOLS = ["read", "search", "git-status", "git-diff", "git-branch", "git-log", "git-show", "workspace-stats", "web-search", "search-web", "online-search"];
const LOW_RISK_WRITE_TOOLS = ["write", "append", "patch"];
const DESTRUCTIVE_TOOLS = ["delete", "delete-contents", "move", "terminal", "mcp", "batch_edit", "git-stage", "git-unstage", "git-commit", "git-create-branch", "test"];

export interface PermissionRule {
  /** Tool name or pattern (e.g., "write", "terminal", "git-*") */
  tool: string;
  /** Action: "allow", "ask", "deny" */
  action: "allow" | "ask" | "deny";
  /** Glob pattern for file paths (e.g., "*.env", "src/**") */
  pathPattern?: string;
  /** Glob pattern for command arguments (for terminal tool) */
  commandPattern?: string;
  /** Description of this rule */
  description?: string;
}

export interface EnhancedPermissionConfig {
  /** Rules in order of precedence (first match wins) */
  rules?: PermissionRule[];
  /** Tools that bypass all checks */
  bypassTools?: string[];
  /** Tools that are always auto-approved */
  autoApproveTools?: string[];
}

/**
 * Enhanced permission model with glob-pattern support.
 * Supports:
 * - Tool-level allow/ask/deny
 * - Path glob patterns for file operations
 * - Command glob patterns for terminal operations
 * - Rule precedence (first match wins)
 */
export class EnhancedToolApprovalPolicy implements ToolApprovalPolicy {
  private readonly rules: PermissionRule[];
  private readonly bypassTools: Set<string>;
  private readonly autoApproveTools: Set<string>;
  private readonly legacyPolicy: DefaultToolApprovalPolicy;

  constructor(config: EnhancedPermissionConfig = {}) {
    this.rules = config.rules ?? [];
    this.bypassTools = new Set(config.bypassTools ?? []);
    this.autoApproveTools = new Set([...SAFE_TOOLS, ...(config.autoApproveTools ?? [])]);
    this.legacyPolicy = new DefaultToolApprovalPolicy(
      config.bypassTools,
      config.autoApproveTools,
    );
  }

  public requiresApproval(toolName: string, arg: string): boolean {
    // Check bypass tools first
    if (this.bypassTools.has(toolName)) {
      return false;
    }

    // Check custom rules (first match wins)
    for (const rule of this.rules) {
      if (this.matchesRule(rule, toolName, arg)) {
        return rule.action === "ask" || rule.action === "deny";
      }
    }

    // Fall back to legacy policy
    return this.legacyPolicy.requiresApproval(toolName, arg);
  }

  public isAutoExecutable(toolName: string, arg: string): boolean {
    if (this.bypassTools.has(toolName)) {
      return true;
    }

    // Check custom rules
    for (const rule of this.rules) {
      if (this.matchesRule(rule, toolName, arg)) {
        return rule.action === "allow";
      }
    }

    return this.autoApproveTools.has(toolName);
  }

  public getToolRiskLevel(toolName: string, arg: string): "safe" | "low-risk" | "destructive" {
    if (this.bypassTools.has(toolName)) {
      return "safe";
    }

    // Check custom rules
    for (const rule of this.rules) {
      if (this.matchesRule(rule, toolName, arg)) {
        if (rule.action === "allow") return "safe";
        if (rule.action === "deny") return "destructive";
        return "low-risk";
      }
    }

    return this.legacyPolicy.getToolRiskLevel(toolName, arg);
  }

  private matchesRule(rule: PermissionRule, toolName: string, arg: string): boolean {
    // Check tool pattern
    if (!this.matchesPattern(rule.tool, toolName)) {
      return false;
    }

    // Check path pattern (for file tools)
    if (rule.pathPattern) {
      const filePath = this.extractFilePath(toolName, arg);
      if (filePath && !minimatch(filePath, rule.pathPattern)) {
        return false;
      }
    }

    // Check command pattern (for terminal tool)
    if (rule.commandPattern && toolName === "terminal") {
      const command = arg.trim();
      if (!minimatch(command, rule.commandPattern)) {
        return false;
      }
    }

    return true;
  }

  private matchesPattern(pattern: string, value: string): boolean {
    if (pattern === "*") return true;
    if (pattern.endsWith("*")) {
      return value.startsWith(pattern.slice(0, -1));
    }
    return value === pattern;
  }

  private extractFilePath(toolName: string, arg: string): string | null {
    const fileTools = ["read", "write", "append", "patch", "delete", "delete-contents", "move"];
    if (!fileTools.includes(toolName)) return null;

    // Extract first path from arg (before ||| separator)
    const match = arg.match(/^([^\s|]+)/);
    return match?.[1] ?? null;
  }
}

/**
 * Legacy permission model (kept for backward compatibility).
 */
export class DefaultToolApprovalPolicy implements ToolApprovalPolicy {
  private readonly bypassTools: Set<string>;
  private readonly autoApproveTools: Set<string>;

  constructor(bypassTools: string[] = [], autoApproveTools: string[] = []) {
    this.bypassTools = new Set(bypassTools);
    this.autoApproveTools = new Set([...SAFE_TOOLS, ...autoApproveTools]);
  }

  public requiresApproval(toolName: string, arg: string): boolean {
    if (this.bypassTools.has(toolName)) {
      return false;
    }

    if (toolName === 'terminal' && typeof arg === 'string') {
      const trimmed = arg.trim();

      // Check for piped commands first - they need special handling
      if (/\|/.test(trimmed)) {
        // Split on pipe and check if the ENTIRE piped command matches a safe pattern
        // A piped command is only safe if it matches one of our explicit safe piped patterns
        const isSafePiped = SAFE_PATTERNS.some(pattern => {
          // Only match patterns that include the pipe (safe piped patterns)
          if (/\|/.test(pattern.source)) {
            return pattern.test(trimmed);
          }
          return false;
        });
        if (isSafePiped) {
          return false;
        }
        // Unknown piped commands require approval (confirm, don't block)
        return true;
      }

      // Non-piped commands: check if they're safe
      const isSafe = SAFE_PATTERNS.some(pattern => pattern.test(trimmed));
      if (isSafe) {
        return false;
      }
    }

    return DESTRUCTIVE_TOOLS.includes(toolName) || LOW_RISK_WRITE_TOOLS.includes(toolName);
  }

  public isAutoExecutable(toolName: string, _arg: string): boolean {
    if (this.bypassTools.has(toolName)) {
      return true;
    }
    return this.autoApproveTools.has(toolName);
  }

  public getToolRiskLevel(toolName: string, _arg: string): "safe" | "low-risk" | "destructive" {
    if (this.bypassTools.has(toolName)) {
      return "safe";
    }
    if (SAFE_TOOLS.includes(toolName)) {
      return "safe";
    }
    if (LOW_RISK_WRITE_TOOLS.includes(toolName)) {
      return "low-risk";
    }
    return "destructive";
  }
}
