import { expect } from "chai";
import { getChatWebviewHtml } from "../../src/ui/webviewTemplate";

describe("Preview Accessibility", () => {
  it("previewPanel is a dialog and focusable", () => {
    const html = getChatWebviewHtml();
    expect(html).to.include('id="previewPanel"');
    expect(html).to.match(/id="previewPanel"[^>]*role="dialog"/);
    expect(html).to.include('aria-modal="true"');
    expect(html).to.include('tabindex="0"');
  });

  it("includes keydown handler and focus call", () => {
    const html = getChatWebviewHtml();
    expect(html).to.include("document.addEventListener('keydown'");
    expect(html).to.include("previewPanel.focus()");
  });
});
