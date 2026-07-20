/**
 * NC-031 & NC-045: Regression tests for CI workflow configuration.
 *
 * NC-031: CI includes Windows and macOS matrix jobs for platform-specific
 * security code (path handling, process execution, PowerShell, symlinks).
 *
 * NC-045: Dependency audit is not optional — critical advisories block the
 * build, lockfile integrity is verified, and audit failures are visible.
 */

import { describe, it, expect, beforeAll } from "vitest";
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../..");
const CI_YML = path.join(ROOT, ".github", "workflows", "ci.yml");

describe("NC-031 & NC-045: CI workflow configuration", () => {
  let ciContent: string;
  let ciLines: string[];

  beforeAll(() => {
    expect(fs.existsSync(CI_YML)).toBe(true);
    ciContent = fs.readFileSync(CI_YML, "utf-8");
    ciLines = ciContent.split("\n");
  });

  // ─── NC-031: Multi-platform CI matrix ──────────────────────────────

  describe("NC-031: Multi-platform CI matrix", () => {
    it("CI workflow file exists", () => {
      expect(fs.existsSync(CI_YML)).toBe(true);
    });

    it("includes ubuntu-latest in OS matrix", () => {
      expect(ciContent).toContain("ubuntu-latest");
    });

    it("includes windows-latest in OS matrix", () => {
      expect(ciContent).toContain("windows-latest");
    });

    it("includes macos-latest in OS matrix", () => {
      expect(ciContent).toContain("macos-latest");
    });

    it("uses matrix strategy for OS", () => {
      // The matrix should declare os as a dimension
      expect(ciContent).toMatch(/matrix:.*\n\s+os:\s*\[/m);
    });

    it("has fail-fast: false to avoid cancelling healthy platform jobs", () => {
      expect(ciContent).toContain("fail-fast: false");
    });

    it("package job also runs on multiple OS", () => {
      // Package job should use the OS matrix for cross-platform VSIX builds
      const packageSection = ciContent.substring(
        ciContent.indexOf("package:")
      );
      expect(packageSection).toContain("matrix:");
      expect(packageSection).toContain("os:");
    });

    it("package job uses OS-specific artifact names", () => {
      const packageSection = ciContent.substring(
        ciContent.indexOf("package:")
      );
      // Artifact name should include OS to avoid collisions
      expect(packageSection).toMatch(/name:\s*vsix-package.*\$\{\{.*os.*\}\}/);
    });

    it("build-and-test job has platform-appropriate setup", () => {
      // Checkout and Node.js setup should be present for all platforms
      expect(ciContent).toContain("actions/checkout@v4");
      expect(ciContent).toContain("actions/setup-node@v4");
    });

    it("Node.js version matrix covers LTS versions", () => {
      // Should test at least Node 20 across all platforms
      expect(ciContent).toContain("node-version: [20]");
    });
  });

  // ─── NC-045: Dependency audit is not optional ──────────────────────

  describe("NC-045: Dependency audit visibility", () => {
    it("has a dedicated audit job", () => {
      expect(ciContent).toMatch(/^  audit:/m);
    });

    it("audit job runs on ubuntu-latest", () => {
      const auditSection = ciContent.substring(ciContent.indexOf("audit:"));
      expect(auditSection).toContain("runs-on: ubuntu-latest");
    });

    it("critical audit advisories block the build (no continue-on-error)", () => {
      // Find the critical audit step — it must NOT have continue-on-error
      const auditSection = ciContent.substring(ciContent.indexOf("audit:"));
      const criticalAuditIdx = ciLines.findIndex(
        (line) =>
          line.includes("audit-level=critical") ||
          line.includes("audit-level: critical")
      );
      expect(criticalAuditIdx).toBeGreaterThan(-1);

      // Check the next few lines for continue-on-error
      // The critical audit step should NOT have continue-on-error: true
      const surroundingLines = ciLines
        .slice(criticalAuditIdx, criticalAuditIdx + 5)
        .join("\n");
      expect(surroundingLines).not.toContain("continue-on-error: true");
    });

    it("high-severity audit advisory step exists and may continue-on-error", () => {
      const highAuditIdx = ciLines.findIndex(
        (line) =>
          (line.includes("audit-level=high") ||
            line.includes("audit-level: high")) &&
          !line.includes("critical")
      );
      // High-severity advisories may have continue-on-error for manual review
      // This is acceptable — critical blocks, high is tracked
      if (highAuditIdx >= 0) {
        const surroundingLines = ciLines
          .slice(highAuditIdx, highAuditIdx + 5)
          .join("\n");
        expect(surroundingLines).toContain("continue-on-error: true");
      }
    });

    it("audit job has lockfile integrity verification", () => {
      const auditSection = ciContent.substring(ciContent.indexOf("audit:"));
      expect(auditSection).toMatch(/lockfile|npm ci/);
    });

    it("audit job installs dependencies before auditing", () => {
      const auditSection = ciContent.substring(ciContent.indexOf("audit:"));
      expect(auditSection).toContain("npm ci");
    });

    it("audit job runs at least one npm audit command", () => {
      const auditSection = ciContent.substring(ciContent.indexOf("audit:"));
      const auditCount = (auditSection.match(/npm audit/g) || []).length;
      expect(auditCount).toBeGreaterThanOrEqual(1);
    });

    it("audit job is independent (not gated on build-and-test)", () => {
      // Audit should run in parallel with build-and-test for fast feedback.
      // Extract only the audit job block (up to the next top-level job).
      const auditStart = ciContent.indexOf("\n  audit:");
      expect(auditStart).toBeGreaterThan(-1);
      // Find the next top-level job (starts at column 0 with a letter)
      const afterAudit = ciContent.substring(auditStart + 1);
      const nextJobMatch = afterAudit.match(/\n  [a-z]/);
      const auditBlock = nextJobMatch
        ? afterAudit.substring(0, nextJobMatch.index)
        : afterAudit;
      expect(auditBlock).not.toContain("needs:");
    });
  });

  // ─── General CI quality ────────────────────────────────────────────

  describe("General CI quality", () => {
    it("CI uses Node.js 20 as primary version", () => {
      expect(ciContent).toContain("node-version: 20");
    });

    it("CI runs npm ci (not npm install)", () => {
      const installCount = (ciContent.match(/npm ci/g) || []).length;
      expect(installCount).toBeGreaterThanOrEqual(1);
    });

    it("CI runs type-check, build, and test steps", () => {
      expect(ciContent).toContain("Type-check");
      expect(ciContent).toContain("Build");
      expect(ciContent).toContain("Run tests");
    });

    it("CI has separate build-and-test, audit, and package jobs", () => {
      expect(ciContent).toMatch(/^  build-and-test:/m);
      expect(ciContent).toMatch(/^  audit:/m);
      expect(ciContent).toMatch(/^  package:/m);
    });

    it("package job depends on build-and-test success", () => {
      const packageSection = ciContent.substring(
        ciContent.indexOf("package:")
      );
      expect(packageSection).toContain("needs: build-and-test");
    });

    it("CI uses actions/checkout@v4 and actions/setup-node@v4", () => {
      expect(ciContent).toContain("actions/checkout@v4");
      expect(ciContent).toContain("actions/setup-node@v4");
    });

    it("CI uses actions/upload-artifact@v4 for VSIX", () => {
      expect(ciContent).toContain("actions/upload-artifact@v4");
    });
  });
});
