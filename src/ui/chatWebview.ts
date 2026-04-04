let vscode: any;
try {
  // runtime require so tests don't need @types/vscode
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  vscode = require("vscode");
} catch (e) {
  vscode = undefined;
}
import { ProviderManager } from "../providers/providerManager";
import { getChatWebviewHtml } from "./webviewTemplate";
import { computeReplacementPatch, patchOffsetsToRange } from "../safeEditUtils";
import { MemoryManager } from "../memory/memoryManager";

export class ChatWebview {
  public static currentPanel: ChatWebview | undefined;
  private panel: any;
  private extensionUri: any;
  private context: any;
  private currentAbortController?: AbortController;
  private preferredEditor: any;

  public static createOrShow(extensionUri: any, context: any) {
    const column =
      vscode && vscode.window.activeTextEditor
        ? vscode.window.activeTextEditor.viewColumn
        : undefined;
    if (ChatWebview.currentPanel) {
      ChatWebview.currentPanel.panel.reveal(column);
      return;
    }
    const panel = vscode
      ? vscode.window.createWebviewPanel(
          "kibokoChat",
          "Kiboko Chat",
          vscode.ViewColumn.One,
          { enableScripts: true },
        )
      : ({ webview: { html: "" }, onDidDispose: () => {} } as any);
    ChatWebview.currentPanel = new ChatWebview(panel, extensionUri, context);
    // expose the current panel reference for e2e tests
    try {
      (globalThis as any).__kiboko_currentPanel = ChatWebview.currentPanel;
    } catch (e) {}
  }

  private constructor(panel: any, extensionUri: any, context: any) {
    this.panel = panel;
    this.extensionUri = extensionUri;
    this.context = context;
    try {
      this.preferredEditor = vscode && (vscode.window as any).activeTextEditor;
    } catch (e) {}
    this.panel.webview.html = getChatWebviewHtml();
    this.panel.webview.onDidReceiveMessage(this.handleMessage.bind(this), null);
    this.panel.onDidDispose(() => {
      ChatWebview.currentPanel = undefined;
    }, null);
  }

  private async handleMessage(message: any) {
    if (!message) return;
    // Debug: surface any e2e_* messages to aid test troubleshooting
    try {
      if (typeof message.type === "string" && message.type.startsWith("e2e_")) {
        try {
          console.log("handleMessage e2e incoming", message);
        } catch (e) {}
      }
    } catch (e) {}
    if (message.type === "ping") {
      this.panel.webview.postMessage({
        type: "pong",
        text: "pong from extension host",
      });
      return;
    }

    if (message.type === "send") {
      // start a cancellable streaming session
      const providerMgr = ProviderManager.getInstance(this.context);
      const provider = providerMgr.getProvider();
      const userMsg = { role: "user", content: String(message.text ?? "") };

      // Memory recall: query relevant memories and include them as system context
      let messagesToSend: any[] = [userMsg];
      try {
        const mm = MemoryManager.getInstance(this.context);
        const matched = await mm.queryMemoriesByRelevance(
          String(message.text ?? ""),
          3,
        );
        const top = Array.isArray(matched) ? matched : [];
        if (top.length > 0) {
          const systemContent =
            "Relevant memories:\n" +
            top.map((m: any) => `- ${m.text}`).join("\n");
          const systemMsg = { role: "system", content: systemContent };
          messagesToSend = [systemMsg, userMsg];
          try {
            if (this.panel) (this.panel as any).__lastIncludedMemories = top;
          } catch (e) {}
          try {
            this.panel.webview.postMessage({
              type: "memoryContextIncluded",
              count: top.length,
            });
          } catch (e) {}
        }
      } catch (e) {}

      const ac = new AbortController();
      this.currentAbortController = ac;
      try {
        for await (const chunk of provider.chat(messagesToSend, {
          signal: ac.signal,
        })) {
          this.panel.webview.postMessage({ type: "output", text: chunk });
        }
        this.panel.webview.postMessage({ type: "done" });
      } catch (err: any) {
        // If aborted, send done; otherwise report error
        if (
          err &&
          (err.name === "AbortError" ||
            err.message?.toLowerCase?.().includes("aborted"))
        ) {
          this.panel.webview.postMessage({ type: "done" });
        } else {
          this.panel.webview.postMessage({
            type: "error",
            text: String(err?.message ?? err),
          });
        }
      } finally {
        this.currentAbortController = undefined;
      }
      return;
    }

    if (message.type === "cancel") {
      try {
        if (this.currentAbortController) this.currentAbortController.abort();
      } catch (e) {}
      this.currentAbortController = undefined;
      // notify webview that stream ended
      this.panel.webview.postMessage({ type: "done" });
      return;
    }
    if (message.type === "getProvider") {
      const provider = vscode
        ? ((vscode.workspace.getConfiguration("kiboko").get("provider") as
            | string
            | undefined) ?? "ollama")
        : "ollama";
      this.panel.webview.postMessage({ type: "provider", value: provider });
      try {
        const stored =
          this.context && this.context.globalState
            ? (this.context.globalState.get("kiboko.messageHistory") ?? [])
            : [];
        this.panel.webview.postMessage({ type: "history", messages: stored });
      } catch (e) {}
      return;
    }

    if (message.type === "setProvider") {
      const val = String(message.value || "ollama");
      try {
        if (vscode)
          await vscode.workspace
            .getConfiguration("kiboko")
            .update("provider", val, vscode.ConfigurationTarget.Global);
        // reload provider manager instance so new provider is used
        try {
          ProviderManager.reload(this.context);
        } catch (e) {}
        this.panel.webview.postMessage({
          type: "provider",
          value: val,
          text: "updated",
        });
      } catch (e) {
        this.panel.webview.postMessage({
          type: "error",
          text: "Failed to set provider",
        });
      }
      return;
    }

    if (message.type === "previewPatch") {
      const newText = String(message.newText || "");
      if (!vscode || !vscode.window.activeTextEditor) {
        this.panel.webview.postMessage({
          type: "error",
          text: "No active editor",
        });
        return;
      }
      const doc = vscode.window.activeTextEditor.document;
      const oldText = doc.getText();
      const patch = computeReplacementPatch(oldText, newText);
      if (!patch) {
        this.panel.webview.postMessage({
          type: "patchPreview",
          status: "no-change",
        });
        return;
      }
      try {
        const range = patchOffsetsToRange(oldText, patch);
        const oldTextSegment = oldText.substring(
          patch.start,
          patch.endExclusive,
        );
        this.panel.webview.postMessage({
          type: "patchPreview",
          patch,
          range,
          oldTextSegment,
          newText,
        });
      } catch (e) {
        this.panel.webview.postMessage({ type: "error", text: String(e) });
      }
      return;
    }

    if (message.type === "applyPatch") {
      const newText = String(message.newText || "");
      if (!vscode || !vscode.window.activeTextEditor) {
        this.panel.webview.postMessage({
          type: "error",
          text: "No active editor",
        });
        return;
      }
      const editor = vscode.window.activeTextEditor;
      const doc = editor.document;
      const oldText = doc.getText();
      const patch = computeReplacementPatch(oldText, newText);
      if (!patch) {
        this.panel.webview.postMessage({
          type: "patchApplied",
          status: "no-change",
        });
        return;
      }
      try {
        const r = patchOffsetsToRange(oldText, patch);
        const startPos = new (vscode as any).Position(
          r.start.line,
          r.start.character,
        );
        const endPos = new (vscode as any).Position(
          r.end.line,
          r.end.character,
        );
        const edit = new (vscode as any).WorkspaceEdit();
        edit.replace(
          doc.uri,
          new (vscode as any).Range(startPos, endPos),
          patch.newText,
        );
        const applied = await vscode.workspace.applyEdit(edit);
        if (applied) {
          try {
            if (!doc.isUntitled) await doc.save();
          } catch (e) {}
          this.panel.webview.postMessage({
            type: "patchApplied",
            status: "applied",
          });
        } else {
          this.panel.webview.postMessage({
            type: "patchApplied",
            status: "failed",
          });
        }
      } catch (e) {
        this.panel.webview.postMessage({ type: "error", text: String(e) });
      }
      return;
    }

    if (message.type === "persistMessages") {
      try {
        const msgs = message.messages || [];
        if (
          this.context &&
          this.context.globalState &&
          typeof this.context.globalState.update === "function"
        ) {
          await this.context.globalState.update("kiboko.messageHistory", msgs);
        }
      } catch (e) {}
      return;
    }

    if (message.type === "saveMemory") {
      try {
        const memoryText = String(message.memoryText || message.text || "");
        const mm = MemoryManager.getInstance(this.context);
        const saved = await mm.addMemory(memoryText, { source: "webview" });
        try {
          if (this.panel) (this.panel as any).__lastSavedMemory = saved;
        } catch (e) {}
        try {
          console.log("handleMessage: saveMemory saved", {
            id: saved && saved.id,
            text: saved && saved.text && String(saved.text).slice(0, 40),
          });
        } catch (e) {}
        this.panel.webview.postMessage({
          type: "memorySaved",
          status: "saved",
          id: saved.id,
        });
      } catch (e) {
        try {
          this.panel.webview.postMessage({
            type: "memorySaved",
            status: "failed",
          });
        } catch (er) {}
      }
      return;
    }

    if (message.type === "listMemories") {
      try {
        const mm = MemoryManager.getInstance(this.context);
        const list = await mm.listMemories();
        try {
          if (this.panel) (this.panel as any).__lastMemoriesList = list;
        } catch (e) {}
        this.panel.webview.postMessage({
          type: "memoriesList",
          memories: list,
        });
      } catch (e) {
        try {
          this.panel.webview.postMessage({
            type: "memoriesList",
            memories: [],
          });
        } catch (er) {}
      }
      return;
    }

    if (message.type === "deleteMemory") {
      try {
        const id = String(message.id || "");
        const mm = MemoryManager.getInstance(this.context);
        await mm.deleteMemory(id);
        // respond with updated list
        const list = await mm.listMemories();
        try {
          if (this.panel) (this.panel as any).__lastMemoriesList = list;
        } catch (e) {}
        this.panel.webview.postMessage({
          type: "memoriesList",
          memories: list,
        });
      } catch (e) {
        try {
          this.panel.webview.postMessage({
            type: "error",
            text: "Failed to delete memory",
          });
        } catch (er) {}
      }
      return;
    }

    if (message.type === "insertMemory") {
      try {
        const memoryText = String(message.memoryText || "");
        // reuse applySuggestion flow by delegating
        await this.handleMessage({
          type: "applySuggestion",
          snippet: memoryText,
        });
      } catch (e) {}
      return;
    }

    if (message.type === "applySuggestion") {
      const snippet = String(message.snippet || "");
      if (!vscode || !vscode.window.activeTextEditor) {
        this.panel.webview.postMessage({
          type: "error",
          text: "No active editor",
        });
        return;
      }
      try {
        console.log("handleMessage: applySuggestion invoked", { snippet });
        let editor = vscode.window.activeTextEditor;
        // prefer an editor that was active when the chat panel was created
        try {
          if (!editor && this.preferredEditor) editor = this.preferredEditor;
        } catch (e) {}
        // fallback: use a visible text editor if focus was lost to the webview
        try {
          if (
            !editor &&
            vscode &&
            (vscode.window as any).visibleTextEditors &&
            (vscode.window as any).visibleTextEditors.length
          ) {
            editor = (vscode.window as any).visibleTextEditors[0];
          }
        } catch (e) {}
        console.log(
          "handleMessage: applySuggestion editor found",
          !!editor,
          editor && editor.document && editor.document.uri
            ? editor.document.uri.toString()
            : undefined,
        );
        const applied = await editor.edit((editBuilder: any) => {
          const sel = editor.selection;
          try {
            if (sel && !sel.isEmpty) editBuilder.replace(sel, snippet);
            else editBuilder.insert(sel.start, snippet);
          } catch (e) {
            try {
              editBuilder.insert(new (vscode as any).Position(0, 0), snippet);
            } catch (er) {}
          }
        });
        console.log("handleMessage: applySuggestion applied =>", applied);
        try {
          if (!editor.document.isUntitled) await editor.document.save();
        } catch (e) {}
        this.panel.webview.postMessage({
          type: "suggestionApplied",
          status: applied ? "applied" : "failed",
        });
      } catch (e) {
        this.panel.webview.postMessage({ type: "error", text: String(e) });
      }
      return;
    }

    if (message.type === "gutterClick") {
      const lineNum = Number(message.line);
      if (!vscode || Number.isNaN(lineNum)) return;
      try {
        const editor = vscode.window.activeTextEditor;
        if (editor) {
          const doc = editor.document;
          const pos = new (vscode as any).Position(Math.max(0, lineNum - 1), 0);
          try {
            await vscode.window.showTextDocument(doc.uri);
          } catch (e) {}
          const active = vscode.window.activeTextEditor;
          if (active) {
            try {
              const sel = new (vscode as any).Selection(pos, pos);
              active.selection = sel;
              active.revealRange(
                new (vscode as any).Range(pos, pos),
                (vscode as any).TextEditorRevealType.InCenter,
              );
            } catch (e) {}
          }
        }
      } catch (e) {}
      return;
    }
    if (message.type === "e2e_scroll_report") {
      try {
        // expose last report for e2e tests on the webview panel object
        try {
          // debug log to help e2e troubleshooting
          try {
            console.log("Received e2e_scroll_report from webview", message);
          } catch (e) {}
          if (this.panel) (this.panel as any).__lastE2EScrollReport = message;
        } catch (e) {}
      } catch (e) {}
      return;
    }
  }

  // helper used by e2e tests to simulate messages from the webview
  public async receiveMessageForTest(message: any) {
    return await this.handleMessage(message);
  }
}
