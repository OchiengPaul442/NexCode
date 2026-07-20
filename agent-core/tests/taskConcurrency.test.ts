import { describe, it, expect } from "vitest";
import { TaskQueue } from "../src/taskQueue";
import { TaskQueueManager } from "../src/taskManager";

describe("NC-010: Task concurrency limit (max 1)", () => {
  describe("TaskQueue default concurrency", () => {
    it("default maxConcurrent is 1", () => {
      const queue = new TaskQueue();
      // Submit two tasks
      queue.createTask("first", "session-1");
      queue.createTask("second", "session-2");

      // Only one should be dequeueable
      const first = queue.dequeue();
      expect(first).toBeDefined();

      // Second dequeue should return undefined (at limit)
      const second = queue.dequeue();
      expect(second).toBeUndefined();
    });

    it("dequeue returns undefined when one task is already active", () => {
      const queue = new TaskQueue();
      queue.createTask("task-a", "session-1");
      queue.createTask("task-b", "session-1");

      const dequeued = queue.dequeue();
      expect(dequeued).toBeDefined();
      expect(dequeued!.prompt).toBe("task-a");

      // Second dequeue blocked
      expect(queue.dequeue()).toBeUndefined();
    });

    it("canAcceptNewTask returns false when at limit", () => {
      const queue = new TaskQueue();
      queue.createTask("task-a", "session-1");
      queue.dequeue(); // now active

      expect(queue.canAcceptNewTask()).toBe(false);
    });

    it("canAcceptNewTask returns true when no active tasks", () => {
      const queue = new TaskQueue();
      expect(queue.canAcceptNewTask()).toBe(true);
    });

    it("canAcceptNewTask returns true after active task completes", () => {
      const queue = new TaskQueue();
      queue.createTask("task-a", "session-1");
      const item = queue.dequeue()!;
      queue.complete(item.taskId, "done");

      expect(queue.canAcceptNewTask()).toBe(true);
      // Can now dequeue a second task
      queue.createTask("task-b", "session-1");
      const second = queue.dequeue();
      expect(second).toBeDefined();
      expect(second!.prompt).toBe("task-b");
    });

    it("getActiveCount returns at most 1", () => {
      const queue = new TaskQueue();
      queue.createTask("a", "s1");
      queue.createTask("b", "s1");
      queue.createTask("c", "s1");

      queue.dequeue(); // a becomes active
      expect(queue.getActiveCount()).toBe(1);

      // b and c are still queued, not active
      expect(queue.getPendingCount()).toBe(2);
    });

    it("queued tasks wait behind active task", () => {
      const queue = new TaskQueue();
      queue.createTask("first", "s1");
      queue.createTask("second", "s1");
      queue.createTask("third", "s1");

      const item1 = queue.dequeue()!;
      expect(item1.prompt).toBe("first");

      // Second and third are still queued
      expect(queue.getPendingCount()).toBe(2);
      expect(queue.getActiveCount()).toBe(1);

      // Complete first
      queue.complete(item1.taskId, "done");

      // Now second can be dequeued
      const item2 = queue.dequeue()!;
      expect(item2.prompt).toBe("second");

      expect(queue.getPendingCount()).toBe(1);
      expect(queue.getActiveCount()).toBe(1);
    });
  });

  describe("TaskQueue with explicit maxConcurrent=1", () => {
    it("explicit maxConcurrent=1 behaves same as default", () => {
      const queue = new TaskQueue(1);
      queue.createTask("a", "s1");
      queue.createTask("b", "s1");

      expect(queue.dequeue()).toBeDefined();
      expect(queue.dequeue()).toBeUndefined();
    });
  });

  describe("TaskQueue with higher maxConcurrent (for future flexibility)", () => {
    it("maxConcurrent=3 allows 3 concurrent tasks", () => {
      const queue = new TaskQueue(3);
      queue.createTask("a", "s1");
      queue.createTask("b", "s1");
      queue.createTask("c", "s1");
      queue.createTask("d", "s1");

      expect(queue.dequeue()).toBeDefined(); // a
      expect(queue.dequeue()).toBeDefined(); // b
      expect(queue.dequeue()).toBeDefined(); // c
      expect(queue.dequeue()).toBeUndefined(); // d blocked
    });
  });

  describe("TaskQueueManager default concurrency", () => {
    it("default maxConcurrent is 1", () => {
      const manager = new TaskQueueManager();
      manager.submitTask("first", "session-1");
      manager.submitTask("second", "session-2");

      // Only one can be dequeued
      const first = manager.getNextQueuedTask();
      expect(first).toBeDefined();
      expect(first!.request.prompt).toBe("first");

      const second = manager.getNextQueuedTask();
      expect(second).toBeUndefined();
    });

    it("canAcceptNewTask reflects limit", () => {
      const manager = new TaskQueueManager();
      manager.submitTask("task-a", "s1");
      manager.getNextQueuedTask(); // dequeue

      expect(manager.canAcceptNewTask()).toBe(false);
      expect(manager.getActiveCount()).toBe(1);
    });

    it("can accept new task after completion", () => {
      const manager = new TaskQueueManager();
      manager.submitTask("task-a", "s1");
      const { task } = manager.getNextQueuedTask()!;
      manager.completeTask(task.id, "done");

      expect(manager.canAcceptNewTask()).toBe(true);
    });
  });

  describe("Concurrency safety properties", () => {
    it("no two tasks can be active simultaneously with default concurrency", () => {
      const queue = new TaskQueue();
      queue.createTask("a", "s1");
      queue.createTask("b", "s1");
      queue.createTask("c", "s1");
      queue.createTask("d", "s1");
      queue.createTask("e", "s1");

      let activeCount = 0;
      let maxObserved = 0;

      for (let i = 0; i < 5; i++) {
        const item = queue.dequeue();
        if (item) {
          activeCount++;
          maxObserved = Math.max(maxObserved, activeCount);
          // Simulate some being active at same time
          if (i === 0) {
            // Complete first before dequeuing more
            queue.complete(item.taskId, "done");
            activeCount--;
          }
        }
      }

      expect(maxObserved).toBeLessThanOrEqual(1);
    });

    it("steering works on active tasks (planning/running/verifying), not queued or terminal", () => {
      const queue = new TaskQueue();
      const task1 = queue.createTask("first", "s1");
      const task2 = queue.createTask("second", "s1");

      // task2 is queued, not active — steering rejected
      expect(queue.steer(task2.id, "change direction")).toBe(false);

      // Dequeue task1 → planning — steering allowed
      queue.dequeue();
      expect(task1.status).toBe("planning");
      expect(queue.steer(task1.id, "change direction")).toBe(true);

      // Advance to running — steering still allowed
      queue.updateStatus(task1.id, "running");
      expect(queue.steer(task1.id, "another correction")).toBe(true);

      // Advance to verifying — steering still allowed
      queue.updateStatus(task1.id, "verifying");
      expect(queue.steer(task1.id, "check tests too")).toBe(true);

      // Complete — steering rejected
      queue.updateStatus(task1.id, "running");
      queue.complete(task1.id, "done");
      expect(queue.steer(task1.id, "oops")).toBe(false);
    });
  });

  describe("NC-010 regression: shared orchestrator state races", () => {
    it("two task submissions queue sequentially, not in parallel", () => {
      const queue = new TaskQueue();
      const events: string[] = [];

      queue.onEvent((event) => {
        if (event.type === "queueChanged") {
          events.push(
            `pending=${event.pendingCount},active=${event.activeCount}`,
          );
        }
      });

      queue.createTask("first", "s1");
      queue.createTask("second", "s1");

      // Both queued
      expect(events).toContain("pending=1,active=0");
      expect(events).toContain("pending=2,active=0");

      // Dequeue first
      const item = queue.dequeue()!;
      expect(queue.getActiveCount()).toBe(1);
      expect(queue.getPendingCount()).toBe(1);

      // Complete first
      queue.complete(item.taskId, "done");
      expect(queue.getActiveCount()).toBe(0);
      expect(queue.getPendingCount()).toBe(1);

      // Dequeue second
      const item2 = queue.dequeue()!;
      expect(item2.prompt).toBe("second");
      expect(queue.getActiveCount()).toBe(1);
      expect(queue.getPendingCount()).toBe(0);
    });
  });
});
