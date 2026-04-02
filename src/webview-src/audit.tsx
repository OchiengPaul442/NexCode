import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

declare global {
  interface Window {
    initAudit?: (vscodeApi: any) => void;
  }
}

type AuditEvent = {
  timestamp?: string;
  tool?: string;
  command?: string;
  decision?: string;
  outcome?: string;
  reason?: string;
  stdout?: string;
  stderr?: string;
  error?: string;
  matchedRule?: string;
  cwd?: string;
  exitCode?: number | null;
};

const AuditApp = ({ vscode }: { vscode: any }) => {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [status, setStatus] = useState<string>("Loading...");

  useEffect(() => {
    function handleMessage(ev: MessageEvent) {
      const msg = ev.data;
      if (!msg || !msg.type) return;
      if (msg.type === "events") {
        setEvents(msg.events || []);
        setStatus(`Ready (${(msg.events || []).length})`);
      } else if (msg.type === "cleared") {
        setEvents([]);
        setStatus("Cleared");
      } else if (msg.type === "exported") {
        setStatus(msg.uri ? `Exported to ${msg.uri}` : "Export canceled");
      } else if (msg.type === "error") {
        setStatus(`Error: ${msg.error || ""}`);
      }
    }

    window.addEventListener("message", handleMessage);
    // request initial set
    vscode.postMessage({ type: "refresh" });
    return () => window.removeEventListener("message", handleMessage);
  }, [vscode]);

  const refresh = () => {
    setStatus("Refreshing...");
    vscode.postMessage({ type: "refresh" });
  };

  const doClear = () => {
    if (!confirm("Clear all audit events?")) return;
    setStatus("Clearing...");
    vscode.postMessage({ type: "clear" });
  };

  const doExport = () => {
    setStatus("Exporting...");
    vscode.postMessage({ type: "export" });
  };

  return (
    <div style={{ padding: 12, fontFamily: "Segoe UI, Arial, sans-serif" }}>
      <div
        style={{
          display: "flex",
          gap: 8,
          alignItems: "center",
          marginBottom: 8,
        }}
      >
        <button onClick={refresh}>Refresh</button>
        <button onClick={doExport}>Export</button>
        <button onClick={doClear}>Clear</button>
        <div style={{ marginLeft: 8, color: "#666" }}>{status}</div>
      </div>

      <div>
        {events.length === 0 ? (
          <div>No events</div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th
                  style={{
                    textAlign: "left",
                    padding: 6,
                    borderBottom: "1px solid #eee",
                  }}
                >
                  Time
                </th>
                <th
                  style={{
                    textAlign: "left",
                    padding: 6,
                    borderBottom: "1px solid #eee",
                  }}
                >
                  Tool
                </th>
                <th
                  style={{
                    textAlign: "left",
                    padding: 6,
                    borderBottom: "1px solid #eee",
                  }}
                >
                  Command
                </th>
                <th
                  style={{
                    textAlign: "left",
                    padding: 6,
                    borderBottom: "1px solid #eee",
                  }}
                >
                  Decision
                </th>
                <th
                  style={{
                    textAlign: "left",
                    padding: 6,
                    borderBottom: "1px solid #eee",
                  }}
                >
                  Outcome
                </th>
                <th
                  style={{
                    textAlign: "left",
                    padding: 6,
                    borderBottom: "1px solid #eee",
                  }}
                >
                  Reason
                </th>
                <th
                  style={{
                    textAlign: "left",
                    padding: 6,
                    borderBottom: "1px solid #eee",
                  }}
                >
                  Details
                </th>
              </tr>
            </thead>
            <tbody>
              {events.map((ev, i) => (
                <tr key={i}>
                  <td style={{ padding: 6, borderBottom: "1px solid #eee" }}>
                    {ev.timestamp}
                  </td>
                  <td style={{ padding: 6, borderBottom: "1px solid #eee" }}>
                    {ev.tool}
                  </td>
                  <td style={{ padding: 6, borderBottom: "1px solid #eee" }}>
                    {ev.command}
                  </td>
                  <td style={{ padding: 6, borderBottom: "1px solid #eee" }}>
                    {ev.decision}
                  </td>
                  <td style={{ padding: 6, borderBottom: "1px solid #eee" }}>
                    {ev.outcome}
                  </td>
                  <td style={{ padding: 6, borderBottom: "1px solid #eee" }}>
                    {ev.reason}
                  </td>
                  <td style={{ padding: 6, borderBottom: "1px solid #eee" }}>
                    <pre style={{ margin: 0, fontSize: 11 }}>
                      {JSON.stringify(
                        {
                          stdout: ev.stdout,
                          stderr: ev.stderr,
                          error: ev.error,
                          matchedRule: ev.matchedRule,
                          cwd: ev.cwd,
                          exitCode: ev.exitCode,
                        },
                        null,
                        2,
                      )}
                    </pre>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};

window.initAudit = function initAudit(vscodeApi: any) {
  const rootId = "audit-root";
  let el = document.getElementById(rootId);
  if (!el) {
    el = document.createElement("div");
    el.id = rootId;
    document.body.appendChild(el);
  }
  createRoot(el).render(React.createElement(AuditApp, { vscode: vscodeApi }));
};

export default {};
