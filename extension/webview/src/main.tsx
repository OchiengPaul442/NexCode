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
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
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
} from "lucide-react";

declare const acquireVsCodeApi: <T = unknown>() => {
  postMessage: (message: unknown) => void;
  setState: (state: T) => void;
  getState: () => T | undefined;
};

type ProviderId = "ollama" | "openai-compatible";
type AgentMode = "auto" | "planner" | "coder" | "reviewer" | "qa" | "security";
type UiMode = "architect" | "coder" | "debug" | "review";
type EditStatus = "pending" | "applied" | "rejected";

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

interface SidebarSettings {
  temperature: number;
  showReasoning: boolean;
  autoApplyChanges: boolean;
  requireTerminalApproval: boolean;
  showDebugPanel: boolean;
  enableWebSearch: boolean;
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
    case "coder":
      return "coder";
    case "reviewer":
      return "review";
    case "qa":
      return "debug";
    default:
      return "architect";
  }
}

function mapUiModeToAgent(mode: UiMode): AgentMode {
  switch (mode) {
    case "coder":
      return "coder";
    case "review":
      return "reviewer";
    case "debug":
      return "qa";
    default:
      return "planner";
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
  // Translate the internal mode-meta marker into a readable model header
  const modeMeta = clean.match(
    /^mode:\s*([^|]+)\|\s*provider:\s*([^|]+)\|\s*model:\s*(.+)$/i,
  );
  if (modeMeta) {
    const [, mode, provider, model] = modeMeta;
    return `Using ${model.trim()} on ${provider.trim()} (${mode.trim()} mode)`;
  }
  // Pass all other orchestrator messages through as-is
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

function extractCompletionSummary(text: string): string {
  const flattened = text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]+`/g, " ")
    .replace(/[>#*_]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!flattened) {
    return "Response completed.";
  }

  const sentenceMatch = flattened.match(/^(.{20,220}?[.!?])(?:\s|$)/);
  const sentence = sentenceMatch ? sentenceMatch[1] : flattened.slice(0, 220);
  return sentence.length > 220 ? `${sentence.slice(0, 217)}...` : sentence;
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
        mode: "planner",
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
    model: "qwen2.5-coder:7b",
    mode: "architect" as UiMode,
  };

  const defaultSidebarSettings: SidebarSettings = {
    temperature: 0.2,
    showReasoning: true,
    autoApplyChanges: false,
    requireTerminalApproval: true,
    showDebugPanel: false,
    enableWebSearch: true,
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
function TokenRing({ text }: { text: string }) {
  const estimated = Math.ceil(text.length / 4);
  const max = 8192;
  const pct = Math.min(estimated / max, 1);
  const r = 6;
  const circ = 2 * Math.PI * r;
  const dash = circ * pct;
  const color = pct > 0.85 ? "#f87171" : pct > 0.65 ? "#fb923c" : "#0284c7";

  return (
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

// ─── Thinking Indicator ───────────────────────────────────────────────────────
function ThinkingIndicator({
  reasoning,
  provider,
  model,
  mode,
}: {
  reasoning: string[];
  provider?: ProviderId;
  model?: string;
  mode?: AgentMode;
}) {
  const modelLabel = model?.trim() ? model.trim() : "selected model";
  const providerLabel = provider ?? "provider";
  const modeLabel = formatAgentMode(mode).toLowerCase();
  const latestStep = reasoning.at(-1);
  const visibleSteps = Array.from(new Set(reasoning)).slice(-3);
  const primaryText = latestStep || `Thinking with ${modelLabel}`;

  return (
    <div className="nk-thinking-wrap">
      <div className="nk-thinking-row">
        <Cpu size={12} className="nk-thinking-icon" />
        <span className="nk-thinking-label nk-thinking-label--shimmer">
          {primaryText}
        </span>
      </div>

      <div className="nk-thinking-subline">
        {providerLabel} • {modeLabel} mode
      </div>

      {visibleSteps.length > 0 && (
        <ol className="nk-thinking-trace">
          {visibleSteps.map((step, index) => {
            const isLatest = index === visibleSteps.length - 1;
            return (
              <li
                key={`thinking-step-${index}-${step}`}
                className={`nk-thinking-trace-item ${isLatest ? "nk-thinking-trace-item--active" : ""}`}
              >
                <Zap size={9} style={{ color: "#0284c7", flexShrink: 0 }} />
                <span>{step}</span>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

function CompletionSummary({ message }: { message: ChatMessage }) {
  if (
    message.role !== "assistant" ||
    message.streaming ||
    message.thinking ||
    message.error ||
    message.stopped
  ) {
    return null;
  }

  const bullets = [
    message.mode ? `Mode: ${formatAgentMode(message.mode)}` : null,
    message.model ? `Model: ${message.model}` : null,
    `${message.proposedEdits.length} edit proposal${message.proposedEdits.length === 1 ? "" : "s"}`,
    `${message.reasoning.length} reasoning step${message.reasoning.length === 1 ? "" : "s"}`,
  ].filter((entry): entry is string => Boolean(entry));

  return (
    <div className="nk-summary-card">
      <p className="nk-summary-title">Summary</p>
      <p className="nk-summary-line">
        {extractCompletionSummary(message.text)}
      </p>
      <ul className="nk-summary-list">
        {bullets.map((item) => (
          <li key={`${message.id}-${item}`}>{item}</li>
        ))}
      </ul>
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
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      className={`nk-msg-row ${isUser ? "nk-msg-row--user" : "nk-msg-row--bot"}`}
    >
      {/* Bubble */}
      <div
        className={`nk-msg-content ${isUser ? "nk-msg-content--user" : "nk-msg-content--bot"}`}
      >
        {/* Thinking state */}
        {message.thinking && !message.text && (
          <ThinkingIndicator
            reasoning={message.reasoning}
            provider={message.provider}
            model={message.model}
            mode={message.mode}
          />
        )}

        {/* Main text */}
        {(message.text || !message.thinking) && (
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
              <div className="markdown-body text-[13px] leading-relaxed">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {message.text || ""}
                </ReactMarkdown>
              </div>
            )}
          </div>
        )}

        {/* Reasoning */}
        {!isUser &&
          showReasoning &&
          message.reasoning.length > 0 &&
          !(message.thinking && !message.text) && (
            <div
              className={`nk-reasoning-panel ${message.streaming || message.thinking ? "nk-reasoning-panel--live" : ""}`}
            >
              <div className="nk-reasoning-panel-header">
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
              </div>
              <ol className="nk-reasoning-list">
                {message.reasoning.map((item, i) => {
                  const isLatest = i === message.reasoning.length - 1;
                  return (
                    <li
                      key={`${message.id}-r-${i}`}
                      className={`nk-reasoning-item ${isLatest && (message.streaming || message.thinking) ? "nk-reasoning-item--active" : ""}`}
                    >
                      <Zap
                        size={9}
                        style={{ color: "#0284c7", flexShrink: 0 }}
                      />
                      <span>{item}</span>
                    </li>
                  );
                })}
              </ol>
            </div>
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

        {!isUser && <CompletionSummary message={message} />}
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

        <div className="flex-1 overflow-auto px-2 pb-2 space-y-0.5">
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
  onProviderChange,
  onModelChange,
  onClose,
}: {
  activeSession: Session;
  settings: SidebarSettings;
  modelsForProvider: string[];
  onProviderChange: (p: ProviderId) => void;
  onModelChange: (m: string) => void;
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

  // Fixed DnD: counter-based to avoid nested element false leaves
  const dragCounterRef = useRef(0);
  const [isDragOver, setIsDragOver] = useState(false);

  const chatScrollerRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
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
      if (
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

  // Token flush machinery
  useEffect(() => {
    function flushTokenQueue() {
      const cur = pendingRef.current;
      if (!cur || tokenQueueRef.current.length === 0) {
        flushHandleRef.current = null;
        return;
      }
      const chunk = tokenQueueRef.current.splice(0, 8).join("");
      useStore
        .getState()
        .appendAssistantToken(cur.sessionId, cur.messageId, chunk);
      if (tokenQueueRef.current.length > 0) {
        flushHandleRef.current = window.setTimeout(flushTokenQueue, 14);
      } else {
        flushHandleRef.current = null;
      }
    }
    function enqueueToken(token: string) {
      tokenQueueRef.current.push(...token.split(""));
      if (flushHandleRef.current === null)
        flushHandleRef.current = window.setTimeout(flushTokenQueue, 12);
    }
    function flushAll() {
      while (tokenQueueRef.current.length > 0) {
        const cur = pendingRef.current;
        if (!cur) {
          tokenQueueRef.current = [];
          break;
        }
        const chunk = tokenQueueRef.current.splice(0, 32).join("");
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
          const cur = pendingRef.current;
          if (cur)
            useStore
              .getState()
              .failAssistantMessage(
                cur.sessionId,
                cur.messageId,
                String(payload.message ?? "Request failed."),
              );
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
    ta.style.height = "0px";
    ta.style.height = `${Math.min(ta.scrollHeight, 420)}px`;
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
      {/* ── Minimal Top bar ── */}
      <header className="nk-topbar">
        <div className="flex items-center gap-1">
          <button
            className="nk-icon-btn"
            title="Chat history"
            onClick={() => setSessionsOpen(true)}
          >
            <PanelLeft size={15} />
          </button>
        </div>

        <div className="flex items-center gap-1 shrink-0">
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
          {/* Textarea */}
          <textarea
            ref={textareaRef}
            className="nk-textarea"
            placeholder="Ask Nexcode…"
            value={activeDraft}
            rows={1}
            onChange={(e) =>
              useStore.getState().setDraft(activeSession.id, e.target.value)
            }
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                onSendPrompt();
              }
            }}
          />

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
                  <option value="architect">Architect</option>
                  <option value="coder">Coder</option>
                  <option value="debug">Debug</option>
                  <option value="review">Review</option>
                </select>
                <ChevronDown size={10} className="nk-pill-arrow" />
              </div>

              {/* Token ring */}
              <TokenRing text={activeDraft} />
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
            onProviderChange={onProviderChange}
            onModelChange={onModelChange}
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
