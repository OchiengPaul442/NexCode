import React, { useState } from "react";
import {
  Image,
  FileText,
  File,
  CheckCircle2,
  ChevronRight,
  ExternalLink,
  Globe,
  Square,
  Radio,
} from "lucide-react";
import type { ActivityTodo, ChatMessage } from "../types";
import { formatTokenCount } from "../utils";

export function AttachIcon({ kind }: { kind: "text" | "image" | "binary" }) {
  if (kind === "image") return <Image size={12} />;
  if (kind === "text") return <FileText size={12} />;
  return <File size={12} />;
}

export function formatTime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}m ${secs}s`;
}

export function ActivityTodosSection({ todos }: { todos: ActivityTodo[] }) {
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

export function ResponseSummary({ message }: { message: ChatMessage }) {
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

export const SourcesSection = React.memo(function SourcesSection({
  sources,
}: {
  sources: Array<{ title: string; url: string; snippet?: string }>;
}) {
  const [expanded, setExpanded] = useState(false);
  const VISIBLE_COUNT = 5;
  const _hasMore = sources.length > VISIBLE_COUNT;
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
