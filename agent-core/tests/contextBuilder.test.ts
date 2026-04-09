import { describe, it, expect, vi } from "vitest";
import fs from "fs/promises";
import path from "path";
import {
  buildWorkspaceContext,
  clampText,
  extractLikelyFileReferences,
  buildAttachmentContext,
  normalizeActivityPath,
} from "../src/orchestrator/contextBuilder";
import { RequestAttachment } from "../src/types";

// Mock fs
vi.mock("fs/promises");

const mockedFs = vi.mocked(fs);

describe("contextBuilder", () => {
  describe("clampText", () => {
    it("returns text if under limit", () => {
      const result = clampText("hello", 10, "trimmed");
      expect(result).toBe("hello");
    });

    it("clamps text over limit", () => {
      const result = clampText("hello world", 5, "trimmed");
      expect(result).toBe("hello\n\n[trimmed; 6 characters omitted]");
    });
  });

  describe("extractLikelyFileReferences", () => {
    it("extracts file paths", () => {
      const result = extractLikelyFileReferences(
        "Check src/index.ts and test.js",
      );
      expect(result).toEqual(["src/index.ts", "test.js"]);
    });

    it("filters short matches", () => {
      const result = extractLikelyFileReferences("a.b");
      expect(result).toEqual(["a.b"]);
    });
  });

  describe("buildAttachmentContext", () => {
    it("builds context for text attachment", () => {
      const attachments: RequestAttachment[] = [
        {
          fileName: "test.txt",
          kind: "text",
          mimeType: "text/plain",
          byteSize: 100,
          textContent: "hello world",
        },
      ];
      const result = buildAttachmentContext(attachments);
      expect(result).toContain("test.txt");
      expect(result).toContain("hello world");
    });
  });

  describe("normalizeActivityPath", () => {
    it("normalizes path", () => {
      const result = normalizeActivityPath("src\\file.ts", "/workspace");
      expect(result).toBe("src/file.ts");
    });
  });

  describe("buildWorkspaceContext", () => {
    it("builds context", async () => {
      mockedFs.readdir.mockResolvedValue([
        { name: "src", isDirectory: () => true },
        { name: "package.json", isDirectory: () => false },
      ] as any);
      mockedFs.readFile.mockResolvedValue("content");

      const request = {
        workspaceRoot: "/workspace",
        activeFilePath: "src/index.ts",
        selectedText: "selected",
        prompt: "prompt",
        attachments: [] as RequestAttachment[],
      };

      const result = await buildWorkspaceContext(request, "/default");

      expect(result).toContain("Workspace root: /workspace");
      expect(result).toContain("src/, package.json");
      expect(result).toContain("Active file: src/index.ts");
    });
  });
});
