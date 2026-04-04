import * as assert from "assert";
import * as vscode from "vscode";
import * as path from "path";

suite("Webview Interaction", () => {
  test("webview ping/pong", async () => {
    const ext = vscode.extensions.getExtension("your-name.kiboko");
    assert.ok(ext, "Extension not found");
    await ext!.activate();

    // open the chat webview
    await vscode.commands.executeCommand("kiboko.openChat");

    // access the ChatWebview class from the compiled extension output and wait for its static currentPanel
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
      // intercept outgoing messages that the extension would send to the webview
      panel.panel.webview.postMessage = (m: any) => {
        messages.push(m);
        return Promise.resolve(true);
      };

      // simulate webview sending a ping to the extension
      await panel.receiveMessageForTest({ type: "ping" });
      // allow microtasks to run
      await new Promise((r) => setTimeout(r, 20));

      const pong = messages.find((m) => m && m.type === "pong");
      assert.ok(
        pong,
        `Expected a pong reply, got: ${JSON.stringify(messages)}`,
      );
    } finally {
      panel.panel.webview.postMessage = oldPost;
    }
  }).timeout(10000);
});
