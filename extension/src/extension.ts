import * as vscode from "vscode";
import { KibokoSidebarViewProvider } from "./sidebarViewProvider";
import { SecretService } from "./secretService";
import { WorkspaceTrustService } from "./workspaceTrustService";

export async function activate(
  context: vscode.ExtensionContext,
): Promise<void> {
  const secretService = new SecretService(context.secrets);
  await secretService.migrateFromSettings();

  const workspaceTrustService = new WorkspaceTrustService(context);

  const provider = new KibokoSidebarViewProvider(
    context,
    secretService,
    workspaceTrustService,
  );

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
          "Enter model name. Ollama: gpt-oss:120b-cloud. OpenCode Go: deepseek-v4-flash, mimo-v2.5. HuggingFace: deepseek-ai/DeepSeek-R1:fastest",
        value: currentModel,
        ignoreFocusOut: true,
      });

      if (!picked?.trim()) {
        return;
      }

      await config.update(
        "defaultModel",
        picked.trim(),
        vscode.ConfigurationTarget.Workspace,
      );
      await provider.notifyConfigChanged();
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
    vscode.commands.registerCommand("nexcodeKiboko.showVersionInfo", async () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const pkg = require("../package.json");
      let buildInfo = "Build info not available (dev mode).";
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const fs = require("fs");
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const path = require("path");
        const infoPath = path.join(__dirname, "build-info.json");
        if (fs.existsSync(infoPath)) {
          const info = JSON.parse(fs.readFileSync(infoPath, "utf8"));
          buildInfo = `Version: ${info.version}\nBuilt: ${info.buildTime}\nNode: ${info.node}`;
        }
      } catch {
        // no-op
      }
      vscode.window.showInformationMessage(
        `NexCode Kiboko ${pkg.version}\n${buildInfo}`,
        { modal: true },
      );
    }),
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event: vscode.ConfigurationChangeEvent) => {
      if (event.affectsConfiguration("nexcodeKiboko")) {
        void provider.notifyConfigChanged();
      }
    }),
  );
}

export function deactivate(): void {
  // No-op teardown.
}
