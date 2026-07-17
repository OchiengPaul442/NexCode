import { SAFE_PATTERNS } from './terminalTool';

export interface ToolApprovalPolicy {
  requiresApproval(toolName: string, arg: string): boolean;
  isAutoExecutable(toolName: string, arg: string): boolean;
  getToolRiskLevel(toolName: string, arg: string): "safe" | "low-risk" | "destructive";
}

export type ApprovalCallback = (
  toolName: string,
  arg: string,
) => Promise<boolean>;

const SAFE_TOOLS = ["read", "git-status", "git-diff", "git-branch", "search"];
const LOW_RISK_WRITE_TOOLS = ["write", "append"];
const DESTRUCTIVE_TOOLS = ["delete", "delete-contents", "move", "terminal", "mcp", "batch_edit", "web-search", "search-web", "online-search", "test"];

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
      const isSafe = SAFE_PATTERNS.some(pattern => pattern.test(arg.trim()));
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
