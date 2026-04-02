import * as vscode from "vscode";
import * as crypto from "crypto";
import { evaluatePolicy } from "./policy";

export type AskPayload = {
  prompt: string;
  explanation?: string;
  risk?: "low" | "medium" | "high";
};

// Session-scoped allow cache for 'always' responses.
export const sessionAlwaysAllow = new Set<string>();

let workspaceMemento: vscode.Memento | undefined;
let globalMemento: vscode.Memento | undefined;
const PERSIST_KEY = "confirmation.allowedRules";
let persistedRules = new Set<string>();

export function initConfirmation(
  state?: vscode.Memento,
  globalState?: vscode.Memento,
) {
  workspaceMemento = state;
  globalMemento = globalState;
  persistedRules = new Set<string>();
  try {
    const wsIdx =
      (workspaceMemento &&
        (workspaceMemento.get("pulse.allowRules.workspace.index") as
          | string[]
          | undefined)) ||
      [];
    for (const k of wsIdx) persistedRules.add(k);
    const glIdx =
      (globalMemento &&
        (globalMemento.get("pulse.allowRules.global.index") as
          | string[]
          | undefined)) ||
      [];
    for (const k of glIdx) persistedRules.add(k);
  } catch (e) {
    // ignore
  }
}

export function isAutoAllowed(commandKey: string, toolType?: string) {
  const hash = computeHash(commandKey, toolType);
  const key = `${toolType || "any"}::${hash}`;
  if (sessionAlwaysAllow.has(key)) return true;
  // check global first
  try {
    const glKey = `pulse.allowRules.global.${hash}`;
    if (globalMemento && (globalMemento.get(glKey) as any) !== undefined)
      return true;
    const wsKey = `pulse.allowRules.workspace.${hash}`;
    if (workspaceMemento && (workspaceMemento.get(wsKey) as any) !== undefined)
      return true;
  } catch (e) {}
  if (
    persistedRules.has(`pulse.allowRules.global.${hash}`) ||
    persistedRules.has(`pulse.allowRules.workspace.${hash}`)
  )
    return true;
  // nothing persisted; not auto-allowed
  return false;
}

export function normalizeCommand(cmd: string) {
  if (!cmd) return "";
  return cmd.trim().toLowerCase().replace(/\\/g, "/").replace(/\s+/g, " ");
}

export function computeHash(commandKey: string, toolType?: string) {
  const normalized = normalizeCommand(commandKey);
  const seed = `${toolType || "any"}::${normalized}`;
  return crypto.createHash("sha256").update(seed).digest("hex");
}

function isProbablyDestructive(cmdline: string) {
  if (!cmdline) return false;
  const s = cmdline.toLowerCase();
  const patterns = [
    "rm -rf ",
    "sudo ",
    "\\bdd \\b",
    "mkfs",
    "shutdown",
    "halt",
    "reboot",
    ": >",
    "dd if=",
    "rm -r /",
  ];
  return patterns.some((p) => s.indexOf(p) >= 0);
}

export async function persistAllow(
  commandKey: string,
  toolType?: string,
  scope: "workspace" | "global" = "workspace",
  ask?: AskPayload,
) {
  // Do not persist allows that would violate denylist policy
  try {
    const ctx: any = {
      toolId: toolType || ("any" as any),
      command: commandKey,
      args: [],
      patch: undefined,
    };
    const pr = await evaluatePolicy(ctx);
    if (pr && pr.decision === "deny") return false;
  } catch (e) {
    // if policy check fails, be conservative and refuse to persist
    return false;
  }
  const hash = computeHash(commandKey, toolType);
  const key = `${toolType || "any"}::${hash}`;
  // Safety: do not persist destructive or unknown patterns
  if (isProbablyDestructive(commandKey)) return false;
  if (ask && ask.risk === "high") return false;
  if (!ask || !ask.explanation) return false;
  const storageKey = `pulse.allowRules.${scope}.${hash}`;
  persistedRules.add(storageKey);
  const payload = {
    normalized: normalizeCommand(commandKey),
    toolType: toolType || "any",
    explanation: ask.explanation,
  };
  try {
    if (scope === "workspace" && workspaceMemento) {
      await workspaceMemento.update(storageKey, payload);
      // maintain index
      const idxKey = "pulse.allowRules.workspace.index";
      const idx = (workspaceMemento.get(idxKey) as string[] | undefined) || [];
      if (idx.indexOf(storageKey) < 0) {
        idx.push(storageKey);
        await workspaceMemento.update(idxKey, idx);
      }
      return true;
    }
    if (scope === "global" && globalMemento) {
      await globalMemento.update(storageKey, payload);
      const idxKey = "pulse.allowRules.global.index";
      const idx = (globalMemento.get(idxKey) as string[] | undefined) || [];
      if (idx.indexOf(storageKey) < 0) {
        idx.push(storageKey);
        await globalMemento.update(idxKey, idx);
      }
      return true;
    }
  } catch (e) {
    // ignore persistence errors
  }
  // no memento available; keep in-memory only
  return true;
}

// Exported so tests can stub user interaction.
export let confirmAction: (
  command: string,
  ask: AskPayload,
) => Promise<
  "approve" | "deny" | "always_workspace" | "always_global"
> = async (command, ask) => {
  const title = ask.prompt || "Confirm command";
  const detail = `${ask.explanation ? ask.explanation + "\n\n" : ""}Command: ${command}\nRisk: ${ask.risk || "unknown"}`;
  const approve = "Approve";
  const deny = "Deny";
  const alwaysWs = "Always allow (this workspace)";
  const alwaysGl = "Always allow (all projects)";
  // modal to force explicit choice; Enter will choose the focused button, Esc resolves undefined
  const res = await vscode.window.showInformationMessage(
    `${title}\n\n${detail}`,
    { modal: true },
    approve,
    deny,
    alwaysWs,
    alwaysGl,
  );
  if (res === approve) return "approve";
  if (res === alwaysWs) return "always_workspace";
  if (res === alwaysGl) return "always_global";
  return "deny";
};

export function clearPersistentAllows() {
  persistedRules.clear();
  if (workspaceMemento)
    workspaceMemento.update(PERSIST_KEY, [] as string[]).then(
      () => {},
      () => {},
    );
}

export default {
  confirmAction,
  sessionAlwaysAllow,
  initConfirmation,
  isAutoAllowed,
  persistAllow,
  clearPersistentAllows,
};
