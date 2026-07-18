import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SearchTool } from "../src/tools/searchTool";
import { TerminalTool } from "../src/tools/terminalTool";
import fs from "fs/promises";
import path from "path";
import os from "os";

const IS_WINDOWS = process.platform === "win32";

async function isCommandAvailable(cmd: string): Promise<boolean> {
  try {
    const { execFile } = await import("child_process");
    const { promisify } = await import("util");
    const execFileAsync = promisify(execFile);
    await execFileAsync(cmd, ["--version"]);
    return true;
  } catch {
    return false;
  }
}

describe("SearchTool command injection prevention (N1)", () => {
  let tmpDir: string;
  let terminal: TerminalTool;
  let search: SearchTool;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "nexcode-search-test-"));
    terminal = new TerminalTool(tmpDir);
    search = new SearchTool(terminal);

    await fs.writeFile(path.join(tmpDir, "test.txt"), "hello world\nfoo bar\n");
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("SearchTool uses runSafe (execFile) instead of run (exec)", async () => {
    const terminalAny = terminal as any;

    let runSafeCalled = false;
    const originalRunSafe = terminalAny.runSafe.bind(terminalAny);
    terminalAny.runSafe = async (...args: any[]) => {
      runSafeCalled = true;
      return originalRunSafe(...args);
    };

    let runCalled = false;
    const originalRun = terminalAny.run.bind(terminalAny);
    terminalAny.run = async (...args: any[]) => {
      runCalled = true;
      return originalRun(...args);
    };

    await search.search("hello");

    expect(runSafeCalled).toBe(true);
    expect(runCalled).toBe(false);
  });

  it("does not interpret shell metacharacters when rg is available", async function () {
    const hasRg = await isCommandAvailable("rg");
    if (!hasRg) {
      // rg not installed on this system - skip gracefully
      return;
    }

    const maliciousQueries = [
      'hello" ; echo INJECTED ; echo "',
      "hello && echo INJECTED",
      "hello | echo INJECTED",
      "$(echo INJECTED)",
      "`echo INJECTED`",
    ];

    for (const query of maliciousQueries) {
      const result = await search.search(query);
      const lines = result.output.split("\n");
      const executedLines = lines.filter(
        (line) =>
          !line.includes("Command failed") &&
          !line.includes("not recognized") &&
          !line.includes("not found") &&
          !line.includes("ERROR") &&
          line.trim().length > 0,
      );
      for (const line of executedLines) {
        expect(line).not.toContain("INJECTED");
      }
    }
  });

  it("handles empty query gracefully", async () => {
    const result = await search.search("   ");
    expect(result.ok).toBe(false);
    expect(result.output).toContain("cannot be empty");
  });

  it("uses search tool via ToolRegistry with approval check", async () => {
    const { ToolRegistry } = await import("../src/tools/toolRegistry");
    const registry = new ToolRegistry(tmpDir);

    expect(registry.requiresApproval("search", "hello")).toBe(true);
  });
});

describe("SearchTool is not in SAFE_TOOLS (N1)", () => {
  it("search requires approval like other command-executing tools", async () => {
    const { DefaultToolApprovalPolicy } = await import("../src/tools/toolApprovalPolicy");
    const policy = new DefaultToolApprovalPolicy();

    expect(policy.isAutoExecutable("search", "test query")).toBe(false);
    expect(policy.requiresApproval("search", "test query")).toBe(true);
    expect(policy.getToolRiskLevel("search", "test query")).toBe("destructive");
  });
});
