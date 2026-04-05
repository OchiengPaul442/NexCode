import { ModelProvider, ModelRequest, ModelResponse } from "../types";

interface OpenAIMessage {
  role: string;
  content: string;
}

interface OpenAIChoice {
  message?: OpenAIMessage;
}

interface OpenAIChatResponse {
  choices?: OpenAIChoice[];
}

export class OpenAICompatibleProvider implements ModelProvider {
  public readonly id = "openai-compatible" as const;

  public constructor(
    private readonly baseUrl: string,
    private readonly apiKey?: string,
  ) {}

  public async generate(request: ModelRequest): Promise<ModelResponse> {
    if (!this.apiKey) {
      throw new Error("OpenAI-compatible provider requires an API key.");
    }

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: request.model,
        messages: request.messages,
        temperature: request.temperature ?? 0.2,
        max_tokens: request.maxTokens,
        stream: false,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(
        `OpenAI-compatible request failed (${response.status}): ${body}`,
      );
    }

    const json = (await response.json()) as OpenAIChatResponse;
    const text = json.choices?.[0]?.message?.content ?? "";

    return {
      text,
      raw: json,
    };
  }

  public async *stream(request: ModelRequest): AsyncGenerator<string> {
    const response = await this.generate(request);

    const tokens = response.text
      .split(/(\s+)/)
      .filter((token) => token.length > 0);
    for (const token of tokens) {
      yield token;
    }
  }
}
