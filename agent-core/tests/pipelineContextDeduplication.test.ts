import { describe, it, expect } from "vitest";

/**
 * These tests verify the stage-prompt construction logic from orchestrator.ts
 * (lines 1126-1134) to ensure pipeline stages do not duplicate context.
 *
 * The logic under test:
 *   stageContextParts = [
 *     planContent && stage !== "planner" ? `Plan:\n${planContent}` : "",
 *     implementationDraft && stage === "reviewer" ? `Implementation draft:\n${implementationDraft}` : "",
 *   ].filter(part => part.length > 0)
 *
 *   stagePrompt = stageContextParts.length > 0
 *     ? `${prompt}\n\n${stageContextParts.join("\n\n")}`
 *     : prompt
 */

function buildStagePrompt(
  prompt: string,
  stage: string,
  planContent?: string,
  implementationDraft?: string,
): string {
  const stageContextParts = [
    planContent && stage !== "planner" ? `Plan:\n${planContent}` : "",
    implementationDraft && stage === "reviewer" ? `Implementation draft:\n${implementationDraft}` : "",
  ].filter((part) => part.length > 0);

  return stageContextParts.length > 0
    ? `${prompt}\n\n${stageContextParts.join("\n\n")}`
    : prompt;
}

describe("pipeline stage prompt construction", () => {
  const basePrompt = "Fix the authentication bug";
  const plan = "Step 1: Find auth code\nStep 2: Add token check";
  const draft = "Added middleware validation";

  it("planner stage does not include planContent (avoids duplication)", () => {
    const result = buildStagePrompt(basePrompt, "planner", plan);
    expect(result).toBe(basePrompt);
    expect(result).not.toContain(plan);
  });

  it("coder stage includes planContent when available", () => {
    const result = buildStagePrompt(basePrompt, "coder", plan);
    expect(result).toContain(basePrompt);
    expect(result).toContain(plan);
    expect(result).toContain("Plan:");
  });

  it("reviewer stage includes planContent", () => {
    const result = buildStagePrompt(basePrompt, "reviewer", plan);
    expect(result).toContain(plan);
  });

  it("reviewer stage includes implementationDraft", () => {
    const result = buildStagePrompt(basePrompt, "reviewer", plan, draft);
    expect(result).toContain(draft);
    expect(result).toContain("Implementation draft:");
  });

  it("reviewer stage does NOT include implementationDraft if not provided", () => {
    const result = buildStagePrompt(basePrompt, "reviewer", plan);
    expect(result).not.toContain("Implementation draft:");
  });

  it("qa stage does not include implementationDraft", () => {
    const result = buildStagePrompt(basePrompt, "qa", plan, draft);
    expect(result).toContain(plan);
    expect(result).not.toContain(draft);
  });

  it("stage prompt only contains stage-specific additions, not workspace/memory/session", () => {
    const workspaceContext = "Project uses TypeScript 5.2";
    const memoryContext = "User prefers functional style";
    const sessionContext = "Previous fix attempted in auth.ts";

    // These contexts are passed separately to runAgentLoopStreaming,
    // NOT appended to the stage prompt
    const result = buildStagePrompt(basePrompt, "coder", plan);

    expect(result).not.toContain(workspaceContext);
    expect(result).not.toContain(memoryContext);
    expect(result).not.toContain(sessionContext);
    expect(result).toContain(basePrompt);
    expect(result).toContain(plan);
  });

  it("returns base prompt when no stage-specific context is available", () => {
    const result = buildStagePrompt(basePrompt, "coder");
    expect(result).toBe(basePrompt);
  });

  it("returns base prompt for planner with no plan content", () => {
    const result = buildStagePrompt(basePrompt, "planner");
    expect(result).toBe(basePrompt);
  });

  it("joins multiple stage context parts with double newline", () => {
    const result = buildStagePrompt(basePrompt, "reviewer", plan, draft);
    const expected = `${basePrompt}\n\nPlan:\n${plan}\n\nImplementation draft:\n${draft}`;
    expect(result).toBe(expected);
  });
});
