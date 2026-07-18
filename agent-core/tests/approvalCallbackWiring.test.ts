import { describe, it, expect } from "vitest";
import { runAgentLoop } from "../src/agents/agentLoop";
import { ToolRegistry } from "../src/tools/toolRegistry";
import { ModelRouter } from "../src/providers/modelRouter";
import { ToolDefinition } from "../src/tools/toolProtocol";

describe("Agent loop approval callback wiring", () => {
  it("throws when approvalCallback is missing and tool requires approval", async () => {
    const workspaceRoot = process.cwd();
    const tools = new ToolRegistry(workspaceRoot, {
      approvalPolicy: {
        requiresApproval: () => true,
        getToolRiskLevel: () => "destructive",
        isAutoExecutable: () => false,
      },
    });

    const mockRouter = {
      generate: async () => ({
        text: "",
        toolCalls: [
          {
            id: "call_1",
            type: "function" as const,
            function: {
              name: "terminal",
              arguments: JSON.stringify({ command: "echo test" }),
            },
          },
        ],
      }),
    } as unknown as ModelRouter;

    const toolDefs: ToolDefinition[] = [
      {
        name: "terminal",
        version: "1.0.0",
        title: "Run terminal command",
        description: "Execute a shell command",
        risk: "terminal",
        timeoutMs: 120_000,
        inputSchema: {
          type: "object",
          properties: { command: { type: "string" } },
          required: ["command"],
        },
      },
    ];

    const messages = [
      { role: "system" as const, content: "You are a test agent." },
      { role: "user" as const, content: "Run echo test" },
    ];

    const generator = runAgentLoop(
      messages,
      mockRouter,
      tools,
      toolDefs,
      { maxTurns: 5, maxTokensPerTurn: 100, timeoutMs: 10_000 },
      undefined,
      undefined, // NO approvalCallback
    );

    await expect(async () => {
      for await (const _event of generator) {
        // consume events
      }
    }).rejects.toThrow(
      "Tool requires approval but no approvalCallback was provided",
    );
  });

  it("does NOT throw when approvalCallback is provided", async () => {
    const workspaceRoot = process.cwd();
    const tools = new ToolRegistry(workspaceRoot, {
      approvalPolicy: {
        requiresApproval: () => true,
        getToolRiskLevel: () => "destructive",
        isAutoExecutable: () => false,
      },
    });

    const mockRouter = {
      generate: async () => ({
        text: "Done.",
        toolCalls: [
          {
            id: "call_1",
            type: "function" as const,
            function: {
              name: "terminal",
              arguments: JSON.stringify({ command: "echo test" }),
            },
          },
        ],
      }),
    } as unknown as ModelRouter;

    const toolDefs: ToolDefinition[] = [
      {
        name: "terminal",
        version: "1.0.0",
        title: "Run terminal command",
        description: "Execute a shell command",
        risk: "terminal",
        timeoutMs: 120_000,
        inputSchema: {
          type: "object",
          properties: { command: { type: "string" } },
          required: ["command"],
        },
      },
    ];

    const messages = [
      { role: "system" as const, content: "You are a test agent." },
      { role: "user" as const, content: "Run echo test" },
    ];

    let threw = false;
    try {
      const generator = runAgentLoop(
        messages,
        mockRouter,
        tools,
        toolDefs,
        { maxTurns: 2, maxTokensPerTurn: 100, timeoutMs: 10_000 },
        undefined,
        async () => true, // approvalCallback that approves
      );
      for await (const _event of generator) {
        // consume events
      }
    } catch {
      threw = true;
    }
    expect(threw).toBe(false);
  });
});
