import * as assert from "assert";
import * as vscode from "vscode";

const runner = require("../../tools/terminalRunner");
const confirmation = require("../../tools/confirmation");
const hooks = require("../../tools/hooks");
const { clearAllHooks } = hooks;

describe("policy enforcement", () => {
  const origSpawn = runner.spawnProc;
  afterEach(async () => {
    clearAllHooks();
    runner.spawnProc = origSpawn;
    if (confirmation && confirmation.clearPersistentAllows)
      confirmation.clearPersistentAllows();
    // clear denylist config
    try {
      await vscode.workspace
        .getConfiguration("pulse")
        .update("denylist", undefined, vscode.ConfigurationTarget.Global);
    } catch (e) {}
  });

  it("high-risk command is blocked regardless of persisted allow", async () => {
    await vscode.workspace.getConfiguration("pulse").update(
      "denylist",
      [
        {
          pattern: "rm -rf",
          type: "command",
          risk: "high",
          enabled: true,
          description: "Destructive",
        },
      ],
      vscode.ConfigurationTarget.Global,
    );

    let spawnCalled = false;
    runner.spawnProc = function () {
      spawnCalled = true;
      throw new Error("should not spawn");
    } as any;

    // attempt to persist allow -> should be refused
    const persisted = await confirmation.persistAllow(
      "rm -rf /tmp/x",
      "terminal",
      "workspace",
      {
        prompt: "Run?",
        explanation: "testing",
        risk: "high",
      },
    );
    assert.strictEqual(persisted, false);

    const res = await runner.runTerminalCommand("rm", ["-rf", "/tmp/x"], {
      cwd: "/tmp",
    });
    assert.strictEqual(res.success, false);
    assert.ok(res.error && res.error.toLowerCase().indexOf("deny") >= 0);
    assert.strictEqual(spawnCalled, false);
  });

  it("medium-risk command prompts and persistence works", async () => {
    await vscode.workspace.getConfiguration("pulse").update(
      "denylist",
      [
        {
          pattern: "curl ",
          type: "command",
          risk: "medium",
          enabled: true,
          description: "Network fetch",
        },
      ],
      vscode.ConfigurationTarget.Global,
    );

    const confirmationMod = require("../../tools/confirmation");
    let confirmCalled = 0;
    confirmationMod.confirmAction = async (cmd: string, ask: any) => {
      confirmCalled++;
      return "always_workspace";
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

    const res1 = await runner.runTerminalCommand(
      "curl",
      ["http://example.com"],
      { cwd: "/tmp" },
    );
    assert.strictEqual(res1.success, true);
    // confirmAction should have been called once
    assert.strictEqual(confirmCalled, 1);

    // second call should be auto-allowed via persisted workspace allow
    const res2 = await runner.runTerminalCommand(
      "curl",
      ["http://example.com"],
      { cwd: "/tmp" },
    );
    assert.strictEqual(res2.success, true);
    assert.strictEqual(confirmCalled, 1);
    assert.ok(spawned >= 2);
  });

  it("file deny pattern blocks patch touching .env", async () => {
    await vscode.workspace.getConfiguration("pulse").update(
      "denylist",
      [
        {
          pattern: ".env",
          type: "file",
          risk: "high",
          enabled: true,
          description: "Secrets file",
        },
      ],
      vscode.ConfigurationTarget.Global,
    );

    const dr = require("../../panels/diffReviewPanel");
    const patch = `diff --git a/secrets/.env b/secrets/.env
--- a/secrets/.env
+++ b/secrets/.env
@@ -1,1 +1,1 @@
-OLD
+NEW
`;
    const res = await dr.applyPatchForTest(patch, ".", false, false);
    assert.strictEqual(res.success, false);
    assert.ok(res.error && res.error.toLowerCase().indexOf("deny") >= 0);
  });

  it("command chaining and casing variations are detected", async () => {
    await vscode.workspace
      .getConfiguration("pulse")
      .update(
        "denylist",
        [{ pattern: "rm -rf", type: "command", risk: "high", enabled: true }],
        vscode.ConfigurationTarget.Global,
      );

    let spawnCalled = false;
    runner.spawnProc = function () {
      spawnCalled = true;
      throw new Error("should not spawn");
    } as any;

    // simulate chained/cased command
    const res = await runner.runTerminalCommand(
      "sudo",
      ["RM", "-Rf", "/tmp/x", "&&", "echo", "ok"],
      { cwd: "/tmp" },
    );
    assert.strictEqual(res.success, false);
    assert.strictEqual(spawnCalled, false);
  });

  it("empty command is handled gracefully", async () => {
    const res = await runner.runTerminalCommand("", [], { cwd: "/tmp" });
    assert.strictEqual(res.success, false);
    assert.ok(res.error && res.error.toLowerCase().indexOf("empty") >= 0);
  });
});
