import * as assert from "assert";
import * as vscode from "vscode";
import * as path from "path";

describe("Integration: AuditLogPanel", function () {
  this.timeout(10000);

  it("opens audit panel and receives events", async () => {
    const ext = vscode.extensions.getExtension("your-name.nexcode-kiboko");
    assert.ok(ext, "Extension not found");
    await ext!.activate();
    assert.strictEqual(ext!.isActive, true);

    const auditModule = require(
      path.join(ext!.extensionPath, "out", "panels", "auditLogPanel.js"),
    );
    const AuditLogPanel = auditModule.AuditLogPanel;

    // create the panel directly
    AuditLogPanel.createOrShow(vscode.Uri.file(ext!.extensionPath));
    assert.ok(
      AuditLogPanel.currentPanel,
      "AuditLogPanel.currentPanel should exist",
    );

    const panelAny = AuditLogPanel.currentPanel as any;
    assert.ok(panelAny._panel && panelAny._panel.webview, "webview present");

    const messagesCaptured: any[] = [];
    const origPost = panelAny._panel.webview.postMessage.bind(
      panelAny._panel.webview,
    );
    panelAny._panel.webview.postMessage = (m: any) => {
      messagesCaptured.push(m);
      return Promise.resolve(true);
    };

    // the panel requests events shortly after creation; wait for an 'events' message
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("timeout waiting for events")),
        5000,
      );
      const check = setInterval(() => {
        if (messagesCaptured.find((m) => m.type === "events")) {
          clearTimeout(timeout);
          clearInterval(check);
          resolve();
        }
      }, 50);
    });

    const ev = messagesCaptured.find((m) => m.type === "events");
    assert.ok(ev, "expected events message from audit panel");

    // restore
    panelAny._panel.webview.postMessage = origPost;
    AuditLogPanel.currentPanel.dispose();
  });
});
