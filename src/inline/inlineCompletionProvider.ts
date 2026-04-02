import * as vscode from "vscode";
import * as path from "path";
import type { StreamController } from "../providers/provider";

const DEFAULT_DEBOUNCE_MS = 200; // ms
const DEFAULT_PREFIX_CHARS = 800;
const DEFAULT_SUFFIX_CHARS = 400;
const DEFAULT_MAX_COMPLETION_CHARS = 2000;

function getDebounceMs() {
  return (
    vscode.workspace
      .getConfiguration("pulse")
      .get<number>("inlineDebounceMs", DEFAULT_DEBOUNCE_MS) ||
    DEFAULT_DEBOUNCE_MS
  );
}

function getMaxCompletionChars() {
  return (
    vscode.workspace
      .getConfiguration("pulse")
      .get<number>("inlineMaxCompletionChars", DEFAULT_MAX_COMPLETION_CHARS) ||
    DEFAULT_MAX_COMPLETION_CHARS
  );
}
function getPrefixChars() {
  return (
    vscode.workspace
      .getConfiguration("pulse")
      .get<number>("inlinePrefixChars", DEFAULT_PREFIX_CHARS) ||
    DEFAULT_PREFIX_CHARS
  );
}

function getSuffixChars() {
  return (
    vscode.workspace
      .getConfiguration("pulse")
      .get<number>("inlineSuffixChars", DEFAULT_SUFFIX_CHARS) ||
    DEFAULT_SUFFIX_CHARS
  );
}

type PendingEntry = {
  timer?: NodeJS.Timeout | number | null;
  controller?: StreamController | null;
  lastPrefix?: string;
  lastCompletion?: string;
};

// pendings keyed per document+language session to coalesce fast typing
const pendings = new Map<string, PendingEntry>();
// cache keyed by doc+language+prefix to avoid re-requesting identical prefix
const cache = new Map<string, string>();

export const _TESTING = {
  get DEBOUNCE_MS() {
    return getDebounceMs();
  },
  get MAX_COMPLETION_CHARS() {
    return getMaxCompletionChars();
  },
  get PREFIX_CHARS() {
    return getPrefixChars();
  },
  get SUFFIX_CHARS() {
    return getSuffixChars();
  },
};

export function _getCacheForTest() {
  return cache;
}

export function _getPendingsForTest() {
  return pendings;
}

export function createInlineProvider(): vscode.InlineCompletionItemProvider {
  const provider: vscode.InlineCompletionItemProvider = {
    provideInlineCompletionItems(document, position, _context, token) {
      const docUri = document.uri.toString();
      const offset = document.offsetAt(position);
      const fullText = document.getText();
      const prefixStart = Math.max(0, offset - getPrefixChars());
      const prefix = fullText.slice(prefixStart, offset);
      const suffix = fullText.slice(
        offset,
        Math.min(fullText.length, offset + getSuffixChars()),
      );
      const language = document.languageId;
      const filePath = document.uri.fsPath || document.uri.toString();

      // session key coalesces multiple quick keystrokes in same doc/language
      const sessionKey = `${docUri}:${language}`;
      const cacheKey = `${docUri}:${language}:${prefix}`;

      // empty prefix -> no inline suggestion
      if (!prefix || !prefix.trim()) {
        return null;
      }

      // Fast-cache: if previous completion exists for same prefix, return immediately
      const entry = pendings.get(sessionKey);
      const cached = cache.get(cacheKey);
      if (cached && entry && entry.lastPrefix === prefix) {
        const item = new vscode.InlineCompletionItem(cached);
        return new vscode.InlineCompletionList([item]);
      }

      return new Promise<vscode.InlineCompletionList | null>((resolve) => {
        // Coalesce/debounce across the document session
        const cur = pendings.get(sessionKey) || ({} as PendingEntry);

        if (cur.timer) {
          try {
            clearTimeout(cur.timer as any);
          } catch (e) {}
        }

        // cancel previous streaming controller (we'll start a new one)
        if (cur.controller) {
          try {
            cur.controller.cancel();
          } catch (e) {}
          cur.controller = undefined as any;
        }

        cur.lastPrefix = prefix;
        pendings.set(sessionKey, cur);

        let resolved = false;
        let generated = "";

        const doRequest = () => {
          if (token.isCancellationRequested) {
            resolved = true;
            resolve(null);
            return;
          }

          // Build a compact prompt for inline completion
          const prompt = `Inline completion request\nLanguage: ${language}\nFile: ${filePath}\nPrefix:\n${prefix}\nSuffix:\n${suffix}\n\nComplete the text that should be inserted at the cursor. Return only the completion text (no explanation).`;

          // require factory at call-time to allow tests to stub it
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          const providerFactory = require("../providers/providerFactory");
          const providerInst =
            (providerFactory && providerFactory.createProviderFromPulseConfig
              ? providerFactory.createProviderFromPulseConfig()
              : providerFactory.default && providerFactory.default()) ||
            (function () {
              throw new Error("No provider factory available");
            })();

          try {
            const controller = providerInst.streamCompletion(
              prompt,
              undefined,
              {
                onToken: (t: string) => {
                  if (token.isCancellationRequested) {
                    try {
                      controller.cancel();
                    } catch (e) {}
                    return;
                  }

                  generated += String(t);
                  // enforce max characters
                  const maxChars = getMaxCompletionChars();
                  if (generated.length > maxChars) {
                    generated = generated.slice(0, maxChars);
                    try {
                      controller.cancel();
                    } catch (e) {}
                  }

                  if (!resolved) {
                    resolved = true;
                    cache.set(cacheKey, generated);
                    pendings.set(sessionKey, {
                      ...cur,
                      controller,
                      lastPrefix: prefix,
                      lastCompletion: generated,
                    });
                    const item = new vscode.InlineCompletionItem(generated);
                    resolve(new vscode.InlineCompletionList([item]));
                  } else {
                    // update cache and request inline suggest refresh
                    cache.set(cacheKey, generated);
                    pendings.set(sessionKey, {
                      ...cur,
                      controller,
                      lastPrefix: prefix,
                      lastCompletion: generated,
                    });
                    try {
                      void vscode.commands.executeCommand(
                        "editor.action.inlineSuggest.trigger",
                      );
                    } catch (e) {}
                  }
                },
                onEnd: () => {
                  cache.set(
                    cacheKey,
                    (cache.get(cacheKey) || generated).slice(
                      0,
                      getMaxCompletionChars(),
                    ),
                  );
                  pendings.set(sessionKey, {
                    ...cur,
                    controller: undefined,
                    lastCompletion: generated,
                  });
                },
                onError: (_err: any) => {
                  if (!resolved) {
                    resolved = true;
                    resolve(null);
                  }
                  pendings.set(sessionKey, { ...cur, controller: undefined });
                },
              },
            );

            cur.controller = controller as any;
            pendings.set(sessionKey, cur);
          } catch (e) {
            if (!resolved) {
              resolved = true;
              resolve(null);
            }
            pendings.set(sessionKey, { ...cur, controller: undefined });
          }
        };

        cur.timer = setTimeout(doRequest, getDebounceMs()) as any;
        pendings.set(sessionKey, cur);

        token.onCancellationRequested(() => {
          try {
            const cur2 = pendings.get(sessionKey);
            if (cur2?.timer) clearTimeout(cur2.timer as any);
            if (cur2?.controller) cur2.controller.cancel();
          } catch (e) {}
          if (!resolved) {
            resolved = true;
            resolve(null);
          }
        });
      });
    },
  };

  return provider;
}

export function registerInlineCompletion(context: vscode.ExtensionContext) {
  const provider = createInlineProvider();
  const disposable = vscode.languages.registerInlineCompletionItemProvider(
    [{ scheme: "file" }, { scheme: "untitled" }],
    provider,
  );

  context.subscriptions.push(disposable);

  return disposable;
}

export default registerInlineCompletion;
