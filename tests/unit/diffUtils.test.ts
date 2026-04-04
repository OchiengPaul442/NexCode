import { expect } from "chai";
import { computeLineDiff, renderUnifiedDiffHtml } from "../../src/ui/diffUtils";

describe("Diff utils", () => {
  it("computes line diffs for simple insert/delete", () => {
    const a = "line1\nline2\nline3";
    const b = "line1\nLINE2\nline3\nline4";
    const ops = computeLineDiff(a, b);
    const types = ops.map((op) => op.type);
    expect(types).to.include("insert");
    expect(types).to.include("delete");
    expect(types.filter((t) => t === "equal").length).to.be.greaterThan(0);
  });

  it("renders unified diff html containing +/- markers", () => {
    const a = "a\nb\nc";
    const b = "a\nx\nc";
    const out = renderUnifiedDiffHtml(a, b);
    expect(out.beforeHtml).to.include("- b");
    expect(out.afterHtml).to.include("+ x");
  });
});
