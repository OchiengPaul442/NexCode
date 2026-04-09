import path from "path";
import { randomUUID } from "crypto";
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
  sessionId?: string;
  provider?: ProviderId;
  model?: string;
  mode?: AgentMode;
  temperature?: number;
  allowWebSearch?: boolean;
  attachmentIds?: string[];
}

interface WebviewCancelPromptMessage {
  type: "cancelPrompt";
}

interface WebviewPickAttachmentsMessage {
  type: "pickAttachments";
}

interface WebviewRemoveAttachmentMessage {
  type: "removeAttachment";
  attachmentId: string;
}

interface WebviewAddAttachmentMessage {
  type: "addAttachment";
  attachment: {
    id?: string;
    fileName: string;
    mimeType: string;
    kind: RequestAttachment["kind"];
    textContent?: string;
    base64Data?: string;
    byteSize?: number;
  };
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

interface WebviewOpenInTabMessage {
  type: "openInTab";
}

interface WebviewRefreshProviderStatusMessage {
  type: "refreshProviderStatus";
  provider?: ProviderId;
}

interface WebviewRequestModelSuggestionsMessage {
  type: "requestModelSuggestions";
  provider?: ProviderId;
}

interface WebviewEnhancePromptMessage {
  type: "enhancePrompt";
  sessionId?: string;
  prompt: string;
  provider?: ProviderId;
  model?: string;
  mode?: AgentMode;
  temperature?: number;
}

interface WebviewListMcpServersMessage {
  type: "listMcpServers";
}

interface WebviewListMcpToolsMessage {
  type: "listMcpTools";
  server: string;
}

interface WebviewInvokeMcpToolQuickMessage {
  type: "invokeMcpToolQuick";
  server: string;
  tool: string;
  input?: string;
}

type InboundWebviewMessage =
  | WebviewSendPromptMessage
  | WebviewCancelPromptMessage
  | WebviewApplyEditMessage
  | WebviewPreviewEditMessage
  | WebviewRejectEditMessage
  | WebviewClearMessage
  | WebviewPickAttachmentsMessage
  | WebviewRemoveAttachmentMessage
  | WebviewAddAttachmentMessage
  | WebviewRefreshProviderStatusMessage
  | WebviewRequestModelSuggestionsMessage
  | WebviewEnhancePromptMessage
  | WebviewListMcpServersMessage
  | WebviewListMcpToolsMessage
  | WebviewInvokeMcpToolQuickMessage
  | WebviewOpenInTabMessage;

interface AttachmentChip {
  id: string;
  fileName: string;
  kind: RequestAttachment["kind"];
  mimeType: string;
  byteSize?: number;
}

const MAX_ATTACHMENT_BYTES = 3_000_000;
const MAX_ATTACHMENT_TEXT_CHARS = 750_000;
const MAX_ATTACHMENT_NAME_LENGTH = 160;

export class KibokoSidebarViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "nexcodeKiboko.sidebarView";

  private view?: vscode.WebviewView;
  private readonly webviews = new Set<vscode.Webview>();
  private orchestrator?: NexcodeOrchestrator;
  private currentWorkspaceRoot?: string;
  private readonly pendingEdits = new Map<string, ProposedEdit>();
  private readonly pendingAttachments = new Map<string, RequestAttachment>();
  private isBusy = false;
  private currentAbortController?: AbortController;

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
    this.webviews.add(view.webview);

    view.onDidDispose(() => {
      this.webviews.delete(view.webview);
      if (this.view?.webview === view.webview) {
        this.view = undefined;
      }
    });

    this.pushInitialWebviewState();
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

  public prefillPrompt(prompt: string): void {
    const trimmed = prompt.trim();
    if (!trimmed) {
      return;
    }

    this.postMessage({
      type: "prefillPrompt",
      prompt: trimmed,
    });
  }

  private normalizeOllamaBaseUrl(rawUrl: string): string {
    const trimmed = rawUrl.trim();
    if (!trimmed) {
      return "http://localhost:11434";
    }

    const candidate = trimmed.replace(/\/$/, "");

    try {
      const url = new URL(candidate);
      if (/^(?:www\.)?ollama\.com$/i.test(url.hostname)) {
        return "http://localhost:11434";
      }

      return candidate;
    } catch {
      if (/^(?:www\.)?ollama\.com(?::\d+)?(?:\/.*)?$/i.test(candidate)) {
        return "http://localhost:11434";
      }

      return candidate.startsWith("http://") || candidate.startsWith("https://")
        ? candidate
        : `http://${candidate}`;
    }
  }

  private async handleWebviewMessage(
    message: InboundWebviewMessage,
  ): Promise<void> {
    switch (message.type) {
      case "sendPrompt":
        await this.handlePrompt(message);
        return;
      case "cancelPrompt":
        this.cancelPrompt();
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
      case "refreshProviderStatus":
        await this.refreshProviderStatus(message.provider);
        return;
      case "requestModelSuggestions":
        await this.provideModelSuggestions(message.provider);
        return;
      case "enhancePrompt":
        await this.handleEnhancePrompt(message);
        return;
      case "listMcpServers":
        await this.postMcpRegistryState();
        return;
      case "listMcpTools":
        await this.postMcpTools(message.server);
        return;
      case "invokeMcpToolQuick":
        await this.invokeMcpToolQuick(message);
        return;
      case "pickAttachments":
        await this.pickAttachments();
        return;
      case "openInTab":
        await vscode.commands.executeCommand("nexcodeKiboko.openInTab");
        return;
      case "addAttachment":
        this.addAttachmentFromWebview(message);
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
    this.currentAbortController = new AbortController();
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
        temperature:
          typeof message.temperature === "number"
            ? message.temperature
            : this.getRuntimeSettings().temperature,
        allowTools: this.getRuntimeSettings().allowTools,
        allowWebSearch:
          typeof message.allowWebSearch === "boolean"
            ? message.allowWebSearch
            : this.getRuntimeSettings().allowWebSearch,
        workspaceRoot,
        activeFilePath: activeEditor?.document.uri.fsPath,
        selectedText: activeEditor?.document.getText(activeEditor.selection),
        attachments: this.resolveAttachmentsForPrompt(selectedAttachmentIds),
        abortSignal: this.currentAbortController.signal,
      };

      this.postMessage({
        type: "start",
        sessionId: message.sessionId,
        provider: request.provider,
        model: request.model,
        mode: request.mode,
      });

      for await (const event of orchestrator.stream(request)) {
        if (event.type === "final") {
          for (const edit of event.response.proposedEdits) {
            this.pendingEdits.set(edit.id, edit);
          }
        }

        this.postMessage(event);
      }
    } catch (error) {
      const messageText = this.formatErrorForUi(error);
      if (messageText.toLowerCase().includes("cancel")) {
        this.postMessage({
          type: "stopped",
          message: "Request stopped by user.",
        });
      } else {
        this.postMessage({
          type: "error",
          message: messageText,
        });
      }
    } finally {
      for (const attachmentId of selectedAttachmentIds) {
        this.pendingAttachments.delete(attachmentId);
      }
      this.postAttachments();
      this.isBusy = false;
      this.currentAbortController = undefined;
      this.postMessage({ type: "end" });
    }
  }

  private async handleEnhancePrompt(
    message: WebviewEnhancePromptMessage,
  ): Promise<void> {
    const prompt = message.prompt?.trim();
    if (!prompt) {
      this.postMessage({
        type: "enhancePromptResult",
        sessionId: message.sessionId,
        ok: false,
        error: "Prompt cannot be empty.",
      });
      return;
    }

    const workspaceRoot = this.getWorkspaceRoot();
    const orchestrator = this.getOrchestrator(workspaceRoot);
    const activeEditor = vscode.window.activeTextEditor;

    this.postMessage({
      type: "enhancePromptStart",
      sessionId: message.sessionId,
    });

    try {
      const result = await orchestrator.enhancePrompt({
        prompt,
        provider: message.provider,
        model: message.model,
        mode: message.mode,
        temperature: message.temperature,
        workspaceRoot,
        activeFilePath: activeEditor?.document.uri.fsPath,
        selectedText: activeEditor?.document.getText(activeEditor.selection),
      });

      this.postMessage({
        type: "enhancePromptResult",
        sessionId: message.sessionId,
        ok: true,
        enhancedPrompt: result.enhancedPrompt,
        notes: result.notes,
        provider: result.providerUsed,
        model: result.modelUsed,
      });
    } catch (error) {
      this.postMessage({
        type: "enhancePromptResult",
        sessionId: message.sessionId,
        ok: false,
        error: String(error),
      });
    }
  }

  private async postMcpRegistryState(): Promise<void> {
    const orchestrator = this.getOrchestrator(this.getWorkspaceRoot());
    this.postMessage({
      type: "mcpServers",
      servers: orchestrator.listMcpServers(),
    });
  }

  private async postMcpTools(server: string): Promise<void> {
    const normalizedServer = server.trim();
    if (!normalizedServer) {
      this.postMessage({
        type: "mcpTools",
        server: "",
        tools: [],
      });
      return;
    }

    const orchestrator = this.getOrchestrator(this.getWorkspaceRoot());
    const tools = await orchestrator.listMcpTools(normalizedServer);

    this.postMessage({
      type: "mcpTools",
      server: normalizedServer,
      tools,
    });
  }

  private async invokeMcpToolQuick(
    message: WebviewInvokeMcpToolQuickMessage,
  ): Promise<void> {
    const server = message.server?.trim();
    const tool = message.tool?.trim();

    if (!server || !tool) {
      this.postMessage({
        type: "mcpQuickResult",
        ok: false,
        server: server ?? "",
        tool: tool ?? "",
        output: "Select an MCP server and tool before invoking.",
        latencyMs: 0,
      });
      return;
    }

    try {
      const orchestrator = this.getOrchestrator(this.getWorkspaceRoot());
      const result = await orchestrator.invokeMcpTool({
        server,
        tool,
        input: message.input ?? "",
      });

      this.postMessage({
        type: "mcpQuickResult",
        ok: result.ok,
        server,
        tool,
        output: result.output,
        latencyMs: result.latencyMs,
      });
    } catch (error) {
      this.postMessage({
        type: "mcpQuickResult",
        ok: false,
        server,
        tool,
        output: String(error),
        latencyMs: 0,
      });
    }
  }

  private cancelPrompt(): void {
    if (!this.isBusy || !this.currentAbortController) {
      return;
    }

    this.currentAbortController.abort("cancelled-by-user");
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

  private addAttachmentFromWebview(message: WebviewAddAttachmentMessage): void {
    const payload = message.attachment;
    if (!payload || !payload.fileName || !payload.mimeType || !payload.kind) {
      this.postMessage({
        type: "error",
        message: "Attachment payload is invalid.",
      });
      return;
    }

    if (!this.isValidAttachmentKind(payload.kind)) {
      this.postMessage({
        type: "error",
        message: "Attachment type is not supported.",
      });
      return;
    }

    const id =
      payload.id && payload.id.trim().length > 0
        ? payload.id.trim()
        : randomUUID();

    const sanitizedFileName = this.sanitizeAttachmentFileName(payload.fileName);
    const normalizedMimeType =
      payload.mimeType.trim() || "application/octet-stream";

    const byteSize = payload.byteSize ?? 0;
    if (byteSize > MAX_ATTACHMENT_BYTES) {
      this.postMessage({
        type: "error",
        message: `Attachment ${sanitizedFileName} is too large. Limit is 3MB.`,
      });
      return;
    }

    if (
      payload.kind === "text" &&
      (!payload.textContent || payload.textContent.trim().length === 0)
    ) {
      this.postMessage({
        type: "error",
        message: "Text attachments must include text content.",
      });
      return;
    }

    if (
      payload.kind !== "text" &&
      (!payload.base64Data || payload.base64Data.trim().length === 0)
    ) {
      this.postMessage({
        type: "error",
        message: "Binary or image attachments must include base64 data.",
      });
      return;
    }

    const normalizedTextContent = payload.textContent
      ? payload.textContent.slice(0, MAX_ATTACHMENT_TEXT_CHARS)
      : undefined;

    const attachment: RequestAttachment = {
      id,
      fileName: sanitizedFileName,
      mimeType: normalizedMimeType,
      kind: payload.kind,
      byteSize,
      textContent: normalizedTextContent,
      base64Data: payload.base64Data,
    };

    this.pendingAttachments.set(id, attachment);
    this.postAttachments();
  }

  private isValidAttachmentKind(
    kind: unknown,
  ): kind is RequestAttachment["kind"] {
    return kind === "text" || kind === "image" || kind === "binary";
  }

  private sanitizeAttachmentFileName(fileName: string): string {
    const sanitized = fileName
      .trim()
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
      .slice(0, MAX_ATTACHMENT_NAME_LENGTH);
    return sanitized || "attachment.txt";
  }

  private formatErrorForUi(error: unknown): string {
    const raw = String(error ?? "")
      .replace(/\s+/g, " ")
      .trim();
    if (!raw) {
      return "Request failed due to an unknown error.";
    }

    const normalized = raw.toLowerCase();
    if (normalized.includes("abort")) {
      return "Request cancelled.";
    }
    if (normalized.includes("timeout")) {
      return "Request timed out. Try a smaller task or a faster model.";
    }
    if (
      normalized.includes("fetch failed") ||
      normalized.includes("econnrefused") ||
      normalized.includes("enotfound")
    ) {
      return "Could not reach the configured model provider endpoint.";
    }
    if (normalized.includes("401") || normalized.includes("unauthorized")) {
      return "Provider authentication failed. Check your API key or endpoint settings.";
    }

    return raw.length > 260 ? `${raw.slice(0, 260)}...` : raw;
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
        memoryDir: path.join(this.context.globalStorageUri.fsPath, "memory"),
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
    const id = randomUUID();

    if (byteSize > MAX_ATTACHMENT_BYTES) {
      throw new Error(`Attachment is too large (${byteSize} bytes, max 3MB).`);
    }

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
    temperature: number;
    showReasoning: boolean;
    autoApplyChanges: boolean;
    allowWebSearch: boolean;
  } {
    const config = vscode.workspace.getConfiguration("nexcodeKiboko");

    return {
      provider: config.get<ProviderId>("defaultProvider", "ollama"),
      model: config.get<string>("defaultModel", "gpt-oss:120b-cloud"),
      mode: config.get<AgentMode>("defaultMode", "auto"),
      ollamaBaseUrl: this.normalizeOllamaBaseUrl(
        config.get<string>("ollamaBaseUrl", "http://localhost:11434"),
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
      temperature: config.get<number>("temperature", 0.2),
      showReasoning: config.get<boolean>("showReasoning", true),
      autoApplyChanges: config.get<boolean>("autoApplyChanges", false),
      allowWebSearch: config.get<boolean>("allowWebSearch", true),
    };
  }

  private async refreshProviderStatus(
    providerOverride?: ProviderId,
  ): Promise<void> {
    const settings = this.getRuntimeSettings();
    const provider = providerOverride ?? settings.provider;
    const startedAt = Date.now();

    try {
      if (provider === "ollama") {
        const response = await this.fetchWithTimeout(
          `${settings.ollamaBaseUrl.replace(/\/$/, "")}/api/tags`,
          {
            method: "GET",
            headers: {
              Accept: "application/json",
            },
          },
          4000,
        );

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
      } else {
        const headers: Record<string, string> = {
          Accept: "application/json",
        };

        if (settings.openAIApiKey.trim()) {
          headers.Authorization = `Bearer ${settings.openAIApiKey.trim()}`;
        }

        const response = await this.fetchWithTimeout(
          `${settings.openAIBaseUrl.replace(/\/$/, "")}/models`,
          {
            method: "GET",
            headers,
          },
          5000,
        );

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
      }

      this.postMessage({
        type: "providerStatus",
        value: {
          provider,
          connected: true,
          latencyMs: Date.now() - startedAt,
        },
      });
    } catch (error) {
      this.postMessage({
        type: "providerStatus",
        value: {
          provider,
          connected: false,
          latencyMs: Date.now() - startedAt,
          error: String(error),
        },
      });
    }
  }

  private async provideModelSuggestions(
    providerOverride?: ProviderId,
  ): Promise<void> {
    const settings = this.getRuntimeSettings();
    const provider = providerOverride ?? settings.provider;

    try {
      let models: string[] = [];

      if (provider === "ollama") {
        const response = await this.fetchWithTimeout(
          `${settings.ollamaBaseUrl.replace(/\/$/, "")}/api/tags`,
          {
            method: "GET",
            headers: {
              Accept: "application/json",
            },
          },
          5000,
        );

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const payload = (await response.json()) as {
          models?: Array<{ name?: string }>;
        };

        models = (payload.models ?? [])
          .map((model) => (typeof model.name === "string" ? model.name : ""))
          .filter((name) => name.length > 0);
      } else {
        const headers: Record<string, string> = {
          Accept: "application/json",
        };

        if (settings.openAIApiKey.trim()) {
          headers.Authorization = `Bearer ${settings.openAIApiKey.trim()}`;
        }

        const response = await this.fetchWithTimeout(
          `${settings.openAIBaseUrl.replace(/\/$/, "")}/models`,
          {
            method: "GET",
            headers,
          },
          6000,
        );

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const payload = (await response.json()) as {
          data?: Array<{ id?: string }>;
        };

        models = (payload.data ?? [])
          .map((model) => (typeof model.id === "string" ? model.id : ""))
          .filter((id) => id.length > 0);
      }

      const uniqueModels = [...new Set(models)].slice(0, 40);
      this.postMessage({
        type: "modelSuggestions",
        provider,
        models: uniqueModels,
      });
    } catch {
      this.postMessage({
        type: "modelSuggestions",
        provider,
        models: [],
      });
    }
  }

  private async fetchWithTimeout(
    input: string,
    init: RequestInit,
    timeoutMs: number,
  ): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      return await fetch(input, {
        ...init,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
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
  <title>Nexcode Kiboko</title>
</head>
<body>
  <div id="root"></div>

  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }

  public populateTabPanel(
    panel: vscode.WebviewPanel,
    context: vscode.ExtensionContext,
  ): void {
    panel.webview.html = this.getHtml(panel.webview);

    panel.webview.onDidReceiveMessage(
      (message: InboundWebviewMessage) => {
        void this.handleWebviewMessage(message);
      },
      undefined,
      context.subscriptions,
    );

    this.webviews.add(panel.webview);
    panel.onDidDispose(
      () => {
        this.webviews.delete(panel.webview);
      },
      undefined,
      context.subscriptions,
    );

    this.pushInitialWebviewState();
  }

  private pushInitialWebviewState(): void {
    this.postMessage({ type: "config", value: this.getRuntimeSettings() });
    this.postAttachments();
    void this.postMcpRegistryState();
    void this.refreshProviderStatus();
    void this.provideModelSuggestions();
  }

  private postMessage(message: unknown): void {
    if (this.webviews.size === 0) {
      return;
    }

    for (const webview of this.webviews) {
      webview.postMessage(message).then(undefined, () => {
        // Ignore postMessage race conditions during shutdown.
      });
    }
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
