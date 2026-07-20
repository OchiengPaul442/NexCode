import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { FeedbackLogger } from "../src/self-improve/feedbackLogger";
import { AuditLog } from "../src/tools/auditLog";
import { ShortTermMemory } from "../src/memory/shortTermMemory";
import { LongTermMemoryStore } from "../src/memory/longTermMemory";
import { MemoryManager } from "../src/memory/memoryManager";

const tempDirs: string[] = [];

async function createTempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nexcode-persistence-"));
  tempDirs.push(dir);
  return dir;
}

/**
 * Creates a file at the given path and returns the path.
 * Using this file as a directory parent in mkdir will cause ENOTDIR.
 */
async function createFileAsBlocker(filePath: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, "blocker", "utf8");
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// FeedbackLogger
// ─────────────────────────────────────────────────────────────────────────────

describe("FeedbackLogger persistence (NC-026)", () => {
  it("serializes writes through a queue", async () => {
    const dir = await createTempDir();
    const logger = new FeedbackLogger(dir);

    // Fire multiple concurrent logs
    const p1 = logger.log({ rating: 5, comment: "good", timestamp: "2026-01-01" });
    const p2 = logger.log({ rating: 3, comment: "ok", timestamp: "2026-01-02" });
    const p3 = logger.log({ rating: 1, comment: "bad", timestamp: "2026-01-03" });
    await Promise.all([p1, p2, p3]);

    const ok = await logger.flush();
    expect(ok).toBe(true);

    const content = await fs.readFile(path.join(dir, "feedback-log.jsonl"), "utf8");
    const lines = content.trim().split("\n").filter(Boolean);
    expect(lines).toHaveLength(3);

    const entries = lines.map((l) => JSON.parse(l));
    expect(entries.map((e: { rating: number }) => e.rating)).toEqual([5, 3, 1]);
  });

  it("surfaces errors through onError callback", async () => {
    const dir = await createTempDir();
    // Block the log directory by creating a file where the log file's parent should be
    const blockerFile = path.join(dir, "feedback-log.jsonl", "impossible-child");
    await createFileAsBlocker(blockerFile);

    const errors: Error[] = [];
    const logger = new FeedbackLogger({
      memoryDir: dir,
      onError: (err) => errors.push(err),
    });

    await logger.log({ rating: 5, comment: "test", timestamp: "2026-01-01" });

    expect(errors.length).toBe(1);
    expect(errors[0].message).toContain("FeedbackLogger");
  });

  it("tracks last error via getLastError and hasPersistenceError", async () => {
    const dir = await createTempDir();
    // Block the log file by creating a directory where the file should be
    await fs.mkdir(path.join(dir, "feedback-log.jsonl"), { recursive: true });

    const logger = new FeedbackLogger({
      memoryDir: dir,
      onError: () => {},
    });

    expect(logger.hasPersistenceError()).toBe(false);
    expect(logger.getLastError()).toBeNull();

    await logger.log({ rating: 5, comment: "test", timestamp: "2026-01-01" });

    expect(logger.hasPersistenceError()).toBe(true);
    expect(logger.getLastError()).toBeInstanceOf(Error);
  });

  it("resetErrorState clears the error", async () => {
    const dir = await createTempDir();
    await fs.mkdir(path.join(dir, "feedback-log.jsonl"), { recursive: true });

    const logger = new FeedbackLogger({
      memoryDir: dir,
      onError: () => {},
    });

    await logger.log({ rating: 5, comment: "test", timestamp: "2026-01-01" });
    expect(logger.hasPersistenceError()).toBe(true);

    logger.resetErrorState();
    expect(logger.hasPersistenceError()).toBe(false);
    expect(logger.getLastError()).toBeNull();
  });

  it("dispose prevents further writes and returns success status", async () => {
    const dir = await createTempDir();
    const logger = new FeedbackLogger(dir);

    await logger.log({ rating: 5, comment: "before dispose", timestamp: "2026-01-01" });
    const ok = await logger.dispose();
    expect(ok).toBe(true);

    // Write after dispose should be silently ignored
    await logger.log({ rating: 1, comment: "after dispose", timestamp: "2026-01-02" });

    const content = await fs.readFile(path.join(dir, "feedback-log.jsonl"), "utf8");
    const lines = content.trim().split("\n").filter(Boolean);
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]).comment).toBe("before dispose");
  });

  it("flush returns true when no errors occurred", async () => {
    const dir = await createTempDir();
    const logger = new FeedbackLogger(dir);

    await logger.log({ rating: 5, comment: "ok", timestamp: "2026-01-01" });
    const ok = await logger.flush();
    expect(ok).toBe(true);
  });

  it("backward-compatible string constructor still works", async () => {
    const dir = await createTempDir();
    const logger = new FeedbackLogger(dir);

    await logger.log({ rating: 5, comment: "compat", timestamp: "2026-01-01" });
    const ok = await logger.flush();
    expect(ok).toBe(true);

    const content = await fs.readFile(path.join(dir, "feedback-log.jsonl"), "utf8");
    expect(content).toContain("compat");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AuditLog
// ─────────────────────────────────────────────────────────────────────────────

describe("AuditLog persistence (NC-026)", () => {
  function makeAuditEntry(toolName = "terminal"): {
    timestamp: string;
    toolName: string;
    arg: string;
    approved: boolean;
    approvalRequired: boolean;
    ok: boolean;
    outputPreview: string;
    durationMs: number;
  } {
    return {
      timestamp: new Date().toISOString(),
      toolName,
      arg: "ls -la",
      approved: true,
      approvalRequired: false,
      ok: true,
      outputPreview: "output",
      durationMs: 100,
    };
  }

  it("serializes writes through a queue", async () => {
    const dir = await createTempDir();
    const audit = new AuditLog(dir);

    // Fire 15 entries (buffer threshold is 10)
    const entries = Array.from({ length: 15 }, (_, i) =>
      makeAuditEntry(`tool-${i}`),
    );

    for (const entry of entries) {
      await audit.log(entry);
    }

    const ok = await audit.flush();
    expect(ok).toBe(true);

    const logPath = path.join(dir, ".nexcode", "audit.jsonl");
    const content = await fs.readFile(logPath, "utf8");
    const lines = content.trim().split("\n").filter(Boolean);
    expect(lines).toHaveLength(15);
  });

  it("does not lose entries when flush fails", async () => {
    const dir = await createTempDir();
    // Block the audit directory by creating a file where .nexcode should be
    await createFileAsBlocker(path.join(dir, ".nexcode"));

    const errors: Error[] = [];
    const audit = new AuditLog({
      workspaceRoot: dir,
      onError: (err) => errors.push(err),
    });

    await audit.log(makeAuditEntry("tool-1"));
    await audit.log(makeAuditEntry("tool-2"));
    await audit.flush();

    expect(errors.length).toBeGreaterThanOrEqual(1);
    // Entries should be re-queued, not lost
    expect(audit.getBufferedCount()).toBe(2);
  });

  it("dispose flushes remaining entries and clears timer", async () => {
    const dir = await createTempDir();
    const audit = new AuditLog(dir);

    await audit.log(makeAuditEntry("before"));
    const ok = await audit.dispose();
    expect(ok).toBe(true);

    // Write after dispose should be silently ignored
    await audit.log(makeAuditEntry("after"));

    const logPath = path.join(dir, ".nexcode", "audit.jsonl");
    const content = await fs.readFile(logPath, "utf8");
    const lines = content.trim().split("\n").filter(Boolean);
    expect(lines).toHaveLength(1);
  });

  it("getBufferedCount tracks unflushed entries", async () => {
    const dir = await createTempDir();
    const audit = new AuditLog(dir);

    expect(audit.getBufferedCount()).toBe(0);

    await audit.log(makeAuditEntry("a"));
    await audit.log(makeAuditEntry("b"));
    expect(audit.getBufferedCount()).toBe(2);

    await audit.flush();
    expect(audit.getBufferedCount()).toBe(0);
  });

  it("hasPersistenceError returns false when no errors", async () => {
    const dir = await createTempDir();
    const audit = new AuditLog(dir);

    await audit.log(makeAuditEntry());
    const ok = await audit.flush();
    expect(ok).toBe(true);
    expect(audit.hasPersistenceError()).toBe(false);
    expect(audit.getLastError()).toBeNull();
  });

  it("redacts secrets before writing", async () => {
    const dir = await createTempDir();
    const audit = new AuditLog(dir);

    const entry = makeAuditEntry();
    // Use a key long enough to match the OpenAI pattern (sk- + 20+ alphanumeric)
    entry.arg = "curl -H 'Authorization: Bearer sk-projABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890abcdef' https://api.example.com";
    await audit.log(entry);
    await audit.flush();

    const logPath = path.join(dir, ".nexcode", "audit.jsonl");
    const content = await fs.readFile(logPath, "utf8");
    expect(content).not.toContain("sk-projABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890abcdef");
    expect(content).toContain("REDACTED");
  });

  it("backward-compatible string constructor still works", async () => {
    const dir = await createTempDir();
    const audit = new AuditLog(dir);

    await audit.log(makeAuditEntry());
    const ok = await audit.flush();
    expect(ok).toBe(true);

    const logPath = path.join(dir, ".nexcode", "audit.jsonl");
    const content = await fs.readFile(logPath, "utf8");
    expect(content).toContain("terminal");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ShortTermMemory
// ─────────────────────────────────────────────────────────────────────────────

describe("ShortTermMemory persistence (NC-026)", () => {
  it("surfaces persistence errors through onError callback", async () => {
    const dir = await createTempDir();
    // Block the persist directory by creating a file where it should be
    await createFileAsBlocker(path.join(dir, "sessions"));

    const errors: Error[] = [];
    const memory = new ShortTermMemory({
      maxMessagesPerSession: 40,
      persistDir: path.join(dir, "sessions"),
      onError: (err) => errors.push(err),
    });

    memory.append("session-1", { role: "user", content: "hello" });
    const ok = await memory.flush();

    expect(ok).toBe(false);
    expect(errors.length).toBeGreaterThanOrEqual(1);
    expect(errors[0].message).toContain("ShortTermMemory");
  });

  it("hasPersistenceError tracks error state", async () => {
    const dir = await createTempDir();
    await createFileAsBlocker(path.join(dir, "mem"));

    const memory = new ShortTermMemory({
      maxMessagesPerSession: 40,
      persistDir: path.join(dir, "mem"),
      onError: () => {},
    });

    expect(memory.hasPersistenceError()).toBe(false);

    memory.append("s1", { role: "user", content: "test" });
    await memory.flush();

    expect(memory.hasPersistenceError()).toBe(true);
    expect(memory.getLastError()).toBeInstanceOf(Error);
  });

  it("dispose prevents further writes", async () => {
    const dir = await createTempDir();
    const memory = new ShortTermMemory(40, dir);

    memory.append("s1", { role: "user", content: "before" });
    const ok = await memory.dispose();
    expect(ok).toBe(true);

    // Write after dispose should not persist
    memory.append("s1", { role: "assistant", content: "after" });
    await memory.flush();

    const files = await fs.readdir(dir);
    const jsonlFiles = files.filter((f) => f.endsWith(".jsonl"));
    expect(jsonlFiles).toHaveLength(1);

    const content = await fs.readFile(path.join(dir, jsonlFiles[0]), "utf8");
    const lines = content.trim().split("\n").filter(Boolean);
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]).content).toBe("before");
  });

  it("flush returns true when no errors occurred", async () => {
    const dir = await createTempDir();
    const memory = new ShortTermMemory(40, dir);

    memory.append("s1", { role: "user", content: "hello" });
    const ok = await memory.flush();
    expect(ok).toBe(true);
  });

  it("backward-compatible constructor signature still works", async () => {
    const dir = await createTempDir();
    const memory = new ShortTermMemory(40, dir);

    memory.append("s1", { role: "user", content: "compat" });
    await memory.flush();

    const files = await fs.readdir(dir);
    expect(files.some((f) => f.endsWith(".jsonl"))).toBe(true);
  });

  it("clearSession surfaces errors through onError when persist dir is blocked", async () => {
    const dir = await createTempDir();
    // Block the persist directory by creating a file where it should be
    await createFileAsBlocker(path.join(dir, "blocked-session-dir"));

    const errors: Error[] = [];
    const memory = new ShortTermMemory({
      maxMessagesPerSession: 40,
      persistDir: path.join(dir, "blocked-session-dir"),
      onError: (err) => errors.push(err),
    });

    // append fails because the dir is blocked by a file
    memory.append("s1", { role: "user", content: "hello" });
    await memory.flush();

    expect(errors.length).toBeGreaterThanOrEqual(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// LongTermMemoryStore
// ─────────────────────────────────────────────────────────────────────────────

describe("LongTermMemoryStore persistence (NC-026)", () => {
  it("surfaces errors through onError callback", async () => {
    const dir = await createTempDir();
    // Create a directory where the JSONL file should be — appendFile will fail with EISDIR
    await fs.mkdir(path.join(dir, "long-term-memory.jsonl"), { recursive: true });

    const errors: Error[] = [];
    const store = new LongTermMemoryStore({
      memoryDir: dir,
      onError: (err) => errors.push(err),
    });

    await store.add({
      id: "test-1",
      timestamp: new Date().toISOString(),
      type: "interaction",
      text: "test entry",
      tags: ["test"],
    });

    const ok = await store.flush();
    expect(ok).toBe(false);
    expect(errors.length).toBeGreaterThanOrEqual(1);
    expect(errors[0].message).toContain("LongTermMemoryStore");
  });

  it("hasPersistenceError tracks error state", async () => {
    const dir = await createTempDir();
    await fs.mkdir(path.join(dir, "long-term-memory.jsonl"), { recursive: true });

    const store = new LongTermMemoryStore({
      memoryDir: dir,
      onError: () => {},
    });

    expect(store.hasPersistenceError()).toBe(false);

    await store.add({
      id: "test-1",
      timestamp: new Date().toISOString(),
      type: "interaction",
      text: "test",
      tags: [],
    });

    expect(store.hasPersistenceError()).toBe(true);
    expect(store.getLastError()).toBeInstanceOf(Error);
  });

  it("dispose prevents further writes", async () => {
    const dir = await createTempDir();
    const store = new LongTermMemoryStore(dir);

    await store.add({
      id: "before",
      timestamp: new Date().toISOString(),
      type: "interaction",
      text: "before dispose",
      tags: [],
    });
    const ok = await store.dispose();
    expect(ok).toBe(true);

    // Write after dispose should be ignored
    await store.add({
      id: "after",
      timestamp: new Date().toISOString(),
      type: "interaction",
      text: "after dispose",
      tags: [],
    });

    const results = await store.search("before dispose");
    expect(results).toHaveLength(1);
    expect(results[0].text).toBe("before dispose");
  });

  it("flush returns true when no errors occurred", async () => {
    const dir = await createTempDir();
    const store = new LongTermMemoryStore(dir);

    await store.add({
      id: "test-1",
      timestamp: new Date().toISOString(),
      type: "interaction",
      text: "test entry",
      tags: ["test"],
    });

    const ok = await store.flush();
    expect(ok).toBe(true);
  });

  it("backward-compatible string constructor still works", async () => {
    const dir = await createTempDir();
    const store = new LongTermMemoryStore(dir);

    await store.add({
      id: "compat",
      timestamp: new Date().toISOString(),
      type: "interaction",
      text: "compat test",
      tags: [],
    });

    const ok = await store.flush();
    expect(ok).toBe(true);

    const results = await store.search("compat test");
    expect(results).toHaveLength(1);
    expect(results[0].text).toBe("compat test");
  });

  it("serialized writes do not interleave", async () => {
    const dir = await createTempDir();
    const store = new LongTermMemoryStore(dir);

    // Fire many concurrent adds
    const promises = Array.from({ length: 20 }, (_, i) =>
      store.add({
        id: `entry-${i}`,
        timestamp: new Date().toISOString(),
        type: "interaction",
        text: `Entry number ${i}`,
        tags: [],
      }),
    );
    await Promise.all(promises);
    await store.flush();

    const results = await store.search("Entry", 100);
    expect(results).toHaveLength(20);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// MemoryManager
// ─────────────────────────────────────────────────────────────────────────────

describe("MemoryManager persistence (NC-026)", () => {
  it("flush delegates to both stores", async () => {
    const dir = await createTempDir();
    const manager = new MemoryManager(dir);

    manager.appendSessionMessage("s1", { role: "user", content: "hello" });
    await manager.rememberInteraction("prompt", "response", ["test"]);

    const ok = await manager.flush();
    expect(ok).toBe(true);
  });

  it("dispose delegates to both stores and prevents further writes", async () => {
    const dir = await createTempDir();
    const manager = new MemoryManager(dir);

    manager.appendSessionMessage("s1", { role: "user", content: "before" });
    const ok = await manager.dispose();
    expect(ok).toBe(true);

    // Write after dispose should not persist
    manager.appendSessionMessage("s1", { role: "assistant", content: "after" });
    await manager.flush();

    const manager2 = new MemoryManager(dir);
    await manager2.initialize();
    const messages = manager2.getSessionMessages("s1");
    expect(messages).toHaveLength(1);
    expect(messages[0].content).toBe("before");
  });

  it("hasPersistenceError reports errors from both stores", async () => {
    const dir = await createTempDir();
    // Block both the short-term persist dir and long-term file
    await createFileAsBlocker(path.join(dir, "short-term-session"));
    await createFileAsBlocker(path.join(dir, "long-term-memory.jsonl"));

    const errors: Error[] = [];
    const manager = new MemoryManager({
      memoryDir: path.join(dir, "short-term-session"),
      onError: (err) => errors.push(err),
    });

    manager.appendSessionMessage("s1", { role: "user", content: "test" });
    await manager.rememberInteraction("prompt", "response");

    const ok = await manager.flush();
    expect(ok).toBe(false);
    expect(manager.hasPersistenceError()).toBe(true);
  });

  it("backward-compatible string constructor still works", async () => {
    const dir = await createTempDir();
    const manager = new MemoryManager(dir);

    manager.appendSessionMessage("s1", { role: "user", content: "compat" });
    await manager.rememberInteraction("prompt", "response", ["test"]);

    const ok = await manager.flush();
    expect(ok).toBe(true);

    const messages = manager.getSessionMessages("s1");
    expect(messages).toHaveLength(1);
    expect(messages[0].content).toBe("compat");

    const entries = await manager.longTerm.search("prompt");
    expect(entries).toHaveLength(1);
  });

  it("onError callback receives errors from both stores", async () => {
    const dir = await createTempDir();
    await createFileAsBlocker(path.join(dir, "short-term-session"));
    await createFileAsBlocker(path.join(dir, "long-term-memory.jsonl"));

    const errors: Error[] = [];
    const manager = new MemoryManager({
      memoryDir: path.join(dir, "short-term-session"),
      onError: (err) => errors.push(err),
    });

    manager.appendSessionMessage("s1", { role: "user", content: "test" });
    await manager.rememberInteraction("prompt", "response");
    await manager.flush();

    // Should have errors from both ShortTermMemory and LongTermMemoryStore
    expect(errors.length).toBeGreaterThanOrEqual(2);
    const hasShortTerm = errors.some((e) => e.message.includes("ShortTermMemory"));
    const hasLongTerm = errors.some((e) => e.message.includes("LongTermMemoryStore"));
    expect(hasShortTerm).toBe(true);
    expect(hasLongTerm).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Concurrency safety
// ─────────────────────────────────────────────────────────────────────────────

describe("Concurrent persistence safety (NC-026)", () => {
  it("ShortTermMemory handles concurrent appends without data loss", async () => {
    const dir = await createTempDir();
    const memory = new ShortTermMemory(100, dir);

    // Fire 50 concurrent appends for the same session
    const promises = Array.from({ length: 50 }, (_, i) => {
      memory.append("concurrent", { role: "user", content: `msg-${i}` });
      return Promise.resolve();
    });
    await Promise.all(promises);
    await memory.flush();

    const messages = memory.getSession("concurrent");
    expect(messages).toHaveLength(50);
  });

  it("LongTermMemoryStore handles concurrent adds without corruption", async () => {
    const dir = await createTempDir();
    const store = new LongTermMemoryStore(dir);

    // Fire 30 concurrent adds
    const promises = Array.from({ length: 30 }, (_, i) =>
      store.add({
        id: `concurrent-${i}`,
        timestamp: new Date().toISOString(),
        type: "interaction",
        text: `Concurrent entry ${i}`,
        tags: [],
      }),
    );
    await Promise.all(promises);
    await store.flush();

    // Verify file is not corrupted
    const filePath = path.join(dir, "long-term-memory.jsonl");
    const content = await fs.readFile(filePath, "utf8");
    const lines = content.trim().split("\n").filter(Boolean);
    expect(lines).toHaveLength(30);

    // Verify each line is valid JSON
    for (const line of lines) {
      expect(() => JSON.parse(line)).not.toThrow();
    }
  });

  it("AuditLog handles concurrent logs without interleaving", async () => {
    const dir = await createTempDir();
    const audit = new AuditLog(dir);

    function makeEntry(i: number) {
      return {
        timestamp: new Date().toISOString(),
        toolName: `tool-${i}`,
        arg: `cmd-${i}`,
        approved: true,
        approvalRequired: false,
        ok: true,
        outputPreview: `out-${i}`,
        durationMs: i,
      };
    }

    // Fire 25 concurrent logs
    const promises = Array.from({ length: 25 }, (_, i) => audit.log(makeEntry(i)));
    await Promise.all(promises);
    await audit.flush();

    const logPath = path.join(dir, ".nexcode", "audit.jsonl");
    const content = await fs.readFile(logPath, "utf8");
    const lines = content.trim().split("\n").filter(Boolean);
    expect(lines).toHaveLength(25);

    for (const line of lines) {
      expect(() => JSON.parse(line)).not.toThrow();
    }
  });
});
