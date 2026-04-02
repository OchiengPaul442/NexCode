import { URL } from "url";
import * as http from "http";
import * as https from "https";
import { StreamCallbacks, StreamController, Provider } from "./provider";
import StreamParser from "./streamParser";

export class OllamaAdapter implements Provider {
  baseUrl: string;
  defaultModel?: string;

  constructor(baseUrl?: string, defaultModel?: string) {
    this.baseUrl = (baseUrl || "http://localhost:11434").replace(/\/$/, "");
    this.defaultModel = defaultModel;
  }

  streamCompletion(
    prompt: string,
    model?: string | undefined,
    callbacks: StreamCallbacks = {},
  ): StreamController {
    const usedModel = model || this.defaultModel;
    const url = new URL("/api/chat", this.baseUrl);
    if (usedModel) url.searchParams.set("model", usedModel);

    const body = JSON.stringify({
      messages: [{ role: "user", content: prompt }],
      stream: true,
    });

    const isHttps = url.protocol === "https:";
    const client = isHttps ? https : http;

    let req = client.request(
      {
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: url.pathname + url.search,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (res: any) => {
        if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 300)) {
          callbacks.onError &&
            callbacks.onError(
              new Error(`Ollama responded with status ${res.statusCode}`),
            );
          return;
        }

        callbacks.onConnected && callbacks.onConnected();
        callbacks.onStart && callbacks.onStart();

        res.setEncoding("utf8");

        const parser = new StreamParser({
          onToken: (t) => callbacks.onToken && callbacks.onToken(t),
          onEnd: () => callbacks.onEnd && callbacks.onEnd(),
          onError: (err) => callbacks.onError && callbacks.onError(err),
          onToolCall: (call) =>
            callbacks.onToken &&
            callbacks.onToken("[tool_call] " + JSON.stringify(call)),
          onResponse: (resp) =>
            callbacks.onToken && callbacks.onToken(JSON.stringify(resp)),
        });

        res.on("data", (chunk: string) => {
          try {
            parser.push(String(chunk));
          } catch (e) {
            callbacks.onError && callbacks.onError(e);
          }
        });

        res.on("end", () => {
          callbacks.onEnd && callbacks.onEnd();
        });

        res.on("error", (err: any) => {
          callbacks.onError && callbacks.onError(err);
        });
      },
    );

    req.on("error", (err: any) => {
      callbacks.onError && callbacks.onError(err);
    });

    req.write(body);
    req.end();

    return {
      cancel: () => {
        try {
          if (req) {
            // abort/ destroy depending on Node version
            // @ts-ignore
            if (typeof req.abort === "function") req.abort();
            // @ts-ignore
            if (typeof req.destroy === "function") req.destroy();
            // clear reference
            // @ts-ignore
            req = null;
          }
        } catch (e) {
          // ignore
        }
        callbacks.onEnd && callbacks.onEnd();
      },
    };
  }
}

export default OllamaAdapter;
