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

  it("rejects ../ traversal escape", async () => {
    await expect(tool.resolveWorkspacePathSafe("../etc/passwd")).rejects.toThrow(
      "Path escapes workspace root",
    );
  });

  it("rejects absolute path outside workspace", async () => {
    const absPath = path.join(tmpDir, "..", "outside");
    await expect(tool.resolveWorkspacePathSafe(absPath)).rejects.toThrow(
      "Path escapes workspace root",
    );
  });

  it("rejects mixed separators for traversal", async () => {
    await expect(tool.resolveWorkspacePathSafe("..\\..\\etc\\passwd")).rejects.toThrow(
      "Path escapes workspace root",
    );
  });

  it("allows valid relative paths within workspace", async () => {
    const result = await tool.resolveWorkspacePathSafe("src/file.ts");
    expect(result).toBe(path.join(tmpDir, "src/file.ts"));
  });

  it("allows valid absolute paths within workspace", async () => {
    const absPath = path.join(tmpDir, "src", "file.ts");
    const result = await tool.resolveWorkspacePathSafe(absPath);
    expect(result).toBe(absPath);
  });

  it("normalizes paths correctly", async () => {
    const result = await tool.resolveWorkspacePathSafe("src/../src/./file.ts");
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
      await expect(tool.resolveWorkspacePathSafe("escape-link")).rejects.toThrow(
        "Path escapes workspace root",
      );
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === "EPERM") {
        return;
      }
      throw err;
    } finally {
      await fs.rm(outsideDir, { recursive: true, force: true });
    }
  });
});
