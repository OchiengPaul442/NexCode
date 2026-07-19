import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeKatex from "rehype-katex";
import remarkMath from "remark-math";
import { CodeBlock } from "./CodeBlock";

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
        components={{
          code({ className: codeClassName, children, ...props }) {
            const isInline = !codeClassName;
            return (
              <CodeBlock
                className={codeClassName}
                inline={isInline}
                {...props}
              >
                {children}
              </CodeBlock>
            );
          },
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
