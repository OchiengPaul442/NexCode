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

  public async generate(request: ModelRequest): Promise<ModelResponse> {
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
  }

  public async *stream(request: ModelRequest): AsyncGenerator<string> {
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
