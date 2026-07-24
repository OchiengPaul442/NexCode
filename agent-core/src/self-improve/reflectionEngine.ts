import { type InteractionFeedback } from "../types";

export class ReflectionEngine {
  public score(
    prompt: string,
    response: string,
    acceptedEdits: number,
    rejectedEdits: number,
    diagnosticsCount: number = 0,
    hasErrors: boolean = false,
  ): InteractionFeedback {
    const base = 50;

    // Response length bonus: reward substantive responses, penalize very short ones
    const responseLength = response.length;
    let responseLengthBonus: number;
    if (responseLength < 50) {
      responseLengthBonus = -5; // Penalty for empty/trivial responses
    } else if (responseLength < 200) {
      responseLengthBonus = 5;
    } else {
      responseLengthBonus = Math.min(20, Math.floor(responseLength / 200));
    }

    // Prompt coverage: how well the response addresses the prompt
    const promptCoverageBonus = this.estimatePromptCoverage(prompt, response);

    // Edit signal: weighted by acceptance/rejection
    const editSignal = acceptedEdits * 8 - rejectedEdits * 12;

    // Error penalty: diagnostics indicate issues
    const errorPenalty = hasErrors ? -10 : 0;
    const diagnosticPenalty = Math.min(0, -diagnosticsCount * 2);

    // Prompt-response alignment: penalize responses that are much shorter than prompts
    const alignmentRatio = prompt.length > 0 ? response.length / prompt.length : 1;
    const alignmentBonus = alignmentRatio > 0.5 ? Math.min(5, Math.floor(alignmentRatio * 3)) : -3;

    const score = Math.max(
      0,
      Math.min(
        100,
        base + responseLengthBonus + promptCoverageBonus + editSignal + errorPenalty + diagnosticPenalty + alignmentBonus,
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
