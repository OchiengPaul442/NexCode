import * as assert from "assert";
import * as vscode from "vscode";
import * as path from "path";

suite("Webview Apply Patch", () => {
  test("preview and apply patch to active editor", async () => {
    const ext = vscode.extensions.getExtension("your-name.kiboko");
    assert.ok(ext, "Extension not found");
    await ext!.activate();

    // open a document with initial content
    const initial = "hello world";
    const doc = await vscode.workspace.openTextDocument({ content: initial });
    await vscode.window.showTextDocument(doc);

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

    const messages: any[] = [];
    const oldPost = panel.panel.webview.postMessage;
    try {
      panel.panel.webview.postMessage = (m: any) => {
        messages.push(m);
        return Promise.resolve(true);
      };

      const newText = "hello brave world";
      await panel.receiveMessageForTest({ type: "previewPatch", newText });
      // wait for patchPreview
      const startPreview = Date.now();
      while (
        !messages.find((m) => m && m.type === "patchPreview") &&
        Date.now() - startPreview < 2000
      ) {
        await new Promise((r) => setTimeout(r, 20));
      }
      const preview = messages.find((m) => m && m.type === "patchPreview");
      assert.ok(
        preview,
        `Expected patchPreview, got: ${JSON.stringify(messages)}`,
      );

      await panel.receiveMessageForTest({ type: "applyPatch", newText });
      // wait for patchApplied
      const startApply = Date.now();
      while (
        !messages.find((m) => m && m.type === "patchApplied") &&
        Date.now() - startApply < 2000
      ) {
        await new Promise((r) => setTimeout(r, 20));
      }
      const applied = messages.find((m) => m && m.type === "patchApplied");
      assert.ok(
        applied,
        `Expected patchApplied, got: ${JSON.stringify(messages)}`,
      );

      // verify the editor content changed
      const updated = doc.getText();
      assert.strictEqual(updated, newText);
    } finally {
      panel.panel.webview.postMessage = oldPost;
    }
  }).timeout(10000);
});
