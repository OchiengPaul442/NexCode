import { ProviderId } from "../types";

interface EffortConfig {
  supportsEffort: boolean;
}

const OLLAMA_THINKING_MODELS = [
  "qwen3",
  "deepseek-r1",
  "deepseek-r1",
  "glm-5",
  "kimi-k2",
];

const OPENAI_EFFORT_MODELS = [
  "o1",
  "o3",
  "o4",
  "deepseek-r1",
  "deepseek-v4",
  "qwen3",
  "glm-5",
  "kimi-k2",
  "mimo",
];

export function getModelEffortConfig(model: string, provider: ProviderId): EffortConfig {
  const lower = model.toLowerCase();

  if (provider === "ollama") {
    return { supportsEffort: OLLAMA_THINKING_MODELS.some((m) => lower.includes(m)) };
  }

  if (provider === "openai-compatible") {
    return { supportsEffort: OPENAI_EFFORT_MODELS.some((m) => lower.includes(m)) };
  }

  return { supportsEffort: false };
}
