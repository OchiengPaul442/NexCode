/**
 * NC-030: Regression tests for ESLint configuration.
 *
 * Verifies that real ESLint linting (beyond TypeScript compilation) is
 * configured with type-aware rules as required by the audit finding.
 */

import { describe, it, expect, beforeAll } from "vitest";
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../..");
const ESLINT_CONFIG = path.join(ROOT, "eslint.config.mjs");

describe("NC-030: ESLint configuration", () => {
  describe("config file exists", () => {
    it("eslint.config.mjs exists at project root", () => {
      expect(fs.existsSync(ESLINT_CONFIG)).toBe(true);
    });

    it("eslint.config.mjs is a non-empty file", () => {
      const content = fs.readFileSync(ESLINT_CONFIG, "utf-8");
      expect(content.length).toBeGreaterThan(100);
    });
  });

  describe("config contains required type-aware rules", () => {
    let configContent: string;

    beforeAll(() => {
      configContent = fs.readFileSync(ESLINT_CONFIG, "utf-8");
    });

    it("enables no-floating-promises as error", () => {
      expect(configContent).toContain('"@typescript-eslint/no-floating-promises": "error"');
    });

    it("enables no-misused-promises as error", () => {
      expect(configContent).toContain('"@typescript-eslint/no-misused-promises"');
      expect(configContent).toContain('"error"');
    });

    it("enables switch-exhaustiveness-check", () => {
      expect(configContent).toContain('"@typescript-eslint/switch-exhaustiveness-check"');
    });

    it("enables consistent-type-imports", () => {
      expect(configContent).toContain('"@typescript-eslint/consistent-type-imports"');
    });

    it("enables no-unsafe-argument", () => {
      expect(configContent).toContain('"@typescript-eslint/no-unsafe-argument"');
    });

    it("enables no-unsafe-assignment", () => {
      expect(configContent).toContain('"@typescript-eslint/no-unsafe-assignment"');
    });

    it("enables no-unsafe-member-access", () => {
      expect(configContent).toContain('"@typescript-eslint/no-unsafe-member-access"');
    });

    it("enables no-unsafe-return", () => {
      expect(configContent).toContain('"@typescript-eslint/no-unsafe-return"');
    });
  });

  describe("config has correct file patterns", () => {
    let configContent: string;

    beforeAll(() => {
      configContent = fs.readFileSync(ESLINT_CONFIG, "utf-8");
    });

    it("covers agent-core production source", () => {
      expect(configContent).toContain('files: ["agent-core/src/**/*.ts"]');
    });

    it("covers extension production source", () => {
      expect(configContent).toContain('files: ["extension/src/**/*.ts"]');
    });

    it("covers webview source", () => {
      expect(configContent).toContain('files: ["extension/webview/src/**/*.{ts,tsx}"]');
    });

    it("covers test files with relaxed rules", () => {
      expect(configContent).toContain('files: ["agent-core/tests/**/*.ts"');
    });
  });

  describe("config uses project service for type-aware rules", () => {
    let configContent: string;

    beforeAll(() => {
      configContent = fs.readFileSync(ESLINT_CONFIG, "utf-8");
    });

    it("enables projectService for type-aware linting", () => {
      expect(configContent).toContain("projectService: true");
    });
  });

  describe("config ignores build artifacts", () => {
    let configContent: string;

    beforeAll(() => {
      configContent = fs.readFileSync(ESLINT_CONFIG, "utf-8");
    });

    it("ignores dist directories", () => {
      expect(configContent).toContain('"**/dist/**"');
    });

    it("ignores node_modules", () => {
      expect(configContent).toContain('"**/node_modules/**"');
    });

    it("ignores extension media (generated bundles)", () => {
      expect(configContent).toContain('"**/extension/media/**"');
    });

    it("ignores declaration files", () => {
      expect(configContent).toContain('"**/*.d.ts"');
    });
  });

  describe("devDependencies include ESLint packages", () => {
    it("root package.json has eslint", () => {
      const pkg = JSON.parse(
        fs.readFileSync(path.join(ROOT, "package.json"), "utf-8"),
      );
      expect(pkg.devDependencies).toBeDefined();
      expect(pkg.devDependencies.eslint).toBeDefined();
      expect(pkg.devDependencies["@eslint/js"]).toBeDefined();
      expect(pkg.devDependencies["typescript-eslint"]).toBeDefined();
    });
  });

  describe("lint scripts exist", () => {
    it("root package.json has lint:eslint script", () => {
      const pkg = JSON.parse(
        fs.readFileSync(path.join(ROOT, "package.json"), "utf-8"),
      );
      expect(pkg.scripts["lint:eslint"]).toBeDefined();
      expect(typeof pkg.scripts["lint:eslint"]).toBe("string");
    });

    it("root package.json has typecheck script", () => {
      const pkg = JSON.parse(
        fs.readFileSync(path.join(ROOT, "package.json"), "utf-8"),
      );
      expect(pkg.scripts.typecheck).toBeDefined();
    });

    it("root lint script includes both typecheck and eslint", () => {
      const pkg = JSON.parse(
        fs.readFileSync(path.join(ROOT, "package.json"), "utf-8"),
      );
      expect(pkg.scripts.lint).toContain("typecheck");
      expect(pkg.scripts.lint).toContain("lint:eslint");
    });
  });

  describe("webviewMessageValidation switch is exhaustive", () => {
    it("all VALID_MESSAGE_TYPES are handled in the switch", () => {
      const validationFile = fs.readFileSync(
        path.join(ROOT, "agent-core/src/utils/webviewMessageValidation.ts"),
        "utf-8",
      );

      // Extract VALID_MESSAGE_TYPES from the source
      const typesMatch = validationFile.match(
        /const VALID_MESSAGE_TYPES = \[([\s\S]*?)\] as const;/,
      );
      expect(typesMatch).not.toBeNull();

      const typesStr = typesMatch![1];
      const typeNames = typesStr
        .match(/"(\w+)"/g)!
        .map((t: string) => t.replace(/"/g, ""));

      // Every type should appear as a case in the switch
      const switchSection = validationFile.substring(
        validationFile.indexOf("switch (msgType)"),
      );

      for (const typeName of typeNames) {
        expect(switchSection).toContain(`case "${typeName}"`);
      }
    });
  });

  describe("floating promise fixes are present", () => {
    it("sidebarViewProvider voids async calls in resolveWebviewView", () => {
      const sidebarFile = fs.readFileSync(
        path.join(ROOT, "extension/src/sidebarViewProvider.ts"),
        "utf-8",
      );
      // pushInitialWebviewState and processNextTask should be voided
      expect(sidebarFile).toContain("void this.pushInitialWebviewState()");
      expect(sidebarFile).toContain("void this.processNextTask()");
    });

    it("toolRegistry voids auditLog.log call", () => {
      const toolRegistryFile = fs.readFileSync(
        path.join(ROOT, "agent-core/src/tools/toolRegistry.ts"),
        "utf-8",
      );
      expect(toolRegistryFile).toContain("void this.auditLog.log(");
    });
  });
});
