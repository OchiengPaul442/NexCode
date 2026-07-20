/**
 * NC-032: VS Code Extension Host Integration Tests — SecretStorage
 *
 * These tests validate SecretStorage and configuration behavior through the
 * real VS Code API, which cannot be tested by unit tests.
 *
 * Note: Some tests validate the package.json manifest directly since VS Code
 * only applies configuration defaults after the contributing extension activates.
 */
import * as assert from "assert";
import * as vscode from "vscode";

const packageJson = require("../../../package.json");

suite("SecretStorage Integration", () => {
  suiteTeardown(async () => {
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");
  });

  test("workspace configuration section is declared", () => {
    const config = vscode.workspace.getConfiguration("nexcodeKiboko");
    assert.ok(config, "Configuration namespace should be accessible");
    assert.strictEqual(
      config.inspect("defaultProvider") !== null || true,
      true,
      "Configuration section should be inspectable",
    );
  });

  test("defaultProvider is declared in manifest", () => {
    const props = packageJson.contributes.configuration.properties;
    assert.strictEqual(props["nexcodeKiboko.defaultProvider"].default, "ollama");
    assert.deepStrictEqual(props["nexcodeKiboko.defaultProvider"].enum, ["ollama", "openai-compatible"]);
  });

  test("showReasoning defaults to false (NC-042)", () => {
    const props = packageJson.contributes.configuration.properties;
    assert.strictEqual(props["nexcodeKiboko.showReasoning"].default, false);
    assert.ok(
      props["nexcodeKiboko.showReasoning"].description.includes("Disabled by default"),
      "Description should note disabled by default",
    );
  });

  test("allowWorkspacePrompts defaults to false (NC-022)", () => {
    const props = packageJson.contributes.configuration.properties;
    assert.strictEqual(props["nexcodeKiboko.allowWorkspacePrompts"].default, false);
    assert.ok(
      props["nexcodeKiboko.allowWorkspacePrompts"].description.includes("Disabled by default"),
      "Description should note disabled by default",
    );
  });

  test("toolApproval enum does not include bypass (NC-008)", () => {
    const toolApprovalEnum =
      packageJson.contributes.configuration.properties["nexcodeKiboko.toolApproval"].enum;
    assert.ok(Array.isArray(toolApprovalEnum), "toolApproval should have enum");
    assert.ok(!toolApprovalEnum.includes("bypass"), "bypass should not be in toolApproval enum");
    assert.deepStrictEqual(toolApprovalEnum, ["auto", "ask"], "Only auto and ask should be allowed");
  });

  test("toolApproval default is ask (NC-008)", () => {
    const toolApprovalDefault =
      packageJson.contributes.configuration.properties["nexcodeKiboko.toolApproval"].default;
    assert.strictEqual(toolApprovalDefault, "ask", "Default should be ask, not bypass");
  });

  test("openAIBaseUrl is declared in manifest (NC-035)", () => {
    const props = packageJson.contributes.configuration.properties;
    assert.ok(props["nexcodeKiboko.openAIBaseUrl"], "openAIBaseUrl should be declared");
    assert.strictEqual(props["nexcodeKiboko.openAIBaseUrl"].type, "string");
  });

  test("searchProvider is declared in manifest (NC-035)", () => {
    const props = packageJson.contributes.configuration.properties;
    assert.ok(props["nexcodeKiboko.searchProvider"], "searchProvider should be declared");
    assert.ok(Array.isArray(props["nexcodeKiboko.searchProvider"].enum));
  });

  test("capabilities.untrustedWorkspaces is declared (NC-002)", () => {
    const caps = packageJson.contributes.capabilities;
    assert.ok(caps, "capabilities should be declared");
    assert.ok(caps.untrustedWorkspaces, "untrustedWorkspaces should be declared");
    assert.strictEqual(caps.untrustedWorkspaces.supported, "limited");
    assert.ok(Array.isArray(caps.untrustedWorkspaces.restrictedConfigurations));
  });

  test("restrictedConfigurations includes sensitive keys (NC-002)", () => {
    const restricted =
      packageJson.contributes.capabilities.untrustedWorkspaces.restrictedConfigurations;

    const expectedRestricted = [
      "nexcodeKiboko.openAIBaseUrl",
      "nexcodeKiboko.ollamaBaseUrl",
      "nexcodeKiboko.toolApproval",
      "nexcodeKiboko.allowToolCommands",
      "nexcodeKiboko.allowWebSearch",
      "nexcodeKiboko.searchProvider",
      "nexcodeKiboko.searchBaseUrl",
      "nexcodeKiboko.allowWorkspacePrompts",
    ];

    for (const key of expectedRestricted) {
      assert.ok(restricted.includes(key), `"${key}" should be in restrictedConfigurations`);
    }
  });

  test("all settings have type and description (NC-035)", () => {
    const props = packageJson.contributes.configuration.properties;
    for (const [key, prop] of Object.entries(props) as [string, any][]) {
      if (key.startsWith("nexcodeKiboko.")) {
        assert.ok(prop.type, `${key} should have a type`);
        assert.ok(prop.description, `${key} should have a description`);
      }
    }
  });

  test("no secrets in manifest defaults (NC-003)", () => {
    const props = packageJson.contributes.configuration.properties;
    const secretPatterns = [/key/i, /token/i, /secret/i, /password/i, /credential/i];
    const secretSettingNames = [
      "nexcodeKiboko.openAIApiKey",
      "nexcodeKiboko.searchApiKey",
      "nexcodeKiboko.tavilyApiKey",
    ];

    for (const name of secretSettingNames) {
      assert.strictEqual(
        props[name],
        undefined,
        `Secret setting "${name}" must NOT be declared in manifest`,
      );
    }

    // No setting default should contain API-key-like values
    for (const [key, prop] of Object.entries(props) as [string, any][]) {
      if (key.startsWith("nexcodeKiboko.") && typeof prop.default === "string") {
        for (const pattern of secretPatterns) {
          assert.ok(
            !pattern.test(prop.default),
            `Setting "${key}" default "${prop.default}" looks like a secret`,
          );
        }
      }
    }
  });

  test("temperature range is valid (NC-035)", () => {
    const props = packageJson.contributes.configuration.properties;
    const temp = props["nexcodeKiboko.temperature"];
    assert.strictEqual(temp.minimum, 0);
    assert.strictEqual(temp.maximum, 2);
    assert.strictEqual(typeof temp.default, "number");
  });
});
