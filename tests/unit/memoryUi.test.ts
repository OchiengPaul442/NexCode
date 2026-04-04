import { expect } from "chai";
import { getChatWebviewHtml } from "../../src/ui/webviewTemplate";

describe("Memories UI", () => {
  it("injects a Memories button and list handler into the webview HTML", () => {
    const html = getChatWebviewHtml();
    expect(html).to.include('id="memoriesBtn"');
    expect(html).to.include("listMemories");
    expect(html).to.include("memoriesList");
  });
});
