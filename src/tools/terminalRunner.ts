import { spawn } from "child_process";
import { runPreToolHooks, runPostToolHooks, ToolContext } from "./hooks";
import {
  confirmAction,
  sessionAlwaysAllow,
  isAutoAllowed,
  persistAllow,
  computeHash,
} from "./confirmation";
import { evaluatePolicy } from "./policy";
import { logEvent } from "./audit";

export let spawnProc: typeof spawn = spawn;

export type RunOptions = {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  metadata?: any;
  stdin?: string;
};

function isDangerous(cmdline: string): boolean {
  if (!cmdline) return false;
  const s = cmdline.toLowerCase();
  // simple heuristics to block obviously destructive commands
  const patterns = [
    "rm -rf ",
    "sudo ",
    "\bdd \b",
    "mkfs",
    "shutdown",
    "halt",
    "reboot",
    ": >",
    "dd if=",
    "rm -r /",
  ];
  return patterns.some((p) => s.indexOf(p) >= 0);
}

export async function runTerminalCommand(
  command: string,
  args: string[] = [],
  options: RunOptions = {},
): Promise<{
  success: boolean;
  exitCode?: number;
  stdout?: string;
  stderr?: string;
  error?: string;
}> {
  const initialCtx: ToolContext = {
    toolId: `terminal.${command}`,
    command,
    args: args.slice(),
    cwd: options.cwd,
    metadata: options.metadata,
  };

  try {
    // handle empty or malformed command gracefully
    if (!command || String(command).trim().length === 0) {
      const reason = "empty command";
      await runPostToolHooks(initialCtx, { success: false, error: reason });
      return { success: false, error: reason };
    }
    // Evaluate safety policy (denylist / risky rules) before running pre-hooks
    try {
      const policy = await evaluatePolicy(initialCtx);
      // log policy decision
      try {
        await logEvent({
          tool: initialCtx.toolId,
          command:
            `${initialCtx.command} ${(initialCtx.args || []).join(" ")}`.trim(),
          decision: policy.decision,
          reason: policy.reason,
          matchedRule: policy.matchedRule,
          outcome: policy.decision === "deny" ? "blocked" : "pending",
          cwd: initialCtx.cwd,
        });
      } catch (e) {}

      if (policy.decision === "deny") {
        const reason = policy.reason || "blocked by safety policy";
        await runPostToolHooks(initialCtx, { success: false, error: reason });
        return { success: false, error: reason };
      }
      if (policy.decision === "ask") {
        const cmdline =
          `${initialCtx.command} ${(initialCtx.args || []).join(" ")}`.trim();
        const toolKey = initialCtx.toolId || initialCtx.command;
        const hash = computeHash(cmdline, toolKey);
        const key = `${toolKey}::${hash}`;
        if (!isAutoAllowed(cmdline, toolKey) && !sessionAlwaysAllow.has(key)) {
          const decision = await confirmAction(
            cmdline,
            policy.askPayload as any,
          );
          // log user decision
          try {
            await logEvent({
              tool: initialCtx.toolId,
              command: cmdline,
              decision: decision === "deny" ? "deny" : "allow",
              reason:
                decision === "deny" ? "denied by user" : "approved by user",
              matchedRule: policy.matchedRule,
              outcome: decision === "deny" ? "blocked" : "pending",
              cwd: initialCtx.cwd,
            });
          } catch (e) {}

          if (decision === "deny") {
            const reason = "denied by user";
            await runPostToolHooks(initialCtx, {
              success: false,
              error: reason,
            });
            return { success: false, error: reason };
          }
          if (decision === "always_workspace") {
            sessionAlwaysAllow.add(key);
            try {
              await persistAllow(
                cmdline,
                toolKey,
                "workspace",
                policy.askPayload as any,
              );
            } catch (_) {}
          } else if (decision === "always_global") {
            sessionAlwaysAllow.add(key);
            try {
              await persistAllow(
                cmdline,
                toolKey,
                "global",
                policy.askPayload as any,
              );
            } catch (_) {}
          }
        }
      }
    } catch (e) {
      // policy evaluation failure -> continue and let hooks handle safety
      console.warn("policy evaluation error", e);
    }
    const pre = await runPreToolHooks(initialCtx);
    if (!pre.allowed) {
      // if a pre-hook returned an 'ask' payload, prompt the user
      if (pre.ask) {
        const cmdline =
          `${pre.ctx.command} ${(pre.ctx.args || []).join(" ")}`.trim();
        const hash = computeHash(cmdline, "terminal");
        const key = `terminal::${hash}`;
        if (
          !isAutoAllowed(cmdline, "terminal") &&
          !sessionAlwaysAllow.has(key)
        ) {
          const decision = await confirmAction(cmdline, pre.ask);
          if (decision === "deny") {
            const reason = "denied by user";
            await runPostToolHooks(pre.ctx, { success: false, error: reason });
            return { success: false, error: reason };
          }
          if (decision === "always_workspace") {
            sessionAlwaysAllow.add(key);
            // persist as workspace-level rule where possible
            try {
              await persistAllow(cmdline, "terminal", "workspace", pre.ask);
            } catch (_) {}
          } else if (decision === "always_global") {
            sessionAlwaysAllow.add(key);
            try {
              await persistAllow(cmdline, "terminal", "global", pre.ask);
            } catch (_) {}
          }
          // if approved or always, continue with pre.ctx
        }
      } else {
        const reason = pre.reason || "blocked by pre-hook";
        await runPostToolHooks(pre.ctx, { success: false, error: reason });
        return { success: false, error: reason };
      }
    }

    const ctx = pre.ctx;
    const cmdline = `${ctx.command} ${(ctx.args || []).join(" ")}`.trim();
    if (isDangerous(cmdline)) {
      const reason = "blocked by safety policy";
      await runPostToolHooks(ctx, { success: false, error: reason });
      return { success: false, error: reason };
    }

    return await new Promise((resolve) => {
      const child = spawnProc(ctx.command || command, ctx.args || [], {
        cwd: ctx.cwd,
        env: options.env,
      });
      let stdout = "";
      let stderr = "";
      if (child.stdout)
        child.stdout.on("data", (d) => (stdout += d.toString()));
      if (child.stderr)
        child.stderr.on("data", (d) => (stderr += d.toString()));
      // write stdin if provided
      try {
        if (options.stdin && child.stdin) {
          child.stdin.write(options.stdin);
          child.stdin.end();
        }
      } catch (e) {}
      child.on("error", async (err: any) => {
        const result = {
          success: false,
          error: String(err && err.message ? err.message : err),
        };
        try {
          await runPostToolHooks(ctx, result);
        } catch (e) {}
        try {
          await logEvent({
            tool: ctx.toolId,
            command: `${ctx.command} ${(ctx.args || []).join(" ")}`.trim(),
            decision: "allow",
            reason: "execution error",
            outcome: "error",
            error: result.error,
            cwd: ctx.cwd,
          });
        } catch (e) {}
        resolve(result);
      });
      child.on("close", async (code: number) => {
        const result: any = {
          success: code === 0,
          exitCode: code,
          stdout,
          stderr,
        };
        if (code !== 0 && !result.error)
          result.error = stderr || `exit ${code}`;
        try {
          await runPostToolHooks(ctx, result);
        } catch (e) {}
        try {
          await logEvent({
            tool: ctx.toolId,
            command: `${ctx.command} ${(ctx.args || []).join(" ")}`.trim(),
            decision: "allow",
            reason: result.error || undefined,
            outcome: result.success ? "executed" : "failed",
            exitCode: result.exitCode,
            stdout: result.stdout,
            stderr: result.stderr,
            cwd: ctx.cwd,
          });
        } catch (e) {}
        resolve(result);
      });
    });
  } catch (e: any) {
    const err = String(e && e.message ? e.message : e);
    try {
      await runPostToolHooks(initialCtx, { success: false, error: err });
    } catch (ee) {}
    return { success: false, error: err };
  }
}

export default { runTerminalCommand };
