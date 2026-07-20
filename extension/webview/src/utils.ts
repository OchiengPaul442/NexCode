// ── Webview Utility Functions ───────────────────────────────────────────────
// Extracted from main.tsx for NC-036: monolithic file splitting.
// Pure functions with no React or runtime side-effect dependencies.

import type {
  AgentMode,
  UiMode,
  Session,
  ChatMessage,
  ActivityStatus,
  ReasoningEffort,
  SidebarSettings,
  SearchProviderId,
  ProviderId,
  ModelEffortInfo,
} from "./types";

// ── Provider presets for cloud AI services ─────────────────────────────────
export const providerPresets: Record<string, { name: string; baseUrl: string; apiKeyPlaceholder: string; hint: string }> = {
  "ollama": { name: "Ollama (Local)", baseUrl: "http://localhost:11434/v1", apiKeyPlaceholder: "Not needed", hint: "No API key required for local Ollama" },
  "openai-compatible": { name: "OpenAI Compatible", baseUrl: "", apiKeyPlaceholder: "Your API key", hint: "Enter your API key" },
  "huggingface": { name: "Hugging Face", baseUrl: "https://router.huggingface.co/v1", apiKeyPlaceholder: "hf_xxx", hint: "Get a free key at huggingface.co/settings/tokens" },
  "openrouter": { name: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", apiKeyPlaceholder: "sk-or-xxx", hint: "Get a key at openrouter.ai/keys" },
  "together": { name: "Together AI", baseUrl: "https://api.together.ai/v1", apiKeyPlaceholder: "Your Together API key", hint: "Get a key at api.together.xyz/settings/api-keys" },
  "fireworks": { name: "Fireworks AI", baseUrl: "https://api.fireworks.ai/inference/v1", apiKeyPlaceholder: "Your Fireworks API key", hint: "Get a key at fireworks.ai" },
  "groq": { name: "GroqCloud", baseUrl: "https://api.groq.com/openai/v1", apiKeyPlaceholder: "gsk_xxx", hint: "Get a free key at console.groq.com" },
  "nvidia": { name: "NVIDIA NIM", baseUrl: "https://integrate.api.nvidia.com/v1", apiKeyPlaceholder: "nvapi-xxx", hint: "Get a key at build.nvidia.com" },
  "baseten": { name: "Baseten", baseUrl: "https://inference.baseten.co/v1", apiKeyPlaceholder: "Your Baseten API key", hint: "Get a key at baseten.co" },
};

// ── NC-003: Legacy secret field stripping ──────────────────────────────────
export const LEGACY_SECRET_KEYS = [
  "openAIApiKey",
  "searchApiKey",
  "tavilyApiKey",
];

export function stripSecretsFromSettings(
  settings: SidebarSettings | undefined,
): SidebarSettings {
  if (!settings) {
    // NC-003: Return safe defaults if settings are missing.
    return {
      temperature: 0.2,
      autoApprove: false,
      autoApplyChanges: false,
      requireTerminalApproval: true,
      showDebugPanel: false,
      enableWebSearch: true,
      permissionLevel: "default",
    };
  }
  const clean = { ...settings };
  for (const key of LEGACY_SECRET_KEYS) {
    delete (clean as Record<string, unknown>)[key];
  }
  return clean;
}

// ── ID generation ──────────────────────────────────────────────────────────
export function makeId(prefix: string): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return `${prefix}-${crypto.randomUUID()}`;
  }

  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

// ── Session utilities ──────────────────────────────────────────────────────
export function titleFromPrompt(prompt: string): string {
  const clean = prompt.replace(/\s+/g, " ").trim();
  if (!clean) {
    return "New Chat";
  }

  return clean.length > 52 ? `${clean.slice(0, 52)}...` : clean;
}

export function createSession(defaults: {
  provider: ProviderId;
  model: string;
  mode: UiMode;
}): Session {
  const now = Date.now();
  return {
    id: makeId("session"),
    title: "New Chat",
    createdAt: now,
    updatedAt: now,
    provider: defaults.provider,
    model: defaults.model,
    mode: defaults.mode,
    messages: [],
  };
}

// ── Mode mapping ───────────────────────────────────────────────────────────
export function mapAgentModeToUi(mode: AgentMode): UiMode {
  switch (mode) {
    case "planner":
      return "plan";
    case "coder":
    case "reviewer":
    case "qa":
    case "security":
      return "agent";
    default:
      return "agent";
  }
}

export function mapUiModeToAgent(mode: UiMode): AgentMode {
  switch (mode) {
    case "agent":
      return "coder";
    case "plan":
      return "planner";
    case "ask":
      return "auto";
    default:
      return "auto";
  }
}

// ── Formatting utilities ───────────────────────────────────────────────────
export function sanitizeReasoningStatus(raw: string): string {
  const clean = raw.replace(/\s+/g, " ").trim();
  if (!clean) {
    return "";
  }

  const modeMeta = clean.match(
    /^mode:\s*([^|]+)\|\s*provider:\s*([^|]+)\|\s*model:\s*(.+)$/i,
  );
  if (modeMeta) {
    const [, mode, provider, model] = modeMeta;
    return `Using ${model.trim()} on ${provider.trim()} (${mode.trim()} mode)`;
  }

  return clean;
}

export function formatAgentMode(mode?: AgentMode): string {
  switch (mode) {
    case "planner":
      return "Planner";
    case "coder":
      return "Coder";
    case "reviewer":
      return "Reviewer";
    case "qa":
      return "QA";
    case "security":
      return "Security";
    case "auto":
      return "Auto";
    default:
      return "Agent";
  }
}

export function formatUiMode(mode: UiMode): string {
  switch (mode) {
    case "agent":
      return "Auto";
    case "plan":
      return "Plan";
    case "ask":
      return "Ask";
    default:
      return "Agent";
  }
}

export function formatRelativeTime(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) {
    return "just now";
  }

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }

  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function getTimeAgo(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  const weeks = Math.floor(diff / 604800000);

  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  if (hours < 24) return `${hours}h`;
  if (days < 7) return `${days}d`;
  return `${weeks}w`;
}

// ── Activity status utilities ──────────────────────────────────────────────
export function isRunningActivityStatus(status: ActivityStatus): boolean {
  return status === "in-progress" || status === "pending";
}

export function activityStatusLabel(status: ActivityStatus): string {
  switch (status) {
    case "pending":
      return "Pending";
    case "not-started":
      return "Queued";
    case "in-progress":
      return "Running";
    case "completed":
      return "Done";
    case "failed":
      return "Failed";
    case "viewed":
      return "Viewed";
    case "modified":
      return "Changed";
    default:
      return "Status";
  }
}

export function activityStatusClass(status: ActivityStatus): string {
  switch (status) {
    case "pending":
      return "nk-activity-status--not-started";
    case "in-progress":
      return "nk-activity-status--in-progress";
    case "completed":
      return "nk-activity-status--completed";
    case "failed":
      return "nk-activity-status--failed";
    case "viewed":
      return "nk-activity-status--viewed";
    case "modified":
      return "nk-activity-status--modified";
    default:
      return "nk-activity-status--not-started";
  }
}

// ── Model capabilities and effort configuration ────────────────────────────
export const modelCapabilities: Record<string, { inputs: string[]; reasoning: boolean; context: string; provider?: string }> = {
  // Ollama local models
  'qwen2.5-coder:14b': { inputs: ['text'], reasoning: false, context: '32K', provider: 'ollama' },
  'qwen2.5-coder:7b': { inputs: ['text'], reasoning: false, context: '32K', provider: 'ollama' },
  'qwen2.5-coder:3b': { inputs: ['text'], reasoning: false, context: '32K', provider: 'ollama' },
  'qwen3:8b': { inputs: ['text'], reasoning: true, context: '32K', provider: 'ollama' },
  'deepseek-r1:8b': { inputs: ['text'], reasoning: true, context: '64K', provider: 'ollama' },
  // Cloud models (OpenAI-compatible)
  'deepseek-v4-flash': { inputs: ['text'], reasoning: true, context: '128K', provider: 'openai-compatible' },
  'deepseek-v4-pro': { inputs: ['text'], reasoning: true, context: '128K', provider: 'openai-compatible' },
  'mimo-v2.5': { inputs: ['text'], reasoning: true, context: '128K', provider: 'openai-compatible' },
  'mimo-v2.5-pro': { inputs: ['text'], reasoning: true, context: '128K', provider: 'openai-compatible' },
  'glm-5.2': { inputs: ['text'], reasoning: true, context: '200K', provider: 'openai-compatible' },
  'glm-5.1': { inputs: ['text'], reasoning: true, context: '200K', provider: 'openai-compatible' },
  'kimi-k2.7-code': { inputs: ['text'], reasoning: false, context: '128K', provider: 'openai-compatible' },
  'kimi-k2.6': { inputs: ['text'], reasoning: false, context: '128K', provider: 'openai-compatible' },
  'minimax-m3': { inputs: ['text'], reasoning: false, context: '128K', provider: 'openai-compatible' },
  'gpt-4o': { inputs: ['text', 'image'], reasoning: false, context: '128K', provider: 'openai-compatible' },
  'gpt-4o-mini': { inputs: ['text', 'image'], reasoning: false, context: '128K', provider: 'openai-compatible' },
  'claude-3.5-sonnet': { inputs: ['text', 'image'], reasoning: false, context: '200K', provider: 'openai-compatible' },
  'claude-3-opus': { inputs: ['text', 'image'], reasoning: true, context: '200K', provider: 'openai-compatible' },
};

export const modelEffortConfig: Record<string, ModelEffortInfo> = {
  'deepseek-r1:8b': { supportsEffort: true, levels: ["none", "low", "medium", "high", "max"], default: "medium" },
  'deepseek-r1:14b': { supportsEffort: true, levels: ["none", "low", "medium", "high", "max"], default: "medium" },
  'deepseek-r1:32b': { supportsEffort: true, levels: ["none", "low", "medium", "high", "max"], default: "medium" },
  'deepseek-r1:70b': { supportsEffort: true, levels: ["none", "low", "medium", "high", "max"], default: "medium" },
  'qwen3:8b': { supportsEffort: true, levels: ["none", "low", "medium", "high", "max"], default: "medium" },
  'qwen3:14b': { supportsEffort: true, levels: ["none", "low", "medium", "high", "max"], default: "medium" },
  'qwen3:32b': { supportsEffort: true, levels: ["none", "low", "medium", "high", "max"], default: "medium" },
  'o1': { supportsEffort: true, levels: ["low", "medium", "high"], default: "medium" },
  'o1-mini': { supportsEffort: true, levels: ["low", "medium", "high"], default: "medium" },
  'o3': { supportsEffort: true, levels: ["low", "medium", "high"], default: "medium" },
  'o3-mini': { supportsEffort: true, levels: ["low", "medium", "high"], default: "medium" },
  'o4-mini': { supportsEffort: true, levels: ["low", "medium", "high"], default: "medium" },
};

export function getModelEffortInfo(model?: string): ModelEffortInfo | null {
  if (!model) return null;
  const normalized = model.toLowerCase().trim();
  if (modelEffortConfig[normalized]) return modelEffortConfig[normalized];
  if (/^o[134]|^gpt-5/.test(normalized)) {
    return { supportsEffort: true, levels: ["low", "medium", "high"], default: "medium" };
  }
  if (/claude/.test(normalized)) {
    return { supportsEffort: true, levels: ["low", "medium", "high", "max"], default: "medium" };
  }
  if (/deepseek/.test(normalized)) {
    return { supportsEffort: true, levels: ["none", "low", "medium", "high", "max"], default: "high" };
  }
  if (/gemini/.test(normalized)) {
    return { supportsEffort: true, levels: ["none", "low", "medium", "high"], default: "medium" };
  }
  return null;
}

export const effortLabels: Record<ReasoningEffort, string> = {
  none: "Off",
  low: "Low",
  medium: "Balanced",
  high: "High",
  max: "Max",
};

export function hasThinkingCapability(model?: string): boolean {
  if (!model) return false;
  return /claude|deepseek-r1|deepseek-v4|qwen3|o1|o3|glm-5|kimi-k2|mimo/i.test(model);
}

// ── Attachment utilities ───────────────────────────────────────────────────
export function estimateAttachmentKind(file: File): "text" | "image" | "binary" {
  const name = file.name.toLowerCase();
  if (file.type.startsWith("image/")) {
    return "image";
  }

  if (
    file.type.startsWith("text/") ||
    name.endsWith(".md") ||
    name.endsWith(".json") ||
    name.endsWith(".yaml") ||
    name.endsWith(".yml") ||
    name.endsWith(".ts") ||
    name.endsWith(".tsx") ||
    name.endsWith(".js") ||
    name.endsWith(".jsx") ||
    name.endsWith(".py") ||
    name.endsWith(".java") ||
    name.endsWith(".go") ||
    name.endsWith(".rs") ||
    name.endsWith(".txt")
  ) {
    return "text";
  }

  return "binary";
}

export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunk = 0x8000;

  for (let index = 0; index < bytes.length; index += chunk) {
    const slice = bytes.subarray(index, index + chunk);
    binary += String.fromCharCode(...slice);
  }

  return btoa(binary);
}

// ── Slash command parsing ──────────────────────────────────────────────────
export function parseSlashCommand(
  rawPrompt: string,
  mode: UiMode,
): { prompt: string; mode: AgentMode } {
  const trimmed = rawPrompt.trim();
  const defaultMode = mapUiModeToAgent(mode);

  if (/^\/(tool|edit)\b/i.test(trimmed)) {
    return {
      prompt: trimmed,
      mode: defaultMode,
    };
  }

  const slashMatch = trimmed.match(
    /^\/(plan|code|fix|test|explain)\b\s*(.*)$/is,
  );
  if (!slashMatch) {
    return {
      prompt: trimmed,
      mode: defaultMode,
    };
  }

  const command = slashMatch[1].toLowerCase();
  const body = slashMatch[2].trim();

  switch (command) {
    case "plan":
      return {
        prompt: body || "Create an implementation plan for this task.",
        mode: "planner",
      };
    case "code":
      return {
        prompt:
          body || "Implement the requested change with clean code and tests.",
        mode: "coder",
      };
    case "fix":
      return {
        prompt: body || "Identify root cause and provide a robust fix.",
        mode: "reviewer",
      };
    case "test":
      return {
        prompt: body || "Create a focused test strategy and test cases.",
        mode: "qa",
      };
    case "explain":
      return {
        prompt: body || "Explain the current code path and trade-offs clearly.",
        mode: "coder",
      };
    default:
      return {
        prompt: trimmed,
        mode: defaultMode,
      };
  }
}

// ── Session message utilities ──────────────────────────────────────────────
export function findRetryPromptForMessage(
  session: Session,
  messageId: string,
): string | null {
  const idx = session.messages.findIndex((message) => message.id === messageId);
  if (idx < 0) {
    return null;
  }

  for (let pointer = idx; pointer >= 0; pointer -= 1) {
    const candidate = session.messages[pointer];
    if (candidate.role === "user" && candidate.text.trim()) {
      return candidate.text;
    }
  }

  return null;
}

// ── Token utilities ────────────────────────────────────────────────────────
export function inferContextWindow(model: string): number {
  const normalized = model.toLowerCase().trim();

  if (/qwen2\.5-coder:14b/.test(normalized)) {
    return 32_768;
  }

  if (/qwen2\.5-coder:7b|nemotron-mini/.test(normalized)) {
    return 32_768;
  }

  if (
    /deepseek-v4|deepseek-r1|mimo-v2\.5|glm-5|kimi-k2|qwen3|gpt-4|gpt-4o|claude|llama-3\.3/.test(
      normalized,
    )
  ) {
    return 128_000;
  }

  return 64_000;
}

export function formatTokenCount(value: number): string {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M`;
  }

  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(1)}K`;
  }

  return String(value);
}

// ── Search provider helpers ────────────────────────────────────────────────
export function getSearchProviderPlaceholder(provider: SearchProviderId): string {
  switch (provider) {
    case "tavily":
      return "Search the web...";
    case "serpapi":
      return "Search with SerpAPI...";
    case "serper":
      return "Search with Serper...";
    case "bing":
      return "Search with Bing...";
    case "duckduckgo":
      return "Search with DuckDuckGo...";
    case "custom":
      return "Search...";
    default:
      return "Search...";
  }
}

export function getSearchProviderHint(provider: SearchProviderId): string {
  switch (provider) {
    case "tavily":
      return "Requires a Tavily API key in settings.";
    case "serpapi":
      return "Requires a SerpAPI key in settings.";
    case "serper":
      return "Requires a Serper API key in settings.";
    case "bing":
      return "Requires a Bing Search API key in settings.";
    case "duckduckgo":
      return "No API key required.";
    case "custom":
      return "Uses a custom search endpoint.";
    default:
      return "";
  }
}

export function getSearchProviderUrlPlaceholder(provider: SearchProviderId): string {
  switch (provider) {
    case "tavily":
      return "https://api.tavily.com/search";
    case "serpapi":
      return "https://serpapi.com/search";
    case "serper":
      return "https://google.serper.dev/search";
    case "bing":
      return "https://api.bing.microsoft.com/v7.0/search";
    case "duckduckgo":
      return "https://api.duckduckgo.com";
    case "custom":
      return "https://your-search-api.com/search";
    default:
      return "";
  }
}
