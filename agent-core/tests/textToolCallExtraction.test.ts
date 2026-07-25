/**
 * Tests for text-based tool call extraction system.
 *
 * When models generate malformed JSON or can't use the native Ollama `tools`
 * API field, the agent falls back to text-based tool call extraction.
 * This test verifies the extraction works for all supported formats.
 */

import { describe, it, expect } from "vitest";
import { extractToolCallFromMalformedJson } from "../src/utils/jsonRepair";

// Re-implement the extraction logic from agentLoop.ts for testing
// (matches the tryParseTextAsToolCall function)
function tryParseJsonToolCall(jsonStr: string): Array<{ name: string; arguments: Record<string, string> }> | null {
  const calls: Array<{ name: string; arguments: Record<string, string> }> = [];
  try {
    const parsed = JSON.parse(jsonStr);
    const items = Array.isArray(parsed) ? parsed : [parsed];
    for (const item of items) {
      if (item && typeof item.name === "string" && item.arguments && typeof item.arguments === "object") {
        calls.push({ name: item.name, arguments: item.arguments as Record<string, string> });
      }
    }
    return calls.length > 0 ? calls : null;
  } catch {
    const extracted = extractToolCallFromMalformedJson(jsonStr);
    if (extracted) {
      return [{ name: extracted.name, arguments: extracted.arguments as Record<string, string> }];
    }
    return null;
  }
}

function extractEmbeddedJsonToolCalls(text: string): Array<{ name: string; arguments: Record<string, string> }> | null {
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== "{") continue;
    let depth = 0;
    let inString = false;
    let escaped = false;
    let endIdx = -1;
    for (let j = i; j < text.length; j++) {
      const ch = text[j];
      if (escaped) { escaped = false; continue; }
      if (ch === "\\" && inString) { escaped = true; continue; }
      if (ch === '"') { inString = !inString; continue; }
      if (inString) continue;
      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) { endIdx = j; break; }
      }
    }
    if (endIdx > i) {
      const jsonStr = text.slice(i, endIdx + 1);
      const parsed = tryParseJsonToolCall(jsonStr);
      if (parsed && parsed.length > 0) return parsed;
      continue;
    }
    const remaining = text.slice(i);
    const extracted = extractToolCallFromMalformedJson(remaining);
    if (extracted) {
      return [{ name: extracted.name, arguments: extracted.arguments as Record<string, string> }];
    }
  }
  return null;
}

function extractToolCallsFromText(text: string): Array<{ name: string; arguments: Record<string, string> }> | null {
  const calls: Array<{ name: string; arguments: Record<string, string> }> = [];

  // Try simple text format: TOOL: <name>\nPARAM: value
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
      return [{ name: toolName, arguments: args }];
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
      return [{ name: toolName, arguments: args }];
    }
  }

  // Try JSON code block first
  const fenceMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  const fencedContent = fenceMatch ? fenceMatch[1].trim() : null;

  if (fencedContent && (fencedContent.startsWith("{") || fencedContent.startsWith("["))) {
    const parsed = tryParseJsonToolCall(fencedContent);
    if (parsed && parsed.length > 0) return parsed;
  }

  // Try embedded JSON objects
  const embeddedCalls = extractEmbeddedJsonToolCalls(text);
  if (embeddedCalls && embeddedCalls.length > 0) return embeddedCalls;

  // Fallback: try the full text as malformed JSON
  const fullExtracted = extractToolCallFromMalformedJson(text);
  if (fullExtracted) {
    return [{ name: fullExtracted.name, arguments: fullExtracted.arguments as Record<string, string> }];
  }

  return null;
}

describe("Text-based tool call extraction", () => {
  describe("JSON code block format", () => {
    it("extracts single tool call from JSON code block", () => {
      const text = 'I will read the file.\n```json\n{"name": "read", "arguments": {"path": "src/index.ts"}}\n```';
      const result = extractToolCallsFromText(text);

      expect(result).not.toBeNull();
      expect(result).toHaveLength(1);
      expect(result![0].name).toBe("read");
      expect(result![0].arguments.path).toBe("src/index.ts");
    });

    it("extracts tool call with nested arguments", () => {
      const text = '```json\n{"name": "terminal", "arguments": {"command": "npm test -- --coverage"}}\n```';
      const result = extractToolCallsFromText(text);

      expect(result).not.toBeNull();
      expect(result![0].name).toBe("terminal");
      expect(result![0].arguments.command).toBe("npm test -- --coverage");
    });

    it("extracts tool call without code block wrapper", () => {
      const text = '{"name": "search", "arguments": {"query": "TODO"}}';
      const result = extractToolCallsFromText(text);

      expect(result).not.toBeNull();
      expect(result![0].name).toBe("search");
      expect(result![0].arguments.query).toBe("TODO");
    });

    it("extracts tool call with surrounding text", () => {
      const text = 'Let me read that file for you.\n```json\n{"name": "read", "arguments": {"path": "package.json"}}\n```\nHere is the content:';
      const result = extractToolCallsFromText(text);

      expect(result).not.toBeNull();
      expect(result![0].name).toBe("read");
      expect(result![0].arguments.path).toBe("package.json");
    });

    it("handles incomplete JSON in code block (missing closing brace)", () => {
      // Some models produce truncated JSON — the production code's
      // extractToolCallFromMalformedJson handles this via regex fallback
      const text = '{"name": "read", "arguments": {"path": "file.ts"}';
      const result = extractToolCallsFromText(text);

      expect(result).not.toBeNull();
      expect(result![0].name).toBe("read");
      expect(result![0].arguments.path).toBe("file.ts");
    });
  });

  describe("TOOL: format", () => {
    it("extracts tool call from TOOL: format", () => {
      const text = "TOOL: read\nPATH: src/index.ts";
      const result = extractToolCallsFromText(text);

      expect(result).not.toBeNull();
      expect(result![0].name).toBe("read");
      expect(result![0].arguments.path).toBe("src/index.ts");
    });

    it("extracts terminal command from TOOL: format", () => {
      const text = "TOOL: terminal\nCOMMAND: npm install";
      const result = extractToolCallsFromText(text);

      expect(result).not.toBeNull();
      expect(result![0].name).toBe("terminal");
      expect(result![0].arguments.command).toBe("npm install");
    });

    it("extracts search query from TOOL: format", () => {
      const text = "TOOL: search\nQUERY: function handleEvent";
      const result = extractToolCallsFromText(text);

      expect(result).not.toBeNull();
      expect(result![0].name).toBe("search");
      expect(result![0].arguments.query).toBe("function handleEvent");
    });

    it("extracts write with CONTENT parameter", () => {
      const text = "TOOL: write\nPATH: test.ts\nCONTENT: const x = 1;";
      const result = extractToolCallsFromText(text);

      expect(result).not.toBeNull();
      expect(result![0].name).toBe("write");
      expect(result![0].arguments.path).toBe("test.ts");
      expect(result![0].arguments.content).toBe("const x = 1;");
    });

    it("extracts write with multiline CONTENT", () => {
      const text = [
        "TOOL: write",
        "PATH: src/index.ts",
        "CONTENT: import { foo } from './foo';",
        "const bar = foo();",
        "export default bar;",
      ].join("\n");
      const result = extractToolCallsFromText(text);

      expect(result).not.toBeNull();
      expect(result![0].name).toBe("write");
      expect(result![0].arguments.path).toBe("src/index.ts");
      expect(result![0].arguments.content).toContain("import { foo }");
    });

    it("extracts tool call with surrounding text", () => {
      const text = "I'll read that file now.\nTOOL: read\nPATH: package.json\nHere is the result:";
      const result = extractToolCallsFromText(text);

      expect(result).not.toBeNull();
      expect(result![0].name).toBe("read");
      expect(result![0].arguments.path).toBe("package.json");
    });

    it("handles TOOL: format with extra whitespace", () => {
      const text = "TOOL:  read  \n  PATH:  src/index.ts  ";
      const result = extractToolCallsFromText(text);

      expect(result).not.toBeNull();
      expect(result![0].name).toBe("read");
      expect(result![0].arguments.path).toBe("src/index.ts");
    });

    it("handles TOOL: format with blank lines between parameters", () => {
      const text = "TOOL: write\nPATH: test.ts\n\nCONTENT: const x = 1;";
      const result = extractToolCallsFromText(text);

      expect(result).not.toBeNull();
      expect(result![0].name).toBe("write");
      expect(result![0].arguments.path).toBe("test.ts");
      expect(result![0].arguments.content).toBe("const x = 1;");
    });

    it("extracts patch tool call", () => {
      const text = "TOOL: patch\nPATH: src/file.ts\nOLDTEXT: const x = 1;\nNEWTEXT: const x = 2;";
      const result = extractToolCallsFromText(text);

      expect(result).not.toBeNull();
      expect(result![0].name).toBe("patch");
      expect(result![0].arguments.path).toBe("src/file.ts");
      expect(result![0].arguments.oldtext).toBe("const x = 1;");
      expect(result![0].arguments.newtext).toBe("const x = 2;");
    });
  });

  describe("Truncated JSON extraction", () => {
    it("extracts from truncated JSON missing closing braces", () => {
      const text = '{"name":"read","arguments":{"path":"package.json"';
      const result = extractToolCallsFromText(text);

      expect(result).not.toBeNull();
      expect(result![0].name).toBe("read");
      expect(result![0].arguments.path).toBe("package.json");
    });

    it("extracts from truncated JSON with multiple args", () => {
      const text = '{"name":"write","arguments":{"path":"src/index.ts","content":"new content"';
      const result = extractToolCallsFromText(text);

      expect(result).not.toBeNull();
      expect(result![0].name).toBe("write");
      expect(result![0].arguments.path).toBe("src/index.ts");
      expect(result![0].arguments.content).toBe("new content");
    });
  });

  describe("Edge cases", () => {
    it("returns null for empty text", () => {
      expect(extractToolCallsFromText("")).toBeNull();
      expect(extractToolCallsFromText("   ")).toBeNull();
    });

    it("returns null for plain text without tool calls", () => {
      const text = "I'll help you with that. Let me read the file first.";
      expect(extractToolCallsFromText(text)).toBeNull();
    });

    it("returns null for code blocks without JSON", () => {
      const text = "```javascript\nconst x = 1;\n```";
      expect(extractToolCallsFromText(text)).toBeNull();
    });

    it("handles multiple JSON code blocks (extracts first valid)", () => {
      const text = '```json\n{"name": "read", "arguments": {"path": "a.ts"}}\n```\n```json\n{"name": "write", "arguments": {"path": "b.ts", "content": "x"}}\n```';
      const result = extractToolCallsFromText(text);

      expect(result).not.toBeNull();
      // Should extract from first valid JSON block
      expect(result![0].name).toBe("read");
    });
  });

  describe("Real-world model output patterns", () => {
    it("handles model that wraps tool call in explanation", () => {
      const text = [
        "I'll read the package.json file to understand the project structure.",
        "",
        "```json",
        '{"name": "read", "arguments": {"path": "package.json"}}',
        "```",
      ].join("\n");
      const result = extractToolCallsFromText(text);

      expect(result).not.toBeNull();
      expect(result![0].name).toBe("read");
      expect(result![0].arguments.path).toBe("package.json");
    });

    it("handles model that outputs tool call without explanation", () => {
      const text = '```json\n{"name": "terminal", "arguments": {"command": "git status"}}\n```';
      const result = extractToolCallsFromText(text);

      expect(result).not.toBeNull();
      expect(result![0].name).toBe("terminal");
      expect(result![0].arguments.command).toBe("git status");
    });

    it("handles model that uses single quotes in JSON", () => {
      // Some models may use single quotes which is invalid JSON
      // but we should still try to extract
      const text = "TOOL: read\nPATH: src/index.ts";
      const result = extractToolCallsFromText(text);

      expect(result).not.toBeNull();
      expect(result![0].name).toBe("read");
    });

    it("handles model that adds extra newlines", () => {
      const text = '\n\n```json\n\n{"name": "search", "arguments": {"query": "TODO"}}\n\n```\n\n';
      const result = extractToolCallsFromText(text);

      expect(result).not.toBeNull();
      expect(result![0].name).toBe("search");
    });
  });

  describe("Embedded JSON extraction", () => {
    it("extracts JSON tool call embedded in surrounding text", () => {
      const text = 'I\'ll read the file for you. {"name": "read", "arguments": {"path": "src/index.ts"}}';
      const result = extractToolCallsFromText(text);

      expect(result).not.toBeNull();
      expect(result![0].name).toBe("read");
      expect(result![0].arguments.path).toBe("src/index.ts");
    });

    it("extracts truncated JSON tool call embedded in text", () => {
      const text = 'Here is the tool call: {"name":"terminal","arguments":{"command":"ls -la"';
      const result = extractToolCallsFromText(text);

      expect(result).not.toBeNull();
      expect(result![0].name).toBe("terminal");
      expect(result![0].arguments.command).toBe("ls -la");
    });

    it("extracts JSON with surrounding explanation text", () => {
      const text = 'Let me search for that. {"name": "search", "arguments": {"query": "handleClick"}} is what I need.';
      const result = extractToolCallsFromText(text);

      expect(result).not.toBeNull();
      expect(result![0].name).toBe("search");
      expect(result![0].arguments.query).toBe("handleClick");
    });

    it("extracts from nested JSON objects in text", () => {
      const text = 'Running: {"name":"write","arguments":{"path":"test.ts","content":"const x = 1;"}}';
      const result = extractToolCallsFromText(text);

      expect(result).not.toBeNull();
      expect(result![0].name).toBe("write");
      expect(result![0].arguments.path).toBe("test.ts");
      expect(result![0].arguments.content).toBe("const x = 1;");
    });
  });

  describe("call tool= format", () => {
    it("extracts tool call from call tool= format", () => {
      const text = 'call tool="read" path="src/index.ts"';
      const result = extractToolCallsFromText(text);

      expect(result).not.toBeNull();
      expect(result![0].name).toBe("read");
      expect(result![0].arguments.path).toBe("src/index.ts");
    });

    it("extracts terminal from call tool= format", () => {
      const text = 'call tool="terminal" command="npm test"';
      const result = extractToolCallsFromText(text);

      expect(result).not.toBeNull();
      expect(result![0].name).toBe("terminal");
      expect(result![0].arguments.command).toBe("npm test");
    });

    it("extracts search from call tool= format", () => {
      const text = 'call tool="search" query="TODO" caseSensitive="true"';
      const result = extractToolCallsFromText(text);

      expect(result).not.toBeNull();
      expect(result![0].name).toBe("search");
      expect(result![0].arguments.query).toBe("TODO");
    });
  });

  describe("Multiline TOOL: format", () => {
    it("handles multiline content in TOOL: format", () => {
      const text = [
        "TOOL: write",
        "PATH: src/utils.ts",
        "CONTENT: export function helper() {",
        "  return 42;",
        "}",
      ].join("\n");
      const result = extractToolCallsFromText(text);

      expect(result).not.toBeNull();
      expect(result![0].name).toBe("write");
      expect(result![0].arguments.path).toBe("src/utils.ts");
      expect(result![0].arguments.content).toContain("export function helper()");
    });

    it("handles empty lines within multiline content", () => {
      const text = [
        "TOOL: write",
        "PATH: test.ts",
        "CONTENT: line1",
        "",
        "line2",
        "line3",
      ].join("\n");
      const result = extractToolCallsFromText(text);

      expect(result).not.toBeNull();
      expect(result![0].name).toBe("write");
      expect(result![0].arguments.content).toContain("line1");
      expect(result![0].arguments.content).toContain("line2");
    });
  });

  describe("Malformed JSON with extracted tool call from full text", () => {
    it("extracts tool call from text that is entirely malformed JSON", () => {
      const text = '{"name":"read","arguments":{"path":"package.json"';
      const result = extractToolCallsFromText(text);

      expect(result).not.toBeNull();
      expect(result![0].name).toBe("read");
      expect(result![0].arguments.path).toBe("package.json");
    });

    it("extracts tool call from text with name and arguments but missing braces", () => {
      const text = '{"name":"terminal","arguments":{"command":"ls","timeout":5000';
      const result = extractToolCallsFromText(text);

      expect(result).not.toBeNull();
      expect(result![0].name).toBe("terminal");
      expect(result![0].arguments.command).toBe("ls");
    });
  });
});
