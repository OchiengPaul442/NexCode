import { describe, it, expect } from "vitest";
import {
  DefaultToolApprovalPolicy,
  ToolApprovalPolicy,
} from "../src/tools/toolApprovalPolicy";
import { ToolRegistry } from "../src/tools/toolRegistry";

describe("DefaultToolApprovalPolicy", () => {
  const policy: ToolApprovalPolicy = new DefaultToolApprovalPolicy();

  it("requires approval for delete", () => {
    expect(policy.requiresApproval("delete", "src/file.ts")).toBe(true);
  });

  it("requires approval for delete-contents", () => {
    expect(policy.requiresApproval("delete-contents", "src/dir")).toBe(true);
  });

  it("requires approval for move", () => {
    expect(policy.requiresApproval("move", "a.ts :: b.ts")).toBe(true);
  });

  it("requires approval for terminal", () => {
    expect(policy.requiresApproval("terminal", "ls -la")).toBe(true);
  });

  it("does NOT require approval for read", () => {
    expect(policy.requiresApproval("read", "src/file.ts")).toBe(false);
  });

  it("does NOT require approval for search", () => {
    expect(policy.requiresApproval("search", "TODO")).toBe(false);
  });

  it("does NOT require approval for write", () => {
    expect(policy.requiresApproval("write", "f.ts :: content")).toBe(false);
  });

  it("does NOT require approval for append", () => {
    expect(policy.requiresApproval("append", "f.ts :: content")).toBe(false);
  });

  it("does NOT require approval for git-status", () => {
    expect(policy.requiresApproval("git-status", "")).toBe(false);
  });

  it("does NOT require approval for unknown tools", () => {
    expect(policy.requiresApproval("mcp", "server:tool :: input")).toBe(false);
  });
});

describe("DefaultToolApprovalPolicy with bypass", () => {
  it("allows bypassed tools to skip approval", () => {
    const policy = new DefaultToolApprovalPolicy(["delete", "terminal"]);
    expect(policy.requiresApproval("delete", "file.ts")).toBe(false);
    expect(policy.requiresApproval("terminal", "ls")).toBe(false);
    expect(policy.requiresApproval("delete-contents", "dir")).toBe(true);
    expect(policy.requiresApproval("move", "a :: b")).toBe(true);
  });
});

describe("ToolRegistry with approval policy", () => {
  const workspaceRoot = process.cwd();
  const policy = new DefaultToolApprovalPolicy();

  it("returns AWAITING_APPROVAL for delete", async () => {
    const registry = new ToolRegistry(workspaceRoot, {
      approvalPolicy: policy,
    });
    const result = await registry.runToolCall("delete src/file.ts");
    expect(result.requiresApproval).toBe(true);
    expect(result.toolName).toBe("delete");
    expect(result.pendingArg).toBe("src/file.ts");
    expect(result.output).toBe("AWAITING_APPROVAL");
  });

  it("returns AWAITING_APPROVAL for delete-contents", async () => {
    const registry = new ToolRegistry(workspaceRoot, {
      approvalPolicy: policy,
    });
    const result = await registry.runToolCall("delete-contents src/dir");
    expect(result.requiresApproval).toBe(true);
    expect(result.toolName).toBe("delete-contents");
  });

  it("returns AWAITING_APPROVAL for move", async () => {
    const registry = new ToolRegistry(workspaceRoot, {
      approvalPolicy: policy,
    });
    const result = await registry.runToolCall("move a.ts :: b.ts");
    expect(result.requiresApproval).toBe(true);
    expect(result.toolName).toBe("move");
  });

  it("returns AWAITING_APPROVAL for terminal", async () => {
    const registry = new ToolRegistry(workspaceRoot, {
      approvalPolicy: policy,
    });
    const result = await registry.runToolCall("terminal ls -la");
    expect(result.requiresApproval).toBe(true);
    expect(result.toolName).toBe("terminal");
  });

  it("does NOT require approval for read without policy", async () => {
    const registry = new ToolRegistry(workspaceRoot);
    const result = await registry.requiresApproval("read", "file.ts");
    expect(result).toBe(false);
  });

  it("requiresApproval method delegates to policy", () => {
    const registry = new ToolRegistry(workspaceRoot, {
      approvalPolicy: policy,
    });
    expect(registry.requiresApproval("delete", "file.ts")).toBe(true);
    expect(registry.requiresApproval("read", "file.ts")).toBe(false);
  });

  it("executes read without approval", async () => {
    const registry = new ToolRegistry(workspaceRoot, {
      approvalPolicy: policy,
    });
    const result = await registry.runToolCall("read package.json");
    expect(result.ok).toBe(true);
    expect(result.requiresApproval).toBeUndefined();
  });
});
