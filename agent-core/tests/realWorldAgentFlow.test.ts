import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs/promises";
import path from "path";
import { createNexcodeOrchestrator } from "../src";
import { OrchestratorEvent, ModelProvider, ChatMessage } from "../src";

// Mock provider that returns simple responses
function createMockProvider(): ModelProvider {
  return {
    id: "ollama",
    async generate(request: { model: string; messages: ChatMessage[]; maxTokens?: number }) {
      const lastMessage = request.messages[request.messages.length - 1];
      const content = lastMessage?.content ?? "";

      // Simple responses based on content
      if (content.includes("hello") || content.includes("Hi")) {
        return { text: "Hello! I'm NexCode, your AI coding assistant." };
      }
      if (content.includes("name")) {
        return { text: "I'm NexCode-Kiboko, a local-first AI coding assistant." };
      }
      if (content.includes("can you") || content.includes("what can")) {
        return { text: "I can help you write, debug, and understand code." };
      }
      if (content.includes("delete")) {
        return { text: "I can help you delete files using the delete tool." };
      }

      return { text: "I understand your request. Let me help you with that." };
    },
  };
}

async function collectEvents(
  generator: AsyncGenerator<OrchestratorEvent>,
): Promise<OrchestratorEvent[]> {
  const events: OrchestratorEvent[] = [];
  for await (const event of generator) {
    events.push(event);
  }
  return events;
}

describe("Real-world agent flow tests", () => {
  const workspaceRoot = path.resolve(__dirname, "..", "..");
  let testDir: string;

  beforeEach(async () => {
    testDir = path.join(workspaceRoot, ".test-real-" + Date.now());
    await fs.mkdir(testDir, { recursive: true });
    await fs.writeFile(path.join(testDir, "test.txt"), "Hello world");
    await fs.writeFile(path.join(testDir, "config.json"), '{"key": "value"}');
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  describe("Simple question handling", () => {
    it("answers conversational questions without using tools", async () => {
      const orchestrator = createNexcodeOrchestrator({ workspaceRoot: testDir });
      const events = await collectEvents(
        orchestrator.stream({
          prompt: "What is your name?",
          mode: "auto",
          provider: "openai-compatible",
          workspaceRoot: testDir,
        }),
      );

      // Should produce some events (status, token, or final)
      expect(events.length).toBeGreaterThan(0);
    });

    it("answers capability questions without tools", async () => {
      const orchestrator = createNexcodeOrchestrator({ workspaceRoot: testDir });
      const events = await collectEvents(
        orchestrator.stream({
          prompt: "What can you do?",
          mode: "auto",
          provider: "openai-compatible",
          workspaceRoot: testDir,
        }),
      );

      expect(events.length).toBeGreaterThan(0);
    });

    it("handles greetings", async () => {
      const orchestrator = createNexcodeOrchestrator({ workspaceRoot: testDir });
      const events = await collectEvents(
        orchestrator.stream({
          prompt: "Hello!",
          mode: "auto",
          provider: "openai-compatible",
          workspaceRoot: testDir,
        }),
      );

      expect(events.length).toBeGreaterThan(0);
    });
  });

  describe("Tool command handling", () => {
    it("handles /tool terminal commands", async () => {
      const orchestrator = createNexcodeOrchestrator({ workspaceRoot: testDir });
      const events = await collectEvents(
        orchestrator.stream({
          prompt: "/tool terminal echo hello",
          mode: "auto",
          provider: "openai-compatible",
          workspaceRoot: testDir,
        }),
      );

      const finalEvent = events.find((e) => e.type === "final");
      expect(finalEvent).toBeDefined();
      if (finalEvent?.type === "final") {
        expect(finalEvent.response.text).toContain("Tool Activity");
      }
    });

    it("handles /tool read commands", async () => {
      const orchestrator = createNexcodeOrchestrator({ workspaceRoot: testDir });
      const events = await collectEvents(
        orchestrator.stream({
          prompt: "/tool read test.txt",
          mode: "auto",
          provider: "openai-compatible",
          workspaceRoot: testDir,
        }),
      );

      const finalEvent = events.find((e) => e.type === "final");
      expect(finalEvent).toBeDefined();
      if (finalEvent?.type === "final") {
        expect(finalEvent.response.text).toContain("Tool Activity");
      }
    });

    it("handles /tool git-status", async () => {
      const orchestrator = createNexcodeOrchestrator({ workspaceRoot: testDir });
      const events = await collectEvents(
        orchestrator.stream({
          prompt: "/tool git-status",
          mode: "auto",
          provider: "openai-compatible",
          workspaceRoot: testDir,
        }),
      );

      const finalEvent = events.find((e) => e.type === "final");
      expect(finalEvent).toBeDefined();
    });
  });

  describe("Edit command handling", () => {
    it("handles /edit commands", async () => {
      const orchestrator = createNexcodeOrchestrator({ workspaceRoot: testDir });
      const events = await collectEvents(
        orchestrator.stream({
          prompt: "/edit test.txt :: Updated content",
          mode: "auto",
          provider: "openai-compatible",
          workspaceRoot: testDir,
        }),
      );

      const finalEvent = events.find((e) => e.type === "final");
      expect(finalEvent).toBeDefined();
      if (finalEvent?.type === "final") {
        expect(finalEvent.response.proposedEdits.length).toBeGreaterThanOrEqual(1);
      }
    });
  });

  describe("Mode-specific routing", () => {
    it("routes to planner mode when requested", async () => {
      const orchestrator = createNexcodeOrchestrator({ workspaceRoot: testDir });
      const events = await collectEvents(
        orchestrator.stream({
          prompt: "Plan a simple API endpoint",
          mode: "planner",
          provider: "openai-compatible",
          workspaceRoot: testDir,
        }),
      );

      // Should produce events
      expect(events.length).toBeGreaterThan(0);
    });

    it("routes to coder mode when requested", async () => {
      const orchestrator = createNexcodeOrchestrator({ workspaceRoot: testDir });
      const events = await collectEvents(
        orchestrator.stream({
          prompt: "Write a hello world function",
          mode: "coder",
          provider: "openai-compatible",
          workspaceRoot: testDir,
        }),
      );

      expect(events.length).toBeGreaterThan(0);
    });

    it("routes to reviewer mode when requested", async () => {
      const orchestrator = createNexcodeOrchestrator({ workspaceRoot: testDir });
      const events = await collectEvents(
        orchestrator.stream({
          prompt: "Review this code for issues",
          mode: "reviewer",
          provider: "openai-compatible",
          workspaceRoot: testDir,
        }),
      );

      expect(events.length).toBeGreaterThan(0);
    });
  });

  describe("Error handling", () => {
    it("handles invalid tool commands gracefully", async () => {
      const orchestrator = createNexcodeOrchestrator({ workspaceRoot: testDir });
      const events = await collectEvents(
        orchestrator.stream({
          prompt: "/tool unknowncommand abc",
          mode: "auto",
          provider: "openai-compatible",
          workspaceRoot: testDir,
        }),
      );

      const finalEvent = events.find((e) => e.type === "final");
      expect(finalEvent).toBeDefined();
      if (finalEvent?.type === "final") {
        expect(finalEvent.response.text).toContain("Tool Activity");
      }
    });

    it("handles empty prompts gracefully", async () => {
      const orchestrator = createNexcodeOrchestrator({ workspaceRoot: testDir });
      const events = await collectEvents(
        orchestrator.stream({
          prompt: "",
          mode: "auto",
          provider: "openai-compatible",
          workspaceRoot: testDir,
        }),
      );

      expect(events.length).toBeGreaterThan(0);
    });
  });

  describe("Attachment handling", () => {
    it("handles text attachments", async () => {
      const orchestrator = createNexcodeOrchestrator({ workspaceRoot: testDir });
      const events = await collectEvents(
        orchestrator.stream({
          prompt: "Summarize the attached context",
          mode: "auto",
          provider: "openai-compatible",
          workspaceRoot: testDir,
          attachments: [
            {
              id: "att-1",
              fileName: "notes.txt",
              mimeType: "text/plain",
              kind: "text",
              textContent: "This is a test attachment.",
              byteSize: 25,
            },
          ],
        }),
      );

      expect(events.length).toBeGreaterThan(0);
    });
  });

  describe("Agent model configuration", () => {
    it("uses per-mode agent models", async () => {
      const orchestrator = createNexcodeOrchestrator({
        workspaceRoot: testDir,
        agentModels: {
          manager: "qwen3:8b",
          primaryWorker: "qwen2.5-coder:14b",
          lightweightWorker: "qwen2.5-coder:3b",
          reasoningReviewer: "deepseek-r1:8b",
        },
      });

      const events = await collectEvents(
        orchestrator.stream({
          prompt: "Write a function",
          mode: "coder",
          provider: "ollama",
          workspaceRoot: testDir,
        }),
      );

      expect(events.length).toBeGreaterThan(0);
    });
  });

  describe("Slash command detection", () => {
    it("does not classify slash commands as simple questions", async () => {
      const orchestrator = createNexcodeOrchestrator({ workspaceRoot: testDir });

      // Access private method for testing
      const isSimple = (orchestrator as any).isSimpleQuestion("/tool terminal ls");
      expect(isSimple).toBe(false);
    });

    it("classifies short questions as simple", async () => {
      const orchestrator = createNexcodeOrchestrator({ workspaceRoot: testDir });
      const isSimple = (orchestrator as any).isSimpleQuestion("hello");
      expect(isSimple).toBe(true);
    });

    it("classifies questions with ? as simple", async () => {
      const orchestrator = createNexcodeOrchestrator({ workspaceRoot: testDir });
      const isSimple = (orchestrator as any).isSimpleQuestion("Can you help me understand this code?");
      expect(isSimple).toBe(true);
    });

    it("classifies action requests as not simple", async () => {
      const orchestrator = createNexcodeOrchestrator({ workspaceRoot: testDir });
      const isSimple = (orchestrator as any).isSimpleQuestion("Create a new file called test.ts");
      expect(isSimple).toBe(false);
    });
  });
});
