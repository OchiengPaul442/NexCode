export class OllamaAdapter {
  url: string;
  model: string;
  constructor(url = "http://localhost:11434", model = "default") {
    this.url = url;
    this.model = model;
  }
  async *chat(
    messages: Array<{ role: string; content: string }>,
    options?: any,
  ): AsyncGenerator<string> {
    try {
      const fetchFn = (globalThis as any).fetch;
      if (typeof fetchFn !== "function") throw new Error("fetch not available");
      const res = await fetchFn(`${this.url}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: this.model, messages }),
        signal: options?.signal,
      });

      if (!res.ok) {
        const text = await res.text();
        yield `Ollama error: ${res.status} ${res.statusText} - ${text}`;
        return;
      }

      const body = (res as any).body;
      // Non-streaming responses (node-fetch polyfills or non-streaming server)
      if (!body || typeof body.getReader !== "function") {
        try {
          const json = await res.json();
          if (json && (json.output || json.result)) {
            yield String(json.output ?? json.result);
          } else {
            yield JSON.stringify(json);
          }
        } catch (e) {
          const txt = await res.text();
          if (txt) yield txt;
        }
        return;
      }

      const reader = body.getReader();
      const decoder = new (globalThis as any).TextDecoder("utf-8");
      let buffer = "";
      let partialJSON = "";
      let cancelled = false;

      const signal = options?.signal;
      if (signal) {
        signal.addEventListener(
          "abort",
          () => {
            cancelled = true;
            try {
              reader.cancel();
            } catch (e) {}
          },
          { once: true },
        );
      }

      function likelyIncompleteJSON(s: string) {
        const openCurly = (s.match(/\{/g) || []).length;
        const closeCurly = (s.match(/\}/g) || []).length;
        const openSquare = (s.match(/\[/g) || []).length;
        const closeSquare = (s.match(/\]/g) || []).length;
        return openCurly > closeCurly || openSquare > closeSquare;
      }

      function handleParsed(parsed: any) {
        if (parsed && typeof parsed === "object") {
          if (parsed.content) {
            return String(parsed.content);
          } else if (parsed.output) {
            return String(parsed.output);
          } else if (Array.isArray(parsed.choices) && parsed.choices.length) {
            const c = parsed.choices[0];
            if (c.delta && c.delta.content) return String(c.delta.content);
            if (c.text) return String(c.text);
            return JSON.stringify(parsed);
          }
          return JSON.stringify(parsed);
        }
        return String(parsed);
      }

      while (!cancelled) {
        const { value, done } = await reader.read();
        if (done) break;
        if (!value) continue;
        buffer += decoder.decode(value, { stream: true });

        // Process complete SSE blocks separated by double newlines
        let idx: number;
        while ((idx = buffer.indexOf("\n\n")) !== -1) {
          const block = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);

          const lines = block.split(/\r?\n/);
          const dataParts: string[] = [];
          for (const line of lines) {
            if (!line) continue;
            if (line.startsWith("data:"))
              dataParts.push(line.replace(/^data:\s*/, ""));
            else if (line.startsWith("event:")) continue;
            else dataParts.push(line);
          }

          for (const part of dataParts) {
            const trimmed = String(part).trim();
            if (!trimmed || trimmed === "[DONE]") continue;

            // If we have an accumulating partial JSON, try to complete it
            if (partialJSON) {
              partialJSON += trimmed;
              try {
                const parsed = JSON.parse(partialJSON);
                partialJSON = "";
                yield handleParsed(parsed);
                continue;
              } catch (e) {
                if (likelyIncompleteJSON(partialJSON)) {
                  // wait for more data
                  continue;
                }
                // fallback: emit as raw and clear
                const toYield = partialJSON;
                partialJSON = "";
                yield toYield;
                continue;
              }
            }

            // Try parsing this part as JSON directly
            try {
              const parsed = JSON.parse(trimmed);
              yield handleParsed(parsed);
              continue;
            } catch (e) {
              // If it looks like an incomplete JSON object/array, start accumulating
              if (
                likelyIncompleteJSON(trimmed) ||
                /^{/.test(trimmed) ||
                /^\[/.test(trimmed)
              ) {
                partialJSON = trimmed;
                continue;
              }

              // try to extract a JSON substring if present
              const m = trimmed.match(/({[\s\S]*}|\[[\s\S]*\])/);
              if (m) {
                try {
                  const parsed = JSON.parse(m[0]);
                  yield handleParsed(parsed);
                  continue;
                } catch (e) {
                  // fallthrough to yield raw
                }
              }

              // otherwise treat as plain text
              yield trimmed;
            }
          }
        }
      }

      // flush any remaining data
      const remaining = buffer.trim();
      if (remaining) {
        // process remaining like a final block
        const lines = remaining.split(/\r?\n/);
        const dataParts: string[] = [];
        for (const line of lines) {
          if (!line) continue;
          if (line.startsWith("data:"))
            dataParts.push(line.replace(/^data:\s*/, ""));
          else if (line.startsWith("event:")) continue;
          else dataParts.push(line);
        }
        for (const part of dataParts) {
          const trimmed = String(part).trim();
          if (!trimmed || trimmed === "[DONE]") continue;
          if (partialJSON) partialJSON += trimmed;
          else partialJSON = trimmed;
          try {
            const parsed = JSON.parse(partialJSON);
            yield handleParsed(parsed);
            partialJSON = "";
          } catch {
            // if still incomplete, yield what we have as raw text
            yield partialJSON;
            partialJSON = "";
          }
        }
      }
    } catch (err) {
      // keep existing fallback behavior for environments without network/fetch
      yield `Ollama stub response: received ${messages.length} messages (fallback).`;
    }
  }

  supportsToolCalling = false;
  supportsImageInput = false;
}
