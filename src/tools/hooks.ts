export type ToolContext = {
  toolId: string;
  command: string;
  args: string[];
  cwd?: string;
  metadata?: any;
  patch?: string;
};
export type AskPayload = {
  prompt: string;
  explanation?: string;
  risk?: "low" | "medium" | "high";
};

export type PreHookResult = {
  allow?: boolean;
  reason?: string;
  modify?: Partial<ToolContext>;
  ask?: AskPayload;
} | void;

export type PreToolHook = (
  ctx: ToolContext,
) => Promise<PreHookResult> | PreHookResult;

export type PostToolResult = {
  success: boolean;
  exitCode?: number;
  stdout?: string;
  stderr?: string;
  error?: string;
};
export type PostToolHook = (
  ctx: ToolContext,
  result: PostToolResult,
) => Promise<void> | void;

const preHooks = new Map<string, PreToolHook>();
const postHooks = new Map<string, PostToolHook>();

export function registerPreToolHook(name: string, fn: PreToolHook) {
  preHooks.set(name, fn);
  return () => preHooks.delete(name);
}

export function registerPostToolHook(name: string, fn: PostToolHook) {
  postHooks.set(name, fn);
  return () => postHooks.delete(name);
}

export async function runPreToolHooks(
  initialCtx: ToolContext,
): Promise<{
  allowed: boolean;
  ctx: ToolContext;
  reason?: string;
  ask?: AskPayload;
}> {
  let ctx: ToolContext = { ...initialCtx };
  for (const [name, fn] of preHooks) {
    try {
      const res = await fn(ctx);
      if (res && typeof res === "object") {
        if (res.allow === false)
          return {
            allowed: false,
            ctx,
            reason: res.reason || "blocked by pre-hook",
          };
        if (res.ask) return { allowed: false, ctx, ask: res.ask };
        if (res.modify) ctx = { ...ctx, ...res.modify };
      }
    } catch (e: any) {
      return {
        allowed: false,
        ctx,
        reason: String(e && e.message ? e.message : e),
      };
    }
  }
  return { allowed: true, ctx };
}

export async function runPostToolHooks(
  ctx: ToolContext,
  result: PostToolResult,
) {
  for (const fn of postHooks.values()) {
    try {
      await fn(ctx, result);
    } catch (e) {
      // Do not let a failing post-hook prevent other hooks from running
      console.warn("post-hook failed", e);
    }
  }
}

export function clearAllHooks() {
  preHooks.clear();
  postHooks.clear();
}
