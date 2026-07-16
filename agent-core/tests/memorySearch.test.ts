import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryManager } from "../src/memory/memoryManager";
import { LongTermMemoryStore } from "../src/memory/longTermMemory";
import { scoreKeywordOverlap } from "../src/utils/text";

const tempDirs: string[] = [];

async function createTempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nexcode-memory-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }
});

describe("memory relevance safeguards", () => {
  it("scores overlap by query coverage instead of document size", () => {
    const score = scoreKeywordOverlap(
      "sum even numbers in typescript array",
      "typescript function array",
    );

    expect(score).toBeCloseTo(0.4, 2);
  });

  it("filters out weakly related long-term memory matches", async () => {
    const memoryDir = await createTempDir();
    const store = new LongTermMemoryStore(memoryDir);

    await store.add({
      id: "relevant",
      timestamp: new Date().toISOString(),
      type: "interaction",
      text: "Prompt: add retry timeout logic to fetch client Response excerpt: implement retries with AbortController timeout",
      tags: ["typescript", "networking"],
    });

    await store.add({
      id: "weak",
      timestamp: new Date().toISOString(),
      type: "interaction",
      text: "Prompt: write a TypeScript function Response excerpt: status note model ready for use",
      tags: ["typescript"],
    });

    const results = await store.search(
      "add retry timeout logic to a TypeScript fetch client",
      5,
    );

    expect(results.map((entry) => entry.id)).toEqual(["relevant"]);
  });

  it("stores only a shortened response excerpt in remembered interactions", async () => {
    const memoryDir = await createTempDir();
    const manager = new MemoryManager(memoryDir);
    const longResponse = "x".repeat(500);

    await manager.rememberInteraction("Explain retries", longResponse, [
      "test",
    ]);

    const results = await manager.longTerm.search("Explain retries", 5);
    expect(results).toHaveLength(1);
    expect(results[0].text).toContain("Prompt: Explain retries");
    expect(results[0].text).toContain("Response excerpt:");
    expect(results[0].text.length).toBeLessThan(500);
  });

  it("stores rich metadata in remembered interactions", async () => {
    const memoryDir = await createTempDir();
    const manager = new MemoryManager(memoryDir);

    await manager.rememberInteraction(
      "Fix the bug in auth.ts",
      "Fixed the authentication timeout issue",
      ["bugfix"],
      {
        mode: "coder",
        provider: "ollama",
        model: "qwen2.5-coder:14b",
        filesEdited: ["src/auth.ts"],
        toolUsed: ["terminal npm test"],
      },
    );

    const results = await manager.longTerm.search("Fix the bug in auth.ts", 5);
    expect(results).toHaveLength(1);
    expect(results[0].text).toContain("Files edited: src/auth.ts");
    expect(results[0].text).toContain("Tools used: terminal npm test");
    expect(results[0].tags).toContain("coder");
  });

  it("returns session context summary", async () => {
    const memoryDir = await createTempDir();
    const manager = new MemoryManager(memoryDir);
    const sessionId = "test-session";

    manager.appendSessionMessage(sessionId, {
      role: "user",
      content: "Hello, how are you?",
    });
    manager.appendSessionMessage(sessionId, {
      role: "assistant",
      content: "I'm doing well, thanks!",
    });

    const context = manager.getSessionContext(sessionId);
    expect(context).toContain("User: Hello, how are you?");
    expect(context).toContain("Assistant: I'm doing well, thanks!");
  });

  it("applies recency bonus to recent entries", async () => {
    const memoryDir = await createTempDir();
    const store = new LongTermMemoryStore(memoryDir);

    await store.add({
      id: "old",
      timestamp: new Date(Date.now() - 30 * 86_400_000).toISOString(),
      type: "interaction",
      text: "Prompt: implement retry logic for HTTP requests",
      tags: ["networking"],
    });

    await store.add({
      id: "recent",
      timestamp: new Date().toISOString(),
      type: "interaction",
      text: "Prompt: implement retry logic for HTTP requests",
      tags: ["networking"],
    });

    const results = await store.search(
      "implement retry logic for HTTP requests",
      5,
    );
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].id).toBe("recent");
  });

  it("loads persisted sessions on init", async () => {
    const memoryDir = await createTempDir();
    const manager1 = new MemoryManager(memoryDir);
    const sessionId = "persist-test";

    manager1.appendSessionMessage(sessionId, {
      role: "user",
      content: "Test message",
    });

    await new Promise((resolve) => setTimeout(resolve, 100));

    const manager2 = new MemoryManager(memoryDir);
    await manager2.initialize();

    const messages = manager2.getSessionMessages(sessionId);
    expect(messages).toHaveLength(1);
    expect(messages[0].content).toBe("Test message");
  });
});
