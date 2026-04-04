import { expect } from "chai";
import { renderInlineUnifiedDiffHtml } from "../../src/ui/diffUtils";

describe("Inline diff utils", () => {
  it("renders inline add for inserted token in a paired change", () => {
    const before = "hello world";
    const after = "hello brave world";
    const r = renderInlineUnifiedDiffHtml(before, after);
    expect(r.afterHtml).to.include("inline-add");
    expect(r.afterHtml).to.include("+ brave");
    expect(r.beforeHtml).to.not.include("inline-add");
  });

  it("renders inline delete for removed token in a paired change", () => {
    const before = "foo bar baz";
    const after = "foo baz";
    const r = renderInlineUnifiedDiffHtml(before, after);
    expect(r.beforeHtml).to.include("inline-del");
    expect(r.beforeHtml).to.include("- bar");
    expect(r.afterHtml).to.not.include("inline-del");
  });
});
