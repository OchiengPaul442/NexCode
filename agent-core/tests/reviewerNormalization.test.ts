import { describe, expect, it } from "vitest";
import { runSpecialistAgent } from "../src/agents/shared";

describe("reviewer inline snippet normalization", () => {
  it("replaces invented file paths with provided snippet labels", async () => {
    const router = {
      generate: async () => ({
        text: [
          "1. **Verdict**: NEEDS_CHANGES",
          "2. **Findings**:",
          "- **Location**: `D:\\projects\\agents\\NexCode\\providers\\formatUser.ts` (Assuming this is the file path based on the provided snippet)",
          "- **Issue Description**: The function uses any.",
        ].join(" "),
      }),
    };

    const prompts = {
      getPrompt: async () => "Reviewer prompt",
    };

    const result = await runSpecialistAgent(
      "reviewer",
      router as never,
      prompts as never,
      {
        userPrompt: [
          "Review this snippet:",
          "```ts",
          "function formatUser(user: any) {",
          "  return user.name;",
          "}",
          "```",
        ].join("\n"),
      },
    );

    expect(result.content).toContain("provided snippet");
    expect(result.content).not.toContain("Assuming this is the file path");
    expect(result.content).not.toContain("formatUser.ts");
  });
});
