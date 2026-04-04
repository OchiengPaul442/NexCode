import * as assert from "assert";
import * as vscode from "vscode";
import * as path from "path";

suite("Webview Gutter Click", () => {
  test("gutterClick reveals editor line", async () => {
    const ext = vscode.extensions.getExtension("your-name.kiboko");
    assert.ok(ext, "Extension not found");
    await ext!.activate();

    // create a multi-line document so scrolling/revealing is meaningful
    const lines = Array.from({ length: 50 }, (_, i) => `line ${i + 1}`);
    const content = lines.join("\n");
    const doc = await vscode.workspace.openTextDocument({ content });
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

    // simulate clicking gutter line 10 from the webview
    await panel.receiveMessageForTest({ type: "gutterClick", line: 10 });

    // allow reveal to occur
    await new Promise((r) => setTimeout(r, 100));

    const active = vscode.window.activeTextEditor;
    assert.ok(active, "No active editor after gutterClick");
    const sel = active.selection;
    assert.strictEqual(
      sel.start.line,
      9,
      `Expected selection at line 9 but was ${sel.start.line}`,
    );
  }).timeout(10000);
});
