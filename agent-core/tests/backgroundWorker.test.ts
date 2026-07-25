import { describe, it, expect } from "vitest";
import { BackgroundWorker } from "../src/agents/backgroundWorker";

describe("BackgroundWorker", () => {
  it("should create a background worker", () => {
    const worker = new BackgroundWorker({
      id: "test-worker",
      objective: "Test task",
      workspaceRoot: "/tmp/test",
      timeoutMs: 5000,
    });
    expect(worker).toBeDefined();
  });

  it("should have initial state idle", () => {
    const worker = new BackgroundWorker({
      id: "test-worker",
      objective: "Test task",
      workspaceRoot: "/tmp/test",
    });
    expect(worker.getState()).toBe("idle");
  });

  it("should track progress", () => {
    const worker = new BackgroundWorker({
      id: "test-worker",
      objective: "Test task",
      workspaceRoot: "/tmp/test",
    });
    const progress = worker.getProgress();
    expect(progress.state).toBe("idle");
    expect(progress.toolCalls).toBe(0);
    expect(progress.filesModified).toEqual([]);
    expect(progress.retryCount).toBe(0);
  });

  it("should not cancel when idle", () => {
    const worker = new BackgroundWorker({
      id: "test-worker",
      objective: "Test task",
      workspaceRoot: "/tmp/test",
    });
    worker.cancel();
    // Cancel should not change state from idle
    expect(worker.getState()).toBe("idle");
  });

  it("should emit state changes", async () => {
    const worker = new BackgroundWorker({
      id: "test-worker",
      objective: "Test task",
      workspaceRoot: "/tmp/test",
    });
    
    const stateChanges: string[] = [];
    worker.on("stateChanged", (event) => {
      stateChanges.push(event.state);
    });
    
    // Emit events
    worker.emit("stateChanged", { state: "running", workerId: "test-worker" });
    worker.emit("stateChanged", { state: "completed", workerId: "test-worker" });
    
    expect(stateChanges).toEqual(["running", "completed"]);
  });

  it("should emit progress events", async () => {
    const worker = new BackgroundWorker({
      id: "test-worker",
      objective: "Test task",
      workspaceRoot: "/tmp/test",
    });
    
    const progressEvents: any[] = [];
    worker.on("progress", (event) => {
      progressEvents.push(event);
    });
    
    worker.emit("progress", { toolCalls: 1, filesModified: [], lastTool: "read" });
    
    expect(progressEvents.length).toBe(1);
    expect(progressEvents[0].toolCalls).toBe(1);
  });
});
