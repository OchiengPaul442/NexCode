import * as assert from "assert";
import * as http from "http";
import { AddressInfo } from "net";
import { OllamaAdapter } from "../../providers/ollamaAdapter";

function createServer(
  handler: (req: http.IncomingMessage, res: http.ServerResponse) => void,
) {
  const server = http.createServer(handler);
  return server;
}

describe("OllamaAdapter end-to-end streaming tests", function () {
  this.timeout(10000);

  it("normal streaming response (/api/chat)", async () => {
    const frames = [
      'data: {"choices":[{"delta":{"content":"Hello "}}]}\\n\\n',
      'data: {"choices":[{"delta":{"content":"world"}}]}\\n\\n',
    ];

    const server = createServer((req, res) => {
      if (
        req.method === "POST" &&
        (req.url === "/api/chat" || req.url === "/api/generate")
      ) {
        res.writeHead(200, {
          "Content-Type": "text/event-stream; charset=utf-8",
        });
        let i = 0;
        const iv = setInterval(() => {
          if (i < frames.length) res.write(frames[i++]);
          else {
            res.write("data: [DONE]\\n\\n");
            clearInterval(iv);
            setTimeout(() => res.end(), 5);
          }
        }, 10);
      } else {
        res.writeHead(404);
        res.end();
      }
    });

    await new Promise<void>((resolve) => server.listen(0, resolve));
    const addr = server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${addr.port}`;

    const tokens: string[] = [];
    let ended = false;
    const adapter = new OllamaAdapter(baseUrl);
    adapter.streamCompletion("hi", undefined, {
      onToken: (t) => tokens.push(t),
      onEnd: () => (ended = true),
      onError: (e) => {
        throw e;
      },
    });

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("timeout")), 2000);
      const check = setInterval(() => {
        if (ended) {
          clearTimeout(timeout);
          clearInterval(check);
          resolve();
        }
      }, 20);
    });

    assert.deepStrictEqual(
      tokens.filter((t) => t !== "[DONE]"),
      ["Hello ", "world"],
    );
    server.close();
  });

  it("incomplete JSON chunk boundaries", async () => {
    const server = createServer((req, res) => {
      if (req.method === "POST") {
        res.writeHead(200, {
          "Content-Type": "text/event-stream; charset=utf-8",
        });
        // send split chunk
        res.write('data: {"choices":[{"delta":{"content":"Par');
        setTimeout(() => {
          res.write('t1"}}]}\\n\\n');
          setTimeout(() => {
            res.write("data: [DONE]\\n\\n");
            res.end();
          }, 10);
        }, 10);
      } else {
        res.writeHead(404);
        res.end();
      }
    });

    await new Promise<void>((resolve) => server.listen(0, resolve));
    const addr = server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${addr.port}`;

    const tokens: string[] = [];
    let ended = false;
    const adapter = new OllamaAdapter(baseUrl);
    adapter.streamCompletion("p", undefined, {
      onToken: (t) => tokens.push(t),
      onEnd: () => (ended = true),
      onError: (e) => tokens.push("[ERR:" + String(e) + "]"),
    });

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("timeout")), 2000);
      const check = setInterval(() => {
        if (ended) {
          clearTimeout(timeout);
          clearInterval(check);
          resolve();
        }
      }, 20);
    });

    assert.deepStrictEqual(
      tokens.filter((t) => t !== "[DONE]"),
      ["Part1"],
    );
    server.close();
  });

  it("empty response yields onEnd but no tokens", async () => {
    const server = createServer((req, res) => {
      if (req.method === "POST") {
        res.writeHead(200, {
          "Content-Type": "text/event-stream; charset=utf-8",
        });
        // end immediately
        res.end();
      } else {
        res.writeHead(404);
        res.end();
      }
    });

    await new Promise<void>((resolve) => server.listen(0, resolve));
    const addr = server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${addr.port}`;

    const tokens: string[] = [];
    let ended = false;
    const adapter = new OllamaAdapter(baseUrl);
    adapter.streamCompletion("x", undefined, {
      onToken: (t) => tokens.push(t),
      onEnd: () => (ended = true),
      onError: (e) => {
        throw e;
      },
    });

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("timeout")), 2000);
      const check = setInterval(() => {
        if (ended) {
          clearTimeout(timeout);
          clearInterval(check);
          resolve();
        }
      }, 20);
    });

    assert.deepStrictEqual(tokens, []);
    server.close();
  });

  it("malformed payloads and error frames", async () => {
    const server = createServer((req, res) => {
      if (req.method === "POST") {
        res.writeHead(200, {
          "Content-Type": "text/event-stream; charset=utf-8",
        });
        res.write("data: {not-json}\\n\\n");
        res.write('data: {"error":"boom","detail":"bad"}\\n\\n');
        setTimeout(() => {
          res.write("data: [DONE]\\n\\n");
          res.end();
        }, 10);
      } else {
        res.writeHead(404);
        res.end();
      }
    });

    await new Promise<void>((resolve) => server.listen(0, resolve));
    const addr = server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${addr.port}`;

    const tokens: string[] = [];
    const errors: any[] = [];
    let ended = false;
    const adapter = new OllamaAdapter(baseUrl);
    adapter.streamCompletion("y", undefined, {
      onToken: (t) => tokens.push(t),
      onEnd: () => (ended = true),
      onError: (e) => errors.push(e),
    });

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("timeout")), 2000);
      const check = setInterval(() => {
        if (ended) {
          clearTimeout(timeout);
          clearInterval(check);
          resolve();
        }
      }, 20);
    });

    // malformed JSON should be emitted as raw token, and the explicit error frame should trigger onError
    assert.ok(tokens.some((t) => String(t).includes("not-json")));
    assert.ok(errors.length >= 1);
    server.close();
  });

  it("final response object with stats and tool_call presence", async () => {
    const server = createServer((req, res) => {
      if (req.method === "POST") {
        res.writeHead(200, {
          "Content-Type": "text/event-stream; charset=utf-8",
        });
        res.write('data: {"choices":[{"delta":{"content":"A"}}]}\\n\\n');
        res.write(
          'data: {"tool_call":{"name":"search","args":{"q":"abc"}}}\\n\\n',
        );
        res.write('data: {"stats":{"tokens":1,"time_ms":12}}\\n\\n');
        setTimeout(() => {
          res.write("data: [DONE]\\n\\n");
          res.end();
        }, 10);
      } else {
        res.writeHead(404);
        res.end();
      }
    });

    await new Promise<void>((resolve) => server.listen(0, resolve));
    const addr = server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${addr.port}`;

    const tokens: string[] = [];
    const errors: any[] = [];
    let ended = false;
    const adapter = new OllamaAdapter(baseUrl);
    adapter.streamCompletion("z", undefined, {
      onToken: (t) => tokens.push(t),
      onEnd: () => (ended = true),
      onError: (e) => errors.push(e),
    });

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("timeout")), 2000);
      const check = setInterval(() => {
        if (ended) {
          clearTimeout(timeout);
          clearInterval(check);
          resolve();
        }
      }, 20);
    });

    // Expect token 'A', a tool_call token, and a JSON string for stats
    assert.ok(tokens.some((t) => String(t).includes("A")));
    assert.ok(tokens.some((t) => String(t).startsWith("[tool_call]")));
    assert.ok(tokens.some((t) => String(t).includes('"stats"')));
    assert.strictEqual(errors.length, 0);
    server.close();
  });
});
