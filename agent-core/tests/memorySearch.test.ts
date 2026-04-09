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
    expect(results[0].text.length).toBeLessThan(420);
  });
});
