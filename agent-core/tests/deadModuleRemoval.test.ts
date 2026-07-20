/**
 * NC-034 — Dead/disconnected module removal
 *
 * These tests verify that three dead source modules identified during
 * audit have been removed from the codebase:
 *   1. agent-core/src/agents/subagent.ts — comment-only placeholder
 *   2. agent-core/src/tools/batchEditor.ts — unused BatchEditor class
 *   3. extension/webview/src/components/StreamingText.tsx — unused component
 *
 * The tests assert that the files no longer exist, the modules cannot
 * be imported, and no barrel exports reference them.
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "..", "..");

function fileExists(filePath: string): boolean {
  try {
    fs.accessSync(filePath, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function fileContains(filePath: string, pattern: string): boolean {
  try {
    const content = fs.readFileSync(filePath, "utf8");
    return content.includes(pattern);
  } catch {
    return false;
  }
}

describe("NC-034 — Dead module removal", () => {
  describe("subagent.ts removed", () => {
    it("agent-core/src/agents/subagent.ts no longer exists", () => {
      const filePath = path.join(ROOT, "agent-core", "src", "agents", "subagent.ts");
      expect(fileExists(filePath)).toBe(false);
    });

    it("no barrel export references subagent", () => {
      const indexPath = path.join(ROOT, "agent-core", "src", "index.ts");
      expect(fileContains(indexPath, "subagent")).toBe(false);
    });
  });

  describe("batchEditor.ts removed", () => {
    it("agent-core/src/tools/batchEditor.ts no longer exists", () => {
      const filePath = path.join(ROOT, "agent-core", "src", "tools", "batchEditor.ts");
      expect(fileExists(filePath)).toBe(false);
    });

    it("no barrel export references batchEditor", () => {
      const indexPath = path.join(ROOT, "agent-core", "src", "index.ts");
      expect(fileContains(indexPath, "batchEditor")).toBe(false);
    });

    it("BatchEditor class is not imported anywhere in agent-core source", () => {
      const srcDir = path.join(ROOT, "agent-core", "src");
      const files = findTsFiles(srcDir);
      for (const file of files) {
        const content = fs.readFileSync(file, "utf8");
        expect(content).not.toMatch(/import.*BatchEditor.*from/);
        expect(content).not.toMatch(/from.*["'].*batchEditor["']/);
      }
    });
  });

  describe("StreamingText.tsx removed", () => {
    it("extension/webview/src/components/StreamingText.tsx no longer exists", () => {
      const filePath = path.join(
        ROOT,
        "extension",
        "webview",
        "src",
        "components",
        "StreamingText.tsx",
      );
      expect(fileExists(filePath)).toBe(false);
    });

    it("StreamingText component is not imported by any webview source file", () => {
      const webviewSrc = path.join(ROOT, "extension", "webview", "src");
      const files = findTsxFiles(webviewSrc);
      for (const file of files) {
        const content = fs.readFileSync(file, "utf8");
        // Match StreamingText as a standalone component import (not useStreamingText hook)
        expect(content).not.toMatch(/import\s*\{[^}]*\bStreamingText\b[^}]*\}\s*from/);
        expect(content).not.toMatch(/import\s+StreamingText\s+from/);
        expect(content).not.toMatch(/<StreamingText[\s/>]/);
        expect(content).not.toMatch(/from\s+["'].*\/StreamingText["']/);
      }
    });
  });

  describe("No other dead code references", () => {
    it("agent-core source has no import of subagent module", () => {
      const srcDir = path.join(ROOT, "agent-core", "src");
      const files = findTsFiles(srcDir);
      for (const file of files) {
        const content = fs.readFileSync(file, "utf8");
        expect(content).not.toMatch(/from.*["'].*\/subagent["']/);
        expect(content).not.toMatch(/import.*["'].*\/subagent["']/);
      }
    });

    it("agent-core source has no import of batchEditor module", () => {
      const srcDir = path.join(ROOT, "agent-core", "src");
      const files = findTsFiles(srcDir);
      for (const file of files) {
        const content = fs.readFileSync(file, "utf8");
        expect(content).not.toMatch(/from.*["'].*\/batchEditor["']/);
        expect(content).not.toMatch(/import.*["'].*\/batchEditor["']/);
      }
    });
  });
});

function findTsFiles(dir: string): string[] {
  const results: string[] = [];
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(...findTsFiles(fullPath));
      } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) {
        results.push(fullPath);
      }
    }
  } catch {
    // directory may not exist
  }
  return results;
}

function findTsxFiles(dir: string): string[] {
  const results: string[] = [];
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(...findTsxFiles(fullPath));
      } else if (entry.name.endsWith(".tsx")) {
        results.push(fullPath);
      }
    }
  } catch {
    // directory may not exist
  }
  return results;
}
