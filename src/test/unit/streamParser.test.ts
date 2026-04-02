import * as assert from "assert";
import StreamParser from "../../providers/streamParser";

describe("StreamParser unit tests", () => {
  it("parses SSE token chunks and emits tokens and end", (done) => {
    const tokens: string[] = [];
    let ended = false;
    const parser = new StreamParser({
      onToken: (t) => tokens.push(t),
      onEnd: () => {
        ended = true;
      },
    });

    parser.push('data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n');
    parser.push('data: {"choices":[{"delta":{"content":"lo"}}]}\n\n');
    parser.push("data: [DONE]\n\n");

    // allow microtask processing
    setTimeout(() => {
      try {
        assert.deepStrictEqual(tokens, ["Hel", "lo"]);
        assert.strictEqual(ended, true);
        done();
      } catch (e) {
        done(e);
      }
    }, 20);
  });

  it("handles newline-delimited JSON and concatenated JSON", () => {
    const tokens: string[] = [];
    const parser = new StreamParser({ onToken: (t) => tokens.push(t) });
    parser.push('{"token":"He"}\n{"token":"llo"}\n');
    assert.deepStrictEqual(tokens, ["He", "llo"]);
  });

  it("extracts concatenated JSON without newline", () => {
    const tokens: string[] = [];
    const parser = new StreamParser({ onToken: (t) => tokens.push(t) });
    parser.push('{"token":"He"}{"token":"llo"}');
    // flush to force parsing of remainder
    parser.end();
    assert.deepStrictEqual(tokens, ["He", "llo"]);
  });

  it("handles incomplete chunks (split JSON) correctly", (done) => {
    const tokens: string[] = [];
    const parser = new StreamParser({ onToken: (t) => tokens.push(t) });
    parser.push(`{"choices":[{"delta":{"content":"Par`);
    parser.push(`t1"}}]}\\n\\n`);

    setTimeout(() => {
      try {
        assert.deepStrictEqual(tokens, ["Part1"]);
        done();
      } catch (e) {
        done(e);
      }
    }, 10);
  });

  it("handles tool_call frames and error frames", () => {
    const tokens: string[] = [];
    const toolCalls: any[] = [];
    const errors: any[] = [];
    const parser = new StreamParser({
      onToken: (t) => tokens.push(t),
      onToolCall: (c) => toolCalls.push(c),
      onError: (e) => errors.push(e),
    });

    parser.push('data: {"tool_call":{"name":"search","args":{"q":"x"}}}\n\n');
    parser.push('data: {"error":"boom","detail":"oh no"}\n\n');

    assert.strictEqual(toolCalls.length, 1);
    assert.strictEqual(typeof toolCalls[0].name, "string");
    assert.strictEqual(errors.length, 1);
  });

  it("handles generate endpoint shapes and emits response", (done) => {
    const tokens: string[] = [];
    let resp: any = null;
    const parser = new StreamParser({
      onToken: (t) => tokens.push(t),
      onResponse: (r) => (resp = r),
    });

    parser.push(
      'data: {"results":[{"output":"Hello "},{"output":"world"}]}\n\n',
    );

    setTimeout(() => {
      try {
        assert.deepStrictEqual(tokens, ["Hello ", "world"]);
        assert.ok(resp && resp.results);
        done();
      } catch (e) {
        done(e);
      }
    }, 10);
  });

  it("ignores empty or whitespace-only frames", () => {
    const tokens: string[] = [];
    const parser = new StreamParser({ onToken: (t) => tokens.push(t) });
    parser.push("\n\n");
    parser.push("data: \n\n");
    parser.end();
    assert.deepStrictEqual(tokens, []);
  });
});
