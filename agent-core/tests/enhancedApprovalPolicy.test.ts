import { describe, it, expect } from "vitest";
import { EnhancedToolApprovalPolicy } from "../src/tools/enhancedApprovalPolicy";

describe("EnhancedToolApprovalPolicy", () => {
  it("should create with default config", () => {
    const policy = new EnhancedToolApprovalPolicy();
    expect(policy).toBeDefined();
  });

  it("should auto-execute safe tools", () => {
    const policy = new EnhancedToolApprovalPolicy();
    expect(policy.isAutoExecutable("read", "test.ts")).toBe(true);
    expect(policy.isAutoExecutable("search", "query")).toBe(true);
  });

  it("should require approval for low-risk write tools", () => {
    const policy = new EnhancedToolApprovalPolicy();
    expect(policy.requiresApproval("write", "test.ts")).toBe(true);
    expect(policy.requiresApproval("append", "test.ts")).toBe(true);
    expect(policy.requiresApproval("patch", "test.ts")).toBe(true);
  });

  it("should return correct risk levels", () => {
    const policy = new EnhancedToolApprovalPolicy();
    expect(policy.getToolRiskLevel("read", "")).toBe("safe");
    expect(policy.getToolRiskLevel("write", "")).toBe("low-risk");
    expect(policy.getToolRiskLevel("delete", "")).toBe("destructive");
  });

  it("should support custom rules", () => {
    const policy = new EnhancedToolApprovalPolicy({
      rules: [
        {
          tool: "terminal",
          action: "allow",
          commandPattern: "npm *",
        },
      ],
    });

    // npm commands should be allowed
    expect(policy.requiresApproval("terminal", "npm test")).toBe(false);
    // Other commands should still require approval
    expect(policy.requiresApproval("terminal", "rm -rf /")).toBe(true);
  });

  it("should support path patterns", () => {
    const policy = new EnhancedToolApprovalPolicy({
      rules: [
        {
          tool: "write",
          action: "allow",
          pathPattern: "*.json",
        },
      ],
    });

    // JSON files should be allowed
    expect(policy.requiresApproval("write", "config.json")).toBe(false);
    // Other files should still require approval
    expect(policy.requiresApproval("write", "src/index.ts")).toBe(true);
  });

  it("should support bypass tools", () => {
    const policy = new EnhancedToolApprovalPolicy({
      bypassTools: ["custom-tool"],
    });

    expect(policy.isAutoExecutable("custom-tool", "")).toBe(true);
    expect(policy.requiresApproval("custom-tool", "")).toBe(false);
  });

  it("should support deny rules", () => {
    const policy = new EnhancedToolApprovalPolicy({
      rules: [
        {
          tool: "write",
          action: "deny",
          pathPattern: "*.env",
        },
      ],
    });

    // .env files should be denied
    expect(policy.requiresApproval("write", ".env")).toBe(true);
  });

  it("should follow first-match-wins precedence", () => {
    const policy = new EnhancedToolApprovalPolicy({
      rules: [
        {
          tool: "write",
          action: "allow",
          pathPattern: "*.json",
        },
        {
          tool: "write",
          action: "deny",
          pathPattern: "*.env",
        },
      ],
    });

    // First rule matches JSON files
    expect(policy.requiresApproval("write", "config.json")).toBe(false);
    // Second rule matches .env files (but .env doesn't match *.json)
    expect(policy.requiresApproval("write", ".env")).toBe(true);
  });
});
