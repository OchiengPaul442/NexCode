import * as vscode from "vscode";
import { ToolContext } from "./hooks";
import { logBlockedAttempt } from "./audit";

export type PolicyDecision = "deny" | "ask" | "allow";

export interface PolicyResult {
  decision: PolicyDecision;
  reason?: string;
  matchedRule?: any;
  askPayload?: {
    prompt: string;
    explanation?: string;
    risk?: "low" | "medium" | "high";
  };
}

function extractFilePathsFromPatch(patch: string): string[] {
  if (!patch) return [];
  const filePaths = new Set<string>();
  const fromMatch = patch.match(/^---\s+(?:a\/|b\/)?(.+)$/m);
  const toMatch = patch.match(/^\+\+\+\s+(?:a\/|b\/)?(.+)$/m);
  if (fromMatch && fromMatch[1])
    filePaths.add(fromMatch[1].replace(/\\/g, "/"));
  if (toMatch && toMatch[1]) filePaths.add(toMatch[1].replace(/\\/g, "/"));
  const diffGitRe = /^diff --git a\/(.+?) b\/(.+?)$/gm;
  let dg: RegExpExecArray | null;
  while ((dg = diffGitRe.exec(patch)) !== null) {
    if (dg[1]) filePaths.add(dg[1].replace(/\\/g, "/"));
    if (dg[2]) filePaths.add(dg[2].replace(/\\/g, "/"));
  }
  return Array.from(filePaths).map((p) =>
    p
      .replace(/^a\//, "")
      .replace(/^b\//, "")
      .replace(/^\.?\/?/, "")
      .replace(/\\/g, "/"),
  );
}

function matchPattern(pattern: string, target: string): boolean {
  if (!pattern || !target) return false;
  const p = pattern.trim();
  // regex prefix
  if (p.startsWith("re:")) {
    try {
      const re = new RegExp(p.slice(3));
      return re.test(target);
    } catch (e) {
      return false;
    }
  }
  // simple glob -> regex
  if (p.indexOf("*") >= 0 || p.indexOf("?") >= 0) {
    const esc = p
      .replace(/[.+^${}()|[\\]\\]/g, "\\$&")
      .replace(/\*/g, ".*")
      .replace(/\?/g, ".");
    try {
      const re = new RegExp("^" + esc + "$", "i");
      return re.test(target);
    } catch (e) {
      return false;
    }
  }
  return target.toLowerCase().indexOf(p.toLowerCase()) >= 0;
}

export async function evaluatePolicy(ctx: ToolContext): Promise<PolicyResult> {
  try {
    const cfg = vscode.workspace.getConfiguration("pulse");
    const rules = (cfg.get<any[]>("denylist") || []) as any[];
    const rawCmdline =
      `${ctx.command || ""} ${(ctx.args || []).join(" ")}`.trim();
    const cmdline = normalizeCmd(rawCmdline);

    // empty command -> allow
    if (!cmdline) return { decision: "allow" };

    // prepare file paths (for patch-based operations)
    const filePaths = ctx.patch ? extractFilePathsFromPatch(ctx.patch) : [];

    for (const rule of rules) {
      try {
        if (!rule || rule.enabled === false) continue;
        const type = rule.type || "command";
        const pattern = rule.pattern || rule.path || "";
        if (!pattern) continue;
        if (type === "file") {
          if (!filePaths.length) continue;
          for (const fp of filePaths) {
            if (matchPattern(pattern, normalizeCmd(fp))) {
              const risk = rule.risk || "high";
              const matchedRule = rule;
              if (risk === "high") {
                await logBlockedAttempt({
                  when: Date.now(),
                  tool: ctx.toolId,
                  command: cmdline,
                  cwd: ctx.cwd,
                  rule: matchedRule,
                  filePaths,
                });
                return {
                  decision: "deny",
                  reason: "denied by denylist rule",
                  matchedRule,
                };
              }
              if (risk === "medium") {
                return {
                  decision: "ask",
                  matchedRule,
                  askPayload: {
                    prompt: rule.prompt || "Confirm file modification",
                    explanation:
                      rule.description ||
                      `Patch touches protected file ${pattern}`,
                    risk: "medium",
                  },
                };
              }
              // low -> allow
              return { decision: "allow" };
            }
          }
          continue;
        }

        // command rule matching
        if (matchPattern(pattern, cmdline)) {
          const matchedRule = rule;
          const risk = rule.risk || "high";
          if (risk === "high") {
            await logBlockedAttempt({
              when: Date.now(),
              tool: ctx.toolId,
              command: cmdline,
              cwd: ctx.cwd,
              rule: matchedRule,
            });
            return {
              decision: "deny",
              reason: "denied by denylist rule",
              matchedRule,
            };
          }
          if (risk === "medium") {
            return {
              decision: "ask",
              matchedRule,
              askPayload: {
                prompt: rule.prompt || "Confirm command",
                explanation:
                  rule.description ||
                  `Command matches denylist pattern ${pattern}`,
                risk: "medium",
              },
            };
          }
          // low -> allow
          return { decision: "allow" };
        }
      } catch (e) {
        // ignore rule errors
      }
    }
  } catch (e) {
    // if policy evaluation fails, be permissive
    console.warn("policy evaluation failed", e);
  }
  return { decision: "allow" };
}

function normalizeCmd(s: string) {
  if (!s) return "";
  return s.trim().toLowerCase().replace(/\\/g, "/").replace(/\s+/g, " ");
}
export default { evaluatePolicy };
