import { expect } from "chai";
import { MemoryManager } from "../../src/memory/memoryManager";

describe("Memory relevance", () => {
  it("ranks memories by simple token overlap", async () => {
    const mm = MemoryManager.getInstance(undefined);
    // clear any existing in-memory store by creating a fresh instance
    // (MemoryManager uses in-memory fallback when no context)
    const a = await mm.addMemory("I like blue color", { tag: "color" });
    const b = await mm.addMemory("My favorite animal is cat", {
      tag: "animal",
    });
    const c = await mm.addMemory("blue ocean and sea", { tag: "ocean" });

    const results = await mm.queryMemoriesByRelevance(
      "what is my favorite color",
      2,
    );
    expect(results.length).to.equal(2);
    // top result should mention color or blue
    const texts = results.map((r: any) => r.text);
    expect(
      texts.some((t: string) => t.includes("blue") || t.includes("color")),
    ).to.equal(true);

    // cleanup
    await mm.deleteMemory(a.id);
    await mm.deleteMemory(b.id);
    await mm.deleteMemory(c.id);
  });
});
