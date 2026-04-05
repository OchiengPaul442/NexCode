import {
  ChatMessage,
  ModelProvider,
  ModelRequest,
  ModelResponse,
} from "../types";

interface OllamaChatResponse {
  message?: {
    role?: string;
    content?: string;
  };
  response?: string;
}

export class OllamaProvider implements ModelProvider {
  public readonly id = "ollama" as const;

  public constructor(private readonly baseUrl: string) {}

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
    const abort = this.createAbortController(request.signal, 300_000);
    try {
      const payload = {
        model: request.model,
        messages: request.messages,
        stream: false,
        options: {
          temperature: request.temperature ?? 0.2,
          num_predict: request.maxTokens,
        },
      };

      const response = await fetch(`${this.baseUrl}/api/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
        signal: abort.controller.signal,
      });

      if (!response.ok) {
        const body = await response.text();
        throw new Error(`Ollama request failed (${response.status}): ${body}`);
      }

      const json = (await response.json()) as OllamaChatResponse;
      const text = json.message?.content ?? json.response ?? "";

      return {
        text,
        raw: json,
      };
    } finally {
      abort.clear();
    }
  }

  public async *stream(request: ModelRequest): AsyncGenerator<string> {
    const abort = this.createAbortController(request.signal, 600_000);
    try {
      const payload = {
        model: request.model,
        messages: request.messages,
        stream: true,
        options: {
          temperature: request.temperature ?? 0.2,
          num_predict: request.maxTokens,
        },
      };

      const response = await fetch(`${this.baseUrl}/api/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
        signal: abort.controller.signal,
      });

      if (!response.ok || !response.body) {
        throw new Error(`Ollama stream failed (${response.status}).`);
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

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) {
            continue;
          }

          const json = JSON.parse(trimmed) as OllamaChatResponse;
          const token = json.message?.content ?? json.response;
          if (token) {
            yield token;
          }
        }
      }

      const trailing = buffer.trim();
      if (trailing) {
        try {
          const json = JSON.parse(trailing) as OllamaChatResponse;
          const token = json.message?.content ?? json.response;
          if (token) {
            yield token;
          }
        } catch {
          // Ignore trailing parse errors from partial transport chunks.
        }
      }
    } finally {
      abort.clear();
    }
  }
}

export function toOllamaMessages(
  messages: ChatMessage[],
): Array<{ role: string; content: string }> {
  return messages.map((message) => ({
    role: message.role,
    content: message.content,
  }));
}
