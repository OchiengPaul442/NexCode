import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs/promises";
import path from "path";
import { ToolRegistry } from "../src/tools/toolRegistry";

function batchEditJson(edits: Array<{filePath: string; content: string; operation: string}>): string {
  return "batch_edit " + JSON.stringify({ edits });
}

describe("F-015: batch_edit security vulnerabilities", () => {
  let workspaceRoot: string;
  let registry: ToolRegistry;

  beforeEach(async () => {
    workspaceRoot = path.join(process.cwd(), ".test-batch-edit-" + Date.now());
    await fs.mkdir(workspaceRoot, { recursive: true });
    await fs.mkdir(path.join(workspaceRoot, "src"), { recursive: true });
    await fs.writeFile(path.join(workspaceRoot, "src", "file.ts"), "content");
    registry = new ToolRegistry(workspaceRoot);
  });

  afterEach(async () => {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  });

  async function runBatchEdit(edits: Array<{filePath: string; content: string; operation: string}>) {
    const cmd = batchEditJson(edits);
    const arg = JSON.stringify({ edits });
    registry.markApproved("batch_edit", arg);
    return registry.runToolCall(cmd);
  }

  async function runDelete(target: string) {
    registry.markApproved("delete", target);
    return registry.runToolCall("delete " + target);
  }

  describe("batch_edit delete bypasses ensureNotWorkspaceRoot", () => {
    it("batch_edit delete on workspace root is now blocked (FIXED)", async () => {
      const result = await runBatchEdit([{ filePath: ".", content: "", operation: "delete" }]);
      expect(result.ok).toBe(false);
      expect(result.output).toContain("0/1 succeeded");
      const exists = await fs.access(workspaceRoot).then(() => true).catch(() => false);
      expect(exists).toBe(true);
    });

    it("dedicated delete tool on workspace root IS blocked with explicit check", async () => {
      const result = await runDelete(".");
      expect(result.ok).toBe(false);
      expect(result.output).toContain("Refusing to delete the workspace root");
      const exists = await fs.access(workspaceRoot).then(() => true).catch(() => false);
      expect(exists).toBe(true);
    });

    it("batch_edit delete on subdirectory works correctly", async () => {
      const result = await runBatchEdit([{ filePath: "src/file.ts", content: "", operation: "delete" }]);
      expect(result.ok).toBe(true);
      const exists = await fs.access(path.join(workspaceRoot, "src", "file.ts")).then(() => true).catch(() => false);
      expect(exists).toBe(false);
    });
  });

  describe("batch_edit uses resolveWorkspacePathSafe", () => {
    it("batch_edit create uses symlink-resolving path check", async () => {
      const result = await runBatchEdit([{ filePath: "src/new-file.txt", content: "hello", operation: "create" }]);
      expect(result.ok).toBe(true);
      const content = await fs.readFile(path.join(workspaceRoot, "src", "new-file.txt"), "utf8");
      expect(content).toBe("hello");
    });
  });

  describe("batch_edit error handling", () => {
    it("batch_edit handles malformed JSON gracefully", async () => {
      // NC-016: batch_edit now rejects non-JSON args at validation boundary
      // rather than letting them fall through to the handler.
      registry.markApproved("batch_edit", "not-json");
      const result = await registry.runToolCall("batch_edit not-json");
      expect(result.ok).toBe(false);
      expect(result.output).toContain("Invalid input");
      expect(result.output).toContain("batch_edit requires JSON arguments");
    });

    it("batch_edit handles missing edits array via schema validation", async () => {
      const cmd = "batch_edit " + JSON.stringify({ notEdits: [] });
      const result = await registry.runToolCall(cmd);
      expect(result.ok).toBe(false);
      expect(result.output).toContain("edits");
    });

    it("batch_edit handles empty edits array", async () => {
      const result = await runBatchEdit([]);
      expect(result.ok).toBe(true);
      expect(result.output).toContain("0/0 succeeded");
    });
  });

  describe("batch_edit operations", () => {
    it("batch_edit create writes file", async () => {
      const result = await runBatchEdit([{ filePath: "src/created.txt", content: "new content", operation: "create" }]);
      expect(result.ok).toBe(true);
      const content = await fs.readFile(path.join(workspaceRoot, "src", "created.txt"), "utf8");
      expect(content).toBe("new content");
    });

    it("batch_edit update overwrites file", async () => {
      const result = await runBatchEdit([{ filePath: "src/file.ts", content: "updated", operation: "update" }]);
      expect(result.ok).toBe(true);
      const content = await fs.readFile(path.join(workspaceRoot, "src", "file.ts"), "utf8");
      expect(content).toBe("updated");
    });

    it("batch_edit delete removes file", async () => {
      const result = await runBatchEdit([{ filePath: "src/file.ts", content: "", operation: "delete" }]);
      expect(result.ok).toBe(true);
      const exists = await fs.access(path.join(workspaceRoot, "src", "file.ts")).then(() => true).catch(() => false);
      expect(exists).toBe(false);
    });

    it("batch_edit unknown operation returns 0/1 succeeded", async () => {
      const result = await runBatchEdit([{ filePath: "src/file.ts", content: "", operation: "evil" }]);
      expect(result.ok).toBe(false);
      expect(result.output).toContain("0/1 succeeded");
    });
  });

  describe("batch_edit multiple edits", () => {
    it("batch_edit processes multiple edits sequentially", async () => {
      const result = await runBatchEdit([
        { filePath: "src/a.txt", content: "a", operation: "create" },
        { filePath: "src/b.txt", content: "b", operation: "create" },
        { filePath: "src/c.txt", content: "c", operation: "create" },
      ]);
      expect(result.ok).toBe(true);
      expect(result.output).toContain("3/3 succeeded");
    });

    it("batch_edit reports partial failures when delete on non-empty dir fails", async () => {
      const result = await runBatchEdit([
        { filePath: "src/a.txt", content: "a", operation: "create" },
        { filePath: ".", content: "", operation: "delete" },
      ]);
      expect(result.output).toContain("1/2 succeeded");
    });
  });
});
