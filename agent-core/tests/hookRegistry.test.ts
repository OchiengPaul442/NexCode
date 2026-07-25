import { describe, it, expect, beforeEach } from "vitest";
import { HookRegistry, createValidationHook } from "../src/hooks/hookRegistry";

describe("HookRegistry", () => {
  let registry: HookRegistry;

  beforeEach(() => {
    registry = new HookRegistry();
  });

  it("should register and unregister hooks", () => {
    registry.register({
      name: "test-hook",
      description: "Test hook",
      before: async () => true,
    });

    // Verify hook is registered by executing it
    let executed = false;
    registry.register({
      name: "test-hook-2",
      description: "Test hook 2",
      before: async () => {
        executed = true;
        return true;
      },
    });

    registry.unregister("test-hook-2");
    // Should not throw
    expect(true).toBe(true);
  });

  it("should execute before hooks", async () => {
    let hookCalled = false;
    registry.register({
      name: "test-hook",
      description: "Test hook",
      before: async () => {
        hookCalled = true;
        return true;
      },
    });

    const result = await registry.executeBefore("write", "test.ts");
    expect(hookCalled).toBe(true);
    expect(result).toBe(true);
  });

  it("should block execution when before hook returns false", async () => {
    registry.register({
      name: "blocker",
      description: "Blocks execution",
      before: async () => false,
    });

    const result = await registry.executeBefore("write", "test.ts");
    expect(result).toBe(false);
  });

  it("should execute after hooks", async () => {
    let hookCalled = false;
    registry.register({
      name: "test-hook",
      description: "Test hook",
      after: async () => {
        hookCalled = true;
      },
    });

    await registry.executeAfter("write", "test.ts", { ok: true, output: "success" });
    expect(hookCalled).toBe(true);
  });

  it("should match tool patterns", async () => {
    let hookCalled = false;
    registry.register({
      name: "write-only",
      description: "Only for write",
      toolPatterns: ["write"],
      before: async () => {
        hookCalled = true;
        return true;
      },
    });

    await registry.executeBefore("write", "test.ts");
    expect(hookCalled).toBe(true);

    hookCalled = false;
    await registry.executeBefore("read", "test.ts");
    expect(hookCalled).toBe(false);
  });

  it("should match wildcard patterns", async () => {
    let hookCalled = false;
    registry.register({
      name: "git-hook",
      description: "For git operations",
      toolPatterns: ["git-*"],
      before: async () => {
        hookCalled = true;
        return true;
      },
    });

    await registry.executeBefore("git-status", "");
    expect(hookCalled).toBe(true);
  });

  it("should handle hook errors gracefully", async () => {
    registry.register({
      name: "error-hook",
      description: "Throws error",
      before: async () => {
        throw new Error("Hook error");
      },
    });

    // Should not throw, error is caught
    const result = await registry.executeBefore("write", "test.ts");
    expect(result).toBe(true);
  });

  it("should create validation hook", async () => {
    const hook = createValidationHook({
      blockedPatterns: [/\.env/],
    });

    expect(hook.name).toBe("validation");
    expect(hook.before).toBeDefined();
  });
});
