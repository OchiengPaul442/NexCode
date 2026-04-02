import * as assert from "assert";
import * as vscode from "vscode";
import * as http from "http";
import * as path from "path";
import { AddressInfo } from "net";

describe("Integration: ChatPanel -> OllamaAdapter", function () {
  this.timeout(20000);

  it("streams tokens from mock Ollama to webview via ChatPanel", async () => {
    const handler = (req: http.IncomingMessage, res: http.ServerResponse) => {
      if (req.method === "POST" && req.url && req.url.startsWith("/api/chat")) {
        res.writeHead(200, {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        });

        const messages = [
          { choices: [{ delta: { content: "Hello" } }] },
          { choices: [{ delta: { content: ", world" } }] },
          { choices: [{ delta: { content: "!" } }] },
        ];

        let i = 0;
        const iv = setInterval(() => {
          if (i < messages.length) {
            res.write("data: " + JSON.stringify(messages[i]) + "\n\n");
            i++;
          } else {
            res.write("data: [DONE]\n\n");
            clearInterval(iv);
            setTimeout(() => res.end(), 10);
          }
        }, 30);
      } else {
        res.writeHead(404);
        res.end();
      }
    };

    let server = http.createServer(handler);

    const listenOn = (srv: http.Server, port: number) =>
      new Promise<void>((resolve, reject) => {
        const onError = (err: any) => {
          srv.removeListener("listening", onListening);
          reject(err);
        };
        const onListening = () => {
          srv.removeListener("error", onError);
          resolve();
        };
        srv.once("error", onError);
        srv.once("listening", onListening);
        try {
          srv.listen(port);
        } catch (err) {
          // synchronous listen error
          srv.removeListener("error", onError);
          srv.removeListener("listening", onListening);
          reject(err);
        }
      });

    // try default Ollama port first, fall back to ephemeral port if in use
    const DEFAULT_PORT = 11434;
    let baseUrl: string;
    try {
      await listenOn(server, DEFAULT_PORT);
      baseUrl = `http://127.0.0.1:${DEFAULT_PORT}`;
    } catch (e) {
      // if default port not available, create fresh server and bind ephemeral port
      try {
        server.close();
      } catch (e) {
        // ignore
      }
      server = http.createServer(handler);
      await listenOn(server, 0);
      const addr = server.address() as AddressInfo;
      baseUrl = `http://127.0.0.1:${addr.port}`;
    }

    const ext = vscode.extensions.getExtension("your-name.nexcode-kiboko");
    assert.ok(ext, "Extension not found");
    await ext!.activate();
    assert.strictEqual(ext!.isActive, true);

    const chatPanelModule = require(
      path.join(ext!.extensionPath, "out", "panels", "chatPanel.js"),
    );
    const ChatPanel = chatPanelModule.ChatPanel;

    // create the panel directly (avoids relying on command activation wiring in the test host)
    ChatPanel.createOrShow(vscode.Uri.file(ext!.extensionPath));
    assert.ok(ChatPanel.currentPanel, "ChatPanel.currentPanel should exist");

    const panelAny = ChatPanel.currentPanel as any;
    assert.ok(panelAny._panel && panelAny._panel.webview, "webview present");

    const messagesCaptured: any[] = [];
    const origPost = panelAny._panel.webview.postMessage.bind(
      panelAny._panel.webview,
    );
    panelAny._panel.webview.postMessage = (m: any) => {
      messagesCaptured.push(m);
      return Promise.resolve(true);
    };

    const config = vscode.workspace.getConfiguration("pulse");
    const originalBase = config.get("ollamaBaseUrl");
    const originalProvider = config.get("provider");
    await config.update(
      "ollamaBaseUrl",
      baseUrl,
      vscode.ConfigurationTarget.Global,
    );
    await config.update(
      "provider",
      "ollama",
      vscode.ConfigurationTarget.Global,
    );

    // start the provider stream via the panel's normal method
    (panelAny as any)._startProviderStream("Say hello", "assistant-test");

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("timeout waiting for stream end")),
        8000,
      );
      const check = setInterval(() => {
        if (
          messagesCaptured.find(
            (m) => m.type === "streamEnd" || m.type === "streamError",
          )
        ) {
          clearTimeout(timeout);
          clearInterval(check);
          resolve();
        }
      }, 50);
    });

    const tokenMsgs = messagesCaptured
      .filter((m) => m.type === "streamToken")
      .map((m) => m.token);
    assert.ok(
      tokenMsgs.length >= 3,
      `expected at least 3 tokens, got ${tokenMsgs.length}`,
    );

    // restore and cleanup
    panelAny._panel.webview.postMessage = origPost;
    await config.update(
      "ollamaBaseUrl",
      originalBase,
      vscode.ConfigurationTarget.Global,
    );
    await config.update(
      "provider",
      originalProvider,
      vscode.ConfigurationTarget.Global,
    );
    server.close();
  });
});
