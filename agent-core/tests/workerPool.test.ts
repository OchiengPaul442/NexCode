import { describe, it, expect } from "vitest";
import { WorkerPool } from "../src/agents/workerPool";

describe("WorkerPool", () => {
  it("should create a worker pool", () => {
    const pool = new WorkerPool({
      workspaceRoot: "/tmp/test",
      useWorktrees: false,
    });
    expect(pool).toBeDefined();
  });

  it("should track worker status", () => {
    const pool = new WorkerPool({
      workspaceRoot: "/tmp/test",
      useWorktrees: false,
    });
    const status = pool.getStatus();
    expect(status).toEqual([]);
  });

  it("should cancel all workers", () => {
    const pool = new WorkerPool({
      workspaceRoot: "/tmp/test",
      useWorktrees: false,
    });
    pool.cancelAll();
    const status = pool.getStatus();
    expect(status).toEqual([]);
  });

  it("should emit events", async () => {
    const pool = new WorkerPool({
      workspaceRoot: "/tmp/test",
      useWorktrees: false,
    });
    
    const events: any[] = [];
    pool.on("allCompleted", (event) => {
      events.push(event);
    });
    
    pool.emit("allCompleted", {
      type: "allCompleted",
      workerId: "test",
      message: "test",
      timestamp: Date.now(),
    });
    
    expect(events.length).toBe(1);
    expect(events[0].type).toBe("allCompleted");
  });
});
