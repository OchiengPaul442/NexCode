import * as vscode from "vscode";

export class ChatPanel {
  public static currentPanel: ChatPanel | undefined;

  public static readonly viewType = "kiboko.chat";

  private readonly _panel: vscode.WebviewPanel;
  private readonly _extensionUri: vscode.Uri;

  public static createOrShow(extensionUri: vscode.Uri) {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    if (ChatPanel.currentPanel) {
      ChatPanel.currentPanel._panel.reveal(column);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      ChatPanel.viewType,
      "Kiboko Chat",
      column || vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
      },
    );

    ChatPanel.currentPanel = new ChatPanel(panel, extensionUri);
  }

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
    this._panel = panel;
    this._extensionUri = extensionUri;

    // Set the initial HTML
    this._update();

    // Handle messages from the webview
    this._panel.webview.onDidReceiveMessage((message) => {
      switch (message.type) {
        case "log":
          console.log("Webview:", message.text);
          return;
        case "openLink":
          vscode.env.openExternal(vscode.Uri.parse(message.url));
          return;
        case "requestStream":
          // message: { type: 'requestStream', prompt, assistantId }
          this._startProviderStream(message.prompt, message.assistantId);
          return;
        case "cancelStream":
          if (this._currentStreamCancellation)
            this._currentStreamCancellation();
          return;
      }
    }, undefined);

    this._panel.onDidDispose(() => this.dispose(), null);
  }

  public dispose() {
    ChatPanel.currentPanel = undefined;
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
        <title>Kiboko Chat</title>
      </head>
      <body>
        <div id="root" style="height:100vh"></div>
        <script nonce="${nonce}" src="${scriptUri}"></script>
      </body>
      </html>`;

    return html;
  }

  private _currentStreamCancellation?: () => void;

  private _startProviderStream(prompt: string, assistantId: string) {
    const config = vscode.workspace.getConfiguration("pulse");
    let providerName = config.get<string>("provider") || "ollama";
    const ollamaBase = config.get<string>("ollamaBaseUrl") || undefined;
    const ollamaModel = config.get<string>("ollamaModel") || undefined;
    const openaiBase = config.get<string>("openaiBaseUrl") || undefined;
    const openaiKey = config.get<string>("openaiApiKey") || undefined;
    const openaiModel = config.get<string>("openaiModel") || undefined;

    // validate OpenAI API key when selected
    if (providerName === "openai" && !openaiKey) {
      void vscode.window.showWarningMessage(
        "OpenAI is selected but no API key is configured (pulse.openaiApiKey). Falling back to Ollama.",
      );
      providerName = "ollama";
    }

    // create provider from shared factory to avoid duplicating logic
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const {
      createProviderFromPulseConfig,
    } = require("../providers/providerFactory");
    const provider: any = createProviderFromPulseConfig();

    this._panel.webview.postMessage({
      type: "streamState",
      state: "connecting",
      assistantId,
    });

    const controller = provider.streamCompletion(prompt, undefined, {
      onStart: () =>
        this._panel.webview.postMessage({
          type: "streamState",
          state: "started",
          assistantId,
        }),
      onConnected: () =>
        this._panel.webview.postMessage({
          type: "streamState",
          state: "connected",
          assistantId,
        }),
      onToken: (token: string) =>
        this._panel.webview.postMessage({
          type: "streamToken",
          assistantId,
          token,
        }),
      onEnd: () =>
        this._panel.webview.postMessage({ type: "streamEnd", assistantId }),
      onError: (err: any) =>
        this._panel.webview.postMessage({
          type: "streamError",
          assistantId,
          error: String(err && err.message ? err.message : err),
        }),
    });

    this._currentStreamCancellation = () => {
      try {
        controller && controller.cancel();
      } catch (e) {
        // ignore
      }
    };
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
