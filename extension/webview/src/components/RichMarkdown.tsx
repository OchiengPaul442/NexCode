import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeKatex from "rehype-katex";
import remarkMath from "remark-math";

export function RichMarkdown({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  const rootClassName = ["nk-rich-markdown", className]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={rootClassName}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
