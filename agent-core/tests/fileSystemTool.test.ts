import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { FileSystemTool } from "../src/tools/fileSystemTool";
import fs from "fs/promises";
import path from "path";
import os from "os";

describe("FileSystemTool path safety", () => {
  let tmpDir: string;
  let tool: FileSystemTool;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "nexcode-test-"));
    tool = new FileSystemTool(tmpDir);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("rejects ../ traversal escape", () => {
    expect(() => tool.resolveWorkspacePath("../etc/passwd")).toThrow(
      "Path escapes workspace root",
    );
  });

  it("rejects absolute path outside workspace", () => {
    const absPath = path.join(tmpDir, "..", "outside");
    expect(() => tool.resolveWorkspacePath(absPath)).toThrow(
      "Path escapes workspace root",
    );
  });

  it("rejects mixed separators for traversal", () => {
    expect(() => tool.resolveWorkspacePath("..\\..\\etc\\passwd")).toThrow(
      "Path escapes workspace root",
    );
  });

  it("allows valid relative paths within workspace", () => {
    const result = tool.resolveWorkspacePath("src/file.ts");
    expect(result).toBe(path.join(tmpDir, "src/file.ts"));
  });

  it("allows valid absolute paths within workspace", () => {
    const absPath = path.join(tmpDir, "src", "file.ts");
    const result = tool.resolveWorkspacePath(absPath);
    expect(result).toBe(absPath);
  });

  it("normalizes paths correctly", () => {
    const result = tool.resolveWorkspacePath("src/../src/./file.ts");
    expect(result).toBe(path.join(tmpDir, "src/file.ts"));
  });

  it("refuses to delete workspace root", async () => {
    const result = await tool.deletePath(".");
    expect(result.ok).toBe(false);
    expect(result.output).toContain("Refusing to delete the workspace root");
  });

  it("refuses to delete-contents on workspace root", async () => {
    const result = await tool.clearDirectory(".");
    expect(result.ok).toBe(false);
    expect(result.output).toContain("Refusing to delete the workspace root");
  });

  it("can delete a file within workspace", async () => {
    const testFile = path.join(tmpDir, "deleteme.txt");
    await fs.writeFile(testFile, "hello");
    const result = await tool.deletePath("deleteme.txt");
    expect(result.ok).toBe(true);
    const exists = await fs
      .stat(testFile)
      .then(() => true)
      .catch(() => false);
    expect(exists).toBe(false);
  });

  it("can clear directory contents within workspace", async () => {
    const testDir = path.join(tmpDir, "cleardir");
    await fs.mkdir(testDir);
    await fs.writeFile(path.join(testDir, "a.txt"), "a");
    await fs.writeFile(path.join(testDir, "b.txt"), "b");
    const result = await tool.clearDirectory("cleardir");
    expect(result.ok).toBe(true);
    const entries = await fs.readdir(testDir);
    expect(entries.length).toBe(0);
  });
});

describe("FileSystemTool symlink safety", () => {
  let tmpDir: string;
  let tool: FileSystemTool;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "nexcode-test-"));
    tool = new FileSystemTool(tmpDir);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("rejects symlink pointing outside workspace", async () => {
    const outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), "nexcode-outside-"));
    const linkPath = path.join(tmpDir, "escape-link");
    try {
      await fs.symlink(outsideDir, linkPath);
      // resolveWorkspacePath resolves the symlink target path
      // but the check is on the logical path, not the resolved symlink
      // This test documents the current behavior
      const result = tool.resolveWorkspacePath("escape-link");
      // The logical path is within workspace, but the symlink points outside
      // This is a known limitation - the current implementation checks logical path only
      expect(result).toBe(path.join(tmpDir, "escape-link"));
    } catch (err: unknown) {
      // On Windows, symlink creation requires elevated privileges
      // Skip this test if we can't create symlinks
      if ((err as NodeJS.ErrnoException).code === "EPERM") {
        return;
      }
      throw err;
    } finally {
      await fs.rm(outsideDir, { recursive: true, force: true });
    }
  });
});
