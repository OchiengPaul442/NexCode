import * as assert from "assert";
const runner = require("../../tools/terminalRunner");
const hooks = require("../../tools/hooks");
const { registerPreToolHook, registerPostToolHook, clearAllHooks } = hooks;

describe("terminalRunner hooks integration", () => {
  const origSpawn = runner.spawnProc;
  afterEach(() => {
    clearAllHooks();
    runner.spawnProc = origSpawn;
  });

  it("pre-hook blocks execution", async () => {
    let preCalled = false;
    registerPreToolHook("blocker", (ctx: any) => {
      preCalled = true;
      return { allow: false, reason: "not-allowed" };
    });

    let spawnCalled = false;
    runner.spawnProc = function () {
      spawnCalled = true;
      throw new Error("should not spawn");
    } as any;

    const res = await runner.runTerminalCommand("echo", ["hi"], {
      cwd: "/tmp",
    });
    assert.strictEqual(preCalled, true);
    assert.strictEqual(spawnCalled, false);
    assert.strictEqual(res.success, false);
    assert.ok(res.error && res.error.indexOf("not-allowed") >= 0);
  });

  it("pre-hook can modify command", async () => {
    let usedCmd: any = null;
    runner.spawnProc = function (cmd: string, args: string[], opts: any) {
      usedCmd = { cmd, args, opts };
      const child: any = {
        stdout: {
          on: (_: any, cb: any) => setImmediate(() => cb(Buffer.from("ok"))),
        },
        stderr: { on: (_: any, cb: any) => {} },
        on: (ev: string, cb: any) => {
          if (ev === "close") setImmediate(() => cb(0));
        },
      };
      return child;
    } as any;

    registerPreToolHook("mod", (ctx: any) => ({
      modify: { args: ["-n", "modified"] },
    }));

    const res = await runner.runTerminalCommand("echo", ["orig"], {
      cwd: "/tmp",
    });
    assert.strictEqual(res.success, true);
    assert.ok(usedCmd);
    assert.strictEqual(usedCmd.args[0], "-n");
    assert.strictEqual(usedCmd.args[1], "modified");
  });

  it("post-hook receives stdout/stderr", async () => {
    let captured: any = null;
    registerPostToolHook("cap", (ctx: any, result: any) => {
      captured = { ctx, result };
    });

    runner.spawnProc = function () {
      const child: any = {
        stdout: {
          on: (_: any, cb: any) => setImmediate(() => cb(Buffer.from("hello"))),
        },
        stderr: {
          on: (_: any, cb: any) => setImmediate(() => cb(Buffer.from("err"))),
        },
        on: (ev: string, cb: any) => {
          if (ev === "close") setImmediate(() => cb(0));
        },
      };
      return child;
    } as any;

    const res = await runner.runTerminalCommand("ls", ["-la"], { cwd: "/tmp" });
    assert.strictEqual(res.success, true);
    assert.ok(captured);
    assert.strictEqual(captured.result.stdout, "hello");
    assert.strictEqual(captured.result.stderr, "err");
  });

  it("pre-hook can ask and user denies", async () => {
    const confirmation = require("../../tools/confirmation");
    let confirmCalled = false;
    confirmation.confirmAction = async (cmd: string, ask: any) => {
      confirmCalled = true;
      return "deny";
    };

    registerPreToolHook("ask", (ctx: any) => ({
      ask: { prompt: "Run?", explanation: "Are you sure" },
    }));

    let spawnCalled = false;
    runner.spawnProc = function () {
      spawnCalled = true;
      throw new Error("should not spawn");
    } as any;

    const res = await runner.runTerminalCommand("echo", ["hi"], {
      cwd: "/tmp",
    });
    assert.strictEqual(confirmCalled, true);
    assert.strictEqual(spawnCalled, false);
    assert.strictEqual(res.success, false);
    assert.ok(res.error && res.error.indexOf("denied by user") >= 0);
  });

  it("pre-hook ask approve and always behavior", async () => {
    const confirmation = require("../../tools/confirmation");
    const runnerMod = runner as any;
    // first call: approve
    let callCount = 0;
    confirmation.confirmAction = async (cmd: string, ask: any) => {
      callCount++;
      return callCount === 1 ? "approve" : "always";
    };

    let spawned = 0;
    runner.spawnProc = function (cmd: string, args: string[], opts: any) {
      spawned++;
      const child: any = {
        stdout: {
          on: (_: any, cb: any) => setImmediate(() => cb(Buffer.from("ok"))),
        },
        stderr: { on: (_: any, cb: any) => {} },
        on: (ev: string, cb: any) => {
          if (ev === "close") setImmediate(() => cb(0));
        },
      };
      return child;
    } as any;

    registerPreToolHook("ask2", (ctx: any) => ({
      ask: { prompt: "Run twice?", explanation: "Test always" },
    }));

    const res1 = await runner.runTerminalCommand("echo", ["1"], {
      cwd: "/tmp",
    });
    assert.strictEqual(res1.success, true);
    // second call should use sessionAlwaysAllow and not call confirmAction again
    const res2 = await runner.runTerminalCommand("echo", ["1"], {
      cwd: "/tmp",
    });
    assert.strictEqual(res2.success, true);
    assert.ok(spawned >= 2);
  });
});
