import { describe, it, expect } from "vitest";
import { isExplicitContextError, isToolOrJsonParseError } from "../src/providers/ollamaProvider";

describe("isExplicitContextError", () => {
  it("identifies context window overflow", () => {
    expect(isExplicitContextError("context window overflow")).toBe(true);
  });

  it("identifies context length exceeded", () => {
    expect(isExplicitContextError("context length exceeded")).toBe(true);
  });

  it("identifies too many tokens", () => {
    expect(isExplicitContextError("too many tokens")).toBe(true);
  });

  it("identifies input too large", () => {
    expect(isExplicitContextError("input is too large for model")).toBe(true);
  });

  it("identifies exceeds context", () => {
    expect(isExplicitContextError("prompt exceeds context limit")).toBe(true);
  });

  it("identifies prompt too long", () => {
    expect(isExplicitContextError("prompt too long for this model")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(isExplicitContextError("Context Window Overflow")).toBe(true);
    expect(isExplicitContextError("TOO MANY TOKENS")).toBe(true);
  });

  it("does NOT classify tool parse errors as context errors", () => {
    expect(isExplicitContextError("can't find closing bracket")).toBe(false);
    expect(isExplicitContextError("Value looks like object but got string")).toBe(false);
  });

  it("does NOT classify generic errors as context errors", () => {
    expect(isExplicitContextError("connection refused")).toBe(false);
    expect(isExplicitContextError("model not found")).toBe(false);
  });
});

describe("isToolOrJsonParseError", () => {
  it("identifies can't find closing", () => {
    expect(isToolOrJsonParseError("can't find closing bracket")).toBe(true);
  });

  it("identifies Value looks like object", () => {
    expect(isToolOrJsonParseError("Value looks like object but got string")).toBe(true);
  });

  it("identifies bad character", () => {
    expect(isToolOrJsonParseError("bad character in JSON")).toBe(true);
  });

  it("identifies invalid character", () => {
    expect(isToolOrJsonParseError("invalid character at position 5")).toBe(true);
  });

  it("identifies malformed JSON", () => {
    expect(isToolOrJsonParseError("malformed JSON in response")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(isToolOrJsonParseError("CAN'T FIND CLOSING")).toBe(true);
    expect(isToolOrJsonParseError("VALUE LOOKS LIKE OBJECT")).toBe(true);
  });

  it("does NOT classify context overflow as tool parse error", () => {
    expect(isToolOrJsonParseError("context window overflow")).toBe(false);
    expect(isToolOrJsonParseError("context length exceeded")).toBe(false);
  });

  it("does NOT classify generic errors as tool parse errors", () => {
    expect(isToolOrJsonParseError("connection timeout")).toBe(false);
    expect(isToolOrJsonParseError("authorization failed")).toBe(false);
  });
});

describe("mutual exclusion", () => {
  it("'can't find closing' is tool parse, NOT context overflow", () => {
    const msg = "Ollama: can't find closing bracket in tool call";
    expect(isToolOrJsonParseError(msg)).toBe(true);
    expect(isExplicitContextError(msg)).toBe(false);
  });

  it("'context window overflow' IS context error, NOT tool parse", () => {
    const msg = "Ollama: context window overflow during generation";
    expect(isExplicitContextError(msg)).toBe(true);
    expect(isToolOrJsonParseError(msg)).toBe(false);
  });

  it("'Value looks like object' is tool parse, NOT context overflow", () => {
    const msg = "Ollama: Value looks like object but expected array";
    expect(isToolOrJsonParseError(msg)).toBe(true);
    expect(isExplicitContextError(msg)).toBe(false);
  });

  it("'too many tokens' is context error, NOT tool parse", () => {
    const msg = "Ollama: too many tokens in request";
    expect(isExplicitContextError(msg)).toBe(true);
    expect(isToolOrJsonParseError(msg)).toBe(false);
  });
});
