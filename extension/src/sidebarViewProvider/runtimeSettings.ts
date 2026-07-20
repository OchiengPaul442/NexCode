import * as vscode from "vscode";
import {
  type AgentMode,
  type ProviderId,
  validateProviderUrl as validateProviderUrlCore,
} from "@nexcode/agent-core";
import { type SecretService } from "../secretService";

export interface RuntimeSettings {
  provider: ProviderId;
  model: string;
  mode: AgentMode;
  ollamaBaseUrl: string;
  openAIBaseUrl: string;
  openAIApiKeyConfigured: boolean;
  tavilyApiKeyConfigured: boolean;
  allowTools: boolean;
  requireTerminalApproval: boolean;
  toolApproval: "auto" | "ask";
  temperature: number;
  modeTemperatures: Record<string, number>;
  agentModels: { manager?: string; primaryWorker?: string; lightweightWorker?: string; reasoningReviewer?: string };
  showReasoning: boolean;
  autoApplyChanges: boolean;
  allowWebSearch: boolean;
  searchProvider: string;
  searchApiKeyConfigured: boolean;
  searchBaseUrl: string;
}

export function normalizeOllamaBaseUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    return "http://localhost:11434";
  }

  const candidate = trimmed.replace(/\/$/, "");

  try {
    const url = new URL(candidate);
    if (/^(?:www\.)?ollama\.com$/i.test(url.hostname)) {
      return "http://localhost:11434";
    }

    return candidate;
  } catch {
    if (/^(?:www\.)?ollama\.com(?::\d+)?(?:\/.*)?$/i.test(candidate)) {
      return "http://localhost:11434";
    }

    return candidate.startsWith("http://") || candidate.startsWith("https://")
      ? candidate
      : `http://${candidate}`;
  }
}

export function validateProviderUrl(rawUrl: string): string {
  return validateProviderUrlCore(rawUrl);
}

export async function getRuntimeSettings(
  secretService: SecretService,
): Promise<RuntimeSettings> {
  const config = vscode.workspace.getConfiguration("nexcodeKiboko");
  const secrets = await secretService.getAllSecrets();

  return {
    provider: config.get<ProviderId>("defaultProvider", "ollama"),
    model: config.get<string>("defaultModel", "gpt-oss:120b-cloud"),
    mode: config.get<AgentMode>("defaultMode", "auto"),
    ollamaBaseUrl: normalizeOllamaBaseUrl(
      config.get<string>("ollamaBaseUrl", "http://localhost:11434"),
    ),
    openAIBaseUrl: validateProviderUrl(
      config.get<string>(
        "openAIBaseUrl",
        "https://opencode.ai/zen/go/v1",
      ),
    ),
    openAIApiKeyConfigured: !!secrets.openAIApiKey.trim(),
    tavilyApiKeyConfigured: !!secrets.tavilyApiKey.trim(),
    allowTools: config.get<boolean>("allowToolCommands", true),
    requireTerminalApproval: config.get<boolean>(
      "requireTerminalApproval",
      true,
    ),
    toolApproval: ((): "auto" | "ask" => {
      const raw = config.get<string>("toolApproval", "ask");
      return raw === "auto" ? "auto" : "ask";
    })(),
    temperature: config.get<number>("temperature", 0.2),
    modeTemperatures: config.get<Record<string, number>>(
      "modeTemperatures",
      { planner: 0.3, coder: 0.15, reviewer: 0.05, qa: 0.05, security: 0.1 },
    ),
    agentModels: {
      manager: config.get<string>("agentModels.manager", ""),
      primaryWorker: config.get<string>("agentModels.primaryWorker", ""),
      lightweightWorker: config.get<string>("agentModels.lightweightWorker", ""),
      reasoningReviewer: config.get<string>("agentModels.reasoningReviewer", ""),
    },
    showReasoning: config.get<boolean>("showReasoning", false),
    autoApplyChanges: config.get<boolean>("autoApplyChanges", false),
    allowWebSearch: config.get<boolean>("allowWebSearch", true),
    searchProvider: config.get<string>("searchProvider", "tavily"),
    searchApiKeyConfigured: !!secrets.searchApiKey.trim(),
    searchBaseUrl: config.get<string>("searchBaseUrl", ""),
  };
}

export async function getRawApiKeys(
  secretService: SecretService,
): Promise<{
  openAIApiKey: string;
  searchApiKey: string;
  tavilyApiKey: string;
}> {
  return secretService.getAllSecrets();
}
