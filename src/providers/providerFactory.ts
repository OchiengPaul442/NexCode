import * as vscode from "vscode";
import { Provider } from "./provider";

export function createProviderFromPulseConfig(): Provider {
  const config = vscode.workspace.getConfiguration("pulse");
  let providerName = config.get<string>("provider") || "ollama";
  const ollamaBase = config.get<string>("ollamaBaseUrl") || undefined;
  const ollamaModel = config.get<string>("ollamaModel") || undefined;
  const openaiBase = config.get<string>("openaiBaseUrl") || undefined;
  const openaiKey = config.get<string>("openaiApiKey") || undefined;
  const openaiModel = config.get<string>("openaiModel") || undefined;

  if (providerName === "openai" && !openaiKey) {
    void vscode.window.showWarningMessage(
      "OpenAI is selected but no API key is configured (pulse.openaiApiKey). Falling back to Ollama.",
    );
    providerName = "ollama";
  }

  if (providerName === "openai") {
    // lazy require to avoid loading network libs at module import time
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { OpenAIAdapter } = require("./openaiAdapter");
    return new OpenAIAdapter(openaiBase, openaiKey, openaiModel);
  }

  // default to Ollama
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { OllamaAdapter } = require("./ollamaAdapter");
  return new OllamaAdapter(ollamaBase, ollamaModel);
}

export default createProviderFromPulseConfig;
