import path from "path";
import * as vscode from "vscode";
import {
  AgentMode,
  createNexcodeOrchestrator,
  NexcodeOrchestrator,
  OrchestratorRequest,
  ProposedEdit,
  ProviderId,
  RequestAttachment,
} from "@nexcode/agent-core";

interface WebviewSendPromptMessage {
  type: "sendPrompt";
  prompt: string;
  provider?: ProviderId;
  model?: string;
  mode?: AgentMode;
  attachmentIds?: string[];
}

interface WebviewPickAttachmentsMessage {
  type: "pickAttachments";
}

interface WebviewRemoveAttachmentMessage {
  type: "removeAttachment";
  attachmentId: string;
}

interface WebviewApplyEditMessage {
  type: "applyEdit";
  editId: string;
}

interface WebviewPreviewEditMessage {
  type: "previewEdit";
  editId: string;
}

interface WebviewRejectEditMessage {
  type: "rejectEdit";
  editId: string;
}

interface WebviewClearMessage {
  type: "clearConversation";
}

type InboundWebviewMessage =
  | WebviewSendPromptMessage
  | WebviewApplyEditMessage
  | WebviewPreviewEditMessage
  | WebviewRejectEditMessage
  | WebviewClearMessage
  | WebviewPickAttachmentsMessage
  | WebviewRemoveAttachmentMessage;

interface AttachmentChip {
  id: string;
  fileName: string;
  kind: RequestAttachment["kind"];
  mimeType: string;
  byteSize?: number;
}

export class KibokoSidebarViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "nexcodeKiboko.sidebarView";

  private view?: vscode.WebviewView;
  private orchestrator?: NexcodeOrchestrator;
  private currentWorkspaceRoot?: string;
  private readonly pendingEdits = new Map<string, ProposedEdit>();
  private readonly pendingAttachments = new Map<string, RequestAttachment>();
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
    this.postAttachments();
  }

  public notifyConfigChanged(): void {
    this.orchestrator = undefined;
    this.currentWorkspaceRoot = undefined;
    this.postMessage({ type: "config", value: this.getRuntimeSettings() });
  }

  public clearConversation(): void {
    this.pendingEdits.clear();
    this.pendingAttachments.clear();
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
      case "previewEdit":
        await this.previewProposedEdit(message.editId);
        return;
      case "rejectEdit":
        this.rejectProposedEdit(message.editId);
        return;
      case "clearConversation":
        this.clearConversation();
        return;
      case "pickAttachments":
        await this.pickAttachments();
        return;
      case "removeAttachment":
        this.pendingAttachments.delete(message.attachmentId);
        this.postAttachments();
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
    const selectedAttachmentIds = message.attachmentIds ?? [];

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
        attachments: this.resolveAttachmentsForPrompt(selectedAttachmentIds),
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
      for (const attachmentId of selectedAttachmentIds) {
        this.pendingAttachments.delete(attachmentId);
      }
      this.postAttachments();
      this.isBusy = false;
      this.postMessage({ type: "end" });
    }
  }

  private async pickAttachments(): Promise<void> {
    const selected = await vscode.window.showOpenDialog({
      canSelectMany: true,
      canSelectFiles: true,
      canSelectFolders: false,
      openLabel: "Attach",
    });

    if (!selected || selected.length === 0) {
      return;
    }

    for (const uri of selected) {
      try {
        const attachment = await this.readAttachment(uri);
        this.pendingAttachments.set(attachment.id, attachment);
      } catch (error) {
        this.postMessage({
          type: "error",
          message: `Failed to attach ${path.basename(uri.fsPath)}: ${String(error)}`,
        });
      }
    }

    this.postAttachments();
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

  private async previewProposedEdit(editId: string): Promise<void> {
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
    const previewsDir = vscode.Uri.file(
      path.join(workspaceRoot, ".nexcode", "edit-previews"),
    );
    await vscode.workspace.fs.createDirectory(previewsDir);

    const extension = path.extname(edit.filePath) || ".txt";
    const safeBaseName = path
      .basename(edit.filePath)
      .replace(/[^a-zA-Z0-9._-]/g, "_");

    const beforeUri = vscode.Uri.file(
      path.join(
        previewsDir.fsPath,
        `${edit.id}-${safeBaseName}.before${extension}`,
      ),
    );
    const afterUri = vscode.Uri.file(
      path.join(
        previewsDir.fsPath,
        `${edit.id}-${safeBaseName}.after${extension}`,
      ),
    );

    const targetExists = await this.fileExists(targetUri);
    if (!targetExists) {
      await vscode.workspace.fs.writeFile(beforeUri, Buffer.from("", "utf8"));
    }

    await vscode.workspace.fs.writeFile(
      afterUri,
      Buffer.from(edit.newText, "utf8"),
    );

    await vscode.commands.executeCommand(
      "vscode.diff",
      targetExists ? targetUri : beforeUri,
      afterUri,
      `NEXCODE Review: ${edit.filePath}`,
    );

    this.postMessage({
      type: "editPreviewOpened",
      editId,
      filePath: edit.filePath,
    });
  }

  private rejectProposedEdit(editId: string): void {
    if (!this.pendingEdits.has(editId)) {
      this.postMessage({
        type: "error",
        message: "Proposed edit not found.",
      });
      return;
    }

    this.pendingEdits.delete(editId);
    this.postMessage({
      type: "editRejected",
      editId,
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
        tavilyApiKey: settings.tavilyApiKey,
      });
      this.currentWorkspaceRoot = workspaceRoot;
    }

    return this.orchestrator;
  }

  private resolveAttachmentsForPrompt(
    selectedAttachmentIds?: string[],
  ): RequestAttachment[] {
    if (!selectedAttachmentIds || selectedAttachmentIds.length === 0) {
      return [];
    }

    const attachments: RequestAttachment[] = [];
    for (const attachmentId of selectedAttachmentIds) {
      const attachment = this.pendingAttachments.get(attachmentId);
      if (attachment) {
        attachments.push(attachment);
      }
    }
    return attachments;
  }

  private async readAttachment(uri: vscode.Uri): Promise<RequestAttachment> {
    const bytes = await vscode.workspace.fs.readFile(uri);
    const fileName = path.basename(uri.fsPath);
    const mimeType = this.guessMimeType(fileName);
    const byteSize = bytes.byteLength;
    const id = `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;

    if (this.isTextLike(mimeType, fileName) && byteSize <= 250_000) {
      const textContent = new TextDecoder("utf-8", { fatal: false }).decode(
        bytes,
      );
      return {
        id,
        fileName,
        mimeType,
        kind: "text",
        textContent,
        byteSize,
      };
    }

    const base64Data = Buffer.from(bytes).toString("base64");
    return {
      id,
      fileName,
      mimeType,
      kind: mimeType.startsWith("image/") ? "image" : "binary",
      base64Data,
      byteSize,
    };
  }

  private postAttachments(): void {
    const attachments: AttachmentChip[] = [
      ...this.pendingAttachments.values(),
    ].map((attachment) => ({
      id: attachment.id,
      fileName: attachment.fileName,
      kind: attachment.kind,
      mimeType: attachment.mimeType,
      byteSize: attachment.byteSize,
    }));

    this.postMessage({
      type: "attachmentsSelected",
      attachments,
    });
  }

  private guessMimeType(fileName: string): string {
    const lowered = fileName.toLowerCase();
    if (lowered.endsWith(".png")) {
      return "image/png";
    }
    if (lowered.endsWith(".jpg") || lowered.endsWith(".jpeg")) {
      return "image/jpeg";
    }
    if (lowered.endsWith(".gif")) {
      return "image/gif";
    }
    if (lowered.endsWith(".webp")) {
      return "image/webp";
    }
    if (lowered.endsWith(".svg")) {
      return "image/svg+xml";
    }
    if (lowered.endsWith(".md")) {
      return "text/markdown";
    }
    if (
      lowered.endsWith(".ts") ||
      lowered.endsWith(".tsx") ||
      lowered.endsWith(".js") ||
      lowered.endsWith(".jsx") ||
      lowered.endsWith(".json") ||
      lowered.endsWith(".yml") ||
      lowered.endsWith(".yaml") ||
      lowered.endsWith(".py") ||
      lowered.endsWith(".java") ||
      lowered.endsWith(".go") ||
      lowered.endsWith(".rs") ||
      lowered.endsWith(".txt")
    ) {
      return "text/plain";
    }
    return "application/octet-stream";
  }

  private isTextLike(mimeType: string, fileName: string): boolean {
    return (
      mimeType.startsWith("text/") ||
      fileName.toLowerCase().endsWith(".md") ||
      fileName.toLowerCase().endsWith(".json") ||
      fileName.toLowerCase().endsWith(".yaml") ||
      fileName.toLowerCase().endsWith(".yml")
    );
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
    tavilyApiKey: string;
    allowTools: boolean;
    requireTerminalApproval: boolean;
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
      tavilyApiKey: config.get<string>("tavilyApiKey", ""),
      allowTools: config.get<boolean>("allowToolCommands", true),
      requireTerminalApproval: config.get<boolean>(
        "requireTerminalApproval",
        true,
      ),
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
      <div class="composer-actions">
        <button id="attachBtn" class="secondary" type="button">Attach</button>
      </div>
      <ul id="attachmentList" class="attachment-list"></ul>
      <textarea id="promptInput" rows="4" placeholder="Ask Nexcode Kiboko...\nExamples:\n- Build login endpoint with tests\n- /tool search orchestrator\n- /tool web-search OWASP API Security Top 10\n- /edit src/file.ts :: improve error handling"></textarea>
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
