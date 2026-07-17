import path from "path";
import { AgentMode, ProviderId } from "./types";

export const MODE_TEMPERATURES: Record<AgentMode, number> = {
  auto: 0.2,
  planner: 0.3,
  coder: 0.15,
  reviewer: 0.05,
  qa: 0.05,
  security: 0.1,
};

// Mode to role mapping for multi-agent model selection
const MODE_TO_ROLE: Record<Exclude<AgentMode, "auto">, keyof AgentModels> = {
  planner: "manager",
  coder: "primaryWorker",
  reviewer: "reasoningReviewer",
  qa: "lightweightWorker",
  security: "reasoningReviewer",
};

export interface AgentModels {
  manager?: string;
  primaryWorker?: string;
  lightweightWorker?: string;
  reasoningReviewer?: string;
}

export interface RuntimeConfig {
  workspaceRoot: string;
  promptsDir: string;
  memoryDir: string;
  providerDefaults: {
    provider: ProviderId;
    model: string;
    ollamaBaseUrl: string;
    openAIBaseUrl: string;
    openAIApiKey?: string;
  };
  toolDefaults: {
    tavilyApiKey?: string;
    tavilyBaseUrl: string;
  };
  modeTemperatures?: Partial<Record<AgentMode, number>>;
  agentModels?: AgentModels;
}

export function getTemperatureForMode(
  mode: AgentMode,
  overrides?: Partial<Record<AgentMode, number>>,
): number {
  return overrides?.[mode] ?? MODE_TEMPERATURES[mode] ?? 0.2;
}

export function getModelForMode(
  mode: AgentMode,
  agentModels?: AgentModels,
  defaultModel?: string,
): string {
  if (mode === "auto") {
    return agentModels?.primaryWorker ?? defaultModel ?? "qwen2.5-coder:14b";
  }
  const role = MODE_TO_ROLE[mode];
  return agentModels?.[role] ?? defaultModel ?? "qwen2.5-coder:14b";
}

export function createRuntimeConfig(
  partial: Partial<RuntimeConfig> & { workspaceRoot?: string } = {},
): RuntimeConfig {
  const workspaceRoot = partial.workspaceRoot ?? process.cwd();

  return {
    workspaceRoot,
    promptsDir: partial.promptsDir ?? path.join(workspaceRoot, "prompts"),
    memoryDir: partial.memoryDir ?? path.join(workspaceRoot, "memory"),
    providerDefaults: {
      provider: partial.providerDefaults?.provider ?? "ollama",
      model: partial.providerDefaults?.model ?? "qwen2.5-coder:14b",
      ollamaBaseUrl:
        partial.providerDefaults?.ollamaBaseUrl ?? "http://localhost:11434",
      openAIBaseUrl:
        partial.providerDefaults?.openAIBaseUrl ?? "https://api.openai.com/v1",
      openAIApiKey:
        partial.providerDefaults?.openAIApiKey ?? process.env.OPENAI_API_KEY,
    },
    toolDefaults: {
      tavilyApiKey:
        partial.toolDefaults?.tavilyApiKey ?? process.env.TAVILY_API_KEY,
      tavilyBaseUrl:
        partial.toolDefaults?.tavilyBaseUrl ?? "https://api.tavily.com/search",
    },
    modeTemperatures: partial.modeTemperatures,
    agentModels: partial.agentModels,
  };
}
