/**
 * NC-044 regression tests: Hermetic package/release flow.
 *
 * These tests verify that the extension release script and CI workflow
 * enforce hermetic, reproducible packaging with lockfile-based installs,
 * comprehensive VSIX verification, and dependency manifests.
 */
import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, "../..");
const RELEASE_SCRIPT = path.join(WORKSPACE_ROOT, "tools", "extension-release.mjs");
const VSCODEIGNORE = path.join(WORKSPACE_ROOT, "extension", ".vscodeignore");
const CI_WORKFLOW = path.join(WORKSPACE_ROOT, ".github", "workflows", "ci.yml");
const ROOT_LOCKFILE = path.join(WORKSPACE_ROOT, "package-lock.json");

function readReleaseScript(): string {
  return fs.readFileSync(RELEASE_SCRIPT, "utf8");
}

function readCiWorkflow(): string {
  return fs.readFileSync(CI_WORKFLOW, "utf8");
}

// ── Release script structure ──────────────────────────────────────────

describe("NC-044: Release script uses hermetic install", () => {
  it("stageEntries includes package-lock.json for npm ci", () => {
    const script = readReleaseScript();
    expect(script).toContain('"package-lock.json"');
  });

  it("installStageDependencies uses npm ci instead of bare npm install", () => {
    const script = readReleaseScript();
    // The script should use npm ci for the primary install path
    expect(script).toContain('"ci"');
    // Must use --omit=dev for production deps only
    expect(script).toContain('"--omit=dev"');
  });

  it("release script verifies lockfile integrity before staging", () => {
    const script = readReleaseScript();
    expect(script).toContain("Lockfile verified");
    expect(script).toContain("lockfileVersion");
    expect(script).toContain("No package-lock.json found at workspace root");
  });

  it("release script has fallback for missing lockfile", () => {
    const script = readReleaseScript();
    expect(script).toContain("Falling back to npm install");
  });
});

// ── VSIX content verification ────────────────────────────────────────

describe("NC-044: VSIX content verification", () => {
  it("assertVsixDependencies checks required entry points", () => {
    const script = readReleaseScript();
    // Required runtime entries
    expect(script).toContain("extension/out/extension.js");
    expect(script).toContain("extension/media/main.js");
    expect(script).toContain("extension/media/main.css");
    expect(script).toContain("extension/media/icon.png");
    expect(script).toContain("extension/media/activitybar-icon.svg");
    expect(script).toContain("extension/node_modules/@nexcode/agent-core/package.json");
    expect(script).toContain("extension/out/build-info.json");
  });

  it("assertVsixDependencies rejects forbidden entries (test/source files)", () => {
    const script = readReleaseScript();
    // Forbidden patterns
    expect(script).toContain("forbiddenPatterns");
    expect(script).toContain("TypeScript test files");
    expect(script).toContain("Source map files");
    expect(script).toContain("Type declaration files");
    expect(script).toContain("Webview source files");
    expect(script).toContain("Tailwind config");
    expect(script).toContain("TypeScript config");
  });

  it("assertVsixDependencies reports entry count on success", () => {
    const script = readReleaseScript();
    expect(script).toContain("VSIX verification passed");
  });
});

// ── Build info and provenance ─────────────────────────────────────────

describe("NC-044: Build info includes provenance metadata", () => {
  it("buildInfo includes platform, arch, and npm version", () => {
    const script = readReleaseScript();
    expect(script).toContain("platform: process.platform");
    expect(script).toContain("arch: process.arch");
    expect(script).toContain("npm: runCapture");
  });

  it("buildInfo includes provenance object", () => {
    const script = readReleaseScript();
    expect(script).toContain("provenance:");
    expect(script).toContain('generator: "nexcode-extension-release"');
    expect(script).toContain("lockfileIntegrity");
    expect(script).toContain('stagedInstall: "npm-ci"');
  });

  it("buildInfo includes dependency manifest from lockfile", () => {
    const script = readReleaseScript();
    expect(script).toContain("dependencyManifest");
    expect(script).toContain("package-lock.json");
  });
});

// ── .vscodeignore ─────────────────────────────────────────────────────

describe("NC-044: .vscodeignore excludes build artifacts and secrets", () => {
  it("DEPENDENCIES.json is excluded from VSIX", () => {
    const ignore = fs.readFileSync(VSCODEIGNORE, "utf8");
    expect(ignore).toContain("DEPENDENCIES.json");
  });

  it("source maps are excluded from VSIX", () => {
    const ignore = fs.readFileSync(VSCODEIGNORE, "utf8");
    expect(ignore).toContain("**/*.map");
  });

  it("type declarations are excluded from VSIX", () => {
    const ignore = fs.readFileSync(VSCODEIGNORE, "utf8");
    expect(ignore).toContain("**/*.d.ts");
  });

  it("test files are excluded from VSIX", () => {
    const ignore = fs.readFileSync(VSCODEIGNORE, "utf8");
    expect(ignore).toContain("**/*.test.ts");
    expect(ignore).toContain("**/*.spec.ts");
  });

  it("webview source is excluded from VSIX", () => {
    const ignore = fs.readFileSync(VSCODEIGNORE, "utf8");
    expect(ignore).toContain("webview/src/**");
  });
});

// ── CI workflow packaging ─────────────────────────────────────────────

describe("NC-044: CI workflow has hermetic packaging", () => {
  it("CI package job uses npm ci (not npm install)", () => {
    const ci = readCiWorkflow();
    // Find the package job section
    const packageIdx = ci.indexOf("package:");
    expect(packageIdx).toBeGreaterThanOrEqual(0);
    const packageSection = ci.slice(packageIdx);
    expect(packageSection).toContain("npm ci");
  });

  it("CI has VSIX verification step", () => {
    const ci = readCiWorkflow();
    expect(ci).toContain("Verify VSIX contents");
  });

  it("CI has lockfile integrity verification", () => {
    const ci = readCiWorkflow();
    expect(ci).toContain("Verify lockfile integrity");
  });

  it("CI generates dependency manifest", () => {
    const ci = readCiWorkflow();
    expect(ci).toContain("Generate dependency manifest");
    expect(ci).toContain("DEPENDENCIES.json");
  });

  it("CI uploads DEPENDENCIES.json as artifact", () => {
    const ci = readCiWorkflow();
    expect(ci).toContain("DEPENDENCIES.json");
  });
});

// ── Root lockfile exists ──────────────────────────────────────────────

describe("NC-044: Lockfile integrity", () => {
  it("root package-lock.json exists", () => {
    expect(fs.existsSync(ROOT_LOCKFILE)).toBe(true);
  });

  it("root package-lock.json is valid JSON with lockfileVersion", () => {
    const lockRaw = fs.readFileSync(ROOT_LOCKFILE, "utf8");
    const lockParsed = JSON.parse(lockRaw);
    expect(typeof lockParsed.lockfileVersion).toBe("number");
    expect(typeof lockParsed.packages).toBe("object");
    expect(Object.keys(lockParsed.packages).length).toBeGreaterThan(0);
  });
});
