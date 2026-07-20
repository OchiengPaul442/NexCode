/**
 * NC-032: VS Code Extension Host Integration Tests — Workspace Trust
 *
 * These tests validate Workspace Trust behavior through the real VS Code API.
 * Unit tests can mock vscode.workspace.isTrusted, but integration tests
 * verify the actual extension behavior under trust state changes.
 */
import * as assert from "assert";
import * as vscode from "vscode";

suite("Workspace Trust Integration", () => {
  test("workspace trust state is accessible", () => {
    const isTrusted = vscode.workspace.isTrusted;
    assert.strictEqual(typeof isTrusted, "boolean", "isTrusted should be a boolean");
    // In the test workspace, trust state depends on the test configuration
  });

  test("extension manifest declares workspace trust correctly", () => {
    const packageJson = require("../../../package.json");

    // Must have capabilities.untrustedWorkspaces (NC-002)
    const caps = packageJson.contributes.capabilities;
    assert.ok(caps, "capabilities must be declared");
    assert.ok(caps.untrustedWorkspaces, "untrustedWorkspaces must be declared");
    assert.strictEqual(caps.untrustedWorkspaces.supported, "limited");
  });

  test("restricted configurations prevent untrusted workspace overrides (NC-002)", () => {
    const packageJson = require("../../../package.json");
    const restricted =
      packageJson.contributes.capabilities.untrustedWorkspaces.restrictedConfigurations;

    // All credential-bearing endpoint URLs must be restricted
    assert.ok(
      restricted.includes("nexcodeKiboko.openAIBaseUrl"),
      "openAIBaseUrl must be restricted in untrusted workspaces",
    );
    assert.ok(
      restricted.includes("nexcodeKiboko.ollamaBaseUrl"),
      "ollamaBaseUrl must be restricted in untrusted workspaces",
    );
    assert.ok(
      restricted.includes("nexcodeKiboko.searchProvider"),
      "searchProvider must be restricted in untrusted workspaces",
    );
    assert.ok(
      restricted.includes("nexcodeKiboko.searchBaseUrl"),
      "searchBaseUrl must be restricted in untrusted workspaces",
    );

    // Security-sensitive settings must be restricted
    assert.ok(
      restricted.includes("nexcodeKiboko.toolApproval"),
      "toolApproval must be restricted",
    );
    assert.ok(
      restricted.includes("nexcodeKiboko.allowToolCommands"),
      "allowToolCommands must be restricted",
    );
    assert.ok(
      restricted.includes("nexcodeKiboko.allowWebSearch"),
      "allowWebSearch must be restricted",
    );
    assert.ok(
      restricted.includes("nexcodeKiboko.allowWorkspacePrompts"),
      "allowWorkspacePrompts must be restricted",
    );
  });

  test("bypass mode removed from toolApproval enum (NC-008)", () => {
    const packageJson = require("../../../package.json");
    const toolApprovalEnum =
      packageJson.contributes.configuration.properties["nexcodeKiboko.toolApproval"].enum;

    assert.deepStrictEqual(toolApprovalEnum, ["auto", "ask"]);
    assert.ok(!toolApprovalEnum.includes("bypass"), "bypass must not be an option");
  });

  test("allowWorkspacePrompts defaults to false (NC-022)", () => {
    const packageJson = require("../../../package.json");
    const allowProp =
      packageJson.contributes.configuration.properties["nexcodeKiboko.allowWorkspacePrompts"];

    assert.strictEqual(allowProp.default, false, "allowWorkspacePrompts must default to false");
    assert.ok(
      allowProp.description.includes("Disabled by default"),
      "Description should note disabled by default",
    );
  });

  test("read-only settings are NOT restricted (should be usable in untrusted)", () => {
    const packageJson = require("../../../package.json");
    const restricted =
      packageJson.contributes.capabilities.untrustedWorkspaces.restrictedConfigurations;

    // These are read-only/display settings that should NOT be restricted
    assert.ok(
      !restricted.includes("nexcodeKiboko.defaultModel"),
      "defaultModel should NOT be restricted",
    );
    assert.ok(
      !restricted.includes("nexcodeKiboko.defaultProvider"),
      "defaultProvider should NOT be restricted",
    );
    assert.ok(
      !restricted.includes("nexcodeKiboko.defaultMode"),
      "defaultMode should NOT be restricted",
    );
    assert.ok(
      !restricted.includes("nexcodeKiboko.temperature"),
      "temperature should NOT be restricted",
    );
    assert.ok(
      !restricted.includes("nexcodeKiboko.showReasoning"),
      "showReasoning should NOT be restricted",
    );
  });
});
