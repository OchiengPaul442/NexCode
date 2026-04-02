import * as assert from "assert";
import * as vscode from "vscode";

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("InlineCompletion Provider - unit tests", function () {
  this.timeout(20000);

  beforeEach(async () => {
    // ensure providerFactory is fresh for each test
    const pf = require("../../providers/providerFactory");
    // reset any previous stubs
    if (pf && pf.__restoreStub) pf.__restoreStub();
  });

  it("rapid typing triggers only one request", async () => {
    const inline = require("../../inline/inlineCompletionProvider");
    const provFactory = require("../../providers/providerFactory");

    let calls = 0;
    const mockProvider = {
      streamCompletion: (_prompt: string, _m?: any, callbacks?: any) => {
        calls++;
        // emit a token after 50ms
        const t = setTimeout(() => {
          callbacks.onToken && callbacks.onToken("A");
          callbacks.onEnd && callbacks.onEnd();
        }, 50);
        return { cancel: () => clearTimeout(t) };
      },
    } as any;

    // stub factory
    provFactory.createProviderFromPulseConfig = () => mockProvider;
    provFactory.__restoreStub = () => {
      delete provFactory.createProviderFromPulseConfig;
      delete provFactory.__restoreStub;
    };

    const provider = inline.createInlineProvider();

    const doc = await vscode.workspace.openTextDocument({
      content: "hello",
      language: "plaintext",
    });
    await vscode.window.showTextDocument(doc);

    const pos = new vscode.Position(0, 5);
    const cts1 = new vscode.CancellationTokenSource();
    const p1 = provider.provideInlineCompletionItems(
      doc,
      pos,
      {} as any,
      cts1.token as any,
    );
    // rapid second keystroke
    await delay(50);
    const cts2 = new vscode.CancellationTokenSource();
    const p2 = provider.provideInlineCompletionItems(
      doc,
      pos,
      {} as any,
      cts2.token as any,
    );
    await delay(50);
    const cts3 = new vscode.CancellationTokenSource();
    const p3 = provider.provideInlineCompletionItems(
      doc,
      pos,
      {} as any,
      cts3.token as any,
    );

    // wait enough for debounce + token (give some headroom)
    await delay(800);

    assert.strictEqual(calls, 1, `expected 1 provider call, got ${calls}`);

    provFactory.__restoreStub();
  });

  it("cancels previous request when new keystroke happens", async () => {
    const inline = require("../../inline/inlineCompletionProvider");
    const provFactory = require("../../providers/providerFactory");

    let calls = 0;
    let cancels = 0;
    const mockProvider = {
      streamCompletion: (_prompt: string, _m?: any, callbacks?: any) => {
        calls++;
        let cancelled = false;
        const t = setTimeout(() => {
          if (!cancelled) {
            callbacks.onToken && callbacks.onToken("X");
            callbacks.onEnd && callbacks.onEnd();
          }
        }, 300);
        return {
          cancel: () => {
            cancelled = true;
            cancels++;
            clearTimeout(t);
          },
        };
      },
    } as any;

    provFactory.createProviderFromPulseConfig = () => mockProvider;
    provFactory.__restoreStub = () => {
      delete provFactory.createProviderFromPulseConfig;
      delete provFactory.__restoreStub;
    };

    const provider = inline.createInlineProvider();
    const doc = await vscode.workspace.openTextDocument({
      content: "abc",
      language: "plaintext",
    });
    await vscode.window.showTextDocument(doc);
    const pos = new vscode.Position(0, 3);

    const p1 = provider.provideInlineCompletionItems(
      doc,
      pos,
      {} as any,
      new vscode.CancellationTokenSource().token as any,
    );
    // wait for first request to start (debounce + doRequest)
    await delay(250);
    // simulate another keystroke that triggers new request
    const p2 = provider.provideInlineCompletionItems(
      doc,
      pos,
      {} as any,
      new vscode.CancellationTokenSource().token as any,
    );

    await delay(400);

    assert.strictEqual(calls >= 1, true);
    assert.strictEqual(
      cancels >= 1,
      true,
      `expected cancels >=1 got ${cancels}`,
    );

    provFactory.__restoreStub();
  });

  it("streams partial tokens and final completion is cached", async () => {
    const inline = require("../../inline/inlineCompletionProvider");
    const provFactory = require("../../providers/providerFactory");

    const tokens = ["Hel", "lo", " world"];
    let calls = 0;
    const mockProvider = {
      streamCompletion: (_prompt: string, _m?: any, callbacks?: any) => {
        calls++;
        let i = 0;
        const iv = setInterval(() => {
          if (i < tokens.length) {
            callbacks.onToken && callbacks.onToken(tokens[i++]);
          } else {
            clearInterval(iv);
            callbacks.onEnd && callbacks.onEnd();
          }
        }, 40);
        return { cancel: () => clearInterval(iv) };
      },
    } as any;

    provFactory.createProviderFromPulseConfig = () => mockProvider;
    provFactory.__restoreStub = () => {
      delete provFactory.createProviderFromPulseConfig;
      delete provFactory.__restoreStub;
    };

    const provider = inline.createInlineProvider();
    const doc = await vscode.workspace.openTextDocument({
      content: "abc",
      language: "plaintext",
    });
    await vscode.window.showTextDocument(doc);
    const pos = new vscode.Position(0, 3);

    const list = await provider.provideInlineCompletionItems(
      doc,
      pos,
      {} as any,
      new vscode.CancellationTokenSource().token as any,
    );
    assert.ok(
      list && list.items && list.items.length > 0,
      "expected initial inline suggestion",
    );
    const first = String(
      list!.items[0].insertText || list!.items[0].text || "",
    );
    // first token should be prefix of final
    assert.ok(tokens.join("").startsWith(first));

    // wait for full stream to finish
    await delay(200);

    // now request again, should use cache and not trigger another provider call
    const beforeCalls = calls;
    const list2 = await provider.provideInlineCompletionItems(
      doc,
      pos,
      {} as any,
      new vscode.CancellationTokenSource().token as any,
    );
    const final = String(
      list2!.items[0].insertText || list2!.items[0].text || "",
    );
    assert.strictEqual(final, tokens.join(""));
    assert.strictEqual(calls, beforeCalls);

    provFactory.__restoreStub();
  });

  it("enforces max completion length and truncates long responses", async () => {
    const inline = require("../../inline/inlineCompletionProvider");
    const provFactory = require("../../providers/providerFactory");

    const long = new Array(3000).fill("x").join("");
    const mockProvider = {
      streamCompletion: (_prompt: string, _m?: any, callbacks?: any) => {
        // emit in one go
        setTimeout(() => {
          callbacks.onToken && callbacks.onToken(long);
          callbacks.onEnd && callbacks.onEnd();
        }, 50);
        return { cancel: () => {} };
      },
    } as any;

    provFactory.createProviderFromPulseConfig = () => mockProvider;
    provFactory.__restoreStub = () => {
      delete provFactory.createProviderFromPulseConfig;
      delete provFactory.__restoreStub;
    };

    const provider = inline.createInlineProvider();
    const doc = await vscode.workspace.openTextDocument({
      content: "x",
      language: "plaintext",
    });
    await vscode.window.showTextDocument(doc);
    const pos = new vscode.Position(0, 1);

    const list = await provider.provideInlineCompletionItems(
      doc,
      pos,
      {} as any,
      new vscode.CancellationTokenSource().token as any,
    );
    const text = String(list!.items[0].insertText || list!.items[0].text || "");
    assert.ok(
      text.length <= inline._TESTING.MAX_COMPLETION_CHARS,
      `expected <= ${inline._TESTING.MAX_COMPLETION_CHARS}, got ${text.length}`,
    );

    provFactory.__restoreStub();
  });

  it("handles empty prefix gracefully (returns null)", async () => {
    const inline = require("../../inline/inlineCompletionProvider");
    const provider = inline.createInlineProvider();
    const doc = await vscode.workspace.openTextDocument({
      content: "",
      language: "plaintext",
    });
    await vscode.window.showTextDocument(doc);
    const pos = new vscode.Position(0, 0);
    const res = provider.provideInlineCompletionItems(
      doc,
      pos,
      {} as any,
      new vscode.CancellationTokenSource().token as any,
    );
    // should be synchronous null or Promise resolving to null; handle both
    const resolved = await Promise.resolve(res);
    assert.strictEqual(resolved, null);
  });
});
