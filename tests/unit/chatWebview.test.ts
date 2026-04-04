import { expect } from "chai";
import { getChatWebviewHtml } from "../../src/ui/webviewTemplate";

describe("ChatWebview HTML", () => {
  it("contains provider select and send button", () => {
    const html = getChatWebviewHtml();
    expect(html).to.include('id="providerSelect"');
    expect(html).to.include('id="send"');
  });
});
