import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { AnimatePresence, motion } from "framer-motion";
import { create } from "zustand";
import ReactMarkdown from "react-markdown";

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
  streaming?: boolean;
  thinking?: boolean;
  error?: boolean;
  reasoning: string[];
  debug: string[];
  proposedEdits: ProposedEdit[];
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
  addUserMessage: (text: string) => void;
  beginAssistantMessage: () => { sessionId: string; messageId: string } | null;
  appendAssistantToken: (
    sessionId: string,
    messageId: string,
    token: string,
  ) => void;
  finalizeAssistantMessage: (
    sessionId: string,
    messageId: string,
    text: string,
    reasoning: string[],
    debug: string[],
    edits: ProposedEdit[],
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

const persisted = vscode.getState();

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
  const normalized = raw.toLowerCase();
  if (
    normalized.includes("collecting workspace") ||
    normalized.includes("memory context")
  ) {
    return "Gathering workspace and memory context";
  }
  if (normalized.includes("routing request")) {
    return "Routing request to best agent path";
  }
  if (normalized.includes("multi-agent workflow")) {
    return "Coordinating specialist agents";
  }
  if (normalized.includes("tool command")) {
    return "Executing selected tool";
  }
  if (normalized.includes("edit proposal")) {
    return "Preparing code diff proposal";
  }
  if (normalized.startsWith("mode:")) {
    return "Initializing response pipeline";
  }
  if (normalized.includes("specialist agent")) {
    return "Running specialist analysis";
  }
  return raw;
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

const useStore = create<StoreState>((set, get) => {
  const initialDefaults = {
    provider: "ollama" as ProviderId,
    model: "qwen2.5-coder:7b",
    mode: "architect" as UiMode,
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
    settings: persisted?.settings ?? {
      temperature: 0.2,
      showReasoning: true,
      autoApplyChanges: false,
      requireTerminalApproval: true,
      showDebugPanel: false,
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
    addUserMessage: (text) => {
      set((state) => {
        const activeSessionId = state.activeSessionId;
        if (!activeSessionId) {
          return state;
        }

        return {
          sessions: state.sessions.map((session) => {
            if (session.id !== activeSessionId) {
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
    beginAssistantMessage: () => {
      const activeSessionId = get().activeSessionId;
      if (!activeSessionId) {
        return null;
      }

      const messageId = makeId("msg");

      set((state) => ({
        sessions: state.sessions.map((session) =>
          session.id === activeSessionId
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
        sessionId: activeSessionId,
        messageId,
      };
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

function MessageBubble({
  message,
  showReasoning,
  showDebug,
  onPreview,
  onApply,
  onReject,
}: {
  message: ChatMessage;
  showReasoning: boolean;
  showDebug: boolean;
  onPreview: (editId: string) => void;
  onApply: (editId: string) => void;
  onReject: (editId: string) => void;
}) {
  const isUser = message.role === "user";

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      className={`flex w-full ${isUser ? "justify-end" : "justify-start"}`}
    >
      <div
        className={[
          "max-w-[92%] rounded-2xl border px-3 py-2 shadow-glow",
          isUser
            ? "border-cyan-500/45 bg-cyan-600/20 text-cyan-50"
            : message.error
              ? "border-rose-500/45 bg-rose-500/15 text-rose-100"
              : "border-slate-700/80 bg-slate-900/70 text-slate-100",
        ].join(" ")}
      >
        <div className="label-caps mb-1">{isUser ? "You" : "Nexcode"}</div>

        {message.thinking && !message.text ? (
          <div className="thinking-shimmer rounded-xl border border-slate-700/80 px-3 py-3 text-sm text-slate-200">
            Nexcode is thinking...
          </div>
        ) : isUser ? (
          <pre className="m-0 whitespace-pre-wrap text-sm leading-relaxed">
            {message.text}
          </pre>
        ) : (
          <div className="markdown-body text-sm leading-relaxed">
            <ReactMarkdown>{message.text || ""}</ReactMarkdown>
          </div>
        )}

        {!isUser && showReasoning && message.reasoning.length > 0 ? (
          <details className="mt-2 rounded-xl border border-slate-700/70 bg-slate-950/65 p-2 text-xs text-slate-300">
            <summary className="cursor-pointer font-medium text-slate-200">
              Show reasoning
            </summary>
            <ol className="mt-2 list-decimal space-y-1 pl-5">
              {message.reasoning.map((item, index) => (
                <li key={`${message.id}-reasoning-${index}`}>{item}</li>
              ))}
            </ol>
          </details>
        ) : null}

        {!isUser && showDebug && message.debug.length > 0 ? (
          <details className="mt-2 rounded-xl border border-slate-700/70 bg-slate-950/65 p-2 text-xs text-slate-300">
            <summary className="cursor-pointer font-medium text-slate-200">
              Debug details
            </summary>
            <ol className="mt-2 list-decimal space-y-1 pl-5">
              {message.debug.map((item, index) => (
                <li key={`${message.id}-debug-${index}`}>{item}</li>
              ))}
            </ol>
          </details>
        ) : null}

        {message.proposedEdits.length > 0 ? (
          <div className="mt-3 space-y-2">
            {message.proposedEdits.map((edit) => (
              <div
                key={edit.id}
                className="rounded-xl border border-slate-700/80 bg-slate-950/70 p-2"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="text-xs font-semibold text-slate-200">
                    {edit.filePath}
                  </div>
                  <span
                    className={[
                      "rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.12em]",
                      edit.status === "applied"
                        ? "border-emerald-500/40 bg-emerald-500/20 text-emerald-100"
                        : edit.status === "rejected"
                          ? "border-rose-500/40 bg-rose-500/20 text-rose-100"
                          : "border-cyan-500/40 bg-cyan-500/20 text-cyan-100",
                    ].join(" ")}
                  >
                    {edit.statusLabel ?? edit.status}
                  </span>
                </div>

                <div className="mt-1 text-xs text-slate-400">
                  {edit.summary}
                </div>
                <pre className="mt-2 max-h-40 overflow-auto rounded-lg border border-slate-700/70 bg-slate-900/85 p-2 text-[11px] text-slate-200">
                  {edit.patch || edit.newText || ""}
                </pre>

                <div className="mt-2 grid grid-cols-3 gap-2">
                  <button
                    className="ghost-btn"
                    onClick={() => onPreview(edit.id)}
                  >
                    Preview
                  </button>
                  <button
                    className="primary-btn"
                    disabled={edit.status !== "pending"}
                    onClick={() => onApply(edit.id)}
                  >
                    Apply
                  </button>
                  <button
                    className="danger-btn"
                    disabled={edit.status !== "pending"}
                    onClick={() => onReject(edit.id)}
                  >
                    Reject
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </motion.div>
  );
}

function App() {
  const sessions = useStore((state) => state.sessions);
  const activeSessionId = useStore((state) => state.activeSessionId);
  const drafts = useStore((state) => state.drafts);
  const attachments = useStore((state) => state.attachments);
  const isBusy = useStore((state) => state.isBusy);
  const settingsPanelOpen = useStore((state) => state.settingsPanelOpen);
  const settings = useStore((state) => state.settings);
  const providerStatus = useStore((state) => state.providerStatus);
  const modelSuggestions = useStore((state) => state.modelSuggestions);

  const [deleteTargetSessionId, setDeleteTargetSessionId] = useState<
    string | null
  >(null);
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

  const activeSession = useMemo(
    () => sessions.find((session) => session.id === activeSessionId),
    [sessions, activeSessionId],
  );

  const activeDraft = activeSession ? (drafts[activeSession.id] ?? "") : "";

  const modelsForActiveProvider = useMemo(() => {
    if (!activeSession) {
      return [];
    }

    const current = activeSession.model ? [activeSession.model] : [];
    return [
      ...new Set([
        ...current,
        ...(modelSuggestions[activeSession.provider] ?? []),
      ]),
    ];
  }, [activeSession, modelSuggestions]);

  useEffect(() => {
    let persistHandle: number | null = null;

    const unsubscribe = useStore.subscribe((state) => {
      const snapshot: PersistedState = {
        sessions: state.sessions,
        activeSessionId: state.activeSessionId,
        drafts: state.drafts,
        settings: state.settings,
      };

      if (persistHandle !== null) {
        clearTimeout(persistHandle);
      }

      persistHandle = window.setTimeout(() => {
        vscode.setState(snapshot);
        persistHandle = null;
      }, 260);
    });

    return () => {
      unsubscribe();
      if (persistHandle !== null) {
        clearTimeout(persistHandle);
      }
    };
  }, []);

  useEffect(() => {
    function flushTokenQueue() {
      const currentPending = pendingRef.current;
      if (!currentPending || tokenQueueRef.current.length === 0) {
        flushHandleRef.current = null;
        return;
      }

      const nextChunk = tokenQueueRef.current.splice(0, 8).join("");
      useStore
        .getState()
        .appendAssistantToken(
          currentPending.sessionId,
          currentPending.messageId,
          nextChunk,
        );

      if (tokenQueueRef.current.length > 0) {
        flushHandleRef.current = window.setTimeout(flushTokenQueue, 14);
      } else {
        flushHandleRef.current = null;
      }
    }

    function enqueueToken(token: string) {
      tokenQueueRef.current.push(...token.split(""));
      if (flushHandleRef.current === null) {
        flushHandleRef.current = window.setTimeout(flushTokenQueue, 12);
      }
    }

    function flushAllQueuedTokens() {
      while (tokenQueueRef.current.length > 0) {
        const currentPending = pendingRef.current;
        if (!currentPending) {
          tokenQueueRef.current = [];
          break;
        }

        const chunk = tokenQueueRef.current.splice(0, 32).join("");
        useStore
          .getState()
          .appendAssistantToken(
            currentPending.sessionId,
            currentPending.messageId,
            chunk,
          );
      }

      if (flushHandleRef.current !== null) {
        clearTimeout(flushHandleRef.current);
        flushHandleRef.current = null;
      }
    }

    function onMessage(event: MessageEvent<BackendEvent>) {
      const payload = event.data;
      if (!payload || typeof payload.type !== "string") {
        return;
      }

      switch (payload.type) {
        case "config": {
          useStore.getState().hydrateConfig(payload.value as BackendConfig);

          const currentSession = getActiveSession(useStore.getState());
          if (currentSession) {
            vscode.postMessage({
              type: "refreshProviderStatus",
              provider: currentSession.provider,
            });
            vscode.postMessage({
              type: "requestModelSuggestions",
              provider: currentSession.provider,
            });
          }
          return;
        }
        case "attachmentsSelected": {
          useStore
            .getState()
            .setAttachments((payload.attachments as AttachmentChip[]) ?? []);
          return;
        }
        case "providerStatus": {
          useStore
            .getState()
            .setProviderStatus(payload.value as ProviderStatus);
          return;
        }
        case "modelSuggestions": {
          const provider = payload.provider as ProviderId;
          const models = (payload.models as string[]) ?? [];
          useStore.getState().setModelSuggestions(provider, models);
          return;
        }
        case "start": {
          useStore.getState().setBusy(true);
          reasoningRef.current = [];
          debugRef.current = [];
          tokenQueueRef.current = [];
          pendingRef.current = useStore.getState().beginAssistantMessage();
          return;
        }
        case "status": {
          const raw = String(payload.message ?? "");
          if (raw.length === 0) {
            return;
          }

          debugRef.current.push(raw);
          const cleaned = sanitizeReasoningStatus(raw);
          if (reasoningRef.current.at(-1) !== cleaned) {
            reasoningRef.current.push(cleaned);
          }
          return;
        }
        case "token": {
          const token = String(payload.token ?? "");
          if (token.length > 0) {
            enqueueToken(token);
          }
          return;
        }
        case "final": {
          flushAllQueuedTokens();

          const currentPending = pendingRef.current;
          if (!currentPending) {
            return;
          }

          const response = payload.response as {
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

          const edits = (response.proposedEdits ?? []).map((edit) => ({
            ...edit,
            status: "pending" as EditStatus,
          }));

          useStore
            .getState()
            .finalizeAssistantMessage(
              currentPending.sessionId,
              currentPending.messageId,
              response.text ?? "",
              [...reasoningRef.current],
              [...debugRef.current],
              edits,
            );

          if (
            useStore.getState().settings.autoApplyChanges &&
            edits.length > 0
          ) {
            for (const edit of edits) {
              vscode.postMessage({ type: "applyEdit", editId: edit.id });
            }
          }
          return;
        }
        case "error": {
          const currentPending = pendingRef.current;
          if (currentPending) {
            useStore
              .getState()
              .failAssistantMessage(
                currentPending.sessionId,
                currentPending.messageId,
                String(payload.message ?? "Request failed."),
              );
          }
          return;
        }
        case "end": {
          useStore.getState().setBusy(false);
          pendingRef.current = null;
          reasoningRef.current = [];
          debugRef.current = [];
          tokenQueueRef.current = [];
          if (flushHandleRef.current !== null) {
            clearTimeout(flushHandleRef.current);
            flushHandleRef.current = null;
          }
          return;
        }
        case "editApplied": {
          const editId = String(payload.editId ?? "");
          const filePath = String(payload.filePath ?? "");
          if (editId) {
            useStore
              .getState()
              .updateEditStatus(editId, "applied", `Applied ${filePath}`);
          }
          return;
        }
        case "editRejected": {
          const editId = String(payload.editId ?? "");
          if (editId) {
            useStore
              .getState()
              .updateEditStatus(editId, "rejected", "Rejected");
          }
          return;
        }
        case "cleared": {
          useStore.getState().clearActiveSession();
          return;
        }
        default:
          return;
      }
    }

    window.addEventListener("message", onMessage);
    return () => {
      window.removeEventListener("message", onMessage);
      if (flushHandleRef.current !== null) {
        clearTimeout(flushHandleRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const currentSession = getActiveSession(useStore.getState());
    if (!currentSession) {
      return;
    }

    vscode.postMessage({
      type: "refreshProviderStatus",
      provider: currentSession.provider,
    });
    vscode.postMessage({
      type: "requestModelSuggestions",
      provider: currentSession.provider,
    });
  }, [activeSession?.id, activeSession?.provider]);

  useEffect(() => {
    if (!chatScrollerRef.current) {
      return;
    }

    chatScrollerRef.current.scrollTop = chatScrollerRef.current.scrollHeight;
  }, [activeSession?.messages]);

  useEffect(() => {
    if (!textareaRef.current) {
      return;
    }

    textareaRef.current.style.height = "0px";
    textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 220)}px`;
  }, [activeDraft]);

  async function onDropFiles(files: FileList | null): Promise<void> {
    if (!files || files.length === 0) {
      return;
    }

    for (const file of Array.from(files)) {
      const kind = estimateAttachmentKind(file);
      const id = makeId("att");

      if (kind === "text" && file.size <= 700_000) {
        const textContent = await file.text();
        vscode.postMessage({
          type: "addAttachment",
          attachment: {
            id,
            fileName: file.name,
            mimeType: file.type || "text/plain",
            kind,
            textContent,
            byteSize: file.size,
          },
        });
        continue;
      }

      const base64Data = arrayBufferToBase64(await file.arrayBuffer());
      vscode.postMessage({
        type: "addAttachment",
        attachment: {
          id,
          fileName: file.name,
          mimeType: file.type || "application/octet-stream",
          kind,
          base64Data,
          byteSize: file.size,
        },
      });
    }
  }

  function onSendPrompt(): void {
    const currentSession = getActiveSession(useStore.getState());
    if (!currentSession || isBusy) {
      return;
    }

    const rawPrompt = (
      useStore.getState().drafts[currentSession.id] ?? ""
    ).trim();
    if (!rawPrompt) {
      return;
    }

    const parsed = parseSlashCommand(rawPrompt, currentSession.mode);

    if (
      settings.requireTerminalApproval &&
      /^\/tool\s+terminal\s+/i.test(parsed.prompt)
    ) {
      const command = parsed.prompt.replace(/^\/tool\s+terminal\s+/i, "");
      const approved = window.confirm(
        [
          "Approval required for terminal command:",
          "",
          command,
          "",
          "Continue?",
        ].join("\n"),
      );

      if (!approved) {
        return;
      }
    }

    useStore.getState().addUserMessage(rawPrompt);
    useStore.getState().setDraft(currentSession.id, "");

    vscode.postMessage({
      type: "sendPrompt",
      prompt: parsed.prompt,
      provider: currentSession.provider,
      model: currentSession.model,
      mode: parsed.mode,
      temperature: settings.temperature,
      attachmentIds: useStore
        .getState()
        .attachments.map((attachment) => attachment.id),
    });
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
    return (
      <div className="p-4 text-sm text-slate-300">Initializing Nexcode...</div>
    );
  }

  const providerHealth = providerStatus[activeSession.provider];
  const providerLabel = providerHealth?.connected
    ? `${activeSession.provider}: connected${providerHealth.latencyMs ? ` (${providerHealth.latencyMs}ms)` : ""}`
    : `${activeSession.provider}: disconnected`;

  return (
    <div className="nexcode-shell">
      <aside className="panel-edge flex min-h-0 flex-col px-3 py-3">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="text-sm font-semibold tracking-wide text-slate-100">
            Sessions
          </div>
          <button
            className="primary-btn"
            onClick={() => useStore.getState().newSession()}
          >
            + New Chat
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto pr-1">
          <AnimatePresence>
            {sessions.map((session) => (
              <motion.button
                key={session.id}
                layout
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                onClick={() => useStore.getState().setActiveSession(session.id)}
                className={[
                  "mb-2 w-full rounded-xl border p-2 text-left transition",
                  session.id === activeSession.id
                    ? "border-cyan-500/45 bg-cyan-500/10"
                    : "border-slate-700/70 bg-slate-900/50 hover:border-slate-500/70",
                ].join(" ")}
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="line-clamp-2 text-sm font-medium text-slate-100">
                      {session.title}
                    </div>
                    <div className="mt-1 text-[11px] text-slate-400">
                      {formatRelativeTime(session.updatedAt)}
                    </div>
                  </div>
                  <button
                    className="rounded-lg border border-slate-700/70 px-2 py-1 text-[10px] text-slate-300 hover:border-rose-500/60 hover:text-rose-200"
                    onClick={(event) => {
                      event.stopPropagation();
                      setDeleteTargetSessionId(session.id);
                    }}
                  >
                    Delete
                  </button>
                </div>
              </motion.button>
            ))}
          </AnimatePresence>
        </div>
      </aside>

      <section className="flex min-h-0 flex-col gap-3 px-3 py-3">
        <header className="slate-card p-2">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm font-semibold tracking-wide text-slate-100">
              NEXCODE-KIBOKO
            </div>
            <div
              className={[
                "rounded-full border px-2 py-1 text-[10px] uppercase tracking-[0.13em]",
                providerHealth?.connected
                  ? "border-emerald-500/45 bg-emerald-500/20 text-emerald-100"
                  : "border-rose-500/45 bg-rose-500/20 text-rose-100",
              ].join(" ")}
              title={providerHealth?.error || "Provider health"}
            >
              {providerLabel}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <label className="label-caps col-span-1">
              Provider
              <select
                className="input-base mt-1"
                value={activeSession.provider}
                onChange={(event) =>
                  onProviderChange(event.target.value as ProviderId)
                }
              >
                <option value="ollama">Ollama</option>
                <option value="openai-compatible">OpenAI-compatible</option>
              </select>
            </label>

            <label className="label-caps col-span-1">
              Model
              <select
                className="input-base mt-1"
                value={activeSession.model}
                onChange={(event) => onModelChange(event.target.value)}
              >
                {modelsForActiveProvider.length === 0 ? (
                  <option value={activeSession.model}>
                    {activeSession.model}
                  </option>
                ) : (
                  modelsForActiveProvider.map((model) => (
                    <option key={model} value={model}>
                      {model}
                    </option>
                  ))
                )}
              </select>
            </label>

            <label className="label-caps col-span-1">
              Mode
              <select
                className="input-base mt-1"
                value={activeSession.mode}
                onChange={(event) => onModeChange(event.target.value as UiMode)}
              >
                <option value="architect">Architect</option>
                <option value="coder">Coder</option>
                <option value="debug">Debug</option>
                <option value="review">Review</option>
              </select>
            </label>

            <div className="col-span-1 flex items-end justify-end gap-2">
              <button
                className="ghost-btn"
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
                Refresh
              </button>
              <button
                className="ghost-btn"
                onClick={() => useStore.getState().clearActiveSession()}
              >
                Clear
              </button>
              <button
                className="ghost-btn"
                title="Settings"
                onClick={() => useStore.getState().setSettingsPanelOpen(true)}
              >
                ⚙
              </button>
            </div>
          </div>
        </header>

        <div
          ref={chatScrollerRef}
          className="slate-card min-h-0 flex-1 overflow-auto p-3"
        >
          <div className="space-y-3">
            <AnimatePresence>
              {activeSession.messages.map((message) => (
                <MessageBubble
                  key={message.id}
                  message={message}
                  showReasoning={settings.showReasoning}
                  showDebug={settings.showDebugPanel}
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
        </div>

        <div
          className={[
            "slate-card shrink-0 p-3 transition",
            isDragOver ? "border-cyan-400/70 bg-cyan-500/10" : "",
          ].join(" ")}
          onDragOver={(event) => {
            event.preventDefault();
            setIsDragOver(true);
          }}
          onDragLeave={(event) => {
            event.preventDefault();
            setIsDragOver(false);
          }}
          onDrop={(event) => {
            event.preventDefault();
            setIsDragOver(false);
            void onDropFiles(event.dataTransfer.files);
          }}
        >
          <div className="mb-2 flex items-center justify-between gap-2">
            <button
              className="ghost-btn"
              onClick={() => vscode.postMessage({ type: "pickAttachments" })}
            >
              Attach
            </button>
            <div className="text-[11px] text-slate-400">
              Drop files here or use Attach
            </div>
          </div>

          <div className="mb-2 flex flex-wrap gap-2">
            {attachments.length === 0 ? (
              <div className="rounded-xl border border-slate-700/70 bg-slate-900/70 px-3 py-1 text-xs text-slate-400">
                No attachments selected
              </div>
            ) : (
              attachments.map((attachment) => (
                <div
                  key={attachment.id}
                  className="flex items-center gap-2 rounded-xl border border-slate-700/70 bg-slate-900/80 px-2 py-1 text-xs text-slate-200"
                >
                  <span className="max-w-[160px] truncate">
                    {attachment.fileName}
                  </span>
                  <button
                    className="rounded-lg border border-slate-700/70 px-1.5 py-0.5 text-[10px] hover:border-rose-500/60"
                    onClick={() =>
                      vscode.postMessage({
                        type: "removeAttachment",
                        attachmentId: attachment.id,
                      })
                    }
                  >
                    Remove
                  </button>
                </div>
              ))
            )}
          </div>

          <textarea
            ref={textareaRef}
            className="input-base max-h-56 min-h-[76px] resize-none"
            placeholder="Ask Nexcode to build, fix, or explain code..."
            value={activeDraft}
            onChange={(event) =>
              useStore.getState().setDraft(activeSession.id, event.target.value)
            }
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
                event.preventDefault();
                onSendPrompt();
              }
            }}
          />

          <div className="mt-2 flex items-center justify-between gap-2">
            <div className="text-[11px] text-slate-400">
              Slash commands: /plan /code /fix /test /explain
            </div>
            <button
              className="primary-btn"
              disabled={isBusy}
              onClick={onSendPrompt}
            >
              {isBusy ? "Responding..." : "Send"}
            </button>
          </div>
        </div>
      </section>

      <AnimatePresence>
        {settingsPanelOpen ? (
          <motion.div
            className="absolute inset-0 z-50 flex justify-end bg-slate-950/60"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => useStore.getState().setSettingsPanelOpen(false)}
          >
            <motion.div
              className="h-full w-[320px] border-l border-slate-700/80 bg-slate-950/95 p-4 backdrop-blur"
              initial={{ x: 28, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: 24, opacity: 0 }}
              transition={{ type: "spring", stiffness: 280, damping: 30 }}
              onClick={(event) => event.stopPropagation()}
            >
              <div className="mb-3 flex items-center justify-between">
                <div className="text-sm font-semibold text-slate-100">
                  Settings
                </div>
                <button
                  className="ghost-btn"
                  onClick={() =>
                    useStore.getState().setSettingsPanelOpen(false)
                  }
                >
                  Close
                </button>
              </div>

              <div className="space-y-3">
                <label className="label-caps block">
                  Provider
                  <select
                    className="input-base mt-1"
                    value={activeSession.provider}
                    onChange={(event) =>
                      onProviderChange(event.target.value as ProviderId)
                    }
                  >
                    <option value="ollama">Ollama</option>
                    <option value="openai-compatible">OpenAI-compatible</option>
                  </select>
                </label>

                <label className="label-caps block">
                  Model
                  <input
                    className="input-base mt-1"
                    value={activeSession.model}
                    onChange={(event) => onModelChange(event.target.value)}
                  />
                </label>

                <label className="label-caps block">
                  Temperature ({settings.temperature.toFixed(2)})
                  <input
                    className="mt-2 w-full accent-cyan-400"
                    type="range"
                    min={0}
                    max={2}
                    step={0.05}
                    value={settings.temperature}
                    onChange={(event) =>
                      useStore
                        .getState()
                        .setSettings({
                          temperature: Number.parseFloat(event.target.value),
                        })
                    }
                  />
                </label>

                <label className="flex items-center justify-between rounded-xl border border-slate-700/70 bg-slate-900/70 px-3 py-2 text-xs text-slate-200">
                  Show reasoning
                  <input
                    type="checkbox"
                    checked={settings.showReasoning}
                    onChange={(event) =>
                      useStore
                        .getState()
                        .setSettings({ showReasoning: event.target.checked })
                    }
                  />
                </label>

                <label className="flex items-center justify-between rounded-xl border border-slate-700/70 bg-slate-900/70 px-3 py-2 text-xs text-slate-200">
                  Show debug panel
                  <input
                    type="checkbox"
                    checked={settings.showDebugPanel}
                    onChange={(event) =>
                      useStore
                        .getState()
                        .setSettings({ showDebugPanel: event.target.checked })
                    }
                  />
                </label>

                <label className="flex items-center justify-between rounded-xl border border-slate-700/70 bg-slate-900/70 px-3 py-2 text-xs text-slate-200">
                  Auto-apply changes
                  <input
                    type="checkbox"
                    checked={settings.autoApplyChanges}
                    onChange={(event) =>
                      useStore
                        .getState()
                        .setSettings({ autoApplyChanges: event.target.checked })
                    }
                  />
                </label>

                <label className="flex items-center justify-between rounded-xl border border-slate-700/70 bg-slate-900/70 px-3 py-2 text-xs text-slate-200">
                  Require terminal approval
                  <input
                    type="checkbox"
                    checked={settings.requireTerminalApproval}
                    onChange={(event) =>
                      useStore
                        .getState()
                        .setSettings({
                          requireTerminalApproval: event.target.checked,
                        })
                    }
                  />
                </label>
              </div>
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <AnimatePresence>
        {deleteTargetSessionId ? (
          <motion.div
            className="absolute inset-0 z-50 flex items-center justify-center bg-slate-950/65 px-4"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <motion.div
              className="w-full max-w-sm rounded-2xl border border-slate-700/80 bg-slate-900/95 p-4 shadow-glow"
              initial={{ y: 12, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 12, opacity: 0 }}
            >
              <div className="text-sm font-semibold text-slate-100">
                Delete chat session?
              </div>
              <div className="mt-2 text-xs text-slate-300">
                This action removes the selected session from local cache.
              </div>

              <div className="mt-4 flex justify-end gap-2">
                <button
                  className="ghost-btn"
                  onClick={() => setDeleteTargetSessionId(null)}
                >
                  Cancel
                </button>
                <button
                  className="danger-btn"
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
        ) : null}
      </AnimatePresence>
    </div>
  );
}

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(<App />);
}
