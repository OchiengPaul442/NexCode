/**
 * NC-042: Exposing "reasoning" by default is the wrong UX contract.
 *
 * Verifies:
 * - showReasoning defaults to false in package.json manifest
 * - sidebarViewProvider fallback defaults to false
 * - showReasoning setting is recognized by the webview message validation allowlist
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";

/** Resolve the repo root regardless of cwd — uses git to find it. */
function getRepoRoot(): string {
  return execSync("git rev-parse --show-toplevel", {
    encoding: "utf-8",
    timeout: 5000,
  }).trim();
}

describe("NC-042: showReasoning defaults to false", () => {
  let REPO_ROOT: string;

  try {
    REPO_ROOT = getRepoRoot();
  } catch {
    // Fallback for environments without git
    REPO_ROOT = path.resolve(process.cwd());
  }

  describe("package.json manifest", () => {
    it("showReasoning setting has default: false", async () => {
      const pkgPath = path.join(REPO_ROOT, "extension", "package.json");
      const pkg = JSON.parse(await fs.promises.readFile(pkgPath, "utf-8"));

      const showReasoning =
        pkg.contributes?.configuration?.properties?.[
          "nexcodeKiboko.showReasoning"
        ];

      expect(showReasoning).toBeDefined();
      expect(showReasoning.type).toBe("boolean");
      expect(showReasoning.default).toBe(false);
    });

    it("showReasoning description mentions disabled by default", async () => {
      const pkgPath = path.join(REPO_ROOT, "extension", "package.json");
      const pkg = JSON.parse(await fs.promises.readFile(pkgPath, "utf-8"));

      const showReasoning =
        pkg.contributes?.configuration?.properties?.[
          "nexcodeKiboko.showReasoning"
        ];

      expect(showReasoning.description.toLowerCase()).toContain("disabled");
    });
  });

  describe("sidebarViewProvider fallback", () => {
    it("getRuntimeSettings uses false as fallback for showReasoning", async () => {
      const srcPath = path.join(
        REPO_ROOT,
        "extension",
        "src",
        "sidebarViewProvider.ts",
      );
      const src = await fs.promises.readFile(srcPath, "utf-8");

      // Look for the config.get pattern with showReasoning
      const match = src.match(
        /config\.get<boolean>\("showReasoning",\s*(true|false)\)/,
      );

      expect(match).not.toBeNull();
      expect(match![1]).toBe("false");
    });
  });

  describe("webview message validation", () => {
    it("showReasoning is in the allowed setting keys", async () => {
      // The showReasoning key should be in the allowlist so users can toggle it
      const { isAllowedSettingKey } = await import(
        "../src/utils/webviewMessageValidation"
      );

      expect(isAllowedSettingKey("showReasoning")).toBe(true);
    });
  });

  describe("reasoning UI still works when enabled", () => {
    it("reasoning UI components exist in the webview code", async () => {
      // Verify the ReasoningIndicator component exists — changing the default
      // should not remove the ability to show reasoning when explicitly enabled
      const mainTsxPath = path.join(
        REPO_ROOT,
        "extension",
        "webview",
        "src",
        "main.tsx",
      );
      const mainTsx = await fs.promises.readFile(mainTsxPath, "utf-8");

      expect(mainTsx).toContain("ReasoningIndicator");
      expect(mainTsx).toContain("nk-reasoning");
    });
  });
});
