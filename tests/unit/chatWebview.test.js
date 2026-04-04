"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const chai_1 = require("chai");
const webviewTemplate_1 = require("../../src/ui/webviewTemplate");
describe("ChatWebview HTML", () => {
    it("contains provider select and send button", () => {
        const html = (0, webviewTemplate_1.getChatWebviewHtml)();
        (0, chai_1.expect)(html).to.include('id="providerSelect"');
        (0, chai_1.expect)(html).to.include('id="send"');
    });
});
//# sourceMappingURL=chatWebview.test.js.map