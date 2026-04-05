import path from "path";
import { ProviderId } from "./types";

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
      model: partial.providerDefaults?.model ?? "qwen2.5-coder:7b",
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
  };
}
