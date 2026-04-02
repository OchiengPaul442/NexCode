import * as assert from "assert";

const mod = require("../../panels/diffReviewPanel");
const validate: (
  filePath: string,
  h: any,
  patch: string,
) => { valid: boolean; error?: string } =
  mod.validateSuggestedPatch || mod.validateSuggestedPatch;

describe("validateSuggestedPatch", () => {
  it("accepts valid patch inside hunk", () => {
    const h = {
      id: "f:0",
      header: "",
      oldStart: 10,
      oldCount: 5,
      newStart: 10,
      newCount: 5,
      lines: [],
    };
    const patch = `diff --git a/src/foo.js b/src/foo.js\n--- a/src/foo.js\n+++ b/src/foo.js\n@@ -10,5 +10,5 @@\n-foo\n+bar\n`;
    const res = validate("src/foo.js", h, patch);
    assert.strictEqual(res.valid, true);
  });

  it("rejects patch touching outside lines", () => {
    const h = {
      id: "f:0",
      header: "",
      oldStart: 10,
      oldCount: 5,
      newStart: 10,
      newCount: 5,
      lines: [],
    };
    const patch = `diff --git a/src/foo.js b/src/foo.js\n--- a/src/foo.js\n+++ b/src/foo.js\n@@ -8,5 +8,5 @@\n-foo\n+bar\n`;
    const res = validate("src/foo.js", h, patch);
    assert.strictEqual(res.valid, false);
    assert.ok(res.error && res.error.indexOf("lies outside target hunk") >= 0);
  });

  it("rejects patch touching another file", () => {
    const h = {
      id: "f:0",
      header: "",
      oldStart: 1,
      oldCount: 3,
      newStart: 1,
      newCount: 3,
      lines: [],
    };
    const patch = `diff --git a/src/other.js b/src/other.js\n--- a/src/other.js\n+++ b/src/other.js\n@@ -1,3 +1,3 @@\n-a\n+b\n`;
    const res = validate("src/foo.js", h, patch);
    assert.strictEqual(res.valid, false);
    assert.ok(res.error && res.error.indexOf("does not match expected") >= 0);
  });

  it("rejects malformed diff (no hunks)", () => {
    const h = {
      id: "f:0",
      header: "",
      oldStart: 1,
      oldCount: 3,
      newStart: 1,
      newCount: 3,
      lines: [],
    };
    const patch = `this is not a diff`;
    const res = validate("src/foo.js", h, patch);
    assert.strictEqual(res.valid, false);
    assert.ok(res.error && res.error.indexOf("no hunk headers") >= 0);
  });

  it("handles empty patch safely", () => {
    const h = {
      id: "f:0",
      header: "",
      oldStart: 1,
      oldCount: 3,
      newStart: 1,
      newCount: 3,
      lines: [],
    };
    const res = validate("src/foo.js", h, "");
    assert.strictEqual(res.valid, true);
  });

  it("accepts patch exactly matching boundary edges", () => {
    const h = {
      id: "f:0",
      header: "",
      oldStart: 10,
      oldCount: 5,
      newStart: 10,
      newCount: 5,
      lines: [],
    };
    // oldStart 10, oldCount 5 -> covers 10..14 inclusive; this hunk exactly matches
    const patch = `diff --git a/src/foo.js b/src/foo.js\n--- a/src/foo.js\n+++ b/src/foo.js\n@@ -10,5 +10,5 @@\n-1\n+1\n`;
    const res = validate("src/foo.js", h, patch);
    assert.strictEqual(res.valid, true);
  });

  it("allows patches for untracked files even with odd ranges", () => {
    const h = {
      id: "f:0",
      header: "",
      oldStart: 0,
      oldCount: 0,
      newStart: 1,
      newCount: 10,
      lines: [],
    };
    const patch = `diff --git a/src/foo.js b/src/foo.js\n--- a/src/foo.js\n+++ b/src/foo.js\n@@ -100,5 +100,5 @@\n-foo\n+bar\n`;
    const res = validate("src/foo.js", h, patch);
    assert.strictEqual(res.valid, true);
  });
});
