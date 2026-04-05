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
        "qwen2.5-coder:7b",
      );

      const picked = await vscode.window.showInputBox({
        title: "NEXCODE-KIBOKO Model",
        prompt:
          "Enter model name (e.g. qwen2.5-coder:7b, deepseek-coder, gpt-4o-mini)",
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
}

export function deactivate(): void {
  // No-op teardown.
}
