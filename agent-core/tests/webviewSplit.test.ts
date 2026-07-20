/**
 * NC-036 & NC-037 — Webview monolithic file splitting and bundle size
 *
 * NC-036: Verifies that the monolithic main.tsx has been properly split
 * into extracted modules (types.ts, utils.ts, store.ts) with correct
 * imports, no circular dependencies, and reduced file size.
 *
 * NC-037: Verifies that the webview bundle stays under a reasonable
 * size budget after the split and that the build output exists.
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../..");
const WEBVIEW_SRC = path.join(ROOT, "extension", "webview", "src");
const WEBVIEW_MEDIA = path.join(ROOT, "extension", "media");

function readFile(relPath: string): string {
  return fs.readFileSync(path.join(WEBVIEW_SRC, relPath), "utf-8");
}

function lineCount(filePath: string): number {
  return fs.readFileSync(filePath, "utf-8").split("\n").length;
}

describe("NC-036 — Monolithic main.tsx splitting", () => {
  describe("extracted modules exist", () => {
    it("types.ts exists in webview/src", () => {
      expect(fs.existsSync(path.join(WEBVIEW_SRC, "types.ts"))).toBe(true);
    });

    it("utils.ts exists in webview/src", () => {
      expect(fs.existsSync(path.join(WEBVIEW_SRC, "utils.ts"))).toBe(true);
    });

    it("store.ts exists in webview/src", () => {
      expect(fs.existsSync(path.join(WEBVIEW_SRC, "store.ts"))).toBe(true);
    });

    it("main.tsx still exists as the entry point", () => {
      expect(fs.existsSync(path.join(WEBVIEW_SRC, "main.tsx"))).toBe(true);
    });
  });

  describe("main.tsx imports from extracted modules", () => {
    it("main.tsx imports types from ./types", () => {
      const mainContent = readFile("main.tsx");
      expect(mainContent).toMatch(/from\s+["']\.\/types["']/);
    });

    it("main.tsx imports utilities from ./utils", () => {
      const mainContent = readFile("main.tsx");
      expect(mainContent).toMatch(/from\s+["']\.\/utils["']/);
    });

    it("main.tsx imports store from ./store", () => {
      const mainContent = readFile("main.tsx");
      expect(mainContent).toMatch(/from\s+["']\.\/store["']/);
    });
  });

  describe("extracted modules export expected symbols", () => {
    it("types.ts exports ProviderId type", () => {
      const content = readFile("types.ts");
      expect(content).toContain("export type ProviderId");
    });

    it("types.ts exports ChatMessage interface", () => {
      const content = readFile("types.ts");
      expect(content).toContain("export interface ChatMessage");
    });

    it("types.ts exports SidebarSettings interface", () => {
      const content = readFile("types.ts");
      expect(content).toContain("export interface SidebarSettings");
    });

    it("types.ts exports StoreState interface", () => {
      const content = readFile("types.ts");
      expect(content).toContain("export interface StoreState");
    });

    it("utils.ts exports stripSecretsFromSettings function", () => {
      const content = readFile("utils.ts");
      expect(content).toContain("export function stripSecretsFromSettings");
    });

    it("utils.ts exports makeId function", () => {
      const content = readFile("utils.ts");
      expect(content).toContain("export function makeId");
    });

    it("utils.ts exports createSession function", () => {
      const content = readFile("utils.ts");
      expect(content).toContain("export function createSession");
    });

    it("utils.ts exports mapAgentModeToUi function", () => {
      const content = readFile("utils.ts");
      expect(content).toContain("export function mapAgentModeToUi");
    });

    it("store.ts exports vscode handle", () => {
      const content = readFile("store.ts");
      expect(content).toContain("export const vscode");
    });

    it("store.ts exports useStore hook", () => {
      const content = readFile("store.ts");
      expect(content).toContain("useStore");
    });
  });

  describe("no duplicated definitions", () => {
    it("main.tsx does not re-declare ProviderId type", () => {
      const content = readFile("main.tsx");
      const exportTypeLines = content.split("\n").filter(
        (line) => line.includes("export type ProviderId"),
      );
      expect(exportTypeLines.length).toBe(0);
    });

    it("main.tsx does not re-declare stripSecretsFromSettings", () => {
      const content = readFile("main.tsx");
      const defLines = content.split("\n").filter(
        (line) => line.includes("function stripSecretsFromSettings"),
      );
      expect(defLines.length).toBe(0);
    });

    it("main.tsx does not re-declare makeId", () => {
      const content = readFile("main.tsx");
      const defLines = content.split("\n").filter(
        (line) => line.match(/function\s+makeId\b/),
      );
      expect(defLines.length).toBe(0);
    });

    it("main.tsx does not re-declare createSession", () => {
      const content = readFile("main.tsx");
      const defLines = content.split("\n").filter(
        (line) => line.match(/function\s+createSession\b/),
      );
      expect(defLines.length).toBe(0);
    });
  });

  describe("file size reduction", () => {
    it("main.tsx is under 4500 lines (was 5648)", () => {
      const mainPath = path.join(WEBVIEW_SRC, "main.tsx");
      const lines = lineCount(mainPath);
      expect(lines).toBeLessThan(4500);
    });

    it("main.tsx is still over 1000 lines (substantial UI remains)", () => {
      const mainPath = path.join(WEBVIEW_SRC, "main.tsx");
      const lines = lineCount(mainPath);
      expect(lines).toBeGreaterThan(1000);
    });

    it("types.ts is between 100 and 600 lines", () => {
      const typesPath = path.join(WEBVIEW_SRC, "types.ts");
      const lines = lineCount(typesPath);
      expect(lines).toBeGreaterThan(100);
      expect(lines).toBeLessThan(600);
    });

    it("utils.ts is between 100 and 800 lines", () => {
      const utilsPath = path.join(WEBVIEW_SRC, "utils.ts");
      const lines = lineCount(utilsPath);
      expect(lines).toBeGreaterThan(100);
      expect(lines).toBeLessThan(800);
    });

    it("store.ts is between 100 and 1000 lines", () => {
      const storePath = path.join(WEBVIEW_SRC, "store.ts");
      const lines = lineCount(storePath);
      expect(lines).toBeGreaterThan(100);
      expect(lines).toBeLessThan(1000);
    });
  });

  describe("no circular dependencies between extracted modules", () => {
    it("types.ts does not import from main.tsx", () => {
      const content = readFile("types.ts");
      expect(content).not.toMatch(/from\s+["']\.\/main/);
    });

    it("types.ts does not import from store.ts", () => {
      const content = readFile("types.ts");
      expect(content).not.toMatch(/from\s+["']\.\/store/);
    });

    it("types.ts does not import from utils.ts", () => {
      const content = readFile("types.ts");
      expect(content).not.toMatch(/from\s+["']\.\/utils/);
    });

    it("utils.ts does not import from main.tsx", () => {
      const content = readFile("utils.ts");
      expect(content).not.toMatch(/from\s+["']\.\/main/);
    });

    it("utils.ts does not import from store.ts", () => {
      const content = readFile("utils.ts");
      expect(content).not.toMatch(/from\s+["']\.\/store/);
    });

    it("store.ts does not import from main.tsx", () => {
      const content = readFile("store.ts");
      expect(content).not.toMatch(/from\s+["']\.\/main/);
    });
  });

  describe("extracted module NC annotations", () => {
    it("types.ts contains NC-036 annotation", () => {
      const content = readFile("types.ts");
      expect(content).toContain("NC-036");
    });

    it("utils.ts contains NC-036 annotation", () => {
      const content = readFile("utils.ts");
      expect(content).toContain("NC-036");
    });

    it("store.ts contains NC-036 annotation", () => {
      const content = readFile("store.ts");
      expect(content).toContain("NC-036");
    });
  });
});

describe("NC-037 — Webview bundle size budget", () => {
  describe("build output exists", () => {
    it("extension/media/main.js exists (JS bundle)", () => {
      expect(fs.existsSync(path.join(WEBVIEW_MEDIA, "main.js"))).toBe(true);
    });

    it("extension/media/main.css exists (CSS bundle)", () => {
      expect(fs.existsSync(path.join(WEBVIEW_MEDIA, "main.css"))).toBe(true);
    });
  });

  describe("bundle size under budget", () => {
    it("main.js is under 920 KB (budget)", () => {
      const stats = fs.statSync(path.join(WEBVIEW_MEDIA, "main.js"));
      const sizeKB = stats.size / 1024;
      expect(sizeKB).toBeLessThan(920);
    });

    it("main.js is at least 500 KB (sanity check — not accidentally empty/stub)", () => {
      const stats = fs.statSync(path.join(WEBVIEW_MEDIA, "main.js"));
      const sizeKB = stats.size / 1024;
      expect(sizeKB).toBeGreaterThan(500);
    });

    it("main.css is under 120 KB", () => {
      const stats = fs.statSync(path.join(WEBVIEW_MEDIA, "main.css"));
      const sizeKB = stats.size / 1024;
      expect(sizeKB).toBeLessThan(120);
    });
  });

  describe("esbuild config uses minification", () => {
    it("package.json build:webview:js script includes --minify", () => {
      const pkg = JSON.parse(
        fs.readFileSync(path.join(ROOT, "extension", "package.json"), "utf-8"),
      );
      const script = pkg.scripts?.["build:webview:js"] ?? "";
      expect(script).toContain("--minify");
    });
  });
});
