import { ModelProvider, ModelRequest, ModelResponse } from "../types";

interface OpenAIMessage {
  role: string;
  content: string;
}

interface OpenAIChoice {
  message?: OpenAIMessage;
}

interface OpenAIStreamChoice {
  delta?: {
    content?: string;
  };
}

interface OpenAIStreamChunk {
  choices?: OpenAIStreamChoice[];
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

  private createAbortController(
    signal: AbortSignal | undefined,
    timeoutMs: number,
  ): { controller: AbortController; clear: () => void } {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort("timeout"), timeoutMs);

    const onAbort = () => controller.abort("upstream-abort");
    if (signal) {
      if (signal.aborted) {
        controller.abort("upstream-abort");
      } else {
        signal.addEventListener("abort", onAbort, { once: true });
      }
    }

    return {
      controller,
      clear: () => {
        clearTimeout(timer);
        if (signal) {
          signal.removeEventListener("abort", onAbort);
        }
      },
    };
  }

  public async generate(request: ModelRequest): Promise<ModelResponse> {
    if (!this.apiKey) {
      throw new Error("OpenAI-compatible provider requires an API key.");
    }

    const abort = this.createAbortController(request.signal, 90_000);

    try {
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
        signal: abort.controller.signal,
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
    } finally {
      abort.clear();
    }
  }

  public async *stream(request: ModelRequest): AsyncGenerator<string> {
    if (!this.apiKey) {
      throw new Error("OpenAI-compatible provider requires an API key.");
    }

    const abort = this.createAbortController(request.signal, 120_000);

    try {
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
          stream: true,
        }),
        signal: abort.controller.signal,
      });

      if (!response.ok || !response.body) {
        const body = await response.text();
        throw new Error(
          `OpenAI-compatible stream failed (${response.status}): ${body}`,
        );
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const rawLine of lines) {
          const line = rawLine.trim();
          if (!line || !line.startsWith("data:")) {
            continue;
          }

          const payload = line.slice(5).trim();
          if (!payload || payload === "[DONE]") {
            continue;
          }

          try {
            const chunk = JSON.parse(payload) as OpenAIStreamChunk;
            const token = chunk.choices?.[0]?.delta?.content;
            if (token) {
              yield token;
            }
          } catch {
            // Ignore malformed stream chunks and continue.
          }
        }
      }

      const trailing = buffer.trim();
      if (trailing.startsWith("data:")) {
        const payload = trailing.slice(5).trim();
        if (payload && payload !== "[DONE]") {
          try {
            const chunk = JSON.parse(payload) as OpenAIStreamChunk;
            const token = chunk.choices?.[0]?.delta?.content;
            if (token) {
              yield token;
            }
          } catch {
            // Ignore trailing parse failures.
          }
        }
      }
    } finally {
      abort.clear();
    }
  }
}
