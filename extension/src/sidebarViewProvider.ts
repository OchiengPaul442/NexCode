import path from "path";
import * as vscode from "vscode";
import {
  AgentMode,
  createNexcodeOrchestrator,
  NexcodeOrchestrator,
  OrchestratorRequest,
  ProposedEdit,
  ProviderId,
} from "@nexcode/agent-core";

interface WebviewSendPromptMessage {
  type: "sendPrompt";
  prompt: string;
  provider?: ProviderId;
  model?: string;
  mode?: AgentMode;
}

interface WebviewApplyEditMessage {
  type: "applyEdit";
  editId: string;
}

interface WebviewClearMessage {
  type: "clearConversation";
}

type InboundWebviewMessage =
  | WebviewSendPromptMessage
  | WebviewApplyEditMessage
  | WebviewClearMessage;

export class KibokoSidebarViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "nexcodeKiboko.sidebarView";

  private view?: vscode.WebviewView;
  private orchestrator?: NexcodeOrchestrator;
  private currentWorkspaceRoot?: string;
  private readonly pendingEdits = new Map<string, ProposedEdit>();
  private isBusy = false;

  public constructor(private readonly context: vscode.ExtensionContext) {}

  public resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;

    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.context.extensionUri, "media"),
      ],
    };

    view.webview.html = this.getHtml(view.webview);
    view.webview.onDidReceiveMessage((message: InboundWebviewMessage) => {
      void this.handleWebviewMessage(message);
    });

    this.postMessage({ type: "config", value: this.getRuntimeSettings() });
  }

  public notifyConfigChanged(): void {
    this.postMessage({ type: "config", value: this.getRuntimeSettings() });
  }

  public clearConversation(): void {
    this.pendingEdits.clear();
    this.postMessage({ type: "cleared" });
  }

  private async handleWebviewMessage(
    message: InboundWebviewMessage,
  ): Promise<void> {
    switch (message.type) {
      case "sendPrompt":
        await this.handlePrompt(message);
        return;
      case "applyEdit":
        await this.applyProposedEdit(message.editId);
        return;
      case "clearConversation":
        this.clearConversation();
        return;
    }
  }

  private async handlePrompt(message: WebviewSendPromptMessage): Promise<void> {
    if (this.isBusy) {
      this.postMessage({
        type: "error",
        message: "A request is already running. Please wait for it to finish.",
      });
      return;
    }

    const prompt = message.prompt?.trim();
    if (!prompt) {
      return;
    }

    this.isBusy = true;
    this.postMessage({ type: "start" });

    try {
      const workspaceRoot = this.getWorkspaceRoot();
      const orchestrator = this.getOrchestrator(workspaceRoot);
      const activeEditor = vscode.window.activeTextEditor;

      const request: OrchestratorRequest = {
        prompt,
        provider: message.provider ?? this.getRuntimeSettings().provider,
        model: message.model ?? this.getRuntimeSettings().model,
        mode: message.mode ?? this.getRuntimeSettings().mode,
        allowTools: this.getRuntimeSettings().allowTools,
        workspaceRoot,
        activeFilePath: activeEditor?.document.uri.fsPath,
        selectedText: activeEditor?.document.getText(activeEditor.selection),
      };

      for await (const event of orchestrator.stream(request)) {
        if (event.type === "final") {
          for (const edit of event.response.proposedEdits) {
            this.pendingEdits.set(edit.id, edit);
          }
        }

        this.postMessage(event);
      }
    } catch (error) {
      this.postMessage({
        type: "error",
        message: String(error),
      });
    } finally {
      this.isBusy = false;
      this.postMessage({ type: "end" });
    }
  }

  private async applyProposedEdit(editId: string): Promise<void> {
    const edit = this.pendingEdits.get(editId);
    if (!edit) {
      this.postMessage({
        type: "error",
        message: "Proposed edit not found.",
      });
      return;
    }

    const workspaceRoot = this.getWorkspaceRoot();
    const targetUri = vscode.Uri.file(path.join(workspaceRoot, edit.filePath));

    const workspaceEdit = new vscode.WorkspaceEdit();

    if (await this.fileExists(targetUri)) {
      const document = await vscode.workspace.openTextDocument(targetUri);
      const fullRange = this.fullDocumentRange(document);
      workspaceEdit.replace(targetUri, fullRange, edit.newText);
    } else {
      workspaceEdit.createFile(targetUri, { ignoreIfExists: true });
      workspaceEdit.insert(targetUri, new vscode.Position(0, 0), edit.newText);
    }

    const applied = await vscode.workspace.applyEdit(workspaceEdit);
    if (!applied) {
      this.postMessage({
        type: "error",
        message: "VS Code rejected the workspace edit.",
      });
      return;
    }

    this.pendingEdits.delete(editId);
    this.postMessage({
      type: "editApplied",
      editId,
      filePath: edit.filePath,
    });

    const opened = await vscode.workspace.openTextDocument(targetUri);
    await vscode.window.showTextDocument(opened, {
      preview: false,
      preserveFocus: false,
    });
  }

  private getOrchestrator(workspaceRoot: string): NexcodeOrchestrator {
    if (!this.orchestrator || this.currentWorkspaceRoot !== workspaceRoot) {
      const settings = this.getRuntimeSettings();
      this.orchestrator = createNexcodeOrchestrator({
        workspaceRoot,
        promptsDir: path.join(workspaceRoot, "prompts"),
        memoryDir: path.join(workspaceRoot, "memory"),
        defaultProvider: settings.provider,
        defaultModel: settings.model,
        ollamaBaseUrl: settings.ollamaBaseUrl,
        openAIBaseUrl: settings.openAIBaseUrl,
        openAIApiKey: settings.openAIApiKey,
      });
      this.currentWorkspaceRoot = workspaceRoot;
    }

    return this.orchestrator;
  }

  private getWorkspaceRoot(): string {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (workspaceFolder) {
      return workspaceFolder.uri.fsPath;
    }

    return this.context.globalStorageUri.fsPath;
  }

  private getRuntimeSettings(): {
    provider: ProviderId;
    model: string;
    mode: AgentMode;
    ollamaBaseUrl: string;
    openAIBaseUrl: string;
    openAIApiKey: string;
    allowTools: boolean;
  } {
    const config = vscode.workspace.getConfiguration("nexcodeKiboko");

    return {
      provider: config.get<ProviderId>("defaultProvider", "ollama"),
      model: config.get<string>("defaultModel", "qwen2.5-coder:7b"),
      mode: config.get<AgentMode>("defaultMode", "auto"),
      ollamaBaseUrl: config.get<string>(
        "ollamaBaseUrl",
        "http://localhost:11434",
      ),
      openAIBaseUrl: config.get<string>(
        "openAIBaseUrl",
        "https://api.openai.com/v1",
      ),
      openAIApiKey: config.get<string>("openAIApiKey", ""),
      allowTools: config.get<boolean>("allowToolCommands", true),
    };
  }

  private getHtml(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, "media", "main.js"),
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, "media", "main.css"),
    );
    const nonce = this.createNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
  <link href="${styleUri}" rel="stylesheet" />
  <title>NEXCODE-KIBOKO</title>
</head>
<body>
  <main class="layout">
    <header class="toolbar">
      <div class="brand">NEXCODE-KIBOKO</div>
      <button id="clearBtn" class="secondary">Clear</button>
    </header>

    <section class="controls">
      <label>Provider
        <select id="providerSelect">
          <option value="ollama">ollama</option>
          <option value="openai-compatible">openai-compatible</option>
        </select>
      </label>
      <label>Model
        <input id="modelInput" type="text" placeholder="qwen2.5-coder:7b" />
      </label>
      <label>Mode
        <select id="modeSelect">
          <option value="auto">auto</option>
          <option value="planner">planner</option>
          <option value="coder">coder</option>
          <option value="reviewer">reviewer</option>
          <option value="qa">qa</option>
          <option value="security">security</option>
        </select>
      </label>
    </section>

    <section id="chat" class="chat"></section>

    <section class="composer">
      <textarea id="promptInput" rows="4" placeholder="Ask Nexcode Kiboko...\nExamples:\n- Build login endpoint with tests\n- /tool search orchestrator\n- /edit src/file.ts :: improve error handling"></textarea>
      <button id="sendBtn">Send</button>
    </section>

    <section class="history">
      <h2>History</h2>
      <ul id="historyList"></ul>
    </section>
  </main>

  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }

  private postMessage(message: unknown): void {
    if (!this.view) {
      return;
    }

    this.view.webview.postMessage(message).then(undefined, () => {
      // Ignore postMessage race conditions during shutdown.
    });
  }

  private async fileExists(uri: vscode.Uri): Promise<boolean> {
    try {
      await vscode.workspace.fs.stat(uri);
      return true;
    } catch {
      return false;
    }
  }

  private fullDocumentRange(document: vscode.TextDocument): vscode.Range {
    const lastLineIndex = Math.max(0, document.lineCount - 1);
    const lastLine = document.lineAt(lastLineIndex);
    return new vscode.Range(0, 0, lastLineIndex, lastLine.text.length);
  }

  private createNonce(): string {
    const alphabet =
      "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    let nonce = "";
    for (let index = 0; index < 16; index += 1) {
      nonce += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
    }
    return nonce;
  }
}
