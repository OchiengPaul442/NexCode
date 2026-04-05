import { AgentResult } from "../types";
import { ModelRouter } from "../providers/modelRouter";
import { PromptStore } from "../prompts/promptStore";
import { AgentRunInput, runSpecialistAgent } from "./shared";

export class ReviewerAgent {
  public constructor(
    private readonly router: ModelRouter,
    private readonly prompts: PromptStore,
  ) {}

  public run(input: AgentRunInput): Promise<AgentResult> {
    return runSpecialistAgent("reviewer", this.router, this.prompts, input);
  }
}
