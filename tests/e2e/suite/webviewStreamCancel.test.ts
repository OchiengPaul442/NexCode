import * as assert from "assert";
import * as vscode from "vscode";
import * as path from "path";

suite("Webview Stream/Cancel", () => {
  test("send -> stream -> cancel", async () => {
    const ext = vscode.extensions.getExtension("your-name.kiboko");
    assert.ok(ext, "Extension not found");
    await ext!.activate();

    // open the chat webview
    await vscode.commands.executeCommand("kiboko.openChat");

    // require compiled modules (out/src/...)
    const chatModule = require(
      path.join(__dirname, "..", "..", "..", "src", "ui", "chatWebview.js"),
    );
    const providerManagerModule = require(
      path.join(
        __dirname,
        "..",
        "..",
        "..",
        "src",
        "providers",
        "providerManager.js",
      ),
    );

    // stub provider that yields tokens and respects abort signal
    const stubProvider = {
      async *chat(_messages: any, options: any) {
        const tokens = ["Hello", " ", "world", "!"];
        let aborted = false;
        if (options && options.signal) {
          if (options.signal.aborted) aborted = true;
          else options.signal.addEventListener("abort", () => (aborted = true));
        }
        for (const t of tokens) {
          if (aborted) return;
          await new Promise((r) => setTimeout(r, 30));
          yield t;
        }
      },
    };

    const stubManager = { getProvider: () => stubProvider };
    if (providerManagerModule && providerManagerModule.ProviderManager) {
      providerManagerModule.ProviderManager.instance = stubManager;
    }

    // wait for the chat panel to be created
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

      // send a prompt
      await panel.receiveMessageForTest({ type: "send", text: "hello" });

      // wait for at least one output
      const startOut = Date.now();
      while (
        !messages.find((m) => m && m.type === "output") &&
        Date.now() - startOut < 2000
      ) {
        await new Promise((r) => setTimeout(r, 20));
      }
      assert.ok(
        messages.find((m) => m && m.type === "output"),
        "No output streaming observed",
      );

      // cancel the stream
      await panel.receiveMessageForTest({ type: "cancel" });

      // wait for done
      const startDone = Date.now();
      while (
        !messages.find((m) => m && m.type === "done") &&
        Date.now() - startDone < 2000
      ) {
        await new Promise((r) => setTimeout(r, 20));
      }
      assert.ok(
        messages.find((m) => m && m.type === "done"),
        "No done message after cancel",
      );

      // ensure no further outputs after done
      const beforeCount = messages.filter((m) => m.type === "output").length;
      await new Promise((r) => setTimeout(r, 200));
      const afterCount = messages.filter((m) => m.type === "output").length;
      assert.ok(afterCount <= beforeCount, "Received outputs after cancel");
    } finally {
      panel.panel.webview.postMessage = oldPost;
    }
  }).timeout(15000);
});
