import { expect } from "chai";
import { getChatWebviewHtml } from "../../src/ui/webviewTemplate";

describe("Suggestion Shortcut", () => {
  it("injects a global suggestion shortcut handler into the webview HTML", () => {
    const html = getChatWebviewHtml();
    expect(html).to.include("e.shiftKey");
    // ensure the handler normalizes the key and compares to 's'
    expect(html).to.include("String(e.key).toLowerCase()");
    expect(html).to.include("key === 's'");
    // ensure the shortcut triggers suggestBtn.click()
    expect(html).to.include("suggestBtn.click");
  });
});
