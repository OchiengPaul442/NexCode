import React, { useCallback, useState } from "react";
import { Highlight, themes } from "prism-react-renderer";

interface CodeBlockProps {
  children?: React.ReactNode;
  className?: string;
  inline?: boolean;
}

export function CodeBlock({ children, className, inline }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);

  const match = /language-(\w+)/.exec(className || "");
  const language = match ? match[1] : "text";

  const code = String(children).replace(/\n$/, "");

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [code]);

  if (inline) {
    return (
      <code className={className}>
        {children}
      </code>
    );
  }

  return (
    <div className="nk-code-block-wrapper">
      <div className="nk-code-block-header">
        <span className="nk-code-block-language">{language}</span>
        <button
          className="nk-code-block-copy"
          onClick={handleCopy}
          title="Copy code"
        >
          {copied ? "\u2713 Copied" : "Copy"}
        </button>
      </div>
      <Highlight
        theme={themes.vsDark}
        code={code}
        language={language}
      >
        {({ className: hlClassName, style, tokens, getLineProps, getTokenProps }) => (
          <pre className={`${hlClassName} nk-code-block-pre`} style={style}>
            {tokens.map((line, i) => (
              <div key={i} {...getLineProps({ line })} className="nk-code-line">
                <span className="nk-code-line-number">{i + 1}</span>
                <span className="nk-code-line-content">
                  {line.map((token, key) => (
                    <span key={key} {...getTokenProps({ token })} />
                  ))}
                </span>
              </div>
            ))}
          </pre>
        )}
      </Highlight>
    </div>
  );
}
