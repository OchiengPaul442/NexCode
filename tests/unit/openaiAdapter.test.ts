import { expect } from "chai";
import { OpenAIAdapter } from "../../src/providers/openaiAdapter";

describe("OpenAIAdapter", () => {
  it("yields a stub response", async () => {
    const adapter = new OpenAIAdapter("https://api.openai.com", "test");
    const gen = adapter.chat([{ role: "user", content: "hello" }]);
    const { value } = await gen.next();
    expect(value).to.be.a("string");
  });
});
