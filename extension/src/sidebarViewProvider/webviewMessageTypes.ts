import {
  type AgentMode,
  type ProviderId,
  type ReasoningEffort,
  type RequestAttachment,
} from "@nexcode/agent-core";

export interface WebviewSendPromptMessage {
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

export interface WebviewCancelPromptMessage {
  type: "cancelPrompt";
}

export interface WebviewPickAttachmentsMessage {
  type: "pickAttachments";
}

export interface WebviewRemoveAttachmentMessage {
  type: "removeAttachment";
  attachmentId: string;
}

export interface WebviewAddAttachmentMessage {
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

export interface WebviewApplyEditMessage {
  type: "applyEdit";
  editId: string;
}

export interface WebviewPreviewEditMessage {
  type: "previewEdit";
  editId: string;
}

export interface WebviewRejectEditMessage {
  type: "rejectEdit";
  editId: string;
}

export interface WebviewClearMessage {
  type: "clearConversation";
}

export interface WebviewOpenInTabMessage {
  type: "openInTab";
}

export interface WebviewRefreshProviderStatusMessage {
  type: "refreshProviderStatus";
  provider?: ProviderId;
}

export interface WebviewRequestModelSuggestionsMessage {
  type: "requestModelSuggestions";
  provider?: ProviderId;
}

export interface WebviewEnhancePromptMessage {
  type: "enhancePrompt";
  sessionId?: string;
  prompt: string;
  provider?: ProviderId;
  model?: string;
  mode?: AgentMode;
  temperature?: number;
}

export interface WebviewListMcpServersMessage {
  type: "listMcpServers";
}

export interface WebviewListMcpToolsMessage {
  type: "listMcpTools";
  server: string;
}

export interface WebviewInvokeMcpToolQuickMessage {
  type: "invokeMcpToolQuick";
  server: string;
  tool: string;
  input?: string;
}

export interface WebviewOpenSettingsMessage {
  type: "openSettings";
}

export interface WebviewOpenShortcutsMessage {
  type: "openShortcuts";
}

export interface WebviewOpenDocsMessage {
  type: "openDocs";
}

export interface WebviewUpdateSettingMessage {
  type: "updateSetting";
  key: string;
  value: unknown;
}

export interface WebviewToolApprovalResponseMessage {
  type: "toolApprovalResponse";
  requestId: string;
  approved: boolean;
}

export interface WebviewSteerTaskMessage {
  type: "steerTask";
  taskId: string;
  message: string;
}

export interface WebviewCancelTaskMessage {
  type: "cancelTask";
  taskId: string;
}

export interface WebviewListTasksMessage {
  type: "listTasks";
}

export interface WebviewOpenFileMessage {
  type: "openFile";
  filePath: string;
  line?: number;
  column?: number;
}

export interface WebviewTaskCompletedMessage {
  type: "taskCompleted";
}

export type InboundWebviewMessage =
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

export const MAX_ATTACHMENT_BYTES = 3_000_000;
export const MAX_ATTACHMENT_TEXT_CHARS = 750_000;
export const MAX_ATTACHMENT_NAME_LENGTH = 160;
