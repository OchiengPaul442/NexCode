import { expect } from "chai";
import { MemoryManager } from "../../src/memory/memoryManager";

describe("MemoryManager", () => {
  it("adds and lists memories in-memory when no context provided", async () => {
    const mm = MemoryManager.getInstance(undefined);
    const mem = await mm.addMemory("unit-test memory", { tag: "unit" });
    expect(mem).to.have.property("id");
    expect(mem.text).to.equal("unit-test memory");
    const list = await mm.listMemories();
    expect(list.some((m: any) => m.id === mem.id)).to.equal(true);
    const q = await mm.queryMemories("unit-test");
    expect(q.length).to.be.greaterThan(0);
    await mm.deleteMemory(mem.id);
    const after = await mm.listMemories();
    expect(after.some((m: any) => m.id === mem.id)).to.equal(false);
  });
});
