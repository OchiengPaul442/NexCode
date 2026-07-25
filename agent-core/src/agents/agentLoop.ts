import fs from "fs/promises";
import path from "path";
import {
  type ChatMessage,
  type ToolCallRequest,
  type OrchestratorEvent,
  type ToolCallRequestTool,
  type ReasoningEffort,
  type ProviderId,
  type ToolResult,
} from "../types";
import { type ModelRouter } from "../providers/modelRouter";
import { type ToolRegistry } from "../tools/toolRegistry";
import { type ToolDefinition, validateInput } from "../tools/toolProtocol";
import { type ApprovalCallback } from "../tools/toolApprovalPolicy";
import { EvidenceStore } from "../tools/evidenceStore";
import { repairTruncatedJson, extractToolCallFromMalformedJson } from "../utils/jsonRepair";
import { createDefaultRetryBudget } from "../utils/retryBudget";
import { EnhancedMemoryManager } from "../memory/enhancedMemory";
import { HookRegistry } from "../hooks/hookRegistry";
import { PathScopedRuleManager } from "../rules/pathScopedRules";

const NOTES_FILE = "NOTES.md";
const MAX_NOTES_CHARS = 8000;

/**
 * Persistent notes manager: reads and writes a NOTES.md file in the workspace
 * so the agent can track progress across turns.
 */
class AgentNotesManager {
  private notesPath: string;
  private existingNotes = "";

  constructor(workspaceRoot: string) {
    this.notesPath = path.join(workspaceRoot, NOTES_FILE);
  }

  async load(): Promise<string> {
    try {
      this.existingNotes = await fs.readFile(this.notesPath, "utf8");
    } catch {
      this.existingNotes = "";
    }
    return this.existingNotes;
  }

  async appendNote(note: string): Promise<void> {
    const timestamp = new Date().toISOString().slice(0, 19).replace("T", " ");
    const entry = `- [${timestamp}] ${note}\n`;
    try {
      await fs.appendFile(this.notesPath, entry, "utf8");
      this.existingNotes += entry;
    } catch {
      // Best effort — don't fail the loop if notes write fails
    }
  }

  getNotesContext(): string {
    if (!this.existingNotes || this.existingNotes.trim().length === 0) return "";
    // Truncate if too long
    if (this.existingNotes.length > MAX_NOTES_CHARS) {
      const lines = this.existingNotes.split("\n");
      const keep = Math.max(4, Math.floor(lines.length * 0.6));
      const kept = lines.slice(-keep).join("\n");
      return `Previous session notes (truncated):\n${kept}`;
    }
    return `Previous session notes:\n${this.existingNotes}`;
  }

  async writeSummary(summary: string): Promise<void> {
    const header = `# Agent Session Notes\n\nThis file tracks progress across agent turns. Updated automatically.\n\n`;
    const content = `${header}${summary}\n`;
    try {
      await fs.writeFile(this.notesPath, content, "utf8");
      this.existingNotes = content;
    } catch {
      // Best effort
    }
  }
}

export interface AgentLoopConfig {
  maxTurns: number;
  maxTokensPerTurn: number;
  timeoutMs: number;
  hooks?: HookRegistry;
  pathScopedRules?: PathScopedRuleManager;
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
 * Uses the simple TOOL: text format that models produce more reliably than JSON.
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
      const paramLines = requiredProps
        .map((k) => `${k.toUpperCase()}: <${k}>`)
        .join("\n");
      return `TOOL: ${t.name}\n${paramLines}`;
    })
    .join("\n\n");

  // Build a targeted example if we know which tool the model should use
  let targetedSection = "";
  if (suggestedTool) {
    const props = (suggestedTool.inputSchema.properties as Record<string, unknown>) ?? {};
    const required = (suggestedTool.inputSchema.required as string[]) ?? [];
    const requiredProps = required.length > 0 ? required : Object.keys(props).slice(0, 2);
    const paramLines = requiredProps
      .map((k) => {
        const prop = props[k] as Record<string, unknown> | undefined;
        const desc = prop?.description as string | undefined;
        return `${k.toUpperCase()}: <${k}${desc ? ` (${desc})` : ""}>`;
      })
      .join("\n");
    targetedSection = [
      "",
      `You should have used the "${suggestedTool.name}" tool.`,
      `Here is the EXACT format for this tool:`,
      `TOOL: ${suggestedTool.name}`,
      paramLines,
      "",
    ].join("\n");
  }

  return [
    "IMPORTANT: You MUST use the available tools by responding with a tool call.",
    "Your previous response did not include a tool call. You MUST use a tool now.",
    "",
    "Available tools:",
    toolList,
    "",
    "RESPOND WITH EXACTLY ONE TOOL CALL IN THIS FORMAT:",
    "TOOL: <tool_name>",
    "<PARAMETER>: <value>",
    targetedSection,
    "Examples (copy this format exactly):",
    examples,
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

    const multiLineKeys = new Set(["content", "oldtext", "newtext", "text"]);
    let currentKey = "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) {
        if (currentKey && multiLineKeys.has(currentKey) && args[currentKey]) {
          args[currentKey] += "\n";
        }
        continue;
      }
      const kvMatch = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)/);
      if (kvMatch) {
        const key = kvMatch[1].toLowerCase();
        const value = kvMatch[2];
        currentKey = key;
        args[key] = value;
      } else if (currentKey && multiLineKeys.has(currentKey)) {
        args[currentKey] += "\n" + trimmed;
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

  // Try "call" function-call format: call tool="name" param="value"
  const callFormatMatch = text.match(/call\s+tool\s*=\s*["']([^"']+)["']/i);
  if (callFormatMatch) {
    const toolName = callFormatMatch[1].toLowerCase();
    const args: Record<string, string> = {};
    const paramPattern = /([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*["']([\s\S]*?)["']/gi;
    let paramMatch;
    while ((paramMatch = paramPattern.exec(text)) !== null) {
      const key = paramMatch[1].toLowerCase();
      if (key !== "tool") {
        args[key] = paramMatch[2];
      }
    }
    if (Object.keys(args).length > 0) {
      return [{
        id: `call_func_format_${Date.now()}`,
        type: "function",
        function: { name: toolName, arguments: JSON.stringify(args) },
      }];
    }
  }

  // Try JSON code block first
  const fenceMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  const fencedContent = fenceMatch ? fenceMatch[1].trim() : null;

  if (fencedContent && (fencedContent.startsWith("{") || fencedContent.startsWith("["))) {
    const parsed = tryParseJsonToolCall(fencedContent);
    if (parsed && parsed.length > 0) return parsed;
    
    // If the JSON code block is not a tool call, check if it looks like file content
    // Models sometimes produce the edited file content in a JSON code block instead of using TOOL: format
    try {
      const jsonContent = JSON.parse(fencedContent);
      // If it's a valid JSON object that doesn't look like a tool call
      if (jsonContent && typeof jsonContent === "object" && !jsonContent.name && !jsonContent.arguments) {
        // This looks like file content, not a tool call
        // Try to infer the file path from the text context
        const filePathMatch = text.match(/(?:file|path|to|for|in|of)\s*[`"']?([^\s`"']+\.json)[`"']?/i)
          ?? text.match(/[`"']?([^\s`"']+\.json)[`"']?/i)
          ?? text.match(/(?:file|path|to|for|in|of)\s*[`"']?([^\s`"']+\.ts)[`"']?/i)
          ?? text.match(/[`"']?([^\s`"']+\.ts)[`"']?/i)
          ?? text.match(/(?:file|path|to|for|in|of)\s*[`"']?([^\s`"']+\.js)[`"']?/i)
          ?? text.match(/[`"']?([^\s`"']+\.js)[`"']?/i);
        if (filePathMatch) {
          return [{
            id: `call_json_content_${Date.now()}`,
            type: "function",
            function: {
              name: "write",
              arguments: JSON.stringify({ path: filePathMatch[1], content: fencedContent }),
            },
          }];
        }
        
        // If no file path found in text, try to infer from the JSON structure
        // e.g., package.json has "name", "version", "scripts" fields
        if (jsonContent.scripts || jsonContent.dependencies || jsonContent.devDependencies) {
          return [{
            id: `call_json_content_${Date.now()}`,
            type: "function",
            function: {
              name: "write",
              arguments: JSON.stringify({ path: "package.json", content: fencedContent }),
            },
          }];
        }
      }
    } catch {
      // Not valid JSON, continue
    }
  }

  // Try to find JSON objects embedded anywhere in the text
  // Models often produce: "I'll read the file. {"name": "read", "arguments": {"path": "src/index.ts"}}"
  const embeddedCalls = extractEmbeddedJsonToolCalls(text);
  if (embeddedCalls && embeddedCalls.length > 0) return embeddedCalls;

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
    // Additional patterns for poor tool-calling models
    // Model says "I'll add X to file"
    /(?:I(?:'ll| will)\s+)?(?:add|insert|append)\s+(?:a\s+)?(?:new\s+)?(?:script|entry|section|line)\s+(?:called\s+)?[`"']?([^\s`"']+)[`"']?\s+(?:to|in|into)\s+[`"']?([^\s`"']+)[`"']?/i,
    // Model says "Add to package.json"
    /(?:add|insert|append)\s+(?:a\s+)?(?:new\s+)?(?:script\s+)?(?:called\s+)?[`"']?([^\s`"']+)[`"']?\s+(?:to|in|into)\s+[`"']?([^\s`"']+)[`"']?/i,
    // Model says "I'll update/modify file.ts"
    /(?:I(?:'ll| will)|let me)\s+(?:update|modify|edit|change|replace)\s+(?:the\s+)?(?:file\s+)?[`"']?([^\s`"'.]+(?:\.\w+)?)[`"']?/i,
    // "Edit file:" without heading
    /(?:Edit|Modify|Update)\s+(?:file|path)\s*:\s*[`"']?([^\s`"']+)[`"']?/i,
  ];

  const trimmedText = text.trim();
  for (const pattern of proposedEditPatterns) {
    const proposedEditMatch = trimmedText.match(pattern);
    if (proposedEditMatch) {
      const filePath = proposedEditMatch[1].trim();
      const instruction = proposedEditMatch[2]?.trim() ?? "";
      
      // Try to extract content from code blocks (prefer actual code over instruction)
      const contentMatch = trimmedText.match(/```[\s\S]*?```/);
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
  if (dsmlPattern.test(trimmedText)) {
    const invokePattern = /<\|\s*\|\s*DSML\s*\|\s*\|\s*invoke\s+name="([^"]+)"\s*>([\s\S]*?)<\|\s*\|\s*DSML\s*\|\s*\|\s*invoke\s*>/gi;
    const calls: ToolCallRequest[] = [];
    let invokeMatch;
    while ((invokeMatch = invokePattern.exec(trimmedText)) !== null) {
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
    while ((match = pattern.exec(trimmedText)) !== null) {
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
  const slashToolMatch = trimmedText.match(/^\/tool\s+(terminal|read|write|patch|delete|search|web-search|git-status|git-diff|test)\s+(.+)$/i);
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

/**
 * Try to parse a JSON string as a tool call.
 * Returns extracted tool calls, or null if parsing fails.
 */
function tryParseJsonToolCall(jsonStr: string): ToolCallRequest[] | null {
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
        calls.push({
          id: `call_json_${Date.now()}_${calls.length}`,
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
    // Not valid JSON — try regex extraction from malformed JSON
    const extracted = extractToolCallFromMalformedJson(jsonStr);
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
    return null;
  }
}

/**
 * Extract tool calls from JSON objects embedded anywhere in text.
 * Handles cases like: "I'll read the file. {"name": "read", "arguments": {"path": "src/index.ts"}}"
 * or truncated versions: "...{"name":"read","arguments":{"path":"file.ts""
 */
function extractEmbeddedJsonToolCalls(text: string): ToolCallRequest[] | null {
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
      const parsed = tryParseJsonToolCall(jsonStr);
      if (parsed && parsed.length > 0) return parsed;
      continue;
    }

    // If no complete object found but we have significant JSON content, try malformed extraction
    const remaining = text.slice(i);
    const extracted = extractToolCallFromMalformedJson(remaining);
    if (extracted) {
      return [{
        id: `call_embedded_${Date.now()}`,
        type: "function",
        function: {
          name: extracted.name,
          arguments: JSON.stringify(extracted.arguments),
        },
      }];
    }
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
    // Read
    { keywords: ["read file", "read the file", "file contents", "show file", "open file", "what's in", "what is in", "view file", "cat "], tool: "read" },
    // Write
    { keywords: ["write file", "create file", "write to file", "make file", "generate file", "new file"], tool: "write" },
    // Terminal
    { keywords: ["run command", "execute command", "shell command", "terminal", "run `", "execute `", "let me run", "try running", "list files", "show files"], tool: "terminal" },
    // Search
    { keywords: ["search for", "find in", "grep", "search files", "look for", "find all", "find typescript", "find javascript"], tool: "search" },
    // Patch
    { keywords: ["patch file", "edit file", "modify file", "update file", "change file", "replace in", "replacing", "edit the", "modify the", "update the", "change the", "add script to", "add entry to"], tool: "patch" },
    // Delete
    { keywords: ["delete file", "remove file", "delete the", "remove the", "trash file"], tool: "delete" },
    // Append
    { keywords: ["append to", "add to file", "append to file", "add to the file"], tool: "append" },
    // Move
    { keywords: ["move file", "rename file", "move the", "rename the"], tool: "move" },
    // Git (maps to terminal)
    { keywords: ["git status", "git diff", "git log", "git show", "git branch", "check status", "show changes"], tool: "terminal" },
    // Test
    { keywords: ["run test", "execute test", "test suite", "run tests"], tool: "test" },
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
    // Additional patterns for poor tool-calling models
    /(?:try|attempt)\s+(?:running|executing)\s+(?:the\s+)?(?:command|shell)?\s*`([^`]+)`/i,
    /(?:Now|Then|Next),?\s+(?:I(?:'ll| will)?)?\s+(?:run|execute|launch|start)\s+(?:the\s+)?(?:command|terminal|shell)?\s*[:：]?\s*`([^`]+)`/i,
    /(?:Let(?:'s| us))\s+(?:run|execute)\s+`([^`]+)`/i,
    /(?:going to|gonna)\s+(?:run|execute)\s+`([^`]+)`/i,
    /(?:first|next|then),?\s+(?:I(?:'ll| will)?)?\s+(?:run|execute)\s+`([^`]+)`/i,
    // Catch bare command in backticks when context implies execution
    /`([^`]+)`\s+(?:to\s+(?:test|build|install|check|lint|format|run))/i,
    // Catch "run npm test" without backticks
    /(?:run|execute|launch|start)\s+(npm\s+\S+|npx\s+\S+|yarn\s+\S+|pnpm\s+\S+|cargo\s+\S+|go\s+\S+|python\s+\S+|pip\s+\S+)/i,
  ];

  for (const pattern of terminalPatterns) {
    const match = text.match(pattern);
    if (match && available.has("terminal")) {
      return { toolName: "terminal", args: { command: match[1].trim() } };
    }
  }

  // List files patterns (maps to terminal with ls/dir command)
  const listPatterns = [
    /(?:list|show|display)\s+(?:all\s+)?(?:the\s+)?(?:files?|directory|folder|contents?)\s+(?:in\s+)?(?:the\s+)?(?:workspace|directory|folder|project)/i,
    /(?:list|show|display)\s+(?:all\s+)?(?:the\s+)?(?:files?|directory|folder|contents?)/i,
    /(?:what(?:'s| is| are))\s+(?:in\s+)?(?:the\s+)?(?:workspace|directory|folder|project)/i,
  ];

  for (const pattern of listPatterns) {
    const match = text.match(pattern);
    if (match && available.has("terminal")) {
      return { toolName: "terminal", args: { command: "ls" } };
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

  // Patch/edit file patterns
  const patchPatterns = [
    // "update/modify/replace X by replacing Y with Z"
    /(?:update|modify|edit|change|replace|fix)\s+(?:the\s+)?(?:file\s+)?[`"']?([^\s`"'.]+(?:\.\w+)?)[`"']?\s+(?:by\s+)?(?:replacing|changing|updating)\s+`([^`]+)`\s+(?:with|to)\s+`([^`]+)`/i,
    /(?:I(?:'ll| will)|let me)\s+(?:update|modify|edit|change|replace|fix)\s+(?:the\s+)?(?:file\s+)?[`"']?([^\s`"'.]+(?:\.\w+)?)[`"']?\s+(?:by\s+)?(?:replacing|changing|updating)\s+`([^`]+)`\s+(?:with|to)\s+`([^`]+)`/i,
    // "replace X with Y in file"
    /(?:replace|change|update)\s+`([^`]+)`\s+(?:with|to)\s+`([^`]+)`\s+(?:in|inside|of)\s+(?:the\s+)?(?:file\s+)?[`"']?([^\s`"'.]+(?:\.\w+)?)[`"']?/i,
    // "I'll update file" (without explicit old/new)
    /(?:I(?:'ll| will)|let me|now)\s+(?:update|modify|edit|change|fix)\s+(?:the\s+)?(?:file\s+)?[`"']?([^\s`"'.]+(?:\.\w+)?)[`"']?/i,
    /(?:update|modify|edit|change|fix)\s+(?:the\s+)?(?:file\s+)?[`"']?([^\s`"'.]+(?:\.\w+)?)[`"']?/i,
    // "apply a patch to file"
    /(?:apply|make)\s+(?:a\s+)?(?:patch|change|edit|update)\s+(?:to|in|on)\s+(?:the\s+)?(?:file\s+)?[`"']?([^\s`"'.]+(?:\.\w+)?)[`"']?/i,
  ];

  for (const pattern of patchPatterns) {
    const match = text.match(pattern);
    if (match && available.has("patch")) {
      if (match[3]) {
        return {
          toolName: "patch",
          args: { path: match[1].trim(), oldText: match[2].trim(), newText: match[3].trim() },
        };
      }
      return { toolName: "patch", args: { path: match[1].trim(), oldText: "", newText: "" } };
    }
  }

  // Delete file patterns
  const deletePatterns = [
    /(?:delete|remove|trash|unlink)\s+(?:the\s+)?(?:file\s+)?[`"']?([^\s`"'.]+(?:\.\w+)?)[`"']?/i,
    /(?:I(?:'ll| will)|let me)\s+(?:delete|remove|trash|unlink)\s+(?:the\s+)?(?:file\s+)?[`"']?([^\s`"'.]+(?:\.\w+)?)[`"']?/i,
    /(?:now|then|next),?\s+(?:I(?:'ll| will)?)?\s+(?:delete|remove|trash|unlink)\s+(?:the\s+)?(?:file\s+)?[`"']?([^\s`"'.]+(?:\.\w+)?)[`"']?/i,
    /(?:let(?:'s| us))\s+(?:delete|remove|trash|unlink)\s+(?:the\s+)?(?:file\s+)?[`"']?([^\s`"'.]+(?:\.\w+)?)[`"']?/i,
    /(?:going to|gonna)\s+(?:delete|remove|trash|unlink)\s+(?:the\s+)?(?:file\s+)?[`"']?([^\s`"'.]+(?:\.\w+)?)[`"']?/i,
  ];

  for (const pattern of deletePatterns) {
    const match = text.match(pattern);
    if (match && available.has("delete")) {
      return { toolName: "delete", args: { path: match[1].trim() } };
    }
  }

  // Append to file patterns
  const appendPatterns = [
    /(?:append|add)\s+(?:to\s+)?(?:the\s+)?(?:file\s+)?[`"']?([^\s`"'.]+(?:\.\w+)?)[`"']?\s*[:：]\s*`([^`]+)`/i,
    /(?:I(?:'ll| will)|let me)\s+(?:append|add)\s+(?:to\s+)?(?:the\s+)?(?:file\s+)?[`"']?([^\s`"'.]+(?:\.\w+)?)[`"']?/i,
    /(?:append|add)\s+`([^`]+)`\s+to\s+(?:the\s+)?(?:file\s+)?[`"']?([^\s`"'.]+(?:\.\w+)?)[`"']?/i,
    /(?:appending|adding)\s+(?:to\s+)?(?:the\s+)?(?:file\s+)?[`"']?([^\s`"'.]+(?:\.\w+)?)[`"']?/i,
  ];

  for (const pattern of appendPatterns) {
    const match = text.match(pattern);
    if (match && available.has("append")) {
      if (pattern.source.includes("`([^`]+)`\\s+to")) {
        return { toolName: "append", args: { path: match[2].trim(), content: match[1].trim() } };
      }
      return { toolName: "append", args: { path: match[1].trim(), content: match[2]?.trim() ?? "" } };
    }
  }

  // Move/rename file patterns
  const movePatterns = [
    /(?:move|rename)\s+(?:the\s+)?(?:file\s+)?[`"']?([^\s`"'.]+(?:\.\w+)?)[`"']?\s+to\s+[`"']?([^\s`"'.]+(?:\.\w+)?)[`"']?/i,
    /(?:I(?:'ll| will)|let me)\s+(?:move|rename)\s+(?:the\s+)?(?:file\s+)?[`"']?([^\s`"'.]+(?:\.\w+)?)[`"']?\s+to\s+[`"']?([^\s`"'.]+(?:\.\w+)?)[`"']?/i,
    /(?:move|rename)\s+[`"']?([^\s`"'.]+(?:\.\w+)?)[`"']?\s+(?:as|to|into)\s+[`"']?([^\s`"'.]+(?:\.\w+)?)[`"']?/i,
    /(?:going to|gonna)\s+(?:move|rename)\s+(?:the\s+)?(?:file\s+)?[`"']?([^\s`"'.]+(?:\.\w+)?)[`"']?\s+to\s+[`"']?([^\s`"'.]+(?:\.\w+)?)[`"']?/i,
  ];

  for (const pattern of movePatterns) {
    const match = text.match(pattern);
    if (match && available.has("move")) {
      return { toolName: "move", args: { source: match[1].trim(), destination: match[2].trim() } };
    }
  }

  // Search patterns
  const searchPatterns = [
    /(?:search|find|grep|look for|scan)\s+(?:for\s+)?[`"']([^`"']+)[`"']\s+(?:in|across|through)\s+(?:the\s+)?(?:files?|code|workspace)/i,
    /(?:I(?:'ll| will)|let me)\s+(?:search|find|grep|look for|scan)\s+(?:for\s+)?[`"']([^`"']+)[`"']/i,
    // Additional patterns for poor tool-calling models
    // Search for file types — extract file type as query
    /(?:search|find|grep|look\s+for|scan)\s+(?:for\s+)?(?:any\s+)?(.+?)\s+(?:files?|code)\s+(?:in\s+)?(?:the\s+)?(?:workspace|directory)/i,
    // Generic search mention
    /(?:search|find|grep)\s+(?:for\s+)?[`"']?([^\s`"']+)[`"']?/i,
    // "Find all X files" — extract file type as query
    /(?:find|locate)\s+(?:all\s+)?(?:the\s+)?(.+?)\s+(?:files?)/i,
    // "Search for TypeScript files in the workspace" — extract file type as query
    /(?:search|find|grep|look\s+for|scan)\s+(?:for\s+)?(?:any\s+)?(.+?)\s+(?:files?|code)\s+(?:in\s+)?(?:the\s+)?(?:workspace|directory|folder|project)/i,
  ];

  for (const pattern of searchPatterns) {
    const match = text.match(pattern);
    if (match && available.has("search")) {
      return { toolName: "search", args: { query: match[1]?.trim() || "TODO" } };
    }
  }

  return null;
}

/**
 * Process a text response and extract tool calls if present.
 * Implements the text-based tool call extraction fallback chain:
 *   1. Try structured text formats (TOOL:, DSML, Proposed Edit, XML)
 *   2. Try JSON code blocks
 *   3. Try described action detection
 *   4. Return null if no tool calls found
 *
 * Returns an object with either tool calls or the original text.
 */
function processTextResponse(
  text: string,
  toolDefinitions: ToolDefinition[],
): { toolCalls: ToolCallRequest[]; text: string } | null {
  if (!text || text.trim().length === 0) {
    return null;
  }

  // Try all text-based extraction formats
  const extractedCalls = tryParseTextAsToolCall(text);
  if (extractedCalls && extractedCalls.length > 0) {
    return { toolCalls: extractedCalls, text };
  }

  // Try described action detection as a last resort
  let describedAction = null;
  try {
    describedAction = detectDescribedAction(text, toolDefinitions);
  } catch {
    // Pattern matching error — fall through to null return
  }
  if (describedAction) {
    const args: Record<string, string> = {};
    // Map the detected action args to proper tool call format
    for (const [key, value] of Object.entries(describedAction.args)) {
      args[key] = value;
    }
    return {
      toolCalls: [{
        id: `call_process_text_${Date.now()}`,
        type: "function",
        function: {
          name: describedAction.toolName,
          arguments: JSON.stringify(args),
        },
      }],
      text,
    };
  }

  return null;
}

/**
 * Build a simplified retry message with explicit tool listing and simple text format.
 * Used when the model fails to produce valid tool calls after initial attempts.
 * Uses the TOOL: text format that models produce more reliably than JSON.
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
    "Read a file:\nTOOL: read\nPATH: src/index.ts",
    "Write a file:\nTOOL: write\nPATH: src/file.ts\nCONTENT: new content",
    "Run a command:\nTOOL: terminal\nCOMMAND: npm test",
    "Search:\nTOOL: search\nQUERY: TODO",
    "Patch:\nTOOL: patch\nPATH: src/file.ts\nOLDTEXT: old\nNEWTEXT: new",
  ].join("\n\n");

  return [
    "CRITICAL: You MUST respond with a tool call in the EXACT format below.",
    "Your previous response did not include a valid tool call.",
    "",
    "Available tools:",
    toolList,
    "",
    "RESPOND WITH EXACTLY THIS FORMAT (copy it exactly):",
    "TOOL: <tool_name>",
    "<PARAMETER>: <value>",
    "",
    "Examples (copy this format):",
    examples,
    "",
    "RULES (follow these exactly):",
    "- TOOL: must be on its own line, followed by the tool name",
    "- Each parameter must be on its own line as KEY: VALUE",
    "- One tool call per response",
    "- Do NOT explain - just use the tool",
    "- Do NOT use JSON, code blocks, or any other format - use ONLY the plain text format above",
    "- Do NOT add extra text before or after the tool call",
    "- Do NOT wrap the tool call in markdown code blocks (```...```)",
    "- Do NOT use curly braces {} or square brackets [] anywhere in your response",
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
  workspaceRoot?: string,
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

  // Persistent notes system: load existing notes and inject into context
  const notesManager = workspaceRoot ? new AgentNotesManager(workspaceRoot) : null;
  if (notesManager) {
    await notesManager.load();
    const notesContext = notesManager.getNotesContext();
    if (notesContext) {
      // Inject notes into the initial user message context
      for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].role === "user") {
          const original = messages[i].content;
          messages[i] = {
            ...messages[i],
            content: `${original}\n\n${notesContext}`,
          };
          break;
        }
      }
    }
  }

  // Enhanced memory system: load project memory and inject into context
  const enhancedMemory = workspaceRoot ? new EnhancedMemoryManager(workspaceRoot) : null;
  if (enhancedMemory) {
    await enhancedMemory.initialize();
    const memoryContext = enhancedMemory.getContext();
    if (memoryContext) {
      for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].role === "user") {
          const original = messages[i].content;
          messages[i] = {
            ...messages[i],
            content: `${original}\n\n${memoryContext}`,
          };
          break;
        }
      }
    }
  }

  let completedTurns = 0;
  for (let turn = 0; turn < config.maxTurns; turn++) {
    completedTurns = turn + 1;
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
      !response.text.includes("TOOL:") &&
      !response.text.includes("```json") &&
      !/(?:\"name\"\s*:\s*\"(?:read|write|terminal|search|patch|delete|test|git-status|git-diff))/i.test(response.text);

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
      // Try text-based tool call extraction (combined format detection + described action)
      const textResult = processTextResponse(response.text, toolDefinitions);
      if (textResult && textResult.toolCalls.length > 0) {
        response.toolCalls = textResult.toolCalls;
        consecutiveNudges = 0;
      } else if (!response.text || response.text.trim().length === 0) {
        // Model returned empty response - nudge it to try again
        if (turn < config.maxTurns - 1 && consecutiveNudges < MAX_NUDGES) {
          consecutiveNudges++;
          messages.push({ role: "assistant", content: "" });
          messages.push({
            role: "user",
            content: [
              "Your response was empty. Please provide a response using the correct text format for tool calls.",
              "",
              "Use this format:",
              "TOOL: <tool_name>",
              "<PARAMETER>: <value>",
              "",
              "Examples:",
              "- To read a file: TOOL: read\nPATH: src/index.ts",
              "- To run a command: TOOL: terminal\nCOMMAND: npm test",
              "- To search: TOOL: search\nQUERY: TODO",
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
        let describedAction = null;
        try {
          describedAction = detectDescribedAction(response.text, toolDefinitions);
        } catch {
          // Pattern matching error — nudge instead
        }
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
                "Respond with a tool call in this format:",
                "TOOL: <tool_name>",
                "<PARAMETER>: <value>",
                "",
                "Examples:",
                "- To edit a file: TOOL: write\nPATH: src/file.ts\nCONTENT: new content",
                "- To run a command: TOOL: terminal\nCOMMAND: npm install",
                "- To apply a patch: TOOL: patch\nPATH: src/file.ts\nOLDTEXT: old\nNEWTEXT: new",
              ].join("\n"),
        });
        continue;
      } else {
        // Last turn — try to execute any described action before giving up
        let describedAction = null;
        try {
          describedAction = detectDescribedAction(response.text, toolDefinitions);
        } catch {
          // Pattern matching error — fall through
        }
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
        // Exception: Allow heuristic recovery for poor tool-calling models
        // since they frequently produce malformed JSON but still intend valid calls.
        const isPrivileged = PRIVILEGED_TOOLS.has(toolCall.function.name);
        const isPoorModel = model && isPoorToolCallingModel(model);
        args = {};
        parseError = `Invalid JSON in tool arguments: ${toolCall.function.arguments.slice(0, 200)}`;
        if (isPrivileged && !isPoorModel) {
          // Fail closed for privileged tools on capable models — no regex extraction
        } else {
          // For read-only tools and poor tool-calling models, allow heuristic recovery
          // Try to extract path from raw arguments string
          const pathMatch = toolCall.function.arguments.match(/["']?(?:path|filePath|file)["']?\s*[:=]\s*["']([^"']+)["']/i);
          if (pathMatch) {
            args.path = pathMatch[1];
          }
          const contentMatch = toolCall.function.arguments.match(/["'](?:content|text)["']?\s*[:=]\s*"([\s\S]*?)"/i)
            ?? toolCall.function.arguments.match(/["'](?:content|text)["']?\s*[:=]\s*'([\s\S]*?)'/i);
          if (contentMatch) {
            args.content = contentMatch[1];
          }
          const commandMatch = toolCall.function.arguments.match(/["'](?:command|cmd)["']?\s*[:=]\s*["']([\s\S]*?)["']/i);
          if (commandMatch) {
            args.command = commandMatch[1];
          }
          const queryMatch = toolCall.function.arguments.match(/["'](?:query|search)["']?\s*[:=]\s*["']([\s\S]*?)["']/i);
          if (queryMatch) {
            args.query = queryMatch[1];
          }
          // For terminal/test, map content to command if no explicit command found
          if ((toolCall.function.name === "terminal" || toolCall.function.name === "test") && args.content && !args.command) {
            args.command = args.content;
          }
          // Clear parseError if we successfully extracted args
          if (Object.keys(args).length > 0) {
            parseError = null;
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

      // Execute before hooks
      if (config.hooks) {
        const shouldContinue = await config.hooks.executeBefore(toolCall.function.name, argString);
        if (!shouldContinue) {
          messages.push({
            role: "tool",
            content: JSON.stringify({ ok: false, error: "Tool execution prevented by hook" }),
            tool_call_id: toolCall.id,
          });
          yield {
            type: "toolExecuted",
            toolName: toolCall.function.name,
            command: argString.split("|||")[0]?.trim().slice(0, 100) ?? "",
            status: "error",
            message: "Blocked by hook",
            durationMs: 0,
          };
          continue;
        }
      }

      // Inject path-scoped rules context if applicable
      if (config.pathScopedRules && toolCall.function.name !== "read") {
        const filePath = argString.split("|||")[0]?.trim();
        if (filePath) {
          const rulesContext = config.pathScopedRules.buildContext(filePath, toolCall.function.name);
          if (rulesContext) {
            // Append rules context to the tool arguments for the model
            console.log(`[agent-loop] Path-scoped rules applied for ${filePath}: ${rulesContext.slice(0, 100)}`);
          }
        }
      }

      const toolStartTime = Date.now();
      
      // Retry logic for transient tool execution errors
      const MAX_TOOL_RETRIES = 2;
      let result: ToolResult | null = null;
      let lastToolError: string | null = null;
      
      for (let toolRetry = 0; toolRetry <= MAX_TOOL_RETRIES; toolRetry++) {
        try {
          result = await tools.runToolCall(
            `${toolCall.function.name} ${argString}`,
            signal,
          );
          
          // If tool succeeded or returned a non-retryable error, break
          if (result.ok || !result.output.includes("timeout")) {
            break;
          }
          
          lastToolError = result.output;
          
          // Only retry for transient errors (timeout, network)
          if (toolRetry < MAX_TOOL_RETRIES) {
            const delay = 1000 * Math.pow(2, toolRetry) + Math.random() * 500;
            await new Promise(resolve => setTimeout(resolve, delay));
            console.warn(`[agent-loop] Retrying ${toolCall.function.name} (attempt ${toolRetry + 2}/${MAX_TOOL_RETRIES + 1})`);
          }
        } catch (error) {
          lastToolError = String(error);
          if (toolRetry < MAX_TOOL_RETRIES) {
            const delay = 1000 * Math.pow(2, toolRetry) + Math.random() * 500;
            await new Promise(resolve => setTimeout(resolve, delay));
            console.warn(`[agent-loop] Retrying ${toolCall.function.name} after error (attempt ${toolRetry + 2}/${MAX_TOOL_RETRIES + 1})`);
          }
        }
      }
      
      // If all retries failed, use the last error
      if (!result) {
        result = {
          ok: false,
          output: lastToolError ?? "Tool execution failed after retries",
        };
      }

      // Execute after hooks
      if (config.hooks) {
        await config.hooks.executeAfter(toolCall.function.name, argString, result);
      }

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
          // Auto-approve low-risk writes when no approval callback is provided
          const lowRiskTools = new Set(["write", "append", "patch"]);
          if (lowRiskTools.has(toolName)) {
            tools.markApproved(toolName, pendingArg);
            result = await tools.runToolCall(
              `${toolCall.function.name} ${argString}`,
              signal,
            );
          } else {
            throw new Error(
              "Tool requires approval but no approvalCallback was provided — this is a wiring bug, not a user decision.",
            );
          }
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

      // Persistent notes: record significant successful operations
      if (notesManager && result.ok) {
        const noteTools = new Set(["write", "patch", "append", "delete", "move", "terminal", "test", "git-commit", "batch_edit"]);
        if (noteTools.has(toolCall.function.name)) {
          const noteSummary = `${toolCall.function.name} ${argString.slice(0, 80)}${result.output.length > 0 ? ` → ${result.output.slice(0, 120)}` : ""}`;
          await notesManager.appendNote(noteSummary);
        }
      }

      // Enhanced memory: record successful file operations and commands
      if (enhancedMemory && result.ok) {
        const fileTools = new Set(["write", "patch", "append", "delete", "move"]);
        if (fileTools.has(toolCall.function.name)) {
          const filePath = argString.split("|||")[0]?.trim() ?? "";
          await enhancedMemory.addEntry({
            topic: "file-changes",
            content: `${toolCall.function.name}: ${filePath}`,
            source: "agent-loop",
          });
        } else if (toolCall.function.name === "terminal") {
          await enhancedMemory.addEntry({
            topic: "commands",
            content: `Executed: ${argString.slice(0, 100)}${result.output.length > 0 ? ` → ${result.output.slice(0, 100)}` : ""}`,
            source: "agent-loop",
          });
        }
      }

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

  // Persistent notes: write a summary at the end of the loop
  if (notesManager) {
    const toolCalls = messages.filter((m) => m.role === "assistant" && m.tool_calls?.length);
    const toolNames = [...new Set(toolCalls.flatMap((m) => m.tool_calls!.map((tc) => tc.function.name)))];
    const summary = `## Loop completed (${completedTurns}/${config.maxTurns} turns)\nTools used: ${toolNames.join(", ") || "none"}\n`;
    await notesManager.writeSummary(summary);
  }

  // Enhanced memory: prune to stay under limits
  if (enhancedMemory) {
    await enhancedMemory.prune();
  }

  return messages;
}
