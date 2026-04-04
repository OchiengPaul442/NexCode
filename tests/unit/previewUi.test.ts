import { expect } from "chai";
import { getChatWebviewHtml } from "../../src/ui/webviewTemplate";

describe("ChatWebview Preview UI", () => {
  it("contains preview controls and preview panel elements", () => {
    const html = getChatWebviewHtml();
    expect(html).to.include('id="previewBtn"');
    expect(html).to.include('id="previewPanel"');
    expect(html).to.include('id="beforeBlock"');
    expect(html).to.include('id="afterBlock"');
    expect(html).to.include('id="beforeGutter"');
    expect(html).to.include('id="afterGutter"');
    expect(html).to.include('id="applyPreviewBtn"');
    expect(html).to.include('id="closePreviewBtn"');
  });
});
