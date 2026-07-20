/**
 * NC-038: Generated webview artifacts are tracked in Git.
 *
 * Verifies:
 * - extension/media/main.js and main.css are listed in .gitignore
 * - The files are not tracked by Git (git ls-files returns empty)
 * - The build script can regenerate them
 * - The .gitignore entries are specific (not overly broad)
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

describe("NC-038: Generated webview artifacts not tracked in Git", () => {
  let REPO_ROOT: string;

  try {
    REPO_ROOT = getRepoRoot();
  } catch {
    REPO_ROOT = path.resolve(process.cwd());
  }

  describe(".gitignore entries", () => {
    it("extension/media/main.js is in .gitignore", async () => {
      const gitignorePath = path.join(REPO_ROOT, ".gitignore");
      const gitignore = await fs.promises.readFile(gitignorePath, "utf-8");

      expect(gitignore).toContain("extension/media/main.js");
    });

    it("extension/media/main.css is in .gitignore", async () => {
      const gitignorePath = path.join(REPO_ROOT, ".gitignore");
      const gitignore = await fs.promises.readFile(gitignorePath, "utf-8");

      expect(gitignore).toContain("extension/media/main.css");
    });

    it(".gitignore entries are specific to the generated files (not extension/media/*)", async () => {
      const gitignorePath = path.join(REPO_ROOT, ".gitignore");
      const gitignore = await fs.promises.readFile(gitignorePath, "utf-8");

      // Should NOT have a blanket extension/media/* rule that would ignore
      // non-generated assets like icon.png, activitybar-icon.svg, kiboko.svg
      expect(gitignore).not.toMatch(/^extension\/media\/\*/m);
    });
  });

  describe("Git tracking status", () => {
    it("extension/media/main.js is not tracked by Git", () => {
      const result = execSync("git ls-files extension/media/main.js", {
        cwd: REPO_ROOT,
        encoding: "utf-8",
        timeout: 5000,
      }).trim();

      expect(result).toBe("");
    });

    it("extension/media/main.css is not tracked by Git", () => {
      const result = execSync("git ls-files extension/media/main.css", {
        cwd: REPO_ROOT,
        encoding: "utf-8",
        timeout: 5000,
      }).trim();

      expect(result).toBe("");
    });
  });

  describe("Build scripts still reference the output files", () => {
    it("extension/package.json build:webview:js outputs to media/main.js", async () => {
      const pkgPath = path.join(REPO_ROOT, "extension", "package.json");
      const pkg = JSON.parse(await fs.promises.readFile(pkgPath, "utf-8"));

      expect(pkg.scripts["build:webview:js"]).toContain("media/main.js");
    });

    it("extension/package.json build:webview:css outputs to media/main.css", async () => {
      const pkgPath = path.join(REPO_ROOT, "extension", "package.json");
      const pkg = JSON.parse(await fs.promises.readFile(pkgPath, "utf-8"));

      expect(pkg.scripts["build:webview:css"]).toContain("media/main.css");
    });
  });

  describe("Static media assets are still tracked", () => {
    it("extension/media/icon.png is still tracked (not gitignored)", () => {
      const result = execSync("git ls-files extension/media/icon.png", {
        cwd: REPO_ROOT,
        encoding: "utf-8",
        timeout: 5000,
      }).trim();

      expect(result).toBe("extension/media/icon.png");
    });

    it("extension/media/activitybar-icon.svg is still tracked", () => {
      const result = execSync(
        "git ls-files extension/media/activitybar-icon.svg",
        {
          cwd: REPO_ROOT,
          encoding: "utf-8",
          timeout: 5000,
        },
      ).trim();

      expect(result).toBe("extension/media/activitybar-icon.svg");
    });
  });
});
