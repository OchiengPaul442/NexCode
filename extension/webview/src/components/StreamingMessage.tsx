import React from "react";
import { useStreamingText } from "../hooks/useStreamingText";
import { RichMarkdown } from "./RichMarkdown";

type StatusLabel = "thinking" | "exploring" | "editing" | "searching" | "shell" | "reviewing";

interface ToolCallCounts {
  reads?: number;
  writes?: number;
  searches?: number;
  terminals?: number;
  patches?: number;
  deletes?: number;
  other?: number;
}

interface StreamingMessageProps {
  text: string;
  streaming?: boolean;
  markdown?: boolean;
  as?: "div" | "span";
  className?: string;
  showCursor?: boolean;
  thinkingLabel?: string;
  statusLabel?: StatusLabel;
  statusDetail?: string;
  toolCounts?: ToolCallCounts;
  activeCommand?: string;
  charsPerFrame?: number;
  onFrame?: () => void;
}

const statusLabelConfig: Record<StatusLabel, { color: string; defaultText: string }> = {
  thinking: { color: "#7598bc", defaultText: "Thinking" },
  exploring: { color: "#3794ff", defaultText: "Exploring" },
  editing: { color: "#4ec9b0", defaultText: "Editing" },
  searching: { color: "#d7ba7d", defaultText: "Searching" },
  shell: { color: "#c586c0", defaultText: "Shell" },
  reviewing: { color: "#94a3b8", defaultText: "Reviewing" },
};

function formatToolCounts(counts: ToolCallCounts): string {
  const parts: string[] = [];
  if (counts.reads && counts.reads > 0) parts.push(`${counts.reads} read${counts.reads !== 1 ? "s" : ""}`);
  if (counts.writes && counts.writes > 0) parts.push(`${counts.writes} write${counts.writes !== 1 ? "s" : ""}`);
  if (counts.searches && counts.searches > 0) parts.push(`${counts.searches} search${counts.searches !== 1 ? "es" : ""}`);
  if (counts.terminals && counts.terminals > 0) parts.push(`${counts.terminals} shell command${counts.terminals !== 1 ? "s" : ""}`);
  if (counts.patches && counts.patches > 0) parts.push(`${counts.patches} patch${counts.patches !== 1 ? "es" : ""}`);
  if (counts.deletes && counts.deletes > 0) parts.push(`${counts.deletes} delete${counts.deletes !== 1 ? "s" : ""}`);
  if (counts.other && counts.other > 0) parts.push(`${counts.other} other`);
  return parts.join(", ");
}

export function StreamingMessage({
  text,
  streaming = false,
  markdown = true,
  as = "div",
  className,
  showCursor = true,
  thinkingLabel = "Thinking...",
  statusLabel,
  statusDetail,
  toolCounts,
  activeCommand,
  charsPerFrame = 2,
  onFrame,
}: StreamingMessageProps) {
  const Element = as === "span" ? "span" : "div";
  const { displayedText, isStreaming, isThinking } = useStreamingText({
    text,
    streaming,
    charsPerFrame,
    onFrame,
  });
  const rootClassName = ["nk-streaming-message", className]
    .filter(Boolean)
    .join(" ");

  if (isThinking) {
    const config = statusLabel ? statusLabelConfig[statusLabel] : null;
    const displayText = statusDetail ?? thinkingLabel;
    const toolCountStr = toolCounts ? formatToolCounts(toolCounts) : "";

    return (
      <Element className={rootClassName}>
        <div className="nk-streaming-live" role="status" aria-label="Agent activity">
          {/* Live activity line: "Exploring  18 reads, 3 searches" */}
          {config && (
            <div className="nk-streaming-live-activity">
              <span className="nk-streaming-live-label" style={{ color: config.color }}>
                {config.defaultText}
              </span>
              {toolCountStr && (
                <span className="nk-streaming-live-counts">{toolCountStr}</span>
              )}
            </div>
          )}

          {/* Live shell command display */}
          {activeCommand && (
            <div className="nk-streaming-live-shell">
              <span className="nk-streaming-live-shell-label" style={{ color: statusLabelConfig.shell.color }}>
                Shell
              </span>
              <code className="nk-streaming-live-shell-cmd">{activeCommand}</code>
            </div>
          )}

          {/* Thinking indicator */}
          <div className="nk-streaming-live-thinking">
            <span className="nk-streaming-live-thinking-dot" />
            <span className="nk-streaming-thinking">{displayText}</span>
          </div>
        </div>
      </Element>
    );
  }

  if (markdown) {
    return (
      <div className={rootClassName}>
        <RichMarkdown text={displayedText} />
        {showCursor && isStreaming && (
          <span className="nk-streaming-cursor" aria-hidden="true" />
        )}
      </div>
    );
  }

  return (
    <Element className={rootClassName}>
      <span className="whitespace-pre-wrap">{displayedText}</span>
      {showCursor && isStreaming && (
        <span className="nk-streaming-cursor" aria-hidden="true" />
      )}
    </Element>
  );
}
