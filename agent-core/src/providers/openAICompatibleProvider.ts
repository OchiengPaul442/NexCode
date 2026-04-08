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

  private createHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (this.apiKey?.trim()) {
      headers.Authorization = `Bearer ${this.apiKey.trim()}`;
    }

    return headers;
  }

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

  private resolveTimeoutMs(kind: "generate" | "stream"): number {
    const envOverride = Number(process.env.NEXCODE_PROVIDER_TIMEOUT_MS ?? "");
    if (Number.isFinite(envOverride) && envOverride > 0) {
      return envOverride;
    }

    if (process.env.NODE_ENV === "test") {
      return kind === "stream" ? 2_200 : 1_800;
    }

    return kind === "stream" ? 600_000 : 300_000;
  }

  public async generate(request: ModelRequest): Promise<ModelResponse> {
    const abort = this.createAbortController(
      request.signal,
      this.resolveTimeoutMs("generate"),
    );

    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: this.createHeaders(),
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
    const abort = this.createAbortController(
      request.signal,
      this.resolveTimeoutMs("stream"),
    );

    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: this.createHeaders(),
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
