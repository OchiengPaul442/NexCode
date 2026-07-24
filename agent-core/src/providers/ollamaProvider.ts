import {
  type ChatMessage,
  type ModelProvider,
  type ModelRequest,
  type ModelResponse,
  type ToolCallRequest,
} from "../types";
import { detectModelCapabilities } from "./modelRouter";
import { getModelEffortConfig } from "../utils/modelEffortConfig";
import {
  TokenCounter,
  MIN_OUTPUT_RESERVE,
  SAFETY_MARGIN,
} from "../utils/tokenCounter";
import { repairTruncatedJson } from "../utils/jsonRepair";

export function isExplicitContextError(message: string): boolean {
  return /context (window|length)|too many tokens|input.*too large|exceeds.*context|prompt.*too long/i.test(message);
}

export function isToolOrJsonParseError(message: string): boolean {
  return /can't find closing|value looks like object|bad character|invalid character|malformed json/i.test(message);
}

export interface ContextBudgetCheck {
  ok: boolean;
  estimated: number;
  budget: number;
  contextWindow: number;
  details: string;
}

interface OllamaToolCall {
  function: {
    name: string;
    arguments: string;
  };
}

interface OllamaChatResponse {
  message?: {
    role?: string;
    content?: string;
    tool_calls?: OllamaToolCall[];
  };
  response?: string;
  prompt_eval_count?: number;
  eval_count?: number;
}

export class OllamaProvider implements ModelProvider {
  public readonly id = "ollama" as const;

  public constructor(private readonly baseUrl: string) {}

  public async checkConnection(): Promise<{ ok: boolean; error?: string; models?: string[] }> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`, {
        method: "GET",
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) {
        return { ok: false, error: `Ollama returned status ${response.status}` };
      }
      const data = await response.json() as { models?: Array<{ name: string }> };
      return { ok: true, models: data.models?.map(m => m.name) ?? [] };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.includes("ECONNREFUSED") || msg.includes("fetch failed")) {
        return { ok: false, error: `Cannot connect to Ollama at ${this.baseUrl}. Is Ollama running? Start it with: ollama serve` };
      }
      return { ok: false, error: `Ollama connection failed: ${msg}` };
    }
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

  private resolveNumCtx(model: string): number {
    const detected = detectModelCapabilities(model, "ollama").contextWindow;
    const envCap = Number(process.env.NEXCODE_OLLAMA_MAX_CONTEXT);
    if (Number.isFinite(envCap) && envCap > 0) {
      return Math.min(detected, envCap);
    }
    return detected;
  }

  public checkContextBudget(request: ModelRequest): ContextBudgetCheck {
    const contextWindow = this.resolveNumCtx(request.model);
    const maxOutputTokens = request.maxTokens ?? MIN_OUTPUT_RESERVE;
    const tokenCounter = new TokenCounter();
    const estimated = tokenCounter.estimateRequestTokens(
      request.messages,
      request.tools,
    );
    const budget = tokenCounter.calculateInputBudget(contextWindow, maxOutputTokens);
    const ok = estimated <= budget;
    const details = [
      `messages: ${request.messages.length}`,
      `tools: ${request.tools?.length ?? 0}`,
      `estimated_tokens: ${estimated}`,
      `budget: ${budget}`,
      `context_window: ${contextWindow}`,
      `output_reserve: ${maxOutputTokens}`,
      `safety_margin: ${SAFETY_MARGIN}`,
      `headroom: ${budget - estimated}`,
    ].join(", ");
    return { ok, estimated, budget, contextWindow, details };
  }

  public async generate(request: ModelRequest): Promise<ModelResponse> {
    const abort = this.createAbortController(
      request.signal,
      this.resolveTimeoutMs("generate"),
    );
    try {
      const payload: any = {
        model: request.model,
        messages: request.messages,
        stream: false,
        options: {
          temperature: request.temperature ?? 0.2,
          num_predict: request.maxTokens,
          num_ctx: this.resolveNumCtx(request.model),
        },
      };

      // Add thinking parameter for Ollama thinking models
      const effortConfig = getModelEffortConfig(request.model, "ollama");
      if (effortConfig.supportsEffort && request.reasoningEffort) {
        const effort = request.reasoningEffort;
        if (effort === "none") {
          payload.think = false;
        } else {
          payload.think = effort;
        }
      }

      if (request.tools && request.tools.length > 0) {
        payload.tools = request.tools.map((tool) => ({
          type: "function",
          function: {
            name: tool.name,
            description: tool.description,
            parameters: this.sanitizeSchema(tool.inputSchema),
          },
        }));
      }

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
        let errorMsg = `Ollama returned status ${response.status}`;
        const errorBody = body;
        try {
          const errorJson = JSON.parse(body);
          if (errorJson.error) {
            errorMsg = `Ollama: ${errorJson.error}`;
          }
        } catch {
          if (body && body.length < 300) {
            errorMsg = `Ollama: ${body}`;
          }
        }

        // Some models can't handle tool definitions and return a JSON parse error.
        // Retry without tools to get a text-only response.
        if (
          isToolOrJsonParseError(errorMsg) &&
          request.tools &&
          request.tools.length > 0
        ) {
          console.warn(`[ollama] tool/JSON parse error, retrying without tools: ${errorMsg}`);
          
          // First, try to extract and repair any partial tool call from the error
          const repairedCall = this.tryRepairFromError(errorBody, request.tools);
          if (repairedCall) {
            console.warn(`[ollama] successfully repaired tool call from error response`);
            return repairedCall;
          }
          
          try {
            return await this.generateWithoutTools(request, abort);
          } catch (_fallbackError) {
            // If fallback also fails, throw a user-friendly error
            throw new Error(`The model ${request.model} couldn't process this request. Try using a different model that better supports tool calling, or simplify your request.`, { cause: _fallbackError });
          }
        }

        if (isExplicitContextError(errorMsg)) {
          errorMsg = `Context window overflow: The request was too large for the model's context window (${this.resolveNumCtx(request.model)} tokens). Try a shorter prompt, a smaller file, or increase NEXCODE_OLLAMA_MAX_CONTEXT. Original error: ${errorMsg}`;
        } else if (isToolOrJsonParseError(errorMsg)) {
          errorMsg = `The model ${request.model} returned an invalid response. This can happen when the model doesn't fully support tool calling. Try switching to a different model (like qwen2.5-coder:14b) or simplifying your request.`;
        }

        console.error(`[ollama] request failed: ${request.messages?.length ?? 0} messages, ${JSON.stringify(payload).length} chars, ${request.tools?.length ?? 0} tools, num_ctx=${this.resolveNumCtx(request.model)}`);
        throw new Error(errorMsg);
      }

      const json = (await response.json()) as OllamaChatResponse;

      if (json.message?.tool_calls) {
        const toolCalls: ToolCallRequest[] = [];
        for (let i = 0; i < json.message.tool_calls.length; i++) {
          const tc = json.message.tool_calls[i];
          // Validate and fix malformed tool call arguments
          let args = tc.function.arguments;
          if (typeof args !== "string") {
            args = JSON.stringify(args);
          }
          // Try to parse to validate, fall back to empty object on failure
          try {
            JSON.parse(args);
          } catch {
            // Malformed arguments from Ollama - try to extract useful parts
            args = this.fixMalformedToolArgs(tc.function.name, args);
          }
          toolCalls.push({
            id: `call_${i}`,
            type: "function" as const,
            function: {
              name: tc.function.name,
              arguments: args,
            },
          });
        }
        return {
          text: json.message.content || "",
          toolCalls,
          raw: json,
          usage: json.prompt_eval_count != null && json.eval_count != null
            ? { promptTokens: json.prompt_eval_count, completionTokens: json.eval_count, totalTokens: json.prompt_eval_count + json.eval_count }
            : undefined,
        };
      }

      // Some Ollama models emit tool calls as JSON in the content text
      // instead of in the structured tool_calls field. Try to detect this.
      const text = json.message?.content ?? json.response ?? "";
      if (text) {
        const extractedCalls = this.extractToolCallsFromText(text);
        if (extractedCalls.length > 0) {
          return {
            text,
            toolCalls: extractedCalls,
            raw: json,
            usage: json.prompt_eval_count != null && json.eval_count != null
              ? { promptTokens: json.prompt_eval_count, completionTokens: json.eval_count, totalTokens: json.prompt_eval_count + json.eval_count }
              : undefined,
          };
        }
      }

      return {
        text,
        raw: json,
        usage: json.prompt_eval_count != null && json.eval_count != null
          ? { promptTokens: json.prompt_eval_count, completionTokens: json.eval_count, totalTokens: json.prompt_eval_count + json.eval_count }
          : undefined,
      };
    } finally {
      abort.clear();
    }
  }

  private fixMalformedToolArgs(toolName: string, rawArgs: string): string {
    // First, try to repair truncated JSON
    const repaired = repairTruncatedJson(rawArgs);
    try {
      const parsed = JSON.parse(repaired);
      if (typeof parsed === "object" && parsed !== null) {
        return JSON.stringify(parsed);
      }
    } catch {
      // Continue with regex-based extraction
    }

    const fixedArgs: Record<string, unknown> = {};

    // Generic field extractors - covers all tool argument patterns
    const pathMatch = rawArgs.match(/["']?(?:path|filePath|file)["']?\s*[:=]\s*["']([^"']+)["']/i);
    const contentMatch = rawArgs.match(/["'](?:content|text)["']?\s*[:=]\s*["']([\s\S]*?)["']/i);
    const commandMatch = rawArgs.match(/["'](?:command|cmd)["']?\s*[:=]\s*["']([\s\S]*?)["']/i);
    const queryMatch = rawArgs.match(/["'](?:query|search)["']?\s*[:=]\s*["']([\s\S]*?)["']/i);
    const sourceMatch = rawArgs.match(/["'](?:source|from|src)["']?\s*[:=]\s*["']([^"']+)["']/i);
    const destMatch = rawArgs.match(/["'](?:destination|to|dest)["']?\s*[:=]\s*["']([^"']+)["']/i);
    const oldTextMatch = rawArgs.match(/["'](?:oldText|old)["']?\s*[:=]\s*["']([\s\S]*?)["']/i);
    const newTextMatch = rawArgs.match(/["'](?:newText|new)["']?\s*[:=]\s*["']([\s\S]*?)["']/i);
    const runnerMatch = rawArgs.match(/["'](?:runner)["']?\s*[:=]\s*["']([^"']+)["']/i);
    const filterMatch = rawArgs.match(/["'](?:filter)["']?\s*[:=]\s*["']([^"']+)["']/i);
    const serverMatch = rawArgs.match(/["'](?:server)["']?\s*[:=]\s*["']([^"']+)["']/i);
    const toolMatch = rawArgs.match(/["'](?:tool)["']?\s*[:=]\s*["']([^"']+)["']/i);
    const inputMatch = rawArgs.match(/["'](?:input)["']?\s*[:=]\s*["']([\s\S]*?)["']/i);

    if (pathMatch) fixedArgs.path = pathMatch[1];
    if (contentMatch) fixedArgs.content = contentMatch[1];
    if (commandMatch) fixedArgs.command = commandMatch[1];
    if (queryMatch) fixedArgs.query = queryMatch[1];
    if (sourceMatch) fixedArgs.source = sourceMatch[1];
    if (destMatch) fixedArgs.destination = destMatch[1];
    if (oldTextMatch) fixedArgs.oldText = oldTextMatch[1];
    if (newTextMatch) fixedArgs.newText = newTextMatch[1];
    if (runnerMatch) fixedArgs.runner = runnerMatch[1];
    if (filterMatch) fixedArgs.filter = filterMatch[1];
    if (serverMatch) fixedArgs.server = serverMatch[1];
    if (toolMatch) fixedArgs.tool = toolMatch[1];
    if (inputMatch) fixedArgs.input = inputMatch[1];

    // For terminal/test, map content to command if no explicit command found
    if ((toolName === "terminal" || toolName === "test") && fixedArgs.content && !fixedArgs.command) {
      fixedArgs.command = fixedArgs.content;
    }

    return JSON.stringify(fixedArgs);
  }

  /**
   * Try to repair and extract a tool call from an error response.
   * Some models generate truncated JSON that Ollama can't serialize,
   * but we might be able to repair it.
   */
  private tryRepairFromError(
    errorBody: string,
    tools: Array<{ name: string }> | undefined,
  ): ModelResponse | null {
    if (!errorBody || !tools || tools.length === 0) {
      return null;
    }

    // Try to extract JSON-like content from the error message
    // The error might contain the partial tool call in the message
    const jsonMatch = errorBody.match(/(\{[\s\S]*$)/);
    if (!jsonMatch) {
      return null;
    }

    const partialJson = jsonMatch[1];
    const repaired = repairTruncatedJson(partialJson);
    
    try {
      const parsed = JSON.parse(repaired);
      
      // Check if it looks like a tool call
      if (parsed.name && typeof parsed.name === "string") {
        const toolName = parsed.name;
        const args = parsed.arguments || parsed.params || {};
        
        // Validate the tool name exists in available tools
        const validTool = tools.find(t => t.name === toolName);
        if (validTool) {
          return {
            text: "",
            toolCalls: [{
              id: `call_repaired_${Date.now()}`,
              type: "function",
              function: {
                name: toolName,
                arguments: typeof args === "string" ? args : JSON.stringify(args),
              },
            }],
          };
        }
      }
    } catch {
      // Repair failed
    }

    return null;
  }

  private extractToolCallsFromText(text: string): ToolCallRequest[] {
    const calls: ToolCallRequest[] = [];

    // Try DSML format first: <| DSML | tool_calls> <| DSML | invoke name="read"> ...
    const dsmlPattern = /<\|\s*\|\s*DSML\s*\|\s*\|\s*tool_calls\s*>/i;
    if (dsmlPattern.test(text)) {
      const invokePattern = /<\|\s*\|\s*DSML\s*\|\s*\|\s*invoke\s+name="([^"]+)"\s*>([\s\S]*?)<\|\s*\|\s*DSML\s*\|\s*\|\s*invoke\s*>/gi;
      let invokeMatch;
      while ((invokeMatch = invokePattern.exec(text)) !== null) {
        const toolName = invokeMatch[1].toLowerCase();
        const body = invokeMatch[2];
        const args: Record<string, string> = {};

        const paramPattern = /<\|\s*\|\s*DSML\s*\|\s*\|\s*parameter\s+name="([^"]+)"[^>]*>([\s\S]*?)<\|\s*\|\s*DSML\s*\|\s*\|\s*parameter\s*>/gi;
        let paramMatch;
        while ((paramMatch = paramPattern.exec(body)) !== null) {
          args[paramMatch[1]] = paramMatch[2].trim();
        }

        if (Object.keys(args).length === 0) {
          const cleanBody = body.replace(/<\|\s*\|\s*DSML\s*\|\s*\|\s*[^>]*>/gi, '').trim();
          if (cleanBody) {
            if (toolName === "terminal" || toolName === "test") args.command = cleanBody;
            else if (toolName === "read" || toolName === "delete") args.path = cleanBody;
            else if (toolName === "write") {
              const sepIdx = cleanBody.indexOf("::");
              args.path = sepIdx !== -1 ? cleanBody.slice(0, sepIdx).trim() : cleanBody;
              if (sepIdx !== -1) args.content = cleanBody.slice(sepIdx + 2).trim();
            } else if (toolName === "search" || toolName === "web-search") args.query = cleanBody;
            else args.path = cleanBody;
          }
        }

        if (Object.keys(args).length > 0) {
          calls.push({
            id: `call_ollama_dsml_${Date.now()}_${calls.length}`,
            type: "function",
            function: { name: toolName, arguments: JSON.stringify(args) },
          });
        }
      }
      if (calls.length > 0) return calls;
    }

    // Try JSON code block: ```json\n{"name": "...", "arguments": {...}}\n```
    const fenceMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
    const content = fenceMatch ? fenceMatch[1] : text;
    const trimmed = content.trim();

    if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
      return calls;
    }

    try {
      const parsed = JSON.parse(trimmed);
      const items = Array.isArray(parsed) ? parsed : [parsed];

      for (const item of items) {
        if (
          item &&
          typeof item.name === "string" &&
          item.arguments &&
          typeof item.arguments === "object"
        ) {
          calls.push({
            id: `call_ollama_text_${Date.now()}_${calls.length}`,
            type: "function",
            function: {
              name: item.name,
              arguments: JSON.stringify(item.arguments),
            },
          });
        }
      }
    } catch {
      // Not valid JSON
    }

    return calls;
  }

  /**
   * Remove empty required arrays from a JSON Schema — some Ollama versions
   * choke on `"required": []` (valid JSON Schema but triggers model parsing bugs).
   */
  private sanitizeSchema(schema: Record<string, unknown>): Record<string, unknown> {
    const cleaned: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(schema)) {
      if (key === "required" && Array.isArray(value) && value.length === 0) {
        continue; // omit empty required array
      }
      if (typeof value === "object" && value !== null && !Array.isArray(value)) {
        cleaned[key] = this.sanitizeSchema(value as Record<string, unknown>);
      } else if (Array.isArray(value)) {
        cleaned[key] = value.map((item) =>
          typeof item === "object" && item !== null
            ? this.sanitizeSchema(item as Record<string, unknown>)
            : item,
        );
      } else {
        cleaned[key] = value;
      }
    }
    return cleaned;
  }

  /**
   * Retry request without tool definitions when the model can't handle them.
   * The model's text response will later be parsed for embedded tool calls.
   */
  private async generateWithoutTools(
    request: ModelRequest,
    abort: { controller: AbortController; clear: () => void },
  ): Promise<ModelResponse> {
    const textPayload = {
      model: request.model,
      messages: request.messages,
      stream: false,
      options: {
        temperature: request.temperature ?? 0.2,
        num_predict: request.maxTokens,
        num_ctx: this.resolveNumCtx(request.model),
      },
    };

    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(textPayload),
      signal: abort.controller.signal,
    });

    if (!response.ok) {
      const body = await response.text();
      let errorMsg = `Ollama returned status ${response.status}`;
      try {
        const errorJson = JSON.parse(body);
        if (errorJson.error) {
          errorMsg = `Ollama: ${errorJson.error}`;
        }
      } catch {
        if (body && body.length < 300) {
          errorMsg = `Ollama: ${body}`;
        }
      }

      if (isExplicitContextError(errorMsg)) {
        errorMsg = `Context window overflow: The request was too large for the model's context window (${this.resolveNumCtx(request.model)} tokens). Try a shorter prompt, a smaller file, or increase NEXCODE_OLLAMA_MAX_CONTEXT. Original error: ${errorMsg}`;
      }

      console.error(`[ollama] generateWithoutTools failed: ${request.messages?.length ?? 0} messages, ${JSON.stringify(textPayload).length} chars, 0 tools, num_ctx=${this.resolveNumCtx(request.model)}`);
      throw new Error(errorMsg);
    }

    const json = (await response.json()) as OllamaChatResponse;
    const text = json.message?.content ?? json.response ?? "";

    // Try to extract tool calls from the text response
    const extractedCalls = this.extractToolCallsFromText(text);
    const usage = json.prompt_eval_count != null && json.eval_count != null
      ? { promptTokens: json.prompt_eval_count, completionTokens: json.eval_count, totalTokens: json.prompt_eval_count + json.eval_count }
      : undefined;
    if (extractedCalls.length > 0) {
      return { text, toolCalls: extractedCalls, raw: json, usage };
    }

    return { text, raw: json, usage };
  }

  public async *stream(request: ModelRequest): AsyncGenerator<string> {
    const abort = this.createAbortController(
      request.signal,
      this.resolveTimeoutMs("stream"),
    );
    try {
      const payload: any = {
        model: request.model,
        messages: request.messages,
        stream: true,
        options: {
          temperature: request.temperature ?? 0.2,
          num_predict: request.maxTokens,
          num_ctx: this.resolveNumCtx(request.model),
        },
      };

      // Add thinking parameter for Ollama thinking models
      const effortConfig = getModelEffortConfig(request.model, "ollama");
      if (effortConfig.supportsEffort && request.reasoningEffort) {
        const effort = request.reasoningEffort;
        if (effort === "none") {
          payload.think = false;
        } else {
          payload.think = effort;
        }
      }

      const response = await fetch(`${this.baseUrl}/api/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
        signal: abort.controller.signal,
      });

      if (!response.ok || !response.body) {
        let errorMsg = `Ollama returned status ${response.status}`;
        try {
          const body = await response.text();
          const errorJson = JSON.parse(body);
          if (errorJson.error) {
            errorMsg = `Ollama: ${errorJson.error}`;
          }
        } catch {
          // Use status-based message
        }

        if (isExplicitContextError(errorMsg)) {
          errorMsg = `Context window overflow: The request was too large for the model's context window (${this.resolveNumCtx(request.model)} tokens). Try a shorter prompt, a smaller file, or increase NEXCODE_OLLAMA_MAX_CONTEXT. Original error: ${errorMsg}`;
        }

        console.error(`[ollama] stream failed: ${request.messages?.length ?? 0} messages, ${JSON.stringify(payload).length} chars, ${request.tools?.length ?? 0} tools, num_ctx=${this.resolveNumCtx(request.model)}`);
        throw new Error(errorMsg);
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

          try {
            const json = JSON.parse(trimmed) as OllamaChatResponse;
            const token = json.message?.content ?? json.response;
            if (token) {
              yield token;
            }
          } catch {
            // Skip malformed JSON lines from Ollama streaming
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
