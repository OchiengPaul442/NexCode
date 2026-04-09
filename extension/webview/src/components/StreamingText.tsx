import React from "react";
import { RichMarkdown } from "./RichMarkdown";

interface StreamingTextProps {
  text: string;
  streaming?: boolean;
  markdown?: boolean;
  as?: "div" | "span";
  className?: string;
  showCursor?: boolean;
}

export function StreamingText({
  text,
  streaming = false,
  markdown = true,
  as = "div",
  className,
  showCursor = true,
}: StreamingTextProps) {
  const Element = as === "span" ? "span" : "div";
  const renderedText = text;
  const displayCursor = streaming && showCursor;
  const rootClassName = ["nk-streaming-text", className]
    .filter(Boolean)
    .join(" ");

  if (markdown) {
    return (
      <div className={rootClassName}>
        <RichMarkdown text={renderedText} />
        {displayCursor && (
          <span className="nk-streaming-cursor" aria-hidden="true" />
        )}
      </div>
    );
  }

  return (
    <Element className={rootClassName}>
      <span className="whitespace-pre-wrap">{renderedText}</span>
      {displayCursor && (
        <span className="nk-streaming-cursor" aria-hidden="true" />
      )}
    </Element>
  );
}
