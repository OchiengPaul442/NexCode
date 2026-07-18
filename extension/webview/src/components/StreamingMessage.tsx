import React from "react";
import { useStreamingText } from "../hooks/useStreamingText";
import { RichMarkdown } from "./RichMarkdown";

type StatusLabel = "thinking" | "exploring" | "editing" | "searching" | "shell" | "reviewing";

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
  charsPerFrame?: number;
  onFrame?: () => void;
}

const statusLabelConfig: Record<StatusLabel, { color: string; defaultText: string }> = {
  thinking: { color: "#7598bc", defaultText: "Thinking" },
  exploring: { color: "#3794ff", defaultText: "Exploring" },
  editing: { color: "#4ec9b0", defaultText: "Edit" },
  searching: { color: "#d7ba7d", defaultText: "Searching" },
  shell: { color: "#c586c0", defaultText: "Shell" },
  reviewing: { color: "#94a3b8", defaultText: "Reviewing" },
};

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
    
    return (
      <Element className={rootClassName}>
        <div className="nk-streaming-status-container">
          {config && (
            <span className="nk-streaming-status-label" style={{ color: config.color }}>
              <span className="nk-streaming-status-text">{config.defaultText}</span>
            </span>
          )}
          <span className="nk-streaming-thinking nk-thinking-label--shimmer">
            {displayText}
          </span>
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
