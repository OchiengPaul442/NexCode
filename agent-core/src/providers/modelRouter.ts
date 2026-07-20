import {
  ModelProvider,
  ProviderGenerateOptions,
  ProviderId,
  ChatMessage,
  ModelResponse,
} from "../types";
import { ContextCache } from "../utils/contextCache";

const CLOUD_PROVIDERS: ProviderId[] = ["openai-compatible", "huggingface", "openrouter", "together", "fireworks", "groq", "nvidia", "baseten"];

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
  } else if (/qwen2\.5-coder:(32b|14b|7b)|nemotron-mini/.test(lower)) {
    contextWindow = 32_768;
  }

  return { hasThinking, hasToolCalling, contextWindow };
}

interface RouteCandidate {
  providerId: ProviderId;
  provider: ModelProvider;
  model: string;
}

/**
 * A single entry in the user-controlled fallback chain. Each entry specifies
 * which provider and model to try next when the previous attempt fails.
 *
 * Cross-provider fallback is only used when the user explicitly populates
 * this array. The default (empty array) means "same-provider fallback only".
 */
export interface FallbackCandidate {
  providerId: ProviderId;
  model: string;
  /** Optional human-readable label for error messages (e.g. "cloud fallback"). */
  label?: string;
}

/**
 * Per-candidate failure record captured during generate()/stream() so the
 * final error message can report exactly what was tried and why each failed.
 */
export interface CandidateFailure {
  providerId: ProviderId;
  model: string;
  label?: string;
  error: string;
  /** HTTP status code when available, otherwise undefined. */
  statusCode?: number;
}

export interface ModelRouterConfig {
  defaultProvider: ProviderId;
  defaultModel: string;
  defaultCloudModel: string;
  /**
   * Ordered list of fallback candidates tried after the primary provider
   * and its default model. Each entry is tried only if all previous
   * candidates failed. The list is empty by default, meaning no
   * cross-provider fallback occurs (safe default — never sends one
   * provider's credential to another unless the user explicitly opts in).
   *
   * Example: if the user selects ollama with model "qwen3:8b" and the
   * primary attempt fails, the router would try:
   *   1. ollama / qwen3:8b  (explicit)
   *   2. ollama / defaultModel  (same-provider default)
   *   3. fallbackCandidates[0].providerId / fallbackCandidates[0].model
   *   4. fallbackCandidates[1] ...
   */
  fallbackCandidates?: FallbackCandidate[];
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
      (CLOUD_PROVIDERS.includes(selectedProviderId)
        ? this.config.defaultCloudModel
        : this.config.defaultModel);

    return {
      provider,
      model,
    };
  }

  /**
   * Build the ordered list of provider/model candidates to attempt.
   *
   * Order of precedence:
   *   1. User-selected provider + explicit model (if any)
   *   2. Same-provider default model (cloud or local, depending on provider)
   *   3. User-configured fallback candidates (only when the user explicitly
   *      populates `config.fallbackCandidates` — never cross-provider by default)
   *
   * Cross-provider fallback is a deliberate opt-in: without it, one provider's
   * credential is never sent to a different provider's endpoint (NC-001/NC-013).
   */
  public resolveCandidates(
    options: ProviderGenerateOptions = {},
  ): RouteCandidate[] {
    const candidates: RouteCandidate[] = [];
    const selectedProviderId = this.selectProvider(options);

    const addCandidate = (
      providerId: ProviderId,
      model: string,
      label?: string,
    ): void => {
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

    // 1. Explicit model on the selected provider
    const explicitModel = options.model?.trim();
    if (explicitModel) {
      addCandidate(selectedProviderId, explicitModel);
    }

    // 2. Same-provider default model (cloud vs local distinction)
    const sameProviderDefault = CLOUD_PROVIDERS.includes(selectedProviderId)
      ? this.config.defaultCloudModel
      : this.config.defaultModel;
    addCandidate(selectedProviderId, sameProviderDefault);

    // 3. User-configured cross-provider fallback candidates.
    //    This is empty by default — cross-provider fallback only occurs when
    //    the user explicitly populates the list (NC-013 / NC-001 containment).
    const fallbacks = this.config.fallbackCandidates;
    if (Array.isArray(fallbacks)) {
      for (const fb of fallbacks) {
        addCandidate(fb.providerId, fb.model, fb.label);
      }
    }

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
    const failures: CandidateFailure[] = [];

    for (const candidate of candidates) {
      try {
        const result = await candidate.provider.generate({
          model: candidate.model,
          messages,
          temperature: options.temperature,
          maxTokens: options.maxTokens,
          signal: options.signal,
          tools: options.tools,
          reasoningEffort: options.reasoningEffort,
        });

        // NC-025: Do not cache action-producing responses.  Responses that
        // include tool calls (edits, file writes, terminal commands) reference
        // workspace state that may change within the TTL window.  Caching them
        // risks returning stale edit proposals or file content that no longer
        // matches the current workspace.
        const hasToolCalls = Array.isArray(result.toolCalls) && result.toolCalls.length > 0;
        if (!hasToolCalls) {
          this.responseCache.set(cacheKey, JSON.stringify(result));
        }
        return result;
      } catch (error) {
        if (this.isAbortError(error)) {
          throw error;
        }

        const errMsg = error instanceof Error ? error.message : String(error ?? "Unknown error");
        const statusCode = this.extractStatusCode(error);
        failures.push({
          providerId: candidate.providerId,
          model: candidate.model,
          error: errMsg,
          statusCode,
        });
      }
    }

    throw this.buildFinalError(failures);
  }

  public async *stream(
    messages: ChatMessage[],
    options: ProviderGenerateOptions = {},
  ): AsyncGenerator<string> {
    const candidates = this.resolveCandidates(options);
    const failures: CandidateFailure[] = [];

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
            reasoningEffort: options.reasoningEffort,
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
          reasoningEffort: options.reasoningEffort,
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

        const errMsg = error instanceof Error ? error.message : String(error ?? "Unknown error");
        const statusCode = this.extractStatusCode(error);
        failures.push({
          providerId: candidate.providerId,
          model: candidate.model,
          error: errMsg,
          statusCode,
        });
      }
    }

    throw this.buildFinalError(failures);
  }

  private selectProvider(options: ProviderGenerateOptions): ProviderId {
    if (options.provider) {
      return options.provider;
    }

    // Check if any cloud provider is available
    if (options.complexity === "large") {
      for (const cp of CLOUD_PROVIDERS) {
        if (this.providers[cp]) return cp;
      }
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

  /**
   * Attempt to extract an HTTP status code from a provider error. Returns
   * undefined when the error does not carry a numeric status.
   */
  private extractStatusCode(error: unknown): number | undefined {
    if (error && typeof error === "object") {
      const obj = error as Record<string, unknown>;
      if (typeof obj.status === "number") return obj.status;
      if (typeof obj.statusCode === "number") return obj.statusCode;
    }
    const msg = String(error ?? "");
    const match = msg.match(/\b(4\d{2}|5\d{2})\b/);
    return match ? Number(match[1]) : undefined;
  }

  /**
   * Build a detailed error message from per-candidate failure records.
   * The message lists every candidate that was tried, the reason each failed,
   * and provides category-specific troubleshooting guidance. This replaces the
   * old generic "All provider/model attempts failed" message that implied
   * broader fallback than actually existed.
   */
  private buildFinalError(failures: CandidateFailure[]): Error {
    const summaryLines = failures.map((f, i) => {
      const label = f.label ? ` (${f.label})` : "";
      const status = f.statusCode != null ? ` [HTTP ${f.statusCode}]` : "";
      return `  ${i + 1}. ${f.providerId}/${f.model}${label}: ${f.error}${status}`;
    });

    const attempted = failures.map(f => `${f.providerId}/${f.model}`).join(", ");
    const lastFailure = failures[failures.length - 1];
    const lastError = lastFailure?.error ?? "Unknown error";

    let troubleshooting = "";
    if (lastError.includes("ECONNREFUSED") || lastError.includes("upstream") || lastError.includes("fetch")) {
      troubleshooting = "\n\nTroubleshooting:\n- Check if your provider is running and accessible\n- Verify the base URL in settings\n- Check your network connection";
    } else if (lastError.includes("401") || lastError.includes("403") || lastError.includes("unauthorized") || lastError.includes("api key")) {
      troubleshooting = "\n\nTroubleshooting:\n- Verify your API key is correct\n- Check if your API key has sufficient permissions";
    } else if (lastError.includes("429") || lastError.includes("rate limit")) {
      troubleshooting = "\n\nTroubleshooting:\n- You've hit rate limits. Wait a moment and try again\n- Consider using a different model or provider";
    } else if (lastError.includes("timeout")) {
      troubleshooting = "\n\nTroubleshooting:\n- The request timed out. Try a simpler prompt\n- Check your network connection";
    }

    const detail = summaryLines.length > 1
      ? `\n\nAttempts (${failures.length}):\n${summaryLines.join("\n")}`
      : "";

    return new Error(
      `All ${failures.length} provider/model attempt(s) failed (${attempted}): ${lastError}${detail}${troubleshooting}`,
    );
  }
}
