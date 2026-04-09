import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
  useCallback,
} from "react";
import { createRoot } from "react-dom/client";
import { AnimatePresence, motion } from "framer-motion";
import { create } from "zustand";
import {
  MessageSquarePlus,
  PanelLeft,
  Settings,
  Plus,
  RefreshCw,
  Trash2,
  X,
  ChevronDown,
  ExternalLink,
  CheckCircle2,
  ChevronRight,
  FileText,
  Image,
  File,
  Eraser,
  ArrowUp,
  ArrowDown,
  Cpu,
  Zap,
  Globe,
  Code2,
  GitBranch,
  Search,
  Terminal,
  Copy,
  Check,
  Square,
  Pencil,
  RotateCcw,
  Sparkles,
  ListTodo,
} from "lucide-react";
import { StreamingMessage } from "./components/StreamingMessage";

declare const acquireVsCodeApi: <T = unknown>() => {
  postMessage: (message: unknown) => void;
  setState: (state: T) => void;
  getState: () => T | undefined;
};

type ProviderId = "ollama" | "openai-compatible";
type AgentMode = "auto" | "planner" | "coder" | "reviewer" | "qa" | "security";
type UiMode = "agent" | "plan" | "ask";
type PermissionLevel = "default" | "bypass" | "autopilot";
type EditStatus = "pending" | "applied" | "rejected";
type ActivityStatus =
  | "pending"
  | "not-started"
  | "in-progress"
  | "completed"
  | "failed"
  | "viewed"
  | "modified";

interface ProviderStatus {
  provider: ProviderId;
  connected: boolean;
  latencyMs?: number;
  error?: string;
}

interface ProposedEdit {
  id: string;
  filePath: string;
  summary: string;
  patch: string;
  oldText: string;
  newText: string;
  status: EditStatus;
  statusLabel?: string;
}

interface ActivityTodo {
  id: string;
  title: string;
  status: ActivityStatus;
  detail?: string;
}

interface ActivityFile {
  path: string;
  status: ActivityStatus;
  summary?: string;
}

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  createdAt: number;
  provider?: ProviderId;
  model?: string;
  mode?: AgentMode;
  streaming?: boolean;
  thinking?: boolean;
  error?: boolean;
  stopped?: boolean;
  reasoning: string[];
  debug: string[];
  proposedEdits: ProposedEdit[];
  activityTodos: ActivityTodo[];
  activityFiles: ActivityFile[];
  activityNote?: string;
}

interface QueuedPrompt {
  id: string;
  sessionId: string;
  rawPrompt: string;
  prompt: string;
  provider: ProviderId;
  model: string;
  mode: AgentMode;
  temperature: number;
  allowWebSearch: boolean;
  attachmentIds: string[];
}

interface Session {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  provider: ProviderId;
  model: string;
  mode: UiMode;
  messages: ChatMessage[];
}

interface AttachmentChip {
  id: string;
  fileName: string;
  kind: "text" | "image" | "binary";
  mimeType: string;
  byteSize?: number;
}

interface McpQuickResult {
  ok: boolean;
  server: string;
  tool: string;
  output: string;
  latencyMs: number;
}

interface SidebarSettings {
  temperature: number;
  showReasoning: boolean;
  autoApplyChanges: boolean;
  requireTerminalApproval: boolean;
  showDebugPanel: boolean;
  enableWebSearch: boolean;
  permissionLevel: PermissionLevel;
}

interface PersistedState {
  sessions: Session[];
  activeSessionId: string | null;
  drafts: Record<string, string>;
  settings: SidebarSettings;
}

interface BackendConfig {
  provider: ProviderId;
  model: string;
  mode: AgentMode;
  requireTerminalApproval: boolean;
  temperature: number;
  showReasoning: boolean;
  autoApplyChanges: boolean;
  allowWebSearch: boolean;
}

interface StoreState {
  sessions: Session[];
  activeSessionId: string | null;
  drafts: Record<string, string>;
  attachments: AttachmentChip[];
  isBusy: boolean;
  settingsPanelOpen: boolean;
  defaults: {
    provider: ProviderId;
    model: string;
    mode: UiMode;
  };
  settings: SidebarSettings;
  providerStatus: Record<ProviderId, ProviderStatus | undefined>;
  modelSuggestions: Record<ProviderId, string[]>;
  hydrateConfig: (config: BackendConfig) => void;
  setBusy: (value: boolean) => void;
  setAttachments: (attachments: AttachmentChip[]) => void;
  setSettingsPanelOpen: (open: boolean) => void;
  setSettings: (update: Partial<SidebarSettings>) => void;
  newSession: () => void;
  deleteSession: (sessionId: string) => void;
  setActiveSession: (sessionId: string) => void;
  updateActiveSession: (
    update: Partial<Pick<Session, "provider" | "model" | "mode">>,
  ) => void;
  clearActiveSession: () => void;
  addUserMessageToSession: (sessionId: string, text: string) => void;
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
  finalizeAssistantMessage: (
    sessionId: string,
    messageId: string,
    text: string,
    reasoning: string[],
    debug: string[],
    edits: ProposedEdit[],
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
}

interface BackendEvent {
  type: string;
  [key: string]: unknown;
}

const vscode = acquireVsCodeApi<PersistedState>();

function normalizePersistedState(
  state: PersistedState | undefined,
): PersistedState | undefined {
  if (!state) {
    return undefined;
  }

  const sessions = (state.sessions ?? [])
    .map((session) => ({
      ...session,
      messages: (session.messages ?? [])
        .filter(
          (message) =>
            !(
              message.role === "assistant" &&
              !String(message.text ?? "").trim() &&
              (message.proposedEdits ?? []).length === 0
            ),
        )
        .map((message) => ({
          ...message,
          streaming: false,
          thinking: false,
          activityTodos: message.activityTodos ?? [],
          activityFiles: message.activityFiles ?? [],
          activityNote: message.activityNote,
        })),
    }))
    .filter((session) => session.messages.length > 0 || session.title.trim());

  if (sessions.length === 0) {
    return {
      ...state,
      sessions: [],
      activeSessionId: null,
      drafts: {},
    };
  }

  const activeSessionExists = sessions.some(
    (session) => session.id === state.activeSessionId,
  );

  return {
    ...state,
    sessions,
    activeSessionId: activeSessionExists
      ? state.activeSessionId
      : sessions[0].id,
    drafts: Object.fromEntries(
      Object.entries(state.drafts ?? {}).filter(([sessionId]) =>
        sessions.some((session) => session.id === sessionId),
      ),
    ),
  };
}

const persisted = normalizePersistedState(vscode.getState());

function makeId(prefix: string): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return `${prefix}-${crypto.randomUUID()}`;
  }

  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

function titleFromPrompt(prompt: string): string {
  const clean = prompt.replace(/\s+/g, " ").trim();
  if (!clean) {
    return "New Chat";
  }

  return clean.length > 52 ? `${clean.slice(0, 52)}...` : clean;
}

function mapAgentModeToUi(mode: AgentMode): UiMode {
  switch (mode) {
    case "planner":
      return "plan";
    case "coder":
    case "reviewer":
    case "qa":
    case "security":
      return "agent";
    default:
      return "agent";
  }
}

function mapUiModeToAgent(mode: UiMode): AgentMode {
  switch (mode) {
    case "agent":
      return "auto";
    case "plan":
      return "planner";
    case "ask":
      return "coder";
    default:
      return "auto";
  }
}

function createSession(defaults: {
  provider: ProviderId;
  model: string;
  mode: UiMode;
}): Session {
  const now = Date.now();
  return {
    id: makeId("session"),
    title: "New Chat",
    createdAt: now,
    updatedAt: now,
    provider: defaults.provider,
    model: defaults.model,
    mode: defaults.mode,
    messages: [],
  };
}

function sanitizeReasoningStatus(raw: string): string {
  const clean = raw.replace(/\s+/g, " ").trim();
  if (!clean) {
    return "";
  }

  const modeMeta = clean.match(
    /^mode:\s*([^|]+)\|\s*provider:\s*([^|]+)\|\s*model:\s*(.+)$/i,
  );
  if (modeMeta) {
    const [, mode, provider, model] = modeMeta;
    return `Using ${model.trim()} on ${provider.trim()} (${mode.trim()} mode)`;
  }

  return clean;
}

function formatAgentMode(mode?: AgentMode): string {
  switch (mode) {
    case "planner":
      return "Planner";
    case "coder":
      return "Coder";
    case "reviewer":
      return "Reviewer";
    case "qa":
      return "QA";
    case "security":
      return "Security";
    case "auto":
      return "Auto";
    default:
      return "Agent";
  }
}

function formatRelativeTime(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) {
    return "just now";
  }

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }

  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function extractCommandTokens(value: string): string[] {
  const matches = value.match(/(?:^|\s)([#/][a-z][\w:-]*)/gi) ?? [];
  const normalized = matches
    .map((match) => match.trim())
    .filter((token) => token.length > 1);
  return [...new Set(normalized)].slice(0, 8);
}

function isRunningActivityStatus(status: ActivityStatus): boolean {
  return status === "in-progress" || status === "pending";
}

function activityStatusLabel(status: ActivityStatus): string {
  switch (status) {
    case "pending":
      return "Pending";
    case "not-started":
      return "Queued";
    case "in-progress":
      return "Running";
    case "completed":
      return "Done";
    case "failed":
      return "Failed";
    case "viewed":
      return "Viewed";
    case "modified":
      return "Changed";
    default:
      return "Status";
  }
}

function activityStatusClass(status: ActivityStatus): string {
  switch (status) {
    case "pending":
      return "nk-activity-status--not-started";
    case "in-progress":
      return "nk-activity-status--in-progress";
    case "completed":
      return "nk-activity-status--completed";
    case "failed":
      return "nk-activity-status--failed";
    case "viewed":
      return "nk-activity-status--viewed";
    case "modified":
      return "nk-activity-status--modified";
    default:
      return "nk-activity-status--not-started";
  }
}

function ActivityPanel({
  todos,
  files,
  note,
}: {
  todos: ActivityTodo[];
  files: ActivityFile[];
  note?: string;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [runningOnly, setRunningOnly] = useState(false);

  const totalItems = todos.length + files.length;
  const runningCount =
    todos.filter((todo) => isRunningActivityStatus(todo.status)).length +
    files.filter((file) => isRunningActivityStatus(file.status)).length;

  const visibleTodos = runningOnly
    ? todos.filter((todo) => isRunningActivityStatus(todo.status))
    : todos;
  const visibleFiles = runningOnly
    ? files.filter((file) => isRunningActivityStatus(file.status))
    : files;

  if (totalItems === 0) {
    return null;
  }

  return (
    <div className="nk-activity-panel">
      <div className="nk-activity-panel-head">
        <div className="nk-activity-head-label">
          <ListTodo size={10} />
          <span>Live activity</span>
        </div>
        <div className="nk-activity-head-controls">
          <div className="nk-activity-filter-group">
            <button
              className={`nk-activity-toggle ${!runningOnly ? "nk-activity-toggle--active" : ""}`}
              onClick={() => setRunningOnly(false)}
              type="button"
            >
              All
            </button>
            <button
              className={`nk-activity-toggle ${runningOnly ? "nk-activity-toggle--active" : ""}`}
              onClick={() => setRunningOnly(true)}
              type="button"
            >
              Running
            </button>
          </div>
          <button
            className="nk-activity-collapse-btn"
            onClick={() => setCollapsed((value) => !value)}
            type="button"
          >
            {collapsed ? "Expand" : "Collapse"}
          </button>
        </div>
      </div>

      {note && <div className="nk-activity-note">{note}</div>}

      {collapsed ? (
        <div className="nk-activity-collapsed">
          {runningCount} running • {totalItems} total
        </div>
      ) : (
        <>
          {visibleTodos.length > 0 && (
            <ul className="nk-activity-todos">
              {visibleTodos.slice(0, 8).map((todo) => (
                <li key={todo.id} className="nk-activity-item">
                  <span
                    className={`nk-activity-status-dot ${activityStatusClass(todo.status)}`}
                  />
                  <div className="nk-activity-item-content">
                    <div className="nk-activity-item-title">{todo.title}</div>
                    {todo.detail && (
                      <div className="nk-activity-item-detail">
                        {todo.detail}
                      </div>
                    )}
                  </div>
                  <span className="nk-activity-badge">
                    {activityStatusLabel(todo.status)}
                  </span>
                </li>
              ))}
            </ul>
          )}

          {visibleFiles.length > 0 && (
            <ul className="nk-activity-files">
              {visibleFiles.slice(0, 6).map((file, index) => (
                <li
                  key={`${file.path}-${index}`}
                  className="nk-activity-file-item"
                  title={file.summary ?? file.path}
                >
                  <FileText size={10} className="shrink-0" />
                  <span className="nk-activity-file-path">{file.path}</span>
                  <span
                    className={`nk-activity-file-badge ${activityStatusClass(file.status)}`}
                  >
                    {activityStatusLabel(file.status)}
                  </span>
                </li>
              ))}
            </ul>
          )}

          {visibleTodos.length === 0 && visibleFiles.length === 0 && (
            <div className="nk-activity-empty">No running tasks right now.</div>
          )}
        </>
      )}
    </div>
  );
}

function estimateAttachmentKind(file: File): "text" | "image" | "binary" {
  const name = file.name.toLowerCase();
  if (file.type.startsWith("image/")) {
    return "image";
  }

  if (
    file.type.startsWith("text/") ||
    name.endsWith(".md") ||
    name.endsWith(".json") ||
    name.endsWith(".yaml") ||
    name.endsWith(".yml") ||
    name.endsWith(".ts") ||
    name.endsWith(".tsx") ||
    name.endsWith(".js") ||
    name.endsWith(".jsx") ||
    name.endsWith(".py") ||
    name.endsWith(".java") ||
    name.endsWith(".go") ||
    name.endsWith(".rs") ||
    name.endsWith(".txt")
  ) {
    return "text";
  }

  return "binary";
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunk = 0x8000;

  for (let index = 0; index < bytes.length; index += chunk) {
    const slice = bytes.subarray(index, index + chunk);
    binary += String.fromCharCode(...slice);
  }

  return btoa(binary);
}

function parseSlashCommand(
  rawPrompt: string,
  mode: UiMode,
): { prompt: string; mode: AgentMode } {
  const trimmed = rawPrompt.trim();
  const defaultMode = mapUiModeToAgent(mode);

  if (/^\/(tool|edit)\b/i.test(trimmed)) {
    return {
      prompt: trimmed,
      mode: defaultMode,
    };
  }

  const slashMatch = trimmed.match(
    /^\/(plan|code|fix|test|explain)\b\s*(.*)$/is,
  );
  if (!slashMatch) {
    return {
      prompt: trimmed,
      mode: defaultMode,
    };
  }

  const command = slashMatch[1].toLowerCase();
  const body = slashMatch[2].trim();

  switch (command) {
    case "plan":
      return {
        prompt: body || "Create an implementation plan for this task.",
        mode: "planner",
      };
    case "code":
      return {
        prompt:
          body || "Implement the requested change with clean code and tests.",
        mode: "coder",
      };
    case "fix":
      return {
        prompt: body || "Identify root cause and provide a robust fix.",
        mode: "reviewer",
      };
    case "test":
      return {
        prompt: body || "Create a focused test strategy and test cases.",
        mode: "qa",
      };
    case "explain":
      return {
        prompt: body || "Explain the current code path and trade-offs clearly.",
        mode: "coder",
      };
    default:
      return {
        prompt: trimmed,
        mode: defaultMode,
      };
  }
}

function findRetryPromptForMessage(
  session: Session,
  messageId: string,
): string | null {
  const idx = session.messages.findIndex((message) => message.id === messageId);
  if (idx < 0) {
    return null;
  }

  for (let pointer = idx; pointer >= 0; pointer -= 1) {
    const candidate = session.messages[pointer];
    if (candidate.role === "user" && candidate.text.trim()) {
      return candidate.text;
    }
  }

  return null;
}

const useStore = create<StoreState>((set, get) => {
  const initialDefaults = {
    provider: "ollama" as ProviderId,
    model: "gpt-oss:120b-cloud",
    mode: "agent" as UiMode,
  };

  const defaultSidebarSettings: SidebarSettings = {
    temperature: 0.2,
    showReasoning: true,
    autoApplyChanges: false,
    requireTerminalApproval: true,
    showDebugPanel: false,
    enableWebSearch: true,
    permissionLevel: "default" as PermissionLevel,
  };

  const initialSessions = persisted?.sessions?.length
    ? persisted.sessions
    : [createSession(initialDefaults)];

  return {
    sessions: initialSessions,
    activeSessionId:
      persisted?.activeSessionId ?? initialSessions[0]?.id ?? null,
    drafts: persisted?.drafts ?? {},
    attachments: [],
    isBusy: false,
    settingsPanelOpen: false,
    defaults: initialDefaults,
    settings: {
      ...defaultSidebarSettings,
      ...(persisted?.settings ?? {}),
    },
    providerStatus: {
      ollama: undefined,
      "openai-compatible": undefined,
    },
    modelSuggestions: {
      ollama: [],
      "openai-compatible": [],
    },
    hydrateConfig: (config) => {
      set((state) => {
        const defaults = {
          provider: config.provider,
          model: config.model,
          mode: mapAgentModeToUi(config.mode),
        };

        const sessions =
          state.sessions.length === 0
            ? [createSession(defaults)]
            : state.sessions;

        const settings: SidebarSettings = {
          ...state.settings,
          temperature: config.temperature ?? state.settings.temperature,
          showReasoning:
            typeof config.showReasoning === "boolean"
              ? config.showReasoning
              : state.settings.showReasoning,
          autoApplyChanges:
            typeof config.autoApplyChanges === "boolean"
              ? config.autoApplyChanges
              : state.settings.autoApplyChanges,
          requireTerminalApproval:
            typeof config.requireTerminalApproval === "boolean"
              ? config.requireTerminalApproval
              : state.settings.requireTerminalApproval,
          enableWebSearch:
            typeof config.allowWebSearch === "boolean"
              ? config.allowWebSearch
              : state.settings.enableWebSearch,
        };

        return {
          defaults,
          sessions,
          activeSessionId: state.activeSessionId ?? sessions[0].id,
          settings,
        };
      });
    },
    setBusy: (value) => {
      set({ isBusy: value });
    },
    setAttachments: (attachments) => {
      set({ attachments });
    },
    setSettingsPanelOpen: (open) => {
      set({ settingsPanelOpen: open });
    },
    setSettings: (update) => {
      set((state) => ({
        settings: {
          ...state.settings,
          ...update,
        },
      }));
    },
    newSession: () => {
      set((state) => {
        const session = createSession(state.defaults);
        return {
          sessions: [session, ...state.sessions],
          activeSessionId: session.id,
          drafts: {
            ...state.drafts,
            [session.id]: "",
          },
        };
      });
    },
    deleteSession: (sessionId) => {
      set((state) => {
        const sessions = state.sessions.filter(
          (session) => session.id !== sessionId,
        );
        const nextSessions =
          sessions.length > 0 ? sessions : [createSession(state.defaults)];
        const nextActive =
          state.activeSessionId === sessionId
            ? nextSessions[0].id
            : (state.activeSessionId ?? nextSessions[0].id);

        const drafts = { ...state.drafts };
        delete drafts[sessionId];

        return {
          sessions: nextSessions,
          activeSessionId: nextActive,
          drafts,
        };
      });
    },
    setActiveSession: (sessionId) => {
      set({ activeSessionId: sessionId });
    },
    updateActiveSession: (update) => {
      set((state) => {
        const activeSessionId = state.activeSessionId;
        if (!activeSessionId) {
          return state;
        }

        return {
          sessions: state.sessions.map((session) =>
            session.id === activeSessionId
              ? {
                  ...session,
                  ...update,
                  updatedAt: Date.now(),
                }
              : session,
          ),
        };
      });
    },
    clearActiveSession: () => {
      set((state) => {
        const activeSessionId = state.activeSessionId;
        if (!activeSessionId) {
          return state;
        }

        return {
          sessions: state.sessions.map((session) =>
            session.id === activeSessionId
              ? {
                  ...session,
                  title: "New Chat",
                  messages: [],
                  updatedAt: Date.now(),
                }
              : session,
          ),
        };
      });
    },
    addUserMessageToSession: (sessionId, text) => {
      set((state) => {
        return {
          sessions: state.sessions.map((session) => {
            if (session.id !== sessionId) {
              return session;
            }

            const userCount = session.messages.filter(
              (message) => message.role === "user",
            ).length;

            const nextMessage: ChatMessage = {
              id: makeId("msg"),
              role: "user",
              text,
              createdAt: Date.now(),
              reasoning: [],
              debug: [],
              proposedEdits: [],
              activityTodos: [],
              activityFiles: [],
            };

            return {
              ...session,
              title: userCount === 0 ? titleFromPrompt(text) : session.title,
              updatedAt: Date.now(),
              messages: [...session.messages, nextMessage],
            };
          }),
        };
      });
    },
    beginAssistantMessage: (sessionId, meta) => {
      const exists = get().sessions.some((session) => session.id === sessionId);
      if (!exists) {
        return null;
      }

      const messageId = makeId("msg");

      set((state) => ({
        sessions: state.sessions.map((session) =>
          session.id === sessionId
            ? {
                ...session,
                updatedAt: Date.now(),
                messages: [
                  ...session.messages,
                  {
                    id: messageId,
                    role: "assistant",
                    text: "",
                    createdAt: Date.now(),
                    provider: meta?.provider,
                    model: meta?.model,
                    mode: meta?.mode,
                    streaming: true,
                    thinking: true,
                    reasoning: [],
                    debug: [],
                    proposedEdits: [],
                    activityTodos: [],
                    activityFiles: [],
                  },
                ],
              }
            : session,
        ),
      }));

      return {
        sessionId,
        messageId,
      };
    },
    updateAssistantTrace: (sessionId, messageId, reasoning, debug) => {
      set((state) => ({
        sessions: state.sessions.map((session) =>
          session.id === sessionId
            ? {
                ...session,
                updatedAt: Date.now(),
                messages: session.messages.map((message) =>
                  message.id === messageId
                    ? {
                        ...message,
                        reasoning,
                        debug,
                      }
                    : message,
                ),
              }
            : session,
        ),
      }));
    },
    updateAssistantActivity: (sessionId, messageId, todos, files, note) => {
      set((state) => ({
        sessions: state.sessions.map((session) =>
          session.id === sessionId
            ? {
                ...session,
                updatedAt: Date.now(),
                messages: session.messages.map((message) =>
                  message.id === messageId
                    ? {
                        ...message,
                        activityTodos: todos,
                        activityFiles: files,
                        activityNote: note,
                      }
                    : message,
                ),
              }
            : session,
        ),
      }));
    },
    appendAssistantToken: (sessionId, messageId, token) => {
      set((state) => ({
        sessions: state.sessions.map((session) =>
          session.id === sessionId
            ? {
                ...session,
                updatedAt: Date.now(),
                messages: session.messages.map((message) =>
                  message.id === messageId
                    ? {
                        ...message,
                        text: `${message.text}${token}`,
                        thinking: false,
                        streaming: true,
                      }
                    : message,
                ),
              }
            : session,
        ),
      }));
    },
    finalizeAssistantMessage: (
      sessionId,
      messageId,
      text,
      reasoning,
      debug,
      edits,
    ) => {
      set((state) => ({
        sessions: state.sessions.map((session) =>
          session.id === sessionId
            ? {
                ...session,
                updatedAt: Date.now(),
                messages: session.messages.map((message) =>
                  message.id === messageId
                    ? {
                        ...message,
                        text,
                        streaming: false,
                        thinking: false,
                        reasoning,
                        debug,
                        proposedEdits: edits,
                      }
                    : message,
                ),
              }
            : session,
        ),
      }));
    },
    stopAssistantMessage: (sessionId, messageId, messageText) => {
      set((state) => ({
        sessions: state.sessions.map((session) =>
          session.id === sessionId
            ? {
                ...session,
                updatedAt: Date.now(),
                messages: session.messages.map((message) =>
                  message.id === messageId
                    ? {
                        ...message,
                        text:
                          message.text.trim().length > 0
                            ? `${message.text}\n\n_${messageText}_`
                            : messageText,
                        streaming: false,
                        thinking: false,
                        stopped: true,
                      }
                    : message,
                ),
              }
            : session,
        ),
      }));
    },
    failAssistantMessage: (sessionId, messageId, errorText) => {
      set((state) => ({
        sessions: state.sessions.map((session) =>
          session.id === sessionId
            ? {
                ...session,
                updatedAt: Date.now(),
                messages: session.messages.map((message) =>
                  message.id === messageId
                    ? {
                        ...message,
                        text: errorText,
                        streaming: false,
                        thinking: false,
                        stopped: false,
                        error: true,
                      }
                    : message,
                ),
              }
            : session,
        ),
      }));
    },
    updateEditStatus: (editId, status, label) => {
      set((state) => ({
        sessions: state.sessions.map((session) => ({
          ...session,
          messages: session.messages.map((message) => ({
            ...message,
            proposedEdits: message.proposedEdits.map((edit) =>
              edit.id === editId
                ? {
                    ...edit,
                    status,
                    statusLabel: label,
                  }
                : edit,
            ),
          })),
        })),
      }));
    },
    setProviderStatus: (status) => {
      set((state) => ({
        providerStatus: {
          ...state.providerStatus,
          [status.provider]: status,
        },
      }));
    },
    setModelSuggestions: (provider, models) => {
      set((state) => ({
        modelSuggestions: {
          ...state.modelSuggestions,
          [provider]: [...new Set(models)].slice(0, 60),
        },
      }));
    },
    setDraft: (sessionId, value) => {
      set((state) => ({
        drafts: {
          ...state.drafts,
          [sessionId]: value,
        },
      }));
    },
  };
});

function getActiveSession(state: StoreState): Session | undefined {
  return state.sessions.find((session) => session.id === state.activeSessionId);
}

// ─── Token Ring ──────────────────────────────────────────────────────────────
function inferContextWindow(model: string): number {
  const normalized = model.toLowerCase().trim();

  if (/gpt-oss:120b-cloud/.test(normalized)) {
    return 128_000;
  }

  if (/qwen2\.5-coder:7b|nemotron-mini/.test(normalized)) {
    return 32_768;
  }

  if (
    /qwen3-coder:480b-cloud|gpt-4|gpt-4o|claude|deepseek|llama-3\.3/.test(
      normalized,
    )
  ) {
    return 128_000;
  }

  return 64_000;
}

function formatTokenCount(value: number): string {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M`;
  }

  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(1)}K`;
  }

  return String(value);
}

function TokenRing({
  sessionMessages,
  draftText,
  model,
}: {
  sessionMessages: ChatMessage[];
  draftText: string;
  model: string;
}) {
  const max = useMemo(() => inferContextWindow(model), [model]);
  const sessionTokens = useMemo(() => {
    let total = 0;
    for (const msg of sessionMessages) {
      total += Math.ceil((msg.text?.length ?? 0) / 4);
    }
    return total;
  }, [sessionMessages]);
  const draftTokens = Math.ceil(draftText.length / 4);
  const totalTokens = sessionTokens + draftTokens;
  const pct = Math.min(totalTokens / max, 1);
  const r = 6;
  const circ = 2 * Math.PI * r;
  const dash = circ * pct;
  const color = pct > 0.85 ? "#f87171" : pct > 0.65 ? "#fb923c" : "#0284c7";

  return (
    <div
      className="nk-token-ring-wrap"
      title={`Context usage: ${totalTokens}/${max} tokens`}
    >
      <svg width="16" height="16" viewBox="0 0 16 16" className="shrink-0">
        <circle
          cx="8"
          cy="8"
          r={r}
          fill="none"
          stroke="#2a2a30"
          strokeWidth="2"
        />
        <circle
          cx="8"
          cy="8"
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="2"
          strokeDasharray={`${dash} ${circ}`}
          strokeLinecap="round"
          transform="rotate(-90 8 8)"
          style={{ transition: "stroke-dasharray 0.25s ease" }}
        />
      </svg>
      <span className="nk-token-ring-label">
        {formatTokenCount(totalTokens)}/{formatTokenCount(max)}
      </span>
    </div>
  );
}

// ─── Attachment Icon ──────────────────────────────────────────────────────────
function AttachIcon({ kind }: { kind: "text" | "image" | "binary" }) {
  if (kind === "image") return <Image size={12} />;
  if (kind === "text") return <FileText size={12} />;
  return <File size={12} />;
}

// ─── Status Dot ──────────────────────────────────────────────────────────────
function StatusDot({
  connected,
  latencyMs,
  error,
}: {
  connected: boolean;
  latencyMs?: number;
  error?: string;
}) {
  return (
    <div
      title={
        connected
          ? `Connected${latencyMs ? ` (${latencyMs}ms)` : ""}`
          : (error ?? "Disconnected")
      }
      className="flex items-center gap-1"
    >
      <span
        className="inline-block w-2 h-2 rounded-full"
        style={{ background: connected ? "#22c55e" : "#f85149" }}
      />
      {latencyMs !== undefined && connected && (
        <span className="text-[10px]" style={{ color: "#6b6b75" }}>
          {latencyMs}ms
        </span>
      )}
    </div>
  );
}

// ─── Message Bubble ──────────────────────────────────────────────────────────
function MessageBubble({
  message,
  showReasoning,
  showDebug,
  canRetry,
  copied,
  isBusy,
  onAnimatedFrame,
  onCopy,
  onRetry,
  onEdit,
  onPreview,
  onApply,
  onReject,
}: {
  message: ChatMessage;
  showReasoning: boolean;
  showDebug: boolean;
  canRetry: boolean;
  copied: boolean;
  isBusy: boolean;
  onAnimatedFrame?: () => void;
  onCopy: (message: ChatMessage) => void;
  onRetry: (message: ChatMessage) => void;
  onEdit: (message: ChatMessage) => void;
  onPreview: (editId: string) => void;
  onApply: (editId: string) => void;
  onReject: (editId: string) => void;
}) {
  const isUser = message.role === "user";
  const showActions =
    !message.streaming && !message.thinking && message.text.trim().length > 0;

  return (
    <motion.div
      layout
      className={`nk-msg-row ${isUser ? "nk-msg-row--user" : "nk-msg-row--bot"}`}
    >
      {/* Bubble */}
      <div
        className={`nk-msg-content ${isUser ? "nk-msg-content--user" : "nk-msg-content--bot"}`}
      >
        {/* Main text */}
        {(isUser ? message.text.trim().length > 0 : true) && (
          <div
            className={
              isUser
                ? "nk-bubble-user"
                : message.error
                  ? "nk-bubble-error"
                  : "nk-bubble-bot"
            }
          >
            {isUser ? (
              <pre className="m-0 whitespace-pre-wrap text-[13px] leading-relaxed font-sans">
                {message.text}
              </pre>
            ) : (
              <StreamingMessage
                text={message.text || ""}
                streaming={Boolean(message.streaming || message.thinking)}
                markdown
                className="markdown-body text-[13px] leading-relaxed"
                showCursor
                thinkingLabel={message.reasoning.at(-1) ?? "Working..."}
                onFrame={onAnimatedFrame}
              />
            )}
          </div>
        )}

        {!isUser &&
          (message.activityTodos.length > 0 ||
            message.activityFiles.length > 0) && (
            <ActivityPanel
              todos={message.activityTodos}
              files={message.activityFiles}
              note={message.activityNote}
            />
          )}

        {/* Reasoning */}
        {!isUser && showReasoning && message.reasoning.length > 0 && (
          <details
            className={`nk-reasoning-panel ${message.streaming || message.thinking ? "nk-reasoning-panel--live" : ""}`}
            open={Boolean(message.streaming || message.thinking)}
          >
            <summary className="nk-reasoning-panel-header nk-reasoning-summary">
              <span>
                {message.streaming || message.thinking
                  ? "Reasoning (live)"
                  : "Reasoning steps"}
              </span>
              {(message.model || message.mode) && (
                <span className="nk-reasoning-meta">
                  {[
                    message.model,
                    message.mode ? formatAgentMode(message.mode) : "",
                  ]
                    .filter(Boolean)
                    .join(" • ")}
                </span>
              )}
            </summary>
            <ol className="nk-reasoning-list">
              {message.reasoning.map((item, i) => {
                const isLatest = i === message.reasoning.length - 1;
                return (
                  <li
                    key={`${message.id}-r-${i}`}
                    className={`nk-reasoning-item ${isLatest && (message.streaming || message.thinking) ? "nk-reasoning-item--active" : ""}`}
                  >
                    <Zap size={9} style={{ color: "#0284c7", flexShrink: 0 }} />
                    <StreamingMessage
                      text={item}
                      streaming={
                        isLatest &&
                        Boolean(message.streaming || message.thinking)
                      }
                      markdown={false}
                      as="span"
                      className="nk-reasoning-live"
                      showCursor={false}
                      onFrame={onAnimatedFrame}
                    />
                  </li>
                );
              })}
            </ol>
          </details>
        )}

        {showActions && (
          <div
            className={`nk-msg-actions ${isUser ? "nk-msg-actions--user" : "nk-msg-actions--bot"}`}
          >
            <button
              className="nk-msg-action-btn"
              title={copied ? "Copied" : "Copy message"}
              onClick={() => onCopy(message)}
            >
              {copied ? <Check size={11} /> : <Copy size={11} />}
            </button>
            {isUser && (
              <button
                className="nk-msg-action-btn"
                title="Edit prompt"
                onClick={() => onEdit(message)}
              >
                <Pencil size={11} />
              </button>
            )}
            {canRetry && (
              <button
                className="nk-msg-action-btn"
                title="Retry"
                onClick={() => onRetry(message)}
                disabled={isBusy}
              >
                <RotateCcw size={11} />
              </button>
            )}
          </div>
        )}

        {/* Debug */}
        {!isUser && showDebug && message.debug.length > 0 && (
          <details className="nk-details-block w-full">
            <summary className="cursor-pointer flex items-center gap-1.5 text-[11px] font-medium select-none">
              <ChevronRight size={11} className="details-arrow" />
              Debug trace
            </summary>
            <ol className="mt-2 list-decimal space-y-0.5 pl-5 text-[11px]">
              {message.debug.map((item, i) => (
                <li key={`${message.id}-d-${i}`}>{item}</li>
              ))}
            </ol>
          </details>
        )}

        {/* Proposed edits */}
        {message.proposedEdits.length > 0 && (
          <div className="mt-1 w-full space-y-2">
            {message.proposedEdits.map((edit) => (
              <div key={edit.id} className="nk-edit-card">
                <div className="flex items-center justify-between gap-2 mb-1">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <FileText
                      size={12}
                      className="shrink-0"
                      style={{ color: "#8b8b9a" }}
                    />
                    <span
                      className="text-[11px] font-medium truncate"
                      style={{ color: "#e2e2e2" }}
                    >
                      {edit.filePath}
                    </span>
                  </div>
                  <span
                    className={`nk-edit-badge ${
                      edit.status === "applied"
                        ? "nk-edit-badge--applied"
                        : edit.status === "rejected"
                          ? "nk-edit-badge--rejected"
                          : "nk-edit-badge--pending"
                    }`}
                  >
                    {edit.status === "applied" && <CheckCircle2 size={10} />}
                    {edit.statusLabel ?? edit.status}
                  </span>
                </div>
                {edit.summary && (
                  <p
                    className="text-[11px] mb-1.5"
                    style={{ color: "#8b8b9a" }}
                  >
                    {edit.summary}
                  </p>
                )}
                <pre className="nk-code-block max-h-36 overflow-auto">
                  {edit.patch || edit.newText || ""}
                </pre>
                {edit.status === "pending" && (
                  <div className="mt-2 flex gap-1.5">
                    <button
                      className="nk-btn-ghost text-[11px] px-2.5 py-1 flex items-center gap-1"
                      onClick={() => onPreview(edit.id)}
                    >
                      <ExternalLink size={11} /> Preview
                    </button>
                    <button
                      className="nk-btn-accent text-[11px] px-2.5 py-1 flex items-center gap-1"
                      onClick={() => onApply(edit.id)}
                    >
                      <CheckCircle2 size={11} /> Apply
                    </button>
                    <button
                      className="nk-btn-danger text-[11px] px-2.5 py-1 flex items-center gap-1"
                      onClick={() => onReject(edit.id)}
                    >
                      <X size={11} /> Reject
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </motion.div>
  );
}

// ─── Sessions Drawer ──────────────────────────────────────────────────────────
function SessionsDrawer({
  sessions,
  activeSessionId,
  onSelect,
  onNew,
  onDeleteRequest,
  onClose,
}: {
  sessions: Session[];
  activeSessionId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDeleteRequest: (id: string) => void;
  onClose: () => void;
}) {
  return (
    <motion.div
      className="nk-drawer-backdrop"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <motion.aside
        className="nk-drawer"
        initial={{ x: -16, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        exit={{ x: -16, opacity: 0 }}
        transition={{ type: "spring", stiffness: 320, damping: 32 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-3 pt-3 pb-2">
          <span
            className="text-[11px] font-semibold uppercase tracking-widest"
            style={{ color: "#6b6b75" }}
          >
            Chats
          </span>
          <div className="flex items-center gap-1">
            <button
              className="nk-icon-btn"
              title="New chat"
              onClick={() => {
                onNew();
                onClose();
              }}
            >
              <MessageSquarePlus size={15} />
            </button>
            <button className="nk-icon-btn" title="Close" onClick={onClose}>
              <X size={15} />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-auto px-0 pb-0 space-y-0">
          <AnimatePresence initial={false}>
            {sessions.map((s) => (
              <motion.button
                key={s.id}
                layout
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => {
                  onSelect(s.id);
                  onClose();
                }}
                className={`nk-session-item w-full text-left ${s.id === activeSessionId ? "nk-session-item--active" : ""}`}
              >
                <div className="flex items-start justify-between gap-1 min-w-0">
                  <div className="min-w-0 flex-1">
                    <div
                      className="text-[12px] font-medium leading-snug line-clamp-2"
                      style={{ color: "#e2e2e2" }}
                    >
                      {s.title}
                    </div>
                    <div
                      className="text-[10px] mt-0.5"
                      style={{ color: "#6b6b75" }}
                    >
                      {formatRelativeTime(s.updatedAt)}
                    </div>
                  </div>
                  <button
                    className="nk-icon-btn shrink-0 opacity-0 group-hover:opacity-100"
                    title="Delete"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteRequest(s.id);
                    }}
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </motion.button>
            ))}
          </AnimatePresence>
        </div>
      </motion.aside>
    </motion.div>
  );
}

// ─── Settings Drawer ──────────────────────────────────────────────────────────
function SettingsDrawer({
  activeSession,
  settings,
  modelsForProvider,
  mcpServers,
  mcpTools,
  mcpSelectedServer,
  mcpSelectedTool,
  mcpInput,
  mcpInvokeBusy,
  mcpInvokeResult,
  onProviderChange,
  onModelChange,
  onMcpRefresh,
  onMcpServerChange,
  onMcpToolChange,
  onMcpInputChange,
  onMcpInvoke,
  onClose,
}: {
  activeSession: Session;
  settings: SidebarSettings;
  modelsForProvider: string[];
  mcpServers: string[];
  mcpTools: string[];
  mcpSelectedServer: string;
  mcpSelectedTool: string;
  mcpInput: string;
  mcpInvokeBusy: boolean;
  mcpInvokeResult: McpQuickResult | null;
  onProviderChange: (p: ProviderId) => void;
  onModelChange: (m: string) => void;
  onMcpRefresh: () => void;
  onMcpServerChange: (server: string) => void;
  onMcpToolChange: (tool: string) => void;
  onMcpInputChange: (input: string) => void;
  onMcpInvoke: () => void;
  onClose: () => void;
}) {
  return (
    <motion.div
      className="nk-drawer-backdrop nk-drawer-backdrop--right"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <motion.aside
        className="nk-drawer nk-drawer--right"
        initial={{ x: 16, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        exit={{ x: 16, opacity: 0 }}
        transition={{ type: "spring", stiffness: 320, damping: 32 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-3 pt-3 pb-2">
          <span
            className="text-[11px] font-semibold uppercase tracking-widest"
            style={{ color: "#6b6b75" }}
          >
            Settings
          </span>
          <button className="nk-icon-btn" onClick={onClose}>
            <X size={15} />
          </button>
        </div>

        <div className="flex-1 overflow-auto px-3 pb-3 space-y-3">
          {/* Provider */}
          <div>
            <label className="nk-label">Provider</label>
            <select
              className="nk-select mt-1"
              value={activeSession.provider}
              onChange={(e) => onProviderChange(e.target.value as ProviderId)}
            >
              <option value="ollama">Ollama</option>
              <option value="openai-compatible">OpenAI compatible</option>
            </select>
          </div>

          {/* Model */}
          <div>
            <label className="nk-label">Model</label>
            <select
              className="nk-select mt-1"
              value={activeSession.model}
              onChange={(e) => onModelChange(e.target.value)}
            >
              {modelsForProvider.length === 0 ? (
                <option value={activeSession.model}>
                  {activeSession.model}
                </option>
              ) : (
                modelsForProvider.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))
              )}
            </select>
            <input
              className="nk-input mt-1"
              placeholder="Or type model name…"
              value={activeSession.model}
              onChange={(e) => onModelChange(e.target.value)}
            />
          </div>

          {/* Temperature */}
          <div>
            <label className="nk-label">
              Temperature{" "}
              <span style={{ color: "#6b6b75" }}>
                ({settings.temperature.toFixed(2)})
              </span>
            </label>
            <input
              type="range"
              min={0}
              max={2}
              step={0.05}
              value={settings.temperature}
              className="mt-2 w-full nk-range"
              onChange={(e) =>
                useStore
                  .getState()
                  .setSettings({ temperature: parseFloat(e.target.value) })
              }
            />
            <div
              className="flex justify-between text-[10px] mt-0.5"
              style={{ color: "#6b6b75" }}
            >
              <span>Precise</span>
              <span>Creative</span>
            </div>
          </div>

          {/* Toggles */}
          {(
            [
              ["Show reasoning", "showReasoning"],
              ["Show debug panel", "showDebugPanel"],
              ["Enable web search tool", "enableWebSearch"],
              ["Auto-apply changes", "autoApplyChanges"],
              ["Require terminal approval", "requireTerminalApproval"],
            ] as [string, keyof SidebarSettings][]
          ).map(([label, key]) => (
            <label key={key} className="nk-toggle-row">
              <span className="text-[12px]" style={{ color: "#cccccc" }}>
                {label}
              </span>
              <div
                className={`nk-toggle ${settings[key] ? "nk-toggle--on" : ""}`}
                onClick={() =>
                  useStore.getState().setSettings({
                    [key]: !settings[key],
                  } as Partial<SidebarSettings>)
                }
              >
                <div className="nk-toggle-thumb" />
              </div>
            </label>
          ))}

          {/* Permission Level */}
          <div className="nk-permission-section">
            <label className="nk-label">Permissions</label>
            <div className="nk-permission-options">
              {(
                [
                  {
                    value: "default" as PermissionLevel,
                    title: "Default Approvals",
                    desc: "Copilot uses your configured settings",
                  },
                  {
                    value: "bypass" as PermissionLevel,
                    title: "Bypass Approvals",
                    desc: "All tool calls are auto-approved",
                  },
                  {
                    value: "autopilot" as PermissionLevel,
                    title: "Autopilot (Preview)",
                    desc: "Autonomously iterates from start to finish",
                  },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.value}
                  className={`nk-permission-option ${settings.permissionLevel === opt.value ? "nk-permission-option--active" : ""}`}
                  onClick={() =>
                    useStore
                      .getState()
                      .setSettings({ permissionLevel: opt.value })
                  }
                >
                  <span className="nk-permission-option-title">
                    {opt.title}
                  </span>
                  <span className="nk-permission-option-desc">{opt.desc}</span>
                </button>
              ))}
            </div>
            <a
              className="nk-permission-learn-more"
              href="https://code.visualstudio.com/docs/copilot/agents/agent-tools#_permission-levels"
              title="Learn more about permissions"
            >
              Learn more about permissions
            </a>
          </div>

          <div className="nk-info-box">
            <div className="nk-mcp-header">
              <p
                className="text-[11px] font-semibold"
                style={{ color: "#cccccc", margin: 0 }}
              >
                MCP management
              </p>
              <button
                className="nk-btn-ghost text-[10px] px-2 py-1"
                onClick={onMcpRefresh}
                type="button"
              >
                Refresh
              </button>
            </div>

            <p className="nk-mcp-meta">
              {mcpServers.length} registered server
              {mcpServers.length === 1 ? "" : "s"}
            </p>

            {mcpServers.length === 0 ? (
              <p className="nk-mcp-empty">No MCP adapters registered yet.</p>
            ) : (
              <>
                <label className="nk-label mt-2">Server</label>
                <select
                  className="nk-select mt-1"
                  value={mcpSelectedServer}
                  onChange={(event) => onMcpServerChange(event.target.value)}
                >
                  {mcpServers.map((server) => (
                    <option key={server} value={server}>
                      {server}
                    </option>
                  ))}
                </select>

                <label className="nk-label mt-2">Tool</label>
                <select
                  className="nk-select mt-1"
                  value={mcpSelectedTool}
                  onChange={(event) => onMcpToolChange(event.target.value)}
                  disabled={mcpTools.length === 0}
                >
                  {mcpTools.length === 0 ? (
                    <option value="">No tools available</option>
                  ) : (
                    mcpTools.map((tool) => (
                      <option key={tool} value={tool}>
                        {tool}
                      </option>
                    ))
                  )}
                </select>

                <label className="nk-label mt-2">Quick input</label>
                <textarea
                  className="nk-mcp-input"
                  value={mcpInput}
                  onChange={(event) => onMcpInputChange(event.target.value)}
                  placeholder="Input passed to the selected MCP tool"
                  rows={3}
                />

                <button
                  className="nk-btn-accent w-full mt-2"
                  onClick={onMcpInvoke}
                  disabled={
                    mcpInvokeBusy || !mcpSelectedServer || !mcpSelectedTool
                  }
                  type="button"
                >
                  {mcpInvokeBusy ? "Invoking..." : "Quick invoke"}
                </button>

                {mcpInvokeResult && (
                  <div className="nk-mcp-result">
                    <p className="nk-mcp-result-meta">
                      {mcpInvokeResult.ok ? "Success" : "Failed"} •{" "}
                      {mcpInvokeResult.server}:{mcpInvokeResult.tool} •{" "}
                      {mcpInvokeResult.latencyMs}ms
                    </p>
                    <pre className="nk-code-block">
                      {mcpInvokeResult.output}
                    </pre>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Open in tab */}
          <button
            className="nk-btn-ghost w-full flex items-center justify-center gap-2 mt-2"
            onClick={() => vscode.postMessage({ type: "openInTab" })}
          >
            <ExternalLink size={13} />
            <span className="text-[12px]">Open in editor tab</span>
          </button>

          {/* Slash commands reference */}
          <div className="nk-info-box">
            <p
              className="text-[11px] font-semibold mb-1"
              style={{ color: "#cccccc" }}
            >
              Slash commands
            </p>
            {[
              ["/plan", "Generate implementation plan"],
              ["/code", "Write clean code"],
              ["/fix", "Diagnose & fix a bug"],
              ["/test", "Write test cases"],
              ["/explain", "Explain selected code"],
            ].map(([cmd, desc]) => (
              <div key={cmd} className="flex gap-2 text-[11px] leading-relaxed">
                <code className="nk-code-inline shrink-0">{cmd}</code>
                <span style={{ color: "#8b8b9a" }}>{desc}</span>
              </div>
            ))}
          </div>

          {/* Modes reference */}
          <div className="nk-info-box">
            <p
              className="text-[11px] font-semibold mb-1"
              style={{ color: "#cccccc" }}
            >
              Agent modes
            </p>
            {[
              [
                "Agent",
                "Full autonomous mode – plans, codes, reviews, and fixes. Uses all sub-agents to complete tasks end-to-end.",
              ],
              [
                "Plan",
                "Planning only – decomposes tasks into steps with dependencies and acceptance criteria. No code execution.",
              ],
              [
                "Ask",
                "Q&A mode – conversational answers for code and architecture questions. Keeps responses concise and practical.",
              ],
            ].map(([name, desc]) => (
              <div key={name} className="mb-1.5">
                <span
                  className="text-[11px] font-medium"
                  style={{ color: "#e2e2e2" }}
                >
                  {name}
                </span>
                <p className="text-[10px] mt-0.5" style={{ color: "#8b8b9a" }}>
                  {desc}
                </p>
              </div>
            ))}
          </div>
        </div>
      </motion.aside>
    </motion.div>
  );
}

// ─── App ──────────────────────────────────────────────────────────────────────
function App() {
  const sessions = useStore((s) => s.sessions);
  const activeSessionId = useStore((s) => s.activeSessionId);
  const drafts = useStore((s) => s.drafts);
  const attachments = useStore((s) => s.attachments);
  const isBusy = useStore((s) => s.isBusy);
  const settingsPanelOpen = useStore((s) => s.settingsPanelOpen);
  const settings = useStore((s) => s.settings);
  const providerStatus = useStore((s) => s.providerStatus);
  const modelSuggestions = useStore((s) => s.modelSuggestions);

  const [sessionsOpen, setSessionsOpen] = useState(false);
  const [deleteTargetSessionId, setDeleteTargetSessionId] = useState<
    string | null
  >(null);
  const [queuedPrompts, setQueuedPrompts] = useState<QueuedPrompt[]>([]);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const [followStream, setFollowStream] = useState(true);
  const [enhanceBusy, setEnhanceBusy] = useState(false);
  const [enhanceFeedback, setEnhanceFeedback] = useState<string | null>(null);
  const [mcpServers, setMcpServers] = useState<string[]>([]);
  const [mcpToolsByServer, setMcpToolsByServer] = useState<
    Record<string, string[]>
  >({});
  const [mcpSelectedServer, setMcpSelectedServer] = useState("");
  const [mcpSelectedTool, setMcpSelectedTool] = useState("");
  const [mcpQuickInput, setMcpQuickInput] = useState("");
  const [mcpInvokeBusy, setMcpInvokeBusy] = useState(false);
  const [mcpInvokeResult, setMcpInvokeResult] = useState<McpQuickResult | null>(
    null,
  );
  const [bannerNotice, setBannerNotice] = useState<{
    kind: "error" | "info";
    text: string;
  } | null>(null);

  // Fixed DnD: counter-based to avoid nested element false leaves
  const dragCounterRef = useRef(0);
  const [isDragOver, setIsDragOver] = useState(false);

  const chatScrollerRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const mcpSelectedServerRef = useRef("");
  const pendingRef = useRef<{ sessionId: string; messageId: string } | null>(
    null,
  );
  const reasoningRef = useRef<string[]>([]);
  const debugRef = useRef<string[]>([]);
  const tokenQueueRef = useRef<string[]>([]);
  const flushHandleRef = useRef<number | null>(null);
  const copyResetTimerRef = useRef<number | null>(null);
  const queuedPromptsRef = useRef<QueuedPrompt[]>([]);

  const activeSession = useMemo(
    () => sessions.find((s) => s.id === activeSessionId),
    [sessions, activeSessionId],
  );

  const activeDraft = activeSession ? (drafts[activeSession.id] ?? "") : "";

  const modelsForActiveProvider = useMemo(() => {
    if (!activeSession) return [];
    const current = activeSession.model ? [activeSession.model] : [];
    return [
      ...new Set([
        ...current,
        ...(modelSuggestions[activeSession.provider] ?? []),
      ]),
    ];
  }, [activeSession, modelSuggestions]);

  const highlightedCommands = useMemo(
    () => extractCommandTokens(activeDraft),
    [activeDraft],
  );

  const mcpToolsForSelectedServer = useMemo(
    () => mcpToolsByServer[mcpSelectedServer] ?? [],
    [mcpSelectedServer, mcpToolsByServer],
  );

  const quickPromptActions = useMemo(
    () => [
      {
        label: "Plan",
        template: "/plan ",
      },
      {
        label: "Code",
        template: "/code ",
      },
      {
        label: "Fix",
        template: "/fix ",
      },
      {
        label: "Test",
        template: "/test ",
      },
    ],
    [],
  );

  const showNotice = useCallback((kind: "error" | "info", text: string) => {
    setBannerNotice({ kind, text: text.trim() });
  }, []);

  useEffect(() => {
    mcpSelectedServerRef.current = mcpSelectedServer;
  }, [mcpSelectedServer]);

  useEffect(() => {
    vscode.postMessage({ type: "listMcpServers" });
  }, []);

  useEffect(() => {
    if (!mcpSelectedServer) {
      return;
    }

    if (!mcpToolsByServer[mcpSelectedServer]) {
      vscode.postMessage({
        type: "listMcpTools",
        server: mcpSelectedServer,
      });
    }
  }, [mcpSelectedServer, mcpToolsByServer]);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "auto") => {
    const scroller = chatScrollerRef.current;
    if (!scroller) {
      return;
    }

    scroller.scrollTo({
      top: scroller.scrollHeight,
      behavior,
    });
    setShowScrollToBottom(false);
  }, []);

  const syncScrollState = useCallback(() => {
    const scroller = chatScrollerRef.current;
    if (!scroller) {
      return;
    }

    const distanceFromBottom =
      scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
    const nearBottom = distanceFromBottom < 56;
    setFollowStream(nearBottom);
    setShowScrollToBottom(!nearBottom);
  }, []);

  const dispatchPromptRequest = useCallback((request: QueuedPrompt) => {
    const sessionExists = useStore
      .getState()
      .sessions.some((session) => session.id === request.sessionId);
    if (!sessionExists) {
      return;
    }

    useStore.getState().setBusy(true);
    vscode.postMessage({
      type: "sendPrompt",
      sessionId: request.sessionId,
      prompt: request.prompt,
      provider: request.provider,
      model: request.model,
      mode: request.mode,
      temperature: request.temperature,
      allowWebSearch: request.allowWebSearch,
      attachmentIds: request.attachmentIds,
    });
  }, []);

  const enqueuePromptRequest = useCallback((request: QueuedPrompt) => {
    setQueuedPrompts((current) => {
      const next = [...current, request];
      queuedPromptsRef.current = next;
      return next;
    });
  }, []);

  const dequeuePromptRequest = useCallback((): QueuedPrompt | undefined => {
    while (queuedPromptsRef.current.length > 0) {
      const [next, ...rest] = queuedPromptsRef.current;
      queuedPromptsRef.current = rest;
      setQueuedPrompts(rest);

      const sessionExists = useStore
        .getState()
        .sessions.some((session) => session.id === next.sessionId);
      if (sessionExists) {
        return next;
      }
    }

    return undefined;
  }, []);

  const submitPrompt = useCallback(
    (rawPrompt: string, session: Session, attachmentIds: string[] = []) => {
      const trimmed = rawPrompt.trim();
      if (!trimmed) {
        return false;
      }

      const parsed = parseSlashCommand(trimmed, session.mode);
      const permLevel = settings.permissionLevel;
      if (
        permLevel === "default" &&
        settings.requireTerminalApproval &&
        /^\/tool\s+terminal\s+/i.test(parsed.prompt)
      ) {
        const cmd = parsed.prompt.replace(/^\/tool\s+terminal\s+/i, "");
        if (
          !window.confirm(
            `Approval required for terminal command:\n\n${cmd}\n\nContinue?`,
          )
        ) {
          return false;
        }
      }

      if (
        !settings.enableWebSearch &&
        /^\/tool\s+(web-search|search-web|online-search)\b/i.test(parsed.prompt)
      ) {
        window.alert(
          "Web search is disabled. Enable 'Enable web search tool' in Settings to use this command.",
        );
        return false;
      }

      useStore.getState().addUserMessageToSession(session.id, trimmed);
      const request: QueuedPrompt = {
        id: makeId("queue"),
        sessionId: session.id,
        rawPrompt: trimmed,
        prompt: parsed.prompt,
        provider: session.provider,
        model: session.model,
        mode: parsed.mode,
        temperature: settings.temperature,
        allowWebSearch: settings.enableWebSearch,
        attachmentIds,
      };

      if (useStore.getState().isBusy) {
        enqueuePromptRequest(request);
      } else {
        dispatchPromptRequest(request);
      }

      setFollowStream(true);
      window.requestAnimationFrame(() => scrollToBottom("smooth"));
      return true;
    },
    [
      dispatchPromptRequest,
      enqueuePromptRequest,
      scrollToBottom,
      settings.enableWebSearch,
      settings.requireTerminalApproval,
      settings.temperature,
    ],
  );

  const handleStopRequest = useCallback(() => {
    if (!useStore.getState().isBusy) {
      return;
    }
    vscode.postMessage({ type: "cancelPrompt" });
  }, []);

  const handleCopyMessage = useCallback(async (message: ChatMessage) => {
    const value = message.text.trim();
    if (!value) {
      return;
    }

    try {
      await navigator.clipboard.writeText(value);
    } catch {
      const fallback = document.createElement("textarea");
      fallback.value = value;
      fallback.style.position = "fixed";
      fallback.style.opacity = "0";
      document.body.appendChild(fallback);
      fallback.focus();
      fallback.select();
      document.execCommand("copy");
      document.body.removeChild(fallback);
    }

    setCopiedMessageId(message.id);
    if (copyResetTimerRef.current !== null) {
      window.clearTimeout(copyResetTimerRef.current);
    }
    copyResetTimerRef.current = window.setTimeout(() => {
      setCopiedMessageId(null);
      copyResetTimerRef.current = null;
    }, 1200);
  }, []);

  const handleEditMessage = useCallback(
    (message: ChatMessage) => {
      if (!activeSession || message.role !== "user") {
        return;
      }

      useStore.getState().setDraft(activeSession.id, message.text);
      window.requestAnimationFrame(() => {
        const textarea = textareaRef.current;
        if (!textarea) {
          return;
        }

        textarea.focus();
        textarea.setSelectionRange(message.text.length, message.text.length);
      });
    },
    [activeSession],
  );

  const handleRetryMessage = useCallback(
    (message: ChatMessage) => {
      if (!activeSession) {
        return;
      }

      const retryPrompt = findRetryPromptForMessage(activeSession, message.id);
      if (!retryPrompt) {
        return;
      }

      submitPrompt(retryPrompt, activeSession, []);
    },
    [activeSession, submitPrompt],
  );

  const handleEnhancePrompt = useCallback(() => {
    if (!activeSession) {
      return;
    }

    const current = useStore.getState().drafts[activeSession.id] ?? "";
    if (!current.trim()) {
      return;
    }

    setEnhanceBusy(true);
    setEnhanceFeedback(null);
    vscode.postMessage({
      type: "enhancePrompt",
      sessionId: activeSession.id,
      prompt: current,
      provider: activeSession.provider,
      model: activeSession.model,
      mode: mapUiModeToAgent(activeSession.mode),
      temperature: settings.temperature,
    });
  }, [activeSession, settings.temperature]);

  const handleMcpRefresh = useCallback(() => {
    vscode.postMessage({ type: "listMcpServers" });
    if (mcpSelectedServerRef.current) {
      vscode.postMessage({
        type: "listMcpTools",
        server: mcpSelectedServerRef.current,
      });
    }
  }, []);

  const handleMcpServerChange = useCallback((server: string) => {
    setMcpSelectedServer(server);
    setMcpInvokeResult(null);
    if (!server) {
      setMcpSelectedTool("");
      return;
    }

    vscode.postMessage({ type: "listMcpTools", server });
  }, []);

  const handleMcpToolChange = useCallback((tool: string) => {
    setMcpSelectedTool(tool);
  }, []);

  const handleMcpInvoke = useCallback(() => {
    if (!mcpSelectedServer || !mcpSelectedTool) {
      return;
    }

    setMcpInvokeBusy(true);
    setMcpInvokeResult(null);
    vscode.postMessage({
      type: "invokeMcpToolQuick",
      server: mcpSelectedServer,
      tool: mcpSelectedTool,
      input: mcpQuickInput,
    });
  }, [mcpQuickInput, mcpSelectedServer, mcpSelectedTool]);

  // Persist state to VS Code webview state
  useEffect(() => {
    let handle: number | null = null;
    const unsub = useStore.subscribe((state) => {
      if (handle !== null) clearTimeout(handle);
      handle = window.setTimeout(() => {
        vscode.setState({
          sessions: state.sessions,
          activeSessionId: state.activeSessionId,
          drafts: state.drafts,
          settings: state.settings,
        });
        handle = null;
      }, 260);
    });
    return () => {
      unsub();
      if (handle !== null) clearTimeout(handle);
    };
  }, []);

  // Keyboard: Escape closes drawers
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (settingsPanelOpen) useStore.getState().setSettingsPanelOpen(false);
        if (sessionsOpen) setSessionsOpen(false);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [settingsPanelOpen, sessionsOpen]);

  useEffect(() => {
    return () => {
      if (copyResetTimerRef.current !== null) {
        window.clearTimeout(copyResetTimerRef.current);
        copyResetTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!enhanceFeedback) {
      return;
    }

    const timer = window.setTimeout(() => {
      setEnhanceFeedback(null);
    }, 5000);

    return () => {
      window.clearTimeout(timer);
    };
  }, [enhanceFeedback]);

  useEffect(() => {
    if (!bannerNotice) {
      return;
    }

    const timer = window.setTimeout(() => {
      setBannerNotice(null);
    }, 4200);

    return () => {
      window.clearTimeout(timer);
    };
  }, [bannerNotice]);

  // Token flush machinery
  useEffect(() => {
    function flushTokenQueue() {
      const cur = pendingRef.current;
      if (!cur || tokenQueueRef.current.length === 0) {
        flushHandleRef.current = null;
        return;
      }
      const chunk = tokenQueueRef.current.join("");
      tokenQueueRef.current = [];
      useStore
        .getState()
        .appendAssistantToken(cur.sessionId, cur.messageId, chunk);
      flushHandleRef.current = null;
    }
    function enqueueToken(token: string) {
      tokenQueueRef.current.push(token);
      if (flushHandleRef.current === null)
        flushHandleRef.current = window.setTimeout(flushTokenQueue, 0);
    }
    function flushAll() {
      const cur = pendingRef.current;
      if (cur && tokenQueueRef.current.length > 0) {
        const chunk = tokenQueueRef.current.join("");
        tokenQueueRef.current = [];
        useStore
          .getState()
          .appendAssistantToken(cur.sessionId, cur.messageId, chunk);
      }
      if (flushHandleRef.current !== null) {
        clearTimeout(flushHandleRef.current);
        flushHandleRef.current = null;
      }
    }

    function onMessage(event: MessageEvent<BackendEvent>) {
      const payload = event.data;
      if (!payload || typeof payload.type !== "string") return;

      switch (payload.type) {
        case "config": {
          useStore.getState().hydrateConfig(payload.value as BackendConfig);
          const sess = getActiveSession(useStore.getState());
          if (sess) {
            vscode.postMessage({
              type: "refreshProviderStatus",
              provider: sess.provider,
            });
            vscode.postMessage({
              type: "requestModelSuggestions",
              provider: sess.provider,
            });
          }
          return;
        }
        case "attachmentsSelected":
          useStore
            .getState()
            .setAttachments((payload.attachments as AttachmentChip[]) ?? []);
          return;
        case "prefillPrompt": {
          const prompt = String(payload.prompt ?? "").trim();
          if (!prompt) {
            return;
          }

          const sessionId = useStore.getState().activeSessionId;
          if (!sessionId) {
            return;
          }

          useStore.getState().setDraft(sessionId, prompt);
          showNotice("info", "Prompt drafted from current editor context.");
          window.requestAnimationFrame(() => {
            const textarea = textareaRef.current;
            if (!textarea) {
              return;
            }

            textarea.focus();
            const cursor = textarea.value.length;
            textarea.setSelectionRange(cursor, cursor);
          });
          return;
        }
        case "providerStatus":
          useStore
            .getState()
            .setProviderStatus(payload.value as ProviderStatus);
          return;
        case "modelSuggestions":
          useStore
            .getState()
            .setModelSuggestions(
              payload.provider as ProviderId,
              (payload.models as string[]) ?? [],
            );
          return;
        case "enhancePromptStart":
          setEnhanceBusy(true);
          return;
        case "enhancePromptResult": {
          setEnhanceBusy(false);

          const sessionId =
            typeof payload.sessionId === "string"
              ? payload.sessionId
              : useStore.getState().activeSessionId;

          if (payload.ok && typeof payload.enhancedPrompt === "string") {
            if (sessionId) {
              useStore.getState().setDraft(sessionId, payload.enhancedPrompt);
            }

            const firstNote = Array.isArray(payload.notes)
              ? String(payload.notes[0] ?? "")
              : "";
            setEnhanceFeedback(
              firstNote ||
                `Enhanced by ${String(payload.model ?? "model-assisted rewrite")}`,
            );

            window.requestAnimationFrame(() => {
              const textarea = textareaRef.current;
              if (!textarea) {
                return;
              }

              textarea.focus();
              textarea.setSelectionRange(
                textarea.value.length,
                textarea.value.length,
              );
            });
          } else {
            setEnhanceFeedback(
              String(payload.error ?? "Prompt enhancement failed."),
            );
          }
          return;
        }
        case "mcpServers": {
          const servers = Array.isArray(payload.servers)
            ? (payload.servers as string[])
                .map((server) => String(server).trim())
                .filter((server) => server.length > 0)
            : [];

          setMcpServers(servers);
          setMcpToolsByServer((current) =>
            Object.fromEntries(
              Object.entries(current).filter(([server]) =>
                servers.includes(server),
              ),
            ),
          );

          setMcpSelectedServer((current) => {
            const next =
              current && servers.includes(current)
                ? current
                : (servers[0] ?? "");

            if (next) {
              vscode.postMessage({
                type: "listMcpTools",
                server: next,
              });
            } else {
              setMcpSelectedTool("");
            }

            return next;
          });
          return;
        }
        case "mcpTools": {
          const server = String(payload.server ?? "").trim();
          const tools = Array.isArray(payload.tools)
            ? (payload.tools as string[])
                .map((tool) => String(tool).trim())
                .filter((tool) => tool.length > 0)
            : [];

          if (!server) {
            return;
          }

          setMcpToolsByServer((current) => ({
            ...current,
            [server]: tools,
          }));

          if (server === mcpSelectedServerRef.current) {
            setMcpSelectedTool((current) =>
              current && tools.includes(current) ? current : (tools[0] ?? ""),
            );
          }
          return;
        }
        case "mcpQuickResult":
          setMcpInvokeBusy(false);
          setMcpInvokeResult({
            ok: Boolean(payload.ok),
            server: String(payload.server ?? ""),
            tool: String(payload.tool ?? ""),
            output: String(payload.output ?? ""),
            latencyMs: Number(payload.latencyMs ?? 0),
          });
          return;
        case "start":
          useStore.getState().setBusy(true);
          reasoningRef.current = [];
          debugRef.current = [];
          tokenQueueRef.current = [];
          {
            const startSessionId =
              typeof payload.sessionId === "string"
                ? payload.sessionId
                : useStore.getState().activeSessionId;

            if (!startSessionId) {
              pendingRef.current = null;
              return;
            }

            pendingRef.current = useStore
              .getState()
              .beginAssistantMessage(startSessionId, {
                provider:
                  typeof payload.provider === "string"
                    ? (payload.provider as ProviderId)
                    : undefined,
                model:
                  typeof payload.model === "string" ? payload.model : undefined,
                mode:
                  typeof payload.mode === "string"
                    ? (payload.mode as AgentMode)
                    : undefined,
              });
          }
          return;
        case "status": {
          const raw = String(payload.message ?? "");
          if (!raw) return;
          debugRef.current.push(raw);
          const cleaned = sanitizeReasoningStatus(raw);
          const recent = reasoningRef.current.slice(-6);
          if (!recent.includes(cleaned)) {
            reasoningRef.current.push(cleaned);
          }

          const cur = pendingRef.current;
          if (cur) {
            useStore
              .getState()
              .updateAssistantTrace(
                cur.sessionId,
                cur.messageId,
                [...reasoningRef.current],
                [...debugRef.current],
              );
          }
          return;
        }
        case "activity": {
          const cur = pendingRef.current;
          if (!cur) {
            return;
          }

          const todos = Array.isArray(payload.todos)
            ? (payload.todos as ActivityTodo[]).filter(
                (todo) =>
                  typeof todo?.id === "string" &&
                  typeof todo?.title === "string" &&
                  typeof todo?.status === "string",
              )
            : [];
          const files = Array.isArray(payload.files)
            ? (payload.files as ActivityFile[]).filter(
                (file) =>
                  typeof file?.path === "string" &&
                  typeof file?.status === "string",
              )
            : [];

          useStore
            .getState()
            .updateAssistantActivity(
              cur.sessionId,
              cur.messageId,
              todos,
              files,
              typeof payload.note === "string" ? payload.note : undefined,
            );
          return;
        }
        case "token": {
          const token = String(payload.token ?? "");
          if (token) enqueueToken(token);
          return;
        }
        case "final": {
          flushAll();
          const cur = pendingRef.current;
          if (!cur) return;
          const resp = payload.response as {
            text: string;
            proposedEdits?: Array<{
              id: string;
              filePath: string;
              summary: string;
              patch: string;
              oldText: string;
              newText: string;
            }>;
          };
          const edits = (resp.proposedEdits ?? []).map((e) => ({
            ...e,
            status: "pending" as EditStatus,
          }));
          useStore
            .getState()
            .finalizeAssistantMessage(
              cur.sessionId,
              cur.messageId,
              resp.text ?? "",
              [...reasoningRef.current],
              [...debugRef.current],
              edits,
            );
          if (
            useStore.getState().settings.autoApplyChanges &&
            edits.length > 0
          ) {
            for (const edit of edits)
              vscode.postMessage({ type: "applyEdit", editId: edit.id });
          }
          return;
        }
        case "stopped": {
          flushAll();
          const cur = pendingRef.current;
          if (!cur) {
            showNotice(
              "info",
              String(payload.message ?? "Request stopped by user."),
            );
            return;
          }

          useStore
            .getState()
            .stopAssistantMessage(
              cur.sessionId,
              cur.messageId,
              String(payload.message ?? "Stopped by user."),
            );
          return;
        }
        case "error": {
          setMcpInvokeBusy(false);
          setEnhanceBusy(false);
          const message = String(payload.message ?? "Request failed.");
          const cur = pendingRef.current;
          if (cur)
            useStore
              .getState()
              .failAssistantMessage(cur.sessionId, cur.messageId, message);
          else showNotice("error", message);
          return;
        }
        case "end":
          useStore.getState().setBusy(false);
          pendingRef.current = null;
          reasoningRef.current = [];
          debugRef.current = [];
          tokenQueueRef.current = [];
          if (flushHandleRef.current !== null) {
            clearTimeout(flushHandleRef.current);
            flushHandleRef.current = null;
          }
          const queued = dequeuePromptRequest();
          if (queued) {
            dispatchPromptRequest(queued);
          }
          return;
        case "editApplied": {
          const editId = String(payload.editId ?? "");
          if (editId)
            useStore
              .getState()
              .updateEditStatus(
                editId,
                "applied",
                `Applied ${payload.filePath ?? ""}`,
              );
          return;
        }
        case "editRejected": {
          const editId = String(payload.editId ?? "");
          if (editId)
            useStore
              .getState()
              .updateEditStatus(editId, "rejected", "Rejected");
          return;
        }
        case "cleared":
          useStore.getState().clearActiveSession();
          return;
        default:
          return;
      }
    }

    window.addEventListener("message", onMessage);
    return () => {
      window.removeEventListener("message", onMessage);
      if (flushHandleRef.current !== null) clearTimeout(flushHandleRef.current);
    };
  }, []);

  // Re-fetch on session/provider change
  useEffect(() => {
    const sess = getActiveSession(useStore.getState());
    if (!sess) return;
    vscode.postMessage({
      type: "refreshProviderStatus",
      provider: sess.provider,
    });
    vscode.postMessage({
      type: "requestModelSuggestions",
      provider: sess.provider,
    });
  }, [activeSession?.id, activeSession?.provider]);

  // Auto-scroll only when following live output
  useEffect(() => {
    if (followStream) {
      scrollToBottom("auto");
    } else {
      syncScrollState();
    }
  }, [activeSession?.messages, followStream, scrollToBottom, syncScrollState]);

  // On session switch, jump to latest message
  useEffect(() => {
    setFollowStream(true);
    window.requestAnimationFrame(() => scrollToBottom("auto"));
  }, [activeSession?.id, scrollToBottom]);

  // Auto-resize textarea
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    const scrollH = ta.scrollHeight;
    ta.style.height = `${Math.min(scrollH, 280)}px`;
    ta.style.overflowY = scrollH > 280 ? "auto" : "hidden";
  }, [activeDraft]);

  // DnD file handler
  const onDropFiles = useCallback(
    async (files: FileList | null): Promise<void> => {
      if (!files || files.length === 0) return;
      for (const file of Array.from(files)) {
        const kind = estimateAttachmentKind(file);
        const id = makeId("att");
        if (kind === "text" && file.size <= 700_000) {
          vscode.postMessage({
            type: "addAttachment",
            attachment: {
              id,
              fileName: file.name,
              mimeType: file.type || "text/plain",
              kind,
              textContent: await file.text(),
              byteSize: file.size,
            },
          });
          continue;
        }
        vscode.postMessage({
          type: "addAttachment",
          attachment: {
            id,
            fileName: file.name,
            mimeType: file.type || "application/octet-stream",
            kind,
            base64Data: arrayBufferToBase64(await file.arrayBuffer()),
            byteSize: file.size,
          },
        });
      }
    },
    [],
  );

  const injectQuickPrompt = useCallback(
    (template: string): void => {
      if (!activeSession) {
        return;
      }

      const current = useStore.getState().drafts[activeSession.id] ?? "";
      const nextValue = current.trim().length
        ? `${current}\n${template}`
        : template;

      useStore.getState().setDraft(activeSession.id, nextValue);

      window.requestAnimationFrame(() => {
        const textarea = textareaRef.current;
        if (!textarea) {
          return;
        }

        textarea.focus();
        const cursor = textarea.value.length;
        textarea.setSelectionRange(cursor, cursor);
      });
    },
    [activeSession],
  );

  // Send
  function onSendPrompt(): void {
    const sess = getActiveSession(useStore.getState());
    if (!sess) return;
    const rawPrompt = (useStore.getState().drafts[sess.id] ?? "").trim();
    if (!rawPrompt) return;

    const attachmentIds = useStore.getState().attachments.map((a) => a.id);
    const accepted = submitPrompt(rawPrompt, sess, attachmentIds);
    if (!accepted) {
      return;
    }

    useStore.getState().setDraft(sess.id, "");
    if (attachmentIds.length > 0) {
      useStore.getState().setAttachments([]);
    }
  }

  function onProviderChange(provider: ProviderId): void {
    useStore.getState().updateActiveSession({ provider });
    vscode.postMessage({ type: "refreshProviderStatus", provider });
    vscode.postMessage({ type: "requestModelSuggestions", provider });
  }
  function onModelChange(model: string): void {
    useStore.getState().updateActiveSession({ model });
  }
  function onModeChange(mode: UiMode): void {
    useStore.getState().updateActiveSession({ mode });
  }

  if (!activeSession) {
    return <div className="nk-empty">Initializing…</div>;
  }

  const providerHealth = providerStatus[activeSession.provider];

  return (
    <div className="nk-shell">
      {/* ── Top bar ── */}
      <header className="nk-topbar">
        <div className="nk-topbar-left">
          <button
            className="nk-icon-btn"
            title="Chat history"
            onClick={() => setSessionsOpen(true)}
          >
            <PanelLeft size={15} />
          </button>
          <div className="nk-brand-block">
            <p className="nk-brand-title">NexCode</p>
            <p className="nk-brand-subtitle">
              {activeSession.title || "New Chat"} •{" "}
              {formatAgentMode(mapUiModeToAgent(activeSession.mode))}
            </p>
          </div>
        </div>

        <div className="nk-topbar-right">
          <StatusDot
            connected={providerHealth?.connected ?? false}
            latencyMs={providerHealth?.latencyMs}
            error={providerHealth?.error}
          />
          <button
            className="nk-icon-btn"
            title="Refresh connection"
            onClick={() => {
              vscode.postMessage({
                type: "refreshProviderStatus",
                provider: activeSession.provider,
              });
              vscode.postMessage({
                type: "requestModelSuggestions",
                provider: activeSession.provider,
              });
            }}
          >
            <RefreshCw size={14} />
          </button>
          <button
            className="nk-icon-btn"
            title="Clear conversation"
            onClick={() => useStore.getState().clearActiveSession()}
          >
            <Eraser size={14} />
          </button>
          <button
            className="nk-icon-btn"
            title="New chat"
            onClick={() => useStore.getState().newSession()}
          >
            <MessageSquarePlus size={14} />
          </button>
          <button
            className="nk-icon-btn"
            title="Settings"
            onClick={() => useStore.getState().setSettingsPanelOpen(true)}
          >
            <Settings size={14} />
          </button>
        </div>
      </header>

      {/* ── Chat area ── */}
      <div
        ref={chatScrollerRef}
        className={`nk-chat-scroller ${isDragOver ? "nk-drag-active" : ""}`}
        onScroll={syncScrollState}
        onDragEnter={(e) => {
          e.preventDefault();
          dragCounterRef.current += 1;
          if (dragCounterRef.current === 1) setIsDragOver(true);
        }}
        onDragOver={(e) => e.preventDefault()}
        onDragLeave={(e) => {
          e.preventDefault();
          dragCounterRef.current -= 1;
          if (dragCounterRef.current <= 0) {
            dragCounterRef.current = 0;
            setIsDragOver(false);
          }
        }}
        onDrop={(e) => {
          e.preventDefault();
          dragCounterRef.current = 0;
          setIsDragOver(false);
          void onDropFiles(e.dataTransfer.files);
        }}
      >
        {isDragOver && (
          <div className="nk-drop-overlay">
            <div className="nk-drop-hint">
              <Plus size={20} />
              <span>Drop files to attach</span>
            </div>
          </div>
        )}

        {activeSession.messages.length === 0 ? (
          <div className="nk-empty-chat">
            <Cpu size={24} style={{ color: "#3a3a48" }} />
            <p
              className="mt-3 text-[13px] font-medium"
              style={{ color: "#6b6b75" }}
            >
              Ask me anything about your code
            </p>
            <div className="nk-empty-hints">
              <span className="nk-empty-hint">
                <Code2 size={10} /> /code
              </span>
              <span className="nk-empty-hint">
                <GitBranch size={10} /> /plan
              </span>
              <span className="nk-empty-hint">
                <Search size={10} /> /fix
              </span>
              <span className="nk-empty-hint">
                <Globe size={10} /> web-search
              </span>
              <span className="nk-empty-hint">
                <Terminal size={10} /> terminal
              </span>
            </div>
          </div>
        ) : (
          <div className="nk-messages-list">
            <AnimatePresence initial={false}>
              {activeSession.messages.map((msg) => (
                <MessageBubble
                  key={msg.id}
                  message={msg}
                  showReasoning={settings.showReasoning}
                  showDebug={settings.showDebugPanel}
                  canRetry={
                    Boolean(findRetryPromptForMessage(activeSession, msg.id)) &&
                    !msg.streaming &&
                    !msg.thinking
                  }
                  copied={copiedMessageId === msg.id}
                  isBusy={isBusy}
                  onAnimatedFrame={() => {
                    if (followStream) {
                      scrollToBottom("auto");
                    }
                  }}
                  onCopy={(message) => {
                    void handleCopyMessage(message);
                  }}
                  onRetry={(message) => handleRetryMessage(message)}
                  onEdit={(message) => handleEditMessage(message)}
                  onPreview={(editId) =>
                    vscode.postMessage({ type: "previewEdit", editId })
                  }
                  onApply={(editId) =>
                    vscode.postMessage({ type: "applyEdit", editId })
                  }
                  onReject={(editId) =>
                    vscode.postMessage({ type: "rejectEdit", editId })
                  }
                />
              ))}
            </AnimatePresence>
          </div>
        )}

        {showScrollToBottom && (
          <button
            className="nk-scroll-bottom-btn"
            title="Scroll to latest"
            onClick={() => {
              setFollowStream(true);
              scrollToBottom("smooth");
            }}
          >
            <ArrowDown size={12} />
          </button>
        )}
      </div>

      {/* ── Copilot-style Input Card ── */}
      <div className="nk-input-area">
        {bannerNotice && (
          <div className={`nk-banner nk-banner--${bannerNotice.kind}`}>
            <span>{bannerNotice.text}</span>
            <button
              className="nk-banner-close"
              title="Dismiss"
              onClick={() => setBannerNotice(null)}
            >
              <X size={11} />
            </button>
          </div>
        )}

        {/* Attachment chips */}
        {attachments.length > 0 && (
          <div className="nk-chips-row">
            {attachments.map((att) => (
              <div key={att.id} className="nk-chip">
                <AttachIcon kind={att.kind} />
                <span className="max-w-[100px] truncate text-[11px]">
                  {att.fileName}
                </span>
                <button
                  className="nk-chip-remove"
                  onClick={() =>
                    vscode.postMessage({
                      type: "removeAttachment",
                      attachmentId: att.id,
                    })
                  }
                >
                  <X size={9} />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Input card */}
        <div className="nk-input-card">
          <div className="nk-input-head">
            <div className="nk-quick-actions">
              {quickPromptActions.map((action) => (
                <button
                  key={action.label}
                  className="nk-quick-action-btn"
                  onClick={() => injectQuickPrompt(action.template)}
                  title={`Insert ${action.template.trim()} command`}
                >
                  {action.label}
                </button>
              ))}
            </div>
            <div className="nk-input-head-meta">
              <span className="nk-draft-metric">
                {Math.ceil(activeDraft.length / 4)} tok est
              </span>
              <span className="nk-draft-metric">
                {activeDraft.length} chars
              </span>
            </div>
          </div>

          {/* Textarea */}
          <textarea
            ref={textareaRef}
            className="nk-textarea"
            placeholder={
              isBusy
                ? "NexCode is responding... write next prompt to queue it"
                : "Ask NexCode to build, fix, review, or explain your code"
            }
            value={activeDraft}
            rows={2}
            onChange={(e) =>
              useStore.getState().setDraft(activeSession.id, e.target.value)
            }
            onKeyDown={(e) => {
              const native = e.nativeEvent as { isComposing?: boolean };
              if (native.isComposing) {
                return;
              }

              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                onSendPrompt();
              }
            }}
          />

          <div className="nk-input-meta-row">
            <div className="nk-command-highlight-row">
              {highlightedCommands.length > 0 ? (
                highlightedCommands.map((command) => (
                  <span key={command} className="nk-command-chip">
                    {command}
                  </span>
                ))
              ) : (
                <span className="nk-command-chip nk-command-chip--hint">
                  Type commands like #fetch, /tool, /edit
                </span>
              )}
            </div>

            <div className="nk-input-meta-actions">
              {enhanceFeedback && (
                <span className="nk-enhance-feedback" title={enhanceFeedback}>
                  {enhanceFeedback}
                </span>
              )}

              <button
                className="nk-enhance-btn"
                title={enhanceBusy ? "Enhancing prompt..." : "Enhance prompt"}
                onClick={handleEnhancePrompt}
                disabled={!activeDraft.trim() || enhanceBusy || isBusy}
              >
                {enhanceBusy ? (
                  <RefreshCw size={11} className="animate-spin" />
                ) : (
                  <Sparkles size={11} />
                )}
              </button>
            </div>
          </div>

          {/* Toolbar row */}
          <div className="nk-input-toolbar">
            {/* Left: attach + selectors */}
            <div className="nk-input-toolbar-left">
              {/* Attach */}
              <button
                className="nk-toolbar-btn"
                title="Attach file"
                onClick={() => vscode.postMessage({ type: "pickAttachments" })}
              >
                <Plus size={14} />
              </button>

              {/* Model selector */}
              <div className="nk-pill-select-wrap">
                <select
                  className="nk-pill-select"
                  value={activeSession.model}
                  onChange={(e) => onModelChange(e.target.value)}
                  title="Model"
                >
                  {modelsForActiveProvider.length === 0 ? (
                    <option value={activeSession.model}>
                      {activeSession.model}
                    </option>
                  ) : (
                    modelsForActiveProvider.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))
                  )}
                </select>
                <ChevronDown size={10} className="nk-pill-arrow" />
              </div>

              {/* Mode selector */}
              <div className="nk-pill-select-wrap">
                <select
                  className="nk-pill-select nk-pill-select--mode"
                  value={activeSession.mode}
                  onChange={(e) => onModeChange(e.target.value as UiMode)}
                  title="Agent mode"
                >
                  <option value="agent">Agent</option>
                  <option value="plan">Plan</option>
                  <option value="ask">Ask</option>
                </select>
                <ChevronDown size={10} className="nk-pill-arrow" />
              </div>

              {/* Token ring */}
              <TokenRing
                sessionMessages={activeSession.messages}
                draftText={activeDraft}
                model={activeSession.model}
              />

              <span className="nk-key-hint">
                Enter to send · Shift+Enter newline
              </span>
            </div>

            {/* Right: queue status + stop + send */}
            <div className="nk-input-toolbar-right">
              {queuedPrompts.length > 0 && (
                <span className="nk-queue-pill">
                  {queuedPrompts.length} queued
                </span>
              )}
              {isBusy && (
                <button
                  className="nk-stop-btn"
                  title="Stop current response"
                  onClick={handleStopRequest}
                >
                  <Square size={11} />
                </button>
              )}
              <button
                className={`nk-send-btn ${isBusy ? "nk-send-btn--queue" : ""}`}
                disabled={!activeDraft.trim()}
                title={
                  isBusy && activeDraft.trim()
                    ? "Queue prompt (Enter)"
                    : "Send (Enter)"
                }
                onClick={onSendPrompt}
              >
                {isBusy ? <Plus size={13} /> : <ArrowUp size={14} />}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ── Overlays ── */}
      <AnimatePresence>
        {sessionsOpen && (
          <SessionsDrawer
            sessions={sessions}
            activeSessionId={activeSessionId}
            onSelect={(id) => useStore.getState().setActiveSession(id)}
            onNew={() => useStore.getState().newSession()}
            onDeleteRequest={(id) => setDeleteTargetSessionId(id)}
            onClose={() => setSessionsOpen(false)}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {settingsPanelOpen && (
          <SettingsDrawer
            activeSession={activeSession}
            settings={settings}
            modelsForProvider={modelsForActiveProvider}
            mcpServers={mcpServers}
            mcpTools={mcpToolsForSelectedServer}
            mcpSelectedServer={mcpSelectedServer}
            mcpSelectedTool={mcpSelectedTool}
            mcpInput={mcpQuickInput}
            mcpInvokeBusy={mcpInvokeBusy}
            mcpInvokeResult={mcpInvokeResult}
            onProviderChange={onProviderChange}
            onModelChange={onModelChange}
            onMcpRefresh={handleMcpRefresh}
            onMcpServerChange={handleMcpServerChange}
            onMcpToolChange={handleMcpToolChange}
            onMcpInputChange={setMcpQuickInput}
            onMcpInvoke={handleMcpInvoke}
            onClose={() => useStore.getState().setSettingsPanelOpen(false)}
          />
        )}
      </AnimatePresence>

      {/* Delete confirm */}
      <AnimatePresence>
        {deleteTargetSessionId && (
          <motion.div
            className="nk-modal-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <motion.div
              className="nk-modal"
              initial={{ y: 10, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 10, opacity: 0 }}
            >
              <div className="flex items-center gap-2 mb-2">
                <Trash2 size={15} style={{ color: "#f87171" }} />
                <span
                  className="text-[13px] font-semibold"
                  style={{ color: "#e2e2e2" }}
                >
                  Delete this chat?
                </span>
              </div>
              <p className="text-[11px] mb-3" style={{ color: "#8b8b9a" }}>
                The session will be removed from local storage.
              </p>
              <div className="flex justify-end gap-2">
                <button
                  className="nk-btn-ghost text-[12px] px-3 py-1.5"
                  onClick={() => setDeleteTargetSessionId(null)}
                >
                  Cancel
                </button>
                <button
                  className="nk-btn-danger text-[12px] px-3 py-1.5"
                  onClick={() => {
                    useStore.getState().deleteSession(deleteTargetSessionId);
                    setDeleteTargetSessionId(null);
                  }}
                >
                  Delete
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(<App />);
}
