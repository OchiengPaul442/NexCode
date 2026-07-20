import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { FileSystemTool } from "../src/tools/fileSystemTool";
import fs from "fs/promises";
import path from "path";
import os from "os";

/**
 * NC-021 — Directory clearing follows symlinks and deletes targets
 *
 * Regression tests ensuring:
 * - deletePath() unlinks symlinks instead of deleting their targets
 * - clearDirectory() unlinks symlinks instead of following and deleting targets
 * - Symlinks pointing outside the workspace are skipped (not followed)
 * - Broken symlinks are unlinked safely
 * - Target files survive after symlink deletion
 * - Mixed directories with files, dirs, and symlinks are handled correctly
 */
describe("NC-021: Symlink delete behavior", () => {
  let tmpDir: string;
  let tool: FileSystemTool;
  let outsideDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "nexcode-nc021-"));
    outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), "nexcode-nc021-outside-"));
    tool = new FileSystemTool(tmpDir);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
    await fs.rm(outsideDir, { recursive: true, force: true });
  });

  // Helper: create symlink, skip if platform doesn't support it
  async function safeSymlink(target: string, link: string): Promise<boolean> {
    try {
      await fs.symlink(target, link);
      return true;
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === "EPERM" || (err as NodeJS.ErrnoException).code === "EXDEV") {
        return false;
      }
      throw err;
    }
  }

  // ─── deletePath symlink tests ───

  it("deletePath: unlinks symlink, target file survives", async () => {
    const targetFile = path.join(tmpDir, "real-file.txt");
    const linkFile = path.join(tmpDir, "link-to-file");
    await fs.writeFile(targetFile, "secret content");

    const created = await safeSymlink(targetFile, linkFile);
    if (!created) return; // platform doesn't support symlinks

    const result = await tool.deletePath("link-to-file");
    expect(result.ok).toBe(true);

    // Symlink is gone
    const linkExists = await fs
      .lstat(linkFile)
      .then(() => true)
      .catch(() => false);
    expect(linkExists).toBe(false);

    // Target file still exists
    const targetExists = await fs
      .stat(targetFile)
      .then(() => true)
      .catch(() => false);
    expect(targetExists).toBe(true);

    const content = await fs.readFile(targetFile, "utf8");
    expect(content).toBe("secret content");
  });

  it("deletePath: unlinks symlink to directory, target directory survives", async () => {
    const targetDir = path.join(tmpDir, "real-dir");
    const linkDir = path.join(tmpDir, "link-to-dir");
    await fs.mkdir(targetDir);
    await fs.writeFile(path.join(targetDir, "file.txt"), "inside dir");

    const created = await safeSymlink(targetDir, linkDir);
    if (!created) return;

    const result = await tool.deletePath("link-to-dir");
    expect(result.ok).toBe(true);

    // Symlink is gone
    const linkExists = await fs
      .lstat(linkDir)
      .then(() => true)
      .catch(() => false);
    expect(linkExists).toBe(false);

    // Target directory and its contents survive
    const dirExists = await fs
      .stat(targetDir)
      .then(() => true)
      .catch(() => false);
    expect(dirExists).toBe(true);

    const files = await fs.readdir(targetDir);
    expect(files).toContain("file.txt");
  });

  it("deletePath: unlinks symlink pointing outside workspace", async () => {
    const outsideFile = path.join(outsideDir, "outside.txt");
    await fs.writeFile(outsideFile, "outside content");
    const linkPath = path.join(tmpDir, "escape-link");

    const created = await safeSymlink(outsideFile, linkPath);
    if (!created) return;

    const result = await tool.deletePath("escape-link");
    expect(result.ok).toBe(true);

    // Symlink is gone
    const linkExists = await fs
      .lstat(linkPath)
      .then(() => true)
      .catch(() => false);
    expect(linkExists).toBe(false);

    // Outside file survives
    const outsideExists = await fs
      .stat(outsideFile)
      .then(() => true)
      .catch(() => false);
    expect(outsideExists).toBe(true);
  });

  it("deletePath: unlinks broken symlink", async () => {
    const linkPath = path.join(tmpDir, "broken-link");
    const created = await safeSymlink("/nonexistent/path/that/does/not/exist", linkPath);
    if (!created) return;

    const result = await tool.deletePath("broken-link");
    expect(result.ok).toBe(true);

    const linkExists = await fs
      .lstat(linkPath)
      .then(() => true)
      .catch(() => false);
    expect(linkExists).toBe(false);
  });

  // ─── clearDirectory symlink tests ───

  it("clearDirectory: unlinks in-workspace symlinks, target files survive", async () => {
    // Create target files
    const targetA = path.join(tmpDir, "target-a.txt");
    const targetB = path.join(tmpDir, "target-b.txt");
    await fs.writeFile(targetA, "content A");
    await fs.writeFile(targetB, "content B");

    // Create directory with symlinks to those targets
    const dir = path.join(tmpDir, "cleardir");
    await fs.mkdir(dir);
    const linkA = path.join(dir, "link-a");
    const linkB = path.join(dir, "link-b");
    const createdA = await safeSymlink(targetA, linkA);
    const createdB = await safeSymlink(targetB, linkB);
    if (!createdA || !createdB) return;

    const result = await tool.clearDirectory("cleardir");
    expect(result.ok).toBe(true);

    // Symlinks are gone
    const linkAExists = await fs
      .lstat(linkA)
      .then(() => true)
      .catch(() => false);
    const linkBExists = await fs
      .lstat(linkB)
      .then(() => true)
      .catch(() => false);
    expect(linkAExists).toBe(false);
    expect(linkBExists).toBe(false);

    // Target files survive
    const contentA = await fs.readFile(targetA, "utf8");
    const contentB = await fs.readFile(targetB, "utf8");
    expect(contentA).toBe("content A");
    expect(contentB).toBe("content B");
  });

  it("clearDirectory: skips symlinks pointing outside workspace", async () => {
    const outsideFile = path.join(outsideDir, "outside.txt");
    await fs.writeFile(outsideFile, "outside content");

    const dir = path.join(tmpDir, "cleardir");
    await fs.mkdir(dir);
    const linkPath = path.join(dir, "escape-link");
    const created = await safeSymlink(outsideFile, linkPath);
    if (!created) return;

    const result = await tool.clearDirectory("cleardir");
    expect(result.ok).toBe(true);

    // Symlink still exists (skipped, not deleted)
    const linkExists = await fs
      .lstat(linkPath)
      .then(() => true)
      .catch(() => false);
    expect(linkExists).toBe(true);

    // Outside file survives
    const outsideExists = await fs
      .stat(outsideFile)
      .then(() => true)
      .catch(() => false);
    expect(outsideExists).toBe(true);
  });

  it("clearDirectory: handles broken symlinks gracefully", async () => {
    const dir = path.join(tmpDir, "cleardir");
    await fs.mkdir(dir);
    const linkPath = path.join(dir, "broken-link");
    const created = await safeSymlink("/nonexistent/target", linkPath);
    if (!created) return;

    const result = await tool.clearDirectory("cleardir");
    expect(result.ok).toBe(true);

    const linkExists = await fs
      .lstat(linkPath)
      .then(() => true)
      .catch(() => false);
    expect(linkExists).toBe(false);
  });

  it("clearDirectory: handles mixed files, directories, and symlinks", async () => {
    const targetFile = path.join(tmpDir, "target-file.txt");
    await fs.writeFile(targetFile, "target content");

    const dir = path.join(tmpDir, "cleardir");
    await fs.mkdir(dir);

    // Regular file
    await fs.writeFile(path.join(dir, "regular.txt"), "regular");

    // Subdirectory
    await fs.mkdir(path.join(dir, "subdir"));
    await fs.writeFile(path.join(dir, "subdir", "nested.txt"), "nested");

    // Symlink to in-workspace target
    const linkIn = path.join(dir, "link-in");
    const createdIn = await safeSymlink(targetFile, linkIn);
    if (!createdIn) return;

    // Symlink to outside target
    const outsideFile = path.join(outsideDir, "outside.txt");
    await fs.writeFile(outsideFile, "outside");
    const linkOut = path.join(dir, "link-out");
    const createdOut = await safeSymlink(outsideFile, linkOut);
    if (!createdOut) return;

    const result = await tool.clearDirectory("cleardir");
    expect(result.ok).toBe(true);

    // Regular file is gone
    const regularExists = await fs
      .access(path.join(dir, "regular.txt"))
      .then(() => true)
      .catch(() => false);
    expect(regularExists).toBe(false);

    // Subdirectory is gone
    const subdirExists = await fs
      .access(path.join(dir, "subdir"))
      .then(() => true)
      .catch(() => false);
    expect(subdirExists).toBe(false);

    // In-workspace symlink is gone
    const linkInExists = await fs
      .lstat(linkIn)
      .then(() => true)
      .catch(() => false);
    expect(linkInExists).toBe(false);

    // Outside-workspace symlink is preserved (skipped)
    const linkOutExists = await fs
      .lstat(linkOut)
      .then(() => true)
      .catch(() => false);
    expect(linkOutExists).toBe(true);

    // Target file survives
    const targetExists = await fs
      .stat(targetFile)
      .then(() => true)
      .catch(() => false);
    expect(targetExists).toBe(true);

    // Outside file survives
    const outsideExists = await fs
      .stat(outsideFile)
      .then(() => true)
      .catch(() => false);
    expect(outsideExists).toBe(true);
  });

  it("clearDirectory: symlink to in-workspace directory — only symlink removed, not target dir contents", async () => {
    const targetDir = path.join(tmpDir, "real-subdir");
    await fs.mkdir(targetDir);
    await fs.writeFile(path.join(targetDir, "a.txt"), "a");
    await fs.writeFile(path.join(targetDir, "b.txt"), "b");

    const dir = path.join(tmpDir, "cleardir");
    await fs.mkdir(dir);
    const linkPath = path.join(dir, "link-to-subdir");
    const created = await safeSymlink(targetDir, linkPath);
    if (!created) return;

    const result = await tool.clearDirectory("cleardir");
    expect(result.ok).toBe(true);

    // Symlink is gone
    const linkExists = await fs
      .lstat(linkPath)
      .then(() => true)
      .catch(() => false);
    expect(linkExists).toBe(false);

    // Target directory and contents survive
    const files = await fs.readdir(targetDir);
    expect(files).toContain("a.txt");
    expect(files).toContain("b.txt");
  });

  it("deletePath: regular file still works after symlink fixes", async () => {
    const testFile = path.join(tmpDir, "regular.txt");
    await fs.writeFile(testFile, "content");

    const result = await tool.deletePath("regular.txt");
    expect(result.ok).toBe(true);

    const exists = await fs
      .access(testFile)
      .then(() => true)
      .catch(() => false);
    expect(exists).toBe(false);
  });

  it("clearDirectory: empty directory works after symlink fixes", async () => {
    const dir = path.join(tmpDir, "emptydir");
    await fs.mkdir(dir);

    const result = await tool.clearDirectory("emptydir");
    expect(result.ok).toBe(true);

    const entries = await fs.readdir(dir);
    expect(entries.length).toBe(0);
  });

  it("clearDirectory: rejects traversal even for symlinks", async () => {
    const dir = path.join(tmpDir, "cleardir");
    await fs.mkdir(dir);
    // Create a symlink with a traversal name (not a real symlink escape, just a traversal path)
    await fs.writeFile(path.join(dir, "file.txt"), "content");

    const result = await tool.clearDirectory("../outside");
    expect(result.ok).toBe(false);
    expect(result.output).toContain("Path escapes workspace root");
  });
});
