import * as assert from "assert";

const hooks = require("../../tools/hooks");
const {
  registerPreToolHook,
  registerPostToolHook,
  runPreToolHooks,
  runPostToolHooks,
  clearAllHooks,
} = hooks;

describe("Tool Hooks", () => {
  afterEach(() => {
    if (clearAllHooks) clearAllHooks();
  });

  it("pre-hooks can block execution", async () => {
    registerPreToolHook("blocker", (ctx: any) => ({
      allow: false,
      reason: "forbidden",
    }));
    const res = await runPreToolHooks({
      toolId: "git.apply",
      command: "git",
      args: ["apply"],
      cwd: "/",
      patch: "patch",
    });
    assert.strictEqual(res.allowed, false);
    assert.strictEqual(res.reason, "forbidden");
  });

  it("pre-hooks can modify context", async () => {
    registerPreToolHook("modifier", (ctx: any) => ({
      modify: { args: ["apply", "--cached"] },
    }));
    const res = await runPreToolHooks({
      toolId: "git.apply",
      command: "git",
      args: ["apply"],
      cwd: "/tmp",
      patch: "p",
    });
    assert.strictEqual(res.allowed, true);
    assert.ok(Array.isArray(res.ctx.args));
    assert.strictEqual(res.ctx.args[1], "--cached");
  });

  it("post-hooks receive results", async () => {
    let captured: any = null;
    registerPostToolHook("cap", (ctx: any, result: any) => {
      captured = { ctx, result };
    });
    const ctx = {
      toolId: "git.apply",
      command: "git",
      args: ["apply"],
      cwd: "/tmp",
      patch: "p",
    };
    const result = { success: true, exitCode: 0, stdout: "ok", stderr: "" };
    await runPostToolHooks(ctx, result);
    assert.ok(captured);
    assert.strictEqual(captured.result.success, true);
    assert.strictEqual(captured.result.stdout, "ok");
  });
});
