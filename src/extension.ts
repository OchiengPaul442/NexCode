import * as vscode from "vscode";
import { ChatPanel } from "./panels/chatPanel";
import { DiffReviewPanel } from "./panels/diffReviewPanel";
import { AuditLogPanel } from "./panels/auditLogPanel";
import * as path from "path";
import registerInlineCompletion from "./inline/inlineCompletionProvider";
import { initConfirmation } from "./tools/confirmation";
import { initAudit } from "./tools/audit";

// Register chat participant for native VS Code chat integration
function registerChatParticipant(context: vscode.ExtensionContext) {
  const handler: vscode.ChatRequestHandler = async (
    request: vscode.ChatRequest,
    chatContext: vscode.ChatContext,
    stream: vscode.ChatResponseStream,
    token: vscode.CancellationToken,
  ) => {
    // Build context from active editor and workspace
    const active = vscode.window.activeTextEditor;
    let activeFile = "";
    let selectionText = "";
    if (active) {
      activeFile = active.document.uri.fsPath || "";
      selectionText = active.document.getText(active.selection) || "";
    }

    const workspaceName = vscode.workspace.name || "";
    const workspaceFolders = (vscode.workspace.workspaceFolders || [])
      .map((f) => path.basename(f.uri.fsPath))
      .join(", ");

    // Interpret simple slash commands
    let userPrompt = request.prompt || "";
    const trimmed = userPrompt.trim();
    if (trimmed.startsWith("/explain")) {
      const rest = trimmed.replace("/explain", "").trim();
      userPrompt = `Explain the following code or selection. Context:\nFile: ${activeFile}\nWorkspace: ${workspaceName} (${workspaceFolders})\nSelection:\n${selectionText || rest || "(no selection)"}\n---\nPlease explain what the code does and any potential issues.`;
    } else if (trimmed.startsWith("/fix")) {
      const rest = trimmed.replace("/fix", "").trim();
      userPrompt = `Fix the following code. Provide a corrected version and a short explanation.\nFile: ${activeFile}\nWorkspace: ${workspaceName} (${workspaceFolders})\nSelection:\n${selectionText || rest || "(no selection)"}\n---\nRespond with the fixed code and a brief note.`;
    } else if (trimmed.startsWith("/generate")) {
      const rest = trimmed.replace("/generate", "").trim();
      userPrompt = `Generate code for: ${rest || "(specify what to generate)"}\nContext: file=${activeFile}; workspace=${workspaceName}\n---\nProvide code only.`;
    } else {
      // include editor context by default
      if (selectionText) {
        userPrompt = `Context:\nFile: ${activeFile}\nSelection:\n${selectionText}\n---\nUser: ${userPrompt}`;
      } else if (activeFile) {
        userPrompt = `Context:\nFile: ${activeFile}\nWorkspace: ${workspaceName}\n---\nUser: ${userPrompt}`;
      }
    }

    // create provider using shared factory
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const {
      createProviderFromPulseConfig,
    } = require("./providers/providerFactory");
    const provider: any = createProviderFromPulseConfig();

    // stream tokens into VS Code chat stream
    let controller: any = null;
    const onCancel = () => {
      try {
        controller && controller.cancel();
      } catch (e) {
        // ignore
      }
    };

    token.onCancellationRequested(onCancel);

    await new Promise<void>((resolve, reject) => {
      try {
        controller = provider.streamCompletion(userPrompt, undefined, {
          onToken: (t: string) => {
            try {
              stream.markdown(String(t));
            } catch (e) {
              // ignore streaming errors
            }
          },
          onEnd: () => {
            resolve();
          },
          onError: (err: any) => {
            try {
              stream.markdown(
                `**Error:** ${String(err && err.message ? err.message : err)}`,
              );
            } catch (e) {}
            resolve();
          },
        });
      } catch (e) {
        reject(e);
      }
    });

    return;
  };

  const participant = vscode.chat.createChatParticipant(
    "pulse.pulseforge",
    handler,
  );
  participant.iconPath = vscode.Uri.joinPath(
    context.extensionUri,
    "media",
    "webview.js",
  );
  context.subscriptions.push(participant);
}

export function activate(context: vscode.ExtensionContext) {
  console.log("Kiboko extension activated");

  // initialize confirmation persistence (workspace-scoped)
  try {
    initConfirmation(context.workspaceState, context.globalState);
    // initialize audit logging
    try {
      initAudit(context.workspaceState);
    } catch (e) {}
  } catch (e) {
    // ignore
  }

  const disposable = vscode.commands.registerCommand(
    "kiboko.helloWorld",
    () => {
      vscode.window.showInformationMessage("Hello from Kiboko!");
    },
  );

  const openChat = vscode.commands.registerCommand("kiboko.openChat", () => {
    ChatPanel.createOrShow(context.extensionUri);
  });

  const openDiffReview = vscode.commands.registerCommand(
    "kiboko.openDiffReview",
    () => {
      DiffReviewPanel.createOrShow(context.extensionUri);
    },
  );

  const manageDeny = vscode.commands.registerCommand(
    "kiboko.manageDenylist",
    () => {
      try {
        void vscode.commands.executeCommand(
          "workbench.action.openSettings",
          "pulse.denylist",
        );
      } catch (e) {}
    },
  );

  const openAudit = vscode.commands.registerCommand(
    "kiboko.openAuditLog",
    () => {
      try {
        AuditLogPanel.createOrShow(context.extensionUri);
      } catch (e) {}
    },
  );

  registerChatParticipant(context);

  // Register inline completion provider (inline suggestions)
  try {
    const inlineDisposable = registerInlineCompletion(context);
    context.subscriptions.push(inlineDisposable);
  } catch (e) {
    // don't block activation on inline provider failures
    console.error("Failed to register inline completion provider:", e);
  }

  context.subscriptions.push(disposable, openChat);
  context.subscriptions.push(openDiffReview);
  context.subscriptions.push(manageDeny);
  context.subscriptions.push(openAudit);
}

export function deactivate() {}
