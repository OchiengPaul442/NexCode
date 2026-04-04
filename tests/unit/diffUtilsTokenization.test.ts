import { expect } from "chai";
import { computeTokenDiff } from "../../src/ui/diffUtils";

describe("Tokenization improvements", () => {
  it("separates punctuation tokens from words", () => {
    const ops = computeTokenDiff("hello, world!", "hello, world!");
    const tokens = ops.map((op) => op.a ?? op.b);
    expect(tokens).to.include(",");
    expect(tokens).to.include("!");
  });

  it("keeps whitespace tokens", () => {
    const ops = computeTokenDiff("a b", "a b");
    const tokens = ops.map((op) => op.a ?? op.b);
    // should include a space token
    expect(tokens.some((t) => t === " " || t === "\t" || t === "\n")).to.be
      .true;
  });
});
