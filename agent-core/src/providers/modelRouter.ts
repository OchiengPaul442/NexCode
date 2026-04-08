import {
  ModelProvider,
  ProviderGenerateOptions,
  ProviderId,
  ChatMessage,
  ModelResponse,
} from "../types";

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
  public constructor(
    private readonly providers: Record<ProviderId, ModelProvider>,
    private readonly config: ModelRouterConfig,
  ) {}

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

    if (!options.provider) {
      const alternateProviderId: ProviderId =
        selectedProviderId === "ollama" ? "openai-compatible" : "ollama";
      const alternateDefault =
        alternateProviderId === "openai-compatible"
          ? this.config.defaultCloudModel
          : this.config.defaultModel;
      addCandidate(alternateProviderId, alternateDefault);
    }

    return candidates;
  }

  public async generate(
    messages: ChatMessage[],
    options: ProviderGenerateOptions = {},
  ): Promise<ModelResponse> {
    const candidates = this.resolveCandidates(options);
    let lastError: unknown;

    for (const candidate of candidates) {
      try {
        return await candidate.provider.generate({
          model: candidate.model,
          messages,
          temperature: options.temperature,
          maxTokens: options.maxTokens,
          signal: options.signal,
        });
      } catch (error) {
        if (this.isAbortError(error)) {
          throw error;
        }

        lastError = error;
      }
    }

    throw new Error(
      `All provider/model attempts failed: ${String(lastError ?? "Unknown error")}`,
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

    throw new Error(
      `All stream attempts failed: ${String(lastError ?? "Unknown error")}`,
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
