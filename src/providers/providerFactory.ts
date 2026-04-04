import { ConfigManager } from "../config";
import { OllamaAdapter } from "./ollamaAdapter";
import { OpenAIAdapter } from "./openaiAdapter";

type StreamCallbacks = {
  onConnected?: () => void;
  onStart?: () => void;
  onToken?: (t: string) => void;
  onEnd?: () => void;
  onError?: (err: any) => void;
};

export function createProviderFromPulseConfig() {
  const providerName = (
    ConfigManager.get<string>("provider") || "ollama"
  ).toLowerCase();
  if (providerName === "openai") {
    const url =
      ConfigManager.get<string>("openaiBaseUrl") ?? "https://api.openai.com";
    const model = ConfigManager.get<string>("openaiModel") ?? "gpt-4o";
    const adapter = new OpenAIAdapter(url, model);
    return createStreamWrapper(adapter);
  }

  const url =
    ConfigManager.get<string>("ollamaBaseUrl") ?? "http://localhost:11434";
  const model = ConfigManager.get<string>("ollamaModel") ?? "llama2";
  const adapter = new OllamaAdapter(url, model);
  return createStreamWrapper(adapter);
}

function createStreamWrapper(adapter: any) {
  return {
    streamCompletion: (
      prompt: string,
      model: string | undefined,
      callbacks: StreamCallbacks,
    ) => {
      const ac = new AbortController();
      try {
        callbacks.onConnected && callbacks.onConnected();
      } catch (e) {}
      (async () => {
        try {
          for await (const chunk of adapter.chat(
            [{ role: "user", content: prompt }],
            { signal: ac.signal },
          )) {
            callbacks.onToken && callbacks.onToken(String(chunk));
          }
          callbacks.onEnd && callbacks.onEnd();
        } catch (err) {
          callbacks.onError && callbacks.onError(err);
        }
      })();
      return {
        cancel: () => {
          try {
            ac.abort();
          } catch (e) {}
          callbacks.onEnd && callbacks.onEnd();
        },
      };
    },
  };
}
