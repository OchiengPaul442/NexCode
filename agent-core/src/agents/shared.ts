import { AgentMode, AgentResult, ChatMessage, ProviderId } from "../types";
import { ModelRouter } from "../providers/modelRouter";
import { PromptStore } from "../prompts/promptStore";

const FILE_REFERENCE_PATTERN =
  /(?:^|[\s("'`])(?:[A-Za-z]:\\|\.\.?\/|\/)?[A-Za-z0-9._/-]+\.(?:ts|tsx|js|jsx|mjs|cjs|json|md|py|java|cs|go|rb|rs|php|html|css|scss|yml|yaml|xml|sh|ps1|c|cpp|h|hpp|swift|kt)\b/i;

export interface AgentRunInput {
  userPrompt: string;
  workspaceContext?: string;
  memoryContext?: string;
  plan?: string;
  implementationDraft?: string;
  provider?: ProviderId;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
}

export function getAgentMaxTokens(mode: AgentMode, userPrompt: string): number {
  const normalizedLength = userPrompt.trim().length;
  const lengthBoost =
    normalizedLength > 3000
      ? 600
      : normalizedLength > 1500
        ? 300
        : normalizedLength > 600
          ? 150
          : 0;

  const baseByMode: Record<AgentMode, number> = {
    auto: 1400,
    planner: 1100,
    coder: 1800,
    reviewer: 1000,
    qa: 1000,
    security: 1050,
  };

  return Math.min(2400, baseByMode[mode] + lengthBoost);
}

export async function runSpecialistAgent(
  mode: AgentMode,
  router: ModelRouter,
  prompts: PromptStore,
  input: AgentRunInput,
): Promise<AgentResult> {
  const systemPrompt = await prompts.getPrompt(mode);
  const groundingNote = buildGroundingNoteForMode(mode, input.userPrompt);

  const parts = [
    `User request:\n${input.userPrompt}`,
    groundingNote ? `Grounding note:\n${groundingNote}` : "",
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
    temperature: input.temperature,
    maxTokens: input.maxTokens ?? getAgentMaxTokens(mode, input.userPrompt),
    complexity: input.userPrompt.length > 1200 ? "large" : "small",
    signal: input.signal,
  });

  const content = normalizeAgentOutputForMode(
    mode,
    response.text.trim(),
    input.userPrompt,
  );

  return {
    agent: mode,
    content,
  };
}

export function buildGroundingNoteForMode(
  mode: AgentMode,
  userPrompt: string,
): string {
  const hasInlineCode = /```/.test(userPrompt);
  const hasExplicitFileReference = FILE_REFERENCE_PATTERN.test(userPrompt);

  if (mode === "reviewer" && hasInlineCode && !hasExplicitFileReference) {
    return [
      "The code under review is a provided inline snippet.",
      "Do not invent file paths or line numbers.",
      "Use 'provided snippet' or 'inline snippet' as the finding location.",
    ].join(" ");
  }

  if ((mode === "planner" || mode === "qa") && !hasExplicitFileReference) {
    return [
      "No concrete file paths were provided in the request.",
      "If you suggest files or components, clearly mark them as proposed rather than existing.",
    ].join(" ");
  }

  return "";
}

export function normalizeAgentOutputForMode(
  mode: AgentMode,
  content: string,
  userPrompt: string,
): string {
  const hasInlineCode = /```/.test(userPrompt);
  const hasExplicitFileReference = FILE_REFERENCE_PATTERN.test(userPrompt);

  if (mode !== "reviewer" || !hasInlineCode || hasExplicitFileReference) {
    return content;
  }

  let normalized = content
    .replace(
      /`[^`\n]+\.(?:ts|tsx|js|jsx|mjs|cjs|json|md|py|java|cs|go|rb|rs|php|html|css|scss|yml|yaml|xml|sh|ps1|c|cpp|h|hpp|swift|kt)`/gi,
      "`provided snippet`",
    )
    .replace(/\s*\(Assuming this is the file path[^)]*\)/gi, "")
    .replace(/\bassuming this is the file path[^\n.]*/gi, "");

  if (!/provided snippet/i.test(normalized)) {
    normalized = normalized.replace(
      /(\*\*Location\*\*:\s*)(`[^`]+`|[^\n-]+)(?=\s*-\s*\*\*Issue Description\*\*|\n|$)/i,
      "$1`provided snippet`",
    );
  }

  return normalized;
}
