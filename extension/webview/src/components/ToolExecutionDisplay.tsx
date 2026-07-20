import React, { useMemo, useState } from "react";
import { ChevronRight } from "lucide-react";
import type { ToolExecution, ChatMessage } from "../types";
import { StreamingMessage } from "./StreamingMessage";

export type ToolGroup = {
  type: string;
  label: string;
  count: number;
  executions: ToolExecution[];
  hasError: boolean;
};

// Group consecutive tool executions by type for compact display
export function groupToolExecutions(tools: ToolExecution[]): ToolGroup[] {
  const groups: ToolGroup[] = [];

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
export function extractFilePath(exec: ToolExecution): string | null {
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
export function ToolGroupLine({
  group,
  onOpenFile,
  onToggleExpand,
  isExpanded,
}: {
  group: ToolGroup;
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
  const _fileName = mainFile ? mainFile.split(/[/\\]/).pop() ?? mainFile : null;

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

  const _handleClick = () => {
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
export function ToolGroupDetail({
  group,
  onOpenFile: _onOpenFile,
}: {
  group: ToolGroup;
  onOpenFile?: (filePath: string) => void;
}) {
  return (
    <div className="nk-tool-detail">
      {group.executions.map((exec, i) => {
        const filePath = extractFilePath(exec);
        const _fileName = filePath ? filePath.split(/[/\\]/).pop() ?? filePath : null;
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
export function MessageContent({
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
