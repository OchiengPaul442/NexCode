// ── Zustand Store ───────────────────────────────────────────────────────────
// Extracted from main.tsx for NC-036: monolithic file splitting.
// Contains the webview state store and the VS Code API handle.

import { create } from "zustand";
import type {
  StoreState,
  PersistedState,
  BackendConfig,
  SidebarSettings,
  ProviderId,
  AgentMode,
  UiMode,
  PermissionLevel,
  ChatMessage,
  Session,
} from "./types";
import {
  mapAgentModeToUi,
  createSession,
  makeId,
  titleFromPrompt,
  stripSecretsFromSettings,
} from "./utils";

// ── VS Code API declaration ────────────────────────────────────────────────
// acquireVsCodeApi is a webview global provided by VS Code's webview API.
declare function acquireVsCodeApi<T = unknown>(): {
  getState(): T | undefined;
  setState(state: T): void;
  postMessage(message: unknown): void;
};

// ── VS Code API handle ─────────────────────────────────────────────────────
export const vscode = acquireVsCodeApi<PersistedState>();

// ── Persisted state normalization ──────────────────────────────────────────
function normalizePersistedState(
  state: PersistedState | undefined,
): PersistedState | undefined {
  if (!state) {
    return undefined;
  }

  // NC-003: Strip any legacy secret fields from persisted settings
  const sanitizedSettings = stripSecretsFromSettings(state.settings);

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
      settings: sanitizedSettings,
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
    settings: sanitizedSettings,
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

// ── Zustand store ──────────────────────────────────────────────────────────
export const useStore = create<StoreState>((set, get) => {
  const initialDefaults = {
    provider: "ollama" as ProviderId,
    model: "qwen2.5-coder:14b",
    mode: "agent" as UiMode,
  };

  const defaultSidebarSettings: SidebarSettings = {
    temperature: 0.2,
    autoApprove: false,
    autoApplyChanges: false,
    requireTerminalApproval: true,
    showDebugPanel: false,
    enableWebSearch: true,
    permissionLevel: "default" as PermissionLevel,
    openAIBaseUrl: "",
    ollamaBaseUrl: "http://localhost:11434",
    searchProvider: "tavily",
    searchBaseUrl: "",
    // NC-003: Boolean status flags — actual secrets live in SecretStorage only.
    openAIApiKeyConfigured: false,
    searchApiKeyConfigured: false,
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
    backgroundAgents: [],
    waveInfo: null,
    taskQueue: [],
    taskQueuePendingCount: 0,
    taskQueueActiveCount: 0,
    defaults: initialDefaults,
    settings: {
      ...defaultSidebarSettings,
      ...(persisted?.settings ?? {}),
    },
    providerStatus: {
      ollama: undefined,
      "openai-compatible": undefined,
      huggingface: undefined,
      openrouter: undefined,
      together: undefined,
      fireworks: undefined,
      groq: undefined,
      nvidia: undefined,
      baseten: undefined,
    },
    modelSuggestions: {
      ollama: [],
      "openai-compatible": [],
      huggingface: [],
      openrouter: [],
      together: [],
      fireworks: [],
      groq: [],
      nvidia: [],
      baseten: [],
    },
    // NC-023: Multi-root workspace folder defaults
    workspaceFolders: [],
    activeWorkspaceRoot: "",
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

        const activeSessionId =
          state.activeSessionId ?? sessions[0]?.id ?? null;

        const updatedSessions = sessions.map((session) => {
          if (session.id !== activeSessionId) {
            return session;
          }

          const needsUpdate =
            session.provider !== config.provider ||
            session.model !== config.model ||
            session.mode !== mapAgentModeToUi(config.mode);

          if (!needsUpdate) {
            return session;
          }

          return {
            ...session,
            provider: config.provider,
            model: config.model,
            mode: mapAgentModeToUi(config.mode),
            updatedAt: Date.now(),
          };
        });

        const settings: SidebarSettings = {
          ...state.settings,
          temperature: config.temperature ?? state.settings.temperature,
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
          // NC-003: Boolean status flags — never actual secret values.
          openAIApiKeyConfigured:
            typeof config.openAIApiKeyConfigured === "boolean"
              ? config.openAIApiKeyConfigured
              : state.settings.openAIApiKeyConfigured,
          searchApiKeyConfigured:
            typeof config.searchApiKeyConfigured === "boolean"
              ? config.searchApiKeyConfigured
              : state.settings.searchApiKeyConfigured,
        };

        return {
          defaults,
          sessions: updatedSessions,
          activeSessionId,
          settings,
          // NC-023: Store workspace folder information from extension
          workspaceFolders: config.workspaceFolders ?? state.workspaceFolders,
          activeWorkspaceRoot: config.activeWorkspaceRoot ?? state.activeWorkspaceRoot,
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
    addUserMessageToSession: (sessionId, text, attachments) => {
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
              attachments,
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
                    startTime: Date.now(),
                    reasoning: [],
                    debug: [],
                    proposedEdits: [],
                    activityTodos: [],
                    activityFiles: [],
                    toolExecutions: [],
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
    addToolExecution: (sessionId, messageId, execution) => {
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
                        toolExecutions: [
                          ...(message.toolExecutions ?? []),
                          execution,
                        ],
                      }
                    : message,
                ),
              }
            : session,
        ),
      }));
    },
    updateToolExecutionStatus: (sessionId, messageId, toolName, pendingArg, status, message) => {
      set((state) => ({
        sessions: state.sessions.map((session) =>
          session.id === sessionId
            ? {
                ...session,
                updatedAt: Date.now(),
                messages: session.messages.map((msg) =>
                  msg.id === messageId
                    ? {
                        ...msg,
                        toolExecutions: (msg.toolExecutions ?? []).map((exec) =>
                          exec.toolName === toolName &&
                          exec.command === pendingArg &&
                          exec.status === "awaiting-approval"
                            ? { ...exec, status, message: message ?? exec.message }
                            : exec
                        ),
                      }
                    : msg,
                ),
              }
            : session,
        ),
      }));
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
      tokenUsage,
      efficiency,
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
                        endTime: Date.now(),
                        tokenUsage,
                        efficiency,
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
    updateSetting: (key: string, value: unknown) => {
      // NC-003: Safety net — never persist secret keys in the store.
      const SECRET_KEYS = ["openAIApiKey", "searchApiKey", "tavilyApiKey"];
      if (SECRET_KEYS.includes(key)) {
        // Use sendSecret() instead for secret values.
        console.warn(`NC-003: updateSetting rejected secret key "${key}". Use sendSecret() instead.`);
        return;
      }
      vscode.postMessage({ type: "updateSetting", key, value });
      set((state) => ({
        settings: { ...state.settings, [key]: value },
      }));
    },
    // NC-003: Write-only secret sender. Posts the value to the extension host
    // (which stores it in SecretStorage) but never persists it in webview state.
    sendSecret: (key, value) => {
      vscode.postMessage({ type: "updateSetting", key, value });
      // Do NOT store the value in Zustand — it is write-only.
    },
    setDraft: (sessionId, value) => {
      set((state) => ({
        drafts: {
          ...state.drafts,
          [sessionId]: value,
        },
      }));
    },
    addBackgroundAgent: (agent) => {
      set((state) => ({
        backgroundAgents: [...state.backgroundAgents, agent],
      }));
    },
    updateBackgroundAgent: (id, updates) => {
      set((state) => ({
        backgroundAgents: state.backgroundAgents.map((a) =>
          a.id === id ? { ...a, ...updates } : a,
        ),
      }));
    },
    removeBackgroundAgent: (id) => {
      set((state) => ({
        backgroundAgents: state.backgroundAgents.filter((a) => a.id !== id),
      }));
    },
    setWaveInfo: (waveInfo) => {
      set({ waveInfo });
    },
    setTaskQueue: (tasks, pending, active) => {
      // Only show tasks that are actually queued (pending), not running/completed
      const pendingTasks = tasks.filter((t) => t.status === "queued" || t.status === "planning");
      set({
        taskQueue: pendingTasks,
        taskQueuePendingCount: pending,
        taskQueueActiveCount: active,
      });
    },
    clearTaskQueue: () => {
      set({
        taskQueue: [],
        taskQueuePendingCount: 0,
      });
    },
    updateTaskStatus: (taskId, status, note) => {
      set((state) => ({
        taskQueue: state.taskQueue.map((t) =>
          t.id === taskId ? { ...t, status, activityNote: note ?? t.activityNote } : t,
        ),
      }));
      // Auto-remove completed/failed tasks after 3 seconds
      if (status === "completed" || status === "failed" || status === "cancelled") {
        setTimeout(() => {
          useStore.getState().setTaskQueue(
            useStore.getState().taskQueue.filter((t) => t.id !== taskId),
            useStore.getState().taskQueuePendingCount,
            Math.max(0, useStore.getState().taskQueueActiveCount - 1),
          );
        }, 3000);
      }
    },
    parallelCount: 0,
    incrementParallel: () => {
      set((state) => ({ parallelCount: state.parallelCount + 1 }));
    },
    decrementParallel: () => {
      set((state) => ({
        parallelCount: Math.max(0, state.parallelCount - 1),
      }));
    },
    resetParallel: () => {
      set({ parallelCount: 0 });
    },
  };
});

// ── Helper functions ───────────────────────────────────────────────────────
export function getActiveSession(state: StoreState): Session | undefined {
  return state.sessions.find((session) => session.id === state.activeSessionId);
}
