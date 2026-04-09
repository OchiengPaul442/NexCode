import * as vscode from "vscode";
import { KibokoSidebarViewProvider } from "./sidebarViewProvider";

export function activate(context: vscode.ExtensionContext): void {
  const provider = new KibokoSidebarViewProvider(context);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      KibokoSidebarViewProvider.viewType,
      provider,
    ),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("nexcodeKiboko.openSidebar", async () => {
      await vscode.commands.executeCommand(
        "workbench.view.extension.nexcodeKiboko",
      );
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("nexcodeKiboko.pickModel", async () => {
      const config = vscode.workspace.getConfiguration("nexcodeKiboko");
      const currentModel = config.get<string>(
        "defaultModel",
        "gpt-oss:120b-cloud",
      );

      const picked = await vscode.window.showInputBox({
        title: "NEXCODE-KIBOKO Model",
        prompt:
          "Enter model name (e.g. gpt-oss:120b-cloud, qwen2.5-coder:7b, deepseek-coder)",
        value: currentModel,
        ignoreFocusOut: true,
      });

      if (!picked || !picked.trim()) {
        return;
      }

      await config.update(
        "defaultModel",
        picked.trim(),
        vscode.ConfigurationTarget.Workspace,
      );
      provider.notifyConfigChanged();
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("nexcodeKiboko.clearConversation", () => {
      provider.clearConversation();
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "nexcodeKiboko.explainSelection",
      async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
          void vscode.window.showInformationMessage(
            "Open an editor first to send context to NexCode.",
          );
          return;
        }

        const selectedText = editor.document.getText(editor.selection).trim();
        const relativePath = vscode.workspace.asRelativePath(
          editor.document.uri,
          false,
        );

        const prompt = selectedText
          ? [
              `/explain Explain the selected code from ${relativePath}.`,
              "",
              "```",
              selectedText.slice(0, 3_000),
              "```",
            ].join("\n")
          : `/explain Explain the key behavior in ${relativePath} and suggest targeted improvements.`;

        await vscode.commands.executeCommand(
          "workbench.view.extension.nexcodeKiboko",
        );
        provider.prefillPrompt(prompt);
      },
    ),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("nexcodeKiboko.openInTab", async () => {
      const panel = vscode.window.createWebviewPanel(
        "nexcodeKibokoTab",
        "Nexcode Kiboko",
        vscode.ViewColumn.One,
        {
          enableScripts: true,
          localResourceRoots: [
            vscode.Uri.joinPath(context.extensionUri, "media"),
          ],
          retainContextWhenHidden: true,
        },
      );
      provider.populateTabPanel(panel, context);
    }),
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("nexcodeKiboko")) {
        provider.notifyConfigChanged();
      }
    }),
  );
}

export function deactivate(): void {
  // No-op teardown.
}
