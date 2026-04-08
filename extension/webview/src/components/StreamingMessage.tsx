import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useStreamingText } from "../hooks/useStreamingText";

interface StreamingMessageProps {
  text: string;
  streaming?: boolean;
  markdown?: boolean;
  as?: "div" | "span";
  className?: string;
  showCursor?: boolean;
  thinkingLabel?: string;
  charsPerFrame?: number;
  onFrame?: () => void;
}

export function StreamingMessage({
  text,
  streaming = false,
  markdown = true,
  as = "div",
  className,
  showCursor = true,
  thinkingLabel = "Thinking...",
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
    return (
      <Element className={rootClassName}>
        <span className="nk-streaming-thinking nk-thinking-label--shimmer">
          {thinkingLabel}
        </span>
      </Element>
    );
  }

  if (markdown && !isStreaming) {
    return (
      <div className={rootClassName}>
        <ReactMarkdown remarkPlugins={[remarkGfm]}>
          {displayedText}
        </ReactMarkdown>
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
