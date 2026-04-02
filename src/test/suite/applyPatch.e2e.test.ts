import * as assert from "assert";

const panel = require("../../panels/diffReviewPanel");
const hooks = require("../../tools/hooks");
const { registerPreToolHook, registerPostToolHook, clearAllHooks } = hooks;

describe("applyPatch _applyPatch with Pre/Post hooks", () => {
  const origSpawn = panel.spawnProc;
  afterEach(() => {
    clearAllHooks();
    panel.spawnProc = origSpawn;
    const confirmation = require("../../tools/confirmation");
    if (confirmation && confirmation.clearPersistentAllows)
      confirmation.clearPersistentAllows();
  });

  it("pre-hook denies and blocks git apply", async () => {
    let preCalled = false;
    registerPreToolHook("deny-test", (ctx: any) => {
      preCalled = true;
      return { allow: false, reason: "forbidden-by-hook" };
    });

    let spawnCalled = false;
    panel.spawnProc = function () {
      spawnCalled = true;
      throw new Error("spawn should not be invoked when pre-hook denies");
    } as any;

    const res = await panel.applyPatchForTest(
      "dummy-patch",
      "/tmp",
      false,
      false,
    );
    assert.strictEqual(preCalled, true, "pre-hook should have been called");
    assert.strictEqual(spawnCalled, false, "spawn should not be called");
    assert.strictEqual(res.success, false);
    assert.ok(res.error && res.error.indexOf("forbidden-by-hook") >= 0);
  });

  it("allowed case invokes spawn and post-hook sees result", async () => {
    let spawned = false;
    let lastChild: any = null;
    panel.spawnProc = function (cmd: string, args: string[], opts: any) {
      spawned = true;
      const child: any = {
        stdin: {
          write: (d: any) => {
            child._written = (child._written || "") + d;
          },
          end: () => {},
        },
        stdout: {
          on: (ev: string, cb: any) => {
            if (ev === "data") setImmediate(() => cb(Buffer.from("ok")));
          },
        },
        stderr: {
          on: (ev: string, cb: any) => {
            if (ev === "data") setImmediate(() => cb(Buffer.from("")));
          },
        },
        on: (ev: string, cb: any) => {
          if (ev === "close") setImmediate(() => cb(0));
        },
      };
      lastChild = child;
      return child;
    } as any;

    let captured: any = null;
    registerPostToolHook("capture", (ctx: any, result: any) => {
      captured = { ctx, result };
    });

    const res = await panel.applyPatchForTest(
      "patch-content",
      "/tmp",
      true,
      false,
    );
    assert.strictEqual(spawned, true, "spawnProc should have been called");
    assert.strictEqual(res.success, true, "apply should succeed");
    assert.ok(captured, "post-hook should have been called");
    assert.strictEqual(captured.result.success, true);
  });

  it("pre-hook can modify the patch sent to git", async () => {
    let lastChild: any = null;
    panel.spawnProc = function (cmd: string, args: string[], opts: any) {
      const child: any = {
        stdin: {
          write: (d: any) => {
            child._written = (child._written || "") + d;
          },
          end: () => {},
        },
        stdout: { on: (_: any, __: any) => {} },
        stderr: { on: (_: any, __: any) => {} },
        on: (ev: string, cb: any) => {
          if (ev === "close") setImmediate(() => cb(0));
        },
      };
      lastChild = child;
      return child;
    } as any;

    registerPreToolHook("modify", (ctx: any) => ({
      modify: { patch: "modified-patch-by-hook" },
    }));

    const res = await panel.applyPatchForTest(
      "original-patch",
      "/tmp",
      false,
      false,
    );
    assert.strictEqual(res.success, true, "apply should report success");
    assert.ok(lastChild, "child process should have been spawned");
    assert.strictEqual(lastChild._written, "modified-patch-by-hook");
  });
});
