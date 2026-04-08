import { McpAdapter, McpToolCall, McpToolResult } from "./types";

export class McpRegistry {
  private readonly adapters = new Map<string, McpAdapter>();

  public register(adapter: McpAdapter): void {
    this.adapters.set(adapter.id, adapter);
  }

  public unregister(adapterId: string): void {
    this.adapters.delete(adapterId);
  }

  public has(adapterId: string): boolean {
    return this.adapters.has(adapterId);
  }

  public listServers(): string[] {
    return [...this.adapters.keys()].sort();
  }

  public async listTools(adapterId: string): Promise<string[]> {
    const adapter = this.adapters.get(adapterId);
    if (!adapter) {
      return [];
    }

    if (!adapter.listTools) {
      return [];
    }

    try {
      return await adapter.listTools();
    } catch {
      return [];
    }
  }

  public async call(call: McpToolCall): Promise<McpToolResult> {
    const adapter = this.adapters.get(call.server);
    if (!adapter) {
      return {
        ok: false,
        output: `MCP server '${call.server}' is not registered.`,
        latencyMs: 0,
      };
    }

    const startedAt = Date.now();
    try {
      const result = await adapter.callTool(call);
      return {
        ...result,
        latencyMs: result.latencyMs || Date.now() - startedAt,
      };
    } catch (error) {
      return {
        ok: false,
        output: String(error),
        latencyMs: Date.now() - startedAt,
      };
    }
  }
}
