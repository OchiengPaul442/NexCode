import * as vscode from "vscode";

export class DiffReviewPanel {
  public static currentPanel: DiffReviewPanel | undefined;

  public static readonly viewType = "kiboko.diffReview";

  private readonly _panel: vscode.WebviewPanel;
  private readonly _extensionUri: vscode.Uri;

  public static createOrShow(extensionUri: vscode.Uri) {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    if (DiffReviewPanel.currentPanel) {
      DiffReviewPanel.currentPanel._panel.reveal(column);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      DiffReviewPanel.viewType,
      "Kiboko Diff Review",
      column || vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
      },
    );

    DiffReviewPanel.currentPanel = new DiffReviewPanel(panel, extensionUri);
  }

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
    this._panel = panel;
    this._extensionUri = extensionUri;

    this._update();

    this._panel.webview.onDidReceiveMessage((message) => {
      switch (message.type) {
        case "log":
          console.log("Diff Webview:", message.text);
          return;
        case "openLink":
          vscode.env.openExternal(vscode.Uri.parse(message.url));
          return;
        case "requestDiff":
          // placeholder: accept { baseUri, headUri }
          this._panel.webview.postMessage({ type: "diffState", state: "started" });
          // future: call provider to compute or fetch diff
          setTimeout(() =>
            this._panel.webview.postMessage({ type: "diffState", state: "ready" }),
          200);
          return;
      }
    }, undefined);

    this._panel.onDidDispose(() => this.dispose(), null);
  }

  public dispose() {
    DiffReviewPanel.currentPanel = undefined;
    this._panel.dispose();
  }

  private _update() {
    const webview = this._panel.webview;
    this._panel.webview.html = this._getHtmlForWebview(webview);
  }

  private _getHtmlForWebview(webview: vscode.Webview) {
    const nonce = getNonce();
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, "media", "webview.js"),
    );

    const html = `<!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} https:; script-src 'nonce-${nonce}' ${webview.cspSource}; style-src 'unsafe-inline' ${webview.cspSource};" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>Kiboko Diff Review</title>
      </head>
      <body>
        <div id="root" style="height:100vh">Diff Review UI (placeholder)</div>
        <script nonce="${nonce}" src="${scriptUri}"></script>
      </body>
      </html>`;

    return html;
  }
}

function getNonce() {
  let text = "";
  const possible =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}

export default DiffReviewPanel;
