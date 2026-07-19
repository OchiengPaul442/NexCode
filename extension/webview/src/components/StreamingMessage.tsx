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

function cleanThinkingText(text: string): string {
  // Remove <think> tags and their content (model reasoning artifacts)
  let cleaned = text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  // Remove any remaining partial <think> tags
  cleaned = cleaned.replace(/<think>[\s\S]*$/g, "").trim();
  // If the text is empty after cleaning, return empty
  if (!cleaned) return "";
  // Truncate very long thinking content to first meaningful line
  const lines = cleaned.split("\n").filter(l => l.trim().length > 0);
  if (lines.length > 0) {
    // Return first meaningful line, truncated to reasonable length
    const first = lines[0].trim();
    return first.length > 80 ? first.slice(0, 80) + "..." : first;
  }
  return cleaned.length > 80 ? cleaned.slice(0, 80) + "..." : cleaned;
}

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

  // Show thinking overlay during thinking phase (when streaming but no text yet)
  const showThinkingOverlay = isThinking;
  const config = statusLabel ? statusLabelConfig[statusLabel] : null;
  const rawThinking = statusDetail ?? thinkingLabel;
  const displayText = cleanThinkingText(rawThinking);
  const toolCountStr = toolCounts ? formatToolCounts(toolCounts) : "";

  return (
    <Element className={rootClassName}>
      {/* Main text with typewriter effect - always rendered when streaming or has text */}
      {(displayedText || isStreaming) && (
        <div className="nk-streaming-content">
          {markdown ? (
            <RichMarkdown text={displayedText} />
          ) : (
            <span className="whitespace-pre-wrap">{displayedText}</span>
          )}
          {showCursor && isStreaming && (
            <span className="nk-streaming-cursor" aria-hidden="true" />
          )}
        </div>
      )}

      {/* Thinking overlay - shown during thinking phase */}
      {showThinkingOverlay && (
        <div className="nk-streaming-live" role="status" aria-label="Agent activity">
          {/* Live activity line: status label + tool counts */}
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

          {/* Thinking indicator - only show if we have meaningful text */}
          {displayText && (
            <div className="nk-streaming-live-thinking">
              <span className="nk-streaming-live-thinking-dot" />
              <span className="nk-streaming-thinking">{displayText}</span>
            </div>
          )}

          {/* Pulsing dot when no other content */}
          {!displayText && !config && (
            <div className="nk-streaming-live-thinking">
              <span className="nk-streaming-live-thinking-dot" />
              <span className="nk-streaming-thinking">Working...</span>
            </div>
          )}
        </div>
      )}

      {/* Static content when not streaming and no text */}
      {!isStreaming && !displayedText && !streaming && (
        <Element className={rootClassName}>
          <span className="whitespace-pre-wrap">{text}</span>
        </Element>
      )}
    </Element>
  );
}
