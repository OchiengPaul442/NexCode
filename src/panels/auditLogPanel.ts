import * as vscode from "vscode";
import { getEvents, clearEvents, exportEvents } from "../tools/audit";

export class AuditLogPanel {
  public static currentPanel: AuditLogPanel | undefined;

  public static readonly viewType = "kiboko.auditLog";

  private readonly _panel: vscode.WebviewPanel;
  private readonly _extensionUri: vscode.Uri;

  public static createOrShow(extensionUri: vscode.Uri) {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    if (AuditLogPanel.currentPanel) {
      AuditLogPanel.currentPanel._panel.reveal(column);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      AuditLogPanel.viewType,
      "Kiboko Audit Log",
      column || vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
      },
    );

    AuditLogPanel.currentPanel = new AuditLogPanel(panel, extensionUri);
  }

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
    this._panel = panel;
    this._extensionUri = extensionUri;

    this._update();

    this._panel.webview.onDidReceiveMessage(async (message) => {
      try {
        switch (message.type) {
          case "refresh": {
            const events = await getEvents();
            this._panel.webview.postMessage({ type: "events", events });
            return;
          }
          case "clear": {
            await clearEvents();
            const events = await getEvents();
            this._panel.webview.postMessage({ type: "events", events });
            this._panel.webview.postMessage({ type: "cleared" });
            return;
          }
          case "export": {
            const uri = await exportEvents();
            this._panel.webview.postMessage({
              type: "exported",
              uri: uri ? uri.fsPath : undefined,
            });
            return;
          }
          case "openExternal": {
            if (message.url) {
              try {
                await vscode.env.openExternal(vscode.Uri.parse(message.url));
              } catch (e) {
                // ignore
              }
            }
            return;
          }
          default:
            console.warn("Unknown message from audit webview", message);
        }
      } catch (e: any) {
        this._panel.webview.postMessage({
          type: "error",
          error: String(e && e.message ? e.message : e),
        });
      }
    }, undefined);

    this._panel.onDidDispose(() => this.dispose(), null);
  }

  public dispose() {
    AuditLogPanel.currentPanel = undefined;
    this._panel.dispose();
  }

  private _update() {
    const webview = this._panel.webview;
    this._panel.webview.html = this._getHtmlForWebview(webview);
    // request events after panel is ready
    setTimeout(() => void this._sendRefresh(), 300);
  }

  private async _sendRefresh() {
    const events = await getEvents();
    this._panel.webview.postMessage({ type: "events", events });
  }

  private _getHtmlForWebview(webview: vscode.Webview) {
    const nonce = getNonce();
    const style = `
      body{font-family:Segoe UI,Arial,sans-serif;padding:12px}
      button{padding:6px 10px;border-radius:6px;border:1px solid #888;background:#f3f3f3;cursor:pointer}
      table{width:100%;border-collapse:collapse}
      th,td{padding:6px;border-bottom:1px solid #eee;text-align:left;font-size:12px}
      pre{margin:0;font-size:11px}
    `;

    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, "media", "webview.js"));

    const html = `<!DOCTYPE html>
      <html lang="en"><head>
        <meta charset="UTF-8" />
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline' ${webview.cspSource}; script-src 'nonce-${nonce}' ${webview.cspSource};" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>Audit Log</title>
        <style>${style}</style>
      </head>
      <body>
        <div id="audit-root"></div>
        <script nonce="${nonce}" src="${scriptUri}"></script>
        <script nonce="${nonce}">
          (function(){
            const vscode = acquireVsCodeApi();
            function start(){
              if(window.initAudit) return window.initAudit(vscode);
              // if the bundle hasn't registered yet, wait for load
              window.addEventListener('load', ()=>{ if(window.initAudit) window.initAudit(vscode); });
            }
            start();
          })();
        </script>
      </body>
      </html>`;

    return html;
  }
}

function getNonce() {
  let text = "";
  const possible =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 32; i++)
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  return text;
}

export default { AuditLogPanel };
