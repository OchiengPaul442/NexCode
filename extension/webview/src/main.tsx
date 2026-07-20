import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
  useCallback,
} from "react";
import { createRoot } from "react-dom/client";
import { AnimatePresence, motion } from "framer-motion";
// create import removed — Zustand store is now in ./store (NC-036)
import {
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
  FileSpreadsheet,
  File,
  Eraser,
  ArrowUp,
  ArrowDown,
  Cpu,
  Globe,
  Code2,
  MessageSquare,
  Compass,
  GitBranch,
  Search,
  Terminal,
  Copy,
  Check,
  Square,
  Pencil,
  RotateCcw,
  ListTodo,
  Edit,
  Radio,
  Shield,
  Paperclip,
  Activity,
} from "lucide-react";
import { StreamingMessage } from "./components/StreamingMessage";

// ── NC-036: Imported from extracted modules ─────────────────────────────────
import type {
  ProviderId,
  AgentMode,
  UiMode,
  PermissionLevel,
  EditStatus,
  ActivityStatus,
  ProviderStatus,
  ProposedEdit,
  ActivityTodo,
  ActivityFile,
  ChatMessage,
  ToolExecution,
  QueuedPrompt,
  ReasoningEffort,
  Session,
  AttachmentChip,
  SubAgentTask,
  QueuedTask,
  McpQuickResult,
  ToolbarSelectOption,
  SearchProviderId,
  SidebarSettings,
  PersistedState,
  BackendConfig,
  StoreState,
  BackendEvent,
  ModelEffortInfo,
} from "./types";
import {
  providerPresets,
  LEGACY_SECRET_KEYS,
  stripSecretsFromSettings,
  makeId,
  titleFromPrompt,
  mapAgentModeToUi,
  mapUiModeToAgent,
  createSession,
  sanitizeReasoningStatus,
  formatAgentMode,
  formatUiMode,
  formatRelativeTime,
  getTimeAgo,
  isRunningActivityStatus,
  activityStatusLabel,
  activityStatusClass,
  modelCapabilities,
  modelEffortConfig,
  getModelEffortInfo,
  effortLabels,
  hasThinkingCapability,
  estimateAttachmentKind,
  arrayBufferToBase64,
  parseSlashCommand,
  findRetryPromptForMessage,
  inferContextWindow,
  formatTokenCount,
  getSearchProviderPlaceholder,
  getSearchProviderHint,
  getSearchProviderUrlPlaceholder,
} from "./utils";
import {
  useStore,
  vscode,
  getActiveSession,
} from "./store";

// ── Completion sound (two-tone ascending chime, no CSP changes needed) ──────
function playCompletionSound(): void {
  try {
    const ctx = new AudioContext();
    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const gain = ctx.createGain();

    // First tone: A5 (880Hz) - 0-80ms
    osc1.type = "sine";
    osc1.frequency.setValueAtTime(880, ctx.currentTime);

    // Second tone: E6 (1320Hz) - 80-200ms (harmonic rise)
    osc2.type = "sine";
    osc2.frequency.setValueAtTime(1320, ctx.currentTime + 0.08);

    // Envelope: soft, clean fade-out
    gain.gain.setValueAtTime(0, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.12, ctx.currentTime + 0.01);
    gain.gain.linearRampToValueAtTime(0.12, ctx.currentTime + 0.08);
    gain.gain.linearRampToValueAtTime(0.08, ctx.currentTime + 0.1);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);

    osc1.connect(gain);
    osc2.connect(gain);
    gain.connect(ctx.destination);

    osc1.start(ctx.currentTime);
    osc1.stop(ctx.currentTime + 0.1);
    osc2.start(ctx.currentTime + 0.08);
    osc2.stop(ctx.currentTime + 0.25);

    // Clean up AudioContext after playback
    setTimeout(() => ctx.close(), 300);
  } catch {
    // Silently fail if audio is not available
  }
}

// ── Git-style diff utility using the `diff` package ──────────────────────────
import { diffLines, type Change } from "diff";

interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: DiffLine[];
}

interface DiffLine {
  type: "add" | "del" | "ctx";
  oldNum: number | null;
  newNum: number | null;
  content: string;
}

function computeGitDiff(oldText: string, newText: string): DiffHunk[] {
  const changes: Change[] = diffLines(oldText, newText);
  const hunks: DiffHunk[] = [];
  let currentHunk: DiffHunk | null = null;
  let oldLine = 1;
  let newLine = 1;

  for (const change of changes) {
    const lines = change.value.split("\n").filter((_, i, arr) =>
      i < arr.length - 1 || arr[i] !== "",
    );

    for (const line of lines) {
      if (change.added) {
        if (!currentHunk) {
          currentHunk = { oldStart: oldLine, oldLines: 0, newStart: newLine, newLines: 0, lines: [] };
          hunks.push(currentHunk);
        }
        currentHunk.lines.push({ type: "add", oldNum: null, newNum: newLine++, content: line });
        currentHunk.newLines++;
      } else if (change.removed) {
        if (!currentHunk) {
          currentHunk = { oldStart: oldLine, oldLines: 0, newStart: newLine, newLines: 0, lines: [] };
          hunks.push(currentHunk);
        }
        currentHunk.lines.push({ type: "del", oldNum: oldLine++, newNum: null, content: line });
        currentHunk.oldLines++;
      } else {
        if (currentHunk) currentHunk = null;
        oldLine++;
        newLine++;
      }
    }
  }

  // Merge nearby hunks (within 3 lines)
  if (hunks.length <= 1) return hunks;
  const merged: DiffHunk[] = [hunks[0]];
  for (let i = 1; i < hunks.length; i++) {
    const prev = merged[merged.length - 1];
    const curr = hunks[i];
    const gap = curr.oldStart - (prev.oldStart + prev.oldLines);
    if (gap <= 6) {
      prev.oldLines = (curr.oldStart + curr.oldLines) - prev.oldStart;
      prev.newLines = (curr.newStart + curr.newLines) - prev.newStart;
      prev.lines.push(...curr.lines);
    } else {
      merged.push(curr);
    }
  }
  return merged;
}

// Collapsed context: show only N lines of context around changes
function collapseDiffContext(lines: DiffLine[], contextSize = 3): DiffLine[] {
  if (lines.length <= contextSize * 2 + 4) return lines;

  const changeIndices = new Set<number>();
  lines.forEach((l, i) => {
    if (l.type !== "ctx") {
      for (let k = Math.max(0, i - contextSize); k <= Math.min(lines.length - 1, i + contextSize); k++) {
        changeIndices.add(k);
      }
    }
  });

  const result: DiffLine[] = [];
  let lastIdx = -1;

  for (let i = 0; i < lines.length; i++) {
    if (changeIndices.has(i)) {
      if (lastIdx >= 0 && i - lastIdx > 1) {
        const hiddenCount = i - lastIdx - 1;
        result.push({ type: "ctx", oldNum: null, newNum: null, content: `${hiddenCount} unmodified line${hiddenCount !== 1 ? "s" : ""}` });
      }
      result.push(lines[i]);
      lastIdx = i;
    }
  }

  return result;
}

declare const acquireVsCodeApi: <T = unknown>() => {
  postMessage: (message: unknown) => void;
  setState: (state: T) => void;
  getState: () => T | undefined;
};

// NC-036: Types, providerPresets, and utility functions imported from extracted modules (types.ts, utils.ts, store.ts)
// Types and utilities now imported from ./types, ./utils, ./store (NC-036)
// Removed: AgentMode, UiMode, PermissionLevel, EditStatus, ActivityStatus,
// ProviderStatus, ProposedEdit, ActivityTodo, ActivityFile, ChatMessage,
// ToolExecution, QueuedPrompt, ReasoningEffort, Session, AttachmentChip,
// SubAgentTask, QueuedTask, McpQuickResult, ToolbarSelectOption, SearchProviderId,
// SidebarSettings, PersistedState, BackendConfig, StoreState, BackendEvent,
// ModelEffortInfo, modelCapabilities, modelEffortConfig, effortLabels,
// hasThinkingCapability

// NC-036: LEGACY_SECRET_KEYS, stripSecretsFromSettings, normalizePersistedState,
// persisted, makeId, titleFromPrompt, mapAgentModeToUi, mapUiModeToAgent,
// createSession, sanitizeReasoningStatus, formatAgentMode, formatUiMode,
// formatRelativeTime, getTimeAgo, isRunningActivityStatus, activityStatusLabel,
// activityStatusClass, modelCapabilities, modelEffortConfig, getModelEffortInfo,
// effortLabels, hasThinkingCapability, estimateAttachmentKind, arrayBufferToBase64,
// parseSlashCommand, findRetryPromptForMessage, useStore, getActiveSession
// are now imported from ./utils and ./store

// NC-036: All utility functions (makeId, titleFromPrompt, mapAgentModeToUi, etc.)
// are now imported from ./utils

function ReasoningIndicator({ reasoning, streaming, startTime }: {
  reasoning: string[];
  streaming: boolean;
  startTime?: number;
}) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!streaming || !startTime) return;
    const interval = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startTime) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [streaming, startTime]);

  if (!streaming || reasoning.length === 0) return null;

  const latest = reasoning[reasoning.length - 1];
  // Clean up thinking content - remove <think> tags and truncate
  const cleaned = latest
    .replace(/<think>[\s\S]*?<\/think>/g, "")
    .replace(/<think>[\s\S]*$/g, "")
    .trim();
  const displayText = cleaned.length > 0
    ? (cleaned.length > 60 ? cleaned.slice(0, 60) + "..." : cleaned)
    : "Working...";

  return (
    <div className="nk-reasoning-dynamic">
      <div className="nk-reasoning-line">
        <span className="nk-reasoning-dot" />
        <span className="nk-reasoning-timer">Working for {elapsed}s</span>
        <span>—</span>
        <span className="nk-reasoning-text">{displayText}</span>
      </div>
    </div>
  );
}

function ToolbarSelect({
  value,
  options,
  onChange,
  label,
  className,
  buttonClassName,
  menuClassName,
  searchable = false,
}: {
  value: string;
  options: ToolbarSelectOption[];
  onChange: (value: string) => void;
  label: string;
  className?: string;
  buttonClassName?: string;
  menuClassName?: string;
  searchable?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const rootRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) {
      setSearch("");
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleEscape);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleEscape);
    };
  }, [open]);

  // Focus search input when dropdown opens
  useEffect(() => {
    if (open && searchable && searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, [open, searchable]);

  const selected = options.find((option) => option.value === value) ??
    options[0] ?? {
      value,
      label: value,
    };

  // Filter options based on search
  const filteredOptions = searchable && search.trim()
    ? options.filter((option) =>
        option.label.toLowerCase().includes(search.toLowerCase()) ||
        option.value.toLowerCase().includes(search.toLowerCase())
      )
    : options;

  return (
    <div
      ref={rootRef}
      className={["nk-toolbar-select", open ? "is-open" : "", className]
        .filter(Boolean)
        .join(" ")}
    >
      <button
        className={["nk-toolbar-select-trigger", buttonClassName]
          .filter(Boolean)
          .join(" ")}
        type="button"
        title={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="nk-toolbar-select-value">{selected.label}</span>
        <ChevronDown size={10} className="nk-toolbar-select-arrow" />
      </button>

      {open && (
        <div
          className={["nk-toolbar-select-menu", menuClassName]
            .filter(Boolean)
            .join(" ")}
          role="listbox"
          aria-label={label}
        >
          {/* Search bar for model selector */}
          {searchable && (
            <div className="nk-toolbar-select-search">
              <Search size={12} className="nk-toolbar-select-search-icon" />
              <input
                ref={searchInputRef}
                type="text"
                className="nk-toolbar-select-search-input"
                placeholder="Search models..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => {
                  // Prevent dropdown close on keypress
                  e.stopPropagation();
                }}
              />
            </div>
          )}
          {filteredOptions.map((option) => (
            <button
              key={option.value}
              className={`nk-toolbar-select-option ${option.value === selected.value ? "is-selected" : ""}`}
              type="button"
              role="option"
              aria-selected={option.value === selected.value}
              onClick={() => {
                onChange(option.value);
                setOpen(false);
              }}
              title={option.description ?? option.label}
            >
              <span className="nk-toolbar-select-option-label">
                {option.label}
              </span>
              {option.description && (
                <span className="nk-toolbar-select-option-description">
                  {option.description}
                </span>
              )}
              {option.meta && (
                <div className="nk-toolbar-select-option-meta">
                  <span>{option.meta.inputs.join(', ')}</span>
                  {option.meta.reasoning && <span className="nk-meta-reasoning">Reasoning</span>}
                  <span className="nk-meta-context">{option.meta.context}</span>
                </div>
              )}
            </button>
          ))}
          {filteredOptions.length === 0 && (
            <div className="nk-toolbar-select-empty">
              No models found
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// NC-036: estimateAttachmentKind, arrayBufferToBase64, parseSlashCommand,
// findRetryPromptForMessage are now imported from ./utils

// NC-036: useStore, vscode, getActiveSession are now imported from ./store

// ─── Token Ring ──────────────────────────────────────────────────────────────
// NC-036: inferContextWindow and formatTokenCount are now imported from ./utils

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

// ─── Response Summary ────────────────────────────────────────────────────────
function formatTime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}m ${secs}s`;
}

function ActivityTodosSection({ todos }: { todos: ActivityTodo[] }) {
  const [expanded, setExpanded] = useState(false);
  const completed = todos.filter((t) => t.status === "completed").length;
  const total = todos.length;
  const inProgress = todos.find((t) => t.status === "in-progress");

  return (
    <div style={{
      marginTop: "8px",
      border: "1px solid var(--vscode-widget-border, #454545)",
      borderRadius: "4px",
      overflow: "hidden",
      fontSize: "12px",
    }}>
      {/* Header - clickable to expand/collapse */}
      <div
        onClick={() => setExpanded(!expanded)}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "6px 10px",
          background: "var(--vscode-sideBar-background, #252526)",
          borderBottom: expanded ? "1px solid var(--vscode-widget-border, #454545)" : "none",
          cursor: "pointer",
          userSelect: "none",
        }}
      >
        <span style={{ fontWeight: 600, color: "var(--vscode-foreground, #cccccc)" }}>
          {completed} of {total} todos completed
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          {inProgress && (
            <span style={{ color: "var(--vscode-descriptionForeground, #8b8b9a)", fontSize: "11px" }}>
              {inProgress.title}
            </span>
          )}
          <ChevronRight
            size={12}
            style={{
              color: "var(--vscode-descriptionForeground, #8b8b9a)",
              transform: expanded ? "rotate(90deg)" : "rotate(0deg)",
              transition: "transform 0.15s ease",
            }}
          />
        </span>
      </div>
      {/* Expanded todo list */}
      {expanded && (
        <div style={{ padding: "4px 0" }}>
          {todos.map((todo) => (
            <div
              key={todo.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                padding: "4px 10px",
                color: todo.status === "completed"
                  ? "var(--vscode-descriptionForeground, #8b8b9a)"
                  : "var(--vscode-foreground, #cccccc)",
              }}
            >
              <span style={{ flexShrink: 0, width: "14px", textAlign: "center" }}>
                {todo.status === "completed" && <CheckCircle2 size={12} style={{ color: "var(--vscode-terminal-ansiGreen, #4ec9b0)" }} />}
                {todo.status === "in-progress" && <Radio size={12} style={{ color: "var(--vscode-terminal-ansiYellow, #dcdcaa)" }} />}
                {todo.status === "not-started" && <Square size={10} style={{ color: "var(--vscode-descriptionForeground, #8b8b9a)" }} />}
              </span>
              <span style={{
                textDecoration: todo.status === "completed" ? "line-through" : "none",
                opacity: todo.status === "completed" ? 0.7 : 1,
              }}>
                {todo.title}
              </span>
              {todo.detail && (
                <span style={{ color: "var(--vscode-descriptionForeground, #8b8b9a)", fontSize: "10px", marginLeft: "auto" }}>
                  {todo.detail}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ResponseSummary({ message }: { message: ChatMessage }) {
  if (message.streaming || message.thinking) return null;
  if (!message.text) return null;

  const elapsed =
    message.endTime && message.startTime
      ? Math.floor((message.endTime - message.startTime) / 1000)
      : 0;

  return (
    <div className="nk-response-summary">
      <div className="nk-response-meta">
        {message.provider && <span>{message.provider}</span>}
        {message.model && <span>· {message.model}</span>}
        {elapsed > 0 && <span>· {formatTime(elapsed)}</span>}
        {message.tokenUsage && (
          <span>· {formatTokenCount(message.tokenUsage.total)} tokens</span>
        )}
      </div>
    </div>
  );
}

// ─── Inline Tool Execution (OpenCode-style) ──────────────────────────────────

// Group consecutive tool executions by type for compact display
function groupToolExecutions(tools: ToolExecution[]): Array<{
  type: string;
  label: string;
  count: number;
  executions: ToolExecution[];
  hasError: boolean;
}> {
  const groups: Array<{
    type: string;
    label: string;
    count: number;
    executions: ToolExecution[];
    hasError: boolean;
  }> = [];

  for (const exec of tools) {
    const normalizedType = (() => {
      switch (exec.toolName) {
        case "terminal": return "shell";
        case "write":
        case "append": return "edit";
        case "search":
        case "web-search": return "search";
        case "read": return "read";
        case "patch": return "patch";
        case "delete": return "delete";
        default: return exec.toolName;
      }
    })();

    const label = (() => {
      switch (normalizedType) {
        case "shell": return "Shell";
        case "edit": return "Edit";
        case "search": return "Search";
        case "read": return "Read";
        case "patch": return "Patch";
        case "delete": return "Delete";
        default: return normalizedType;
      }
    })();

    const lastGroup = groups[groups.length - 1];
    if (lastGroup && lastGroup.type === normalizedType) {
      lastGroup.count++;
      lastGroup.executions.push(exec);
      if (exec.status === "error") lastGroup.hasError = true;
    } else {
      groups.push({
        type: normalizedType,
        label,
        count: 1,
        executions: [exec],
        hasError: exec.status === "error",
      });
    }
  }

  return groups;
}

// Extract file path from tool execution
function extractFilePath(exec: ToolExecution): string | null {
  switch (exec.toolName) {
    case "write":
    case "append":
    case "patch": {
      const match = exec.command.match(/^(.+?)\s*::/);
      return match ? match[1].trim() : null;
    }
    case "read":
    case "delete":
      return exec.command.trim() || null;
    default:
      return null;
  }
}

// Single grouped tool line (e.g., "10 searches" or "Edit drivers.ts +34 -0")
function ToolGroupLine({
  group,
  onOpenFile,
  onToggleExpand,
  isExpanded,
}: {
  group: ReturnType<typeof groupToolExecutions>[0];
  onOpenFile?: (filePath: string) => void;
  onToggleExpand: () => void;
  isExpanded: boolean;
}) {
  // Get unique files from executions
  const files = useMemo(() => {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const exec of group.executions) {
      const fp = extractFilePath(exec);
      if (fp && !seen.has(fp)) {
        seen.add(fp);
        result.push(fp);
      }
    }
    return result;
  }, [group.executions]);

  const mainFile = files[0];
  const fileName = mainFile ? mainFile.split(/[/\\]/).pop() ?? mainFile : null;

  // Get summary of what the tool is doing
  const summary = useMemo(() => {
    if (group.executions.length === 0) return null;
    const firstExec = group.executions[0];

    switch (group.type) {
      case "shell": {
        // Show the command being run
        const cmd = firstExec.command;
        const display = cmd.length > 60 ? cmd.slice(0, 60) + "..." : cmd;
        return display;
      }
      case "search": {
        // Show the search query
        const query = firstExec.command;
        return query.length > 50 ? query.slice(0, 50) + "..." : query;
      }
      case "read": {
        // Show what's being read
        return mainFile ? mainFile.split(/[/\\]/).pop() : null;
      }
      case "edit": {
        // Show the file being edited
        return mainFile ? mainFile.split(/[/\\]/).pop() : null;
      }
      case "patch": {
        return mainFile ? mainFile.split(/[/\\]/).pop() : null;
      }
      case "delete": {
        return mainFile ? mainFile.split(/[/\\]/).pop() : null;
      }
      default:
        return null;
    }
  }, [group, mainFile]);

  // Calculate stats for edit groups
  const editStats = useMemo(() => {
    if (group.type !== "edit" && group.type !== "patch") return null;
    let additions = 0;
    let deletions = 0;
    for (const exec of group.executions) {
      if (exec.toolName === "write" || exec.toolName === "append") {
        additions += (exec.message ?? "").split("\n").length || 1;
      }
      if (exec.toolName === "patch") {
        additions += 1;
        deletions += 1;
      }
    }
    return { additions, deletions };
  }, [group]);

  const handleClick = () => {
    if (mainFile && onOpenFile) {
      onOpenFile(mainFile);
    }
  };

  const countText = group.count > 1 ? `${group.count} ` : "";
  const suffix = group.count > 1
    ? `${group.type === "shell" ? "commands" : group.type === "search" ? "searches" : group.type === "read" ? "reads" : "operations"}`
    : "";

  return (
    <div className="nk-tool-group">
      <span className="nk-tool-group-content">
        <span className="nk-tool-group-label">
          {group.label}
        </span>
        {summary && (
          <span className="nk-tool-group-summary">{summary}</span>
        )}
        {editStats && (
          <span className="nk-tool-group-stats">
            {editStats.additions > 0 && <span className="nk-tool-group-add">+{editStats.additions}</span>}
            {editStats.deletions > 0 && <span className="nk-tool-group-del">-{editStats.deletions}</span>}
          </span>
        )}
        {group.hasError && <span className="nk-tool-group-error">failed</span>}
        {group.count > 1 && <span className="nk-tool-group-count">{countText}{suffix}</span>}
      </span>
      {group.executions.length > 0 && (
        <button
          className="nk-tool-group-expand"
          onClick={onToggleExpand}
          title={isExpanded ? "Collapse" : "Expand"}
        >
          <ChevronRight
            size={10}
            style={{ transform: isExpanded ? "rotate(90deg)" : "rotate(0deg)", transition: "transform 0.15s" }}
          />
        </button>
      )}
    </div>
  );
}

// Expanded detail view with git-style diff
function ToolGroupDetail({
  group,
  onOpenFile,
}: {
  group: ReturnType<typeof groupToolExecutions>[0];
  onOpenFile?: (filePath: string) => void;
}) {
  return (
    <div className="nk-tool-detail">
      {group.executions.map((exec, i) => {
        const filePath = extractFilePath(exec);
        const fileName = filePath ? filePath.split(/[/\\]/).pop() ?? filePath : null;
        const statusColor = exec.status === "success"
          ? "var(--vscode-terminal-ansiGreen, #4ec9b0)"
          : exec.status === "error"
            ? "var(--vscode-terminal-ansiRed, #f48771)"
            : "var(--vscode-descriptionForeground, #8b8b9a)";

        return (
          <div key={i} className="nk-tool-detail-row">
            <span className="nk-tool-detail-status" style={{ color: statusColor }}>
              {exec.status === "success" ? "✓" : exec.status === "error" ? "✗" : "○"}
            </span>
            <span className="nk-tool-detail-cmd">
              {exec.command.length > 80 ? exec.command.slice(0, 80) + "..." : exec.command}
            </span>
            {exec.durationMs != null && (
              <span className="nk-tool-detail-dur">
                {exec.durationMs < 1000 ? `${exec.durationMs}ms` : `${(exec.durationMs / 1000).toFixed(1)}s`}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Message Content (interleaved text + tool executions) ─────────────────────
function MessageContent({
  message,
  isStreaming,
  onOpenFile,
  onFrame,
}: {
  message: ChatMessage;
  isStreaming: boolean;
  onOpenFile?: (filePath: string) => void;
  onFrame?: () => void;
}) {
  const tools = message.toolExecutions ?? [];
  const text = message.text || "";
  const [expandedGroups, setExpandedGroups] = useState<Set<number>>(new Set());

  // Clean <think> tags from text
  const cleanText = text
    .replace(/<think>[\s\S]*?<\/think>/g, "")
    .replace(/<think>[\s\S]*$/g, "")
    .trim();

  // Group tools by type
  const toolGroups = useMemo(() => groupToolExecutions(tools), [tools]);

  const toggleGroup = (index: number) => {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  // If no tools, render text only
  if (tools.length === 0) {
    return (
      <div className="nk-message-content">
        <StreamingMessage
          text={cleanText}
          streaming={isStreaming}
          markdown
          className="markdown-body text-[13px] leading-relaxed"
          showCursor
          showThinkingOverlay={!(message.reasoning.length > 0 && isStreaming)}
          thinkingLabel={
            message.reasoning.length > 0
              ? message.reasoning[message.reasoning.length - 1]
                  .replace(/<think>[\s\S]*?<\/think>/g, "")
                  .replace(/<think>[\s\S]*$/g, "")
                  .trim() || "Working..."
              : "Working..."
          }
          onFrame={onFrame}
        />
      </div>
    );
  }

  return (
    <div className="nk-message-content">
      {/* Main text */}
      {cleanText && (
        <StreamingMessage
          text={cleanText}
          streaming={isStreaming}
          markdown
          className="markdown-body text-[13px] leading-relaxed"
          showCursor={false}
          showThinkingOverlay={false}
          onFrame={onFrame}
        />
      )}

      {/* Grouped tool executions - plain text style, no boxes */}
      <div className="nk-tool-groups">
        {toolGroups.map((group, i) => (
          <div key={i} className="nk-tool-group-wrapper">
            <ToolGroupLine
              group={group}
              onOpenFile={onOpenFile}
              onToggleExpand={() => toggleGroup(i)}
              isExpanded={expandedGroups.has(i)}
            />
            {expandedGroups.has(i) && (
              <ToolGroupDetail
                group={group}
                onOpenFile={onOpenFile}
              />
            )}
          </div>
        ))}
      </div>

      {isStreaming && (
        <span className="nk-streaming-cursor" aria-hidden="true" />
      )}
    </div>
  );
}

// ─── Sources Section (collapsible) ───────────────────────────────────────────
const SourcesSection = React.memo(function SourcesSection({
  sources,
}: {
  sources: Array<{ title: string; url: string; snippet?: string }>;
}) {
  const [expanded, setExpanded] = useState(false);
  const VISIBLE_COUNT = 5;
  const hasMore = sources.length > VISIBLE_COUNT;
  const displaySources = expanded ? sources : sources.slice(0, VISIBLE_COUNT);

  if (sources.length === 0) return null;

  return (
    <div className="nk-sources">
      <button
        className="nk-sources-header"
        onClick={() => setExpanded(!expanded)}
        type="button"
      >
        <Globe size={12} className="nk-sources-icon" />
        <span className="nk-sources-title">Sources</span>
        <span className="nk-sources-count">{sources.length}</span>
        <ChevronRight
          size={10}
          className="nk-sources-chevron"
          style={{ transform: expanded ? "rotate(90deg)" : "rotate(0deg)" }}
        />
      </button>
      {expanded && (
        <div className="nk-sources-list">
          {displaySources.map((src, i) => (
            <a
              key={i}
              className="nk-source-item"
              href={src.url}
              target="_blank"
              rel="noopener noreferrer"
              title={src.snippet ?? src.title}
            >
              <span className="nk-source-index">{i + 1}</span>
              <span className="nk-source-title">{src.title}</span>
              <ExternalLink size={10} className="nk-source-link-icon" />
            </a>
          ))}
        </div>
      )}
    </div>
  );
});

// ─── Message Bubble ──────────────────────────────────────────────────────────
function MessageBubble({
  message,
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
    <div
      className={`nk-msg-row ${isUser ? "nk-msg-row--user" : "nk-msg-row--bot"}`}
    >
      {/* Bubble */}
      <div
        className={`nk-msg-content ${isUser ? "nk-msg-content--user" : "nk-msg-content--bot"}`}
      >
        {!isUser && message.reasoning.length > 0 && (
          <MemoizedReasoningIndicator
            reasoning={message.reasoning}
            streaming={Boolean(message.streaming || message.thinking)}
            startTime={message.startTime}
          />
        )}

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
              <div>
                {message.attachments &&
                  message.attachments.length > 0 && (
                    <div className="nk-msg-attachments">
                      {message.attachments.map(
                        (att: {
                          id: string;
                          fileName: string;
                          kind: string;
                          textContent?: string;
                        }) => (
                          <div key={att.id} className="nk-msg-attachment">
                            <div className="nk-msg-attachment-icon">
                              {att.kind === "image" ? (
                                <Image size={14} />
                              ) : att.fileName?.endsWith(".pdf") ? (
                                <FileText size={14} />
                              ) : att.fileName?.endsWith(".csv") ||
                                att.fileName?.endsWith(".xlsx") ? (
                                <FileSpreadsheet size={14} />
                              ) : (
                                <FileText size={14} />
                              )}
                            </div>
                            <div className="nk-msg-attachment-info">
                              <span className="nk-msg-attachment-name">
                                {att.fileName}
                              </span>
                              {att.textContent && (
                                <span className="nk-msg-attachment-preview">
                                  {att.textContent.slice(0, 80)}...
                                </span>
                              )}
                            </div>
                          </div>
                        ),
                      )}
                    </div>
                  )}
                <pre className="m-0 whitespace-pre-wrap text-[13px] leading-relaxed font-sans">
                  {message.text}
                </pre>
              </div>
            ) : (
              <MessageContent
                message={message}
                isStreaming={Boolean(message.streaming || message.thinking)}
                onOpenFile={(filePath) => {
                  const vscode = acquireVsCodeApi();
                  vscode.postMessage({ type: "openFile", filePath });
                }}
                onFrame={onAnimatedFrame}
              />
            )}
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

        {/* Activity Todos - OpenCode-style task list */}
        {!isUser && (message.activityTodos ?? []).length > 0 && (
          <ActivityTodosSection todos={message.activityTodos!} />
        )}

        {/* Web search sources - collapsible */}
        {!isUser && (() => {
          const allSources = (message.toolExecutions ?? [])
            .flatMap(exec => exec.sources ?? []);
          if (allSources.length === 0) return null;
          // Deduplicate by URL
          const seen = new Set<string>();
          const unique = allSources.filter(s => {
            if (!s.url || seen.has(s.url)) return false;
            seen.add(s.url);
            return true;
          });
          if (unique.length === 0) return null;
          return <SourcesSection sources={unique} />;
        })()}

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

        {/* Changed Files Summary - GitHub-style */}
        {!isUser && (() => {
          const toolExecs = message.toolExecutions ?? [];
          const filesModified = new Map<string, { additions: number; deletions: number }>();
          let totalAdditions = 0;
          let totalDeletions = 0;

          for (const exec of toolExecs) {
            if (exec.toolName === "write" || exec.toolName === "append") {
              const pathMatch = exec.command.match(/^(.+?)\s*::/);
              if (pathMatch) {
                const fp = pathMatch[1].trim();
                if (!filesModified.has(fp)) filesModified.set(fp, { additions: 0, deletions: 0 });
                const info = filesModified.get(fp)!;
                info.additions += (exec.message ?? "").split("\n").length || 1;
              }
            }
            if (exec.toolName === "patch") {
              const patchMatch = exec.command.match(/^(.+?)\s*::/);
              if (patchMatch) {
                const fp = patchMatch[1].trim();
                if (!filesModified.has(fp)) filesModified.set(fp, { additions: 0, deletions: 0 });
                const info = filesModified.get(fp)!;
                info.additions += 1;
                info.deletions += 1;
              }
            }
            if (exec.toolName === "delete") {
              const fp = exec.command.trim();
              if (fp) {
                filesModified.set(fp, { additions: 0, deletions: 1 });
              }
            }
            if (exec.filesChanged) {
              for (const f of exec.filesChanged) {
                if (!filesModified.has(f)) filesModified.set(f, { additions: 0, deletions: 0 });
              }
            }
          }

          for (const info of filesModified.values()) {
            totalAdditions += info.additions;
            totalDeletions += info.deletions;
          }

          const files = [...filesModified.entries()].map(([path, info]) => ({
            path,
            additions: info.additions,
            deletions: info.deletions,
          }));

          if (files.length === 0) return null;

          return (
            <ChangedFilesSummary
              files={files}
              totalAdditions={totalAdditions}
              totalDeletions={totalDeletions}
              proposedEdits={message.proposedEdits}
            />
          );
        })()}

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

        {/* Response summary */}
        {!isUser && !message.streaming && !message.thinking && message.text && (
          <ResponseSummary message={message} />
        )}
      </div>
    </div>
  );
}

function ParallelIndicator({ count }: { count: number }) {
  if (count <= 1) return null;

  return (
    <div className="nk-parallel-indicator">
      <span className="nk-parallel-icon">⚡</span>
      <span>Running {count} tasks in parallel</span>
    </div>
  );
}

function SubagentIndicator({
  description,
  status,
}: {
  description: string;
  status: string;
}) {
  return (
    <div className="nk-subagent-indicator">
      <span className="nk-subagent-dot" />
      <span className="nk-subagent-text">{description}</span>
      <span className="nk-subagent-status">{status}</span>
    </div>
  );
}

function BackgroundAgents({ agents, waveInfo }: { agents: SubAgentTask[]; waveInfo?: { current: number; total: number } | null }) {
  if (agents.length === 0) return null;

  const running = agents.filter((a) => a.status === "running");
  const completed = agents.filter((a) => a.status === "completed");
  const failed = agents.filter((a) => a.status === "failed");

  return (
    <div className="nk-bg-agents nk-bg-agents--enhanced">
      {/* Wave deployment text */}
      {waveInfo && waveInfo.current > 1 && completed.length > 0 && (
        <div className="nk-bg-agents-wave-text">
          Excellent! First {completed.length} agent{completed.length !== 1 ? "s" : ""} have reported. Now deploying Wave {waveInfo.current}: {running.length} more agent{running.length !== 1 ? "s" : ""} for remaining areas:
        </div>
      )}

      <div className="nk-bg-agents-header">
        <div className="nk-bg-agents-title-row">
          <span className="nk-bg-agents-title">Agents</span>
          <span className="nk-bg-agents-count-badge">
            {agents.length} total
          </span>
        </div>
        {waveInfo && (
          <div className="nk-bg-agents-wave-info">
            <span className="nk-bg-agents-wave-label">Wave {waveInfo.current}/{waveInfo.total}</span>
            <div className="nk-bg-agents-wave-progress">
              <div 
                className="nk-bg-agents-wave-progress-fill"
                style={{ width: `${(completed.length / agents.length) * 100}%` }}
              />
            </div>
          </div>
        )}
      </div>
      
      <div className="nk-bg-agents-stats">
        {running.length > 0 && (
          <span className="nk-bg-agents-stat nk-bg-agents-stat--running">
            <span className="nk-bg-agents-stat-dot nk-bg-agents-stat-dot--running" />
            {running.length} running
          </span>
        )}
        {completed.length > 0 && (
          <span className="nk-bg-agents-stat nk-bg-agents-stat--completed">
            <span className="nk-bg-agents-stat-dot nk-bg-agents-stat-dot--completed" />
            {completed.length} completed
          </span>
        )}
        {failed.length > 0 && (
          <span className="nk-bg-agents-stat nk-bg-agents-stat--failed">
            <span className="nk-bg-agents-stat-dot nk-bg-agents-stat-dot--failed" />
            {failed.length} failed
          </span>
        )}
      </div>

      <div className="nk-bg-agents-list">
        {agents.map((agent) => (
          <div
            key={agent.id}
            className={`nk-bg-agent-card nk-bg-agent-card--${agent.status}`}
          >
            <div className="nk-bg-agent-card-header">
              <div className="nk-bg-agent-card-icon">
                {agent.status === "running" && (
                  <span className="nk-bg-agent-card-spinner" />
                )}
                {agent.status === "completed" && (
                  <span className="nk-bg-agent-card-check">✓</span>
                )}
                {agent.status === "failed" && (
                  <span className="nk-bg-agent-card-x">✗</span>
                )}
                {agent.status !== "running" && agent.status !== "completed" && agent.status !== "failed" && (
                  <span className="nk-bg-agent-card-pending">☐</span>
                )}
              </div>
              <div className="nk-bg-agent-card-info">
                <span className="nk-bg-agent-card-type">General</span>
                <span className="nk-bg-agent-card-desc">{agent.description}</span>
              </div>
            </div>
            {agent.status === "running" && (
              <div className="nk-bg-agent-card-progress">
                <div className="nk-bg-agent-card-progress-bar">
                  <div className="nk-bg-agent-card-progress-fill" />
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function ToolStatusIndicator({
  toolName,
  command,
  status,
  message,
  durationMs,
  filesChanged,
}: {
  toolName: string;
  command: string;
  status: "success" | "error" | "awaiting-approval";
  message?: string;
  durationMs?: number;
  filesChanged?: string[];
}) {
  const [expanded, setExpanded] = useState(false);
  const isRunning = status === "awaiting-approval";
  const isError = status === "error";
  const isSuccess = status === "success";
  const borderColor = isSuccess ? "var(--vscode-terminal-ansiGreen, #4ec9b0)" : isError ? "var(--vscode-terminal-ansiRed, #f48771)" : "var(--vscode-terminal-ansiYellow, #dcdcaa)";

  const toolIcon = (() => {
    switch (toolName.toLowerCase()) {
      case "terminal": return <Terminal size={13} />;
      case "read": return <FileText size={13} />;
      case "write": case "append": return <Pencil size={13} />;
      case "delete": case "delete-contents": return <Trash2 size={13} />;
      case "move": return <RotateCcw size={13} />;
      case "search": case "web-search": return <Search size={13} />;
      case "batch_edit": return <ListTodo size={13} />;
      case "git-status": case "git-diff": case "git-branch": return <GitBranch size={13} />;
      case "test": return <Shield size={13} />;
      default: return <Code2 size={13} />;
    }
  })();

  const toolLabel = toolName === "terminal" ? "Shell" : toolName;
  const durationStr = durationMs != null ? durationMs < 1000 ? `${durationMs}ms` : `${(durationMs / 1000).toFixed(1)}s` : null;
  const hasOutput = message && message.trim().length > 0;
  const truncatedCmd = command.length > 100 ? command.slice(0, 100) + "..." : command;

  // Parse file changes from command for write/append operations
  const fileChangeInfo = (() => {
    if (filesChanged && filesChanged.length > 0) {
      return { additions: filesChanged.length, deletions: 0 };
    }
    return null;
  })();

  return (
    <div className="nk-tool-card">
      {/* Header - always visible, clickable to expand */}
      <div
        className="nk-tool-card-header"
        onClick={() => hasOutput && setExpanded(!expanded)}
      >
        {/* Icon + Tool name */}
        <span className="nk-tool-card-icon">{toolIcon}</span>
        <span className="nk-tool-card-label">{toolLabel}</span>

        {/* Command preview */}
        <code className="nk-tool-card-command">
          {truncatedCmd}
        </code>

        {/* File change indicators */}
        {fileChangeInfo && (fileChangeInfo.additions > 0 || fileChangeInfo.deletions > 0) && (
          <span className="nk-tool-card-changes">
            {fileChangeInfo.additions > 0 && (
              <span className="nk-tool-card-additions">+{fileChangeInfo.additions}</span>
            )}
            {fileChangeInfo.deletions > 0 && (
              <span className="nk-tool-card-deletions">-{fileChangeInfo.deletions}</span>
            )}
          </span>
        )}

        {/* Status + duration */}
        <span className="nk-tool-card-status">
          {durationStr && <span className="nk-tool-card-duration">{durationStr}</span>}
          {isRunning && (
            <span className="nk-tool-card-spinner" />
          )}
          {isSuccess && <span className="nk-tool-card-done">done</span>}
          {isError && <span className="nk-tool-card-failed">failed</span>}
          {hasOutput && (
            <ChevronRight
              size={12}
              className="nk-tool-card-chevron"
              style={{
                transform: expanded ? "rotate(90deg)" : "rotate(0deg)",
              }}
            />
          )}
        </span>
      </div>

      {/* Expanded output */}
      {expanded && hasOutput && (
        <div className="nk-tool-card-output">
          <pre className="nk-tool-card-pre">
            {message!.length > 2000 ? message!.slice(0, 2000) + "\n... (truncated)" : message}
          </pre>
          {filesChanged && filesChanged.length > 0 && (
            <div className="nk-tool-card-files">
              {filesChanged.map((f, i) => (
                <span key={i} className="nk-tool-card-file-chip">
                  {f}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ChangedFilesSummary({ 
  files, 
  totalAdditions, 
  totalDeletions,
  proposedEdits,
}: { 
  files: Array<{ path: string; additions?: number; deletions?: number }>;
  totalAdditions?: number;
  totalDeletions?: number;
  proposedEdits?: ProposedEdit[];
}) {
  const [listExpanded, setListExpanded] = useState(false);
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set());

  if (files.length === 0) return null;

  const additions = totalAdditions ?? files.reduce((sum, f) => sum + (f.additions ?? 0), 0);
  const deletions = totalDeletions ?? files.reduce((sum, f) => sum + (f.deletions ?? 0), 0);
  const VISIBLE_COUNT = 8;
  const hasOverflow = files.length > VISIBLE_COUNT;
  const displayFiles = listExpanded ? files : files.slice(0, VISIBLE_COUNT);
  const hiddenCount = files.length - VISIBLE_COUNT;

  const toggleFile = (path: string) => {
    setExpandedFiles(prev => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  // Build a map from file path to proposed edit (for inline diff)
  // Use flexible matching: check if paths end with each other (handles absolute vs relative)
  const editMap = useMemo(() => {
    const map = new Map<string, ProposedEdit>();
    if (proposedEdits) {
      for (const edit of proposedEdits) {
        map.set(edit.filePath, edit);
      }
    }
    return map;
  }, [proposedEdits]);

  // Helper to find an edit for a given file path (flexible matching)
  const findEditForFile = (filePath: string): ProposedEdit | undefined => {
    // Exact match first
    if (editMap.has(filePath)) return editMap.get(filePath);
    // Check if any edit path ends with this file path or vice versa
    for (const [editPath, edit] of editMap) {
      if (filePath.endsWith(editPath) || editPath.endsWith(filePath)) return edit;
      // Also check just the filename
      const editBase = editPath.split(/[/\\]/).pop() ?? "";
      const fileBase = filePath.split(/[/\\]/).pop() ?? "";
      if (editBase && fileBase && editBase === fileBase) return edit;
    }
    return undefined;
  };

  return (
    <div className="nk-changeset">
      {/* Header */}
      <div className="nk-changeset-header">
        <span className="nk-changeset-title">
          <span className="nk-changeset-count">
            {files.length} Changed file{files.length !== 1 ? "s" : ""}
          </span>
          {additions > 0 && <span className="nk-changeset-add">+{additions}</span>}
          {deletions > 0 && <span className="nk-changeset-del">-{deletions}</span>}
        </span>
        {hasOverflow && (
          <button
            className="nk-changeset-toggle"
            onClick={() => setListExpanded(!listExpanded)}
          >
            {listExpanded ? "Show less" : `+${hiddenCount} more`}
          </button>
        )}
      </div>

      {/* File list */}
      <div className="nk-changeset-files">
        {displayFiles.map((file) => (
          <ChangedFileRow
            key={file.path}
            file={file}
            edit={findEditForFile(file.path)}
            isExpanded={expandedFiles.has(file.path)}
            onToggle={toggleFile}
          />
        ))}
      </div>

      {/* Overflow footer */}
      {!listExpanded && hasOverflow && (
        <button
          className="nk-changeset-overflow"
          onClick={() => setListExpanded(true)}
        >
          +{hiddenCount} more file{hiddenCount !== 1 ? "s" : ""}
        </button>
      )}
    </div>
  );
}

const ChangedFileRow = React.memo(function ChangedFileRow({
  file,
  edit,
  isExpanded,
  onToggle,
}: {
  file: { path: string; additions?: number; deletions?: number };
  edit?: ProposedEdit;
  isExpanded: boolean;
  onToggle: (path: string) => void;
}) {
  const hasDiff = !!(edit?.oldText && edit?.newText);

  const diffLines = useMemo(() => {
    if (!hasDiff || !edit) return null;
    const hunks = computeGitDiff(edit.oldText, edit.newText);
    // Flatten hunks to lines for the existing renderer
    const allLines: DiffLine[] = [];
    for (const hunk of hunks) {
      allLines.push(...hunk.lines);
    }
    return collapseDiffContext(allLines, 2);
  }, [hasDiff, edit?.oldText, edit?.newText]);

  return (
    <div className="nk-changeset-file">
      {/* File row */}
      <div
        className="nk-changeset-file-row"
        role={hasDiff ? "button" : undefined}
        tabIndex={hasDiff ? 0 : undefined}
        aria-expanded={hasDiff ? isExpanded : undefined}
        onKeyDown={hasDiff ? (e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onToggle(file.path);
          }
        } : undefined}
        onClick={() => hasDiff && onToggle(file.path)}
      >
        <span className="nk-changeset-file-icon">
          <FileText size={12} />
        </span>
        <span className="nk-changeset-file-path">{file.path}</span>
        <span className="nk-changeset-file-stats">
          {file.additions != null && file.additions > 0 && (
            <span className="nk-changeset-file-add">+{file.additions}</span>
          )}
          {file.deletions != null && file.deletions > 0 && (
            <span className="nk-changeset-file-del">-{file.deletions}</span>
          )}
        </span>
        {hasDiff && (
          <ChevronRight
            size={11}
            className="nk-changeset-file-chevron"
            style={{ transform: isExpanded ? "rotate(90deg)" : "rotate(0deg)" }}
          />
        )}
      </div>

      {/* Inline diff */}
      {isExpanded && diffLines && (
        <div className="nk-changeset-diff">
          {diffLines.map((line, i) => (
            <div
              key={i}
              className={`nk-changeset-diff-line nk-changeset-diff-line--${line.type}`}
            >
              <span className="nk-changeset-diff-gutter">
                <span className="nk-changeset-diff-oldnum">{line.oldNum ?? ""}</span>
                <span className="nk-changeset-diff-newnum">{line.newNum ?? ""}</span>
              </span>
              <span className="nk-changeset-diff-prefix">
                {line.type === "add" ? "+" : line.type === "del" ? "-" : " "}
              </span>
              <span className="nk-changeset-diff-text">{line.content}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
});

const ActivitySection = React.memo(function ActivitySection({
  toolExecutions,
}: {
  toolExecutions: ToolExecution[];
}) {
  const [expanded, setExpanded] = useState(false);
  if (toolExecutions.length === 0) return null;

  const successCount = toolExecutions.filter(e => e.status === "success").length;
  const errorCount = toolExecutions.filter(e => e.status === "error").length;
  const totalDuration = toolExecutions.reduce((sum, e) => sum + (e.durationMs ?? 0), 0);
  const durationStr = totalDuration < 1000 ? `${totalDuration}ms` : totalDuration < 60000 ? `${(totalDuration / 1000).toFixed(1)}s` : `${Math.floor(totalDuration / 60000)}m ${Math.floor((totalDuration % 60000) / 1000)}s`;

  // Group tools by type for compact display
  const grouped = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const exec of toolExecutions) {
      // Normalize tool names for consistent grouping
      let name = exec.toolName;
      if (name === "terminal") name = "shell";
      else if (name === "append") name = "write";
      else if (name === "web-search") name = "search";
      counts[name] = (counts[name] ?? 0) + 1;
    }
    return counts;
  }, [toolExecutions]);

  const groupedParts = Object.entries(grouped)
    .map(([name, count]) => `${count} ${name}${count !== 1 ? "s" : ""}`)
    .join("  ");

  return (
    <div className="nk-activity">
      {/* Compact header - always visible */}
      <div
        className="nk-activity-header"
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        onClick={() => setExpanded(!expanded)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setExpanded(!expanded);
          }
        }}
      >
        <span className="nk-activity-header-left">
          <Activity size={12} className="nk-activity-icon" />
          <span className="nk-activity-title">Activity</span>
          <span className="nk-activity-meta">
            {groupedParts}
            <span className="nk-activity-sep">&middot;</span>
            {durationStr}
          </span>
          {successCount > 0 && (
            <span className="nk-activity-ok">{successCount} ok</span>
          )}
          {errorCount > 0 && (
            <span className="nk-activity-fail">{errorCount} failed</span>
          )}
        </span>
        <ChevronRight
          size={12}
          className="nk-activity-chevron"
          style={{ transform: expanded ? "rotate(90deg)" : "rotate(0deg)" }}
        />
      </div>

      {/* Expanded detail list */}
      {expanded && (
        <div className="nk-activity-body">
          {toolExecutions.map((exec, i) => {
            const icon = (() => {
              switch (exec.toolName) {
                case "terminal": return <Terminal size={11} />;
                case "read": return <FileText size={11} />;
                case "write": case "append": return <Pencil size={11} />;
                case "delete": return <Trash2 size={11} />;
                case "search": case "web-search": return <Search size={11} />;
                case "patch": return <Code2 size={11} />;
                default: return <Code2 size={11} />;
              }
            })();
            const label = exec.toolName === "terminal" ? "Shell" : exec.toolName;
            const dur = exec.durationMs != null
              ? exec.durationMs < 1000 ? `${exec.durationMs}ms` : `${(exec.durationMs / 1000).toFixed(1)}s`
              : null;
            const statusIcon = exec.status === "success" ? "✓" : exec.status === "error" ? "✗" : "⏳";
            const statusColor = exec.status === "success"
              ? "var(--vscode-terminal-ansiGreen, #4ec9b0)"
              : exec.status === "error"
                ? "var(--vscode-terminal-ansiRed, #f48771)"
                : "var(--vscode-terminal-ansiYellow, #dcdcaa)";
            // Truncate command for display
            const cmd = exec.command.length > 60 ? exec.command.slice(0, 60) + "..." : exec.command;

            return (
              <div key={i} className="nk-activity-row">
                <span className="nk-activity-row-status" style={{ color: statusColor }}>{statusIcon}</span>
                <span className="nk-activity-row-icon">{icon}</span>
                <span className="nk-activity-row-label">{label}</span>
                <span className="nk-activity-row-cmd" title={exec.command}>{cmd}</span>
                {dur && <span className="nk-activity-row-dur">{dur}</span>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
});

const MemoizedReasoningIndicator = React.memo(ReasoningIndicator);
const MemoizedMessageBubble = React.memo(MessageBubble);

interface ToolApprovalRequest {
  requestId: string;
  toolName: string;
  command: string;
}

function ToolApprovalDialog({
  request,
  onApprove,
  onDeny,
}: {
  request: ToolApprovalRequest;
  onApprove: () => void;
  onDeny: () => void;
}) {
  const [countdown, setCountdown] = useState(30);

  useEffect(() => {
    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          onDeny();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [onDeny]);

  const riskLevel = (() => {
    const lowerTool = request.toolName.toLowerCase();
    if (lowerTool === "terminal" || lowerTool === "batch_edit") return "high";
    if (lowerTool === "write" || lowerTool === "append" || lowerTool === "delete" || lowerTool === "move") return "medium";
    return "low";
  })();

  const riskColor = riskLevel === "high" ? "#f87171" : riskLevel === "medium" ? "#fbbf24" : "#34d399";
  const truncatedCmd = request.command.length > 120 ? request.command.slice(0, 120) + "..." : request.command;

  return (
    <div className="nk-approval-dialog">
      <div className="nk-approval-header">
        <Shield size={16} style={{ color: riskColor }} />
        <span className="nk-approval-title">Tool Approval Required</span>
        <span className="nk-approval-countdown" style={{ color: countdown <= 10 ? "#f87171" : undefined }}>
          {countdown}s
        </span>
      </div>
      <div className="nk-approval-body">
        <div className="nk-approval-row">
          <span className="nk-approval-label">Tool</span>
          <span className="nk-approval-value">{request.toolName}</span>
        </div>
        <div className="nk-approval-row">
          <span className="nk-approval-label">Risk</span>
          <span className="nk-approval-value" style={{ color: riskColor }}>
            {riskLevel.toUpperCase()}
          </span>
        </div>
        <div className="nk-approval-row nk-approval-row--full">
          <span className="nk-approval-label">Command</span>
          <pre className="nk-approval-command">{truncatedCmd}</pre>
        </div>
      </div>
      <div className="nk-approval-actions">
        <button className="nk-btn-ghost nk-approval-deny" onClick={onDeny}>
          <X size={12} /> Deny
        </button>
        <button className="nk-btn-accent nk-approval-approve" onClick={onApprove}>
          <Check size={12} /> Approve
        </button>
      </div>
    </div>
  );
}

// ─── Search Provider Helpers ─────────────────────────────────────────────────
// NC-036: getSearchProviderPlaceholder, getSearchProviderHint, getSearchProviderUrlPlaceholder
// are now imported from ./utils

// ─── App ──────────────────────────────────────────────────────────────────────
function App() {
  const sessions = useStore((s) => s.sessions);
  const activeSessionId = useStore((s) => s.activeSessionId);
  const drafts = useStore((s) => s.drafts);
  const attachments = useStore((s) => s.attachments);
  const isBusy = useStore((s) => s.isBusy);
  const settings = useStore((s) => s.settings);
  const providerStatus = useStore((s) => s.providerStatus);
  const modelSuggestions = useStore((s) => s.modelSuggestions);
  const backgroundAgents = useStore((s) => s.backgroundAgents);
  const waveInfo = useStore((s) => s.waveInfo);
  const parallelCount = useStore((s) => s.parallelCount);
  const taskQueue = useStore((s) => s.taskQueue);
  const taskQueuePendingCount = useStore((s) => s.taskQueuePendingCount);
  const taskQueueActiveCount = useStore((s) => s.taskQueueActiveCount);

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
  // NC-003: Local (uncontrolled) state for API key inputs.
  // These are never persisted — the value is sent to the extension via
  // sendSecret() and then the local state is cleared.
  const [localApiKey, setLocalApiKey] = useState("");
  const [localSearchApiKey, setLocalSearchApiKey] = useState("");
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
  const [subagentInfo, setSubagentInfo] = useState<{
    description: string;
    status: string;
  } | null>(null);
  const [settingsDropdownOpen, setSettingsDropdownOpen] = useState(false);
  const [modePopupOpen, setModePopupOpen] = useState(false);
  const [showAllSessions, setShowAllSessions] = useState(false);
  const [pendingApproval, setPendingApproval] = useState<ToolApprovalRequest | null>(null);
  const modePopupRef = useRef<HTMLDivElement | null>(null);

  // Fixed DnD: counter-based to avoid nested element false leaves
  const dragCounterRef = useRef(0);
  const [isDragOver, setIsDragOver] = useState(false);

  const chatScrollerRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const settingsDropdownRef = useRef<HTMLDivElement | null>(null);
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
    const providerModels = modelSuggestions[activeSession.provider] ?? [];
    const current = activeSession.model?.trim();
    // Only include current model if it's actually in the provider's model list
    // This prevents showing stale models from a previous provider
    if (current && providerModels.includes(current)) {
      return [...new Set([current, ...providerModels])];
    }
    return [...new Set(providerModels)];
  }, [activeSession, modelSuggestions]);

  const mcpToolsForSelectedServer = useMemo(
    () => mcpToolsByServer[mcpSelectedServer] ?? [],
    [mcpSelectedServer, mcpToolsByServer],
  );

  const modelOptions = useMemo<ToolbarSelectOption[]>(() => {
    if (!activeSession) {
      return [];
    }

    const providerModels = modelSuggestions[activeSession.provider] ?? [];
    const current = activeSession.model?.trim();

    // Only include current model if it belongs to the active provider's list
    const merged = (current && providerModels.includes(current))
      ? [current, ...providerModels]
      : [...providerModels];

    return [...new Set(merged)]
      .filter((option) => option.trim().length > 0)
      .map((option) => ({
        value: option,
        label: option,
        meta: modelCapabilities[option] ?? undefined,
      }));
  }, [activeSession, modelSuggestions]);

  const modeOptions = useMemo<ToolbarSelectOption[]>(
    () => [
      {
        value: "agent",
        label: "Auto",
        description: "Plan, act, review, and verify",
      },
      {
        value: "plan",
        label: "Plan",
        description: "Outline implementation steps only",
      },
      {
        value: "ask",
        label: "Ask",
        description: "Explain or answer without editing first",
      },
    ],
    [],
  );

  const retryableMessageIds = useMemo(() => {
    if (!activeSession) return new Set<string>();
    const ids = new Set<string>();
    for (const msg of activeSession.messages) {
      if (msg.role === "assistant" && !msg.streaming && !msg.thinking) {
        if (findRetryPromptForMessage(activeSession, msg.id)) {
          ids.add(msg.id);
        }
      }
    }
    return ids;
  }, [activeSession]);

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

    // Create placeholder assistant message immediately for instant loading feedback
    const placeholder = useStore
      .getState()
      .beginAssistantMessage(request.sessionId, {
        provider: request.provider as ProviderId | undefined,
        model: request.model,
        mode: request.mode as AgentMode | undefined,
      });
    pendingRef.current = placeholder;

    useStore.getState().setBusy(true);
    vscode.postMessage({
      type: "sendPrompt",
      sessionId: request.sessionId,
      prompt: request.prompt,
      provider: request.provider,
      model: request.model,
      mode: request.mode,
      temperature: request.temperature,
      reasoningEffort: request.reasoningEffort,
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
        !settings.enableWebSearch &&
        /^\/tool\s+(web-search|search-web|online-search)\b/i.test(parsed.prompt)
      ) {
        window.alert(
          "Web search is disabled. Enable 'Enable web search tool' in Settings to use this command.",
        );
        return false;
      }

      useStore.getState().addUserMessageToSession(
        session.id,
        trimmed,
        useStore
          .getState()
          .attachments.filter((a) => attachmentIds.includes(a.id)),
      );
      const request: QueuedPrompt = {
        id: makeId("queue"),
        sessionId: session.id,
        rawPrompt: trimmed,
        prompt: parsed.prompt,
        provider: session.provider,
        model: session.model,
        mode: parsed.mode,
        temperature: settings.temperature,
        reasoningEffort: session.reasoningEffort,
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

  const handleApprovalResponse = useCallback((approved: boolean) => {
    if (!pendingApproval) return;
    vscode.postMessage({
      type: "toolApprovalResponse",
      requestId: pendingApproval.requestId,
      approved,
    });
    setPendingApproval(null);
  }, [pendingApproval]);

  const handleAttach = useCallback(() => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.accept =
      ".txt,.md,.json,.ts,.tsx,.js,.jsx,.py,.csv,.xlsx,.pdf,.png,.jpg,.jpeg,.gif";
    input.onchange = (e) => {
      const files = (e.target as HTMLInputElement).files;
      if (files) {
        Array.from(files).forEach(async (file) => {
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
          } else {
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
        });
      }
    };
    input.click();
  }, []);

  // NC-003: Persist state to VS Code webview state.
  // Settings are sanitized to ensure no secret values are ever written to disk.
  useEffect(() => {
    let handle: number | null = null;
    const unsub = useStore.subscribe((state) => {
      if (handle !== null) clearTimeout(handle);
      handle = window.setTimeout(() => {
        vscode.setState({
          sessions: state.sessions,
          activeSessionId: state.activeSessionId,
          drafts: state.drafts,
          settings: stripSecretsFromSettings(state.settings),
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
        // Escape handling is done per-component
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

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

  useEffect(() => {
    if (!settingsDropdownOpen) {
      return;
    }

    const handleClickOutside = (event: MouseEvent) => {
      if (
        settingsDropdownRef.current &&
        !settingsDropdownRef.current.contains(event.target as Node)
      ) {
        setSettingsDropdownOpen(false);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSettingsDropdownOpen(false);
      }
    };

    window.addEventListener("pointerdown", handleClickOutside);
    window.addEventListener("keydown", handleEscape);
    return () => {
      window.removeEventListener("pointerdown", handleClickOutside);
      window.removeEventListener("keydown", handleEscape);
    };
  }, [settingsDropdownOpen]);

  useEffect(() => {
    if (!modePopupOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (modePopupRef.current && !modePopupRef.current.contains(e.target as Node)) {
        setModePopupOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [modePopupOpen]);

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

            // If a placeholder was created at dispatch time, reuse it
            const existing = pendingRef.current;
            if (existing && existing.sessionId === startSessionId) {
              // Placeholder already exists, just update its metadata
              useStore
                .getState()
                .updateAssistantTrace(startSessionId, existing.messageId, [], []);
            } else {
              // No placeholder (e.g. queued task), create one now
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
          }
          return;
        case "status": {
          const raw = String(payload.message ?? "");
          if (!raw) return;
          debugRef.current.push(raw);
          const cleaned = sanitizeReasoningStatus(raw);
          if (!cleaned) return;

          const lastEntry = reasoningRef.current[reasoningRef.current.length - 1] ?? "";
          const isDuplicate =
            cleaned === lastEntry ||
            cleaned.startsWith(lastEntry) ||
            lastEntry.startsWith(cleaned) ||
            (cleaned.includes("Analyzing") && lastEntry.includes("Analyzing")) ||
            (cleaned.includes("Collecting") && lastEntry.includes("Collecting")) ||
            (cleaned.includes("Context") && lastEntry.includes("Context")) ||
            (cleaned.includes("Starting") && lastEntry.includes("Starting")) ||
            (cleaned.includes("Using") && lastEntry.includes("Using"));

          if (!isDuplicate) {
            reasoningRef.current = [cleaned];
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
            tokenUsage?: { input: number; output: number; total: number };
            efficiency?: {
              tokensPerRequest: number;
              tokensPerFileEdit: number;
              cacheHitRate: number;
              compressionRatio: number;
              parallelSpeedup: number;
              contextUtilization: number;
            };
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
              resp.tokenUsage,
              resp.efficiency,
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
          const rawMessage = String(payload.message ?? "Request failed.");
          const message = rawMessage
            .replace(/Agent loop failed: Error: /g, "")
            .replace(/All provider\/model attempts failed: Error: /g, "")
            .replace(/All stream attempts failed: Error: /g, "")
            .replace(/\{[^}]*\}/g, "")
            .replace(/\s+/g, " ")
            .trim();
          const cur = pendingRef.current;
          if (cur)
            useStore
              .getState()
              .failAssistantMessage(cur.sessionId, cur.messageId, message || "Request failed.");
          else showNotice("error", message || "Request failed.");
          return;
        }
        case "end":
          useStore.getState().setBusy(false);
          useStore.getState().resetParallel();
          pendingRef.current = null;
          reasoningRef.current = [];
          debugRef.current = [];
          tokenQueueRef.current = [];
          if (flushHandleRef.current !== null) {
            clearTimeout(flushHandleRef.current);
            flushHandleRef.current = null;
          }
          // Play completion sound and notify extension for VS Code notification
          playCompletionSound();
          vscode.postMessage({ type: "taskCompleted" });
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
        case "subagentSpawned": {
          const cur = pendingRef.current;
          const taskId = String(payload.taskId ?? makeId("subagent"));
          const description = String(payload.description ?? "Working...");
          if (cur) {
            debugRef.current.push(`Subagent spawned: ${description} (${taskId})`);
            reasoningRef.current = [
              ...reasoningRef.current.slice(-8),
              `Subagent spawned: ${description}`,
            ];
            useStore
              .getState()
              .updateAssistantTrace(
                cur.sessionId,
                cur.messageId,
                [...reasoningRef.current],
                [...debugRef.current],
              );
          }
          useStore.getState().addBackgroundAgent({
            id: taskId,
            description,
            status: "running",
          });
          setSubagentInfo({ description, status: "Running" });
          return;
        }
        case "subagentCompleted": {
          const cur = pendingRef.current;
          const taskId = String(payload.taskId ?? "");
          if (cur) {
            debugRef.current.push(`Subagent completed: ${taskId}`);
            reasoningRef.current = [
              ...reasoningRef.current.slice(-8),
              `Subagent completed: ${taskId}`,
            ];
            useStore
              .getState()
              .updateAssistantTrace(
                cur.sessionId,
                cur.messageId,
                [...reasoningRef.current],
                [...debugRef.current],
              );
          }
          useStore.getState().updateBackgroundAgent(taskId, {
            status: "completed",
            result: typeof payload.result === "string" ? payload.result : undefined,
          });
          setSubagentInfo(null);
          return;
        }
        case "toolExecuted": {
          const cur = pendingRef.current;
          if (cur) {
            const toolName = String(payload.toolName ?? "");
            const command = String(payload.command ?? "");
            const status = String(payload.status ?? "success") as "success" | "error" | "awaiting-approval";
            const message = typeof payload.message === "string" ? payload.message : undefined;
            const durationMs = typeof payload.durationMs === "number" ? payload.durationMs : undefined;
            const filesChanged = Array.isArray(payload.filesChanged) ? payload.filesChanged as string[] : undefined;
            const statusIcon = status === "success" ? "✓" : status === "error" ? "✗" : "⏳";
            const statusText = `${statusIcon} ${toolName}: ${command}`;
            debugRef.current.push(statusText);
            reasoningRef.current = [
              ...reasoningRef.current.slice(-8),
              statusText,
            ];
            useStore
              .getState()
              .updateAssistantTrace(
                cur.sessionId,
                cur.messageId,
                [...reasoningRef.current],
                [...debugRef.current],
              );
            useStore
              .getState()
              .addToolExecution(
                cur.sessionId,
                cur.messageId,
                {
                  toolName,
                  command,
                  status,
                  message,
                  timestamp: Date.now(),
                  durationMs,
                  filesChanged,
                  sources: Array.isArray(payload.sources) ? payload.sources : undefined,
                },
              );
          }
          return;
        }
        case "toolApprovalResult": {
          const cur = pendingRef.current;
          if (cur) {
            const toolName = String(payload.toolName ?? "");
            const pendingArg = String(payload.pendingArg ?? "");
            const approved = Boolean(payload.approved);
            const statusText = approved
              ? `✓ ${toolName}: approved`
              : `✗ ${toolName}: denied`;
            debugRef.current.push(statusText);
            reasoningRef.current = [
              ...reasoningRef.current.slice(-8),
              statusText,
            ];
            useStore
              .getState()
              .updateAssistantTrace(
                cur.sessionId,
                cur.messageId,
                [...reasoningRef.current],
                [...debugRef.current],
              );
            useStore
              .getState()
              .updateToolExecutionStatus(
                cur.sessionId,
                cur.messageId,
                toolName,
                pendingArg,
                approved ? "success" : "error",
                approved ? "Approved by user" : "Denied by user",
              );
          }
          return;
        }
        case "toolApprovalRequired": {
          const requestId = String(payload.requestId ?? "");
          const toolName = String(payload.toolName ?? "");
          const command = String(payload.command ?? "");
          if (requestId) {
            setPendingApproval({ requestId, toolName, command });
          }
          return;
        }
        case "parallelStart": {
          const count = typeof payload.count === "number" ? payload.count : 1;
          for (let i = 0; i < count; i++) {
            useStore.getState().incrementParallel();
          }
          return;
        }
        case "parallelEnd": {
          const count = typeof payload.count === "number" ? payload.count : 1;
          for (let i = 0; i < count; i++) {
            useStore.getState().decrementParallel();
          }
          return;
        }
        case "parallelReset": {
          useStore.getState().resetParallel();
          return;
        }
        case "batchEditStarted": {
          const cur = pendingRef.current;
          const editCount = typeof payload.editCount === "number" ? payload.editCount : 0;
          if (cur) {
            const statusText = `Batch edit started: ${editCount} file(s)`;
            debugRef.current.push(statusText);
            reasoningRef.current = [
              ...reasoningRef.current.slice(-8),
              statusText,
            ];
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
        case "batchEditCompleted": {
          const cur = pendingRef.current;
          const editCount = typeof payload.editCount === "number" ? payload.editCount : 0;
          const successCount = typeof payload.successCount === "number" ? payload.successCount : 0;
          if (cur) {
            const statusText = `Batch edit completed: ${successCount}/${editCount} succeeded`;
            debugRef.current.push(statusText);
            reasoningRef.current = [
              ...reasoningRef.current.slice(-8),
              statusText,
            ];
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
        case "taskList": {
          const tasks = Array.isArray(payload.tasks) ? payload.tasks.map((t: Record<string, unknown>) => ({
            id: String(t.id ?? ""),
            sessionId: String(t.sessionId ?? ""),
            prompt: String(t.prompt ?? ""),
            status: String(t.status ?? "queued") as QueuedTask["status"],
            mode: typeof t.mode === "string" ? t.mode : undefined,
            provider: typeof t.provider === "string" ? t.provider : undefined,
            model: typeof t.model === "string" ? t.model : undefined,
            createdAt: typeof t.createdAt === "number" ? t.createdAt : Date.now(),
            startedAt: typeof t.startedAt === "number" ? t.startedAt : undefined,
            completedAt: typeof t.completedAt === "number" ? t.completedAt : undefined,
            result: typeof t.result === "string" ? t.result : undefined,
            error: typeof t.error === "string" ? t.error : undefined,
            activityNote: typeof t.activityNote === "string" ? t.activityNote : undefined,
          })) : [];
          const pending = typeof payload.pendingCount === "number" ? payload.pendingCount : 0;
          const active = typeof payload.activeCount === "number" ? payload.activeCount : 0;
          useStore.getState().setTaskQueue(tasks, pending, active);
          return;
        }
        case "taskQueued": {
          // Don't add to UI queue here - let taskList be the single source of truth
          // taskList is emitted immediately after taskQueued by the backend
          return;
        }
        case "taskStarted": {
          const task = payload.task as Record<string, unknown> | undefined;
          if (task && typeof task.id === "string") {
            useStore.getState().updateTaskStatus(task.id, "running");
          }
          return;
        }
        case "taskSteered": {
          const taskId = String(payload.taskId ?? "");
          const message = String(payload.message ?? "");
          if (taskId) {
            showNotice("info", `Steered task: ${message}`);
          }
          return;
        }
        case "taskCancelled": {
          const taskId = String(payload.taskId ?? "");
          if (taskId) {
            useStore.getState().updateTaskStatus(taskId, "cancelled");
          }
          return;
        }
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
    const minH = 32;
    const maxH = 180;
    ta.style.height = `${Math.min(Math.max(scrollH, minH), maxH)}px`;
    ta.style.overflowY = scrollH > maxH ? "auto" : "hidden";
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

    const submitted = submitPrompt(rawPrompt, sess, attachmentIds);
    if (!submitted) {
      return;
    }

    useStore.getState().setDraft(sess.id, "");
    if (attachmentIds.length > 0) {
      useStore.getState().setAttachments([]);
    }
  }

  function onProviderChange(provider: ProviderId): void {
    useStore.getState().updateActiveSession({ provider, model: "" });
    vscode.postMessage({ type: "refreshProviderStatus", provider });
    vscode.postMessage({ type: "requestModelSuggestions", provider });
  }
  function onModelChange(model: string): void {
    useStore.getState().updateActiveSession({ model });
  }
  function onModeChange(mode: UiMode): void {
    useStore.getState().updateActiveSession({ mode });
  }

  const modeDescriptions: Record<UiMode, string> = {
    agent: "Build - Full coding assistant",
    ask: "Ask - Quick questions",
    plan: "Plan - Architecture planning",
  };

  const cycleMode = useCallback(() => {
    const modes: UiMode[] = ["agent", "ask", "plan"];
    const currentMode = activeSession?.mode ?? "agent";
    const currentIndex = modes.indexOf(currentMode);
    const nextMode = modes[(currentIndex + 1) % modes.length];
    onModeChange(nextMode);
  }, [activeSession?.mode]);

  if (!activeSession) {
    return <div className="nk-empty">Initializing…</div>;
  }

  const providerHealth = providerStatus[activeSession.provider];

  return (
    <div className="nk-shell">
      {/* ── Header ── */}
      <header className="nk-header">
        <span className="nk-header-title">Tasks</span>
        <div className="nk-header-actions" ref={settingsDropdownRef}>
          <div className="nk-settings-dropdown-wrap">
            <button
              className="nk-icon-btn"
              title="Settings"
              onClick={() => setSettingsDropdownOpen(!settingsDropdownOpen)}
            >
              <Settings size={14} />
            </button>
            {settingsDropdownOpen && (
              <div className="nk-settings-dropdown">
                {/* Provider Selection */}
                <div className="nk-settings-section">
                  <div className="nk-settings-label">Provider</div>
                  <select
                    className="nk-settings-select"
                    value={activeSession.provider}
                    onChange={(e) => {
                      const provider = e.target.value as ProviderId;
                      useStore.getState().updateActiveSession({ provider, model: "" });
                      vscode.postMessage({ type: "refreshProviderStatus", provider });
                      vscode.postMessage({ type: "requestModelSuggestions", provider });
                    }}
                  >
                    <option value="ollama">Ollama (Local)</option>
                    <option value="openai-compatible">OpenAI Compatible</option>
                    <option value="huggingface">Hugging Face</option>
                    <option value="openrouter">OpenRouter</option>
                    <option value="together">Together AI</option>
                    <option value="fireworks">Fireworks AI</option>
                    <option value="groq">GroqCloud</option>
                    <option value="nvidia">NVIDIA NIM</option>
                    <option value="baseten">Baseten</option>
                  </select>
                </div>

                {/* Model Selection */}
                <div className="nk-settings-section">
                  <div className="nk-settings-label">Model</div>
                  <select
                    className="nk-settings-select"
                    value={activeSession.model}
                    onChange={(e) => {
                      useStore.getState().updateActiveSession({ model: e.target.value });
                    }}
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
                </div>

                {/* Ollama Settings - only show when provider is ollama */}
                {activeSession.provider === 'ollama' && (
                  <div className="nk-settings-section">
                    <div className="nk-settings-label">Ollama Base URL</div>
                    <input
                      className="nk-settings-input"
                      type="text"
                      placeholder="http://localhost:11434"
                      value={settings.ollamaBaseUrl ?? 'http://localhost:11434'}
                      onChange={(e) => {
                        useStore.getState().updateSetting('ollamaBaseUrl', e.target.value);
                      }}
                    />
                  </div>
                )}

                {/* Cloud Provider Settings - show for all cloud providers */}
                {activeSession.provider !== 'ollama' && (() => {
                  const preset = providerPresets[activeSession.provider] ?? providerPresets['openai-compatible'];
                  return (
                    <>
                      <div className="nk-settings-section">
                        <div className="nk-settings-label">API Base URL</div>
                        <input
                          className="nk-settings-input"
                          type="text"
                          placeholder={preset.baseUrl || "https://api.example.com/v1"}
                          value={settings.openAIBaseUrl ?? ''}
                          onChange={(e) => {
                            useStore.getState().updateSetting('openAIBaseUrl', e.target.value);
                          }}
                        />
                      </div>
                      <div className="nk-settings-section">
                        <div className="nk-settings-label">
                          API Key
                          {settings.openAIApiKeyConfigured && (
                            <span style={{ marginLeft: 8, fontSize: '0.85em', opacity: 0.7 }}>(configured)</span>
                          )}
                        </div>
                        <input
                          className="nk-settings-input"
                          type="password"
                          placeholder={settings.openAIApiKeyConfigured ? "Key stored securely — type to replace" : preset.apiKeyPlaceholder}
                          value={localApiKey}
                          onChange={(e) => {
                            setLocalApiKey(e.target.value);
                          }}
                          onBlur={() => {
                            // NC-003: Send the secret to the extension host on blur.
                            // Never store it in the Zustand store or webview state.
                            if (localApiKey.trim()) {
                              useStore.getState().sendSecret('openAIApiKey', localApiKey);
                              setLocalApiKey('');
                            }
                          }}
                        />
                        <div className="nk-settings-hint">
                          {preset.hint}
                        </div>
                      </div>
                    </>
                  );
                })()}

                {/* Web Search Settings - show when web search is enabled */}
                {settings.enableWebSearch && (
                  <>
                    <div className="nk-settings-section">
                      <div className="nk-settings-label">Search Provider</div>
                      <select
                        className="nk-settings-select"
                        value={settings.searchProvider ?? 'tavily'}
                        onChange={(e) => {
                          const provider = e.target.value as SearchProviderId;
                          useStore.getState().updateSetting('searchProvider', provider);
                        }}
                      >
                        <option value="tavily">Tavily</option>
                        <option value="serpapi">SerpAPI</option>
                        <option value="serper">Serper</option>
                        <option value="bing">Bing Search</option>
                        <option value="duckduckgo">DuckDuckGo (Free)</option>
                        <option value="custom">Custom API</option>
                      </select>
                    </div>
                    {settings.searchProvider !== 'duckduckgo' && (
                      <div className="nk-settings-section">
                        <div className="nk-settings-label">
                          Search API Key
                          {settings.searchApiKeyConfigured && (
                            <span style={{ marginLeft: 8, fontSize: '0.85em', opacity: 0.7 }}>(configured)</span>
                          )}
                        </div>
                        <input
                          className="nk-settings-input"
                          type="password"
                          placeholder={settings.searchApiKeyConfigured ? "Key stored securely — type to replace" : getSearchProviderPlaceholder(settings.searchProvider ?? 'tavily')}
                          value={localSearchApiKey}
                          onChange={(e) => {
                            setLocalSearchApiKey(e.target.value);
                          }}
                          onBlur={() => {
                            // NC-003: Send the secret to the extension host on blur.
                            // Never store it in the Zustand store or webview state.
                            if (localSearchApiKey.trim()) {
                              useStore.getState().sendSecret('searchApiKey', localSearchApiKey);
                              setLocalSearchApiKey('');
                            }
                          }}
                        />
                        <div className="nk-settings-hint">
                          {getSearchProviderHint(settings.searchProvider ?? 'tavily')}
                        </div>
                      </div>
                    )}
                    {settings.searchProvider === 'duckduckgo' && (
                      <div className="nk-settings-section">
                        <div className="nk-settings-hint">
                          {getSearchProviderHint(settings.searchProvider ?? 'tavily')}
                        </div>
                      </div>
                    )}
                    {(settings.searchProvider === 'custom' || settings.searchProvider === 'serpapi' || settings.searchProvider === 'serper' || settings.searchProvider === 'bing') && (
                      <div className="nk-settings-section">
                        <div className="nk-settings-label">Search API Base URL</div>
                        <input
                          className="nk-settings-input"
                          type="text"
                          placeholder={getSearchProviderUrlPlaceholder(settings.searchProvider ?? 'tavily')}
                          value={settings.searchBaseUrl ?? ''}
                          onChange={(e) => {
                            useStore.getState().updateSetting('searchBaseUrl', e.target.value);
                          }}
                        />
                      </div>
                    )}
                  </>
                )}

                {/* Permission Mode */}
                <div className="nk-settings-section">
                  <div className="nk-settings-label">Permission Mode</div>
                  <select
                    className="nk-settings-select"
                    value={settings.requireTerminalApproval ? "ask" : "auto"}
                    onChange={(e) => {
                      const mode = e.target.value;
                      if (mode === "auto") {
                        useStore.getState().updateSetting("autoApprove", false);
                        useStore.getState().updateSetting("requireTerminalApproval", false);
                        vscode.postMessage({ type: "updateSetting", key: "toolApproval", value: "auto" });
                      } else {
                        useStore.getState().updateSetting("autoApprove", false);
                        useStore.getState().updateSetting("requireTerminalApproval", true);
                        vscode.postMessage({ type: "updateSetting", key: "toolApproval", value: "ask" });
                      }
                    }}
                  >
                    <option value="ask">Ask — require approval for destructive tools</option>
                    <option value="auto">Auto — approve safe tools automatically</option>
                  </select>
                </div>

                {/* Links */}
                <div className="nk-settings-section nk-settings-links">
                  <div
                    className="nk-settings-link"
                    onClick={() => {
                      vscode.postMessage({ type: "openSettings" });
                      setSettingsDropdownOpen(false);
                    }}
                  >
                    All Settings
                  </div>
                  <div
                    className="nk-settings-link"
                    onClick={() => {
                      vscode.postMessage({ type: "openShortcuts" });
                      setSettingsDropdownOpen(false);
                    }}
                  >
                    Keyboard Shortcuts
                  </div>
                </div>
              </div>
            )}
          </div>
          <button
            className="nk-icon-btn"
            title="New chat"
            onClick={() => useStore.getState().newSession()}
          >
            <Edit size={14} />
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
          <div className="nk-session-list-inline">
            {(showAllSessions ? sessions : sessions.slice(0, 5)).map((session) => (
              <div
                key={session.id}
                className={`nk-session-item-inline ${session.id === activeSessionId ? "nk-session-item-inline--active" : ""}`}
                onClick={() => useStore.getState().setActiveSession(session.id)}
              >
                <span className="nk-session-title">
                  {session.title || "New task"}
                </span>
                <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <span className="nk-session-time">
                    {getTimeAgo(session.updatedAt)}
                  </span>
                  <button
                    className="nk-session-delete"
                    onClick={(e) => {
                      e.stopPropagation();
                      useStore.getState().deleteSession(session.id);
                    }}
                  >
                    <X size={12} />
                  </button>
                </div>
              </div>
            ))}
            {sessions.length > 5 && (
              <div
                className="nk-session-view-all"
                onClick={() => setShowAllSessions((prev) => !prev)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setShowAllSessions((prev) => !prev);
                  }
                }}
              >
                {showAllSessions ? "Show less" : `View all (${sessions.length})`}
              </div>
            )}
          </div>
        ) : (
          <>
          {subagentInfo && (
            <SubagentIndicator
              description={subagentInfo.description}
              status={subagentInfo.status}
            />
          )}
          <BackgroundAgents agents={backgroundAgents} waveInfo={waveInfo ?? undefined} />
          {parallelCount > 1 && (
            <ParallelIndicator count={parallelCount} />
          )}
          <div className="nk-messages-list">
            <AnimatePresence initial={false}>
              {activeSession.messages.map((msg) => (
                <MemoizedMessageBubble
                  key={msg.id}
                  message={msg}
                  showDebug={settings.showDebugPanel}
                  canRetry={
                    retryableMessageIds.has(msg.id)
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
          </>
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

      {/* ── Task Queue (below chat) - only show when items are actually pending ── */}
      {taskQueuePendingCount > 0 && (
        <div className="nk-task-queue-panel">
          <div className="nk-task-queue-header">
            <ListTodo size={11} />
            <span className="nk-task-queue-title">
              {taskQueueActiveCount > 0 && (
                <span className="nk-task-queue-badge nk-task-queue-badge--active">
                  {taskQueueActiveCount} active
                </span>
              )}
              {taskQueuePendingCount > 0 && (
                <span className="nk-task-queue-badge nk-task-queue-badge--pending">
                  {taskQueuePendingCount} queued
                </span>
              )}
            </span>
            {taskQueuePendingCount > 0 && (
              <button
                className="nk-task-queue-cancel"
                title="Clear all queued tasks"
                onClick={() => {
                  useStore.getState().clearTaskQueue();
                }}
                style={{ marginLeft: "auto", fontSize: "10px", gap: "3px" }}
              >
                <Trash2 size={10} />
                <span>Clear</span>
              </button>
            )}
          </div>
          <div className="nk-task-queue-list">
            {taskQueue.slice(0, 3).map((task) => (
              <div
                key={task.id}
                className="nk-task-queue-item"
              >
                <div className="nk-task-queue-item-status">
                  {task.status === "running" && <Radio size={10} className="nk-spin" />}
                  {task.status === "queued" && <Square size={10} />}
                  {task.status === "completed" && <CheckCircle2 size={10} />}
                  {task.status === "failed" && <X size={10} />}
                  {task.status === "cancelled" && <X size={10} />}
                  {task.status === "planning" && <Search size={10} className="nk-spin" />}
                  {task.status === "verifying" && <Terminal size={10} className="nk-spin" />}
                </div>
                <div className="nk-task-queue-item-content">
                  <div className="nk-task-queue-item-prompt">
                    {task.prompt.length > 50 ? task.prompt.slice(0, 50) + "..." : task.prompt}
                  </div>
                </div>
                {task.status === "running" && (
                  <button
                    className="nk-task-queue-cancel"
                    title="Cancel"
                    onClick={() => {
                      vscode.postMessage({ type: "cancelTask", taskId: task.id });
                    }}
                  >
                    <X size={10} />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Input area ── */}
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
          <textarea
            ref={textareaRef}
            className="nk-textarea"
            placeholder="Ask anything..."
            value={activeDraft}
            rows={1}
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

          {/* Toolbar row */}
          <div className="nk-input-toolbar">
            <div className="nk-input-toolbar-left">
              <div className="nk-mode-selector-wrap" ref={modePopupRef}>
                <button
                  type="button"
                  className={`nk-mode-selector ${modePopupOpen ? "nk-mode-selector--active" : ""}`}
                  onClick={() => setModePopupOpen(!modePopupOpen)}
                  aria-label="Choose conversation mode"
                  aria-expanded={modePopupOpen}
                  aria-haspopup="menu"
                >
                  {activeSession.mode === "agent" && <Code2 size={14} />}
                  {activeSession.mode === "ask" && <MessageSquare size={14} />}
                  {activeSession.mode === "plan" && <Compass size={14} />}
                </button>

                {modePopupOpen && (
                  <div className="nk-mode-popup">
                  <div
                    className={`nk-mode-option ${activeSession.mode === "agent" ? "nk-mode-option--active" : ""}`}
                    onClick={() => { onModeChange("agent"); setModePopupOpen(false); }}
                  >
                    <Code2 size={14} />
                    <div>
                      <div className="nk-mode-option-title">Build</div>
                      <div className="nk-mode-option-desc">Full coding assistant</div>
                    </div>
                  </div>
                  <div
                    className={`nk-mode-option ${activeSession.mode === "ask" ? "nk-mode-option--active" : ""}`}
                    onClick={() => { onModeChange("ask"); setModePopupOpen(false); }}
                  >
                    <MessageSquare size={14} />
                    <div>
                      <div className="nk-mode-option-title">Ask</div>
                      <div className="nk-mode-option-desc">Quick questions</div>
                    </div>
                  </div>
                  <div
                    className={`nk-mode-option ${activeSession.mode === "plan" ? "nk-mode-option--active" : ""}`}
                    onClick={() => { onModeChange("plan"); setModePopupOpen(false); }}
                  >
                    <Compass size={14} />
                    <div>
                      <div className="nk-mode-option-title">Plan</div>
                      <div className="nk-mode-option-desc">Architecture planning</div>
                    </div>
                  </div>
                  </div>
                )}
              </div>
              <div className="nk-toolbar-separator" />
              <ToolbarSelect
                value={activeSession.model}
                options={modelOptions}
                onChange={onModelChange}
                label="Model"
                className="nk-toolbar-select--model"
                menuClassName="nk-toolbar-select-menu--model"
                searchable
              />
              {(() => {
                const effortInfo = getModelEffortInfo(activeSession.model);
                if (!effortInfo || !effortInfo.supportsEffort) return null;
                return (
                  <div className="nk-effort-select">
                    <button
                      className="nk-effort-trigger"
                      type="button"
                      title="Reasoning effort"
                      onClick={(e) => {
                        e.stopPropagation();
                        const current = activeSession.reasoningEffort ?? effortInfo.default;
                        const idx = effortInfo.levels.indexOf(current);
                        const next = effortInfo.levels[(idx + 1) % effortInfo.levels.length];
                        useStore.getState().updateActiveSession({ reasoningEffort: next });
                      }}
                    >
                      <span className="nk-effort-label">Effort</span>
                      <span className="nk-effort-value" data-effort={activeSession.reasoningEffort ?? effortInfo.default}>
                        {effortLabels[(activeSession.reasoningEffort ?? effortInfo.default) as ReasoningEffort]}
                      </span>
                    </button>
                  </div>
                );
              })()}
              <button
                className="nk-toolbar-btn"
                type="button"
                title="Attach file"
                onClick={handleAttach}
              >
                <Paperclip size={14} />
              </button>
            </div>
            <div className="nk-input-toolbar-right">
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
                className="nk-send-btn"
                disabled={!activeDraft.trim() || isBusy}
                title={isBusy ? "Queue prompt (Enter)" : "Send (Enter)"}
                onClick={onSendPrompt}
              >
                <ArrowUp size={14} />
              </button>
            </div>
          </div>
        </div>
      </div>


      {/* ── Overlays ── */}

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

      {/* Tool Approval Dialog */}
      <AnimatePresence>
        {pendingApproval && (
          <motion.div
            className="nk-modal-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <ToolApprovalDialog
              request={pendingApproval}
              onApprove={() => handleApprovalResponse(true)}
              onDeny={() => handleApprovalResponse(false)}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

const root = document.getElementById("root");
if (root) {
  try {
    createRoot(root).render(<App />);
  } catch (err: unknown) {
    root.innerHTML =
      '<pre style="color:#ff6b6b;padding:16px;font-size:12px;white-space:pre-wrap;">Render error: ' +
      String(err) +
      "</pre>";
  }
}
