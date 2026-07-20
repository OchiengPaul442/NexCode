/**
 * NC-002 regression: Package.json workspace trust declaration.
 *
 * The extension must declare proper VS Code workspace trust configuration
 * using `contributes.capabilities.untrustedWorkspaces` with restricted
 * configurations for security-sensitive settings like provider endpoints.
 *
 * The previous declaration used a non-standard `workspaceTrust.trusted: true`
 * which does not properly restrict settings in untrusted workspaces.
 */
import { describe, it, expect } from "vitest";
import path from "path";
import { readFileSync } from "fs";

const PACKAGE_JSON_PATH = path.resolve(
  __dirname,
  "..",
  "..",
  "extension",
  "package.json",
);

function loadPackageJson(): Record<string, unknown> {
  const raw = readFileSync(PACKAGE_JSON_PATH, "utf-8");
  return JSON.parse(raw) as Record<string, unknown>;
}

describe("NC-002: package.json workspace trust declaration", () => {
  const pkg = loadPackageJson();
  const contributes = pkg.contributes as Record<string, unknown> | undefined;

  it("has a contributes section", () => {
    expect(contributes).toBeDefined();
  });

  it("declares contributes.capabilities.untrustedWorkspaces", () => {
    const capabilities = contributes?.capabilities as
      | Record<string, unknown>
      | undefined;
    expect(capabilities).toBeDefined();
    expect(capabilities?.untrustedWorkspaces).toBeDefined();
  });

  it("sets untrustedWorkspaces.supported to 'limited'", () => {
    const capabilities = contributes?.capabilities as Record<string, unknown>;
    const untrusted = capabilities.untrustedWorkspaces as Record<
      string,
      unknown
    >;
    expect(untrusted.supported).toBe("limited");
  });

  it("lists openAIBaseUrl in restrictedConfigurations", () => {
    const capabilities = contributes?.capabilities as Record<string, unknown>;
    const untrusted = capabilities.untrustedWorkspaces as Record<
      string,
      unknown
    >;
    const restricted = untrusted.restrictedConfigurations as string[];
    expect(restricted).toContain("nexcodeKiboko.openAIBaseUrl");
  });

  it("lists ollamaBaseUrl in restrictedConfigurations", () => {
    const capabilities = contributes?.capabilities as Record<string, unknown>;
    const untrusted = capabilities.untrustedWorkspaces as Record<
      string,
      unknown
    >;
    const restricted = untrusted.restrictedConfigurations as string[];
    expect(restricted).toContain("nexcodeKiboko.ollamaBaseUrl");
  });

  it("lists toolApproval in restrictedConfigurations", () => {
    const capabilities = contributes?.capabilities as Record<string, unknown>;
    const untrusted = capabilities.untrustedWorkspaces as Record<
      string,
      unknown
    >;
    const restricted = untrusted.restrictedConfigurations as string[];
    expect(restricted).toContain("nexcodeKiboko.toolApproval");
  });

  it("lists allowToolCommands in restrictedConfigurations", () => {
    const capabilities = contributes?.capabilities as Record<string, unknown>;
    const untrusted = capabilities.untrustedWorkspaces as Record<
      string,
      unknown
    >;
    const restricted = untrusted.restrictedConfigurations as string[];
    expect(restricted).toContain("nexcodeKiboko.allowToolCommands");
  });

  it("lists allowWebSearch in restrictedConfigurations", () => {
    const capabilities = contributes?.capabilities as Record<string, unknown>;
    const untrusted = capabilities.untrustedWorkspaces as Record<
      string,
      unknown
    >;
    const restricted = untrusted.restrictedConfigurations as string[];
    expect(restricted).toContain("nexcodeKiboko.allowWebSearch");
  });

  it("lists searchProvider in restrictedConfigurations", () => {
    const capabilities = contributes?.capabilities as Record<string, unknown>;
    const untrusted = capabilities.untrustedWorkspaces as Record<
      string,
      unknown
    >;
    const restricted = untrusted.restrictedConfigurations as string[];
    expect(restricted).toContain("nexcodeKiboko.searchProvider");
  });

  it("lists searchBaseUrl in restrictedConfigurations", () => {
    const capabilities = contributes?.capabilities as Record<string, unknown>;
    const untrusted = capabilities.untrustedWorkspaces as Record<
      string,
      unknown
    >;
    const restricted = untrusted.restrictedConfigurations as string[];
    expect(restricted).toContain("nexcodeKiboko.searchBaseUrl");
  });
});
