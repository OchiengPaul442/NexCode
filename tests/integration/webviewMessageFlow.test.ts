import { expect } from "chai";
import { getChatWebviewHtml } from "../../src/ui/webviewTemplate";

describe("Webview message flow scaffold", () => {
  it("auto-requests provider on load and has set/get handlers", () => {
    const html = getChatWebviewHtml();
    expect(html).to.include("getProvider");
    expect(html).to.include("setProvider");
    expect(html).to.include("providerSelect");
  });
});
