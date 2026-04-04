"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const chai_1 = require("chai");
const webviewTemplate_1 = require("../../src/ui/webviewTemplate");
describe("Webview message flow scaffold", () => {
    it("auto-requests provider on load and has set/get handlers", () => {
        const html = (0, webviewTemplate_1.getChatWebviewHtml)();
        (0, chai_1.expect)(html).to.include("getProvider");
        (0, chai_1.expect)(html).to.include("setProvider");
        (0, chai_1.expect)(html).to.include("providerSelect");
    });
});
//# sourceMappingURL=webviewMessageFlow.test.js.map