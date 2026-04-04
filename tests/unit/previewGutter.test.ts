import { expect } from "chai";
import { getChatWebviewHtml } from "../../src/ui/webviewTemplate";

describe("Preview Gutter", () => {
  it("renders gutter elements and CSS markers", () => {
    const html = getChatWebviewHtml();
    expect(html).to.include('id="beforeGutter"');
    expect(html).to.include('id="afterGutter"');
    // ensure gutter CSS class is present in the template
    expect(html).to.include("gutter-line");
    // copy affordance and clipboard support
    expect(html).to.match(/navigator\.clipboard|execCommand|Copied/);
  });
});
