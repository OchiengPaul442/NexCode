export type ChatRole = "system" | "user" | "assistant";

export type ProviderId = "ollama" | "openai-compatible";

export type AgentMode =
  | "auto"
  | "planner"
  | "coder"
  | "reviewer"
  | "qa"
  | "security";

export interface ChatMessage {
  role: ChatRole;
  content: string;
  images?: string[];
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
  workspaceRoot?: string;
  activeFilePath?: string;
  selectedText?: string;
  attachments?: RequestAttachment[];
  allowTools?: boolean;
  allowWebSearch?: boolean;
}

export interface OrchestratorResponse {
  text: string;
  modeUsed: AgentMode;
  providerUsed: ProviderId;
  modelUsed: string;
  proposedEdits: ProposedEdit[];
  diagnostics: string[];
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
    };

export interface ModelRequest {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
}

export interface ModelResponse {
  text: string;
  raw?: unknown;
}

export interface ProviderGenerateOptions {
  provider?: ProviderId;
  model?: string;
  temperature?: number;
  complexity?: "small" | "large";
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
