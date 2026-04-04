import * as assert from "assert";
import * as vscode from "vscode";
import * as path from "path";

suite("Webview Memory Save", () => {
  test("saveMemory stores memory via ChatWebview handler", async () => {
    const ext = vscode.extensions.getExtension("your-name.kiboko");
    assert.ok(ext, "Extension not found");
    await ext!.activate();

    // open chat webview
    await vscode.commands.executeCommand("kiboko.openChat");

    const chatModule = require(
      path.join(__dirname, "..", "..", "..", "src", "ui", "chatWebview.js"),
    );
    let panel: any =
      chatModule && chatModule.ChatWebview
        ? chatModule.ChatWebview.currentPanel
        : undefined;
    const start = Date.now();
    while (!panel && Date.now() - start < 5000) {
      await new Promise((r) => setTimeout(r, 50));
      panel =
        chatModule && chatModule.ChatWebview
          ? chatModule.ChatWebview.currentPanel
          : undefined;
    }
    assert.ok(
      panel && panel.panel && panel.panel.webview,
      "Chat panel not available",
    );

    const memText = "E2E MEMORY: remember this";
    await panel.receiveMessageForTest({
      type: "saveMemory",
      memoryText: memText,
    });

    // allow handler to run
    await new Promise((r) => setTimeout(r, 250));

    const saved =
      panel && panel.panel ? (panel.panel as any).__lastSavedMemory : undefined;
    assert.ok(
      saved && saved.text && saved.text.includes(memText),
      `Memory not saved: ${JSON.stringify(saved)}`,
    );
  }).timeout(15000);
});
