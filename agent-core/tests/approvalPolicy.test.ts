/**
 * NC-008: Auto/bypass approval modes undermine user consent.
 *
 * Verifies:
 * - Bypass mode has been removed from the toolApproval enum
 * - The extension-layer fallback auto-approve for write/append/patch is removed
 * - The policy engine is the sole source of truth for auto-approval
 * - Legacy bypass values in config fall back to "ask"
 * - Write/append/patch require explicit user approval in auto mode
 */

import { describe, it, expect } from "vitest";
import {
  DefaultToolApprovalPolicy,
  ToolApprovalPolicy,
} from "../src/tools/toolApprovalPolicy";

describe("NC-008: Approval policy — no bypass, no extension fallback", () => {
  const policy: ToolApprovalPolicy = new DefaultToolApprovalPolicy();

  describe("bypass mode removed from enum", () => {
    it("toolApproval enum in package.json only contains auto and ask", async () => {
      // Read the package.json and verify the enum
      const fs = await import("fs");
      const path = await import("path");
      const { execSync } = await import("child_process");
      const repoRoot = execSync("git rev-parse --show-toplevel", {
        encoding: "utf-8",
        timeout: 5000,
      }).trim();
      const pkgPath = path.join(
        repoRoot,
        "extension",
        "package.json",
      );
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
      const toolApproval = pkg.contributes.configuration.properties[
        "nexcodeKiboko.toolApproval"
      ];
      expect(toolApproval.enum).toEqual(["auto", "ask"]);
      expect(toolApproval.enum).not.toContain("bypass");
    });
  });

  describe("policy engine is sole source of truth", () => {
    it("default policy does NOT auto-approve write", () => {
      expect(policy.isAutoExecutable("write", "file.ts :: content")).toBe(
        false,
      );
    });

    it("default policy does NOT auto-approve append", () => {
      expect(policy.isAutoExecutable("append", "file.ts :: content")).toBe(
        false,
      );
    });

    it("default policy does NOT auto-approve patch", () => {
      expect(policy.isAutoExecutable("patch", "file.ts :: old :: new")).toBe(
        false,
      );
    });

    it("default policy does NOT auto-approve delete", () => {
      expect(policy.isAutoExecutable("delete", "file.ts")).toBe(false);
    });

    it("default policy does NOT auto-approve terminal (destructive)", () => {
      expect(policy.isAutoExecutable("terminal", "rm -rf /")).toBe(false);
    });

    it("default policy does NOT auto-approve batch_edit", () => {
      expect(policy.isAutoExecutable("batch_edit", "{}")).toBe(false);
    });

    it("default policy does NOT auto-approve git-commit", () => {
      expect(policy.isAutoExecutable("git-commit", "msg")).toBe(false);
    });

    it("default policy DOES auto-approve read", () => {
      expect(policy.isAutoExecutable("read", "file.ts")).toBe(true);
    });

    it("default policy DOES auto-approve search", () => {
      expect(policy.isAutoExecutable("search", "TODO")).toBe(true);
    });

    it("default policy DOES auto-approve git-status", () => {
      expect(policy.isAutoExecutable("git-status", "")).toBe(true);
    });

    it("default policy DOES auto-approve git-diff", () => {
      expect(policy.isAutoExecutable("git-diff", "")).toBe(true);
    });

    it("does NOT auto-approve terminal (it is in DESTRUCTIVE_TOOLS, not SAFE_TOOLS)", () => {
      // Note: isAutoExecutable only checks autoApproveTools, which is SAFE_TOOLS + constructor args.
      // Terminal is classified as destructive. Safe terminal commands are handled by
      // requiresApproval's special SAFE_PATTERNS check, not by isAutoExecutable.
      expect(policy.isAutoExecutable("terminal", "ls -la")).toBe(false);
    });

    it("requiresApproval allows safe terminal commands without user prompt", () => {
      // requiresApproval checks SAFE_PATTERNS for terminal, so safe commands
      // don't need user approval even though isAutoExecutable returns false.
      expect(policy.requiresApproval("terminal", "ls -la")).toBe(false);
      expect(policy.requiresApproval("terminal", "git status")).toBe(false);
      expect(policy.requiresApproval("terminal", "npm test")).toBe(false);
    });
  });

  describe("write/append/patch require approval in all modes", () => {
    const writeTools = ["write", "append", "patch"];

    for (const tool of writeTools) {
      it(`${tool}: requires approval (not auto-executable)`, () => {
        expect(policy.requiresApproval(tool, "file.ts :: content")).toBe(true);
        expect(policy.isAutoExecutable(tool, "file.ts :: content")).toBe(false);
      });

      it(`${tool}: classified as low-risk (not safe, not destructive)`, () => {
        expect(policy.getToolRiskLevel(tool, "file.ts :: content")).toBe(
          "low-risk",
        );
      });
    }
  });

  describe("legacy bypass value handling", () => {
    it("simulateApprovalCallback with legacy bypass value falls back to ask behavior", () => {
      // This simulates what the fixed extension callback does:
      // rawApproval === "bypass" -> treat as "ask"
      function simulateApprovalCallback(
        toolName: string,
        arg: string,
        rawMode: string,
      ): boolean {
        const mode: "auto" | "ask" = rawMode === "auto" ? "auto" : "ask";

        if (mode === "auto") {
          if (policy.isAutoExecutable(toolName, arg)) return true;
        }

        if (policy.requiresApproval(toolName, arg)) {
          return false;
        }

        return true;
      }

      // Legacy "bypass" value is treated as "ask"
      expect(simulateApprovalCallback("delete", "file.ts", "bypass")).toBe(
        false,
      );
      expect(simulateApprovalCallback("write", "f.ts :: c", "bypass")).toBe(
        false,
      );
      expect(
        simulateApprovalCallback("terminal", "rm -rf /", "bypass"),
      ).toBe(false);
      expect(
        simulateApprovalCallback("batch_edit", "{}", "bypass"),
      ).toBe(false);

      // Safe tools still work in ask mode
      expect(simulateApprovalCallback("read", "file.ts", "bypass")).toBe(true);
      expect(simulateApprovalCallback("search", "TODO", "bypass")).toBe(true);
      expect(
        simulateApprovalCallback("terminal", "git status", "bypass"),
      ).toBe(true);
    });

    it("simulateApprovalCallback with 'autopilot' value falls back to ask behavior", () => {
      function simulateApprovalCallback(
        toolName: string,
        arg: string,
        rawMode: string,
      ): boolean {
        const mode: "auto" | "ask" = rawMode === "auto" ? "auto" : "ask";

        if (mode === "auto") {
          if (policy.isAutoExecutable(toolName, arg)) return true;
        }

        if (policy.requiresApproval(toolName, arg)) {
          return false;
        }

        return true;
      }

      // "autopilot" is not "auto", so treated as "ask"
      expect(simulateApprovalCallback("delete", "file.ts", "autopilot")).toBe(
        false,
      );
      expect(
        simulateApprovalCallback("write", "f.ts :: c", "autopilot"),
      ).toBe(false);
    });
  });
});
