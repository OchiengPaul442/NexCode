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
import { repairTruncatedJson, extractToolCallFromMalformedJson } from "../utils/jsonRepair";

/**
 * Map tool names used by some models (e.g. gemma4) to canonical NexCode tool names.
 * Models like gemma4:31b-cloud emit names like `read_file`, `write_file`, `run_command`
 * instead of the canonical `read`, `write`, `terminal`.
 */
const TOOL_NAME_MAP: Record<string, string> = {
  "read_file": "read",
  "write_file": "write",
  "run_command": "terminal",
  "execute_command": "terminal",
  "run_terminal": "terminal",
  "search_files": "search",
  "search_code": "search",
  "find_files": "search",
  "delete_file": "delete",
  "patch_file": "patch",
  "list_files": "terminal",
  "create_file": "write",
  "modify_file": "write",
};

const PARAM_NAME_MAP: Record<string, string> = {
  "file_path": "path",
  "file": "path",
  "filepath": "path",
  "path": "path",
  "PATH": "path",
  "pattern": "query",
  "search": "query",
  "query": "query",
  "text": "content",
  "data": "content",
  "code": "content",
  "content": "content",
  "command": "command",
  "cmd": "command",
};

function canonicalToolName(name: string): string {
  return TOOL_NAME_MAP[name] ?? TOOL_NAME_MAP[name.toLowerCase()] ?? name;
}

function canonicalParamName(name: string): string {
  return PARAM_NAME_MAP[name] ?? PARAM_NAME_MAP[name.toLowerCase()] ?? name;
}

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

/**
 * Validate and repair a tool call's arguments.
 * Returns the repaired arguments string, or the original if repair fails.
 */
function validateAndRepairToolCallArgs(
  toolName: string,
  rawArgs: string,
  availableTools: Array<{ name: string }> | undefined,
): string {
  // If already valid, return as-is
  try {
    const parsed = JSON.parse(rawArgs);
    if (typeof parsed === "object" && parsed !== null) {
      return typeof rawArgs === "string" ? rawArgs : JSON.stringify(rawArgs);
    }
  } catch {
    // Not valid, try to repair
  }

  // Try truncated JSON repair
  const repaired = repairTruncatedJson(rawArgs);
  try {
    const parsed = JSON.parse(repaired);
    if (typeof parsed === "object" && parsed !== null) {
      return JSON.stringify(parsed);
    }
  } catch {
    // Repair failed, continue to regex extraction
  }

  // Last resort: extract tool name and arguments separately using regex
  const nameMatch = rawArgs.match(/["']?name["']?\s*[:=]\s*["']([^"']+)["']/i);
  const extractedName = nameMatch?.[1] ?? toolName;

  // Verify tool name exists in available tools
  if (availableTools && availableTools.length > 0) {
    const validTool = availableTools.find(
      (t) => t.name.toLowerCase() === extractedName.toLowerCase(),
    );
    if (!validTool) {
      // Tool name not valid, return empty args for validation to catch
      return "{}";
    }
  }

  // Extract arguments object from the raw string
  const argsMatch = rawArgs.match(/["']?arguments["']?\s*[:=]\s*(\{[\s\S]*\})/i);
  if (argsMatch) {
    const argsStr = argsMatch[1];
    const argsRepaired = repairTruncatedJson(argsStr);
    try {
      const parsed = JSON.parse(argsRepaired);
      return JSON.stringify(parsed);
    } catch {
      // Fall through to generic field extraction
    }
  }

  // Generic field extraction for common patterns
  const fixedArgs: Record<string, unknown> = {};
  const pathMatch = rawArgs.match(/["']?(?:path|filePath|file)["']?\s*[:=]\s*["']([^"']+)["']/i);
  const contentMatch = rawArgs.match(/["'](?:content|text)["']?\s*[:=]\s*["']([\s\S]*?)["']/i);
  const commandMatch = rawArgs.match(/["'](?:command|cmd)["']?\s*[:=]\s*["']([\s\S]*?)["']/i);
  const queryMatch = rawArgs.match(/["'](?:query|search)["']?\s*[:=]\s*["']([\s\S]*?)["']/i);
  const oldTextMatch = rawArgs.match(/["'](?:oldText|old)["']?\s*[:=]\s*["']([\s\S]*?)["']/i);
  const newTextMatch = rawArgs.match(/["'](?:newText|new)["']?\s*[:=]\s*["']([\s\S]*?)["']/i);

  if (pathMatch) fixedArgs.path = pathMatch[1];
  if (contentMatch) fixedArgs.content = contentMatch[1];
  if (commandMatch) fixedArgs.command = commandMatch[1];
  if (queryMatch) fixedArgs.query = queryMatch[1];
  if (oldTextMatch) fixedArgs.oldText = oldTextMatch[1];
  if (newTextMatch) fixedArgs.newText = newTextMatch[1];

  // For terminal/test, map content to command if no explicit command found
  if ((toolName === "terminal" || toolName === "test") && fixedArgs.content && !fixedArgs.command) {
    fixedArgs.command = fixedArgs.content;
  }

  return Object.keys(fixedArgs).length > 0
    ? JSON.stringify(fixedArgs)
    : rawArgs;
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

/**
 * Models with known poor tool-calling support. These models may produce
 * malformed JSON, emit tool calls as text instead of structured responses,
 * or fail to follow the function-calling format entirely.
 */
const POOR_TOOL_CALLING_MODELS = [
  "qwen3:8b",
  "qwen2.5-coder:3b",
  "qwen2.5:3b",
  "gpt-oss:120b-cloud",
  "phi3:mini",
  "phi3:small",
  "deepseek-r1:8b",
  "gemma2:2b",
  "gemma2:9b",
  "gemma4:31b-cloud",
  "llama3.2:1b",
  "llama3.2:3b",
  "mistral:7b",
  "mixtral:8x7b",
  "gemma4:27b",
  "gemma4:12b",
  "qwen2.5-coder:7b",
  "qwen2.5:7b",
];

/**
 * Models that handle the native Ollama tools API field well.
 * Only models NOT in this list will use prompt-based tool calling.
 */
const NATIVE_TOOL_CALLING_MODELS = [
  "qwen2.5-coder:14b",
  "qwen2.5-coder:32b",
  "qwen2.5:14b",
  "qwen2.5:32b",
  "qwen3:14b",
  "qwen3:32b",
  "qwen3:72b",
  "deepseek-v4",
  "gpt-4",
  "gpt-4o",
  "claude",
  "glm-5",
  "mimo-v2",
  "llama3.3",
];

/**
 * Detect if a model is known to have poor tool-calling support.
 */
function isPoorToolCallingModel(model: string): boolean {
  const lower = model.toLowerCase();
  return POOR_TOOL_CALLING_MODELS.some((m) => lower.includes(m.toLowerCase()));
}

/**
 * Detect if a model is known to handle native tool calling well.
 */
function isNativeToolCallingModel(model: string): boolean {
  const lower = model.toLowerCase();
  return NATIVE_TOOL_CALLING_MODELS.some((m) => lower.includes(m.toLowerCase()));
}

/**
 * Validate that a tool schema is well-formed before sending to the model.
 * Returns a simplified schema if the input is malformed or too complex.
 */
function validateToolSchema(
  tool: { name: string; description: string; inputSchema: Record<string, unknown> },
): { valid: boolean; schema: Record<string, unknown>; simplified: boolean } {
  const schema = tool.inputSchema;
  
  // Check basic structure
  if (!schema || typeof schema !== "object") {
    return {
      valid: false,
      schema: buildMinimalToolSchema(tool),
      simplified: true,
    };
  }

  // Check for properties
  const properties = schema.properties as Record<string, unknown> | undefined;
  if (!properties || typeof properties !== "object" || Object.keys(properties).length === 0) {
    // Some tools don't have properties (e.g., git-status with optional path)
    // This is valid, return as-is
    return { valid: true, schema, simplified: false };
  }

  // Check for overly deep nesting that may confuse models
  const depth = calculateSchemaDepth(schema);
  if (depth > 4) {
    console.warn(`[ollama] tool "${tool.name}" schema has depth ${depth}, simplifying`);
    return {
      valid: true,
      schema: buildSimplifiedToolSchema(tool),
      simplified: true,
    };
  }

  // Check for excessive number of properties
  const propCount = Object.keys(properties).length;
  if (propCount > 5) {
    console.warn(`[ollama] tool "${tool.name}" has ${propCount} properties, simplifying`);
    return {
      valid: true,
      schema: buildSimplifiedToolSchema(tool),
      simplified: true,
    };
  }

  // Check for anyOf/oneOf/allOf which confuse many models
  const hasComplexConstructs = schema.anyOf || schema.oneOf || schema.allOf;
  if (hasComplexConstructs) {
    console.warn(`[ollama] tool "${tool.name}" has complex schema constructs, simplifying`);
    return {
      valid: true,
      schema: buildSimplifiedToolSchema(tool),
      simplified: true,
    };
  }

  return { valid: true, schema, simplified: false };
}

/**
 * Calculate the nesting depth of a JSON schema.
 */
function calculateSchemaDepth(schema: Record<string, unknown>, current = 0): number {
  if (current > 10) return current; // Prevent infinite recursion
  
  let maxDepth = current;
  const properties = schema.properties as Record<string, unknown> | undefined;
  
  if (properties) {
    for (const value of Object.values(properties)) {
      if (typeof value === "object" && value !== null) {
        const childDepth = calculateSchemaDepth(value as Record<string, unknown>, current + 1);
        maxDepth = Math.max(maxDepth, childDepth);
      }
    }
  }

  // Check items for array types
  const items = schema.items as Record<string, unknown> | undefined;
  if (items && typeof items === "object") {
    const itemDepth = calculateSchemaDepth(items, current + 1);
    maxDepth = Math.max(maxDepth, itemDepth);
  }

  return maxDepth;
}

/**
 * Build a minimal tool schema with only required fields.
 * Used when the original schema is malformed or too complex.
 */
function buildMinimalToolSchema(
  tool: { name: string; inputSchema: Record<string, unknown> },
): Record<string, unknown> {
  const schema = tool.inputSchema;
  const properties = (schema.properties as Record<string, unknown>) ?? {};
  const required = (schema.required as string[]) ?? [];

  // Just take the first 2 properties
  const minimalProps: Record<string, unknown> = {};
  const keys = Object.keys(properties).slice(0, 2);
  for (const key of keys) {
    const prop = properties[key] as Record<string, unknown>;
    minimalProps[key] = {
      type: prop?.type ?? "string",
      description: prop?.description ?? key,
    };
  }

  return {
    type: "object",
    properties: minimalProps,
    required: required.filter((k) => k in minimalProps),
  };
}

/**
 * Build JSON code block tool instructions for the system prompt.
 * Kept for backward compatibility but no longer the primary text format.
 * The simple TOOL: text format in buildPromptBasedToolInstructions is now
 * preferred because models like gemma4 produce it more reliably than JSON.
 */
function buildJsonToolInstructions(
  tools: Array<{ name: string; description: string; inputSchema: Record<string, unknown> }>,
): string {
  const toolDefs = tools.map((tool) => {
    const schema = tool.inputSchema;
    const required = (schema.required as string[]) ?? [];
    const properties = (schema.properties as Record<string, unknown>) ?? {};
    const paramList = required.length > 0
      ? required.map((r) => {
          const prop = properties[r] as Record<string, unknown> | undefined;
          const desc = prop?.description as string | undefined;
          return desc ? `${r} (${desc})` : r;
        }).join(", ")
      : Object.keys(properties).slice(0, 2).join(", ");

    return `- ${tool.name}(${paramList}): ${tool.description}`;
  });

  const examples: string[] = [];
  if (tools.some((t) => t.name === "read")) {
    examples.push('```json\n{"name": "read", "arguments": {"path": "src/index.ts"}}\n```');
  }
  if (tools.some((t) => t.name === "terminal")) {
    examples.push('```json\n{"name": "terminal", "arguments": {"command": "ls -la"}}\n```');
  }
  if (tools.some((t) => t.name === "search")) {
    examples.push('```json\n{"name": "search", "arguments": {"query": "TODO"}}\n```');
  }
  if (tools.some((t) => t.name === "write")) {
    examples.push('```json\n{"name": "write", "arguments": {"path": "test.ts", "content": "const x = 1;"}}\n```');
  }

  return [
    "\n\nYou have these tools available. When you need to use a tool, respond with a JSON code block:\n",
    ...toolDefs,
    "",
    "Response format (use EXACTLY this structure):",
    "```json",
    '{"name": "TOOL_NAME", "arguments": {"PARAM": "VALUE"}}',
    "```",
    "",
    "Examples:",
    ...examples,
    "",
    "Rules:",
    "- Wrap tool calls in ```json code blocks",
    "- Use double quotes for all strings",
    "- Close ALL braces and brackets",
    "- Only one tool call per response",
    "- Do NOT describe what you would do — actually do it using a tool call",
    "- Do NOT use the TOOL: format — use JSON code blocks only",
  ].join("\n");
}

/**
 * Build human-readable tool instructions for prompt-based tool calling.
 * Used with low-tier models that can't use the Ollama `tools` API field,
 * and as the primary text-based fallback when native function calling fails.
 * The model produces tool calls as plain text (TOOL: format), which are then
 * parsed by extractToolCallsFromText() and tryParseTextAsToolCall().
 *
 * This format is chosen because models like gemma4 produce it more reliably
 * than JSON code blocks.
 */
function buildPromptBasedToolInstructions(
  tools: Array<{ name: string; description: string; inputSchema: Record<string, unknown> }>,
): string {
  const toolDefs = tools.map((tool) => {
    const schema = tool.inputSchema;
    const required = (schema.required as string[]) ?? [];
    const properties = (schema.properties as Record<string, unknown>) ?? {};
    const paramList = required.length > 0
      ? required.map((r) => {
          const prop = properties[r] as Record<string, unknown> | undefined;
          const desc = prop?.description as string | undefined;
          return desc ? `${r} (${desc})` : r;
        }).join(", ")
      : Object.keys(properties).slice(0, 2).join(", ");

    return `- ${tool.name}(${paramList}): ${tool.description}`;
  });

  const examples: string[] = [];
  if (tools.some((t) => t.name === "read")) {
    examples.push("TOOL: read\nPATH: src/index.ts");
  }
  if (tools.some((t) => t.name === "write")) {
    examples.push("TOOL: write\nPATH: test.ts\nCONTENT: const x = 1;");
  }
  if (tools.some((t) => t.name === "terminal")) {
    examples.push("TOOL: terminal\nCOMMAND: ls -la");
  }
  if (tools.some((t) => t.name === "search")) {
    examples.push("TOOL: search\nQUERY: function");
  }
  if (tools.some((t) => t.name === "patch")) {
    examples.push("TOOL: patch\nPATH: src/file.ts\nOLDTEXT: old code\nNEWTEXT: new code");
  }
  if (tools.some((t) => t.name === "delete")) {
    examples.push("TOOL: delete\nPATH: old-file.ts");
  }

  return [
    "\n\nYou have these tools available. When you need to use a tool, respond with EXACTLY ONE tool call in this text format:\n",
    "TOOL: <tool_name>",
    "<parameter_name>: <parameter_value>",
    "",
    "Available tools:",
    ...toolDefs,
    "",
    "Examples (copy this format exactly):",
    ...examples,
    "",
    "CRITICAL RULES:",
    "- TOOL: must be on its own line, followed by the tool name",
    "- Each parameter must be on its own line as KEY: VALUE",
    "- Only ONE tool call per response",
    "- Do NOT describe what you would do - actually do it using a tool call",
    "- Do NOT use JSON, code blocks, or any other format - use ONLY the plain text format above",
    "- Do NOT add extra text before or after the tool call",
    "- Do NOT wrap the tool call in markdown code blocks (```...```)",
    "- Do NOT use curly braces {} or square brackets [] anywhere in your response",
    "- The tool name must match exactly (e.g., 'read', 'write', 'terminal', 'search')",
  ].join("\n");
}

/**
 * Build a simplified tool definition for models that struggle with
 * complex JSON schemas. Strips optional fields and keeps only required
 * parameters with minimal nesting.
 */
function buildSimplifiedToolSchema(
  tool: { name: string; description: string; inputSchema: Record<string, unknown> },
): Record<string, unknown> {
  const schema = tool.inputSchema;
  const required = (schema.required as string[]) ?? [];
  const properties = (schema.properties as Record<string, unknown>) ?? {};

  // Build a flat properties object with only required fields
  const simplifiedProperties: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(properties)) {
    if (required.includes(key) || Object.keys(properties).length <= 2) {
      const prop = value as Record<string, unknown>;
      simplifiedProperties[key] = {
        type: prop.type ?? "string",
        description: prop.description ?? key,
      };
    }
  }

  return {
    type: "object",
    properties: simplifiedProperties,
    required: required.filter((k) => k in simplifiedProperties),
  };
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
      // Force temperature 0 for tool calls to ensure deterministic outputs
      // Research shows this significantly improves tool calling reliability
      const hasTools = request.tools && request.tools.length > 0;
      const temperature = hasTools ? 0 : (request.temperature ?? 0.2);
      
      const payload: any = {
        model: request.model,
        messages: request.messages,
        stream: false,
        options: {
          temperature,
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

      // For models with poor tool calling, embed tools in the system prompt
      // instead of using the Ollama `tools` API field which they handle poorly.
      const usePromptBasedTools = isPoorToolCallingModel(request.model);
      const useNativeTools = !usePromptBasedTools && (
        isNativeToolCallingModel(request.model) || 
        !request.tools || 
        request.tools.length === 0
      );

      if (usePromptBasedTools && request.tools && request.tools.length > 0) {
        console.warn(`[ollama] using prompt-based tool calling for ${request.model}`);
        const toolInstructions = buildPromptBasedToolInstructions(request.tools);

        // Find or create a system message and append tool instructions
        const messages = [...request.messages];
        const systemIdx = messages.findIndex((m) => m.role === "system");
        if (systemIdx !== -1) {
          messages[systemIdx] = {
            ...messages[systemIdx],
            content: messages[systemIdx].content + toolInstructions,
          };
        } else {
          messages.unshift({
            role: "system",
            content: "You are a helpful coding assistant." + toolInstructions,
          });
        }
        payload.messages = messages;
      } else if (request.tools && request.tools.length > 0) {
        // Validate and potentially simplify tool schemas before sending
        const validatedTools = request.tools.map((tool) => {
          const validation = validateToolSchema(tool);
          if (validation.simplified) {
            console.warn(`[ollama] using simplified schema for tool "${tool.name}"`);
          }
          return {
            type: "function",
            function: {
              name: tool.name,
              description: tool.description,
              parameters: this.sanitizeSchema(validation.schema),
            },
          };
        });
        payload.tools = validatedTools;
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
        // Fallback chain:
        //   1. Try to repair/extract from the error body
        //   2. Retry WITHOUT tools API field, using text-based instructions instead
        //   3. Return empty text response as last resort
        if (
          isToolOrJsonParseError(errorMsg) &&
          request.tools &&
          request.tools.length > 0
        ) {
          console.warn(`[ollama] tool/JSON parse error, attempting recovery: ${errorMsg}`);
          
          // First, try to extract and repair any partial tool call from the error
          const repairedCall = this.tryRepairFromError(errorBody, request.tools);
          if (repairedCall) {
            console.warn(`[ollama] successfully repaired tool call from error response`);
            return repairedCall;
          }
          
          // Try to extract tool calls from the error body text
          const extractedCalls = this.extractToolCallsFromText(errorBody);
          if (extractedCalls.length > 0) {
            console.warn(`[ollama] extracted ${extractedCalls.length} tool call(s) from error response`);
            return {
              text: "",
              toolCalls: extractedCalls,
              raw: { error: errorMsg },
            };
          }
          
          // Fallback: retry with text-based tool instructions instead of tools API
          console.warn(`[ollama] falling back to text-based tool calling for ${request.model}`);
          try {
            const textResult = await this.generateWithTextToolCalls(request);
            return textResult;
          } catch (textFallbackError) {
            console.warn(`[ollama] text-based fallback also failed: ${textFallbackError}`);
            // Final fallback: return empty text response
            return {
              text: "",
              raw: { error: errorMsg, fallbackToText: true },
            };
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
          // Use the new validator/repairer with access to available tools
          args = validateAndRepairToolCallArgs(
            tc.function.name,
            args,
            request.tools,
          );
          toolCalls.push({
            id: `call_${i}`,
            type: "function" as const,
            function: {
              name: canonicalToolName(tc.function.name),
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
        const extractedCalls = this.extractToolCallsFromText(text, request.messages);
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
        // Debug: log text when extraction fails for poor tool-calling models
        if (isPoorToolCallingModel(request.model) && text.length > 0 && text.length < 500) {
          console.warn(`[ollama] text extraction failed for poor model, text: ${JSON.stringify(text.substring(0, 300))}`);
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
        const toolName = canonicalToolName(parsed.name);
        const rawArgs = parsed.arguments || parsed.params || {};
        const args: Record<string, unknown> = {};
        if (typeof rawArgs === "object" && rawArgs !== null) {
          for (const [k, v] of Object.entries(rawArgs)) {
            args[canonicalParamName(k)] = v;
          }
        } else {
          return null;
        }
        
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
                arguments: JSON.stringify(args),
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

  private extractToolCallsFromText(text: string, messages?: Array<{role: string; content: string}>): ToolCallRequest[] {
    const calls: ToolCallRequest[] = [];

    // Try simple text format first: TOOL: <name>\nPARAM: value
    const simpleToolMatch = text.match(/TOOL:\s*(\S+)/i);
    if (simpleToolMatch) {
      const toolName = canonicalToolName(simpleToolMatch[1].toLowerCase());
      const afterToolLine = text.slice(simpleToolMatch.index! + simpleToolMatch[0].length);
      const lines = afterToolLine.split("\n");
      const args: Record<string, string> = {};

      const multiLineKeys = new Set(["content", "oldtext", "newtext", "text"]);
      let currentKey = "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) {
          // Blank line: skip if between params, preserve if inside a multi-line value
          if (currentKey && multiLineKeys.has(currentKey) && args[currentKey]) {
            args[currentKey] += "\n";
          }
          continue;
        }
        // Check if this line starts a new key-value pair
        const kvMatch = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)/);
        if (kvMatch) {
          const key = canonicalParamName(kvMatch[1]);
          const value = kvMatch[2];
          currentKey = key;
          args[key] = value;
        } else if (currentKey && multiLineKeys.has(currentKey)) {
          args[currentKey] += "\n" + trimmed;
        }
      }

      if (Object.keys(args).length > 0) {
        calls.push({
          id: `call_simple_${Date.now()}_${calls.length}`,
          type: "function",
          function: { name: toolName, arguments: JSON.stringify(args) },
        });
        return calls;
      }
    }

    // Try DSML format first: <| DSML | tool_calls> <| DSML | invoke name="read"> ...
    const dsmlPattern = /<\|\s*\|\s*DSML\s*\|\s*\|\s*tool_calls\s*>/i;
    if (dsmlPattern.test(text)) {
      const invokePattern = /<\|\s*\|\s*DSML\s*\|\s*\|\s*invoke\s+name="([^"]+)"\s*>([\s\S]*?)<\|\s*\|\s*DSML\s*\|\s*\|\s*invoke\s*>/gi;
      let invokeMatch;
      while ((invokeMatch = invokePattern.exec(text)) !== null) {
        const toolName = canonicalToolName(invokeMatch[1].toLowerCase());
        const body = invokeMatch[2];
        const args: Record<string, string> = {};

        const paramPattern = /<\|\s*\|\s*DSML\s*\|\s*\|\s*parameter\s+name="([^"]+)"[^>]*>([\s\S]*?)<\|\s*\|\s*DSML\s*\|\s*\|\s*parameter\s*>/gi;
        let paramMatch;
        while ((paramMatch = paramPattern.exec(body)) !== null) {
          args[canonicalParamName(paramMatch[1])] = paramMatch[2].trim();
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

    // Try "Proposed Edit" format with flexible variations
    // Supports: "Proposed Edit", "proposed edit", "PROPOSED EDIT", etc.
    // Also supports: File:, file:, FilePath:, path:, Path:
    const proposedEditPatterns = [
      // Standard: ## Proposed Edit\nFile: ...\nInstruction: ...
      /##\s*Proposed\s*Edit\s*\n\s*(?:File|Path|FilePath)\s*:\s*(.+?)\s*\n\s*(?:Instruction|Change|Edit|Description)\s*:\s*(.+?)(?:\n\n|\n|$)/i,
      // With content block: ## Proposed Edit\nFile: ...\n\n```\n...\n```
      /##\s*Proposed\s*Edit\s*\n\s*(?:File|Path|FilePath)\s*:\s*(.+?)\s*\n\s*(?:```[\s\S]*?```)/i,
      // Alternative formats: "Edit File:", "Modify File:"
      /##\s*(?:Edit|Modify)\s*(?:File|Path)\s*:\s*(.+?)\s*\n\s*(?:Change|Edit|Description|Content)\s*:\s*(.+?)(?:\n\n|\n|$)/i,
      // Inline format: "Proposed Edit to <file>"
      /(?:Proposed|Suggested)\s+(?:Edit|Change)\s+(?:to|for)\s+[`"']?([^\s`"']+)[`"']?\s*:\s*(.+?)(?:\n\n|\n|$)/i,
      // H3 format: ### Edit\nFile: ...\nInstruction: ...
      /###\s*(?:Edit|Proposed\s*Edit)\s*\n\s*(?:File|Path|FilePath)\s*:\s*(.+?)\s*\n\s*(?:Instruction|Change|Edit|Description|Content)\s*:\s*(.+?)(?:\n\n|\n|$)/i,
      // "Proposed change to file" format
      /Proposed\s+change\s+to\s+(?:file\s+)?[`"']?([^\s`"']+)[`"']?\s*\n\s*(?:Instruction|Change|Edit|Description|Content)\s*:\s*(.+?)(?:\n\n|\n|$)/i,
      // "Edit file:" format (no heading)
      /(?:Edit|Modify|Update)\s+(?:file|path)\s*:\s*[`"']?([^\s`"']+)[`"']?\s*\n\s*(?:Instruction|Change|Edit|Description|Content|New)\s*:\s*(.+?)(?:\n\n|\n|$)/i,
      // "File: ...\nEdit:" format (no heading)
      /(?:File|Path)\s*:\s*[`"']?([^\s`"']+)[`"']?\s*\n\s*(?:Edit|Change|Instruction|Description|Content|New)\s*:\s*(.+?)(?:\n\n|\n|$)/i,
    ];

    for (const pattern of proposedEditPatterns) {
      const proposedEditMatch = text.match(pattern);
      if (proposedEditMatch) {
        const filePath = proposedEditMatch[1].trim();
        const instruction = proposedEditMatch[2]?.trim() ?? "";
        
        // Try to extract content from code blocks (prefer actual code over instruction)
        const codeBlockMatch = text.match(/```[\s\S]*?```/);
        const content = codeBlockMatch 
          ? codeBlockMatch[0].replace(/```\w*\n?/g, '').replace(/```/g, '').trim() 
          : instruction;
        
        if (filePath && content) {
          calls.push({
            id: `call_ollama_proposed_${Date.now()}`,
            type: "function",
            function: {
              name: "write",
              arguments: JSON.stringify({ path: filePath, content: content }),
            },
          });
          return calls;
        }
      }
    }

    // Try "call" function-call format: call tool="name" param="value"
    const callFormatMatch = text.match(/call\s+tool\s*=\s*["']([^"']+)["']/i);
    if (callFormatMatch) {
      const toolName = canonicalToolName(callFormatMatch[1].toLowerCase());
      const args: Record<string, string> = {};
      const paramPattern = /([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*["']([\s\S]*?)["']/gi;
      let paramMatch;
      while ((paramMatch = paramPattern.exec(text)) !== null) {
        const key = paramMatch[1].toLowerCase();
        if (key !== "tool") {
          args[canonicalParamName(key)] = paramMatch[2];
        }
      }
      if (Object.keys(args).length > 0) {
        calls.push({
          id: `call_func_format_${Date.now()}_${calls.length}`,
          type: "function",
          function: { name: toolName, arguments: JSON.stringify(args) },
        });
        return calls;
      }
    }

    // Try JSON code block: ```json\n{"name": "...", "arguments": {...}}\n```
    const fenceMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
    const fencedContent = fenceMatch ? fenceMatch[1].trim() : null;

      if (fencedContent && (fencedContent.startsWith("{") || fencedContent.startsWith("["))) {
      const parsed = this.tryParseJsonToolCall(fencedContent);
      if (parsed.length > 0) return parsed;
      
      // If the JSON code block is not a tool call, check if it looks like file content
      // Models sometimes produce the edited file content in a JSON code block instead of using TOOL: format
      try {
        const jsonContent = JSON.parse(fencedContent);
        // Check if this looks like a tool call (has "name" that's a known tool AND "arguments")
        const knownTools = new Set(["read", "write", "terminal", "search", "patch", "delete", "append", "move", "test", "git-status", "git-diff"]);
        const isToolCall = jsonContent.name && typeof jsonContent.name === "string" && 
          knownTools.has(jsonContent.name.toLowerCase()) && jsonContent.arguments;
        
        if (jsonContent && typeof jsonContent === "object" && !isToolCall) {
          console.warn(`[ollama] detected JSON code block that looks like file content, attempting to infer file path`);
          // This looks like file content, not a tool call
          // Try to infer the file path from the text context (multiple patterns)
          const filePathMatch = text.match(/(?:file|path|to|for|in|of)\s*[`"']?([^\s`"']+\.json)[`"']?/i)
            ?? text.match(/[`"']?([^\s`"']+\.json)[`"']?/i)
            ?? text.match(/(?:file|path|to|for|in|of)\s*[`"']?([^\s`"']+\.ts)[`"']?/i)
            ?? text.match(/[`"']?([^\s`"']+\.ts)[`"']?/i)
            ?? text.match(/(?:file|path|to|for|in|of)\s*[`"']?([^\s`"']+\.js)[`"']?/i)
            ?? text.match(/[`"']?([^\s`"']+\.js)[`"']?/i);
          if (filePathMatch) {
            console.warn(`[ollama] inferred file path from text: ${filePathMatch[1]}`);
            calls.push({
              id: `call_ollama_json_content_${Date.now()}_${calls.length}`,
              type: "function",
              function: {
                name: "write",
                arguments: JSON.stringify({ path: filePathMatch[1], content: fencedContent }),
              },
            });
            return calls;
          }
          
          // If no file path found in text, try to infer from the JSON structure
          // e.g., package.json has "name", "version", "scripts" fields
          if (jsonContent.scripts || jsonContent.dependencies || jsonContent.devDependencies) {
            console.warn(`[ollama] inferred file path from JSON structure: package.json`);
            calls.push({
              id: `call_ollama_json_content_${Date.now()}_${calls.length}`,
              type: "function",
              function: {
                name: "write",
                arguments: JSON.stringify({ path: "package.json", content: fencedContent }),
              },
            });
            return calls;
          }
          
          // If still no file path, try to extract from the prompt messages
          if (messages && messages.length > 0) {
            const promptText = messages.map(m => m.content).join(" ");
            const promptPathMatch = promptText.match(/(?:file|path|to|for|in|of)\s*[`"']?([^\s`"']+\.json)[`"']?/i)
              ?? promptText.match(/[`"']?([^\s`"']+\.json)[`"']?/i)
              ?? promptText.match(/(?:file|path|to|for|in|of)\s*[`"']?([^\s`"']+\.ts)[`"']?/i)
              ?? promptText.match(/[`"']?([^\s`"']+\.ts)[`"']?/i)
              ?? promptText.match(/(?:file|path|to|for|in|of)\s*[`"']?([^\s`"']+\.js)[`"']?/i)
              ?? promptText.match(/[`"']?([^\s`"']+\.js)[`"']?/i);
            if (promptPathMatch) {
              console.warn(`[ollama] inferred file path from prompt: ${promptPathMatch[1]}`);
              calls.push({
                id: `call_ollama_json_content_${Date.now()}_${calls.length}`,
                type: "function",
                function: {
                  name: "write",
                  arguments: JSON.stringify({ path: promptPathMatch[1], content: fencedContent }),
                },
              });
              return calls;
            }
          }
          
          console.warn(`[ollama] could not infer file path for JSON content`);
        }
      } catch {
        // Not valid JSON, continue
      }
    }

    // Try to find JSON objects embedded anywhere in the text (not just at start)
    // Models often produce: "I'll read the file. {"name": "read", "arguments": {"path": "src/index.ts"}}"
    const embeddedJsonCalls = this.extractEmbeddedJsonToolCalls(text);
    if (embeddedJsonCalls.length > 0) return embeddedJsonCalls;

    // Last resort: try to extract tool call from the entire text as potentially malformed JSON
    const fullTextExtracted = extractToolCallFromMalformedJson(text);
    if (fullTextExtracted) {
      const mappedArgs: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(fullTextExtracted.arguments)) {
        mappedArgs[canonicalParamName(k)] = v;
      }
      calls.push({
        id: `call_ollama_fulltext_${Date.now()}_${calls.length}`,
        type: "function",
        function: {
          name: canonicalToolName(fullTextExtracted.name),
          arguments: JSON.stringify(mappedArgs),
        },
      });
    }

    return calls;
  }

  /**
   * Try to parse a JSON string as a tool call.
   * Returns extracted tool calls, or empty array if parsing fails.
   */
  private tryParseJsonToolCall(jsonStr: string): ToolCallRequest[] {
    const calls: ToolCallRequest[] = [];
    try {
      const parsed = JSON.parse(jsonStr);
      const items = Array.isArray(parsed) ? parsed : [parsed];

      for (const item of items) {
        if (
          item &&
          typeof item.name === "string" &&
          item.arguments &&
          typeof item.arguments === "object"
        ) {
          const mappedArgs: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(item.arguments)) {
            mappedArgs[canonicalParamName(k)] = v;
          }
          calls.push({
            id: `call_ollama_json_${Date.now()}_${calls.length}`,
            type: "function",
            function: {
              name: canonicalToolName(item.name),
              arguments: JSON.stringify(mappedArgs),
            },
          });
        }
      }
    } catch {
      // Not valid JSON — try regex extraction from malformed JSON
      const extracted = extractToolCallFromMalformedJson(jsonStr);
      if (extracted) {
        const mappedArgs: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(extracted.arguments)) {
          mappedArgs[canonicalParamName(k)] = v;
        }
        calls.push({
          id: `call_ollama_malformed_${Date.now()}_${calls.length}`,
          type: "function",
          function: {
            name: canonicalToolName(extracted.name),
            arguments: JSON.stringify(mappedArgs),
          },
        });
      }
    }
    return calls;
  }

  /**
   * Extract tool calls from JSON objects embedded in text.
   * Handles cases like: "I'll read the file. {"name": "read", "arguments": {"path": "src/index.ts"}}"
   * or truncated versions: "...{"name":"read","arguments":{"path":"file.ts""
   */
  private extractEmbeddedJsonToolCalls(text: string): ToolCallRequest[] {
    const calls: ToolCallRequest[] = [];

    // Find all potential JSON object starts (brace positions)
    for (let i = 0; i < text.length; i++) {
      if (text[i] !== "{") continue;

      // Try to find a matching closing brace using a simple depth counter
      let depth = 0;
      let inString = false;
      let escaped = false;
      let endIdx = -1;

      for (let j = i; j < text.length; j++) {
        const ch = text[j];

        if (escaped) {
          escaped = false;
          continue;
        }

        if (ch === "\\" && inString) {
          escaped = true;
          continue;
        }

        if (ch === '"') {
          inString = !inString;
          continue;
        }

        if (inString) continue;

        if (ch === "{") depth++;
        else if (ch === "}") {
          depth--;
          if (depth === 0) {
            endIdx = j;
            break;
          }
        }
      }

      // If we found a complete JSON object, try to parse it
      if (endIdx > i) {
        const jsonStr = text.slice(i, endIdx + 1);
        const parsed = this.tryParseJsonToolCall(jsonStr);
        if (parsed.length > 0) return parsed;
        continue;
      }

      // If no complete object found but we have significant JSON content, try malformed extraction
      const remaining = text.slice(i);
      const extracted = extractToolCallFromMalformedJson(remaining);
      if (extracted) {
        const mappedArgs: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(extracted.arguments)) {
          mappedArgs[canonicalParamName(k)] = v;
        }
        calls.push({
          id: `call_ollama_embedded_${Date.now()}_${calls.length}`,
          type: "function",
          function: {
            name: canonicalToolName(extracted.name),
            arguments: JSON.stringify(mappedArgs),
          },
        });
        return calls;
      }
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
   * Generate a response using text-based tool calling instructions.
   * Does NOT use the Ollama `tools` API field at all.
   * Instead, includes simple TOOL: text instructions in the system prompt.
   * The model's text response is then parsed for tool calls.
   *
   * This is the primary fallback when native function calling fails due to
   * malformed JSON or model incompatibility.
   */
  public async generateWithTextToolCalls(request: ModelRequest): Promise<ModelResponse> {
    const abort = this.createAbortController(
      request.signal,
      this.resolveTimeoutMs("generate"),
    );
    try {
      const messages = [...request.messages];

      // Build simple text-based tool instructions and inject into system message
      if (request.tools && request.tools.length > 0) {
        const toolInstructions = buildPromptBasedToolInstructions(request.tools);
        const systemIdx = messages.findIndex((m) => m.role === "system");
        if (systemIdx !== -1) {
          messages[systemIdx] = {
            ...messages[systemIdx],
            content: messages[systemIdx].content + toolInstructions,
          };
        } else {
          messages.unshift({
            role: "system",
            content: "You are a helpful coding assistant." + toolInstructions,
          });
        }
      }

      // Force temperature 0 for tool calls to ensure deterministic outputs
      const payload: any = {
        model: request.model,
        messages,
        stream: false,
        options: {
          temperature: 0, // Always 0 for tool calls
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
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
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

        throw new Error(errorMsg);
      }

      const json = (await response.json()) as OllamaChatResponse;
      const text = json.message?.content ?? json.response ?? "";
      const usage = json.prompt_eval_count != null && json.eval_count != null
        ? { promptTokens: json.prompt_eval_count, completionTokens: json.eval_count, totalTokens: json.prompt_eval_count + json.eval_count }
        : undefined;

      // Extract tool calls from the text response
      const extractedCalls = this.extractToolCallsFromText(text, request.messages);
      if (extractedCalls.length > 0) {
        return { text, toolCalls: extractedCalls, raw: json, usage };
      }

      return { text, raw: json, usage };
    } finally {
      abort.clear();
    }
  }

  /**
   * Extract tool calls from a model response text.
   * Parses JSON code blocks, TOOL: format, DSML format, Proposed Edit format,
   * and other text-based tool call patterns.
   *
   * Public API for use by agentLoop and other consumers.
   */
  public extractToolCallsFromResponse(text: string): ToolCallRequest[] {
    return this.extractToolCallsFromText(text);
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

      // For models with poor tool calling, embed tools in the system prompt
      const usePromptBasedTools = isPoorToolCallingModel(request.model);
      if (usePromptBasedTools && request.tools && request.tools.length > 0) {
        const toolInstructions = buildPromptBasedToolInstructions(request.tools);
        const messages = [...request.messages];
        const systemIdx = messages.findIndex((m) => m.role === "system");
        if (systemIdx !== -1) {
          messages[systemIdx] = {
            ...messages[systemIdx],
            content: messages[systemIdx].content + toolInstructions,
          };
        } else {
          messages.unshift({
            role: "system",
            content: "You are a helpful coding assistant." + toolInstructions,
          });
        }
        payload.messages = messages;
      } else if (request.tools && request.tools.length > 0) {
        // Validate and potentially simplify tool schemas for streaming too
        const validatedTools = request.tools.map((tool) => {
          const validation = validateToolSchema(tool);
          if (validation.simplified) {
            console.warn(`[ollama] stream: using simplified schema for tool "${tool.name}"`);
          }
          return {
            type: "function",
            function: {
              name: tool.name,
              description: tool.description,
              parameters: this.sanitizeSchema(validation.schema),
            },
          };
        });
        payload.tools = validatedTools;
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
