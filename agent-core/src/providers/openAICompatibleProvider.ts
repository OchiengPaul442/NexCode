import {
  ModelProvider,
  ModelRequest,
  ModelResponse,
  ToolCallRequest,
} from "../types";

interface OpenAIMessage {
  role: string;
  content: string;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: {
      name: string;
      arguments: string;
    };
  }>;
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
  private readonly maxRetryAttempts = 3;

  public constructor(
    private readonly baseUrl: string,
    private readonly apiKey?: string,
  ) {}

  private isOpenCodeGo(): boolean {
    return this.baseUrl.includes("opencode.ai");
  }

  private validateModel(model: string): void {
    if (!this.isOpenCodeGo()) {
      return;
    }
    const validModels = [
      "deepseek-v4-flash",
      "deepseek-v4-pro",
      "mimo-v2.5",
      "mimo-v2.5-pro",
      "glm-5.2",
      "glm-5.1",
      "kimi-k2.7-code",
      "kimi-k2.6",
      "qwen3-coder",
    ];
    const lower = model.toLowerCase();
    const isValid = validModels.some((m) => lower.includes(m));
    if (!isValid) {
      throw new Error(
        `Model "${model}" is not available on OpenCode Go. Use one of: ${validModels.join(", ")}`,
      );
    }
  }

  private shouldRetryStatus(status: number): boolean {
    return [408, 409, 425, 429, 500, 502, 503, 504].includes(status);
  }

  private resolveRetryDelayMs(response: Response, attempt: number): number {
    const retryAfter = response.headers.get("retry-after");
    if (retryAfter) {
      const asNumber = Number(retryAfter.trim());
      if (Number.isFinite(asNumber) && asNumber > 0) {
        return Math.min(20_000, Math.round(asNumber * 1_000));
      }

      const parsedDate = Date.parse(retryAfter);
      if (!Number.isNaN(parsedDate)) {
        return Math.min(20_000, Math.max(250, parsedDate - Date.now()));
      }
    }

    return Math.min(8_000, 400 * 2 ** (attempt - 1));
  }

  private async wait(ms: number, signal: AbortSignal): Promise<void> {
    if (ms <= 0) {
      return;
    }

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        signal.removeEventListener("abort", onAbort);
        resolve();
      }, ms);

      const onAbort = () => {
        clearTimeout(timeout);
        reject(new Error("Request aborted."));
      };

      if (signal.aborted) {
        onAbort();
        return;
      }

      signal.addEventListener("abort", onAbort, { once: true });
    });
  }

  private async fetchWithRetries(
    url: string,
    initFactory: () => RequestInit,
    signal: AbortSignal,
  ): Promise<Response> {
    let lastResponse: Response | undefined;

    for (let attempt = 1; attempt <= this.maxRetryAttempts; attempt += 1) {
      if (signal.aborted) {
        throw new Error("Request aborted.");
      }

      const response = await fetch(url, {
        ...initFactory(),
        signal,
      });

      if (
        !this.shouldRetryStatus(response.status) ||
        attempt === this.maxRetryAttempts
      ) {
        return response;
      }

      lastResponse = response;
      await this.wait(this.resolveRetryDelayMs(response, attempt), signal);
    }

    if (lastResponse) {
      return lastResponse;
    }

    throw new Error("OpenAI-compatible request failed without response.");
  }

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
      this.validateModel(request.model);

      const body: any = {
        model: request.model,
        messages: request.messages,
        temperature: request.temperature ?? 0.2,
        max_tokens: request.maxTokens,
        stream: false,
      };

      if (request.tools && request.tools.length > 0) {
        body.tools = request.tools.map((tool) => ({
          type: "function",
          function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.inputSchema,
          },
        }));
      }

      const response = await this.fetchWithRetries(
        `${this.baseUrl}/chat/completions`,
        () => ({
          method: "POST",
          headers: this.createHeaders(),
          body: JSON.stringify(body),
        }),
        abort.controller.signal,
      );

      if (!response.ok) {
        const responseBody = await response.text();
        let errorMsg = `Provider returned status ${response.status}`;
        try {
          const errorJson = JSON.parse(responseBody);
          if (errorJson.error?.message) {
            errorMsg = errorJson.error.message;
          }
        } catch {
          if (responseBody && responseBody.length < 300) {
            errorMsg = responseBody;
          }
        }
        throw new Error(
          `${errorMsg}. Check your provider settings (model, API key, base URL).`,
        );
      }

      const json = (await response.json()) as OpenAIChatResponse;

      if (json.choices?.[0]?.message?.tool_calls) {
        const toolCalls: ToolCallRequest[] =
          json.choices[0].message.tool_calls.map((tc) => ({
            id: tc.id,
            type: "function" as const,
            function: {
              name: tc.function.name,
              arguments: tc.function.arguments,
            },
          }));
        return {
          text: json.choices[0].message.content || "",
          toolCalls,
          raw: json,
        };
      }

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
      this.validateModel(request.model);

      const response = await this.fetchWithRetries(
        `${this.baseUrl}/chat/completions`,
        () => ({
          method: "POST",
          headers: this.createHeaders(),
          body: JSON.stringify({
            model: request.model,
            messages: request.messages,
            temperature: request.temperature ?? 0.2,
            max_tokens: request.maxTokens,
            stream: true,
          }),
        }),
        abort.controller.signal,
      );

      if (!response.ok || !response.body) {
        const body = await response.text();
        let errorMsg = `Provider returned status ${response.status}`;
        try {
          const errorJson = JSON.parse(body);
          if (errorJson.error?.message) {
            errorMsg = errorJson.error.message;
          }
        } catch {
          if (body && body.length < 300) {
            errorMsg = body;
          }
        }
        throw new Error(
          `${errorMsg}. Check your provider settings (model, API key, base URL).`,
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
