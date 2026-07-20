import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs/promises";
import path from "path";
import { ToolRegistry } from "../src/tools/toolRegistry";

function batchEditJson(edits: Array<{ filePath: string; content: string; operation: string }>): string {
  return "batch_edit " + JSON.stringify({ edits });
}

describe("NC-018: batch_edit transactional behavior", () => {
  let workspaceRoot: string;
  let registry: ToolRegistry;

  beforeEach(async () => {
    workspaceRoot = path.join(process.cwd(), ".test-batch-txn-" + Date.now());
    await fs.mkdir(workspaceRoot, { recursive: true });
    await fs.mkdir(path.join(workspaceRoot, "src"), { recursive: true });
    await fs.writeFile(path.join(workspaceRoot, "src", "existing.ts"), "original content");
    await fs.writeFile(path.join(workspaceRoot, "src", "file2.ts"), "second file");
    registry = new ToolRegistry(workspaceRoot);
  });

  afterEach(async () => {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  });

  async function runBatchEdit(edits: Array<{ filePath: string; content: string; operation: string }>) {
    const cmd = batchEditJson(edits);
    const arg = JSON.stringify({ edits });
    registry.markApproved("batch_edit", arg);
    return registry.runToolCall(cmd);
  }

  async function fileExists(relativePath: string): Promise<boolean> {
    try {
      await fs.access(path.join(workspaceRoot, relativePath));
      return true;
    } catch {
      return false;
    }
  }

  async function readFile(relativePath: string): Promise<string> {
    return fs.readFile(path.join(workspaceRoot, relativePath), "utf8");
  }

  async function readWorkspaceSnapshot(): Promise<Record<string, string>> {
    const snapshot: Record<string, string> = {};
    async function walk(dir: string, rel: string) {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        const relPath = rel ? `${rel}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          await walk(fullPath, relPath);
        } else if (!entry.name.startsWith(".nexcode-tmp-")) {
          try {
            snapshot[relPath] = await fs.readFile(fullPath, "utf8");
          } catch {
            snapshot[relPath] = `<unreadable>`;
          }
        }
      }
    }
    await walk(workspaceRoot, "");
    return snapshot;
  }

  // --- Pre-validation tests (rejects whole batch before any writes) ---

  describe("pre-validation rejects before any writes", () => {
    it("rejects batch with duplicate normalized paths", async () => {
      const result = await runBatchEdit([
        { filePath: "src/a.ts", content: "a1", operation: "create" },
        { filePath: "src/a.ts", content: "a2", operation: "create" },
      ]);
      expect(result.ok).toBe(false);
      expect(result.output).toContain("Duplicate path");
      expect(result.output).toContain("pre-validation");
      expect(await fileExists("src/a.ts")).toBe(false);
    });

    it("rejects batch with traversal path", async () => {
      const result = await runBatchEdit([
        { filePath: "src/new-ok.ts", content: "ok", operation: "create" },
        { filePath: "../outside.ts", content: "evil", operation: "create" },
      ]);
      expect(result.ok).toBe(false);
      expect(result.output).toContain("pre-validation");
      expect(await fileExists("src/new-ok.ts")).toBe(false);
    });

    it("rejects batch with both duplicate and traversal errors", async () => {
      const result = await runBatchEdit([
        { filePath: "../evil.ts", content: "x", operation: "create" },
        { filePath: "src/dup.ts", content: "d1", operation: "create" },
        { filePath: "src/dup.ts", content: "d2", operation: "create" },
      ]);
      expect(result.ok).toBe(false);
      expect(result.output).toContain("pre-validation");
      expect(result.output).toContain("Duplicate path");
      expect(await fileExists("src/dup.ts")).toBe(false);
    });

    it("accepts batch with all unique valid paths", async () => {
      const result = await runBatchEdit([
        { filePath: "src/new1.ts", content: "n1", operation: "create" },
        { filePath: "src/new2.ts", content: "n2", operation: "create" },
        { filePath: "src/new3.ts", content: "n3", operation: "create" },
      ]);
      expect(result.ok).toBe(true);
      expect(result.output).toContain("3/3 succeeded");
      expect(await readFile("src/new1.ts")).toBe("n1");
      expect(await readFile("src/new2.ts")).toBe("n2");
      expect(await readFile("src/new3.ts")).toBe("n3");
    });
  });

  // --- Rollback tests (delete on workspace root triggers failure) ---

  describe("rollback on failure", () => {
    it("rolls back create edits when a later delete on workspace root fails", async () => {
      const result = await runBatchEdit([
        { filePath: "src/brand-new.ts", content: "new file", operation: "create" },
        { filePath: ".", content: "", operation: "delete" },
      ]);
      expect(result.ok).toBe(false);
      expect(result.output).toContain("succeeded before failure");
      expect(result.output).toContain("rolled back");
      // The first create should have been rolled back (file deleted).
      expect(await fileExists("src/brand-new.ts")).toBe(false);
    });

    it("rolls back update edits restoring original content", async () => {
      const result = await runBatchEdit([
        { filePath: "src/existing.ts", content: "modified!", operation: "update" },
        { filePath: ".", content: "", operation: "delete" },
      ]);
      expect(result.ok).toBe(false);
      expect(result.output).toContain("rolled back");
      // Original content should be restored.
      expect(await readFile("src/existing.ts")).toBe("original content");
    });

    it("rolls back delete edits by re-creating the deleted file", async () => {
      const result = await runBatchEdit([
        { filePath: "src/file2.ts", content: "", operation: "delete" },
        { filePath: ".", content: "", operation: "delete" },
      ]);
      expect(result.ok).toBe(false);
      expect(result.output).toContain("rolled back");
      // Deleted file should be restored.
      expect(await fileExists("src/file2.ts")).toBe(true);
      expect(await readFile("src/file2.ts")).toBe("second file");
    });

    it("rolls back multiple successful edits in reverse order", async () => {
      const result = await runBatchEdit([
        { filePath: "src/new1.ts", content: "n1", operation: "create" },
        { filePath: "src/existing.ts", content: "changed", operation: "update" },
        { filePath: "src/file2.ts", content: "", operation: "delete" },
        { filePath: ".", content: "", operation: "delete" },
      ]);
      expect(result.ok).toBe(false);
      expect(result.output).toContain("rolled back");
      // All three successful edits should be rolled back.
      expect(await fileExists("src/new1.ts")).toBe(false);
      expect(await readFile("src/existing.ts")).toBe("original content");
      expect(await fileExists("src/file2.ts")).toBe(true);
      expect(await readFile("src/file2.ts")).toBe("second file");
    });

    it("reports correct count before failure", async () => {
      const result = await runBatchEdit([
        { filePath: "src/a.ts", content: "a", operation: "create" },
        { filePath: "src/b.ts", content: "b", operation: "create" },
        { filePath: ".", content: "", operation: "delete" },
      ]);
      expect(result.ok).toBe(false);
      expect(result.output).toContain("2/3 succeeded before failure");
    });

    it("does NOT attempt further edits after a failure", async () => {
      const result = await runBatchEdit([
        { filePath: "src/new-ok.ts", content: "ok", operation: "create" },
        { filePath: ".", content: "", operation: "delete" },
        { filePath: "src/never-reached.ts", content: "should not exist", operation: "create" },
      ]);
      expect(result.ok).toBe(false);
      // The third edit should have been skipped.
      expect(await fileExists("src/never-reached.ts")).toBe(false);
      // The first edit should have been rolled back.
      expect(await fileExists("src/new-ok.ts")).toBe(false);
    });

    it("unknown operation in batch triggers rollback of prior successes", async () => {
      const result = await runBatchEdit([
        { filePath: "src/new.ts", content: "n", operation: "create" },
        { filePath: "src/existing.ts", content: "x", operation: "evil" },
      ]);
      expect(result.ok).toBe(false);
      expect(result.output).toContain("rolled back");
      expect(await fileExists("src/new.ts")).toBe(false);
      expect(await readFile("src/existing.ts")).toBe("original content");
    });
  });

  // --- Atomic write tests ---

  describe("atomic writes in batch", () => {
    it("uses atomic writes for create operations", async () => {
      const result = await runBatchEdit([
        { filePath: "src/atomic.ts", content: "atomic content", operation: "create" },
      ]);
      expect(result.ok).toBe(true);
      expect(await readFile("src/atomic.ts")).toBe("atomic content");
      // Verify no temp files left behind.
      const files = await fs.readdir(path.join(workspaceRoot, "src"));
      const tmpFiles = files.filter(f => f.startsWith(".nexcode-tmp-"));
      expect(tmpFiles).toHaveLength(0);
    });

    it("uses atomic writes for update operations", async () => {
      const result = await runBatchEdit([
        { filePath: "src/existing.ts", content: "updated content", operation: "update" },
      ]);
      expect(result.ok).toBe(true);
      expect(await readFile("src/existing.ts")).toBe("updated content");
      const files = await fs.readdir(path.join(workspaceRoot, "src"));
      const tmpFiles = files.filter(f => f.startsWith(".nexcode-tmp-"));
      expect(tmpFiles).toHaveLength(0);
    });
  });

  // --- Successful batch with mixed operations ---

  describe("successful mixed-operation batch", () => {
    it("create + update + delete in one batch", async () => {
      const result = await runBatchEdit([
        { filePath: "src/brand-new.ts", content: "created!", operation: "create" },
        { filePath: "src/existing.ts", content: "updated!", operation: "update" },
        { filePath: "src/file2.ts", content: "", operation: "delete" },
      ]);
      expect(result.ok).toBe(true);
      expect(result.output).toContain("3/3 succeeded");
      expect(await readFile("src/brand-new.ts")).toBe("created!");
      expect(await readFile("src/existing.ts")).toBe("updated!");
      expect(await fileExists("src/file2.ts")).toBe(false);
    });

    it("create + update + create different files in one batch", async () => {
      const result = await runBatchEdit([
        { filePath: "src/temp1.ts", content: "temp1", operation: "create" },
        { filePath: "src/temp2.ts", content: "temp2", operation: "create" },
        { filePath: "src/temp3.ts", content: "temp3", operation: "create" },
      ]);
      expect(result.ok).toBe(true);
      expect(result.output).toContain("3/3 succeeded");
    });
  });

  // --- No partial modifications on failure ---

  describe("no partial modifications", () => {
    it("workspace is unchanged when pre-validation rejects entire batch", async () => {
      const snapshotBefore = await readWorkspaceSnapshot();
      await runBatchEdit([
        { filePath: "src/new.ts", content: "n", operation: "create" },
        { filePath: "../evil.ts", content: "e", operation: "create" },
      ]);
      const snapshotAfter = await readWorkspaceSnapshot();
      expect(snapshotAfter).toEqual(snapshotBefore);
    });

    it("workspace is unchanged when execution-phase failure triggers rollback", async () => {
      const snapshotBefore = await readWorkspaceSnapshot();
      await runBatchEdit([
        { filePath: "src/new.ts", content: "n", operation: "create" },
        { filePath: ".", content: "", operation: "delete" },
      ]);
      const snapshotAfter = await readWorkspaceSnapshot();
      expect(snapshotAfter).toEqual(snapshotBefore);
    });
  });

  // --- Edge cases ---

  describe("edge cases", () => {
    it("empty batch succeeds", async () => {
      const result = await runBatchEdit([]);
      expect(result.ok).toBe(true);
      expect(result.output).toContain("0/0 succeeded");
    });

    it("single-item batch succeeds", async () => {
      const result = await runBatchEdit([
        { filePath: "src/only.ts", content: "only", operation: "create" },
      ]);
      expect(result.ok).toBe(true);
      expect(result.output).toContain("1/1 succeeded");
      expect(await readFile("src/only.ts")).toBe("only");
    });

    it("single-item failing batch fails gracefully", async () => {
      const result = await runBatchEdit([
        { filePath: ".", content: "", operation: "delete" },
      ]);
      expect(result.ok).toBe(false);
      expect(result.output).toContain("0/1 succeeded");
      // No rollback needed since first item failed immediately.
    });
  });
});
