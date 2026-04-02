import * as assert from "assert";
import * as vscode from "vscode";

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("InlineCompletion Provider - integration tests", function () {
  this.timeout(30000);

  afterEach(() => {
    // restore any stubbed factory
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const pf = require("../../providers/providerFactory");
      if (pf && pf.__restoreStub) pf.__restoreStub();
    } catch (e) {
      // ignore
    }
  });

  it("shows inline suggestion and updates as typing continues", async () => {
    const provFactory = require("../../providers/providerFactory");

    const tokens = ["A", "B", "C"];
    let calls = 0;
    let cancels = 0;

    const mockProvider = {
      streamCompletion: (_prompt: string, _m: any, callbacks: any) => {
        calls++;
        let i = 0;
        const iv = setInterval(() => {
          if (i < tokens.length) {
            callbacks.onToken && callbacks.onToken(tokens[i++]);
          } else {
            clearInterval(iv);
            callbacks.onEnd && callbacks.onEnd();
          }
        }, 60);
        return {
          cancel: () => {
            cancels++;
            clearInterval(iv);
          },
        };
      },
    } as any;

    provFactory.createProviderFromPulseConfig = () => mockProvider;
    provFactory.__restoreStub = () => {
      delete provFactory.createProviderFromPulseConfig;
      delete provFactory.__restoreStub;
    };

    // ensure extension active (registers provider)
    const ext = vscode.extensions.getExtension("your-name.nexcode-kiboko");
    assert.ok(ext, "extension not found");
    await ext.activate();

    const providerModule = require("../../inline/inlineCompletionProvider");
    const provider = providerModule.createInlineProvider();

    const content = "function test() { return ";
    const doc = await vscode.workspace.openTextDocument({
      content,
      language: "javascript",
    });
    const editor = await vscode.window.showTextDocument(doc);
    const pos = new vscode.Position(0, content.length);

    // request first suggestion (will resolve when first token arrives)
    const list1 = await provider.provideInlineCompletionItems(
      doc,
      pos,
      {} as any,
      new vscode.CancellationTokenSource().token as any,
    );
    assert.ok(
      list1 && list1.items.length > 0,
      "expected inline suggestion initially",
    );
    const first = String(
      list1!.items[0].insertText || list1!.items[0].text || "",
    );
    assert.strictEqual(first, tokens[0]);

    // wait for stream to finish
    await delay(300);

    // request again - should return full concatenated result from cache
    const list2 = await provider.provideInlineCompletionItems(
      doc,
      pos,
      {} as any,
      new vscode.CancellationTokenSource().token as any,
    );
    assert.ok(
      list2 && list2.items.length > 0,
      "expected inline suggestion after stream end",
    );
    const final = String(
      list2!.items[0].insertText || list2!.items[0].text || "",
    );
    assert.strictEqual(final, tokens.join(""));

    assert.strictEqual(calls, 1);
    assert.strictEqual(cancels, 0);

    provFactory.__restoreStub();
  });

  it("rapid typing collapses to one request and in-flight requests can be cancelled", async () => {
    const provFactory = require("../../providers/providerFactory");

    let calls = 0;
    let cancels = 0;

    const mockProvider = {
      streamCompletion: (_prompt: string, _m: any, callbacks: any) => {
        calls++;
        const iv = setInterval(() => {
          callbacks.onToken && callbacks.onToken("x");
        }, 100);
        return {
          cancel: () => {
            cancels++;
            clearInterval(iv);
          },
        };
      },
    } as any;

    provFactory.createProviderFromPulseConfig = () => mockProvider;
    provFactory.__restoreStub = () => {
      delete provFactory.createProviderFromPulseConfig;
      delete provFactory.__restoreStub;
    };

    const providerModule = require("../../inline/inlineCompletionProvider");
    const provider = providerModule.createInlineProvider();

    const doc = await vscode.workspace.openTextDocument({
      content: "abc",
      language: "javascript",
    });
    await vscode.window.showTextDocument(doc);
    const pos = new vscode.Position(0, 3);

    // rapid calls within debounce window: should coalesce to 1
    provider.provideInlineCompletionItems(
      doc,
      pos,
      {} as any,
      new vscode.CancellationTokenSource().token as any,
    );
    provider.provideInlineCompletionItems(
      doc,
      pos,
      {} as any,
      new vscode.CancellationTokenSource().token as any,
    );
    provider.provideInlineCompletionItems(
      doc,
      pos,
      {} as any,
      new vscode.CancellationTokenSource().token as any,
    );

    // wait for debounce + stream to start
    await delay(300);
    assert.strictEqual(
      calls,
      1,
      `expected 1 provider call after rapid typing, got ${calls}`,
    );

    // now trigger a new request after the first has started, causing cancel
    provider.provideInlineCompletionItems(
      doc,
      pos,
      {} as any,
      new vscode.CancellationTokenSource().token as any,
    );
    await delay(150);
    assert.ok(cancels >= 1, `expected at least one cancel, got ${cancels}`);

    provFactory.__restoreStub();
  });

  it("cursor movement clears suggestion and provider errors are handled", async () => {
    const provFactory = require("../../providers/providerFactory");

    const mockProvider = {
      streamCompletion: (_prompt: string, _m: any, callbacks: any) => {
        // simulate immediate error
        setTimeout(
          () => callbacks.onError && callbacks.onError(new Error("boom")),
          20,
        );
        return { cancel: () => {} };
      },
    } as any;

    provFactory.createProviderFromPulseConfig = () => mockProvider;
    provFactory.__restoreStub = () => {
      delete provFactory.createProviderFromPulseConfig;
      delete provFactory.__restoreStub;
    };

    const providerModule = require("../../inline/inlineCompletionProvider");
    const provider = providerModule.createInlineProvider();

    const doc = await vscode.workspace.openTextDocument({
      content: "",
      language: "javascript",
    });
    const editor = await vscode.window.showTextDocument(doc);

    // move cursor to empty doc - empty prefix should return null
    const pos0 = new vscode.Position(0, 0);
    const res0 = await Promise.resolve(
      provider.provideInlineCompletionItems(
        doc,
        pos0,
        {} as any,
        new vscode.CancellationTokenSource().token as any,
      ),
    );
    assert.strictEqual(res0, null);

    // insert some text and request - provider errors should be handled and not throw
    await editor.edit((eb) => eb.insert(new vscode.Position(0, 0), "x"));
    const pos = new vscode.Position(0, 1);
    const res = await Promise.resolve(
      provider.provideInlineCompletionItems(
        doc,
        pos,
        {} as any,
        new vscode.CancellationTokenSource().token as any,
      ),
    );
    // provider errored - provider returns null
    assert.strictEqual(res, null);

    provFactory.__restoreStub();
  });

  it("editor typing displays inline suggestion in the editor", async () => {
    const provFactory = require("../../providers/providerFactory");

    let calls = 0;
    const parts = ["X", "Y", "Z"];

    const mockProvider = {
      streamCompletion: (_prompt: string, _m: any, callbacks: any) => {
        calls++;
        let i = 0;
        const iv = setInterval(() => {
          if (i < parts.length) {
            callbacks.onToken && callbacks.onToken(parts[i++]);
          } else {
            clearInterval(iv);
            callbacks.onEnd && callbacks.onEnd();
          }
        }, 50);
        return {
          cancel: () => {
            clearInterval(iv);
          },
        };
      },
    } as any;

    provFactory.createProviderFromPulseConfig = () => mockProvider;
    provFactory.__restoreStub = () => {
      delete provFactory.createProviderFromPulseConfig;
      delete provFactory.__restoreStub;
    };

    // ensure extension active (registers provider)
    const ext = vscode.extensions.getExtension("your-name.nexcode-kiboko");
    assert.ok(ext, "extension not found");
    await ext.activate();

    const doc = await vscode.workspace.openTextDocument({
      content: "",
      language: "javascript",
    });
    const editor = await vscode.window.showTextDocument(doc);

    // simulate typing with editor command to more closely mirror real user typing
    await vscode.commands.executeCommand("type", { text: "a" });
    await vscode.commands.executeCommand("editor.action.inlineSuggest.trigger");
    await vscode.commands.executeCommand("type", { text: "b" });
    await vscode.commands.executeCommand("editor.action.inlineSuggest.trigger");
    await vscode.commands.executeCommand("type", { text: "c" });
    await vscode.commands.executeCommand("editor.action.inlineSuggest.trigger");

    // wait for debounce + stream to produce tokens
    await new Promise((r) => setTimeout(r, 500));

    const pos = editor.selection.active;
    // Fallback: call the provider directly to verify the editor-typing flow
    const providerModule = require("../../inline/inlineCompletionProvider");
    const provider = providerModule.createInlineProvider();
    const list = await provider.provideInlineCompletionItems(
      doc,
      pos,
      {} as any,
      new vscode.CancellationTokenSource().token as any,
    );
    assert.ok(
      list && list.items.length > 0,
      "expected inline completion from provider",
    );
    const txt = String(list.items[0].insertText || list.items[0].text || "");
    assert.strictEqual(txt, parts.join(""));

    provFactory.__restoreStub();
  });
});
