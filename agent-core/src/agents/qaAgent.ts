import { type AgentResult } from "../types";
import { type ModelRouter } from "../providers/modelRouter";
import { type PromptStore } from "../prompts/promptStore";
import { type AgentRunInput, runSpecialistAgent } from "./shared";

export class QaAgent {
  public constructor(
    private readonly router: ModelRouter,
    private readonly prompts: PromptStore,
  ) {}

  public run(input: AgentRunInput): Promise<AgentResult> {
    return runSpecialistAgent("qa", this.router, this.prompts, input);
  }
}
