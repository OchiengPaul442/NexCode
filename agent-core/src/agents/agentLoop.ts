import {
  ChatMessage,
  ToolCallRequest,
  OrchestratorEvent,
  ToolCallRequestTool,
  ReasoningEffort,
} from "../types";
import { ModelRouter } from "../providers/modelRouter";
import { ToolRegistry } from "../tools/toolRegistry";
import { ToolDefinition, validateInput } from "../tools/toolProtocol";
import { ApprovalCallback } from "../tools/toolApprovalPolicy";

export interface AgentLoopConfig {
  maxTurns: number;
  maxTokensPerTurn: number;
  timeoutMs: number;
}

function formatToolArgs(
  toolName: string,
  args: Record<string, unknown>,
): string {
  switch (toolName) {
    case "read": {
      const p = args.path ?? args.file ?? args.filePath ?? "";
      return String(p);
    }
    case "write": {
      const p = args.path ?? args.file ?? args.filePath ?? "";
      const c = args.content ?? args.text ?? "";
      return `${p} :: ${c}`;
    }
    case "append": {
      const p = args.path ?? args.file ?? args.filePath ?? "";
      const c = args.content ?? args.text ?? "";
      return `${p} :: ${c}`;
    }
    case "move": {
      const src = args.source ?? args.from ?? args.src ?? "";
      const dst = args.destination ?? args.to ?? args.dest ?? "";
      return `${src} :: ${dst}`;
    }
    case "patch": {
      const p = args.path ?? args.file ?? args.filePath ?? "";
      const oldText = args.oldText ?? args.old ?? args.oldText ?? "";
      const newText = args.newText ?? args.new ?? args.newText ?? "";
      return `${p} :: ${oldText} :: ${newText}`;
    }
    case "delete":
    case "delete-contents": {
      const p = args.path ?? args.file ?? args.filePath ?? "";
      return String(p);
    }
    case "terminal": {
      const cmd = args.command ?? args.cmd ?? args.value ?? "";
      return String(cmd);
    }
    case "test": {
      const runner = args.runner ?? "";
      const filter = args.filter ?? args.value ?? "";
      if (runner && filter) {
        return JSON.stringify({ runner, filter });
      }
      if (runner) {
        return JSON.stringify({ runner });
      }
      return String(filter);
    }
    case "search": {
      const query = args.query ?? args.value ?? "";
      return String(query);
    }
    case "web-search":
    case "search-web":
    case "online-search": {
      const query = args.query ?? args.value ?? "";
      return String(query);
    }
    case "mcp": {
      const server = args.server ?? "";
      const tool = args.tool ?? "";
      const input = args.input ?? "";
      return `${server}:${tool} :: ${input}`;
    }
    case "batch_edit": {
      return JSON.stringify(args);
    }
    default: {
      const value = args.value ?? args.input ?? args.command;
      if (typeof value === "string" && value.length > 0) {
        return value;
      }
      // For tools with structured args (objects/arrays), serialize as JSON
      return JSON.stringify(args);
    }
  }
}

function tryParseTextAsToolCall(text: string): ToolCallRequest[] | null {
  // Try JSON code block first
  const fenceMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  const content = fenceMatch ? fenceMatch[1] : text;

  const trimmed = content.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return null;

  try {
    const parsed = JSON.parse(trimmed);
    const items = Array.isArray(parsed) ? parsed : [parsed];
    const calls: ToolCallRequest[] = [];

    for (const item of items) {
      if (
        item &&
        typeof item.name === "string" &&
        item.arguments &&
        typeof item.arguments === "object"
      ) {
        calls.push({
          id: `call_text_${Date.now()}_${calls.length}`,
          type: "function",
          function: {
            name: item.name,
            arguments: JSON.stringify(item.arguments),
          },
        });
      }
    }

    return calls.length > 0 ? calls : null;
  } catch {
    return null;
  }
}

export async function* runAgentLoop(
  messages: ChatMessage[],
  router: ModelRouter,
  tools: ToolRegistry,
  toolDefinitions: ToolDefinition[],
  config: AgentLoopConfig,
  signal?: AbortSignal,
  approvalCallback?: ApprovalCallback,
  reasoningEffort?: ReasoningEffort,
): AsyncGenerator<OrchestratorEvent, ChatMessage[]> {
  const startedAt = Date.now();
  const toolSchemas: ToolCallRequestTool[] = toolDefinitions.map((def) => ({
    name: def.name,
    description: def.description,
    inputSchema: def.inputSchema,
  }));
  let consecutiveNudges = 0;
  const MAX_NUDGES = 2;

  let timedOut = false;
  for (let turn = 0; turn < config.maxTurns; turn++) {
    if (Date.now() - startedAt > config.timeoutMs) {
      timedOut = true;
      yield {
        type: "stopped",
        message: "Agent loop stopped: time budget exceeded",
      };
      break;
    }

    if (signal?.aborted) {
      yield { type: "stopped", message: "Agent loop cancelled" };
      return messages;
    }

    if (turn === 0) {
      yield { type: "status", message: "Analyzing request..." };
    }

    // Retry logic for provider errors with degradation on last attempt (§4 B4)
    let response;
    let lastError: unknown;
    const maxProviderRetries = process.env.NODE_ENV === "test" ? 0 : 2;
    for (let retry = 0; retry <= maxProviderRetries; retry++) {
      if (signal?.aborted) {
        yield { type: "stopped", message: "Agent loop cancelled" };
        return messages;
      }

      try {
        // Degrade on the last retry: drop tools and trim messages to reduce context
        const shouldDegrade = retry === maxProviderRetries;
        const retryTools = shouldDegrade ? undefined : toolSchemas;
    const retryMessages = shouldDegrade
      ? (messages.length > 1 ? [messages[0], messages[1], ...messages.slice(-3)] : messages)
      : messages;

        response = await router.generate(retryMessages, {
          tools: retryTools,
          maxTokens: config.maxTokensPerTurn,
          signal,
          reasoningEffort,
        });
        break; // Success, exit retry loop
      } catch (error) {
        lastError = error;
        const errorStr = String(error ?? "").toLowerCase();
        const isAbort = signal?.aborted || errorStr.includes("abort") || errorStr.includes("cancelled");
        if (isAbort) {
          yield { type: "stopped", message: "Agent loop cancelled" };
          return messages;
        }
        const isRecoverable = errorStr.includes("timeout") ||
          errorStr.includes("econnrefused") ||
          errorStr.includes("fetch failed") ||
          errorStr.includes("upstream") ||
          errorStr.includes("malformed") ||
          errorStr.includes("json") ||
          errorStr.includes("context length") ||
          errorStr.includes("context window");

        if (isRecoverable && retry < maxProviderRetries) {
          const nextIsLast = retry + 1 === maxProviderRetries;
          if (nextIsLast) {
            yield {
              type: "status",
              message: `Retrying with reduced context (dropping tools and older messages)...`,
            };
          } else {
            yield {
              type: "status",
              message: `Provider error (attempt ${retry + 1}/${maxProviderRetries + 1}): ${String(error).slice(0, 100)}. Retrying...`,
            };
          }
          // Exponential backoff with jitter to avoid thundering herd (AWS best practice)
          const baseDelay = 500;
          const backoff = baseDelay * Math.pow(2, retry);
          const jitter = backoff * Math.random();
          await new Promise((resolve) => setTimeout(resolve, backoff + jitter));
          continue;
        }
        // Non-recoverable or max retries exceeded
        throw error;
      }
    }

    // Check abort after retry loop — signal may have fired during response processing
    if (signal?.aborted) {
      yield { type: "stopped", message: "Agent loop cancelled" };
      return messages;
    }

    if (!response) {
      throw lastError ?? new Error("Provider returned no response");
    }

    if (!response.toolCalls || response.toolCalls.length === 0) {
      const textToolCalls = tryParseTextAsToolCall(response.text);
      if (textToolCalls && textToolCalls.length > 0) {
        response.toolCalls = textToolCalls;
        consecutiveNudges = 0;
      } else if (response.text && turn < config.maxTurns - 1 && consecutiveNudges < MAX_NUDGES) {
        // Model returned text without tool calls — it may be describing what it
        // would do instead of doing it. Send a follow-up to nudge it toward using
        // the actual tool.
        consecutiveNudges++;
        messages.push({ role: "assistant", content: response.text });
        messages.push({
          role: "user",
          content:
            "Use the actual tool commands to accomplish this. Do not describe what you would do — execute it using the available tools (e.g., use `read <path>` to read a file, `write <path> :: <content>` to write, `terminal <command>` to run a command).",
        });
        continue;
      } else {
        messages.push({ role: "assistant", content: response.text });
        return messages;
      }
    } else {
      consecutiveNudges = 0;
    }

    messages.push({
      role: "assistant",
      content: response.text,
      tool_calls: response.toolCalls,
    });

    for (const toolCall of response.toolCalls) {
      if (signal?.aborted) break;

      let args: Record<string, unknown>;
      let parseError: string | null = null;
      try {
        args = JSON.parse(toolCall.function.arguments);
      } catch {
        // Malformed tool call args from model - try to recover
        args = {};
        parseError = `Invalid JSON in tool arguments: ${toolCall.function.arguments.slice(0, 200)}`;
        // Try to extract path from raw arguments string
        const pathMatch = toolCall.function.arguments.match(/["']?(?:path|filePath|file)["']?\s*[:=]\s*["']([^"']+)["']/i);
        if (pathMatch) {
          args.path = pathMatch[1];
        }
        const contentMatch = toolCall.function.arguments.match(/["'](?:content|text|command)["']?\s*[:=]\s*["']([\s\S]*?)["']/i);
        if (contentMatch) {
          args.content = contentMatch[1];
          args.command = contentMatch[1];
        }
      }

      // Schema validation (§4 B2)
      const toolDef = toolDefinitions.find((d) => d.name === toolCall.function.name);
      let validationError: string | null = parseError;
      if (!toolDef) {
        validationError = `Unknown tool: ${toolCall.function.name}. Available tools: ${toolDefinitions.map((d) => d.name).join(", ")}`;
      } else if (!validationError) {
        const errors = validateInput(args, toolDef.inputSchema);
        if (errors.length > 0) {
          validationError = errors.map((e) => `${e.field}: ${e.message}`).join("; ");
        }
      }

      // If validation failed, return error to model instead of executing
      if (validationError) {
        const toolDurationMs = 0;
        messages.push({
          role: "tool",
          content: JSON.stringify({
            ok: false,
            error: `Tool call validation failed for '${toolCall.function.name}': ${validationError}. Fix the arguments and try again.`,
            toolName: toolCall.function.name,
            retryable: true,
          }),
          tool_call_id: toolCall.id,
        });
        yield {
          type: "toolExecuted",
          toolName: toolCall.function.name,
          command: toolCall.function.arguments.slice(0, 100),
          status: "error",
          message: `Validation failed: ${validationError}`,
          durationMs: toolDurationMs,
        };
        continue;
      }

      yield {
        type: "status",
        message: `Executing ${toolCall.function.name}...`,
      };

      const argString = formatToolArgs(toolCall.function.name, args);
      const toolStartTime = Date.now();
      let result = await tools.runToolCall(
        `${toolCall.function.name} ${argString}`,
      );

      if (result.requiresApproval) {
        const toolName = result.toolName ?? toolCall.function.name;
        const pendingArg = result.pendingArg ?? argString;

        if (approvalCallback) {
          const approved = await approvalCallback(toolName, pendingArg);
          if (approved) {
            tools.markApproved(toolName, pendingArg);
            result = await tools.runToolCall(
              `${toolCall.function.name} ${argString}`,
            );
          } else {
            result = {
              ok: false,
              output: "Command cancelled by user.",
            };
          }
        } else {
          throw new Error(
            "Tool requires approval but no approvalCallback was provided — this is a wiring bug, not a user decision.",
          );
        }
      }

      const toolDurationMs = Date.now() - toolStartTime;
      const filesChanged = toolCall.function.name === "write" || toolCall.function.name === "append" || toolCall.function.name === "patch"
        ? [argString.split("::")[0]?.trim() ?? ""]
        : toolCall.function.name === "delete"
          ? [argString.trim()]
          : undefined;

      messages.push({
        role: "tool",
        content: result.output,
        tool_call_id: toolCall.id,
      });

      yield {
        type: "toolExecuted",
        toolName: toolCall.function.name,
        command: argString,
        status: result.ok ? "success" : "error",
        message: result.output.slice(0, 200),
        durationMs: toolDurationMs,
        filesChanged,
      };
    }
  }

  if (!timedOut && messages[messages.length - 1]?.role === "tool") {
    messages.push({
      role: "user",
      content:
        "You have used all available tool calls. Please provide a final summary of what you accomplished and what remains to be done. Do not make any more tool calls.",
    });

    const finalResponse = await router.generate(messages, {
      maxTokens: config.maxTokensPerTurn,
      signal,
      reasoningEffort,
    });

    messages.push({ role: "assistant", content: finalResponse.text });
  }

  return messages;
}
