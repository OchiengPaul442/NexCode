import { AgentMode, AgentResult, ChatMessage, ProviderId } from "../types";
import { ModelRouter } from "../providers/modelRouter";
import { PromptStore } from "../prompts/promptStore";

export interface AgentRunInput {
  userPrompt: string;
  workspaceContext?: string;
  memoryContext?: string;
  plan?: string;
  implementationDraft?: string;
  provider?: ProviderId;
  model?: string;
}

export async function runSpecialistAgent(
  mode: AgentMode,
  router: ModelRouter,
  prompts: PromptStore,
  input: AgentRunInput,
): Promise<AgentResult> {
  const systemPrompt = await prompts.getPrompt(mode);

  const parts = [
    `User request:\n${input.userPrompt}`,
    input.plan ? `Planner output:\n${input.plan}` : "",
    input.implementationDraft
      ? `Coder output:\n${input.implementationDraft}`
      : "",
    input.workspaceContext
      ? `Workspace context:\n${input.workspaceContext}`
      : "",
    input.memoryContext ? `Memory context:\n${input.memoryContext}` : "",
  ].filter((part) => part.length > 0);

  const messages: ChatMessage[] = [
    {
      role: "system",
      content: systemPrompt,
    },
    {
      role: "user",
      content: parts.join("\n\n"),
    },
  ];

  const response = await router.generate(messages, {
    provider: input.provider,
    model: input.model,
    complexity: input.userPrompt.length > 1200 ? "large" : "small",
  });

  return {
    agent: mode,
    content: response.text.trim(),
  };
}
