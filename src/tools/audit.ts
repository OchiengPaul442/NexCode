import * as vscode from "vscode";

let workspaceMemento: vscode.Memento | undefined;
let globalMemento: vscode.Memento | undefined;

const STORAGE_KEY = "pulse.auditLog";

export function initAudit(
  state?: vscode.Memento,
  globalState?: vscode.Memento,
) {
  workspaceMemento = state;
  globalMemento = globalState;
}

export async function getEvents(): Promise<any[]> {
  try {
    const arr =
      (workspaceMemento && (workspaceMemento.get(STORAGE_KEY) as any[])) || [];
    return arr.slice();
  } catch (e) {
    return [];
  }
}

export async function logEvent(event: any) {
  try {
    const entry = {
      timestamp: new Date().toISOString(),
      ...event,
    };
    const arr =
      (workspaceMemento && (workspaceMemento.get(STORAGE_KEY) as any[])) || [];
    arr.push(entry);
    if (workspaceMemento) await workspaceMemento.update(STORAGE_KEY, arr);
  } catch (e) {
    console.warn("Failed to log audit event", e);
  }
}

// convenience wrapper for blocked attempts used previously
export async function logBlockedAttempt(entry: any) {
  try {
    await logEvent({
      ...entry,
      outcome: entry.outcome || "blocked",
      decision: entry.decision || "deny",
    });
  } catch (e) {
    console.warn("Failed to log blocked attempt", e);
  }
}

export async function clearEvents() {
  try {
    if (workspaceMemento) await workspaceMemento.update(STORAGE_KEY, []);
  } catch (e) {}
}

export async function exportEvents(uri?: vscode.Uri) {
  try {
    const events = await getEvents();
    const json = JSON.stringify(events, null, 2);
    let target = uri;
    if (!target) {
      const uriPick = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file("kiboko-audit-log.json"),
        filters: { JSON: ["json"] },
      });
      if (!uriPick) return undefined;
      target = uriPick;
    }
    const enc = new TextEncoder();
    await vscode.workspace.fs.writeFile(target, enc.encode(json));
    return target;
  } catch (e) {
    console.warn("Failed to export audit events", e);
    return undefined;
  }
}

export default {
  initAudit,
  getEvents,
  logEvent,
  logBlockedAttempt,
  clearEvents,
  exportEvents,
};
