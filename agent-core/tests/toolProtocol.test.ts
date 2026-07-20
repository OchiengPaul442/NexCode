import { describe, it, expect } from "vitest";
import {
  TOOL_DEFINITIONS,
  getToolDefinition,
  getAllToolDefinitions,
} from "../src/tools/toolDefinitions";
import {
  validateInput,
  createStructuredResult,
  StructuredToolResult,
} from "../src/tools/toolProtocol";
import { ToolRegistry } from "../src/tools/toolRegistry";

describe("Tool definitions", () => {
  it("has definitions for all expected tools", () => {
    const expected = [
      "search",
      "web-search",
      "terminal",
      "git-status",
      "git-diff",
      "git-branch",
      "test",
      "read",
      "write",
      "append",
      "move",
      "delete",
      "delete-contents",
      "mcp",
    ];
    const names = TOOL_DEFINITIONS.map((d) => d.name);
    for (const name of expected) {
      expect(names).toContain(name);
    }
  });

  it("every definition has required fields", () => {
    for (const def of TOOL_DEFINITIONS) {
      expect(def.name).toBeTruthy();
      expect(def.version).toBeTruthy();
      expect(def.title).toBeTruthy();
      expect(def.description).toBeTruthy();
      expect(def.risk).toBeTruthy();
      expect(def.timeoutMs).toBeGreaterThan(0);
      expect(def.inputSchema).toBeDefined();
    }
  });

  it("getToolDefinition returns known tool", () => {
    const def = getToolDefinition("read");
    expect(def).toBeDefined();
    expect(def!.name).toBe("read");
    expect(def!.risk).toBe("read-only");
  });

  it("getToolDefinition returns undefined for unknown tool", () => {
    expect(getToolDefinition("nonexistent")).toBeUndefined();
  });

  it("getAllToolDefinitions returns a copy", () => {
    const all = getAllToolDefinitions();
    const all2 = getAllToolDefinitions();
    expect(all).toEqual(all2);
    expect(all).not.toBe(all2);
  });

  it("destructive tools have correct risk level", () => {
    const del = getToolDefinition("delete");
    expect(del!.risk).toBe("destructive");
    const clear = getToolDefinition("delete-contents");
    expect(clear!.risk).toBe("destructive");
  });

  it("read tools have read-only risk", () => {
    for (const name of ["read", "search", "git-status", "git-diff", "git-branch"]) {
      const def = getToolDefinition(name);
      expect(def!.risk).toBe("read-only");
    }
  });

  it("network tools have network-egress risk", () => {
    const ws = getToolDefinition("web-search");
    expect(ws!.risk).toBe("network-egress");
    const mcp = getToolDefinition("mcp");
    expect(mcp!.risk).toBe("network-egress");
  });
});

describe("Schema validation", () => {
  it("validates required fields", () => {
    const schema = {
      type: "object",
      properties: {
        path: { type: "string", minLength: 1 },
      },
      required: ["path"],
    };
    const errors = validateInput({}, schema);
    expect(errors).toHaveLength(1);
    expect(errors[0].field).toBe("path");
    expect(errors[0].message).toContain("required");
  });

  it("passes valid input", () => {
    const schema = {
      type: "object",
      properties: {
        path: { type: "string", minLength: 1 },
      },
      required: ["path"],
    };
    const errors = validateInput({ path: "src/file.ts" }, schema);
    expect(errors).toHaveLength(0);
  });

  it("validates string type", () => {
    const schema = {
      type: "object",
      properties: {
        value: { type: "string" },
      },
      required: ["value"],
    };
    const errors = validateInput({ value: 123 }, schema);
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain("string");
  });

  it("validates minLength", () => {
    const schema = {
      type: "object",
      properties: {
        path: { type: "string", minLength: 3 },
      },
      required: ["path"],
    };
    const errors = validateInput({ path: "ab" }, schema);
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain("at least 3");
  });

  it("validates pattern", () => {
    const schema = {
      type: "object",
      properties: {
        server: { type: "string", pattern: "^[a-zA-Z0-9._-]+$" },
      },
      required: ["server"],
    };
    const errors = validateInput({ server: "my server!" }, schema);
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain("pattern");
  });

  it("collects multiple errors", () => {
    const schema = {
      type: "object",
      properties: {
        a: { type: "string" },
        b: { type: "string" },
      },
      required: ["a", "b"],
    };
    const errors = validateInput({}, schema);
    expect(errors).toHaveLength(2);
  });
});

describe("createStructuredResult", () => {
  it("creates ok result", () => {
    const result = createStructuredResult(true, "done", Date.now(), "output");
    expect(result.ok).toBe(true);
    expect(result.summary).toBe("done");
    expect(result.data).toBe("output");
    expect(result.error).toBeUndefined();
    expect(result.metadata.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.metadata.startedAt).toBeTruthy();
    expect(result.metadata.completedAt).toBeTruthy();
  });

  it("creates error result", () => {
    const err = { code: "READ_FAILED", message: "file not found", retryable: false };
    const result = createStructuredResult(false, "failed", Date.now(), undefined, err);
    expect(result.ok).toBe(false);
    expect(result.error).toEqual(err);
  });

  it("includes affectedFiles when provided", () => {
    const result = createStructuredResult(true, "ok", Date.now(), null, undefined, ["a.ts", "b.ts"]);
    expect(result.metadata.affectedFiles).toEqual(["a.ts", "b.ts"]);
  });
});

describe("ToolRegistry structured methods", () => {
  const workspaceRoot = process.cwd();
  const registry = new ToolRegistry(workspaceRoot);

  it("getToolDefinition delegates to toolDefinitions", () => {
    const def = registry.getToolDefinition("terminal");
    expect(def).toBeDefined();
    expect(def!.name).toBe("terminal");
  });

  it("getAllToolDefinitions returns all definitions", () => {
    const defs = registry.getAllToolDefinitions();
    expect(defs.length).toBeGreaterThanOrEqual(14);
  });

  it("validateToolInput returns errors for unknown tool", () => {
    const errors = registry.validateToolInput("nonexistent", {});
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain("Unknown tool");
  });

  it("validateToolInput validates read requires path", () => {
    const errors = registry.validateToolInput("read", {});
    expect(errors).toHaveLength(1);
    expect(errors[0].field).toBe("path");
  });

  it("validateToolInput passes valid read input", () => {
    const errors = registry.validateToolInput("read", { path: "file.ts" });
    expect(errors).toHaveLength(0);
  });

  it("runToolCallStructured returns ok for read", async () => {
    const result = await registry.runToolCallStructured("read package.json");
    expect(result.ok).toBe(true);
    expect(result.metadata.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.metadata.startedAt).toBeTruthy();
    expect(result.metadata.completedAt).toBeTruthy();
  });

  it("runToolCallStructured returns error for empty input", async () => {
    const result = await registry.runToolCallStructured("");
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("EMPTY_INPUT");
    expect(result.error?.retryable).toBe(false);
  });

  it("runToolCallStructured returns error for unknown tool", async () => {
    const result = await registry.runToolCallStructured("nonexistent foo");
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("UNKNOWN_TOOL");
  });

  it("runToolCallStructured populates affectedFiles for write", async () => {
    registry.markApproved("write", "/tmp/nexcode-test.txt ||| hello");
    const result = await registry.runToolCallStructured(
      "write /tmp/nexcode-test.txt ||| hello",
    );
    expect(result.metadata.affectedFiles).toBeDefined();
    expect(result.metadata.affectedFiles).toContain("/tmp/nexcode-test.txt");
  });

  it("runToolCallStructured populates affectedFiles for move", async () => {
    const result = await registry.runToolCallStructured("move a.ts ||| b.ts");
    if (result.ok) {
      expect(result.metadata.affectedFiles).toEqual(["a.ts", "b.ts"]);
    }
  });

  it("validateToolArg returns null for unknown tool", () => {
    expect(registry.validateToolArg("nonexistent", "{}")).toBeNull();
  });

  it("validateToolArg validates JSON input against schema", () => {
    const error = registry.validateToolArg("write", '{"path": "test.ts"}');
    expect(error).toBeTruthy();
    expect(error).toContain("content");
  });

  it("validateToolArg passes valid JSON input", () => {
    const error = registry.validateToolArg(
      "write",
      '{"path": "test.ts", "content": "hello"}',
    );
    expect(error).toBeNull();
  });

  it("validateToolArg skips validation for non-JSON input", () => {
    expect(registry.validateToolArg("read", "src/file.ts")).toBeNull();
  });

  it("runToolCall rejects invalid tool input", async () => {
    const result = await registry.runToolCall(
      'write {"path": "test.ts"}',
    );
    expect(result.ok).toBe(false);
    expect(result.output).toContain("Invalid input");
  });
});
