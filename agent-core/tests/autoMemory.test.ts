import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { AutoMemory } from "../src/memory/autoMemory";
import fs from "fs/promises";
import path from "path";
import os from "os";

describe("AutoMemory", () => {
  let tempDir: string;
  let memory: AutoMemory;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "auto-memory-test-"));
    memory = new AutoMemory(tempDir);
    await memory.load();
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("should create auto memory", () => {
    expect(memory).toBeDefined();
  });

  it("should load without errors", async () => {
    await memory.load();
    expect(true).toBe(true);
  });

  it("should add and retrieve entries", async () => {
    await memory.addEntry("convention", "naming", "Use camelCase", ["style"]);
    
    const results = memory.search("naming");
    expect(results.length).toBe(1);
    expect(results[0].key).toBe("naming");
    expect(results[0].value).toBe("Use camelCase");
  });

  it("should search by key", async () => {
    await memory.addEntry("file-pattern", ".ts", "TypeScript files", ["extension"]);
    await memory.addEntry("file-pattern", ".js", "JavaScript files", ["extension"]);
    
    const results = memory.search(".ts");
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].key).toBe(".ts");
  });

  it("should search by value", async () => {
    await memory.addEntry("convention", "style", "Use camelCase for variables", ["style"]);
    
    const results = memory.search("camelCase");
    expect(results.length).toBe(1);
  });

  it("should get context for prompts", async () => {
    await memory.addEntry("convention", "naming", "Use camelCase", ["style"]);
    
    const context = memory.getContext();
    expect(context).toContain("Project memory:");
    expect(context).toContain("naming");
  });

  it("should learn from operations", async () => {
    await memory.learnFromOperation("read file", "success", ["src/index.ts"]);
    
    const results = memory.search(".ts");
    expect(results.length).toBeGreaterThan(0);
  });

  it("should prune old entries", async () => {
    await memory.addEntry("convention", "old", "Old value", []);
    
    // Manually set timestamp to old
    const entries = Array.from((memory as any).entries.values());
    if (entries.length > 0) {
      entries[0].timestamp = Date.now() - (31 * 24 * 60 * 60 * 1000); // 31 days ago
    }
    
    await memory.prune();
    
    const results = memory.search("old");
    expect(results.length).toBe(0);
  });

  it("should save and load from disk", async () => {
    await memory.addEntry("convention", "test", "Test value", []);
    
    // Create new memory instance and load
    const newMemory = new AutoMemory(tempDir);
    await newMemory.load();
    
    const results = newMemory.search("test");
    expect(results.length).toBe(1);
    expect(results[0].value).toBe("Test value");
  });
});
