export type ToolDef = {
  id: string;
  name: string;
  description?: string;
  requiredPermissions?: string[];
};

type AuditEntry = {
  timestamp: number;
  action: string;
  toolId?: string;
  detail?: any;
};

export class ToolRegistry {
  private tools = new Map<string, ToolDef>();
  private audit: AuditEntry[] = [];

  register(tool: ToolDef) {
    if (!tool || !tool.id) throw new Error("tool.id required");
    this.tools.set(tool.id, tool);
    this.audit.push({
      timestamp: Date.now(),
      action: "register",
      toolId: tool.id,
    });
    return tool;
  }

  get(id: string): ToolDef | null {
    return this.tools.get(id) ?? null;
  }

  list(): ToolDef[] {
    return Array.from(this.tools.values());
  }

  checkPermissions(toolId: string, providedPermissions?: string[]): boolean {
    const t = this.tools.get(toolId);
    if (!t) return false;
    const req = t.requiredPermissions ?? [];
    if (req.length === 0) return true;
    if (!providedPermissions) return false;
    return req.every((p) => providedPermissions.includes(p));
  }

  log(action: string, detail?: any) {
    this.audit.push({ timestamp: Date.now(), action, detail });
  }

  getAudit(): AuditEntry[] {
    return this.audit.slice();
  }

  clear() {
    this.tools.clear();
    this.audit = [];
  }
}

export const toolRegistry = new ToolRegistry();
export default toolRegistry;
