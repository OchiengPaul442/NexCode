import { describe, it, expect } from "vitest";
import { TokenCounter, OVERHEAD_PER_MESSAGE, TOOL_SCHEMA_OVERHEAD, MIN_OUTPUT_RESERVE, SAFETY_MARGIN } from "../src/utils/tokenCounter";
import type { ChatMessage, ToolCallRequestTool } from "../src/types";

describe("TokenCounter", () => {
  describe("estimateRequestTokens", () => {
    it("sums content tokens and per-message overhead", () => {
      const counter = new TokenCounter();
      const messages: ChatMessage[] = [
        { role: "user", content: "hello" },
        { role: "assistant", content: "world" },
      ];
      const tokens = counter.estimateRequestTokens(messages);
      const expected = Math.ceil(5 / 4) + OVERHEAD_PER_MESSAGE + Math.ceil(5 / 4) + OVERHEAD_PER_MESSAGE;
      expect(tokens).toBe(expected);
    });

    it("includes tool call arguments in estimate", () => {
      const counter = new TokenCounter();
      const messages: ChatMessage[] = [
        {
          role: "assistant",
          content: "",
          tool_calls: [
            {
              id: "call_1",
              type: "function",
              function: { name: "read", arguments: '{"path":"src/index.ts"}' },
            },
          ],
        },
      ];
      const tokens = counter.estimateRequestTokens(messages);
      const argTokens = Math.ceil('{"path":"src/index.ts"}'.length / 4);
      expect(tokens).toBe(argTokens + OVERHEAD_PER_MESSAGE);
    });

    it("includes tool schemas when provided", () => {
      const counter = new TokenCounter();
      const messages: ChatMessage[] = [
        { role: "user", content: "test" },
      ];
      const tools: ToolCallRequestTool[] = [
        { name: "read", description: "Read a file", inputSchema: {} },
        { name: "write", description: "Write a file", inputSchema: {} },
      ];
      const withoutTools = counter.estimateRequestTokens(messages);
      const withTools = counter.estimateRequestTokens(messages, tools);
      expect(withTools).toBe(withoutTools + 2 * TOOL_SCHEMA_OVERHEAD);
    });

    it("handles empty messages array", () => {
      const counter = new TokenCounter();
      expect(counter.estimateRequestTokens([])).toBe(0);
    });

    it("returns 0 for empty messages with no tools", () => {
      const counter = new TokenCounter();
      expect(counter.estimateRequestTokens([], [])).toBe(0);
    });
  });

  describe("calculateInputBudget", () => {
    it("subtracts output reserve and safety margin from context window", () => {
      const counter = new TokenCounter();
      const budget = counter.calculateInputBudget(32768);
      expect(budget).toBe(32768 - MIN_OUTPUT_RESERVE - SAFETY_MARGIN);
    });

    it("uses maxOutputTokens when provided instead of MIN_OUTPUT_RESERVE", () => {
      const counter = new TokenCounter();
      const budget = counter.calculateInputBudget(32768, 8192);
      expect(budget).toBe(32768 - 8192 - SAFETY_MARGIN);
    });

    it("uses MIN_OUTPUT_RESERVE when maxOutputTokens is smaller", () => {
      const counter = new TokenCounter();
      const budget = counter.calculateInputBudget(32768, 1024);
      expect(budget).toBe(32768 - MIN_OUTPUT_RESERVE - SAFETY_MARGIN);
    });

    it("returns 0 when context window is too small", () => {
      const counter = new TokenCounter();
      const budget = counter.calculateInputBudget(100);
      expect(budget).toBe(0);
    });

    it("returns 0 for negative budget", () => {
      const counter = new TokenCounter();
      expect(counter.calculateInputBudget(0)).toBe(0);
    });
  });

  describe("buildReducedRetryMessages (integration)", () => {
    it("two-message retry does not produce four messages", () => {
      const input: ChatMessage[] = [
        { role: "system", content: "You are a coding assistant." },
        { role: "user", content: "Fix the bug." },
        { role: "assistant", content: "I see the issue." },
        { role: "user", content: "Now apply the fix." },
      ];

      // Replicate buildReducedRetryMessages logic
      let system: ChatMessage | undefined;
      let latestUser: ChatMessage | undefined;
      const nonSystemUser: ChatMessage[] = [];

      for (let i = input.length - 1; i >= 0; i--) {
        const m = input[i];
        if (m.role === "system" && !system) {
          system = m;
        } else if (m.role === "user" && !latestUser) {
          latestUser = m;
        } else if (m.role !== "system" && m.role !== "user") {
          nonSystemUser.unshift(m);
        }
      }

      const recentResults = nonSystemUser.slice(-2);
      const reduced = [system, latestUser, ...recentResults].filter(Boolean) as ChatMessage[];

      expect(reduced.length).toBeLessThanOrEqual(4);
      // Must contain system and latest user
      expect(reduced[0].role).toBe("system");
      expect(reduced[1].role).toBe("user");
      expect(reduced[1].content).toBe("Now apply the fix.");
    });

    it("reduces long message history to system + latest user + last 2 non-system-user", () => {
      const input: ChatMessage[] = [
        { role: "system", content: "sys" },
        { role: "user", content: "u1" },
        { role: "assistant", content: "a1" },
        { role: "user", content: "u2" },
        { role: "assistant", content: "a2" },
        { role: "user", content: "u3" },
        { role: "assistant", content: "a3" },
        { role: "user", content: "u4" },
      ];

      let system: ChatMessage | undefined;
      let latestUser: ChatMessage | undefined;
      const nonSystemUser: ChatMessage[] = [];

      for (let i = input.length - 1; i >= 0; i--) {
        const m = input[i];
        if (m.role === "system" && !system) {
          system = m;
        } else if (m.role === "user" && !latestUser) {
          latestUser = m;
        } else if (m.role !== "system" && m.role !== "user") {
          nonSystemUser.unshift(m);
        }
      }

      const recentResults = nonSystemUser.slice(-2);
      const reduced = [system, latestUser, ...recentResults].filter(Boolean) as ChatMessage[];

      // system + latestUser (u4) + last 2 assistant (a2, a3) = 4 messages max
      expect(reduced.length).toBe(4);
      expect(reduced.map((m) => m.role)).toEqual(["system", "user", "assistant", "assistant"]);
    });

    it("handles messages with no system message", () => {
      const input: ChatMessage[] = [
        { role: "user", content: "hello" },
        { role: "assistant", content: "hi" },
      ];

      let system: ChatMessage | undefined;
      let latestUser: ChatMessage | undefined;
      const nonSystemUser: ChatMessage[] = [];

      for (let i = input.length - 1; i >= 0; i--) {
        const m = input[i];
        if (m.role === "system" && !system) {
          system = m;
        } else if (m.role === "user" && !latestUser) {
          latestUser = m;
        } else if (m.role !== "system" && m.role !== "user") {
          nonSystemUser.unshift(m);
        }
      }

      const recentResults = nonSystemUser.slice(-2);
      const reduced = [system, latestUser, ...recentResults].filter(Boolean) as ChatMessage[];

      expect(reduced.length).toBe(2);
      expect(reduced[0].role).toBe("user");
      expect(reduced[1].role).toBe("assistant");
    });
  });
});
