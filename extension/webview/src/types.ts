// ── Webview Type Definitions ────────────────────────────────────────────────
// Extracted from main.tsx for NC-036: monolithic file splitting.
// Shared types are imported from agent-core to avoid duplication.

import type {
  ProviderId,
  AgentMode,
  ReasoningEffort,
  ActivityStatus,
  ActivityTodo,
} from "@nexcode/agent-core";

export type { ProviderId, AgentMode, ReasoningEffort, ActivityStatus, ActivityTodo };
export type UiMode = "agent" | "plan" | "ask";
export type PermissionLevel = "default" | "bypass" | "autopilot";
export type EditStatus = "pending" | "applied" | "rejected";

export interface ProviderStatus {
  provider: ProviderId;
  connected: boolean;
  latencyMs?: number;
  error?: string;
}

export interface ProposedEdit {
  id: string;
  filePath: string;
  summary: string;
  patch: string;
  oldText: string;
  newText: string;
  status: EditStatus;
  statusLabel?: string;
}

export interface ActivityFile {
  path: string;
  status: ActivityStatus;
  summary?: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  createdAt: number;
  attachments?: Array<{
    id: string;
    fileName: string;
    kind: string;
    textContent?: string;
  }>;
  provider?: ProviderId;
  model?: string;
  mode?: AgentMode;
  streaming?: boolean;
  thinking?: boolean;
  error?: boolean;
  stopped?: boolean;
  startTime?: number;
  endTime?: number;
  tokenUsage?: { input: number; output: number; total: number };
  reasoning: string[];
  debug: string[];
  proposedEdits: ProposedEdit[];
  activityTodos: ActivityTodo[];
  activityFiles: ActivityFile[];
  activityNote?: string;
  toolExecutions?: ToolExecution[];
  efficiency?: {
    tokensPerRequest: number;
    tokensPerFileEdit: number;
    cacheHitRate: number;
    compressionRatio: number;
    parallelSpeedup: number;
    contextUtilization: number;
  };
}

export interface ToolExecution {
  toolName: string;
  command: string;
  status: "success" | "error" | "awaiting-approval";
  message?: string;
  timestamp: number;
  durationMs?: number;
  filesChanged?: string[];
  sources?: Array<{ title: string; url: string; snippet?: string }>;
}

export interface QueuedPrompt {
  id: string;
  sessionId: string;
  rawPrompt: string;
  prompt: string;
  provider: ProviderId;
  model: string;
  mode: AgentMode;
  temperature: number;
  reasoningEffort?: ReasoningEffort;
  allowWebSearch: boolean;
  attachmentIds: string[];
}

export interface Session {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  provider: ProviderId;
  model: string;
  mode: UiMode;
  reasoningEffort?: ReasoningEffort;
  messages: ChatMessage[];
}

export interface AttachmentChip {
  id: string;
  fileName: string;
  kind: "text" | "image" | "binary";
  mimeType: string;
  byteSize?: number;
}

export interface SubAgentTask {
  id: string;
  description: string;
  status: "running" | "completed" | "failed";
  result?: string;
}

export interface QueuedTask {
  id: string;
  sessionId: string;
  prompt: string;
  status: "queued" | "planning" | "running" | "waiting-for-user" | "verifying" | "completed" | "failed" | "cancelled";
  mode?: string;
  provider?: string;
  model?: string;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  result?: string;
  error?: string;
  activityNote?: string;
}

export interface McpQuickResult {
  ok: boolean;
  server: string;
  tool: string;
  output: string;
  latencyMs: number;
}

export interface ToolbarSelectOption {
  value: string;
  label: string;
  description?: string;
  meta?: { inputs: string[]; reasoning: boolean; context: string };
}

export type SearchProviderId = "tavily" | "serpapi" | "serper" | "bing" | "duckduckgo" | "custom";

export interface SidebarSettings {
  provider?: ProviderId;
  model?: string;
  autoApprove: boolean;
  temperature: number;
  autoApplyChanges: boolean;
  requireTerminalApproval: boolean;
  showDebugPanel: boolean;
  enableWebSearch: boolean;
  permissionLevel: PermissionLevel;
  openAIBaseUrl?: string;
  ollamaBaseUrl?: string;
  searchProvider?: SearchProviderId;
  searchBaseUrl?: string;
  // NC-003: Boolean status flags only — never store actual secret values.
  // openAIApiKeyConfigured indicates whether a key is stored in SecretStorage.
  openAIApiKeyConfigured?: boolean;
  searchApiKeyConfigured?: boolean;
}

export interface PersistedState {
  sessions: Session[];
  activeSessionId: string | null;
  drafts: Record<string, string>;
  settings: SidebarSettings;
}

export interface BackendConfig {
  provider: ProviderId;
  model: string;
  mode: AgentMode;
  requireTerminalApproval: boolean;
  temperature: number;
  autoApplyChanges: boolean;
  allowWebSearch: boolean;
  // NC-003: Boolean status flags — extension sends presence, not secrets.
  openAIApiKeyConfigured?: boolean;
  tavilyApiKeyConfigured?: boolean;
  searchApiKeyConfigured?: boolean;
  // NC-023: Multi-root workspace folder information.
  workspaceFolders?: Array<{ name: string; uri: string; index: number }>;
  activeWorkspaceRoot?: string;
}

export interface StoreState {
  sessions: Session[];
  activeSessionId: string | null;
  drafts: Record<string, string>;
  attachments: AttachmentChip[];
  isBusy: boolean;
  settingsPanelOpen: boolean;
  backgroundAgents: SubAgentTask[];
  waveInfo: { current: number; total: number } | null;
  taskQueue: QueuedTask[];
  taskQueuePendingCount: number;
  taskQueueActiveCount: number;
  defaults: {
    provider: ProviderId;
    model: string;
    mode: UiMode;
  };
  settings: SidebarSettings;
  providerStatus: Record<ProviderId, ProviderStatus | undefined>;
  modelSuggestions: Record<ProviderId, string[]>;
  // NC-023: Multi-root workspace folder state
  workspaceFolders: Array<{ name: string; uri: string; index: number }>;
  activeWorkspaceRoot: string;
  hydrateConfig: (config: BackendConfig) => void;
  setBusy: (value: boolean) => void;
  setTaskQueue: (tasks: QueuedTask[], pending: number, active: number) => void;
  clearTaskQueue: () => void;
  updateTaskStatus: (taskId: string, status: QueuedTask["status"], note?: string) => void;
  setAttachments: (attachments: AttachmentChip[]) => void;
  setSettingsPanelOpen: (open: boolean) => void;
  setSettings: (update: Partial<SidebarSettings>) => void;
  updateSetting: (key: keyof SidebarSettings, value: unknown) => void;
  // NC-003: Write-only secret sender — posts to extension, never stores in state.
  sendSecret: (key: "openAIApiKey" | "searchApiKey" | "tavilyApiKey", value: string) => void;
  newSession: () => void;
  deleteSession: (sessionId: string) => void;
  setActiveSession: (sessionId: string) => void;
  updateActiveSession: (
    update: Partial<Pick<Session, "provider" | "model" | "mode" | "reasoningEffort">>,
  ) => void;
  clearActiveSession: () => void;
  addUserMessageToSession: (
    sessionId: string,
    text: string,
    attachments?: Array<{
      id: string;
      fileName: string;
      kind: string;
      textContent?: string;
    }>,
  ) => void;
  beginAssistantMessage: (
    sessionId: string,
    meta?: {
      provider?: ProviderId;
      model?: string;
      mode?: AgentMode;
    },
  ) => { sessionId: string; messageId: string } | null;
  appendAssistantToken: (
    sessionId: string,
    messageId: string,
    token: string,
  ) => void;
  updateAssistantTrace: (
    sessionId: string,
    messageId: string,
    reasoning: string[],
    debug: string[],
  ) => void;
  updateAssistantActivity: (
    sessionId: string,
    messageId: string,
    todos: ActivityTodo[],
    files: ActivityFile[],
    note?: string,
  ) => void;
  addToolExecution: (
    sessionId: string,
    messageId: string,
    execution: ToolExecution,
  ) => void;
  updateToolExecutionStatus: (
    sessionId: string,
    messageId: string,
    toolName: string,
    pendingArg: string,
    status: "success" | "error",
    message?: string,
  ) => void;
  finalizeAssistantMessage: (
    sessionId: string,
    messageId: string,
    text: string,
    reasoning: string[],
    debug: string[],
    edits: ProposedEdit[],
    tokenUsage?: { input: number; output: number; total: number },
    efficiency?: {
      tokensPerRequest: number;
      tokensPerFileEdit: number;
      cacheHitRate: number;
      compressionRatio: number;
      parallelSpeedup: number;
      contextUtilization: number;
    },
  ) => void;
  stopAssistantMessage: (
    sessionId: string,
    messageId: string,
    messageText: string,
  ) => void;
  failAssistantMessage: (
    sessionId: string,
    messageId: string,
    errorText: string,
  ) => void;
  updateEditStatus: (
    editId: string,
    status: EditStatus,
    label?: string,
  ) => void;
  setProviderStatus: (status: ProviderStatus) => void;
  setModelSuggestions: (provider: ProviderId, models: string[]) => void;
  setDraft: (sessionId: string, value: string) => void;
  addBackgroundAgent: (agent: SubAgentTask) => void;
  updateBackgroundAgent: (id: string, updates: Partial<SubAgentTask>) => void;
  removeBackgroundAgent: (id: string) => void;
  setWaveInfo: (waveInfo: { current: number; total: number } | null) => void;
  parallelCount: number;
  incrementParallel: () => void;
  decrementParallel: () => void;
  resetParallel: () => void;
}

export interface BackendEvent {
  type: string;
  [key: string]: unknown;
}

export interface ModelEffortInfo {
  supportsEffort: boolean;
  levels: ReasoningEffort[];
  default: ReasoningEffort;
}
