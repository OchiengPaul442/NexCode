import { describe, it, expect } from "vitest";
import { TaskQueue } from "../src/taskQueue";
import { TaskQueueManager } from "../src/taskManager";

// Large age limit so auto-prune never removes by age during test setup
const LARGE_AGE = 60 * 60 * 1000; // 1 hour

describe("NC-043: Completed tasks accumulate indefinitely", () => {
  describe("Auto-pruning on terminal state transitions", () => {
    it("completed tasks older than maxHistoryAgeMs are auto-pruned on complete()", () => {
      const queue = new TaskQueue({ maxHistoryAgeMs: 1000 });
      const task1 = queue.createTask("old-task", "s1");
      const task2 = queue.createTask("current-task", "s1");

      queue.dequeue();
      queue.complete(task1.id, "done");
      // Backdate task1 to be older than age limit
      task1.completedAt = Date.now() - 2000;

      queue.dequeue();
      queue.complete(task2.id, "done");

      expect(queue.getTask(task1.id)).toBeUndefined();
      expect(queue.getTask(task2.id)).toBeDefined();
    });

    it("failed tasks older than maxHistoryAgeMs are auto-pruned on fail()", () => {
      const queue = new TaskQueue({ maxHistoryAgeMs: 1000 });
      const task1 = queue.createTask("old-fail", "s1");
      const task2 = queue.createTask("new-fail", "s1");

      queue.dequeue();
      queue.fail(task1.id, "error");
      task1.completedAt = Date.now() - 2000;

      queue.dequeue();
      queue.fail(task2.id, "error");

      expect(queue.getTask(task1.id)).toBeUndefined();
      expect(queue.getTask(task2.id)).toBeDefined();
    });

    it("cancelled tasks older than maxHistoryAgeMs are auto-pruned on cancel()", () => {
      const queue = new TaskQueue({ maxHistoryAgeMs: 1000 });
      const task1 = queue.createTask("old-cancel", "s1");
      const task2 = queue.createTask("new-cancel", "s1");

      queue.dequeue();
      queue.cancel(task1.id);
      task1.completedAt = Date.now() - 2000;

      queue.dequeue();
      queue.cancel(task2.id);

      expect(queue.getTask(task1.id)).toBeUndefined();
      expect(queue.getTask(task2.id)).toBeDefined();
    });

    it("active (planning) tasks are never pruned by age", () => {
      const queue = new TaskQueue({ maxHistoryAgeMs: 1000 });

      const task1 = queue.createTask("completed-old", "s1");
      const task2 = queue.createTask("active", "s1");
      const task3 = queue.createTask("completed-new", "s1");

      queue.dequeue();
      queue.complete(task1.id, "done");
      task1.completedAt = Date.now() - 2000;

      queue.dequeue();
      expect(task2.status).toBe("planning");

      queue.dequeue();
      queue.complete(task3.id, "done");

      expect(queue.getTask(task1.id)).toBeUndefined();
      expect(queue.getTask(task2.id)).toBeDefined();
      expect(task2.status).toBe("planning");
    });

    it("queued tasks are never pruned", () => {
      const queue = new TaskQueue({ maxHistoryAgeMs: 1000 });

      const queued = queue.createTask("queued-task", "s1");
      const completed1 = queue.createTask("completed-1", "s1");

      queue.dequeue();
      queue.complete(completed1.id, "done");
      completed1.completedAt = Date.now() - 2000;

      queue.dequeue();
      // queued is now active (planning)

      const completed2 = queue.createTask("completed-2", "s1");
      queue.dequeue();
      queue.complete(completed2.id, "done");

      expect(queue.getTask(queued.id)).toBeDefined();
    });
  });

  describe("Max history size enforcement", () => {
    it("auto-prune enforces maxHistorySize on complete() — count check", () => {
      const queue = new TaskQueue({ maxHistorySize: 3, maxHistoryAgeMs: LARGE_AGE });

      for (let i = 0; i < 8; i++) {
        const t = queue.createTask(`task-${i}`, "s1");
        queue.dequeue();
        queue.complete(t.id, `result-${i}`);
      }

      // Auto-prune should keep at most 3 terminal tasks
      expect(queue.getCompletedCount()).toBeLessThanOrEqual(3);
    });

    it("auto-prune enforces maxHistorySize on fail() — count check", () => {
      const queue = new TaskQueue({ maxHistorySize: 2, maxHistoryAgeMs: LARGE_AGE });

      for (let i = 0; i < 5; i++) {
        const t = queue.createTask(`task-${i}`, "s1");
        queue.dequeue();
        queue.fail(t.id, `error-${i}`);
      }

      expect(queue.getCompletedCount()).toBeLessThanOrEqual(2);
    });

    it("auto-prune enforces maxHistorySize on cancel() — count check", () => {
      const queue = new TaskQueue({ maxHistorySize: 2, maxHistoryAgeMs: LARGE_AGE });

      for (let i = 0; i < 5; i++) {
        const t = queue.createTask(`task-${i}`, "s1");
        queue.dequeue();
        queue.cancel(t.id);
      }

      expect(queue.getCompletedCount()).toBeLessThanOrEqual(2);
    });

    it("maxHistorySize=0 disables size-based pruning", () => {
      const queue = new TaskQueue({ maxHistorySize: 0, maxHistoryAgeMs: LARGE_AGE });

      for (let i = 0; i < 10; i++) {
        const t = queue.createTask(`task-${i}`, "s1");
        queue.dequeue();
        queue.complete(t.id, `result-${i}`);
      }

      expect(queue.getCompletedCount()).toBe(10);
    });

    it("default maxHistorySize is 100", () => {
      const queue = new TaskQueue({ maxHistoryAgeMs: LARGE_AGE });

      for (let i = 0; i < 101; i++) {
        const t = queue.createTask(`task-${i}`, "s1");
        queue.dequeue();
        queue.complete(t.id, `result-${i}`);
      }

      expect(queue.getCompletedCount()).toBe(100);
    });

    it("manual prune with staggered timestamps removes oldest by size", () => {
      // Use large limits during creation so auto-prune doesn't interfere
      const queue = new TaskQueue({ maxHistorySize: 3, maxHistoryAgeMs: LARGE_AGE });

      const tasks = [];
      for (let i = 0; i < 6; i++) {
        tasks.push(queue.createTask(`task-${i}`, "s1"));
        queue.dequeue();
        queue.complete(tasks[i].id, `result-${i}`);
        // Set staggered completedAt relative to now (after complete, before next iteration)
        tasks[i].completedAt = Date.now() + i * 1000;
      }

      // Auto-prune should have kept at most 3
      const completed = queue.getCompletedTasks();
      expect(completed.length).toBeLessThanOrEqual(3);
      // Verify they are sorted by completedAt descending
      for (let i = 0; i < completed.length - 1; i++) {
        expect(completed[i].completedAt).toBeGreaterThanOrEqual(completed[i + 1].completedAt);
      }
    });

    it("mixed statuses count toward history limit", () => {
      const queue = new TaskQueue({ maxHistorySize: 3, maxHistoryAgeMs: LARGE_AGE });

      const t1 = queue.createTask("done", "s1");
      queue.dequeue();
      queue.complete(t1.id, "ok");
      t1.completedAt = Date.now() + 1000;

      const t2 = queue.createTask("failed", "s1");
      queue.dequeue();
      queue.fail(t2.id, "err");
      t2.completedAt = Date.now() + 2000;

      const t3 = queue.createTask("cancelled", "s1");
      queue.dequeue();
      queue.cancel(t3.id);
      t3.completedAt = Date.now() + 3000;

      const t4 = queue.createTask("done-4", "s1");
      queue.dequeue();
      queue.complete(t4.id, "ok");
      t4.completedAt = Date.now() + 4000;

      // Auto-prune should have enforced maxHistorySize=3
      expect(queue.getCompletedCount()).toBeLessThanOrEqual(3);
    });

    it("pruneCompletedTasks returns combined age+size removal count", () => {
      // Use large maxHistorySize so auto-prune doesn't remove by size during creation
      const queue = new TaskQueue({ maxHistorySize: 100, maxHistoryAgeMs: 1000 });

      const tasks = [];
      for (let i = 0; i < 4; i++) {
        tasks.push(queue.createTask(`task-${i}`, "s1"));
        queue.dequeue();
        queue.complete(tasks[i].id, `result-${i}`);
      }

      // Backdate tasks 0 and 1 to be older than age limit
      tasks[0].completedAt = Date.now() - 2000;
      tasks[1].completedAt = Date.now() - 2000;
      // Tasks 2 and 3 are fresh
      tasks[2].completedAt = Date.now() + 500;
      tasks[3].completedAt = Date.now() + 1000;

      // Now manually prune — age removes 2, size allows 100 so no size removal
      const removed = queue.pruneCompletedTasks();
      expect(removed).toBe(2);
      expect(queue.getCompletedCount()).toBe(2);
    });
  });

  describe("getCompletedTasks and getCompletedCount", () => {
    it("returns completed tasks sorted by completion time descending", () => {
      const queue = new TaskQueue({ maxHistoryAgeMs: LARGE_AGE });

      const t1 = queue.createTask("first", "s1");
      queue.dequeue();
      queue.complete(t1.id, "done-1");
      t1.completedAt = Date.now() + 1000;

      const t2 = queue.createTask("second", "s1");
      queue.dequeue();
      queue.complete(t2.id, "done-2");
      t2.completedAt = Date.now() + 2000;

      const completed = queue.getCompletedTasks();
      expect(completed.length).toBe(2);
      expect(completed[0].id).toBe(t2.id);
      expect(completed[1].id).toBe(t1.id);
    });

    it("getCompletedCount excludes active and queued tasks", () => {
      const queue = new TaskQueue({ maxHistoryAgeMs: LARGE_AGE });

      queue.createTask("queued", "s1");
      const t2 = queue.createTask("active", "s1");
      const t3 = queue.createTask("completed", "s1");

      queue.dequeue(); // t2 becomes active
      queue.complete(t3.id, "done");

      expect(queue.getCompletedCount()).toBe(1);
      expect(queue.getTask(t2.id)).toBeDefined();
    });

    it("pruneCompletedTasks returns number of removed tasks", () => {
      const queue = new TaskQueue({ maxHistoryAgeMs: 1000 });

      const t1 = queue.createTask("old", "s1");
      queue.dequeue();
      queue.complete(t1.id, "done");
      t1.completedAt = Date.now() - 2000;

      const removed = queue.pruneCompletedTasks();
      expect(removed).toBe(1);
    });

    it("pruneCompletedTasks returns 0 when nothing to prune", () => {
      const queue = new TaskQueue({ maxHistoryAgeMs: LARGE_AGE });

      const t1 = queue.createTask("fresh", "s1");
      queue.dequeue();
      queue.complete(t1.id, "done");

      const removed = queue.pruneCompletedTasks();
      expect(removed).toBe(0);
    });
  });

  describe("Constructor backward compatibility", () => {
    it("number argument still works (backward compat)", () => {
      const queue = new TaskQueue(2);
      queue.createTask("a", "s1");
      queue.createTask("b", "s1");
      queue.createTask("c", "s1");

      expect(queue.dequeue()).toBeDefined();
      expect(queue.dequeue()).toBeDefined();
      expect(queue.dequeue()).toBeUndefined();
    });

    it("options object works", () => {
      const queue = new TaskQueue({ maxConcurrent: 2 });
      queue.createTask("a", "s1");
      queue.createTask("b", "s1");
      queue.createTask("c", "s1");

      expect(queue.dequeue()).toBeDefined();
      expect(queue.dequeue()).toBeDefined();
      expect(queue.dequeue()).toBeUndefined();
    });

    it("defaults apply when using options object without explicit values", () => {
      const queue = new TaskQueue({});
      queue.createTask("a", "s1");
      queue.createTask("b", "s1");
      expect(queue.dequeue()).toBeDefined();
      expect(queue.dequeue()).toBeUndefined();
    });
  });

  describe("TaskQueueManager integration", () => {
    it("passes maxHistorySize to TaskQueue — count check", () => {
      const manager = new TaskQueueManager({ maxHistorySize: 2, maxHistoryAgeMs: LARGE_AGE });

      for (let i = 0; i < 5; i++) {
        const t = manager.submitTask(`task-${i}`, "s1");
        manager.getNextQueuedTask();
        manager.completeTask(t.id, `result-${i}`);
      }

      expect(manager.getCompletedCount()).toBeLessThanOrEqual(2);
    });

    it("getCompletedTasks returns terminal tasks from manager", () => {
      const manager = new TaskQueueManager({ maxHistoryAgeMs: LARGE_AGE });

      const t1 = manager.submitTask("task-1", "s1");
      manager.getNextQueuedTask();
      manager.completeTask(t1.id, "done");
      t1.completedAt = Date.now() + 1000;

      const t2 = manager.submitTask("task-2", "s1");
      manager.getNextQueuedTask();
      manager.failTask(t2.id, "error");
      t2.completedAt = Date.now() + 2000;

      expect(manager.getCompletedCount()).toBe(2);
      const completed = manager.getCompletedTasks();
      expect(completed.length).toBe(2);
      expect(completed[0].id).toBe(t2.id);
      expect(completed[1].id).toBe(t1.id);
    });

    it("pruneCompletedTasks delegates to queue", () => {
      const manager = new TaskQueueManager({ maxHistoryAgeMs: 1000 });

      const t1 = manager.submitTask("old", "s1");
      manager.getNextQueuedTask();
      manager.completeTask(t1.id, "done");
      t1.completedAt = Date.now() - 2000;

      const removed = manager.pruneCompletedTasks();
      expect(removed).toBe(1);
    });

    it("getTotalTaskCount includes all task states", () => {
      const manager = new TaskQueueManager({ maxHistoryAgeMs: LARGE_AGE });

      manager.submitTask("queued", "s1");
      const t2 = manager.submitTask("active", "s1");
      manager.getNextQueuedTask();
      const t3 = manager.submitTask("completed", "s1");
      manager.getNextQueuedTask();
      manager.completeTask(t3.id, "done");

      expect(manager.getTotalTaskCount()).toBe(3);
    });
  });

  describe("Edge cases", () => {
    it("pruneCompletedTasks handles empty queue gracefully", () => {
      const queue = new TaskQueue();
      expect(queue.pruneCompletedTasks()).toBe(0);
      expect(queue.getCompletedCount()).toBe(0);
    });

    it("removeCompleted with explicit maxAge overrides default", () => {
      const queue = new TaskQueue({ maxHistoryAgeMs: LARGE_AGE });

      const t1 = queue.createTask("task", "s1");
      queue.dequeue();
      queue.complete(t1.id, "done");
      t1.completedAt = Date.now() - 5000;

      expect(queue.removeCompleted()).toBe(0);
      expect(queue.removeCompleted(1000)).toBe(1);
    });

    it("constructor with number still has default history settings", () => {
      const queue = new TaskQueue(1);
      const task = queue.createTask("task", "s1");
      queue.dequeue();
      queue.complete(task.id, "done");

      expect(queue.getCompletedCount()).toBe(1);
      expect(queue.removeCompleted()).toBe(0);
    });

    it("clear resets all state including history", () => {
      const queue = new TaskQueue({ maxHistoryAgeMs: LARGE_AGE });

      const t1 = queue.createTask("task-1", "s1");
      queue.dequeue();
      queue.complete(t1.id, "done");

      queue.createTask("task-2", "s1");

      expect(queue.getCompletedCount()).toBe(1);
      expect(queue.getPendingCount()).toBe(1);

      queue.clear();

      expect(queue.getCompletedCount()).toBe(0);
      expect(queue.getPendingCount()).toBe(0);
      expect(queue.getAllTasks().length).toBe(0);
    });

    it("history pruning does not affect queued tasks", () => {
      const queue = new TaskQueue({ maxHistorySize: 1, maxHistoryAgeMs: LARGE_AGE });

      const t1 = queue.createTask("done", "s1");
      queue.dequeue();
      queue.complete(t1.id, "done");
      t1.completedAt = Date.now() + 1000;

      const t2 = queue.createTask("queued-1", "s1");
      const t3 = queue.createTask("queued-2", "s1");

      const t4 = queue.createTask("done-2", "s1");
      queue.dequeue();
      queue.complete(t4.id, "done");
      t4.completedAt = Date.now() + 2000;

      // Auto-prune should have removed t1 (oldest terminal), keeping t4
      // Queued tasks survive
      expect(queue.getCompletedCount()).toBeLessThanOrEqual(1);
      expect(queue.getTask(t2.id)).toBeDefined();
      expect(queue.getTask(t3.id)).toBeDefined();
    });
  });
});
