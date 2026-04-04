import { expect } from "chai";
import { OllamaAdapter } from "../../src/providers/ollamaAdapter";

describe("OllamaAdapter", () => {
  it("yields a stub or streamed response", async () => {
    const adapter = new OllamaAdapter("http://localhost:11434", "test");
    const gen = adapter.chat([{ role: "user", content: "hello" }]);
    const { value } = await gen.next();
    expect(value).to.be.a("string");
  });

  it("parses SSE-style streamed JSON chunks", async () => {
    const oldFetch = (globalThis as any).fetch;
    try {
      const encoder = new (globalThis as any).TextEncoder();
      const chunk = encoder.encode(
        'data: {"content":"Hello"}\n\ndata: {"content":" world"}\n\n',
      );
      (globalThis as any).fetch = async function () {
        return {
          ok: true,
          body: {
            getReader() {
              let i = 0;
              return {
                async read() {
                  if (i++ === 0) return { done: false, value: chunk };
                  return { done: true };
                },
                cancel() {},
              };
            },
          },
        } as any;
      };

      const adapter = new OllamaAdapter("http://dummy", "test");
      const out: string[] = [];
      for await (const t of adapter.chat([{ role: "user", content: "x" }])) {
        out.push(t);
      }
      const joined = out.join("");
      expect(joined).to.include("Hello");
      expect(joined).to.include("world");
    } finally {
      (globalThis as any).fetch = oldFetch;
    }
  });

  it("honors AbortController cancellation", async () => {
    const oldFetch = (globalThis as any).fetch;
    try {
      const encoder = new (globalThis as any).TextEncoder();
      const chunk = encoder.encode('data: {"content":"partial"}\n\n');
      (globalThis as any).fetch = async function (_url: any, opts: any) {
        return {
          ok: true,
          body: {
            getReader() {
              let cancelled = false;
              return {
                async read() {
                  if (cancelled) return { done: true };
                  // simulate slow stream
                  await new Promise((r) => setTimeout(r, 20));
                  return { done: false, value: chunk };
                },
                cancel() {
                  cancelled = true;
                },
              };
            },
          },
        } as any;
      };

      const adapter = new OllamaAdapter("http://dummy", "test");
      const ac = new AbortController();
      const gen = adapter.chat([{ role: "user", content: "x" }], {
        signal: ac.signal,
      });

      const collected: string[] = [];
      const runner = (async () => {
        for await (const t of gen) collected.push(t);
      })();

      // abort quickly while the reader is waiting
      setTimeout(() => ac.abort(), 5);
      await runner;
      // If aborted, we may have partial output or none, but the generator must finish without throwing
      expect(Array.isArray(collected)).to.be.true;
    } finally {
      (globalThis as any).fetch = oldFetch;
    }
  });

  it("handles partial JSON across reads", async () => {
    const oldFetch = (globalThis as any).fetch;
    try {
      const encoder = new (globalThis as any).TextEncoder();
      const part1 = encoder.encode('data: {"content":"Hel');
      const part2 = encoder.encode('lo"}\n\n');
      (globalThis as any).fetch = async function () {
        return {
          ok: true,
          body: {
            getReader() {
              const parts = [part1, part2];
              let idx = 0;
              return {
                async read() {
                  if (idx < parts.length)
                    return { done: false, value: parts[idx++] };
                  return { done: true };
                },
                cancel() {},
              };
            },
          },
        } as any;
      };

      const adapter = new OllamaAdapter("http://dummy", "test");
      const out: string[] = [];
      for await (const t of adapter.chat([{ role: "user", content: "x" }])) {
        out.push(t);
      }
      const joined = out.join("");
      // Should reconstruct the JSON content value "Hello"
      expect(joined).to.include("Hello");
    } finally {
      (globalThis as any).fetch = oldFetch;
    }
  });

  it("handles mixed text and JSON tokens", async () => {
    const oldFetch = (globalThis as any).fetch;
    try {
      const encoder = new (globalThis as any).TextEncoder();
      const chunk = encoder.encode(
        "data: hello\n" + 'data: {"content":"X"}\n' + "data: bye\n\n",
      );
      (globalThis as any).fetch = async function () {
        return {
          ok: true,
          body: {
            getReader() {
              let i = 0;
              return {
                async read() {
                  if (i++ === 0) return { done: false, value: chunk };
                  return { done: true };
                },
                cancel() {},
              };
            },
          },
        } as any;
      };

      const adapter = new OllamaAdapter("http://dummy", "test");
      const out: string[] = [];
      for await (const t of adapter.chat([{ role: "user", content: "x" }])) {
        out.push(t);
      }
      // Expect to see the raw 'hello', the parsed JSON content 'X', and 'bye'
      const joined = out.join("");
      expect(joined).to.include("hello");
      expect(joined).to.include("X");
      expect(joined).to.include("bye");
    } finally {
      (globalThis as any).fetch = oldFetch;
    }
  });

  it("recovers from malformed JSON and continues", async () => {
    const oldFetch = (globalThis as any).fetch;
    try {
      const encoder = new (globalThis as any).TextEncoder();
      const chunk = encoder.encode(
        'data: {"content":"Start"}\n' +
          'data: {"content":"Bad", "missing": }\n' +
          'data: {"content":"End"}\n\n',
      );
      (globalThis as any).fetch = async function () {
        return {
          ok: true,
          body: {
            getReader() {
              let i = 0;
              return {
                async read() {
                  if (i++ === 0) return { done: false, value: chunk };
                  return { done: true };
                },
                cancel() {},
              };
            },
          },
        } as any;
      };

      const adapter = new OllamaAdapter("http://dummy", "test");
      const out: string[] = [];
      for await (const t of adapter.chat([{ role: "user", content: "x" }])) {
        out.push(t);
      }
      const joined = out.join("");
      // Should include Start and End and the malformed JSON text should appear raw
      expect(joined).to.include("Start");
      expect(joined).to.include("End");
      expect(joined).to.include("missing");
    } finally {
      (globalThis as any).fetch = oldFetch;
    }
  });
});
