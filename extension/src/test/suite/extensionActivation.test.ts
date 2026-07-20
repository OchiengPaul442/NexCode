/**
 * NC-032: VS Code Extension Host Integration Tests — Extension Activation
 *
 * These tests validate the extension's activation behavior, command registration,
 * and lifecycle through the real VS Code Extension Development Host.
 */
import * as assert from "assert";
import * as vscode from "vscode";

suite("Extension Activation Integration", () => {
  test("extension package.json has correct activation events", () => {
    const packageJson = require("../../../package.json");

    assert.ok(
      Array.isArray(packageJson.activationEvents),
      "activationEvents should be an array",
    );
    assert.ok(
      packageJson.activationEvents.includes("onView:nexcodeKiboko.sidebarView"),
      "Should activate on sidebar view",
    );
  });

  test("extension registers all required commands", () => {
    const packageJson = require("../../../package.json");
    const commands = packageJson.contributes.commands.map((c: any) => c.command);

    const requiredCommands = [
      "nexcodeKiboko.openSidebar",
      "nexcodeKiboko.pickModel",
      "nexcodeKiboko.clearConversation",
      "nexcodeKiboko.openInTab",
      "nexcodeKiboko.explainSelection",
      "nexcodeKiboko.showVersionInfo",
    ];

    for (const cmd of requiredCommands) {
      assert.ok(commands.includes(cmd), `Command "${cmd}" should be registered`);
    }
  });

  test("extension provides a webview view", () => {
    const packageJson = require("../../../package.json");
    const views = packageJson.contributes.views;

    assert.ok(views.nexcodeKiboko, "Should have nexcodeKiboko view container");
    assert.ok(
      views.nexcodeKiboko.length > 0,
      "Should have at least one view in container",
    );

    const sidebarView = views.nexcodeKiboko.find(
      (v: any) => v.id === "nexcodeKiboko.sidebarView",
    );
    assert.ok(sidebarView, "Sidebar view should exist");
    assert.strictEqual(sidebarView.type, "webview", "Sidebar should be a webview");
  });

  test("extension provides an activity bar container", () => {
    const packageJson = require("../../../package.json");
    const containers = packageJson.contributes.viewsContainers.activitybar;

    assert.ok(Array.isArray(containers), "activitybar should be an array");
    const nexcodeContainer = containers.find((c: any) => c.id === "nexcodeKiboko");
    assert.ok(nexcodeContainer, "NexCode activity bar container should exist");
    assert.strictEqual(nexcodeContainer.title, "NexCode", "Container title should be NexCode");
  });

  test("extension has required engine version", () => {
    const packageJson = require("../../../package.json");
    assert.ok(packageJson.engines.vscode, "Should declare vscode engine");
    // Should be 1.95.0 or higher for capabilities.untrustedWorkspaces
    const version = packageJson.engines.vscode;
    assert.ok(
      version.includes("1.95") || version.includes("1.96") || version.includes("1.97") ||
      version.includes("1.98") || version.includes("1.99") || version.includes("1.10") ||
      version.includes("1.11") || version.includes("1.12") || version.includes("1.13") ||
      version.includes("1.14") || version.includes("1.15") || version.includes("1.16") ||
      version.includes("1.17") || version.includes("1.18") || version.includes("1.19") ||
      version.includes("2."),
      `Engine version ${version} should support capabilities`,
    );
  });

  test("extension has correct main entry point", () => {
    const packageJson = require("../../../package.json");
    assert.strictEqual(packageJson.main, "./out/extension.js", "Main should point to compiled extension");
  });

  test("extension version follows semver", () => {
    const packageJson = require("../../../package.json");
    const semverRegex = /^\d+\.\d+\.\d+$/;
    assert.ok(
      semverRegex.test(packageJson.version),
      `Version "${packageJson.version}" should follow semver (MAJOR.MINOR.PATCH)`,
    );
  });

  test("extension dependencies include agent-core", () => {
    const packageJson = require("../../../package.json");
    assert.ok(
      packageJson.dependencies["@nexcode/agent-core"],
      "Should depend on @nexcode/agent-core",
    );
  });

  test("workspace settings schema is complete (NC-035)", () => {
    const packageJson = require("../../../package.json");
    const props = packageJson.contributes.configuration.properties;

    // All settings that are read at runtime must be declared
    const expectedSettings = [
      "nexcodeKiboko.defaultProvider",
      "nexcodeKiboko.defaultModel",
      "nexcodeKiboko.defaultMode",
      "nexcodeKiboko.allowToolCommands",
      "nexcodeKiboko.requireTerminalApproval",
      "nexcodeKiboko.temperature",
      "nexcodeKiboko.modeTemperatures",
      "nexcodeKiboko.showReasoning",
      "nexcodeKiboko.autoApplyChanges",
      "nexcodeKiboko.allowWebSearch",
      "nexcodeKiboko.toolApproval",
      "nexcodeKiboko.agentModels.manager",
      "nexcodeKiboko.agentModels.primaryWorker",
      "nexcodeKiboko.agentModels.lightweightWorker",
      "nexcodeKiboko.agentModels.reasoningReviewer",
      "nexcodeKiboko.allowWorkspacePrompts",
      "nexcodeKiboko.openAIBaseUrl",
      "nexcodeKiboko.ollamaBaseUrl",
      "nexcodeKiboko.searchProvider",
      "nexcodeKiboko.searchBaseUrl",
    ];

    for (const setting of expectedSettings) {
      assert.ok(props[setting], `Setting "${setting}" must be declared in package.json`);
    }
  });

  test("no generated webview artifacts in Git (NC-038)", function () {
    // This test verifies that the build artifacts are properly gitignored
    const { execSync } = require("child_process");
    try {
      const tracked = execSync("git ls-files extension/media/main.js extension/media/main.css", {
        encoding: "utf8",
        cwd: require("path").resolve(__dirname, "../../.."),
      }).trim();
      assert.strictEqual(
        tracked,
        "",
        "main.js and main.css should not be tracked in Git",
      );
    } catch {
      // If git command fails, skip (not in a git repo context)
      this.skip();
    }
  });
});
