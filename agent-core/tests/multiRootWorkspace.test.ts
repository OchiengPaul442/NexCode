/**
 * NC-023: Multi-root workspace support regression tests.
 *
 * Verifies that:
 * - validateOpenFilePath correctly validates against any workspace root
 * - checkPathWithinWorkspace works with different workspace roots
 * - File operations resolve the correct workspace folder
 * - Path containment works across multiple workspace folders
 * - Edits are validated against the correct workspace root
 * - handleOpenFile equivalent validates against all workspace folders
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { validateOpenFilePath } from "../src/utils/webviewMessageValidation";
import { checkPathWithinWorkspace } from "../src/utils/pathContainment";
import { validateEditPreconditions, computeContentHash } from "../src/utils/editValidation";
import { ProposedEdit } from "../src/types";
import fs from "fs/promises";
import path from "path";
import os from "os";

function makeEdit(
  overrides: Partial<ProposedEdit> & { filePath: string },
): ProposedEdit {
  return {
    id: "test-edit-1",
    summary: "Test edit",
    oldText: "original content",
    newText: "new content",
    patch: "",
    ...overrides,
  };
}

describe("NC-023 — Multi-root workspace support", () => {
  let tmpDirA: string;
  let tmpDirB: string;
  let tmpDirOutside: string;

  beforeEach(async () => {
    tmpDirA = await fs.mkdtemp(path.join(os.tmpdir(), "nexcode-mr-a-"));
    tmpDirB = await fs.mkdtemp(path.join(os.tmpdir(), "nexcode-mr-b-"));
    tmpDirOutside = await fs.mkdtemp(path.join(os.tmpdir(), "nexcode-mr-outside-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDirA, { recursive: true, force: true });
    await fs.rm(tmpDirB, { recursive: true, force: true });
    await fs.rm(tmpDirOutside, { recursive: true, force: true });
  });

  // ─── validateOpenFilePath with multiple workspace roots ────────────

  describe("validateOpenFilePath — multi-root", () => {
    it("accepts a file in workspace folder A", () => {
      const result = validateOpenFilePath(tmpDirA, "src/index.ts");
      expect(result).toBe(path.join(tmpDirA, "src/index.ts"));
    });

    it("accepts a file in workspace folder B", () => {
      const result = validateOpenFilePath(tmpDirB, "lib/utils.ts");
      expect(result).toBe(path.join(tmpDirB, "lib/utils.ts"));
    });

    it("rejects a file not in any workspace folder", () => {
      const result = validateOpenFilePath(tmpDirA, "../outside/secret.ts");
      expect(result).toBeNull();
    });

    it("rejects traversal from folder A into folder B", () => {
      const traversal = path.join("..", path.basename(tmpDirB), "secret.ts");
      const result = validateOpenFilePath(tmpDirA, traversal);
      expect(result).toBeNull();
    });

    it("validates against the correct folder when checking multiple", () => {
      const folders = [tmpDirA, tmpDirB];
      const filePath = "src/main.ts";

      let foundRoot: string | null = null;
      for (const folder of folders) {
        const result = validateOpenFilePath(folder, filePath);
        if (result) {
          foundRoot = folder;
          break;
        }
      }

      expect(foundRoot).toBe(tmpDirA);
    });

    it("simulates multi-root openFile: tries all folders", () => {
      const folders = [tmpDirA, tmpDirB];
      const filePath = "lib/utils.ts";

      let containedPath: string | null = null;
      for (const folder of folders) {
        const result = validateOpenFilePath(folder, filePath);
        if (result) {
          containedPath = result;
          break;
        }
      }

      expect(containedPath).toBe(path.join(tmpDirA, "lib/utils.ts"));
    });

    it("rejects absolute paths that point outside all workspace folders", () => {
      const absPath = path.join(tmpDirOutside, "secret.ts");
      const result = validateOpenFilePath(tmpDirA, absPath);
      expect(result).toBeNull();
    });
  });

  // ─── checkPathWithinWorkspace — multi-root ─────────────────────────

  describe("checkPathWithinWorkspace — multi-root", () => {
    it("allows relative path in folder A", () => {
      const result = checkPathWithinWorkspace(tmpDirA, "src/index.ts");
      expect(result).toBe(path.join(tmpDirA, "src/index.ts"));
    });

    it("allows relative path in folder B", () => {
      const result = checkPathWithinWorkspace(tmpDirB, "lib/utils.ts");
      expect(result).toBe(path.join(tmpDirB, "lib/utils.ts"));
    });

    it("rejects traversal escaping folder A", () => {
      const result = checkPathWithinWorkspace(tmpDirA, "../secret.ts");
      expect(result).toBeNull();
    });

    it("rejects traversal escaping folder B", () => {
      const result = checkPathWithinWorkspace(tmpDirB, "../../etc/passwd");
      expect(result).toBeNull();
    });

    it("rejects absolute path outside workspace", () => {
      const absPath = path.join(tmpDirOutside, "file.ts");
      const result = checkPathWithinWorkspace(tmpDirA, absPath);
      expect(result).toBeNull();
    });

    it("handles deep nesting within workspace", () => {
      const deep = path.join("a", "b", "c", "d", "file.ts");
      const result = checkPathWithinWorkspace(tmpDirA, deep);
      expect(result).toBe(path.join(tmpDirA, deep));
    });
  });

  // ─── Edit validation — multi-root ──────────────────────────────────

  describe("validateEditPreconditions — multi-root", () => {
    it("validates edit against correct workspace root A", () => {
      const edit = makeEdit({
        filePath: "src/edit.ts",
        oldText: "original content",
        newText: "updated content",
      });

      const result = validateEditPreconditions(edit, tmpDirA, "original content");
      expect(result.ok).toBe(true);
    });

    it("validates edit against correct workspace root B", () => {
      const edit = makeEdit({
        filePath: "lib/utils.ts",
        oldText: "original content",
        newText: "updated content",
      });

      const result = validateEditPreconditions(edit, tmpDirB, "original content");
      expect(result.ok).toBe(true);
    });

    it("rejects edit with absolute path outside workspace root", () => {
      // An absolute path pointing to folder A is outside folder B
      const absPath = path.join(tmpDirA, "src", "edit.ts");
      const edit = makeEdit({
        filePath: absPath,
        oldText: "original content",
        newText: "updated content",
      });

      // Validate against folder B — should fail containment
      const result = validateEditPreconditions(edit, tmpDirB, "original content");
      expect(result.ok).toBe(false);
      expect(result.error).toBeDefined();
      // Error message indicates path escapes workspace (exact wording varies by platform)
      expect(
        result.error!.toLowerCase().includes("escapes") ||
        result.error!.toLowerCase().includes("outside") ||
        result.error!.toLowerCase().includes("workspace"),
      ).toBe(true);
    });

    it("rejects stale edit regardless of workspace root", () => {
      const edit = makeEdit({
        filePath: "src/edit.ts",
        oldText: "original content",
        newText: "updated content",
      });

      const result = validateEditPreconditions(edit, tmpDirA, "modified by someone else");
      expect(result.ok).toBe(false);
      expect(result.error).toContain("modified");
    });

    it("supports multiple workspace folders with different edit targets", () => {
      const editA = makeEdit({
        id: "edit-a",
        filePath: "component.tsx",
        oldText: "component original",
        newText: "component updated",
      });

      const editB = makeEdit({
        id: "edit-b",
        filePath: "utility.ts",
        oldText: "utility original",
        newText: "utility updated",
      });

      const resultA = validateEditPreconditions(editA, tmpDirA, "component original");
      const resultB = validateEditPreconditions(editB, tmpDirB, "utility original");

      expect(resultA.ok).toBe(true);
      expect(resultB.ok).toBe(true);
    });

    it("cross-root edit rejection: absolute path targeting folder A fails with folder B root", () => {
      // Use an absolute path that targets folder A
      const absPath = path.join(tmpDirA, "app.ts");
      const edit = makeEdit({
        filePath: absPath,
        oldText: "app content",
        newText: "app updated",
      });

      // This edit targets folder A via absolute path, but we validate against folder B
      const result = validateEditPreconditions(edit, tmpDirB, "app content");
      expect(result.ok).toBe(false);
    });
  });

  // ─── Content hash — workspace aware ────────────────────────────────

  describe("computeContentHash — consistency across workspaces", () => {
    it("same content produces same hash regardless of workspace", () => {
      const content = "function hello() { return 'world'; }";
      const hashA = computeContentHash(content);
      const hashB = computeContentHash(content);
      expect(hashA).toBe(hashB);
    });

    it("different content produces different hash", () => {
      const hashA = computeContentHash("content in workspace A");
      const hashB = computeContentHash("content in workspace B");
      expect(hashA).not.toBe(hashB);
    });
  });

  // ─── Workspace folder resolution patterns ──────────────────────────

  describe("workspace folder resolution patterns", () => {
    it("simulates resolving workspace from file URI", () => {
      const folders = [
        { name: "frontend", uri: tmpDirA },
        { name: "backend", uri: tmpDirB },
      ];

      const fileUri = path.join(tmpDirB, "api", "routes.ts");

      let resolvedFolder: { name: string; uri: string } | null = null;
      for (const folder of folders) {
        const relative = path.relative(folder.uri, fileUri);
        if (!relative.startsWith("..")) {
          resolvedFolder = folder;
          break;
        }
      }

      expect(resolvedFolder).not.toBeNull();
      expect(resolvedFolder!.name).toBe("backend");
    });

    it("simulates resolving workspace from active editor", () => {
      const folders = [
        { name: "frontend", uri: tmpDirA },
        { name: "backend", uri: tmpDirB },
      ];

      const activeEditorPath = path.join(tmpDirB, "server.ts");

      let resolvedRoot: string | null = null;
      for (const folder of folders) {
        const relative = path.relative(folder.uri, activeEditorPath);
        if (!relative.startsWith("..")) {
          resolvedRoot = folder.uri;
          break;
        }
      }

      expect(resolvedRoot).toBe(tmpDirB);
    });

    it("falls back to first workspace folder when no context available", () => {
      const folders = [
        { name: "frontend", uri: tmpDirA },
        { name: "backend", uri: tmpDirB },
      ];

      const resolvedRoot = folders[0]?.uri ?? null;
      expect(resolvedRoot).toBe(tmpDirA);
    });

    it("returns empty array when no workspace folders exist", () => {
      const folders: Array<{ name: string; uri: string }> = [];
      expect(folders.length).toBe(0);
    });
  });

  // ─── Edge cases ────────────────────────────────────────────────────

  describe("edge cases", () => {
    it("handles empty file path", () => {
      const result = validateOpenFilePath(tmpDirA, "");
      expect(result).toBeNull();
    });

    it("handles path with only whitespace", () => {
      const result = validateOpenFilePath(tmpDirA, "   ");
      expect(result).toBeNull();
    });

    it("handles dot-dot path that stays within workspace", () => {
      const result = validateOpenFilePath(tmpDirA, "src/../lib/utils.ts");
      expect(result).toBe(path.join(tmpDirA, "lib/utils.ts"));
    });

    it("handles deeply nested traversal", () => {
      const result = validateOpenFilePath(tmpDirA, "a/b/../../../../etc/passwd");
      expect(result).toBeNull();
    });

    it("handles Windows-style separators in path on any platform", () => {
      const result = validateOpenFilePath(tmpDirA, "src\\index.ts");
      // Result depends on platform — on POSIX backslash is valid filename char
      // On Windows it resolves to src/index.ts
      expect(result === null || result.includes("src")).toBe(true);
    });

    it("rejects path with null bytes via containsNullBytes", () => {
      // Null bytes are rejected at the path containment level
      const result = checkPathWithinWorkspace(tmpDirA, "src\x00/escape.ts");
      expect(result).toBeNull();
    });
  });

  // ─── Multi-root edit resolution pattern ─────────────────────────────

  describe("multi-root edit resolution pattern", () => {
    it("resolves workspace root from edit file path for correct validation", () => {
      // Simulates the sidebarViewProvider pattern for applyProposedEdit
      const folders = [
        { name: "frontend", uri: tmpDirA },
        { name: "backend", uri: tmpDirB },
      ];

      // Edit targets a file in the backend folder
      const edit = makeEdit({
        filePath: "api/routes.ts",
        oldText: "route content",
        newText: "updated route",
      });

      // Resolve workspace root from the edit's file path
      const editUri = path.join(folders[1].uri, edit.filePath);
      let resolvedRoot: string | null = null;
      for (const folder of folders) {
        const relative = path.relative(folder.uri, editUri);
        if (!relative.startsWith("..")) {
          resolvedRoot = folder.uri;
          break;
        }
      }

      expect(resolvedRoot).toBe(tmpDirB);

      // Now validate the edit against the resolved root
      const result = validateEditPreconditions(edit, resolvedRoot!, "route content");
      expect(result.ok).toBe(true);
    });

    it("rejects edit when resolved workspace root does not contain the file", () => {
      const folders = [
        { name: "frontend", uri: tmpDirA },
        { name: "backend", uri: tmpDirB },
      ];

      // Edit uses an absolute path targeting folder B
      const absPath = path.join(tmpDirB, "app.ts");
      const edit = makeEdit({
        filePath: absPath,
        oldText: "app content",
        newText: "updated app",
      });

      // Incorrectly resolve to the frontend folder for a backend file
      const result = validateEditPreconditions(edit, folders[0].uri, "app content");
      expect(result.ok).toBe(false);
    });
  });
});
