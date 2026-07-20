import path from "path";
import { randomBytes, randomUUID } from "crypto";
import * as vscode from "vscode";
import {
  AgentMode,
  createNexcodeOrchestrator,
  NexcodeOrchestrator,
  OrchestratorRequest,
  ProviderId,
  ReasoningEffort,
  RequestAttachment,
  Task,
  validateProviderUrl,
  validateWebviewMessage,
  validateOpenFilePath,
  isAllowedSettingKey,
} from "@nexcode/agent-core";
import { SecretService } from "./secretService";
import { WorkspaceTrustService } from "./workspaceTrustService";
import { TaskController } from "./taskController";
import { EditReviewService } from "./editReviewService";

interface WebviewSendPromptMessage {
  type: "sendPrompt";
  prompt: string;
  sessionId?: string;
  provider?: ProviderId;
  model?: string;
  mode?: AgentMode;
  temperature?: number;
  reasoningEffort?: ReasoningEffort;
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

interface WebviewOpenSettingsMessage {
  type: "openSettings";
}

interface WebviewOpenShortcutsMessage {
  type: "openShortcuts";
}

interface WebviewOpenDocsMessage {
  type: "openDocs";
}

interface WebviewUpdateSettingMessage {
  type: "updateSetting";
  key: string;
  value: unknown;
}

interface WebviewToolApprovalResponseMessage {
  type: "toolApprovalResponse";
  requestId: string;
  approved: boolean;
}

interface WebviewSteerTaskMessage {
  type: "steerTask";
  taskId: string;
  message: string;
}

interface WebviewCancelTaskMessage {
  type: "cancelTask";
  taskId: string;
}

interface WebviewListTasksMessage {
  type: "listTasks";
}

interface WebviewOpenFileMessage {
  type: "openFile";
  filePath: string;
  line?: number;
  column?: number;
}

interface WebviewTaskCompletedMessage {
  type: "taskCompleted";
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
  | WebviewOpenInTabMessage
  | WebviewOpenSettingsMessage
  | WebviewOpenShortcutsMessage
  | WebviewOpenDocsMessage
  | WebviewUpdateSettingMessage
  | WebviewSteerTaskMessage
  | WebviewCancelTaskMessage
  | WebviewListTasksMessage
  | WebviewToolApprovalResponseMessage
  | WebviewOpenFileMessage
  | WebviewTaskCompletedMessage;

const MAX_ATTACHMENT_BYTES = 3_000_000;
const MAX_ATTACHMENT_TEXT_CHARS = 750_000;
const MAX_ATTACHMENT_NAME_LENGTH = 160;

export class KibokoSidebarViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "nexcodeKiboko.sidebarView";

  private view?: vscode.WebviewView;
  private readonly webviews = new Set<vscode.Webview>();
  private orchestrator?: NexcodeOrchestrator;
  private currentWorkspaceRoot?: string;
  private readonly taskController: TaskController;
  private readonly editReviewService: EditReviewService;
  private readonly pendingApprovals = new Map<string, { resolve: (approved: boolean) => void; timer: ReturnType<typeof setTimeout> }>();

  public constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly secretService: SecretService,
    private readonly workspaceTrustService: WorkspaceTrustService,
  ) {
    this.taskController = new TaskController((msg) => this.postMessage(msg));
    this.editReviewService = new EditReviewService((msg) => this.postMessage(msg));
  }

  public resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;

    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.context.extensionUri, "media"),
      ],
    };

    view.webview.html = this.getHtml(view.webview);
    view.webview.onDidReceiveMessage((message: unknown) => {
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

  public async notifyConfigChanged(): Promise<void> {
    this.orchestrator = undefined;
    this.currentWorkspaceRoot = undefined;
    const settings = await this.getRuntimeSettings();
    // NC-023: Include workspace folder info on config refresh
    const workspaceFolders = this.getWorkspaceFolderInfos();
    const activeWorkspaceRoot = this.getWorkspaceRoot();
    this.postMessage({
      type: "config",
      value: {
        ...settings,
        workspaceFolders,
        activeWorkspaceRoot,
      },
    });
  }

  public clearConversation(): void {
    this.taskController.clear();
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

  /**
   * NC-002: Validate that a provider base URL is safe to receive credentials.
   * Delegates to the pure utility function in agent-core for testability.
   */
  private validateProviderUrl(rawUrl: string): string {
    return validateProviderUrl(rawUrl);
  }

  /**
   * NC-002: Check whether the current workspace is trusted enough to allow
   * authenticated provider probing to a custom (non-default) endpoint.
   */
  private canProbeProviderEndpoint(isCustomUrl: boolean): boolean {
    if (!isCustomUrl) {
      // Always allow probing the built-in default endpoint
      return true;
    }
    // Custom endpoints require workspace trust
    return this.workspaceTrustService.isWorkspaceTrusted();
  }

  private async handleWebviewMessage(
    message: unknown,
  ): Promise<void> {
    // NC-005: Runtime validation — reject messages that don't have a recognized
    // type discriminator and valid shape. The TypeScript type system only
    // provides compile-time guarantees; the webview can send arbitrary objects.
    const validation = validateWebviewMessage(message);
    if (!validation.valid) {
      console.warn(`[NexCode] Rejected invalid webview message: ${validation.error}`);
      return;
    }

    const msg = message as InboundWebviewMessage;
    switch (msg.type) {
      case "sendPrompt":
        await this.handlePrompt(msg);
        return;
      case "cancelPrompt":
        this.cancelPrompt();
        return;
      case "applyEdit":
        await this.applyProposedEdit(msg.editId);
        return;
      case "previewEdit":
        await this.previewProposedEdit(msg.editId);
        return;
      case "rejectEdit":
        this.rejectProposedEdit(msg.editId);
        return;
      case "clearConversation":
        this.clearConversation();
        return;
      case "taskCompleted":
        this.showCompletionNotification();
        return;
      case "refreshProviderStatus":
        await this.refreshProviderStatus(msg.provider);
        return;
      case "requestModelSuggestions":
        await this.provideModelSuggestions(msg.provider);
        return;
      case "enhancePrompt":
        await this.handleEnhancePrompt(msg);
        return;
      case "listMcpServers":
        await this.postMcpRegistryState();
        return;
      case "listMcpTools":
        await this.postMcpTools(msg.server);
        return;
      case "invokeMcpToolQuick":
        await this.invokeMcpToolQuick(msg);
        return;
      case "pickAttachments":
        await this.pickAttachments();
        return;
      case "openInTab":
        await vscode.commands.executeCommand("nexcodeKiboko.openInTab");
        return;
      case "openSettings":
        await vscode.commands.executeCommand(
          "workbench.action.openSettings",
          "nexcodeKiboko",
        );
        return;
      case "openShortcuts":
        await vscode.commands.executeCommand(
          "workbench.action.openGlobalKeybindings",
        );
        return;
      case "openDocs":
        await vscode.env.openExternal(
          vscode.Uri.parse(
            "https://github.com/OchiengPaul442/NexCode#readme",
          ),
        );
        return;
      case "openFile":
        await this.handleOpenFile(msg);
        return;
      case "updateSetting":
        if (msg.key && msg.value !== undefined) {
          const secretKeys = ["openAIApiKey", "searchApiKey", "tavilyApiKey"];
          if (secretKeys.includes(msg.key)) {
            await this.secretService.setSecret(
              msg.key as "openAIApiKey" | "searchApiKey" | "tavilyApiKey",
              String(msg.value),
            );
          } else {
            // NC-005: Setting key must be in the allowlist.
            // The webview must never be able to send an arbitrary configuration key.
            if (!isAllowedSettingKey(msg.key)) {
              console.warn(`[NexCode] Rejected disallowed setting key: ${msg.key}`);
              return;
            }
            // NC-002: Validate provider endpoint URLs before persisting.
            // Reject non-HTTPS, private-IP, and malformed URLs.
            if (msg.key === "openAIBaseUrl") {
              const validated = this.validateProviderUrl(
                String(msg.value),
              );
              if (validated !== String(msg.value).replace(/\/+$/, "")) {
                // URL failed validation — reject the update and notify
                this.postMessage({
                  type: "configError",
                  message:
                    "Provider URL rejected: must use HTTPS (or HTTP for localhost only). " +
                    "Private/internal IP addresses are not allowed.",
                });
                return;
              }
            }
            const config =
              vscode.workspace.getConfiguration("nexcodeKiboko");
            await config.update(
              msg.key,
              msg.value,
              vscode.ConfigurationTarget.Workspace,
            );
          }
          await this.notifyConfigChanged();
        }
        return;
      case "addAttachment":
        await this.addAttachmentFromWebview(msg);
        return;
      case "removeAttachment":
        this.taskController.removeAttachment(msg.attachmentId);
        this.taskController.postAttachments();
        return;
      case "steerTask":
        this.handleSteerTask(msg.taskId, msg.message);
        return;
      case "cancelTask":
        this.handleCancelTask(msg.taskId);
        return;
      case "listTasks":
        this.taskController.postTaskList();
        return;
      case "toolApprovalResponse":
        this.handleToolApprovalResponse(msg.requestId, msg.approved);
        return;
    }
  }

  private async handlePrompt(message: WebviewSendPromptMessage): Promise<void> {
    const prompt = message.prompt?.trim();
    if (!prompt) {
      return;
    }

    const taskManager = this.taskController.getTaskManager();
    const activeTasks = taskManager.getActiveTasks();
    const activeTask = activeTasks.length > 0 ? activeTasks[0] : undefined;
    const settings = await this.getRuntimeSettings();

    const result = taskManager.classifyAndRoute(
      activeTask?.id,
      prompt,
      message.sessionId ?? "default",
      {
        mode: message.mode ?? settings.mode,
        provider: message.provider ?? settings.provider,
        model: message.model ?? settings.model,
        temperature:
          typeof message.temperature === "number"
            ? message.temperature
            : settings.temperature,
        reasoningEffort: message.reasoningEffort,
        allowWebSearch:
          typeof message.allowWebSearch === "boolean"
            ? message.allowWebSearch
            : settings.allowWebSearch,
        attachmentIds: message.attachmentIds ?? [],
      },
    );

    if (result.action === "steer") {
      this.postMessage({
        type: "taskSteered",
        taskId: result.task.id,
        message: "Message injected into running task",
      });
      this.taskController.postTaskList();
      return;
    }

    this.postMessage({
      type: "taskQueued",
      task: {
        id: result.task.id,
        sessionId: result.task.sessionId,
        prompt: result.task.prompt,
        status: result.task.status,
        createdAt: result.task.createdAt,
      },
    });

    this.taskController.postTaskList();
    this.processNextTask();
  }

  private async processNextTask(): Promise<void> {
    const taskManager = this.taskController.getTaskManager();
    const nextTask = taskManager.getNextQueuedTask();
    if (!nextTask) {
      return;
    }

    const { task, request } = nextTask;
    const selectedAttachments = (request.attachments ?? []) as RequestAttachment[];
    const selectedAttachmentIds = selectedAttachments.map((a) => a.id);

    this.postMessage({
      type: "taskStarted",
      task: {
        id: task.id,
        sessionId: task.sessionId,
        prompt: task.prompt,
        status: task.status,
        startedAt: task.startedAt,
      },
    });

    try {
      const workspaceRoot = this.getWorkspaceRoot();
      const orchestrator = await this.getOrchestrator(workspaceRoot);
      const activeEditor = vscode.window.activeTextEditor;

      const fullRequest: OrchestratorRequest = {
        ...request,
        workspaceRoot,
        activeFilePath: activeEditor?.document.uri.fsPath,
        selectedText: activeEditor?.document.getText(activeEditor.selection),
        attachments: this.taskController.resolveAttachmentsForPrompt(selectedAttachmentIds),
        steeringProvider: () => this.taskController.getTaskManager().popSteeringMessage(task.id),
      };

      this.postMessage({
        type: "start",
        sessionId: task.sessionId,
        taskId: task.id,
        provider: fullRequest.provider,
        model: fullRequest.model,
        mode: fullRequest.mode,
      });

      for await (const event of orchestrator.stream(fullRequest)) {
        if (fullRequest.abortSignal?.aborted) {
          // Send stopped event so the webview clears "Working..." state
          this.postMessage({
            type: "stopped",
            taskId: task.id,
            message: "Request stopped by user.",
          });
          break;
        }

        if (event.type === "final") {
          for (const edit of event.response.proposedEdits) {
            this.taskController.addEdit(edit);
          }
          taskManager.completeTask(task.id, event.response.text);
        }

        this.postMessage({ ...event, taskId: task.id });
      }
    } catch (error) {
      const messageText = this.formatErrorForUi(error);
      taskManager.failTask(task.id, messageText);
    } finally {
      this.taskController.clearResolvedAttachments(selectedAttachmentIds);
      this.taskController.postAttachments();
      this.postMessage({ type: "end", taskId: task.id });
      this.taskController.postTaskList();
      this.processNextTask();
    }
  }

  private handleSteerTask(taskId: string, message: string): void {
    this.taskController.handleSteerTask(taskId, message);
  }

  private handleCancelTask(taskId: string): void {
    this.taskController.handleCancelTask(taskId);
  }

  private handleToolApprovalResponse(requestId: string, approved: boolean): void {
    const pending = this.pendingApprovals.get(requestId);
    if (pending) {
      clearTimeout(pending.timer);
      pending.resolve(approved);
      this.pendingApprovals.delete(requestId);
    }
  }

  private requestToolApproval(toolName: string, arg: string): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const requestId = `approval-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      const timer = setTimeout(() => {
        this.pendingApprovals.delete(requestId);
        resolve(false);
      }, 30000);

      this.pendingApprovals.set(requestId, { resolve, timer });

      this.postMessage({
        type: "toolApprovalRequired",
        requestId,
        toolName,
        command: arg,
      });
    });
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
    const orchestrator = await this.getOrchestrator(workspaceRoot);
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
    const orchestrator = await this.getOrchestrator(this.getWorkspaceRoot());
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

    const orchestrator = await this.getOrchestrator(this.getWorkspaceRoot());
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
      const orchestrator = await this.getOrchestrator(this.getWorkspaceRoot());
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
    const taskManager = this.taskController.getTaskManager();

    // Cancel all queued tasks
    const queuedTasks = taskManager.getQueuedTasks();
    for (const task of queuedTasks) {
      taskManager.cancelTask(task.id);
    }

    // Cancel all active tasks (each has its own abort controller)
    const activeTasks = taskManager.getActiveTasks();
    for (const task of activeTasks) {
      taskManager.cancelTask(task.id);
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
        this.taskController.addAttachment(attachment);
      } catch (error) {
        this.postMessage({
          type: "error",
          message: `Failed to attach ${path.basename(uri.fsPath)}: ${String(error)}`,
        });
      }
    }

    this.taskController.postAttachments();
  }

  private async addAttachmentFromWebview(
    message: WebviewAddAttachmentMessage,
  ): Promise<void> {
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

    let textContent = payload.textContent;
    let base64Data = payload.base64Data;

    if (
      payload.kind === "text" &&
      (!textContent || textContent.trim().length === 0) &&
      this.isTextLike(normalizedMimeType, sanitizedFileName)
    ) {
      // NC-023: Try all workspace folders to find the attachment file
      const folders = vscode.workspace.workspaceFolders ?? [];
      for (const folder of folders) {
        try {
          const filePath = path.join(folder.uri.fsPath, sanitizedFileName);
          const fileUri = vscode.Uri.file(filePath);
          const bytes = await vscode.workspace.fs.readFile(fileUri);
          textContent = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
          break; // Found in this workspace folder
        } catch {
          // File might not exist in this folder — try next
        }
      }
    }

    if (payload.kind === "text" && (!textContent || textContent.trim().length === 0)) {
      this.postMessage({
        type: "error",
        message: "Text attachments must include text content.",
      });
      return;
    }

    if (
      payload.kind !== "text" &&
      (!base64Data || base64Data.trim().length === 0)
    ) {
      this.postMessage({
        type: "error",
        message: "Binary or image attachments must include base64 data.",
      });
      return;
    }

    const normalizedTextContent = textContent
      ? textContent.slice(0, MAX_ATTACHMENT_TEXT_CHARS)
      : undefined;

    const attachment: RequestAttachment = {
      id,
      fileName: sanitizedFileName,
      mimeType: normalizedMimeType,
      kind: payload.kind,
      byteSize,
      textContent: normalizedTextContent,
      base64Data,
    };

    this.taskController.addAttachment(attachment);
    this.taskController.postAttachments();
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
      normalized.includes("invalid_request_error") ||
      normalized.includes("400")
    ) {
      return "The model could not process this request. Try a different model or simplify your prompt.";
    }
    if (
      normalized.includes("fetch failed") ||
      normalized.includes("econnrefused") ||
      normalized.includes("enotfound")
    ) {
      return "Could not reach the configured model provider endpoint.";
    }
    if (normalized.includes("401") || normalized.includes("unauthorized")) {
      return "Authentication failed. Check your API key in settings.";
    }
    if (normalized.includes("429") || normalized.includes("rate limit")) {
      return "Rate limit reached. Please wait a moment and try again.";
    }

    return raw.length > 300 ? `${raw.slice(0, 300)}...` : raw;
  }

  private async applyProposedEdit(editId: string): Promise<void> {
    const edit = this.taskController.getEdit(editId);
    if (!edit) {
      this.postMessage({
        type: "error",
        message: "Proposed edit not found.",
      });
      return;
    }

    // NC-023: Resolve workspace root from the edit's file path to support
    // multi-root workspaces. Each edit is associated with the workspace folder
    // that contains its target file, not always workspaceFolders[0].
    const editUri = vscode.Uri.file(path.join(this.getWorkspaceRoot(), edit.filePath));
    const folder = this.resolveWorkspaceFolder(editUri);
    const workspaceRoot = folder?.uri.fsPath ?? this.getWorkspaceRoot();
    const applied = await this.editReviewService.applyEdit(edit, workspaceRoot);
    if (applied) {
      this.taskController.removeEdit(editId);
    }
  }

  private async previewProposedEdit(editId: string): Promise<void> {
    const edit = this.taskController.getEdit(editId);
    if (!edit) {
      this.postMessage({
        type: "error",
        message: "Proposed edit not found.",
      });
      return;
    }

    // NC-023: Resolve workspace root from the edit's file path
    const editUri = vscode.Uri.file(path.join(this.getWorkspaceRoot(), edit.filePath));
    const folder = this.resolveWorkspaceFolder(editUri);
    const workspaceRoot = folder?.uri.fsPath ?? this.getWorkspaceRoot();
    await this.editReviewService.previewEdit(edit, workspaceRoot);
  }

  private rejectProposedEdit(editId: string): void {
    if (!this.taskController.getEdit(editId)) {
      this.postMessage({
        type: "error",
        message: "Proposed edit not found.",
      });
      return;
    }

    this.taskController.removeEdit(editId);
    this.editReviewService.rejectEdit(editId);
  }

  private async getOrchestrator(
    workspaceRoot: string,
  ): Promise<NexcodeOrchestrator> {
    if (!this.orchestrator || this.currentWorkspaceRoot !== workspaceRoot) {
      const settings = await this.getRuntimeSettings();
      const rawKeys = await this.getRawApiKeys();

      // NC-022: Workspace prompt overrides are only allowed when the user has
      // explicitly opted in AND the workspace is trusted.  A malicious
      // repository must not be able to inject arbitrary system instructions via
      // prompt files in the workspace directory.
      const config = vscode.workspace.getConfiguration("nexcodeKiboko");
      const userAllowsWorkspacePrompts = config.get<boolean>("allowWorkspacePrompts", false);
      const allowWorkspacePrompts = userAllowsWorkspacePrompts && this.workspaceTrustService.isWorkspaceTrusted();

      this.orchestrator = createNexcodeOrchestrator({
        workspaceRoot,
        promptsDir: path.join(workspaceRoot, "prompts"),
        memoryDir: path.join(this.context.globalStorageUri.fsPath, "memory"),
        defaultProvider: settings.provider,
        defaultModel: settings.model,
        ollamaBaseUrl: settings.ollamaBaseUrl,
        openAIBaseUrl: settings.openAIBaseUrl,
        openAIApiKey: rawKeys.openAIApiKey,
        searchProvider: settings.searchProvider,
        searchApiKey: rawKeys.searchApiKey,
        searchBaseUrl: settings.searchBaseUrl,
        tavilyApiKey: rawKeys.tavilyApiKey,
        modeTemperatures: settings.modeTemperatures as any,
        agentModels: settings.agentModels,
        allowWorkspacePrompts,
        approvalCallback: async (toolName: string, arg: string) => {
          // Check workspace trust first
          if (!this.workspaceTrustService.canRunTool(toolName)) {
            const reason = this.workspaceTrustService.getToolRestrictionReason(toolName);
            this.postMessage({
              type: "toolApprovalRequired",
              requestId: "",
              toolName,
              command: reason ?? `Tool "${toolName}" is restricted in untrusted workspaces.`,
            });
            return false;
          }

          // Read current settings each time (not captured in closure)
          const currentConfig = vscode.workspace.getConfiguration("nexcodeKiboko");
          // NC-008: 'bypass' has been removed from the enum. If a legacy value
          // persists (e.g. from an older workspace setting), fall back to 'ask'.
          const rawApproval = currentConfig.get<string>("toolApproval", "ask");
          const currentApproval: "auto" | "ask" = rawApproval === "auto" ? "auto" : "ask";

          if (currentApproval === "auto") {
            // NC-008: Use ONLY the policy's isAutoExecutable() as the source of truth.
            // The extension must NOT add its own fallback auto-approval overrides.
            const policy = this.orchestrator?.getToolApprovalPolicy?.();
            if (policy && policy.isAutoExecutable(toolName, arg)) {
              return true;
            }
          }

          // Ask mode (or auto mode for destructive tools): prompt the user
          return await this.requestToolApproval(toolName, arg);
        },
      });
      // NC-039: Perform async initialization after construction.
      // Memory loading is now explicit rather than a constructor side effect.
      await this.orchestrator.initialize();
      this.currentWorkspaceRoot = workspaceRoot;
    }

    return this.orchestrator;
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
    const lowered = fileName.toLowerCase();
    return (
      mimeType.startsWith("text/") ||
      lowered.endsWith(".md") ||
      lowered.endsWith(".json") ||
      lowered.endsWith(".yaml") ||
      lowered.endsWith(".yml") ||
      lowered.endsWith(".ts") ||
      lowered.endsWith(".tsx") ||
      lowered.endsWith(".js") ||
      lowered.endsWith(".jsx") ||
      lowered.endsWith(".py") ||
      lowered.endsWith(".csv") ||
      lowered.endsWith(".txt") ||
      lowered.endsWith(".xml") ||
      lowered.endsWith(".html") ||
      lowered.endsWith(".css") ||
      lowered.endsWith(".java") ||
      lowered.endsWith(".go") ||
      lowered.endsWith(".rs")
    );
  }

  /**
   * NC-023: Resolve the workspace folder that contains the given URI.
   * Falls back to the active editor's document, then to workspaceFolders[0],
   * then to globalStorageUri.
   */
  private resolveWorkspaceFolder(uri?: vscode.Uri): vscode.WorkspaceFolder | undefined {
    // 1. If a specific URI is provided, find its workspace folder
    if (uri) {
      const folder = vscode.workspace.getWorkspaceFolder(uri);
      if (folder) return folder;
    }

    // 2. Try the active editor's document
    const activeEditor = vscode.window.activeTextEditor;
    if (activeEditor) {
      const folder = vscode.workspace.getWorkspaceFolder(activeEditor.document.uri);
      if (folder) return folder;
    }

    // 3. Fall back to first workspace folder
    return vscode.workspace.workspaceFolders?.[0];
  }

  /**
   * NC-023: Get the workspace root path, resolving from the active editor
   * context when possible. In multi-root workspaces, this returns the folder
   * that contains the active editor's file rather than always workspaceFolders[0].
   */
  private getWorkspaceRoot(): string {
    const folder = this.resolveWorkspaceFolder();
    if (folder) {
      return folder.uri.fsPath;
    }

    return this.context.globalStorageUri.fsPath;
  }

  /**
   * NC-023: Get all workspace folders for the webview UI.
   * Returns folder name and URI path for each root in a multi-root workspace.
   */
  private getWorkspaceFolderInfos(): Array<{ name: string; uri: string; index: number }> {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) {
      return [];
    }
    return folders.map((f, i) => ({
      name: f.name,
      uri: f.uri.fsPath,
      index: i,
    }));
  }

  private async getRuntimeSettings(): Promise<{
    provider: ProviderId;
    model: string;
    mode: AgentMode;
    ollamaBaseUrl: string;
    openAIBaseUrl: string;
    openAIApiKeyConfigured: boolean;
    tavilyApiKeyConfigured: boolean;
    allowTools: boolean;
    requireTerminalApproval: boolean;
    toolApproval: "auto" | "ask";
    temperature: number;
    modeTemperatures: Record<string, number>;
    agentModels: { manager?: string; primaryWorker?: string; lightweightWorker?: string; reasoningReviewer?: string };
    showReasoning: boolean;
    autoApplyChanges: boolean;
    allowWebSearch: boolean;
    searchProvider: string;
    // NC-003: Boolean status only — never send raw secrets to the webview.
    searchApiKeyConfigured: boolean;
    searchBaseUrl: string;
  }> {
    const config = vscode.workspace.getConfiguration("nexcodeKiboko");
    const secrets = await this.secretService.getAllSecrets();

    return {
      provider: config.get<ProviderId>("defaultProvider", "ollama"),
      model: config.get<string>("defaultModel", "gpt-oss:120b-cloud"),
      mode: config.get<AgentMode>("defaultMode", "auto"),
      ollamaBaseUrl: this.normalizeOllamaBaseUrl(
        config.get<string>("ollamaBaseUrl", "http://localhost:11434"),
      ),
      // NC-002: Validate the provider URL at read time to prevent workspace
      // injection from .vscode/settings.json redirecting authenticated requests.
      openAIBaseUrl: this.validateProviderUrl(
        config.get<string>(
          "openAIBaseUrl",
          "https://opencode.ai/zen/go/v1",
        ),
      ),
      openAIApiKeyConfigured: !!secrets.openAIApiKey.trim(),
      tavilyApiKeyConfigured: !!secrets.tavilyApiKey.trim(),
      allowTools: config.get<boolean>("allowToolCommands", true),
      requireTerminalApproval: config.get<boolean>(
        "requireTerminalApproval",
        true,
      ),
      // NC-008: 'bypass' has been removed. Guard against legacy value.
      toolApproval: ((): "auto" | "ask" => {
        const raw = config.get<string>("toolApproval", "ask");
        return raw === "auto" ? "auto" : "ask";
      })(),
      temperature: config.get<number>("temperature", 0.2),
      modeTemperatures: config.get<Record<string, number>>(
        "modeTemperatures",
        { planner: 0.3, coder: 0.15, reviewer: 0.05, qa: 0.05, security: 0.1 },
      ),
      agentModels: {
        manager: config.get<string>("agentModels.manager", ""),
        primaryWorker: config.get<string>("agentModels.primaryWorker", ""),
        lightweightWorker: config.get<string>("agentModels.lightweightWorker", ""),
        reasoningReviewer: config.get<string>("agentModels.reasoningReviewer", ""),
      },
      showReasoning: config.get<boolean>("showReasoning", false),
      autoApplyChanges: config.get<boolean>("autoApplyChanges", false),
      allowWebSearch: config.get<boolean>("allowWebSearch", true),
      searchProvider: config.get<string>("searchProvider", "tavily"),
      // NC-003: Send boolean presence indicator, not the raw secret.
      searchApiKeyConfigured: !!secrets.searchApiKey.trim(),
      searchBaseUrl: config.get<string>("searchBaseUrl", ""),
    };
  }

  private async getRawApiKeys(): Promise<{
    openAIApiKey: string;
    searchApiKey: string;
    tavilyApiKey: string;
  }> {
    return this.secretService.getAllSecrets();
  }

  private async refreshProviderStatus(
    providerOverride?: ProviderId,
  ): Promise<void> {
    const settings = await this.getRuntimeSettings();
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
        // NC-002: Validate the provider URL before sending credentials.
        // Reject non-HTTPS, private-IP, and malformed URLs.
        const defaultBaseUrl = "https://opencode.ai/zen/go/v1";
        const validatedBaseUrl = this.validateProviderUrl(
          settings.openAIBaseUrl,
        );

        // NC-002: In untrusted workspaces, block probing to custom endpoints.
        const isCustomUrl = validatedBaseUrl !== defaultBaseUrl;
        if (!this.canProbeProviderEndpoint(isCustomUrl)) {
          this.postMessage({
            type: "providerStatus",
            value: {
              provider,
              connected: false,
              latencyMs: Date.now() - startedAt,
              error: "Custom provider endpoints are blocked in untrusted workspaces.",
            },
          });
          return;
        }

        const headers: Record<string, string> = {
          Accept: "application/json",
        };

        const rawKeys = await this.getRawApiKeys();
        if (rawKeys.openAIApiKey.trim()) {
          headers.Authorization = `Bearer ${rawKeys.openAIApiKey.trim()}`;
        }

        const response = await this.fetchWithTimeout(
          `${validatedBaseUrl}/models`,
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
    const settings = await this.getRuntimeSettings();
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
        // NC-002: Validate the provider URL before sending credentials.
        const defaultBaseUrl = "https://opencode.ai/zen/go/v1";
        const validatedBaseUrl = this.validateProviderUrl(
          settings.openAIBaseUrl,
        );

        // NC-002: In untrusted workspaces, block probing to custom endpoints.
        const isCustomUrl = validatedBaseUrl !== defaultBaseUrl;
        if (!this.canProbeProviderEndpoint(isCustomUrl)) {
          this.postMessage({
            type: "modelSuggestions",
            provider,
            models: [],
          });
          return;
        }

        const headers: Record<string, string> = {
          Accept: "application/json",
        };

        const rawKeys = await this.getRawApiKeys();
        if (rawKeys.openAIApiKey.trim()) {
          headers.Authorization = `Bearer ${rawKeys.openAIApiKey.trim()}`;
        }

        const response = await this.fetchWithTimeout(
          `${validatedBaseUrl}/models`,
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
<body style="margin:0;padding:0;">
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
      (message: unknown) => {
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

  private async pushInitialWebviewState(): Promise<void> {
    const settings = await this.getRuntimeSettings();
    // NC-023: Include workspace folder information so the webview can display
    // a multi-root workspace picker and associate operations with the correct root.
    const workspaceFolders = this.getWorkspaceFolderInfos();
    const activeWorkspaceRoot = this.getWorkspaceRoot();
    this.postMessage({
      type: "config",
      value: {
        ...settings,
        workspaceFolders,
        activeWorkspaceRoot,
      },
    });
    this.taskController.postAttachments();
    void this.postMcpRegistryState();
    // NC-002: Do NOT auto-probe provider status or model suggestions on sidebar
    // initialization. A workspace-controlled openAIBaseUrl could redirect an
    // authenticated request. Probing is now triggered only by explicit user action
    // (refreshProviderStatus / requestModelSuggestions messages from the webview).
  }

  private showCompletionNotification(): void {
    // Only show notification if the sidebar is not focused
    const activeEditor = vscode.window.activeTextEditor;
    const sidebarVisible = this.view?.visible ?? false;
    if (sidebarVisible && !activeEditor) {
      // Sidebar is focused, no need for notification
      return;
    }
    vscode.window.showInformationMessage("NexCode: Task completed.");
  }

  private async handleOpenFile(message: unknown): Promise<void> {
    const msg = message as { filePath?: string; line?: number; column?: number };
    const filePath = msg.filePath;
    if (!filePath) return;

    // NC-005 + NC-023: Validate that the file path is within any workspace folder.
    // In multi-root workspaces, check all folders, not just workspaceFolders[0].
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) {
      vscode.window.showErrorMessage(
        `NexCode: No workspace folder is open.`,
      );
      return;
    }

    let containedPath: string | null = null;
    for (const folder of folders) {
      const result = validateOpenFilePath(folder.uri.fsPath, filePath);
      if (result) {
        containedPath = result;
        break;
      }
    }

    if (!containedPath) {
      vscode.window.showErrorMessage(
        `NexCode: Cannot open file outside workspace: ${filePath}`,
      );
      return;
    }

    try {
      const uri = vscode.Uri.file(containedPath);
      const document = await vscode.workspace.openTextDocument(uri);
      const editor = await vscode.window.showTextDocument(document, {
        preserveFocus: true,
        preview: true,
      });

      if (typeof msg.line === "number" && msg.line > 0) {
        const line = Math.max(0, msg.line - 1);
        const col = Math.max(0, (msg.column ?? 1) - 1);
        editor.selection = new vscode.Selection(line, col, line, col);
        editor.revealRange(
          new vscode.Range(line, col, line, col),
          vscode.TextEditorRevealType.InCenter,
        );
      }
    } catch {
      vscode.window.showErrorMessage(`Could not open file: ${containedPath}`);
    }
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

  private createNonce(): string {
    return randomBytes(16).toString("base64");
  }
}
