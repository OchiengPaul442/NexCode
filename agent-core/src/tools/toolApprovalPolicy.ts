export interface ToolApprovalPolicy {
  requiresApproval(toolName: string, arg: string): boolean;
}

export type ApprovalCallback = (
  toolName: string,
  arg: string,
) => Promise<boolean>;

const DEFAULT_APPROVAL_TOOLS = ["delete", "delete-contents", "move", "terminal", "write", "append", "mcp"];

export class DefaultToolApprovalPolicy implements ToolApprovalPolicy {
  private readonly bypassTools: Set<string>;

  constructor(bypassTools: string[] = []) {
    this.bypassTools = new Set(bypassTools);
  }

  public requiresApproval(toolName: string, _arg: string): boolean {
    if (this.bypassTools.has(toolName)) {
      return false;
    }
    return DEFAULT_APPROVAL_TOOLS.includes(toolName);
  }
}
