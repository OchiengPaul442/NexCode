export type ChatRole = "system" | "user" | "assistant" | "tool";

export type ProviderId = "ollama" | "openai-compatible";

export type AgentMode =
  | "auto"
  | "planner"
  | "coder"
  | "reviewer"
  | "qa"
  | "security";

export type ReasoningEffort = "none" | "low" | "medium" | "high" | "max";

export interface ToolCallRequestTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface ToolCallRequestFunction {
  name: string;
  arguments: string;
}

export interface ToolCallRequest {
  id: string;
  type: "function";
  function: ToolCallRequestFunction;
}

export interface ChatMessage {
  role: ChatRole;
  content: string;
  images?: string[];
  attachmentFileNames?: string[];
  tool_calls?: ToolCallRequest[];
  tool_call_id?: string;
}

export type AttachmentKind = "text" | "image" | "binary";

export interface RequestAttachment {
  id: string;
  fileName: string;
  mimeType: string;
  kind: AttachmentKind;
  textContent?: string;
  base64Data?: string;
  byteSize?: number;
}

export interface ToolCall {
  tool: "filesystem" | "terminal" | "git" | "test" | "search" | "web-search";
  input: string;
}

export interface ProposedEdit {
  id: string;
  filePath: string;
  summary: string;
  oldText: string;
  newText: string;
  patch: string;
}

export interface OrchestratorRequest {
  prompt: string;
  provider?: ProviderId;
  model?: string;
  mode?: AgentMode;
  temperature?: number;
  reasoningEffort?: ReasoningEffort;
  workspaceRoot?: string;
  activeFilePath?: string;
  selectedText?: string;
  attachments?: RequestAttachment[];
  allowTools?: boolean;
  allowWebSearch?: boolean;
  abortSignal?: AbortSignal;
  steeringProvider?: () => string | undefined;
}

export interface EfficiencyMetrics {
  tokensPerRequest: number;
  tokensPerFileEdit: number;
  cacheHitRate: number;
  compressionRatio: number;
  parallelSpeedup: number;
  contextUtilization: number;
}

export interface OrchestratorResponse {
  text: string;
  modeUsed: AgentMode;
  providerUsed: ProviderId;
  modelUsed: string;
  proposedEdits: ProposedEdit[];
  diagnostics: string[];
  efficiency?: EfficiencyMetrics;
  tokenUsage?: {
    input: number;
    output: number;
    total: number;
  };
  turnTokenUsage?: {
    input: number;
    output: number;
    total: number;
    requests: number;
  };
}

export type ActivityStatus =
  | "pending"
  | "not-started"
  | "in-progress"
  | "completed"
  | "failed"
  | "viewed"
  | "modified";

export interface ActivityTodo {
  id: string;
  title: string;
  status: ActivityStatus;
  detail?: string;
}

export interface ActivityFile {
  path: string;
  action?: string;
  summary?: string;
  status: ActivityStatus;
}

export type OrchestratorEvent =
  | {
      type: "status";
      message: string;
    }
  | {
      type: "token";
      token: string;
    }
  | {
      type: "final";
      response: OrchestratorResponse;
    }
  | {
      type: "error";
      message: string;
    }
  | {
      type: "stopped";
      message: string;
    }
  | {
      type: "activity";
      todos?: ActivityTodo[];
      files?: ActivityFile[];
      note?: string;
    }
  | {
      type: "toolApprovalRequired";
      toolName: string;
      pendingArg: string;
    }
  | {
      type: "subagentSpawned";
      taskId: string;
      description: string;
    }
  | {
      type: "subagentCompleted";
      taskId: string;
      result: string;
    }
  | {
      type: "toolExecuted";
      toolName: string;
      command: string;
      status: "success" | "error" | "awaiting-approval";
      message?: string;
      durationMs?: number;
      filesChanged?: string[];
    }
  | {
      type: "batchEditStarted";
      editCount: number;
    }
  | {
      type: "batchEditCompleted";
      editCount: number;
      successCount: number;
    };

export interface ModelRequest {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
  tools?: ToolCallRequestTool[];
  reasoningEffort?: ReasoningEffort;
}

export interface ModelResponse {
  text: string;
  toolCalls?: ToolCallRequest[];
  raw?: unknown;
}

export interface ProviderGenerateOptions {
  provider?: ProviderId;
  model?: string;
  temperature?: number;
  complexity?: "small" | "large";
  maxTokens?: number;
  signal?: AbortSignal;
  tools?: ToolCallRequestTool[];
  reasoningEffort?: ReasoningEffort;
}

export interface ModelProvider {
  readonly id: ProviderId;
  generate(request: ModelRequest): Promise<ModelResponse>;
  stream?(request: ModelRequest): AsyncGenerator<string>;
}

export interface AgentResult {
  agent: AgentMode;
  content: string;
}

export interface ToolResult {
  ok: boolean;
  output: string;
  requiresApproval?: boolean;
  toolName?: string;
  pendingArg?: string;
}

export interface InteractionFeedback {
  timestamp: string;
  prompt: string;
  response: string;
  score: number;
  acceptedEdits: number;
  rejectedEdits: number;
  metadata?: Record<string, unknown>;
}

export type TaskStatus =
  | "queued"
  | "planning"
  | "running"
  | "waiting-for-user"
  | "verifying"
  | "completed"
  | "failed"
  | "cancelled";

export interface Task {
  id: string;
  sessionId: string;
  prompt: string;
  status: TaskStatus;
  mode: AgentMode;
  provider: ProviderId;
  model: string;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  abortController?: AbortController;
  steeringMessages: string[];
  attachments?: RequestAttachment[];
  result?: string;
  error?: string;
  activityNote?: string;
}

export interface TaskQueueItem {
  taskId: string;
  prompt: string;
  sessionId: string;
  provider: ProviderId;
  model: string;
  mode: AgentMode;
  temperature: number;
  reasoningEffort?: ReasoningEffort;
  allowWebSearch: boolean;
  attachmentIds: string[];
  createdAt: number;
}

export type TaskEvent =
  | { type: "taskQueued"; task: Task }
  | { type: "taskStarted"; task: Task }
  | { type: "taskSteered"; taskId: string; message: string }
  | { type: "taskStatusChanged"; taskId: string; status: TaskStatus; note?: string }
  | { type: "taskCompleted"; taskId: string; result: string }
  | { type: "taskFailed"; taskId: string; error: string }
  | { type: "taskCancelled"; taskId: string }
  | { type: "queueChanged"; pendingCount: number; activeCount: number };
