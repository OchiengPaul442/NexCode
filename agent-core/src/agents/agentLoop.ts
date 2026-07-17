import {
  ChatMessage,
  ToolCallRequest,
  OrchestratorEvent,
  ToolCallRequestTool,
} from "../types";
import { ModelRouter } from "../providers/modelRouter";
import { ToolRegistry } from "../tools/toolRegistry";
import { ToolDefinition } from "../tools/toolProtocol";
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
      const filter = args.filter ?? args.value ?? "";
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
    default: {
      const value = args.value ?? args.input ?? args.command ?? "";
      if (typeof value === "string") {
        return value;
      }
      return JSON.stringify(args);
    }
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
): AsyncGenerator<OrchestratorEvent, ChatMessage[]> {
  const toolSchemas: ToolCallRequestTool[] = toolDefinitions.map((def) => ({
    name: def.name,
    description: def.description,
    inputSchema: def.inputSchema,
  }));

  for (let turn = 0; turn < config.maxTurns; turn++) {
    if (signal?.aborted) {
      yield { type: "stopped", message: "Agent loop cancelled" };
      return messages;
    }

    yield { type: "status", message: `Turn ${turn + 1}/${config.maxTurns}` };

    const response = await router.generate(messages, {
      tools: toolSchemas,
      maxTokens: config.maxTokensPerTurn,
      signal,
    });

    if (!response.toolCalls || response.toolCalls.length === 0) {
      messages.push({ role: "assistant", content: response.text });
      return messages;
    }

    messages.push({
      role: "assistant",
      content: response.text,
      toolCalls: response.toolCalls,
    });

    if (response.text) {
      yield { type: "token", token: response.text };
    }

    for (const toolCall of response.toolCalls) {
      if (signal?.aborted) break;

      let args: Record<string, unknown>;
      try {
        args = JSON.parse(toolCall.function.arguments);
      } catch {
        args = {};
      }

      yield {
        type: "status",
        message: `Executing ${toolCall.function.name}...`,
      };

      const argString = formatToolArgs(toolCall.function.name, args);
      let result = await tools.runToolCall(
        `${toolCall.function.name} ${argString}`,
      );

      if (result.requiresApproval) {
        const toolName = result.toolName ?? toolCall.function.name;
        const pendingArg = result.pendingArg ?? argString;

        if (approvalCallback) {
          const approved = await approvalCallback(toolName, pendingArg);
          if (approved) {
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
          yield {
            type: "toolApprovalRequired",
            toolName,
            pendingArg,
          };
          result = {
            ok: false,
            output: "AWAITING_APPROVAL",
          };
        }
      }

      messages.push({
        role: "tool",
        content: result.output,
        toolCallId: toolCall.id,
      });

      yield {
        type: "toolExecuted",
        toolName: toolCall.function.name,
        command: argString,
        status: result.ok ? "success" : "error",
        message: result.output.slice(0, 200),
      };
    }
  }

  return messages;
}
