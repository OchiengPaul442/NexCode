import { expect } from "chai";
import {
  computeReplacementPatch,
  applyReplacementPatch,
} from "../../src/safeEditUtils";

describe("SafeEditUtils", () => {
  it("returns null when texts equal", () => {
    const s = "no change";
    const p = computeReplacementPatch(s, s);
    expect(p).to.equal(null);
    expect(applyReplacementPatch(s, p)).to.equal(s);
  });

  it("inserts in the middle", () => {
    const oldText = "hello world";
    const newText = "hello brave world";
    const p = computeReplacementPatch(oldText, newText);
    expect(p).to.not.equal(null);
    const applied = applyReplacementPatch(oldText, p);
    expect(applied).to.equal(newText);
  });

  it("prepends text", () => {
    const oldText = "world";
    const newText = "hello world";
    const p = computeReplacementPatch(oldText, newText);
    expect(applyReplacementPatch(oldText, p)).to.equal(newText);
  });

  it("deletes a substring", () => {
    const oldText = "hello cruel world";
    const newText = "hello world";
    const p = computeReplacementPatch(oldText, newText);
    expect(applyReplacementPatch(oldText, p)).to.equal(newText);
  });

  it("replaces entire text", () => {
    const oldText = "abc";
    const newText = "xyz";
    const p = computeReplacementPatch(oldText, newText);
    expect(applyReplacementPatch(oldText, p)).to.equal(newText);
  });
});
