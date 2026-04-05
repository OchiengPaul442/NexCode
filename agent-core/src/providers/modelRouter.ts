import {
  ModelProvider,
  ProviderGenerateOptions,
  ProviderId,
  ChatMessage,
  ModelResponse,
} from "../types";

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

  public async generate(
    messages: ChatMessage[],
    options: ProviderGenerateOptions = {},
  ): Promise<ModelResponse> {
    const { provider, model } = this.resolve(options);
    return provider.generate({
      model,
      messages,
    });
  }

  public async *stream(
    messages: ChatMessage[],
    options: ProviderGenerateOptions = {},
  ): AsyncGenerator<string> {
    const { provider, model } = this.resolve(options);
    if (!provider.stream) {
      const result = await provider.generate({
        model,
        messages,
      });
      yield result.text;
      return;
    }

    for await (const token of provider.stream({
      model,
      messages,
    })) {
      yield token;
    }
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
}
