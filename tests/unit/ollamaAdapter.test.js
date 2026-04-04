"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const chai_1 = require("chai");
const ollamaAdapter_1 = require("../../src/providers/ollamaAdapter");
describe("OllamaAdapter", () => {
    it("yields a stub or streamed response", async () => {
        const adapter = new ollamaAdapter_1.OllamaAdapter("http://localhost:11434", "test");
        const gen = adapter.chat([{ role: "user", content: "hello" }]);
        const { value } = await gen.next();
        (0, chai_1.expect)(value).to.be.a("string");
    });
});
//# sourceMappingURL=ollamaAdapter.test.js.map