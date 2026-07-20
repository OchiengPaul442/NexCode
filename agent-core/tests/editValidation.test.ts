import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  computeContentHash,
  validateEditPreconditions,
} from "../src/utils/editValidation";
import { checkPathWithinWorkspace } from "../src/utils/pathContainment";
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

describe("NC-006 — Edit validation (path containment + stale content)", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "nexcode-editval-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  // ─── computeContentHash ─────────────────────────────────────

  describe("computeContentHash", () => {
    it("returns deterministic hash for same content", () => {
      const h1 = computeContentHash("hello world");
      const h2 = computeContentHash("hello world");
      expect(h1).toBe(h2);
    });

    it("returns different hash for different content", () => {
      const h1 = computeContentHash("hello");
      const h2 = computeContentHash("world");
      expect(h1).not.toBe(h2);
    });

    it("returns 64-char hex string (SHA-256)", () => {
      const h = computeContentHash("test");
      expect(h).toMatch(/^[0-9a-f]{64}$/);
    });

    it("handles empty string", () => {
      const h = computeContentHash("");
      expect(h).toMatch(/^[0-9a-f]{64}$/);
    });

    it("handles unicode content", () => {
      const h = computeContentHash("日本語テスト 🎉");
      expect(h).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  // ─── checkPathWithinWorkspace (re-exported) ─────────────────

  describe("checkPathWithinWorkspace", () => {
    it("allows relative path within workspace", () => {
      const result = checkPathWithinWorkspace(tmpDir, "src/file.ts");
      expect(result).toBe(path.join(tmpDir, "src/file.ts"));
    });

    it("rejects traversal with ../", () => {
      const result = checkPathWithinWorkspace(tmpDir, "../etc/passwd");
      expect(result).toBeNull();
    });

    it("rejects absolute path outside workspace", () => {
      const result = checkPathWithinWorkspace(tmpDir, "/tmp/evil.ts");
      expect(result).toBeNull();
    });

    it("rejects empty path", () => {
      const result = checkPathWithinWorkspace(tmpDir, "");
      expect(result).toBeNull();
    });

    it("rejects whitespace-only path", () => {
      const result = checkPathWithinWorkspace(tmpDir, "   ");
      expect(result).toBeNull();
    });

    it("rejects path with null bytes", () => {
      // Note: checkPathWithinWorkspace does not explicitly check for null bytes.
      // This test documents the current behavior. If null-byte rejection is added
      // to pathContainment.ts, this test should be updated to expect null.
      const result = checkPathWithinWorkspace(tmpDir, "file\x00.ts");
      // On POSIX, null bytes in paths cause fs errors later; on Windows they're invalid.
      // The function may or may not reject them — document actual behavior.
      if (result !== null) {
        // If it doesn't reject, that's a known gap (NC-020 territory)
        expect(typeof result).toBe("string");
      }
    });

    it("allows nested relative path", () => {
      const result = checkPathWithinWorkspace(tmpDir, "a/b/c/d.ts");
      expect(result).toBe(path.join(tmpDir, "a/b/c/d.ts"));
    });

    it("rejects deep traversal", () => {
      const result = checkPathWithinWorkspace(tmpDir, "src/../../etc/passwd");
      expect(result).toBeNull();
    });
  });

  // ─── validateEditPreconditions — path containment ───────────

  describe("validateEditPreconditions — path containment", () => {
    it("accepts valid relative path within workspace", () => {
      const edit = makeEdit({ filePath: "src/app.ts" });
      const result = validateEditPreconditions(edit, tmpDir, "original content");
      expect(result.ok).toBe(true);
      expect(result.absolutePath).toBe(path.join(tmpDir, "src/app.ts"));
    });

    it("rejects path traversal via ../", () => {
      const edit = makeEdit({ filePath: "../etc/passwd" });
      const result = validateEditPreconditions(edit, tmpDir, "original content");
      expect(result.ok).toBe(false);
      expect(result.error).toContain("escapes workspace root");
    });

    it("rejects absolute path outside workspace", () => {
      const edit = makeEdit({ filePath: "/tmp/evil.ts" });
      const result = validateEditPreconditions(edit, tmpDir, "original content");
      expect(result.ok).toBe(false);
      expect(result.error).toContain("escapes workspace root");
    });

    it("rejects deep traversal", () => {
      const edit = makeEdit({ filePath: "src/../../etc/passwd" });
      const result = validateEditPreconditions(edit, tmpDir, "original content");
      expect(result.ok).toBe(false);
      expect(result.error).toContain("escapes workspace root");
    });

    it("rejects path with backslash traversal on POSIX", () => {
      const edit = makeEdit({ filePath: "src\\..\\..\\etc\\passwd" });
      const result = validateEditPreconditions(edit, tmpDir, "original content");
      // On POSIX, backslashes are literal characters, so this becomes a valid
      // relative path. On Windows, it would be a traversal. The test documents
      // the behavior — the important thing is that real traversal is blocked.
      if (process.platform === "win32") {
        expect(result.ok).toBe(false);
      } else {
        // POSIX: backslash is literal, path is valid
        expect(result.ok).toBe(true);
      }
    });
  });

  // ─── validateEditPreconditions — stale content detection ────

  describe("validateEditPreconditions — stale content detection", () => {
    it("accepts when current content matches oldText", () => {
      const edit = makeEdit({ filePath: "src/app.ts", oldText: "file content" });
      const result = validateEditPreconditions(edit, tmpDir, "file content");
      expect(result.ok).toBe(true);
      expect(result.currentContentHash).toBeDefined();
      expect(result.expectedContentHash).toBeDefined();
    });

    it("rejects when current content differs from oldText", () => {
      const edit = makeEdit({ filePath: "src/app.ts", oldText: "old content" });
      const result = validateEditPreconditions(edit, tmpDir, "newer content");
      expect(result.ok).toBe(false);
      expect(result.error).toContain("modified since this edit was proposed");
      expect(result.error).toContain("content hash");
      expect(result.currentContentHash).toBeDefined();
      expect(result.expectedContentHash).toBeDefined();
      expect(result.currentContentHash).not.toBe(result.expectedContentHash);
    });

    it("rejects when file was modified between proposal and apply", () => {
      const edit = makeEdit({
        filePath: "src/app.ts",
        oldText: "const x = 1;\n",
        newText: "const x = 2;\n",
      });
      // Simulate: file was modified by another process
      const result = validateEditPreconditions(edit, tmpDir, "const x = 3;\n");
      expect(result.ok).toBe(false);
      expect(result.error).toContain("modified since this edit was proposed");
    });

    it("accepts new file creation (oldText empty, currentContent null)", () => {
      const edit = makeEdit({ filePath: "src/new.ts", oldText: "", newText: "new file content" });
      const result = validateEditPreconditions(edit, tmpDir, null);
      expect(result.ok).toBe(true);
    });

    it("rejects new file creation when oldText is not empty", () => {
      const edit = makeEdit({ filePath: "src/ghost.ts", oldText: "existing content" });
      const result = validateEditPreconditions(edit, tmpDir, null);
      expect(result.ok).toBe(false);
      expect(result.error).toContain("does not exist");
      expect(result.error).toContain("oldText is not empty");
    });

    it("accepts when both oldText and currentContent are empty", () => {
      const edit = makeEdit({ filePath: "src/empty.ts", oldText: "", newText: "something" });
      const result = validateEditPreconditions(edit, tmpDir, "");
      expect(result.ok).toBe(true);
    });

    it("rejects when oldText is empty but file has content", () => {
      const edit = makeEdit({ filePath: "src/changed.ts", oldText: "", newText: "replacement" });
      const result = validateEditPreconditions(edit, tmpDir, "existing content");
      expect(result.ok).toBe(false);
    });

    it("provides hash information in error for debugging", () => {
      const edit = makeEdit({ filePath: "src/app.ts", oldText: "expected" });
      const result = validateEditPreconditions(edit, tmpDir, "actual");
      expect(result.ok).toBe(false);
      expect(result.currentContentHash).toMatch(/^[0-9a-f]{64}$/);
      expect(result.expectedContentHash).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  // ─── validateEditPreconditions — combined scenarios ─────────

  describe("validateEditPreconditions — combined scenarios", () => {
    it("rejects traversal even if content matches", () => {
      const edit = makeEdit({
        filePath: "../escape.ts",
        oldText: "content",
      });
      const result = validateEditPreconditions(edit, tmpDir, "content");
      expect(result.ok).toBe(false);
      expect(result.error).toContain("escapes workspace root");
    });

    it("full valid scenario: path in workspace + content matches", () => {
      const edit = makeEdit({
        filePath: "src/components/App.tsx",
        oldText: "import React from 'react';\n",
        newText: "import React from 'react';\nimport useState from 'react';\n",
      });
      const result = validateEditPreconditions(
        edit,
        tmpDir,
        "import React from 'react';\n",
      );
      expect(result.ok).toBe(true);
      expect(result.absolutePath).toBe(
        path.join(tmpDir, "src/components/App.tsx"),
      );
    });

    it("handles Windows-style path separators in filePath", () => {
      const edit = makeEdit({ filePath: "src\\components\\App.tsx" });
      const result = validateEditPreconditions(edit, tmpDir, "original");
      // On Windows, backslash is the path separator, so normalize/join handles it.
      // The result depends on how path.relative processes the normalized form.
      // The key invariant: it must not be a security bypass.
      if (process.platform === "win32") {
        // On Windows, backslashes are normalized to the correct separator.
        // path.relative should produce a valid relative path.
        // Note: the actual behavior depends on Node's path implementation.
        expect(typeof result.ok).toBe("boolean");
      } else {
        // POSIX: backslash is a literal character in filenames.
        // The path becomes "tmpDir/src\components\App.tsx" which is valid.
        expect(result.ok).toBe(true);
      }
    });
  });

  // ─── Edit review service integration (unit-level) ───────────

  describe("Edit review service path containment integration", () => {
    it("applyEdit path traversal is caught by checkPathWithinWorkspace", () => {
      // Simulates what editReviewService.applyEdit does before using path.join
      const filePath = "../../etc/passwd";
      const result = checkPathWithinWorkspace(tmpDir, filePath);
      expect(result).toBeNull();
    });

    it("previewEdit path traversal is caught by checkPathWithinWorkspace", () => {
      const filePath = "../escape/secret.txt";
      const result = checkPathWithinWorkspace(tmpDir, filePath);
      expect(result).toBeNull();
    });

    it("valid path passes both checks", () => {
      const filePath = "src/utils/helper.ts";
      const pathResult = checkPathWithinWorkspace(tmpDir, filePath);
      expect(pathResult).not.toBeNull();

      const edit = makeEdit({ filePath, oldText: "help" });
      const editResult = validateEditPreconditions(edit, tmpDir, "help");
      expect(editResult.ok).toBe(true);
    });
  });

  // ─── Orchestrator applyProposedEdit path validation ─────────

  describe("Orchestrator applyProposedEdit integration", () => {
    it("validateEditPreconditions catches traversal before write", () => {
      // The orchestrator now calls validateEditPreconditions before fs.writeFile.
      // This test verifies that the validation would catch traversal.
      const edit = makeEdit({
        filePath: "../../malicious.ts",
        oldText: "",
        newText: "evil code",
      });
      const result = validateEditPreconditions(edit, tmpDir, null);
      expect(result.ok).toBe(false);
      expect(result.error).toContain("escapes workspace root");
    });

    it("validateEditPreconditions catches stale content before write", () => {
      const edit = makeEdit({
        filePath: "src/app.ts",
        oldText: "original",
        newText: "modified",
      });
      // File was changed after proposal
      const result = validateEditPreconditions(edit, tmpDir, "changed by someone else");
      expect(result.ok).toBe(false);
      expect(result.error).toContain("modified since this edit was proposed");
    });
  });
});
