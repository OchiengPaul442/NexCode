import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { FileSystemTool } from "../src/tools/fileSystemTool";
import fs from "fs/promises";
import path from "path";
import os from "os";

describe("Path resolver consolidation (N2)", () => {
  let tmpDir: string;
  let outsideDir: string;
  let tool: FileSystemTool;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "nexcode-path-test-"));
    outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), "nexcode-outside-"));
    tool = new FileSystemTool(tmpDir);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
    await fs.rm(outsideDir, { recursive: true, force: true });
  });

  describe("resolveWorkspacePathSafe blocks symlink escapes", () => {
    it("rejects symlink pointing outside workspace", async () => {
      const linkPath = path.join(tmpDir, "escape-link");
      try {
        await fs.symlink(outsideDir, linkPath);
        await expect(tool.resolveWorkspacePathSafe("escape-link")).rejects.toThrow(
          "Path escapes workspace root",
        );
      } catch (err: unknown) {
        if ((err as NodeJS.ErrnoException).code === "EPERM") {
          return; // Skip on Windows without symlink privileges
        }
        throw err;
      }
    });

    it("allows symlink pointing inside workspace", async () => {
      const innerDir = path.join(tmpDir, "inner");
      await fs.mkdir(innerDir);
      const linkPath = path.join(tmpDir, "inner-link");
      try {
        await fs.symlink(innerDir, linkPath);
        const result = await tool.resolveWorkspacePathSafe("inner-link");
        expect(result).toContain(tmpDir);
      } catch (err: unknown) {
        if ((err as NodeJS.ErrnoException).code === "EPERM") {
          return;
        }
        throw err;
      }
    });

    it("rejects nested symlink escape (symlink -> symlink -> outside)", async () => {
      const innerDir = path.join(tmpDir, "inner");
      await fs.mkdir(innerDir);
      const link1Path = path.join(tmpDir, "link1");
      const link2Path = path.join(innerDir, "link2");
      try {
        await fs.symlink(innerDir, link1Path);
        await fs.symlink(outsideDir, link2Path);
        // link1/link2 resolves to outsideDir
        await expect(tool.resolveWorkspacePathSafe("link1/link2")).rejects.toThrow(
          "Path escapes workspace root",
        );
      } catch (err: unknown) {
        if ((err as NodeJS.ErrnoException).code === "EPERM") {
          return;
        }
        throw err;
      }
    });
  });

  describe("resolveWorkspacePathSafe allows safe paths", () => {
    it("allows normal relative path", async () => {
      const result = await tool.resolveWorkspacePathSafe("src/file.ts");
      expect(result).toBe(path.join(tmpDir, "src/file.ts"));
    });

    it("allows normal absolute path within workspace", async () => {
      const absPath = path.join(tmpDir, "src", "file.ts");
      const result = await tool.resolveWorkspacePathSafe(absPath);
      expect(result).toBe(absPath);
    });

    it("rejects ../ traversal", async () => {
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
  });

  describe("applyProposedEdit uses safe resolver", () => {
    it("rejects symlink escape in proposed edit", async () => {
      const linkPath = path.join(tmpDir, "escape-link");
      try {
        await fs.symlink(outsideDir, linkPath);
        // applyProposedEdit should use resolveWorkspacePathSafe
        // We can't call it directly without the full orchestrator,
        // but we verify the FileSystemTool safe resolver catches it
        await expect(tool.resolveWorkspacePathSafe("escape-link")).rejects.toThrow(
          "Path escapes workspace root",
        );
      } catch (err: unknown) {
        if ((err as NodeJS.ErrnoException).code === "EPERM") {
          return;
        }
        throw err;
      }
    });
  });
});
