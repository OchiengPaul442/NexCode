import { InteractionFeedback } from "../types";

export class ReflectionEngine {
  public score(
    prompt: string,
    response: string,
    acceptedEdits: number,
    rejectedEdits: number,
  ): InteractionFeedback {
    const base = 50;
    const responseLengthBonus = Math.min(20, Math.floor(response.length / 200));
    const promptCoverageBonus = this.estimatePromptCoverage(prompt, response);
    const editSignal = acceptedEdits * 8 - rejectedEdits * 10;

    const score = Math.max(
      0,
      Math.min(
        100,
        base + responseLengthBonus + promptCoverageBonus + editSignal,
      ),
    );

    return {
      timestamp: new Date().toISOString(),
      prompt,
      response,
      score,
      acceptedEdits,
      rejectedEdits,
    };
  }

  private estimatePromptCoverage(prompt: string, response: string): number {
    const promptTokens = tokenize(prompt);
    const responseTokens = new Set(tokenize(response));
    if (promptTokens.length === 0) {
      return 0;
    }

    let overlap = 0;
    for (const token of promptTokens) {
      if (responseTokens.has(token)) {
        overlap += 1;
      }
    }

    return Math.min(20, Math.floor((overlap / promptTokens.length) * 20));
  }
}

function tokenize(input: string): string[] {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9_\s-]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 2);
}
