import path from "path";
import { describe, expect, it } from "vitest";
import { createNexcodeOrchestrator, OrchestratorEvent } from "../src";

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
});
