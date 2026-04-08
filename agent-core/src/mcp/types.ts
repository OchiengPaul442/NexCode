export interface McpToolCall {
  server: string;
  tool: string;
  input: string;
  metadata?: Record<string, unknown>;
}

export interface McpToolResult {
  ok: boolean;
  output: string;
  latencyMs: number;
}

export interface McpAdapter {
  id: string;
  callTool(call: McpToolCall): Promise<McpToolResult>;
  listTools?(): Promise<string[]>;
}
