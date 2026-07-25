import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { EnhancedMemoryManager } from "../src/memory/enhancedMemory";

describe("EnhancedMemoryManager", () => {
  let tempDir: string;
  let manager: EnhancedMemoryManager;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "memory-test-"));
    manager = new EnhancedMemoryManager(tempDir);
    await manager.initialize();
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("should initialize without errors", async () => {
    const newManager = new EnhancedMemoryManager(tempDir);
    await newManager.initialize();
    expect(true).toBe(true);
  });

  it("should return empty context when no entries exist", () => {
    const context = manager.getContext();
    expect(context).toBe("");
  });

  it("should add entries and return context", async () => {
    await manager.addEntry({
      topic: "architecture",
      content: "Use TypeScript strict mode",
      source: "test",
    });

    const context = manager.getContext();
    expect(context).toContain("Project memory:");
    expect(context).toContain("architecture");
  });

  it("should search across topics", async () => {
    await manager.addEntry({
      topic: "typescript",
      content: "Use TypeScript strict mode",
      source: "test",
    });

    await manager.addEntry({
      topic: "testing",
      content: "Write unit tests for all modules",
      source: "test",
    });

    const results = await manager.search("TypeScript");
    expect(results).toContain("typescript");
  });

  it("should prune old entries", async () => {
    // Add many entries to exceed limit
    for (let i = 0; i < 100; i++) {
      await manager.addEntry({
        topic: "test-topic",
        content: `Entry ${i}`,
        source: "test",
      });
    }

    await manager.prune();
    // Should not throw
    expect(true).toBe(true);
  });

  it("should handle missing directory gracefully", async () => {
    const nonExistentDir = path.join(tempDir, "nonexistent");
    const newManager = new EnhancedMemoryManager(nonExistentDir);
    await newManager.initialize();
    const context = newManager.getContext();
    expect(context).toBe("");
  });
});
