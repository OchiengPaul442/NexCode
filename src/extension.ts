import * as vscode from "vscode";
import { ChatWebview } from "./ui/chatWebview";

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand("kiboko.hello", async () => {
      vscode.window.showInformationMessage("Kiboko extension activated.");
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "kiboko.applyPatch",
      async (newText?: string) => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
          vscode.window.showErrorMessage("No active editor to apply patch to.");
          return;
        }

        // allow callers to provide the replacement directly (useful for tests)
        let replacement = typeof newText === "string" ? newText : undefined;
        if (typeof replacement !== "string") {
          replacement = await vscode.window.showInputBox({
            prompt: "Enter the replacement full-text for the current file",
          });
          if (typeof replacement !== "string") return;
        }

        try {
          // runtime require so tests don't need types at build time
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          const {
            computeReplacementPatch,
            patchOffsetsToRange,
          } = require("./safeEditUtils");
          const oldText = editor.document.getText();
          const patch = computeReplacementPatch(oldText, replacement as string);
          if (!patch) {
            vscode.window.showInformationMessage("No changes detected.");
            return;
          }
          const range = patchOffsetsToRange(oldText, patch);
          const start = new vscode.Position(
            range.start.line,
            range.start.character,
          );
          const end = new vscode.Position(range.end.line, range.end.character);
          const edit = new vscode.WorkspaceEdit();
          edit.replace(
            editor.document.uri,
            new vscode.Range(start, end),
            patch.newText,
          );
          const applied = await vscode.workspace.applyEdit(edit);
          if (applied) {
            try {
              if (!editor.document.isUntitled) await editor.document.save();
            } catch (e) {}
            vscode.window.showInformationMessage("Patch applied.");
          } else {
            vscode.window.showErrorMessage("Failed to apply patch.");
          }
        } catch (e) {
          vscode.window.showErrorMessage(String(e));
        }
      },
    ),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("kiboko.openChat", () => {
      ChatWebview.createOrShow((context as any).extensionUri, context);
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("kiboko.selectProvider", async () => {
      const pick = await vscode.window.showQuickPick(["ollama", "openai"], {
        placeHolder: "Select provider",
      });
      if (!pick) return;
      try {
        await vscode.workspace
          .getConfiguration("kiboko")
          .update("provider", pick, vscode.ConfigurationTarget.Global);
        vscode.window.showInformationMessage(`Kiboko provider set to ${pick}`);
      } catch (e) {
        vscode.window.showErrorMessage("Failed to set provider");
      }
    }),
  );

  console.log("Kiboko extension activated");
  try {
    registerChatParticipant(context);
  } catch (e) {}
  try {
    // expose a test helper for e2e to access the current webview panel
    (module as any).exports.getChatPanel = () =>
      (ChatWebview as any).currentPanel;
  } catch (e) {}
}

export function deactivate() {}

function registerChatParticipant(context: vscode.ExtensionContext) {
  const vscodeAny = vscode as any;
  if (
    !vscodeAny.chat ||
    typeof vscodeAny.chat.createChatParticipant !== "function"
  ) {
    console.warn(
      "VS Code Chat API not available; skipping chat participant registration.",
    );
    return;
  }

  const handler: any = async (
    request: any,
    chatContext: any,
    stream: any,
    token: any,
  ) => {
    const active = vscode.window.activeTextEditor;
    let activeFile = "";
    let selectionText = "";
    if (active) {
      activeFile = active.document.uri.fsPath || "";
      selectionText = active.document.getText(active.selection) || "";
    }

    const workspaceName = vscode.workspace.name || "";
    const workspaceFolders = (vscode.workspace.workspaceFolders || [])
      .map((f: any) => require("path").basename(f.uri.fsPath))
      .join(", ");

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

    let controller: any = null;
    const onCancel = () => {
      try {
        controller && controller.cancel();
      } catch (e) {
        // ignore
      }
    };

    token.onCancellationRequested(onCancel);

    await new Promise<void>((resolve) => {
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
        try {
          stream.markdown(`**Error:** ${String(e)}`);
        } catch (e) {}
        resolve();
      }
    });

    return;
  };

  const participant = vscodeAny.chat.createChatParticipant(
    "kiboko.kiboko",
    handler,
  );
  participant.iconPath = (vscode.Uri as any).joinPath(
    (context as any).extensionUri,
    "media",
    "icon-128.png",
  );
  context.subscriptions.push(participant as any);
}
