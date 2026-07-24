import {
  type ChatMessage,
  type ToolCallRequest,
  type OrchestratorEvent,
  type ToolCallRequestTool,
  type ReasoningEffort,
  type ProviderId,
} from "../types";
import { type ModelRouter } from "../providers/modelRouter";
import { type ToolRegistry } from "../tools/toolRegistry";
import { type ToolDefinition, validateInput } from "../tools/toolProtocol";
import { type ApprovalCallback } from "../tools/toolApprovalPolicy";
import { EvidenceStore } from "../tools/evidenceStore";
import { repairTruncatedJson, extractToolCallFromMalformedJson } from "../utils/jsonRepair";
import { createDefaultRetryBudget } from "../utils/retryBudget";

export interface AgentLoopConfig {
  maxTurns: number;
  maxTokensPerTurn: number;
  timeoutMs: number;
}

/**
 * Models with known poor tool-calling support that need special handling.
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
  "llama3.2:1b",
  "llama3.2:3b",
  "mistral:7b",
  "mixtral:8x7b",
];

/**
 * Check if a model is known to have poor tool-calling support.
 */
function isPoorToolCallingModel(model: string | undefined): boolean {
  if (!model) return false;
  const lower = model.toLowerCase();
  return POOR_TOOL_CALLING_MODELS.some((m) => lower.includes(m.toLowerCase()));
}

/**
 * Build a rehearsal message with explicit tool call format instructions.
 * This is sent when the model fails to produce tool calls on the first turn.
 */
function buildToolCallRehearsalMessage(
  toolDefinitions: ToolDefinition[],
  suggestedToolName?: string,
): string {
  const toolList = toolDefinitions
    .map((t) => `- ${t.name}: ${t.description}`)
    .join("\n");

  // Find the suggested tool in definitions for a specific example
  const suggestedTool = suggestedToolName
    ? toolDefinitions.find((t) => t.name === suggestedToolName)
    : undefined;

  const examples = toolDefinitions
    .slice(0, 6)
    .map((t) => {
      const props = (t.inputSchema.properties as Record<string, unknown>) ?? {};
      const required = (t.inputSchema.required as string[]) ?? [];
      const firstProp = Object.keys(props)[0] ?? "value";
      const requiredProps = required.length > 0 ? required : [firstProp];
      const argsObj: Record<string, string> = {};
      for (const k of requiredProps) {
        argsObj[k] = "<" + k + ">";
      }
      return '{"name": "' + t.name + '", "arguments": ' + JSON.stringify(argsObj) + "}";
    })
    .join("\n");

  // Build a targeted example if we know which tool the model should use
  let targetedSection = "";
  if (suggestedTool) {
    const props = (suggestedTool.inputSchema.properties as Record<string, unknown>) ?? {};
    const required = (suggestedTool.inputSchema.required as string[]) ?? [];
    const requiredProps = required.length > 0 ? required : Object.keys(props).slice(0, 2);
    const exampleArgs: Record<string, string> = {};
    for (const k of requiredProps) {
      const prop = props[k] as Record<string, unknown> | undefined;
      const desc = prop?.description as string | undefined;
      exampleArgs[k] = `<${k}${desc ? ` (${desc})` : ""}>`;
    }
    targetedSection = [
      "",
      `You should have used the "${suggestedTool.name}" tool.`,
      `Here is the EXACT format for this tool:`,
      "```json",
      `{"name": "${suggestedTool.name}", "arguments": ${JSON.stringify(exampleArgs)}}`,
      "```",
      "",
    ].join("\n");
  }

  return [
    "IMPORTANT: You MUST use the available tools by responding with a JSON tool call.",
    "",
    "Available tools:",
    toolList,
    "",
    "You MUST respond with EXACTLY ONE JSON object in a ```json code block:",
    "```json",
    '{"name": "TOOL_NAME", "arguments": {"PARAM": "VALUE"}}',
    "```",
    targetedSection,
    "Examples:",
    examples,
    "",
    "Rules:",
    "- Always use double quotes",
    "- Always close all braces",
    "- Only one tool call per response",
    "- Do NOT describe what you would do - actually do it using a tool call",
  ].join("\n");
}

/**
 * NC-017: Privileged tools that must NOT have heuristic regex extraction.
 * When JSON parsing fails for these tools, we fail closed and return a
 * validation error to the model instead of trying to extract fields from
 * malformed input. Heuristic repair of privileged tool calls can change
 * semantics or extract dangerous substrings from otherwise invalid text.
 */
const PRIVILEGED_TOOLS = new Set([
  "write", "append", "patch", "terminal", "delete", "delete-contents",
  "move", "batch_edit", "mcp",
]);

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
      return `${p} ||| ${c}`;
    }
    case "append": {
      const p = args.path ?? args.file ?? args.filePath ?? "";
      const c = args.content ?? args.text ?? "";
      return `${p} ||| ${c}`;
    }
    case "move": {
      const src = args.source ?? args.from ?? args.src ?? "";
      const dst = args.destination ?? args.to ?? args.dest ?? "";
      return `${src} ||| ${dst}`;
    }
    case "patch": {
      const p = args.path ?? args.file ?? args.filePath ?? "";
      const oldText = args.oldText ?? args.old ?? args.oldText ?? "";
      const newText = args.newText ?? args.new ?? args.newText ?? "";
      return `${p} ||| ${oldText} ||| ${newText}`;
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
  // Try simple text format first: TOOL: <name>\nPARAM: value
  const simpleToolMatch = text.match(/TOOL:\s*(\S+)/i);
  if (simpleToolMatch) {
    const toolName = simpleToolMatch[1].toLowerCase();
    const afterToolLine = text.slice(simpleToolMatch.index! + simpleToolMatch[0].length);
    const lines = afterToolLine.split("\n");
    const args: Record<string, string> = {};

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const colonIdx = trimmed.indexOf(":");
      if (colonIdx === -1) continue;
      const key = trimmed.slice(0, colonIdx).trim().toLowerCase();
      const value = trimmed.slice(colonIdx + 1).trim();
      if (key && value) {
        args[key] = value;
      }
    }

    if (Object.keys(args).length > 0) {
      return [{
        id: `call_simple_text_${Date.now()}`,
        type: "function",
        function: { name: toolName, arguments: JSON.stringify(args) },
      }];
    }
  }

  // Try JSON code block first
  const fenceMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  const content = fenceMatch ? fenceMatch[1] : text;

  const trimmed = content.trim();

  // Try JSON format first
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
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
      // Fall through to regex extraction from malformed JSON
      const extracted = extractToolCallFromMalformedJson(trimmed);
      if (extracted) {
        return [{
          id: `call_malformed_text_${Date.now()}`,
          type: "function",
          function: {
            name: extracted.name,
            arguments: JSON.stringify(extracted.arguments),
          },
        }];
      }
    }
  }

  // Try "Proposed Edit" format with flexible variations
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
    const proposedEditMatch = trimmed.match(pattern);
    if (proposedEditMatch) {
      const filePath = proposedEditMatch[1].trim();
      const instruction = proposedEditMatch[2]?.trim() ?? "";
      
      // Try to extract content from code blocks (prefer actual code over instruction)
      const contentMatch = trimmed.match(/```[\s\S]*?```/);
      const content = contentMatch 
        ? contentMatch[0].replace(/```\w*\n?/g, '').replace(/```/g, '').trim() 
        : instruction;
      
      if (filePath && content) {
        return [{
          id: `call_proposed_${Date.now()}`,
          type: "function",
          function: {
            name: "write",
            arguments: JSON.stringify({ path: filePath, content: content }),
          },
        }];
      }
    }
  }

  // Try DSML format: <| DSML | tool_calls> <| DSML | invoke name="read"> <| DSML | parameter name="path" string="true">value<| DSML | parameter>
  const dsmlPattern = /<\|\s*\|\s*DSML\s*\|\s*\|\s*tool_calls\s*>/i;
  if (dsmlPattern.test(trimmed)) {
    const invokePattern = /<\|\s*\|\s*DSML\s*\|\s*\|\s*invoke\s+name="([^"]+)"\s*>([\s\S]*?)<\|\s*\|\s*DSML\s*\|\s*\|\s*invoke\s*>/gi;
    const calls: ToolCallRequest[] = [];
    let invokeMatch;
    while ((invokeMatch = invokePattern.exec(trimmed)) !== null) {
      const toolName = invokeMatch[1].toLowerCase();
      const body = invokeMatch[2];
      const args: Record<string, string> = {};
      
      // Extract parameters: <| DSML | parameter name="path" string="true">value<| DSML | parameter>
      const paramPattern = /<\|\s*\|\s*DSML\s*\|\s*\|\s*parameter\s+name="([^"]+)"[^>]*>([\s\S]*?)<\|\s*\|\s*DSML\s*\|\s*\|\s*parameter\s*>/gi;
      let paramMatch;
      while ((paramMatch = paramPattern.exec(body)) !== null) {
        const paramName = paramMatch[1];
        const paramValue = paramMatch[2].trim();
        args[paramName] = paramValue;
      }
      
      // Fallback: if no parameters found, try to extract value from the body text
      if (Object.keys(args).length === 0) {
        const cleanBody = body.replace(/<\|\s*\|\s*DSML\s*\|\s*\|\s*[^>]*>/gi, '').trim();
        if (cleanBody) {
          // Map to expected argument name based on tool
          if (toolName === "terminal" || toolName === "test") {
            args.command = cleanBody;
          } else if (toolName === "read" || toolName === "delete") {
            args.path = cleanBody;
          } else if (toolName === "write") {
            const sepIdx = cleanBody.indexOf("::");
            if (sepIdx !== -1) {
              args.path = cleanBody.slice(0, sepIdx).trim();
              args.content = cleanBody.slice(sepIdx + 2).trim();
            } else {
              args.path = cleanBody;
            }
          } else if (toolName === "search" || toolName === "web-search") {
            args.query = cleanBody;
          } else {
            args.path = cleanBody;
          }
        }
      }

      if (Object.keys(args).length > 0) {
        calls.push({
          id: `call_dsml_${Date.now()}_${calls.length}`,
          type: "function",
          function: {
            name: toolName,
            arguments: JSON.stringify(args),
          },
        });
      }
    }
    if (calls.length > 0) return calls;
  }

  // Try XML format: <terminal><command>...</command></terminal>
  // or <tool><name>terminal</name><args>...</args></tool>
  const xmlPatterns = [
    // Pattern: <toolName><param>value</param></toolName>
    /<(terminal|read|write|patch|delete|search|web-search|git-status|git-diff|test)>\s*<(?:command|path|content|query|arg|args)>([\s\S]*?)<\/(?:command|path|content|query|arg|args)>\s*<\/\1>/gi,
    // Pattern: <tool name="..."><param>value</param></tool>
    /<tool\s+name="(terminal|read|write|patch|delete|search|web-search|git-status|git-diff|test)"[^>]*>\s*<(?:command|path|content|query|arg|args)>([\s\S]*?)<\/(?:command|path|content|query|arg|args)>\s*<\/tool>/gi,
  ];

  for (const pattern of xmlPatterns) {
    const calls: ToolCallRequest[] = [];
    let match;
    while ((match = pattern.exec(trimmed)) !== null) {
      const toolName = match[1].toLowerCase();
      const argValue = match[2].trim();
      
      // Build arguments based on tool type
      const args: Record<string, string> = {};
      if (toolName === "terminal" || toolName === "test") {
        args.command = argValue;
      } else if (toolName === "read" || toolName === "delete") {
        args.path = argValue;
      } else if (toolName === "write") {
        // Try to parse "path :: content" format
        const sepIdx = argValue.indexOf("::");
        if (sepIdx !== -1) {
          args.path = argValue.slice(0, sepIdx).trim();
          args.content = argValue.slice(sepIdx + 2).trim();
        } else {
          args.path = argValue;
        }
      } else if (toolName === "search" || toolName === "web-search") {
        args.query = argValue;
      } else if (toolName === "patch") {
        const sepIdx = argValue.indexOf("::");
        if (sepIdx !== -1) {
          args.path = argValue.slice(0, sepIdx).trim();
          args.patch = argValue.slice(sepIdx + 2).trim();
        } else {
          args.path = argValue;
        }
      } else {
        args.command = argValue;
      }

      calls.push({
        id: `call_xml_${Date.now()}_${calls.length}`,
        type: "function",
        function: {
          name: toolName,
          arguments: JSON.stringify(args),
        },
      });
    }

    if (calls.length > 0) return calls;
  }

  // Try /tool command format: /tool terminal <command>
  const slashToolMatch = trimmed.match(/^\/tool\s+(terminal|read|write|patch|delete|search|web-search|git-status|git-diff|test)\s+(.+)$/i);
  if (slashToolMatch) {
    const toolName = slashToolMatch[1].toLowerCase();
    const argValue = slashToolMatch[2].trim();
    const args: Record<string, string> = {};
    
    if (toolName === "terminal" || toolName === "test") {
      args.command = argValue;
    } else if (toolName === "read" || toolName === "delete") {
      args.path = argValue;
    } else if (toolName === "write") {
      const sepIdx = argValue.indexOf("::");
      if (sepIdx !== -1) {
        args.path = argValue.slice(0, sepIdx).trim();
        args.content = argValue.slice(sepIdx + 2).trim();
      } else {
        args.path = argValue;
      }
    } else if (toolName === "search" || toolName === "web-search") {
      args.query = argValue;
    } else {
      args.command = argValue;
    }

    return [{
      id: `call_slash_${Date.now()}`,
      type: "function",
      function: {
        name: toolName,
        arguments: JSON.stringify(args),
      },
    }];
  }

  return null;
}

function buildReducedRetryMessages(messages: ChatMessage[]): ChatMessage[] {
  let system: ChatMessage | undefined;
  let latestUser: ChatMessage | undefined;
  const nonSystemUser: ChatMessage[] = [];

  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === "system" && !system) {
      system = m;
    } else if (m.role === "user" && !latestUser) {
      latestUser = m;
    } else if (m.role !== "system" && m.role !== "user") {
      nonSystemUser.unshift(m);
    }
  }

  const recentResults = nonSystemUser.slice(-2);

  return [system, latestUser, ...recentResults].filter(Boolean) as ChatMessage[];
}

/**
 * Guess which tool the model should have used based on the response text content.
 * Returns undefined if no clear match is found.
 */
function guessSuggestedTool(
  text: string,
  toolDefinitions: ToolDefinition[],
): string | undefined {
  const lowerText = text.toLowerCase();

  // Look for keywords that strongly suggest a specific tool
  const keywordPatterns: Array<{ keywords: string[]; tool: string }> = [
    { keywords: ["read file", "read the file", "file contents"], tool: "read" },
    { keywords: ["write file", "create file", "write to file"], tool: "write" },
    { keywords: ["run command", "execute command", "shell command", "terminal"], tool: "terminal" },
    { keywords: ["search for", "find in", "grep", "search files"], tool: "search" },
    { keywords: ["delete file", "remove file"], tool: "delete" },
    { keywords: ["git status", "check status"], tool: "git-status" },
    { keywords: ["git diff", "show changes"], tool: "git-diff" },
    { keywords: ["run test", "execute test", "test suite"], tool: "test" },
    { keywords: ["patch file", "edit file", "modify file"], tool: "patch" },
    { keywords: ["append to", "add to file"], tool: "append" },
    { keywords: ["move file", "rename file"], tool: "move" },
  ];

  for (const { keywords, tool } of keywordPatterns) {
    if (keywords.some((kw) => lowerText.includes(kw))) {
      // Verify the tool exists in definitions
      if (toolDefinitions.some((t) => t.name === tool)) {
        return tool;
      }
    }
  }

  return undefined;
}

/**
 * Detect if text describes an action that can be executed as a tool call.
 * Returns the tool name and parsed arguments if a match is found.
 */
function detectDescribedAction(
  text: string,
  toolDefinitions: ToolDefinition[],
): { toolName: string; args: Record<string, string> } | null {
  const lower = text.toLowerCase();
  const available = new Set(toolDefinitions.map((t) => t.name));

  // Terminal command patterns
  const terminalPatterns = [
    /(?:run|execute|launch|start|do)\s+(?:the\s+)?(?:command|terminal|shell|script)\s*[:：]?\s*`([^`]+)`/i,
    /(?:run|execute|launch|start|do)\s+`([^`]+)`(?:\s+(?:in|from)\s+the\s+(?:terminal|shell|command))?/i,
    /(?:running|executing|launching)\s+(?:the\s+)?(?:command|terminal|shell)\s*[:：]?\s*`([^`]+)`/i,
    /(?:running|executing)\s+`([^`]+)`/i,
    /(?:here(?:'s| is))\s+(?:the\s+)?(?:result\s+of\s+(?:running|executing)\s+)?`([^`]+)`/i,
    /(?:the\s+)?(?:command|terminal)\s+(?:would\s+)?(?:be|is)\s*[:：]?\s*`([^`]+)`/i,
    /(?:I(?:'ll| will)|let me|we (?:should|can|will))\s+(?:run|execute|launch|start)\s+(?:the\s+)?(?:command|terminal|shell)\s*[:：]?\s*`([^`]+)`/i,
    /(?:I(?:'ll| will)|let me|we (?:should|can|will))\s+(?:run|execute|launch|start)\s+`([^`]+)`/i,
  ];

  for (const pattern of terminalPatterns) {
    const match = text.match(pattern);
    if (match && available.has("terminal")) {
      return { toolName: "terminal", args: { command: match[1].trim() } };
    }
  }

  // Git command patterns
  const gitPatterns = [
    /(?:run|execute|do)\s+(?:git\s+)?((?:git\s+)?(?:status|diff|log|show|branch|stage|unstage|commit|push|pull|fetch|checkout|merge|rebase|stash|reset|revert|cherry-pick|bisect|blame|grep)\b[^.]*)/i,
    /(?:running|executing)\s+(?:git\s+)?((?:git\s+)?(?:status|diff|log|show|branch|stage|unstage|commit|push|pull|fetch|checkout|merge|rebase|stash|reset|revert|cherry-pick|bisect|blame|grep)\b[^.]*)/i,
    /(?:I(?:'ll| will)|let me)\s+(?:run|execute)\s+(?:git\s+)?((?:git\s+)?(?:status|diff|log|show|branch|stage|unstage|commit|push|pull|fetch|checkout|merge|rebase|stash|reset|revert|cherry-pick|bisect|blame|grep)\b[^.]*)/i,
  ];

  for (const pattern of gitPatterns) {
    const match = text.match(pattern);
    if (match) {
      const cmd = match[1].trim();
      const gitTool = cmd.startsWith("git ") ? cmd : `git ${cmd}`;
      if (available.has("terminal")) {
        return { toolName: "terminal", args: { command: gitTool } };
      }
    }
  }

  // Read file patterns
  const readPatterns = [
    /(?:read|show|display|open|view|cat|look at|check|inspect|examine)\s+(?:the\s+)?(?:file\s+)?[`"']?([^\s`"'.]+(?:\.\w+))[`"']?/i,
    /(?:the\s+)?(?:contents?|content)\s+(?:of\s+)?[`"']?([^\s`"'.]+(?:\.\w+))[`"']?/i,
    /(?:I(?:'ll| will)|let me)\s+(?:read|show|display|open|view|cat|look at|check|inspect|examine)\s+(?:the\s+)?(?:file\s+)?[`"']?([^\s`"'.]+(?:\.\w+))[`"']?/i,
    /(?:here(?:'s| is))\s+(?:the\s+)?(?:contents?\s+of\s+)?[`"']?([^\s`"'.]+(?:\.\w+))[`"']?/i,
  ];

  for (const pattern of readPatterns) {
    const match = text.match(pattern);
    if (match && available.has("read")) {
      return { toolName: "read", args: { path: match[1].trim() } };
    }
  }

  // Write/create file patterns
  const writePatterns = [
    /(?:create|write|make|generate)\s+(?:a\s+)?(?:new\s+)?(?:file\s+)?[`"']?([^\s`"'.]+(?:\.\w+))[`"']?\s*(?:with|containing|that contains|with content)\s*[：:]?\s*([\s\S]*?)(?:\.?\s*$|\n\n)/i,
    /(?:I(?:'ll| will)|let me)\s+(?:create|write|make|generate)\s+(?:a\s+)?(?:new\s+)?(?:file\s+)?[`"']?([^\s`"'.]+(?:\.\w+))[`"']?/i,
    /(?:writing|creating|making)\s+(?:to\s+)?(?:the\s+)?(?:file\s+)?[`"']?([^\s`"'.]+(?:\.\w+))[`"']?/i,
  ];

  for (const pattern of writePatterns) {
    const match = text.match(pattern);
    if (match && available.has("write")) {
      const filePath = match[1].trim();
      const content = match[2]?.trim() ?? "";
      return { toolName: "write", args: { path: filePath, content } };
    }
  }

  // Search patterns
  const searchPatterns = [
    /(?:search|find|grep|look for|scan)\s+(?:for\s+)?[`"']([^`"']+)[`"']\s+(?:in|across|through)\s+(?:the\s+)?(?:files?|code|workspace)/i,
    /(?:I(?:'ll| will)|let me)\s+(?:search|find|grep|look for|scan)\s+(?:for\s+)?[`"']([^`"']+)[`"']/i,
  ];

  for (const pattern of searchPatterns) {
    const match = text.match(pattern);
    if (match && available.has("search")) {
      return { toolName: "search", args: { query: match[1].trim() } };
    }
  }

  return null;
}

/**
 * Build a simplified retry message with explicit tool listing and JSON format.
 * Used when the model fails to produce valid tool calls after initial attempts.
 */
function buildSimplifiedRetryMessage(
  toolDefinitions: ToolDefinition[],
): string {
  // List only the most common tools with minimal descriptions
  const commonTools = ["read", "write", "terminal", "search", "patch", "delete"];
  const availableTools = toolDefinitions.filter((t) => commonTools.includes(t.name));
  const toolList = availableTools
    .map((t) => `  - ${t.name}: ${t.description}`)
    .join("\n");

  // Build simple examples for the most common operations
  const examples = [
    'Read a file: {"name": "read", "arguments": {"path": "src/index.ts"}}',
    'Write a file: {"name": "write", "arguments": {"path": "src/file.ts", "content": "new content"}}',
    'Run a command: {"name": "terminal", "arguments": {"command": "npm test"}}',
    'Search: {"name": "search", "arguments": {"query": "TODO"}}',
    'Patch: {"name": "patch", "arguments": {"path": "src/file.ts", "oldText": "old", "newText": "new"}}',
  ].join("\n");

  return [
    "CRITICAL: You MUST respond with a tool call in the EXACT format below.",
    "",
    "Available tools:",
    toolList,
    "",
    "RESPOND WITH EXACTLY THIS FORMAT (one JSON object in a code block):",
    "```json",
    '{"name": "TOOL_NAME", "arguments": {"PARAM": "VALUE"}}',
    "```",
    "",
    "Examples:",
    examples,
    "",
    "Rules:",
    "- Use double quotes ONLY",
    "- Close ALL braces and brackets",
    "- One tool call per response",
    "- Do NOT explain - just use the tool",
  ].join("\n");
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
  steeringProvider?: () => string | undefined,
  model?: string,
  provider?: string,
): AsyncGenerator<OrchestratorEvent, ChatMessage[]> {
  const startedAt = Date.now();
  const toolSchemas: ToolCallRequestTool[] = toolDefinitions.map((def) => ({
    name: def.name,
    description: def.description,
    inputSchema: def.inputSchema,
  }));
  let consecutiveNudges = 0;
  const MAX_NUDGES = 3;
  // Track failed tool calls to detect repeated failures on the same command pattern
  const recentFailures: Array<{ pattern: string; message: string; turn: number }> = [];
  const MAX_RECENT_FAILURES = 10;

  const MAX_TOOL_OUTPUT_TOKENS = 2000;
  const evidenceStore = new EvidenceStore();
  let timedOut = false;
  let jsonParseErrors = 0;
  const MAX_JSON_PARSE_ERRORS = 2;

  // NC-040: Create a shared retry budget for the entire agent loop run.
  // This prevents unbounded retry multiplication across provider HTTP retries,
  // cross-provider fallback candidates, and agent-loop retries.
  // Default: 8 total fetch attempts — covers the common case (1 explicit +
  // 2 HTTP retries per attempt) with headroom for one fallback candidate.
  const retryBudget = createDefaultRetryBudget();

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

    // Consume steering messages at turn boundaries
    if (steeringProvider && turn > 0) {
      let steeringMsg: string | undefined;
      while ((steeringMsg = steeringProvider()) !== undefined) {
        messages.push({ role: "user", content: `[Steering] ${steeringMsg}` });
        yield { type: "status", message: "Steering message applied" };
      }
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
        // Never drop tools - the Ollama provider handles JSON parse errors internally
        // and returns text responses that we can parse for tool calls
        const retryTools = toolSchemas;
        const retryMessages = retry === maxProviderRetries
      ? buildReducedRetryMessages(messages)
      : messages;

        response = await router.generate(retryMessages, {
          model: model,
          provider: provider as ProviderId | undefined,
          tools: retryTools,
          maxTokens: config.maxTokensPerTurn,
          signal,
          reasoningEffort,
          retryBudget,
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

    // Track JSON parse errors to prevent infinite loops
    const rawAny = response.raw as Record<string, unknown> | undefined;
    if (response.text?.includes("invalid response") || 
        response.text?.includes("couldn't process this request") ||
        response.text?.includes("model generated an invalid response") ||
        rawAny?.fallbackToText === true) {
      jsonParseErrors++;
      if (jsonParseErrors >= MAX_JSON_PARSE_ERRORS) {
        console.warn(`[agent-loop] ${jsonParseErrors} consecutive JSON parse errors, stopping loop`);
        // Return the tool result if we have one, otherwise return what we have
        for (let i = messages.length - 1; i >= 0; i--) {
          if (messages[i].role === "tool") {
            messages.push({
              role: "assistant",
              content: `I completed the request. Here's the result:\n\n${messages[i].content}`,
            });
            return messages;
          }
        }
        return messages;
      }
    } else if (rawAny?.fallbackToText !== true) {
      jsonParseErrors = 0; // Reset on successful response (not on fallback)
    }

    // Skip nudge if we've had JSON parse errors or fallback
    if (jsonParseErrors > 0 || rawAny?.fallbackToText === true) {
      // Don't nudge, just return what we have
      const lastMsg = messages[messages.length - 1];
      if (lastMsg?.role === "tool") {
        messages.push({
          role: "assistant",
          content: `I completed part of the request. Here's what was accomplished:\n\n${lastMsg.content}`,
        });
      } else {
        // No tool result - ask user to rephrase
        messages.push({
          role: "assistant",
          content: "I encountered an issue with the model's response. Could you please rephrase your request or try a different approach?",
        });
      }
      return messages;
    }

    // Tool call rehearsal mode for poor tool-calling models
    // On the first turn, if the model doesn't produce tool calls and returns
    // text without any tool call content, send a follow-up with explicit
    // format instructions before the model gets another chance.
    const shouldUseRehearsal =
      turn === 0 &&
      model &&
      isPoorToolCallingModel(model) &&
      (!response.toolCalls || response.toolCalls.length === 0) &&
      response.text &&
      !response.text.includes("```json") &&
      !response.text.includes('"name"');

    if (shouldUseRehearsal) {
      console.warn(`[agent-loop] triggering tool call rehearsal for ${model}`);
      consecutiveNudges++;
      messages.push({ role: "assistant", content: response.text });
      // Try to guess which tool the model should have used based on context
      const suggestedTool = guessSuggestedTool(response.text, toolDefinitions);
      messages.push({
        role: "user",
        content: buildToolCallRehearsalMessage(toolDefinitions, suggestedTool),
      });
      continue;
    }

    if (!response.toolCalls || response.toolCalls.length === 0) {
      const textToolCalls = tryParseTextAsToolCall(response.text);
      if (textToolCalls && textToolCalls.length > 0) {
        response.toolCalls = textToolCalls;
        consecutiveNudges = 0;
      } else if (!response.text || response.text.trim().length === 0) {
        // Model returned empty response - nudge it to try again
        if (turn < config.maxTurns - 1 && consecutiveNudges < MAX_NUDGES) {
          consecutiveNudges++;
          messages.push({ role: "assistant", content: "" });
          messages.push({
            role: "user",
            content: [
              "Your response was empty. Please provide a response using the correct JSON format for tool calls.",
              "",
              "Use this format:",
              "```json",
              '{ "name": "tool_name", "arguments": { "param": "value" } }',
              "```",
              "",
              "Examples:",
              '- To read a file: { "name": "read", "arguments": { "path": "src/index.ts" } }',
              '- To run a command: { "name": "terminal", "arguments": { "command": "npm test" } }',
              '- To search: { "name": "search", "arguments": { "query": "TODO" } }',
            ].join("\n"),
          });
          continue;
        } else {
          // Exhausted retries, return with a fallback message
          messages.push({ role: "assistant", content: "I apologize, but I was unable to generate a response. Please try rephrasing your question." });
          return messages;
        }
      } else if (turn < config.maxTurns - 1 && consecutiveNudges < MAX_NUDGES) {
        // Model returned text without tool calls — it may be describing what it
        // would do instead of doing it. Try to detect and execute the described action.
        const describedAction = detectDescribedAction(response.text, toolDefinitions);
        if (describedAction) {
          // Execute the detected action directly
          const argString = formatToolArgs(describedAction.toolName, describedAction.args);
          const toolStartTime = Date.now();
          const toolResult = await tools.runToolCall(
            `${describedAction.toolName} ${argString}`,
            signal,
          );
          const toolDurationMs = Date.now() - toolStartTime;

          yield {
            type: "toolExecuted",
            toolName: describedAction.toolName,
            command: argString,
            status: toolResult.ok ? "success" : "error",
            message: toolResult.output.slice(0, 200),
            durationMs: toolDurationMs,
          };

          // Add the assistant's text and tool result to the conversation
          messages.push({ role: "assistant", content: response.text });
          messages.push({
            role: "tool",
            content: toolResult.output.slice(0, MAX_TOOL_OUTPUT_TOKENS * 4),
            tool_call_id: `call_described_${Date.now()}`,
          });

          // Don't nudge — let the loop continue so the model sees the tool result
          continue;
        }

        // No detectable action — nudge the model to use tools
        consecutiveNudges++;
        messages.push({ role: "assistant", content: response.text });
        const useSimplified = model && isPoorToolCallingModel(model);
        messages.push({
          role: "user",
          content: useSimplified
            ? buildSimplifiedRetryMessage(toolDefinitions)
            : [
                "You described what to do but did not use a tool. Use the available structured tools directly.",
                "",
                "Respond with a JSON tool call in this format:",
                "```json",
                '{ "name": "tool_name", "arguments": { "param": "value" } }',
                "```",
                "",
                "Examples:",
                '- To edit a file: { "name": "write", "arguments": { "path": "src/file.ts", "content": "new content" } }',
                '- To run a command: { "name": "terminal", "arguments": { "command": "npm install" } }',
                '- To apply a patch: { "name": "patch", "arguments": { "path": "src/file.ts", "oldText": "old", "newText": "new" } }',
              ].join("\n"),
        });
        continue;
      } else {
        // Last turn — try to execute any described action before giving up
        const describedAction = detectDescribedAction(response.text, toolDefinitions);
        if (describedAction) {
          const argString = formatToolArgs(describedAction.toolName, describedAction.args);
          const toolStartTime = Date.now();
          const toolResult = await tools.runToolCall(
            `${describedAction.toolName} ${argString}`,
            signal,
          );
          const toolDurationMs = Date.now() - toolStartTime;

          yield {
            type: "toolExecuted",
            toolName: describedAction.toolName,
            command: argString,
            status: toolResult.ok ? "success" : "error",
            message: toolResult.output.slice(0, 200),
            durationMs: toolDurationMs,
          };

          messages.push({ role: "assistant", content: response.text });
          messages.push({
            role: "tool",
            content: toolResult.output.slice(0, MAX_TOOL_OUTPUT_TOKENS * 4),
            tool_call_id: `call_described_final_${Date.now()}`,
          });

          // Get a final summary from the model
          const finalResponse = await router.generate(messages, {
            model,
            provider: provider as ProviderId | undefined,
            maxTokens: config.maxTokensPerTurn,
            signal,
            retryBudget,
          });
          messages.push({ role: "assistant", content: finalResponse.text });
        } else {
          messages.push({ role: "assistant", content: response.text });
        }
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
        // First try to repair truncated JSON
        const repaired = repairTruncatedJson(toolCall.function.arguments);
        args = JSON.parse(repaired);
      } catch {
        // NC-017: For privileged tools, fail closed — do not heuristically
        // repair write, terminal, delete, git-write, credential, or MCP calls.
        // Heuristic recovery can change semantics or extract a dangerous
        // substring from otherwise invalid text.
        const isPrivileged = PRIVILEGED_TOOLS.has(toolCall.function.name);
        args = {};
        parseError = `Invalid JSON in tool arguments: ${toolCall.function.arguments.slice(0, 200)}`;
        if (isPrivileged) {
          // Fail closed for privileged tools — no regex extraction
        } else {
          // For read-only tools only, allow heuristic recovery and log it
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
          const commandMatch = toolCall.function.arguments.match(/["'](?:cmd)["']?\s*[:=]\s*["']([\s\S]*?)["']/i);
          if (commandMatch) {
            args.command = commandMatch[1];
          }
          const queryMatch = toolCall.function.arguments.match(/["'](?:query|search)["']?\s*[:=]\s*["']([\s\S]*?)["']/i);
          if (queryMatch) {
            args.query = queryMatch[1];
          }
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
        const expectedSchema = toolDef
          ? JSON.stringify(toolDef.inputSchema)
          : "unknown";
        messages.push({
          role: "tool",
          content: JSON.stringify({
            ok: false,
            error: `Tool call validation failed for '${toolCall.function.name}': ${validationError}. Fix the arguments and try again.`,
            expectedSchema,
            receivedArguments: toolCall.function.arguments.slice(0, 500),
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
        signal,
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
              signal,
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

      const MAX_TOOL_OUTPUT_CHARS = MAX_TOOL_OUTPUT_TOKENS * 4;
      let truncatedOutput: string;
      if (result.output.length > MAX_TOOL_OUTPUT_CHARS) {
        const evidenceId = evidenceStore.add({
          type: "tool_output",
          content: result.output,
          truncated: true,
          metadata: {
            source: `${toolCall.function.name} ${argString.slice(0, 100)}`,
            timestamp: new Date().toISOString(),
            sizeBytes: result.output.length,
          },
        });
        const head = result.output.slice(0, MAX_TOOL_OUTPUT_CHARS);
        const tailChars = 500;
        const tail = result.output.slice(-tailChars);
        truncatedOutput = [
          head,
          `\n\n[EVIDENCE: ${evidenceId}] Output truncated from ${result.output.length} chars to ~${MAX_TOOL_OUTPUT_TOKENS} tokens.`,
          `Full output stored. Last ${tailChars} chars:`,
          tail,
        ].join("\n");
      } else {
        truncatedOutput = result.output;
      }
      messages.push({
        role: "tool",
        content: truncatedOutput,
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
        sources: result.sources,
      };

      // Track failures and detect repeated failures on similar commands
      if (!result.ok) {
        const failurePattern = `${toolCall.function.name}:${argString.split(/\s+/)[0] ?? ""}`;
        recentFailures.push({ pattern: failurePattern, message: result.output.slice(0, 300), turn });
        if (recentFailures.length > MAX_RECENT_FAILURES) {
          recentFailures.shift();
        }

        // Detect blocked/dangerous commands and return a proper refusal
        if (result.output.includes("blocked") || 
            result.output.includes("dangerous") ||
            result.output.includes("forbidden") ||
            result.output.includes("not allowed")) {
          messages.push({
            role: "assistant",
            content: `I cannot execute that command. ${result.output}`,
          });
          return messages;
        }

        // Check for repeated failures on the same command pattern (same base command)
        const samePatternFailures = recentFailures.filter(f => f.pattern === failurePattern);
        if (samePatternFailures.length >= 2) {
          // Inject a warning into the tool message so the model knows it's repeating itself
          const lastMsg = messages[messages.length - 1];
          if (lastMsg && lastMsg.role === "tool") {
            const repeatedWarning = [
              "",
              `[REPEATED FAILURE WARNING] You have tried a similar ${toolCall.function.name} command ${samePatternFailures.length} times and it keeps failing.`,
              "DO NOT retry the same command. Read the [HINT] in the error output and use a DIFFERENT approach.",
              "Consider: (1) Using a different command/tool, (2) Changing the command syntax, (3) Checking if the tool/dependency is installed.",
            ].join("\n");
            lastMsg.content = lastMsg.content + repeatedWarning;
          }
        }
      } else {
        // On success, clear failures for this pattern to allow retries after fixes
        const failurePattern = `${toolCall.function.name}:${argString.split(/\s+/)[0] ?? ""}`;
        const idx = recentFailures.findIndex(f => f.pattern === failurePattern);
        if (idx !== -1) {
          recentFailures.splice(idx, 1);
        }
      }
    }
  }

  if (!timedOut && messages[messages.length - 1]?.role === "tool") {
    messages.push({
      role: "user",
      content:
        "You have used all available tool calls. Please provide a final summary of what you accomplished and what remains to be done. Do not make any more tool calls.",
    });

    const finalResponse = await router.generate(messages, {
      model: model,
      provider: provider as ProviderId | undefined,
      maxTokens: config.maxTokensPerTurn,
      signal,
      reasoningEffort,
      retryBudget,
    });

    messages.push({ role: "assistant", content: finalResponse.text });
  }

  return messages;
}
