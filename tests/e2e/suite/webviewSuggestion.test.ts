import * as assert from "assert";
import * as vscode from "vscode";
import * as path from "path";

suite("Webview Suggestion Apply", () => {
  test("applySuggestion inserts snippet into active editor", async () => {
    const ext = vscode.extensions.getExtension("your-name.kiboko");
    assert.ok(ext, "Extension not found");
    await ext!.activate();

    // create a small document and show it
    const initial = "line A\nline B\n";
    const doc = await vscode.workspace.openTextDocument({ content: initial });
    const editor = await vscode.window.showTextDocument(doc);

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

    // ensure the original editor is focused again so the suggestion inserts there
    await vscode.window.showTextDocument(doc);

    // simulate clicking Insert by sending applySuggestion message from webview
    const snippet = "// SUGGESTED_SNIPPET\n";
    await panel.receiveMessageForTest({ type: "applySuggestion", snippet });

    // allow time for edit to be applied
    await new Promise((r) => setTimeout(r, 250));

    const text = editor.document.getText();
    assert.ok(text.includes(snippet), `Snippet not inserted: ${text}`);
  }).timeout(15000);
});
