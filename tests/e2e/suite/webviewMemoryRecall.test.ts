import * as assert from "assert";
import * as vscode from "vscode";
import * as path from "path";

suite("Webview Memory Recall", () => {
  test("send includes relevant memories in context", async () => {
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

    const memText = "RECALL MEM: favorite color is blue";
    // save memory
    await panel.receiveMessageForTest({
      type: "saveMemory",
      memoryText: memText,
    });
    await new Promise((r) => setTimeout(r, 200));

    // send a message likely to match the memory
    await panel.receiveMessageForTest({
      type: "send",
      text: "what is my favorite color?",
    });
    // allow handler to run
    await new Promise((r) => setTimeout(r, 300));

    const included =
      (panel.panel as any).__lastIncludedMemories ||
      (panel as any).__lastIncludedMemories;
    assert.ok(
      included && included.length > 0,
      `No memories included: ${JSON.stringify(included)}`,
    );
    const found = included.some(
      (m: any) => m.text && m.text.includes("favorite color"),
    );
    assert.ok(found, `Saved memory not included: ${JSON.stringify(included)}`);
  }).timeout(20000);
});
