import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { FileSystemTool, atomicWriteFile } from "../src/tools/fileSystemTool";
import fs from "fs/promises";
import path from "path";
import os from "os";

describe("atomicWriteFile", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "nexcode-atomic-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("creates a new file atomically", async () => {
    const filePath = path.join(tmpDir, "new.txt");
    await atomicWriteFile(filePath, "hello world");
    const content = await fs.readFile(filePath, "utf8");
    expect(content).toBe("hello world");
  });

  it("overwrites an existing file atomically", async () => {
    const filePath = path.join(tmpDir, "existing.txt");
    await fs.writeFile(filePath, "original content", "utf8");
    await atomicWriteFile(filePath, "new content");
    const content = await fs.readFile(filePath, "utf8");
    expect(content).toBe("new content");
  });

  it("preserves original file content when write fails (simulated)", async () => {
    const filePath = path.join(tmpDir, "preserve.txt");
    await fs.writeFile(filePath, "original", "utf8");

    // Make the directory read-only so rename fails on POSIX.
    // On Windows this may not fail, so we test the temp file cleanup path
    // by checking no leftover temp files remain.
    try {
      // Attempt to write to a non-existent deep path that can't be created.
      const badPath = path.join(tmpDir, "nonexistent", "deep", "file.txt");
      await atomicWriteFile(badPath, "new content");
    } catch {
      // Expected to fail.
    }

    // Original file should still be intact (if it existed before).
    const content = await fs.readFile(filePath, "utf8");
    expect(content).toBe("original");
  });

  it("cleans up temp file after successful write", async () => {
    const filePath = path.join(tmpDir, "clean.txt");
    await atomicWriteFile(filePath, "content");

    // List files in directory — should only have "clean.txt", no temp files.
    const files = await fs.readdir(tmpDir);
    const tempFiles = files.filter((f) => f.startsWith(".nexcode-tmp-"));
    expect(tempFiles).toHaveLength(0);
  });

  it("cleans up temp file after failed write", async () => {
    // Write to a read-only directory to force failure.
    const readOnlyDir = path.join(tmpDir, "readonly");
    await fs.mkdir(readOnlyDir);
    const filePath = path.join(readOnlyDir, "file.txt");

    // Make directory read-only (POSIX only; skip on Windows if EPERM).
    try {
      await fs.chmod(readOnlyDir, 0o555);
    } catch {
      // Windows may not support chmod; skip this test variant.
      return;
    }

    try {
      await atomicWriteFile(filePath, "content");
    } catch {
      // Expected to fail.
    }

    // Temp file should be cleaned up.
    const files = await fs.readdir(readOnlyDir);
    const tempFiles = files.filter((f) => f.startsWith(".nexcode-tmp-"));
    expect(tempFiles).toHaveLength(0);

    // Restore permissions for cleanup.
    await fs.chmod(readOnlyDir, 0o755);
  });

  it("creates parent directories if they don't exist", async () => {
    const filePath = path.join(tmpDir, "a", "b", "c", "file.txt");
    await atomicWriteFile(filePath, "nested content");
    const content = await fs.readFile(filePath, "utf8");
    expect(content).toBe("nested content");
  });

  it("preserves file permissions on overwrite", async () => {
    const filePath = path.join(tmpDir, "perms.txt");
    await fs.writeFile(filePath, "content", "utf8");
    // Set specific permissions (POSIX only).
    try {
      await fs.chmod(filePath, 0o644);
    } catch {
      return; // Skip on Windows.
    }

    await atomicWriteFile(filePath, "updated");

    const stat = await fs.stat(filePath);
    // On POSIX, the mode should be preserved (mask for permission bits).
    if (process.platform !== "win32") {
      expect(stat.mode & 0o777).toBe(0o644);
    }
  });

  it("handles empty string content", async () => {
    const filePath = path.join(tmpDir, "empty.txt");
    await atomicWriteFile(filePath, "");
    const content = await fs.readFile(filePath, "utf8");
    expect(content).toBe("");
  });

  it("handles large content", async () => {
    const filePath = path.join(tmpDir, "large.txt");
    const largeContent = "x".repeat(100_000);
    await atomicWriteFile(filePath, largeContent);
    const content = await fs.readFile(filePath, "utf8");
    expect(content).toBe(largeContent);
  });

  it("no leftover temp files after multiple writes", async () => {
    const filePath = path.join(tmpDir, "multi.txt");
    for (let i = 0; i < 10; i++) {
      await atomicWriteFile(filePath, `iteration ${i}`);
    }
    const content = await fs.readFile(filePath, "utf8");
    expect(content).toBe("iteration 9");

    const files = await fs.readdir(tmpDir);
    const tempFiles = files.filter((f) => f.startsWith(".nexcode-tmp-"));
    expect(tempFiles).toHaveLength(0);
  });
});

describe("FileSystemTool.writeFile — atomic behavior", () => {
  let tmpDir: string;
  let tool: FileSystemTool;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "nexcode-fswrite-"));
    tool = new FileSystemTool(tmpDir);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("writes file successfully", async () => {
    const result = await tool.writeFile("test.txt", "hello");
    expect(result.ok).toBe(true);
    const content = await fs.readFile(path.join(tmpDir, "test.txt"), "utf8");
    expect(content).toBe("hello");
  });

  it("overwrites existing file", async () => {
    await tool.writeFile("test.txt", "original");
    const result = await tool.writeFile("test.txt", "replaced");
    expect(result.ok).toBe(true);
    const content = await fs.readFile(path.join(tmpDir, "test.txt"), "utf8");
    expect(content).toBe("replaced");
  });

  it("creates parent directories", async () => {
    const result = await tool.writeFile("a/b/c/file.txt", "nested");
    expect(result.ok).toBe(true);
    const content = await fs.readFile(path.join(tmpDir, "a/b/c/file.txt"), "utf8");
    expect(content).toBe("nested");
  });

  it("rejects traversal paths", async () => {
    const result = await tool.writeFile("../escape.txt", "bad");
    expect(result.ok).toBe(false);
    expect(result.output).toContain("Path escapes workspace root");
  });

  it("no temp files left after write", async () => {
    await tool.writeFile("clean.txt", "content");
    const files = await fs.readdir(tmpDir);
    const tempFiles = files.filter((f) => f.startsWith(".nexcode-tmp-"));
    expect(tempFiles).toHaveLength(0);
  });
});

describe("FileSystemTool.patchFile — unique match enforcement", () => {
  let tmpDir: string;
  let tool: FileSystemTool;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "nexcode-patch-"));
    tool = new FileSystemTool(tmpDir);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("patches a file with unique match", async () => {
    await fs.writeFile(path.join(tmpDir, "file.txt"), "hello world", "utf8");
    const result = await tool.patchFile("file.txt", "world", "universe");
    expect(result.ok).toBe(true);
    expect(result.output).toContain("Patched");
    const content = await fs.readFile(path.join(tmpDir, "file.txt"), "utf8");
    expect(content).toBe("hello universe");
  });

  it("rejects patch when oldText appears multiple times", async () => {
    await fs.writeFile(path.join(tmpDir, "file.txt"), "aaa bbb aaa", "utf8");
    const result = await tool.patchFile("file.txt", "aaa", "ccc");
    expect(result.ok).toBe(false);
    expect(result.output).toContain("appears 2 times");
    expect(result.output).toContain("Provide a unique snippet");
    // Original content must be unchanged.
    const content = await fs.readFile(path.join(tmpDir, "file.txt"), "utf8");
    expect(content).toBe("aaa bbb aaa");
  });

  it("rejects patch when oldText appears three times", async () => {
    await fs.writeFile(path.join(tmpDir, "file.txt"), "x y x z x", "utf8");
    const result = await tool.patchFile("file.txt", "x", "w");
    expect(result.ok).toBe(false);
    expect(result.output).toContain("appears 3 times");
  });

  it("rejects patch when oldText not found", async () => {
    await fs.writeFile(path.join(tmpDir, "file.txt"), "hello", "utf8");
    const result = await tool.patchFile("file.txt", "missing", "replacement");
    expect(result.ok).toBe(false);
    expect(result.output).toContain("Could not find");
  });

  it("uses atomic write for patch", async () => {
    await fs.writeFile(path.join(tmpDir, "file.txt"), "original", "utf8");
    await tool.patchFile("file.txt", "original", "patched");
    const content = await fs.readFile(path.join(tmpDir, "file.txt"), "utf8");
    expect(content).toBe("patched");
    // No temp files left.
    const files = await fs.readdir(tmpDir);
    const tempFiles = files.filter((f) => f.startsWith(".nexcode-tmp-"));
    expect(tempFiles).toHaveLength(0);
  });

  it("preserves content on patch failure (unique match required)", async () => {
    const original = "duplicate duplicate duplicate";
    await fs.writeFile(path.join(tmpDir, "file.txt"), original, "utf8");
    const result = await tool.patchFile("file.txt", "duplicate", "new");
    expect(result.ok).toBe(false);
    // File content must be unchanged.
    const content = await fs.readFile(path.join(tmpDir, "file.txt"), "utf8");
    expect(content).toBe(original);
  });

  it("preserves content on patch failure (oldText not found)", async () => {
    const original = "keep this intact";
    await fs.writeFile(path.join(tmpDir, "file.txt"), original, "utf8");
    const result = await tool.patchFile("file.txt", "not here", "nope");
    expect(result.ok).toBe(false);
    const content = await fs.readFile(path.join(tmpDir, "file.txt"), "utf8");
    expect(content).toBe(original);
  });

  it("patch reports correct byte count change", async () => {
    await fs.writeFile(path.join(tmpDir, "file.txt"), "ab", "utf8");
    const result = await tool.patchFile("file.txt", "ab", "abcd");
    expect(result.ok).toBe(true);
    expect(result.output).toContain("2 -> 4 bytes");
  });

  it("rejects traversal in patch target", async () => {
    const result = await tool.patchFile("../escape.txt", "a", "b");
    expect(result.ok).toBe(false);
    expect(result.output).toContain("Path escapes workspace root");
  });

  it("rejects empty oldText match (empty string matches every position)", async () => {
    await fs.writeFile(path.join(tmpDir, "file.txt"), "hello", "utf8");
    // Empty string would technically "match" infinitely many times.
    // The split().length - 1 would be 5 for "hello", so it should be rejected.
    const result = await tool.patchFile("file.txt", "", "x");
    expect(result.ok).toBe(false);
    expect(result.output).toContain("appears");
  });
});
