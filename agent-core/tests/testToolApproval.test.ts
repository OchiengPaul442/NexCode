import { describe, it, expect } from "vitest";
import { DefaultToolApprovalPolicy } from "../src/tools/toolApprovalPolicy";

describe("Test tool approval policy (N11)", () => {
  const policy = new DefaultToolApprovalPolicy();

  it("test tool does NOT require approval (structured tool, auto-approved)", () => {
    expect(policy.requiresApproval("test", "npm test")).toBe(false);
  });

  it("test tool IS auto-executable (structured tool with fixed runners)", () => {
    expect(policy.isAutoExecutable("test", "npm test")).toBe(true);
  });

  it("test tool is classified as low-risk (not safe, not destructive)", () => {
    expect(policy.getToolRiskLevel("test", "npm test")).toBe("low-risk");
  });

  it("test tool auto-approves regardless of filter argument", () => {
    expect(policy.requiresApproval("test", "")).toBe(false);
    expect(policy.requiresApproval("test", "myTest")).toBe(false);
    expect(policy.requiresApproval("test", "complex --filter expression")).toBe(false);
  });

  it("other destructive tools still require approval", () => {
    expect(policy.requiresApproval("terminal", "rm -rf /")).toBe(true);
    expect(policy.requiresApproval("delete", "file.txt")).toBe(true);
    expect(policy.requiresApproval("move", "a :: b")).toBe(true);
    expect(policy.requiresApproval("batch_edit", "{}")).toBe(true);
  });

  it("search now requires approval (was previously safe)", () => {
    expect(policy.requiresApproval("search", "test query")).toBe(true);
  });

  it("search is classified as destructive", () => {
    expect(policy.getToolRiskLevel("search", "test query")).toBe("destructive");
  });

  it("search is NOT auto-executable", () => {
    expect(policy.isAutoExecutable("search", "test query")).toBe(false);
  });

  it("safe tools remain safe", () => {
    expect(policy.requiresApproval("read", "file.txt")).toBe(false);
    expect(policy.requiresApproval("git-status", "")).toBe(false);
    expect(policy.requiresApproval("git-diff", "")).toBe(false);
    expect(policy.requiresApproval("git-branch", "")).toBe(false);
  });

  it("bypass tools override all policies", () => {
    const bypassPolicy = new DefaultToolApprovalPolicy(["terminal", "search"]);
    expect(bypassPolicy.requiresApproval("terminal", "rm -rf /")).toBe(false);
    expect(bypassPolicy.requiresApproval("search", "test")).toBe(false);
  });
});

describe("Test tool formatToolArgs preserves runner (N11)", () => {
  it("runner and filter are both passed through", async () => {
    const { TestRunnerTool } = await import("../src/tools/testRunnerTool");
    const { TerminalTool } = await import("../src/tools/terminalTool");

    const terminal = new TerminalTool(process.cwd());
    const testTool = new TestRunnerTool(terminal);

    const command = testTool.resolveCommand({ runner: "jest", filter: "foo" });
    expect(command).toContain("jest");
    expect(command).toContain("foo");
    expect(command).not.toContain("npm test");
  });

  it("defaults to npm when runner is not specified", async () => {
    const { TestRunnerTool } = await import("../src/tools/testRunnerTool");
    const { TerminalTool } = await import("../src/tools/terminalTool");

    const terminal = new TerminalTool(process.cwd());
    const testTool = new TestRunnerTool(terminal);

    const command = testTool.resolveCommand({ filter: "foo" });
    expect(command).toContain("npm");
  });

  it("supports all known runners", async () => {
    const { TestRunnerTool } = await import("../src/tools/testRunnerTool");
    const { TerminalTool } = await import("../src/tools/terminalTool");

    const terminal = new TerminalTool(process.cwd());
    const testTool = new TestRunnerTool(terminal);

    const runners = ["npm", "vitest", "jest", "pytest", "go", "maven", "gradle", "cargo"];
    for (const runner of runners) {
      const command = testTool.resolveCommand({ runner });
      expect(command.length).toBeGreaterThan(0);
    }
  });
});
