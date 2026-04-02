import * as vscode from "vscode";

export type AskPayload = {
  prompt: string;
  explanation?: string;
  risk?: "low" | "medium" | "high";
};

// Session-scoped allow cache for 'always' responses.
export const sessionAlwaysAllow = new Set<string>();

// Exported so tests can stub user interaction.
export let confirmAction: (
  command: string,
  ask: AskPayload,
) => Promise<"approve" | "deny" | "always"> = async (command, ask) => {
  const title = ask.prompt || "Confirm command";
  const detail = `${ask.explanation ? ask.explanation + "\n\n" : ""}Command: ${command}\nRisk: ${ask.risk || "unknown"}`;
  const approve = "Approve";
  const deny = "Deny";
  const always = "Always allow";
  // modal to force explicit choice; Enter will choose the focused button, Esc resolves undefined
  const res = await vscode.window.showInformationMessage(
    `${title}\n\n${detail}`,
    { modal: true },
    approve,
    deny,
    always,
  );
  if (res === approve) return "approve";
  if (res === always) return "always";
  return "deny";
};

export default { confirmAction, sessionAlwaysAllow };
