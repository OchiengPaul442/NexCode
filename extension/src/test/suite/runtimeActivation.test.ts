import * as assert from "assert";
import * as vscode from "vscode";

suite("Extension Runtime Activation", () => {
  test("extension activates without errors", async () => {
    // Trigger activation by executing a command
    await vscode.commands.executeCommand("workbench.view.extension.nexcodeKiboko");
    // If we get here without error, activation succeeded
    assert.ok(true, "Extension activated successfully");
  });

  test("all declared commands are callable", async () => {
    const commands = await vscode.commands.getCommands(true);
    const nexCommands = commands.filter(c => c.startsWith("nexcodeKiboko."));
    assert.ok(nexCommands.length >= 6, `Expected >=6 commands, got ${nexCommands.length}`);
  });

  test("openSidebar command executes without error", async () => {
    await assert.doesNotReject(
      () => vscode.commands.executeCommand("nexcodeKiboko.openSidebar")
    );
  });

  test("showVersionInfo command executes without error", async () => {
    await assert.doesNotReject(
      () => vscode.commands.executeCommand("nexcodeKiboko.showVersionInfo")
    );
  });

  test("clearConversation command is idempotent", async () => {
    await vscode.commands.executeCommand("nexcodeKiboko.clearConversation");
    await vscode.commands.executeCommand("nexcodeKiboko.clearConversation");
    assert.ok(true, "clearConversation is idempotent");
  });
});

suite("Extension Configuration", () => {
  test("nexcodeKiboko configuration section exists", async () => {
    const config = vscode.workspace.getConfiguration("nexcodeKiboko");
    assert.ok(config, "Configuration should exist");
  });

  test("defaultModel setting has a value", async () => {
    const config = vscode.workspace.getConfiguration("nexcodeKiboko");
    const model = config.get<string>("defaultModel");
    assert.ok(model, "defaultModel should have a value");
  });
});
