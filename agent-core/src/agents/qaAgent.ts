import { AgentResult } from "../types";
import { ModelRouter } from "../providers/modelRouter";
import { PromptStore } from "../prompts/promptStore";
import { AgentRunInput, runSpecialistAgent } from "./shared";

export class QaAgent {
  public constructor(
    private readonly router: ModelRouter,
    private readonly prompts: PromptStore,
  ) {}

  public run(input: AgentRunInput): Promise<AgentResult> {
    return runSpecialistAgent("qa", this.router, this.prompts, input);
  }
}
