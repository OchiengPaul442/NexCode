/**
 * NC-029: Documentation accuracy regression tests.
 *
 * Verifies that:
 * 1. Historical review documents are marked as historical snapshots.
 * 2. README.md does not contain stale test counts (e.g., "62 tests", "147 tests", "287 tests").
 * 3. README.md lists the current minimum test count (>=1400).
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "..", "..");
const REVIEW_DIR = path.join(ROOT, "docs", "review");
const README_PATH = path.join(ROOT, "README.md");

function readFile(relPath: string): string {
  return fs.readFileSync(path.join(ROOT, relPath), "utf-8");
}

function fileExists(filePath: string): boolean {
  try {
    fs.accessSync(filePath);
    return true;
  } catch {
    return false;
  }
}

const HISTORICAL_DOCS = [
  "FINAL_REPORT.md",
  "RELEASE_READINESS.md",
  "TEST_MATRIX.md",
  "HARDENING_LOG.md",
  "BASELINE_VALIDATION.md",
  "FINDINGS_REGISTER.md",
  "INDEPENDENT_RED_TEAM_REPORT.md",
  "IMPLEMENTATION_PLAN.md",
];

describe("NC-029: Documentation accuracy", () => {
  describe("Historical snapshot markers", () => {
    for (const doc of HISTORICAL_DOCS) {
      it(`${doc} should be marked as historical snapshot`, () => {
        const docPath = path.join(REVIEW_DIR, doc);
        if (!fileExists(docPath)) {
          // File doesn't exist — skip (may have been removed)
          return;
        }
        const content = fs.readFileSync(docPath, "utf-8");
        expect(content).toContain("HISTORICAL SNAPSHOT");
      });
    }
  });

  describe("README.md test counts", () => {
    it("should not contain stale test count '62 tests'", () => {
      const readme = readFile("README.md");
      expect(readme).not.toMatch(/62\s+tests/i);
    });

    it("should not contain stale test count '147 tests'", () => {
      const readme = readFile("README.md");
      expect(readme).not.toMatch(/147\s+tests/i);
    });

    it("should not contain stale test count '287 tests'", () => {
      const readme = readFile("README.md");
      expect(readme).not.toMatch(/287\s+tests/i);
    });

    it("should contain a test count >= 1400", () => {
      const readme = readFile("README.md");
      // Match patterns like "1459 tests" or "1,459 tests"
      const match = readme.match(/(\d[\d,]*)\s+tests/i);
      expect(match).not.toBeNull();
      if (match) {
        const count = parseInt(match[1].replace(/,/g, ""), 10);
        expect(count).toBeGreaterThanOrEqual(1400);
      }
    });

    it("should not contain stale '8 test files' claim (exact)", () => {
      const readme = readFile("README.md");
      // Match "8 test files" as a standalone number, not "58 test files" or "18 test files"
      expect(readme).not.toMatch(/\b8\s+test\s+files/i);
    });

    it("should list >= 20 test file categories (expanded from 7)", () => {
      const readme = readFile("README.md");
      // Count bullet points in the Testing section
      const testingSection = readme.split("## Testing")[1];
      if (testingSection) {
        const bullets = testingSection.match(/^- /gm);
        expect(bullets).not.toBeNull();
        if (bullets) {
          expect(bullets.length).toBeGreaterThanOrEqual(20);
        }
      }
    });

    it("should not contain the stale 'audit-17 issues' badge", () => {
      const readme = readFile("README.md");
      expect(readme).not.toContain("audit-17 issues");
    });
  });

  describe("docs/review/README accuracy", () => {
    it("FINAL_REPORT.md should not claim 'APPROVED' release decision without caveat", () => {
      const docPath = path.join(REVIEW_DIR, "FINAL_REPORT.md");
      if (!fileExists(docPath)) return;
      const content = fs.readFileSync(docPath, "utf-8");
      // The historical snapshot header should appear before any "APPROVED" claim
      const histIdx = content.indexOf("HISTORICAL SNAPSHOT");
      const approvedIdx = content.indexOf("APPROVED");
      if (approvedIdx !== -1) {
        expect(histIdx).not.toBe(-1);
        expect(histIdx).toBeLessThan(approvedIdx);
      }
    });

    it("RELEASE_READINESS.md should not claim 'CONDITIONAL GO' without caveat", () => {
      const docPath = path.join(REVIEW_DIR, "RELEASE_READINESS.md");
      if (!fileExists(docPath)) return;
      const content = fs.readFileSync(docPath, "utf-8");
      const histIdx = content.indexOf("HISTORICAL SNAPSHOT");
      const goIdx = content.indexOf("CONDITIONAL GO");
      if (goIdx !== -1) {
        expect(histIdx).not.toBe(-1);
        expect(histIdx).toBeLessThan(goIdx);
      }
    });
  });
});
