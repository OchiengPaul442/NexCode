"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const chai_1 = require("chai");
const openaiAdapter_1 = require("../../src/providers/openaiAdapter");
describe("OpenAIAdapter", () => {
    it("yields a stub response", async () => {
        const adapter = new openaiAdapter_1.OpenAIAdapter("https://api.openai.com", "test");
        const gen = adapter.chat([{ role: "user", content: "hello" }]);
        const { value } = await gen.next();
        (0, chai_1.expect)(value).to.be.a("string");
    });
});
//# sourceMappingURL=openaiAdapter.test.js.map