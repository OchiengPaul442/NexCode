export type StreamParserCallbacks = {
  onToken?: (token: string) => void;
  onEnd?: () => void;
  onError?: (err: any) => void;
  onToolCall?: (call: any) => void;
  onResponse?: (resp: any) => void;
};

export class StreamParser {
  private buffer = "";
  private closed = false;

  constructor(private callbacks: StreamParserCallbacks = {}) {}

  push(chunk: string) {
    if (this.closed) return;
    if (!chunk) return;
    this.buffer += chunk;
    this.processBuffer();
  }

  end() {
    if (this.closed) return;
    this.closed = true;
    // if leftover buffer contains something, try to flush as raw token
    const rem = this.buffer.trim();
    if (rem) {
      // attempt to parse remaining JSON objects
      this.processBuffer(true);
    }
    this.callbacks.onEnd && this.callbacks.onEnd();
  }

  private processBuffer(flush = false) {
    // 1) Handle SSE-style frames first (double-newline separated)
    while (true) {
      const dbl = this.buffer.search(/\r?\n\r?\n/);
      if (dbl === -1) break;
      const part = this.buffer.slice(0, dbl);
      this.buffer = this.buffer.slice(
        dbl + (this.buffer[dbl] === "\r" ? 4 : 2),
      );
      this.processSsePart(part);
    }

    // 2) Handle newline-delimited lines
    while (true) {
      const nl = this.buffer.indexOf("\n");
      if (nl === -1) break;
      const line = this.buffer.slice(0, nl).trim();
      this.buffer = this.buffer.slice(nl + 1);
      if (!line) continue;
      if (line === "[DONE]") {
        this.callbacks.onEnd && this.callbacks.onEnd();
        continue;
      }
      const dataLine = line.startsWith("data:")
        ? line.replace(/^data:\s*/, "")
        : line;
      this.processPossibleJsonOrRaw(dataLine);
    }

    // 3) Extract balanced JSON objects from buffer (handles concatenated JSON)
    while (true) {
      const { objects, rest } = this.extractBalancedJsons(this.buffer);
      if (objects.length === 0) break;
      for (const objStr of objects) {
        this.processPossibleJsonOrRaw(objStr);
      }
      this.buffer = rest;
    }

    // 4) If flush requested, emit any remaining non-whitespace as raw token
    if (flush) {
      const rem = this.buffer.trim();
      if (rem) {
        this.processPossibleJsonOrRaw(rem);
        this.buffer = "";
      }
    }
  }

  private processSsePart(part: string) {
    const lines = part.split(/\r?\n/);
    let eventType: string | undefined;
    for (const l of lines) {
      const line = l.trim();
      if (!line) continue;
      if (line.startsWith("event:")) {
        eventType = line.replace(/^event:\s*/, "");
        continue;
      }
      if (line.startsWith("data:")) {
        const payload = line.replace(/^data:\s*/, "");
        if (payload === "[DONE]") {
          this.callbacks.onEnd && this.callbacks.onEnd();
          continue;
        }
        this.processPossibleJsonOrRaw(payload, eventType);
      } else {
        this.processPossibleJsonOrRaw(line, eventType);
      }
    }
  }

  private processPossibleJsonOrRaw(text: string, eventType?: string) {
    if (!text) return;
    // try JSON parse
    try {
      const parsed = JSON.parse(text);
      this.handleParsed(parsed, eventType);
      return;
    } catch (e) {
      // not pure JSON - attempt to find embedded JSON objects
      const firstBrace = text.search(/[\{\[]/);
      if (firstBrace >= 0) {
        const { objects, rest } = this.extractBalancedJsons(text);
        if (objects.length > 0) {
          // emit any prefix as raw token
          const prefix = text.slice(0, text.indexOf(objects[0]));
          if (prefix && prefix.trim())
            this.callbacks.onToken && this.callbacks.onToken(prefix);
          for (const obj of objects) {
            try {
              const p = JSON.parse(obj);
              this.handleParsed(p, eventType);
            } catch (_) {
              this.callbacks.onToken && this.callbacks.onToken(obj);
            }
          }
          if (rest && rest.trim())
            this.callbacks.onToken && this.callbacks.onToken(rest);
          return;
        }
      }

      // fallback: emit raw text as token
      this.callbacks.onToken && this.callbacks.onToken(text);
    }
  }

  private handleParsed(parsed: any, eventType?: string) {
    if (parsed == null) return;

    // error frames
    if (
      parsed.error ||
      parsed.err ||
      parsed.type === "error" ||
      eventType === "error"
    ) {
      this.callbacks.onError && this.callbacks.onError(parsed);
      return;
    }

    // tool_call frames
    if (parsed.tool_call || parsed.toolCall) {
      const call = parsed.tool_call || parsed.toolCall;
      this.callbacks.onToolCall && this.callbacks.onToolCall(call);
      // also expose as a token so UI can render something
      this.callbacks.onToken &&
        this.callbacks.onToken(`[tool_call] ${JSON.stringify(call)}`);
      return;
    }

    // choices/delta style (chat)
    if (parsed.choices && Array.isArray(parsed.choices)) {
      for (const ch of parsed.choices) {
        const token =
          ch?.delta?.content ||
          ch?.text ||
          ch?.content ||
          ch?.message?.content ||
          ch?.generated_text;
        if (token)
          this.callbacks.onToken && this.callbacks.onToken(String(token));
      }
      return;
    }

    // generate endpoint shapes: results, result, output
    if (parsed.results && Array.isArray(parsed.results)) {
      for (const r of parsed.results) {
        // try several shapes
        if (typeof r === "string")
          this.callbacks.onToken && this.callbacks.onToken(r);
        else if (r.output) {
          if (typeof r.output === "string")
            this.callbacks.onToken && this.callbacks.onToken(r.output);
          else if (Array.isArray(r.output)) {
            for (const o of r.output)
              if (typeof o === "string")
                this.callbacks.onToken && this.callbacks.onToken(o);
          }
        } else if (r.generated_text)
          this.callbacks.onToken && this.callbacks.onToken(r.generated_text);
      }
      // offer the whole parsed object as a response
      this.callbacks.onResponse && this.callbacks.onResponse(parsed);
      return;
    }

    if (parsed.output) {
      if (typeof parsed.output === "string")
        this.callbacks.onToken && this.callbacks.onToken(parsed.output);
      else if (Array.isArray(parsed.output))
        for (const o of parsed.output)
          if (typeof o === "string")
            this.callbacks.onToken && this.callbacks.onToken(o);
      this.callbacks.onResponse && this.callbacks.onResponse(parsed);
      return;
    }

    if (parsed.generated_text) {
      this.callbacks.onToken && this.callbacks.onToken(parsed.generated_text);
      return;
    }

    if (parsed.content) {
      this.callbacks.onToken && this.callbacks.onToken(parsed.content);
      return;
    }

    if (parsed.token) {
      this.callbacks.onToken && this.callbacks.onToken(parsed.token);
      return;
    }

    // fallback: expose entire object as response
    this.callbacks.onResponse && this.callbacks.onResponse(parsed);
  }

  private extractBalancedJsons(s: string): { objects: string[]; rest: string } {
    const objects: string[] = [];
    let i = 0;
    let outIndex = 0;
    while (i < s.length) {
      // find next opening brace or bracket
      const nextObj = (() => {
        const o1 = s.indexOf("{", i);
        const o2 = s.indexOf("[", i);
        if (o1 === -1) return o2;
        if (o2 === -1) return o1;
        return Math.min(o1, o2);
      })();
      if (nextObj === -1) break;
      // emit prefix as raw if there's any
      if (nextObj > outIndex) {
        // leave prefix to caller (we will not emit here)
      }
      const openChar = s[nextObj];
      const closeChar = openChar === "{" ? "}" : "]";
      let depth = 0;
      let j = nextObj;
      for (; j < s.length; j++) {
        const ch = s[j];
        if (ch === openChar) depth++;
        else if (ch === closeChar) {
          depth--;
          if (depth === 0) break;
        }
      }
      if (j >= s.length) break; // incomplete
      const objStr = s.slice(nextObj, j + 1);
      objects.push(objStr);
      i = j + 1;
      outIndex = i;
    }

    return { objects, rest: s.slice(i) };
  }
}

export default StreamParser;
