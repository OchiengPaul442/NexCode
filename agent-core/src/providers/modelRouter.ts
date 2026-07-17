import {
  ModelProvider,
  ProviderGenerateOptions,
  ProviderId,
  ChatMessage,
  ModelResponse,
} from "../types";
import { ContextCache } from "../utils/contextCache";

export interface ModelCapabilities {
  hasThinking: boolean;
  hasToolCalling: boolean;
  contextWindow: number;
}

export function detectModelCapabilities(
  model: string,
  provider?: ProviderId,
): ModelCapabilities {
  const lower = model.toLowerCase();

  const thinkingModels = [
    "claude",
    "deepseek-r1",
    "qwen3",
    "o1",
    "o3",
    "glm-5",
    "kimi-k2",
  ];
  const hasThinking = thinkingModels.some((m) => lower.includes(m));

  const toolModels = [
    "qwen",
    "deepseek",
    "gpt",
    "claude",
    "glm",
    "llama",
    "mimo",
  ];
  const hasToolCalling = toolModels.some((m) => lower.includes(m));

  let contextWindow = 64_000;
  if (
    /deepseek-v4|deepseek-r1|mimo-v2\.5|glm-5|kimi-k2|qwen3|gpt-4|gpt-4o|claude|llama-3\.3/.test(
      lower,
    )
  ) {
    contextWindow = 128_000;
  } else if (/qwen2\.5-coder:14b|qwen2\.5-coder:7b|nemotron-mini/.test(lower)) {
    contextWindow = 32_768;
  }

  return { hasThinking, hasToolCalling, contextWindow };
}

interface RouteCandidate {
  providerId: ProviderId;
  provider: ModelProvider;
  model: string;
}

export interface ModelRouterConfig {
  defaultProvider: ProviderId;
  defaultModel: string;
  defaultCloudModel: string;
}

export class ModelRouter {
  private responseCache = new ContextCache(10000);

  public constructor(
    private readonly providers: Record<ProviderId, ModelProvider>,
    private readonly config: ModelRouterConfig,
  ) {}

  public async checkProviders(): Promise<Record<ProviderId, { ok: boolean; error?: string; models?: string[] }>> {
    const results: Record<string, { ok: boolean; error?: string; models?: string[] }> = {};
    for (const [id, provider] of Object.entries(this.providers)) {
      if ("checkConnection" in provider && typeof provider.checkConnection === "function") {
        results[id] = await (provider as any).checkConnection();
      } else {
        results[id] = { ok: true };
      }
    }
    return results as Record<ProviderId, { ok: boolean; error?: string; models?: string[] }>;
  }

  public resolve(options: ProviderGenerateOptions): {
    provider: ModelProvider;
    model: string;
  } {
    const selectedProviderId = this.selectProvider(options);
    const provider = this.providers[selectedProviderId];

    if (!provider) {
      throw new Error(`Provider ${selectedProviderId} is not configured.`);
    }

    const model =
      options.model ??
      (selectedProviderId === "openai-compatible"
        ? this.config.defaultCloudModel
        : this.config.defaultModel);

    return {
      provider,
      model,
    };
  }

  public resolveCandidates(
    options: ProviderGenerateOptions = {},
  ): RouteCandidate[] {
    const candidates: RouteCandidate[] = [];
    const selectedProviderId = this.selectProvider(options);

    const addCandidate = (providerId: ProviderId, model: string): void => {
      const provider = this.providers[providerId];
      const normalizedModel = model.trim();
      if (!provider || !normalizedModel) {
        return;
      }

      const exists = candidates.some(
        (candidate) =>
          candidate.providerId === providerId &&
          candidate.model === normalizedModel,
      );
      if (exists) {
        return;
      }

      candidates.push({
        providerId,
        provider,
        model: normalizedModel,
      });
    };

    const explicitModel = options.model?.trim();
    if (explicitModel) {
      addCandidate(selectedProviderId, explicitModel);
    }

    const sameProviderDefault =
      selectedProviderId === "openai-compatible"
        ? this.config.defaultCloudModel
        : this.config.defaultModel;
    addCandidate(selectedProviderId, sameProviderDefault);

    // Only add alternate provider as fallback if explicitly requested
    // This prevents unnecessary fallback to openai-compatible when ollama is selected

    return candidates;
  }

  public async generate(
    messages: ChatMessage[],
    options: ProviderGenerateOptions = {},
  ): Promise<ModelResponse> {
    const { signal, ...cacheableOptions } = options;
    const cacheKey = JSON.stringify({ messages, options: cacheableOptions });
    const cached = this.responseCache.get(cacheKey);
    if (cached) return JSON.parse(cached);

    const candidates = this.resolveCandidates(options);
    let lastError: unknown;

    for (const candidate of candidates) {
      try {
        const result = await candidate.provider.generate({
          model: candidate.model,
          messages,
          temperature: options.temperature,
          maxTokens: options.maxTokens,
          signal: options.signal,
          tools: options.tools,
        });
        this.responseCache.set(cacheKey, JSON.stringify(result));
        return result;
      } catch (error) {
        if (this.isAbortError(error)) {
          throw error;
        }

        lastError = error;
      }
    }

    const attempted = candidates.map(c => `${c.providerId}/${c.model}`).join(", ");
    const errorMsg = lastError instanceof Error ? lastError.message : String(lastError ?? "Unknown error");

    let troubleshooting = "";
    if (errorMsg.includes("ECONNREFUSED") || errorMsg.includes("upstream") || errorMsg.includes("fetch")) {
      troubleshooting = "\n\nTroubleshooting:\n- Check if your provider is running and accessible\n- Verify the base URL in settings\n- Check your network connection";
    } else if (errorMsg.includes("401") || errorMsg.includes("403") || errorMsg.includes("unauthorized") || errorMsg.includes("api key")) {
      troubleshooting = "\n\nTroubleshooting:\n- Verify your API key is correct\n- Check if your API key has sufficient permissions";
    } else if (errorMsg.includes("429") || errorMsg.includes("rate limit")) {
      troubleshooting = "\n\nTroubleshooting:\n- You've hit rate limits. Wait a moment and try again\n- Consider using a different model or provider";
    } else if (errorMsg.includes("timeout")) {
      troubleshooting = "\n\nTroubleshooting:\n- The request timed out. Try a simpler prompt\n- Check your network connection";
    }

    throw new Error(
      `All provider/model attempts failed (${attempted}): ${errorMsg}${troubleshooting}`,
    );
  }

  public async *stream(
    messages: ChatMessage[],
    options: ProviderGenerateOptions = {},
  ): AsyncGenerator<string> {
    const candidates = this.resolveCandidates(options);
    let lastError: unknown;

    for (const candidate of candidates) {
      let emittedAnyToken = false;

      try {
        if (!candidate.provider.stream) {
          const result = await candidate.provider.generate({
            model: candidate.model,
            messages,
            temperature: options.temperature,
            maxTokens: options.maxTokens,
            signal: options.signal,
            tools: options.tools,
          });

          if (result.text) {
            emittedAnyToken = true;
            yield result.text;
          }
          return;
        }

        for await (const token of candidate.provider.stream({
          model: candidate.model,
          messages,
          temperature: options.temperature,
          maxTokens: options.maxTokens,
          signal: options.signal,
          tools: options.tools,
        })) {
          if (!token) {
            continue;
          }

          emittedAnyToken = true;
          yield token;
        }
        return;
      } catch (error) {
        if (this.isAbortError(error)) {
          throw error;
        }

        // Do not attempt fallback after partial stream output to avoid mixed responses.
        if (emittedAnyToken) {
          throw error;
        }

        lastError = error;
      }
    }

    const attempted = candidates.map(c => `${c.providerId}/${c.model}`).join(", ");
    const errorMsg = lastError instanceof Error ? lastError.message : String(lastError ?? "Unknown error");

    let troubleshooting = "";
    if (errorMsg.includes("ECONNREFUSED") || errorMsg.includes("upstream") || errorMsg.includes("fetch")) {
      troubleshooting = "\n\nTroubleshooting:\n- Check if your provider is running and accessible\n- Verify the base URL in settings\n- Check your network connection";
    } else if (errorMsg.includes("401") || errorMsg.includes("403") || errorMsg.includes("unauthorized") || errorMsg.includes("api key")) {
      troubleshooting = "\n\nTroubleshooting:\n- Verify your API key is correct\n- Check if your API key has sufficient permissions";
    } else if (errorMsg.includes("429") || errorMsg.includes("rate limit")) {
      troubleshooting = "\n\nTroubleshooting:\n- You've hit rate limits. Wait a moment and try again\n- Consider using a different model or provider";
    } else if (errorMsg.includes("timeout")) {
      troubleshooting = "\n\nTroubleshooting:\n- The request timed out. Try a simpler prompt\n- Check your network connection";
    }

    throw new Error(
      `All provider/model attempts failed (${attempted}): ${errorMsg}${troubleshooting}`,
    );
  }

  private selectProvider(options: ProviderGenerateOptions): ProviderId {
    if (options.provider) {
      return options.provider;
    }

    if (options.complexity === "large" && this.providers["openai-compatible"]) {
      return "openai-compatible";
    }

    return this.config.defaultProvider;
  }

  private isAbortError(error: unknown): boolean {
    if (typeof DOMException !== "undefined" && error instanceof DOMException) {
      return error.name === "AbortError";
    }

    const message = String(error ?? "").toLowerCase();
    return message.includes("abort");
  }
}
