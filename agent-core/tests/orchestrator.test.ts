import path from "path";
import { describe, expect, it, vi } from "vitest";
import { createNexcodeOrchestrator, OrchestratorEvent } from "../src";
import { ModelRouter } from "../src/providers/modelRouter";
import { OpenAICompatibleProvider } from "../src/providers/openAICompatibleProvider";
import { ChatMessage, ModelProvider } from "../src/types";

async function collectEvents(
  generator: AsyncGenerator<OrchestratorEvent>,
): Promise<OrchestratorEvent[]> {
  const events: OrchestratorEvent[] = [];
  for await (const event of generator) {
    events.push(event);
  }
  return events;
}

describe("NexcodeOrchestrator", () => {
  const workspaceRoot = path.resolve(__dirname, "..", "..");

  it("returns a final response in auto mode", async () => {
    const orchestrator = createNexcodeOrchestrator({ workspaceRoot });

    const events = await collectEvents(
      orchestrator.stream({
        prompt: "Design a small API endpoint plan.",
        mode: "auto",
        provider: "openai-compatible",
        workspaceRoot,
      }),
    );

    const finalEvent = events.find((event) => event.type === "final");
    expect(finalEvent).toBeDefined();

    if (!finalEvent || finalEvent.type !== "final") {
      return;
    }

    expect(finalEvent.response.text.length).toBeGreaterThan(20);
    expect(finalEvent.response.modeUsed).toBe("auto");
  });

  it("handles tool command prompts", async () => {
    const orchestrator = createNexcodeOrchestrator({ workspaceRoot });

    const events = await collectEvents(
      orchestrator.stream({
        prompt: "/tool unknowncommand abc",
        mode: "auto",
        provider: "openai-compatible",
        workspaceRoot,
      }),
    );

    const finalEvent = events.find((event) => event.type === "final");
    expect(finalEvent).toBeDefined();

    if (!finalEvent || finalEvent.type !== "final") {
      return;
    }

    expect(finalEvent.response.text).toContain("Tool Execution");
  });

  it("infers bare terminal commands with follow-up instructions", () => {
    const orchestrator = createNexcodeOrchestrator({ workspaceRoot });
    const command = (
      orchestrator as unknown as {
        extractTerminalCommandRequest(prompt: string): string | null;
      }
    ).extractTerminalCommandRequest(
      "pnpm create next-app@latest . --yes\n\nRUN THIS COMMAND AND SETUP FOR ME A WELL STRUCTURED NEXTJS PROJECT FOR A BLOG SITE PLEASE USE BEST PRACTICES",
    );

    expect(command).toBe("pnpm create next-app@latest . --yes");
  });

  it("uses a lighter auto pipeline for simple build prompts", () => {
    const orchestrator = createNexcodeOrchestrator({ workspaceRoot });
    const pipeline = (
      orchestrator as unknown as {
        resolveAutoPipeline(
          prompt: string,
        ): Array<"planner" | "coder" | "reviewer" | "qa" | "security">;
      }
    ).resolveAutoPipeline(
      "Create a blog website with Next.js and polished styling.",
    );

    expect(pipeline).toEqual(["coder", "reviewer", "qa"]);
  });

  it("creates proposed edits for edit commands", async () => {
    const orchestrator = createNexcodeOrchestrator({ workspaceRoot });

    const events = await collectEvents(
      orchestrator.stream({
        prompt:
          "/edit prompts/coder.system.md :: Add a line requesting concise code comments.",
        mode: "auto",
        provider: "openai-compatible",
        workspaceRoot,
      }),
    );

    const finalEvent = events.find((event) => event.type === "final");
    expect(finalEvent).toBeDefined();

    if (!finalEvent || finalEvent.type !== "final") {
      return;
    }

    expect(finalEvent.response.proposedEdits.length).toBeGreaterThanOrEqual(1);
  });

  it("accepts attachment-rich prompts without failure", async () => {
    const orchestrator = createNexcodeOrchestrator({ workspaceRoot });

    const events = await collectEvents(
      orchestrator.stream({
        prompt: "Summarize the attached context briefly.",
        mode: "planner",
        provider: "openai-compatible",
        workspaceRoot,
        attachments: [
          {
            id: "att-1",
            fileName: "notes.txt",
            mimeType: "text/plain",
            kind: "text",
            textContent:
              "This is a test attachment for orchestrator context injection.",
            byteSize: 62,
          },
          {
            id: "att-2",
            fileName: "diagram.png",
            mimeType: "image/png",
            kind: "image",
            base64Data: "iVBORw0KGgoAAAANSUhEUgAA",
            byteSize: 24,
          },
        ],
      }),
    );

    const finalEvent = events.find((event) => event.type === "final");
    expect(finalEvent).toBeDefined();

    if (!finalEvent || finalEvent.type !== "final") {
      return;
    }

    expect(finalEvent.response.text.length).toBeGreaterThan(10);
    expect(finalEvent.response.modeUsed).toBe("planner");
  });
});

describe("Provider routing", () => {
  it("passes maxTokens through the model router", async () => {
    const requests: Array<{ maxTokens?: number }> = [];
    const fakeProvider: ModelProvider = {
      id: "ollama",
      async generate(request) {
        requests.push({ maxTokens: request.maxTokens });
        return { text: "ok" };
      },
    };

    const router = new ModelRouter(
      {
        ollama: fakeProvider,
        "openai-compatible": fakeProvider,
      },
      {
        defaultProvider: "ollama",
        defaultModel: "qwen2.5-coder:7b",
        defaultCloudModel: "gpt-4o-mini",
      },
    );

    const messages: ChatMessage[] = [
      { role: "system", content: "system" },
      { role: "user", content: "hello" },
    ];

    await router.generate(messages, {
      provider: "ollama",
      maxTokens: 912,
    });

    expect(requests[0]?.maxTokens).toBe(912);
  });

  it("allows OpenAI-compatible requests without an api key", async () => {
    const fetchMock = vi.fn(async () => {
      return {
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { content: "ok" } }] }),
        text: async () => "",
      } as Response;
    });

    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    try {
      const provider = new OpenAICompatibleProvider("http://example.test");
      const result = await provider.generate({
        model: "test-model",
        messages: [{ role: "user", content: "hello" }],
      });

      expect(result.text).toBe("ok");
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
      const headers = init?.headers as Record<string, string> | undefined;
      expect(headers?.Authorization).toBeUndefined();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
