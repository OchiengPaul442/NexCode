import React, { useEffect, useState, useRef } from "react";
import { createRoot } from "react-dom/client";

const vscode = (window as any).acquireVsCodeApi
  ? (window as any).acquireVsCodeApi()
  : null;

type Msg = { role: "user" | "assistant"; text: string; id: string };

action();

function action() {
  const App = () => {
    const [messages, setMessages] = useState<Msg[]>([
      {
        role: "assistant",
        text: "Welcome to Kiboko. Describe what you want to build.",
        id: "init",
      },
    ]);
    const [input, setInput] = useState("");
    const [streaming, setStreaming] = useState(false);
    const [currentId, setCurrentId] = useState<string | null>(null);
    const chatRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
      function handleMessage(event: MessageEvent) {
        const msg = event.data;
        if (!msg || !msg.type) return;
        if (msg.type === "streamStart") {
          setStreaming(true);
        } else if (msg.type === "streamToken") {
          const { assistantId, token } = msg;
          setMessages((prev) => {
            return prev.map((m) =>
              m.id === assistantId ? { ...m, text: m.text + token } : m,
            );
          });
        } else if (msg.type === "streamEnd") {
          setStreaming(false);
          setCurrentId(null);
        }
      }
      window.addEventListener("message", handleMessage);
      return () => window.removeEventListener("message", handleMessage);
    }, []);

    useEffect(() => {
      if (chatRef.current)
        chatRef.current.scrollTop = chatRef.current.scrollHeight;
    }, [messages]);

    const send = () => {
      const text = input.trim();
      if (!text) return;
      const id = Date.now().toString();
      setMessages((m) => [...m, { role: "user", text, id: "u-" + id }]);
      // create assistant placeholder
      setMessages((m) => [...m, { role: "assistant", text: "", id }]);
      setCurrentId(id);
      setInput("");
      setStreaming(true);
      // ask extension to start streaming
      vscode.postMessage({
        type: "requestStream",
        prompt: text,
        assistantId: id,
      });
    };

    const cancel = () => {
      if (currentId) {
        vscode.postMessage({ type: "cancelStream", assistantId: currentId });
        setStreaming(false);
        setCurrentId(null);
      }
    };

    return (
      <div
        style={{
          height: "100vh",
          display: "flex",
          fontFamily: "Inter, Arial, sans-serif",
        }}
      >
        <div
          style={{
            width: 260,
            background: "#151515",
            padding: 12,
            boxSizing: "border-box",
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: 8 }}>Sessions</div>
          <div
            style={{
              background: "#2a2a2a",
              borderRadius: 8,
              padding: 10,
              marginBottom: 8,
            }}
          >
            Audit Pulse agent architecture
          </div>
          <div style={{ background: "#2a2a2a", borderRadius: 8, padding: 10 }}>
            Fix slow image loading issue
          </div>
        </div>
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            padding: 12,
          }}
        >
          <div
            style={{
              height: 56,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <div style={{ fontWeight: 600 }}>Kiboko — Chat</div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <div
                style={{
                  background: "#1b1b1b",
                  padding: 8,
                  borderRadius: 10,
                  color: "#9aa2a6",
                }}
              >
                Claude Opus 4.6 · High
              </div>
            </div>
          </div>

          <div
            ref={chatRef as any}
            style={{
              flex: 1,
              background: "#141414",
              borderRadius: 8,
              padding: 16,
              overflow: "auto",
              marginTop: 8,
            }}
          >
            {messages.map((m) => (
              <div
                key={m.id}
                style={{
                  padding: 12,
                  borderRadius: 8,
                  marginBottom: 12,
                  background: m.role === "assistant" ? "#334155" : "#0b1220",
                  color: "#e6eef3",
                }}
              >
                {m.text}
              </div>
            ))}
          </div>

          <div
            style={{
              height: 88,
              display: "flex",
              alignItems: "center",
              gap: 12,
              marginTop: 12,
            }}
          >
            <div
              contentEditable
              role="textbox"
              aria-label="Chat input"
              onInput={(e) => setInput((e.target as HTMLDivElement).innerText)}
              style={{
                flex: 1,
                background: "#0f1720",
                borderRadius: 12,
                padding: "12px 16px",
                color: "#e6eef3",
                border: "1px solid #222",
                minHeight: 48,
              }}
              dangerouslySetInnerHTML={{
                __html: input || "Describe what to build…",
              }}
            ></div>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 8,
                alignItems: "flex-end",
              }}
            >
              <button
                onClick={send}
                style={{
                  background: "#334155",
                  color: "#e6eef3",
                  borderRadius: 10,
                  padding: "10px 14px",
                  border: "none",
                  cursor: "pointer",
                }}
              >
                Send
              </button>
              <div style={{ fontSize: 12, color: "#9aa2a6" }}>
                {streaming ? "Streaming..." : "Mode: Agent"}
              </div>
              {streaming ? (
                <button
                  onClick={cancel}
                  style={{
                    background: "#2a2a2a",
                    color: "#e6eef3",
                    borderRadius: 6,
                    padding: "6px 8px",
                    border: "none",
                    cursor: "pointer",
                  }}
                >
                  Cancel
                </button>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    );
  };

  const root = createRoot(document.getElementById("root") as HTMLElement);
  root.render(React.createElement(App));
}
