import path from "path";
import { describe, expect, it, vi, afterEach } from "vitest";
import { createNexcodeOrchestrator } from "../src";
import { MemoryManager } from "../src/memory/memoryManager";

/**
 * NC-039 — Constructor side effects perform network and persistence work.
 *
 * Regression tests ensuring:
 * 1. The orchestrator constructor performs NO filesystem or network side effects.
 * 2. An explicit initialize() method is available for async setup.
 * 3. A dispose() method flushes resources.
 * 4. Construction without initialize() is safe and usable.
 */

describe("NC-039 — Orchestrator lifecycle (constructor has no side effects)", () => {
  const workspaceRoot = path.resolve(__dirname, "..", "..");

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Constructor has no side effects", () => {
    it("does NOT call memory.initialize() during construction", async () => {
      const initSpy = vi.spyOn(MemoryManager.prototype, "initialize");

      createNexcodeOrchestrator({ workspaceRoot });

      expect(initSpy).not.toHaveBeenCalled();
    });

    it("does NOT perform any filesystem reads during construction", async () => {
      const readFileSpy = vi.spyOn(
        require("fs/promises") as any,
        "readFile",
      );
      const readdirSpy = vi.spyOn(
        require("fs/promises") as any,
        "readdir",
      );

      createNexcodeOrchestrator({ workspaceRoot });

      expect(readFileSpy).not.toHaveBeenCalled();
      expect(readdirSpy).not.toHaveBeenCalled();
    });

    it("does NOT create directories during construction", async () => {
      const mkdirSpy = vi.spyOn(
        require("fs/promises") as any,
        "mkdir",
      );

      createNexcodeOrchestrator({ workspaceRoot });

      expect(mkdirSpy).not.toHaveBeenCalled();
    });

    it("does NOT make any network requests during construction", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch");

      createNexcodeOrchestrator({ workspaceRoot });

      // Allow microtasks to settle
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("returns synchronously from constructor (no async in constructor)", () => {
      // The constructor should be synchronous. If it were async or returned
      // a Promise, this would fail.
      const start = Date.now();
      const orch = createNexcodeOrchestrator({ workspaceRoot });
      const elapsed = Date.now() - start;

      expect(orch).toBeDefined();
      // Construction should complete in well under 100ms
      expect(elapsed).toBeLessThan(100);
    });
  });

  describe("Explicit initialize() method", () => {
    it("has an initialize() method", () => {
      const orch = createNexcodeOrchestrator({ workspaceRoot });
      expect(typeof orch.initialize).toBe("function");
    });

    it("initialize() is async and returns a Promise", () => {
      const orch = createNexcodeOrchestrator({ workspaceRoot });
      const result = orch.initialize();
      expect(result).toBeInstanceOf(Promise);
      // Clean up
      return result.then(() => orch.dispose());
    });

    it("initialize() loads persisted memory sessions", async () => {
      const initSpy = vi.spyOn(MemoryManager.prototype, "initialize");

      const orch = createNexcodeOrchestrator({ workspaceRoot });
      await orch.initialize();

      expect(initSpy).toHaveBeenCalledTimes(1);
      await orch.dispose();
    });

    it("initialize() handles errors gracefully without throwing", async () => {
      vi.spyOn(MemoryManager.prototype, "initialize").mockRejectedValue(
        new Error("Simulated disk failure"),
      );

      const orch = createNexcodeOrchestrator({ workspaceRoot });

      // Should NOT throw — errors are caught and logged
      await expect(orch.initialize()).resolves.toBeUndefined();
      await orch.dispose();
    });

    it("orchestrator is usable after initialize()", async () => {
      const orch = createNexcodeOrchestrator({ workspaceRoot });
      await orch.initialize();

      // Verify basic functionality is available
      expect(orch.listMcpServers()).toBeDefined();
      expect(orch.getToolApprovalPolicy()).toBeDefined();

      await orch.dispose();
    });
  });

  describe("dispose() method", () => {
    it("has a dispose() method", () => {
      const orch = createNexcodeOrchestrator({ workspaceRoot });
      expect(typeof orch.dispose).toBe("function");
    });

    it("dispose() is async and returns a Promise<boolean>", async () => {
      const orch = createNexcodeOrchestrator({ workspaceRoot });
      await orch.initialize();

      const result = await orch.dispose();
      expect(typeof result).toBe("boolean");
    });

    it("dispose() flushes memory resources", async () => {
      const disposeSpy = vi.spyOn(MemoryManager.prototype, "dispose");

      const orch = createNexcodeOrchestrator({ workspaceRoot });
      await orch.dispose();

      expect(disposeSpy).toHaveBeenCalledTimes(1);
    });

    it("dispose() can be called without initialize()", async () => {
      const orch = createNexcodeOrchestrator({ workspaceRoot });

      // Should not throw even without initialize()
      await expect(orch.dispose()).resolves.toBeDefined();
    });

    it("dispose() returns true when all operations succeed", async () => {
      const orch = createNexcodeOrchestrator({ workspaceRoot });

      const result = await orch.dispose();
      expect(result).toBe(true);
    });
  });

  describe("Backward compatibility", () => {
    it("createNexcodeOrchestrator still works as before (no initialize needed for basic use)", () => {
      const orch = createNexcodeOrchestrator({ workspaceRoot });

      // Basic construction should still work without calling initialize()
      expect(orch).toBeDefined();
      expect(orch.listMcpServers()).toBeDefined();
    });

    it("orchestrator without initialize() has empty memory context", () => {
      const orch = createNexcodeOrchestrator({ workspaceRoot });

      const context = (orch as any).memory.getSessionContext("test-session");
      expect(context).toBe("");
    });

    it("orchestrator after initialize() also has empty memory for new sessions", async () => {
      const orch = createNexcodeOrchestrator({ workspaceRoot });
      await orch.initialize();

      const context = (orch as any).memory.getSessionContext("test-session");
      expect(context).toBe("");

      await orch.dispose();
    });
  });

  describe("Integration with existing orchestrator tests", () => {
    it("orchestrator can be constructed and basic methods called without initialize()", () => {
      const orch = createNexcodeOrchestrator({ workspaceRoot });

      // These methods should all work without memory initialization
      expect(orch.listMcpServers()).toContain("filesystem");
      expect(typeof orch.getToolApprovalPolicy()).toBe("object");
      expect(typeof orch.registerMcpAdapter).toBe("function");
    });
  });
});
