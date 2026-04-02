import { spawn } from "child_process";
import { runPreToolHooks, runPostToolHooks, ToolContext } from "./hooks";
import { confirmAction, sessionAlwaysAllow } from "./confirmation";

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
    const pre = await runPreToolHooks(initialCtx);
    if (!pre.allowed) {
      // if a pre-hook returned an 'ask' payload, prompt the user
      if (pre.ask) {
        const cmdline =
          `${pre.ctx.command} ${(pre.ctx.args || []).join(" ")}`.trim();
        if (!sessionAlwaysAllow.has(cmdline)) {
          const decision = await confirmAction(cmdline, pre.ask);
          if (decision === "deny") {
            const reason = "denied by user";
            await runPostToolHooks(pre.ctx, { success: false, error: reason });
            return { success: false, error: reason };
          }
          if (decision === "always") sessionAlwaysAllow.add(cmdline);
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
