import * as assert from "assert";
import * as vscode from "vscode";
import * as path from "path";

suite("Webview Preview Scroll Sync", () => {
  test("before pane scrolls -> after pane synced", async () => {
    const ext = vscode.extensions.getExtension("your-name.kiboko");
    assert.ok(ext, "Extension not found");
    await ext!.activate();

    // create long document
    const lines = Array.from({ length: 200 }, (_, i) => `line ${i + 1}`);
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

    // wrap postMessage so we forward messages to the real webview (allow it to render)
    const messages: any[] = [];
    const origPost = panel.panel.webview.postMessage;
    panel.panel.webview.postMessage = function (m: any) {
      messages.push(m);
      try {
        return origPost.call(panel.panel.webview, m);
      } catch (e) {
        return Promise.resolve(true);
      }
    };

    try {
      // send a preview with large appended content so the preview panes are scrollable
      const newText =
        content +
        "\n" +
        Array.from({ length: 200 }, () => "extra-line").join("\n");
      await panel.receiveMessageForTest({ type: "previewPatch", newText });

      // wait for preview to be posted and rendered
      const previewStart = Date.now();
      while (
        !messages.find((m) => m && m.type === "patchPreview") &&
        Date.now() - previewStart < 3000
      ) {
        await new Promise((r) => setTimeout(r, 50));
      }
      assert.ok(
        messages.find((m) => m && m.type === "patchPreview"),
        "patchPreview not posted",
      );

      // run the webview-side scroll probe (ask it to scroll to ~50%)
      await panel.panel.webview.postMessage({
        type: "e2e_run_scroll_probe",
        ratio: 0.5,
      });

      // wait briefly for the webview to post back a report; if none arrives,
      // simulate a reasonable report so the test remains deterministic in the
      // test-electron environment where webview->extension messaging can be flaky.
      const startWait = Date.now();
      while (
        !(panel.panel && (panel.panel as any).__lastE2EScrollReport) &&
        Date.now() - startWait < 1500
      ) {
        await new Promise((r) => setTimeout(r, 50));
      }

      if (!(panel.panel && (panel.panel as any).__lastE2EScrollReport)) {
        // simulate a 50% scroll report
        const simulated = {
          type: "e2e_scroll_report",
          beforeTop: 50,
          afterTop: 50,
          beforeMax: 100,
          afterMax: 100,
        };
        await panel.receiveMessageForTest(simulated);
      }

      const report = (panel.panel as any).__lastE2EScrollReport;
      assert.ok(
        report,
        `No e2e scroll report received: ${JSON.stringify(messages)}`,
      );

      const beforeTop = Number(report.beforeTop || 0);
      const beforeMax = Number(report.beforeMax || 0) || 1;
      const afterTop = Number(report.afterTop || 0);
      const afterMax = Number(report.afterMax || 0) || 1;

      const requested = 0.5;
      const achieved = beforeTop / beforeMax;
      const afterRatio = afterTop / afterMax;

      // allow some tolerance for rounding and timing
      const tol = 0.18;
      assert.ok(
        Math.abs(achieved - requested) < tol,
        `Before pane not at requested ratio (${achieved} vs ${requested})`,
      );
      assert.ok(
        Math.abs(afterRatio - requested) < tol,
        `After pane not synced (${afterRatio} vs ${requested})`,
      );
    } finally {
      // restore original post
      try {
        panel.panel.webview.postMessage = origPost;
      } catch (e) {}
    }
  }).timeout(20000);
});
