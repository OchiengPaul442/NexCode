/**
 * NC-011 regression tests: Steering state machine and session-based routing
 *
 * Verifies:
 * 1. Steering is allowed in planning, running, and verifying states
 * 2. Steering is rejected in queued, waiting-for-user, completed, failed, cancelled states
 * 3. classifyAndRoute routes by session ID, not by first global active task
 * 4. State machine transitions are well-defined
 * 5. Edge cases: multiple sessions, concurrent steering attempts, session mismatch
 */

import { describe, it, expect } from "vitest";
import { TaskQueue, classifyPromptIntent } from "../src/taskQueue";
import { TaskQueueManager } from "../src/taskManager";
import { TaskStatus } from "../src/types";

// ─── Helper: create a task and advance it to a given status ───────────────────

function createAndAdvance(
  queue: TaskQueue,
  prompt: string,
  sessionId: string,
  targetStatus: TaskStatus,
): string {
  const task = queue.createTask(prompt, sessionId);
  if (targetStatus === "queued") return task.id;

  queue.dequeue(); // queued → planning

  if (targetStatus === "planning") return task.id;

  queue.updateStatus(task.id, "running");

  if (targetStatus === "running") return task.id;

  if (targetStatus === "verifying") {
    queue.updateStatus(task.id, "verifying");
    return task.id;
  }

  if (targetStatus === "waiting-for-user") {
    queue.updateStatus(task.id, "waiting-for-user");
    return task.id;
  }

  if (targetStatus === "completed") {
    queue.updateStatus(task.id, "running");
    queue.complete(task.id, "result");
    return task.id;
  }

  if (targetStatus === "failed") {
    queue.updateStatus(task.id, "running");
    queue.fail(task.id, "error");
    return task.id;
  }

  if (targetStatus === "cancelled") {
    queue.cancel(task.id);
    return task.id;
  }

  return task.id;
}

// ─── TaskQueue.steer() — steering eligibility by status ──────────────────────

describe("NC-011: TaskQueue.steer() — steering eligibility by task status", () => {
  it("allows steering on a running task", () => {
    const queue = new TaskQueue();
    const task = queue.createTask("build a widget", "s1");
    queue.dequeue();
    queue.updateStatus(task.id, "running");

    expect(queue.steer(task.id, "actually, make it red")).toBe(true);
  });

  it("allows steering on a planning task", () => {
    const queue = new TaskQueue();
    const task = queue.createTask("build a widget", "s1");
    queue.dequeue(); // → planning

    expect(task.status).toBe("planning");
    expect(queue.steer(task.id, "actually, make it blue")).toBe(true);
  });

  it("allows steering on a verifying task", () => {
    const queue = new TaskQueue();
    const task = queue.createTask("build a widget", "s1");
    queue.dequeue();
    queue.updateStatus(task.id, "running");
    queue.updateStatus(task.id, "verifying");

    expect(task.status).toBe("verifying");
    expect(queue.steer(task.id, "also check the tests")).toBe(true);
  });

  it("rejects steering on a queued task", () => {
    const queue = new TaskQueue();
    const task = queue.createTask("build a widget", "s1");

    expect(task.status).toBe("queued");
    expect(queue.steer(task.id, "change direction")).toBe(false);
  });

  it("rejects steering on a waiting-for-user task", () => {
    const queue = new TaskQueue();
    const task = queue.createTask("build a widget", "s1");
    queue.dequeue();
    queue.updateStatus(task.id, "running");
    queue.updateStatus(task.id, "waiting-for-user");

    expect(task.status).toBe("waiting-for-user");
    expect(queue.steer(task.id, "approve this")).toBe(false);
  });

  it("rejects steering on a completed task", () => {
    const queue = new TaskQueue();
    const task = queue.createTask("build a widget", "s1");
    queue.dequeue();
    queue.updateStatus(task.id, "running");
    queue.complete(task.id, "done");

    expect(task.status).toBe("completed");
    expect(queue.steer(task.id, "oops, change it")).toBe(false);
  });

  it("rejects steering on a failed task", () => {
    const queue = new TaskQueue();
    const task = queue.createTask("build a widget", "s1");
    queue.dequeue();
    queue.updateStatus(task.id, "running");
    queue.fail(task.id, "error");

    expect(task.status).toBe("failed");
    expect(queue.steer(task.id, "try again")).toBe(false);
  });

  it("rejects steering on a cancelled task", () => {
    const queue = new TaskQueue();
    const task = queue.createTask("build a widget", "s1");
    queue.dequeue();
    queue.updateStatus(task.id, "running");
    queue.cancel(task.id);

    expect(task.status).toBe("cancelled");
    expect(queue.steer(task.id, "nevermind")).toBe(false);
  });

  it("rejects steering on a non-existent task", () => {
    const queue = new TaskQueue();
    expect(queue.steer("task-nonexistent", "change")).toBe(false);
  });

  it("steering message is appended to task.steeringMessages", () => {
    const queue = new TaskQueue();
    const task = queue.createTask("build a widget", "s1");
    queue.dequeue();
    queue.updateStatus(task.id, "running");

    queue.steer(task.id, "first correction");
    queue.steer(task.id, "second correction");

    expect(task.steeringMessages).toEqual([
      "first correction",
      "second correction",
    ]);
  });

  it("steering emits taskSteered event", () => {
    const queue = new TaskQueue();
    const task = queue.createTask("build a widget", "s1");
    queue.dequeue();
    queue.updateStatus(task.id, "running");

    const events: unknown[] = [];
    queue.onEvent((e) => events.push(e));

    queue.steer(task.id, "correction");

    const steerEvents = events.filter((e: any) => e.type === "taskSteered");
    expect(steerEvents).toHaveLength(1);
    expect((steerEvents[0] as any).taskId).toBe(task.id);
    expect((steerEvents[0] as any).message).toBe("correction");
  });
});

// ─── TaskQueue.getActiveTaskBySession() ──────────────────────────────────────

describe("NC-011: TaskQueue.getActiveTaskBySession() — session-based lookup", () => {
  it("returns undefined when no tasks exist", () => {
    const queue = new TaskQueue();
    expect(queue.getActiveTaskBySession("s1")).toBeUndefined();
  });

  it("returns undefined when no active tasks in session", () => {
    const queue = new TaskQueue();
    queue.createTask("task1", "s1");
    expect(queue.getActiveTaskBySession("s1")).toBeUndefined();
  });

  it("returns the active task for the matching session", () => {
    const queue = new TaskQueue();
    const task = queue.createTask("task1", "s1");
    queue.dequeue();
    queue.updateStatus(task.id, "running");

    const found = queue.getActiveTaskBySession("s1");
    expect(found?.id).toBe(task.id);
  });

  it("returns undefined for a different session", () => {
    const queue = new TaskQueue();
    const task = queue.createTask("task1", "s1");
    queue.dequeue();
    queue.updateStatus(task.id, "running");

    expect(queue.getActiveTaskBySession("s2")).toBeUndefined();
  });

  it("returns the first active task when multiple exist in same session", () => {
    const queue = new TaskQueue(2); // allow 2 concurrent
    const task1 = queue.createTask("first", "s1");
    const task2 = queue.createTask("second", "s1");
    queue.dequeue(); // task1 → planning
    queue.updateStatus(task1.id, "running");
    queue.dequeue(); // task2 → planning

    // task1 is running, task2 is planning — both are active
    const found = queue.getActiveTaskBySession("s1");
    // Should return one of them (first found in map iteration)
    expect(found).toBeDefined();
    expect([task1.id, task2.id]).toContain(found!.id);
  });

  it("distinguishes between sessions", () => {
    const queue = new TaskQueue(2);
    const taskA = queue.createTask("session A task", "session-A");
    const taskB = queue.createTask("session B task", "session-B");
    queue.dequeue();
    queue.updateStatus(taskA.id, "running");
    queue.dequeue();
    queue.updateStatus(taskB.id, "running");

    expect(queue.getActiveTaskBySession("session-A")?.id).toBe(taskA.id);
    expect(queue.getActiveTaskBySession("session-B")?.id).toBe(taskB.id);
  });
});

// ─── TaskQueueManager.classifyAndRoute() — session-based routing ─────────────

describe("NC-011: TaskQueueManager.classifyAndRoute() — session-based routing", () => {
  it("steers an active task in the same session", () => {
    const mgr = new TaskQueueManager({ maxConcurrent: 1 });
    const task = mgr.submitTask("build a widget", "s1");
    mgr.startTask(task.id);

    const result = mgr.classifyAndRoute(task.id, "actually, make it red", "s1");

    expect(result.action).toBe("steer");
    expect(result.task.id).toBe(task.id);
  });

  it("queues a new task when no active task in session", () => {
    const mgr = new TaskQueueManager({ maxConcurrent: 1 });

    const result = mgr.classifyAndRoute(undefined, "build a widget", "s1");

    expect(result.action).toBe("queue");
  });

  it("routes to the correct session's active task, not the first global one", () => {
    const mgr = new TaskQueueManager({ maxConcurrent: 2 });

    // Session A has an active task
    const taskA = mgr.submitTask("build a red widget", "session-A");
    mgr.startTask(taskA.id);

    // Session B has a different active task
    const taskB = mgr.submitTask("build a blue widget", "session-B");
    mgr.startTask(taskB.id);

    // A steering message for session A should target taskA
    const result = mgr.classifyAndRoute(
      undefined,
      "actually, make it green",
      "session-A",
    );

    expect(result.action).toBe("steer");
    expect(result.task.id).toBe(taskA.id);
  });

  it("steers a task in planning state", () => {
    const mgr = new TaskQueueManager({ maxConcurrent: 1 });
    const task = mgr.submitTask("build a widget", "s1");
    // Dequeue moves the task from queued → planning
    mgr.getNextQueuedTask();

    const result = mgr.classifyAndRoute(task.id, "actually, make it red", "s1");

    expect(result.action).toBe("steer");
    expect(result.task.id).toBe(task.id);
  });

  it("steers a task in verifying state", () => {
    const mgr = new TaskQueueManager({ maxConcurrent: 1 });
    const task = mgr.submitTask("build a widget", "s1");
    mgr.startTask(task.id);

    // Move to verifying via the underlying queue
    const queueTask = mgr.getTask(task.id);
    if (queueTask) {
      queueTask.status = "verifying";
    }

    const result = mgr.classifyAndRoute(task.id, "also check tests", "s1");

    expect(result.action).toBe("steer");
    expect(result.task.id).toBe(task.id);
  });

  it("queues a new task when steering intent is not detected", () => {
    const mgr = new TaskQueueManager({ maxConcurrent: 2 });
    const task = mgr.submitTask("build a widget", "s1");
    mgr.startTask(task.id);

    // This is a new task, not a steering message
    const result = mgr.classifyAndRoute(
      task.id,
      "create a REST API for user management with authentication",
      "s1",
    );

    expect(result.action).toBe("queue");
  });

  it("queues a new task when active task is in a terminal state", () => {
    const mgr = new TaskQueueManager({ maxConcurrent: 1 });
    const task = mgr.submitTask("build a widget", "s1");
    mgr.startTask(task.id);
    mgr.completeTask(task.id, "done");

    const result = mgr.classifyAndRoute(task.id, "actually, change it", "s1");

    expect(result.action).toBe("queue");
  });

  it("falls back to explicit activeTaskId for backward compatibility", () => {
    const mgr = new TaskQueueManager({ maxConcurrent: 2 });

    // Session A has an active task
    const taskA = mgr.submitTask("build a widget", "session-A");
    mgr.startTask(taskA.id);

    // Caller explicitly passes taskA.id as activeTaskId
    const result = mgr.classifyAndRoute(
      taskA.id,
      "actually, make it red",
      "session-B", // different session, but explicit ID wins
    );

    expect(result.action).toBe("steer");
    expect(result.task.id).toBe(taskA.id);
  });
});

// ─── classifyPromptIntent — steering vs new-task classification ──────────────

describe("NC-011: classifyPromptIntent — steering vs new-task classification", () => {
  it("classifies short corrections as steering", () => {
    expect(classifyPromptIntent("build a widget", "actually, make it red")).toBe(
      "steering",
    );
  });

  it("classifies 'no' as steering", () => {
    expect(classifyPromptIntent("build a widget", "no, that's wrong")).toBe(
      "steering",
    );
  });

  it("classifies 'stop' as steering", () => {
    expect(classifyPromptIntent("build a widget", "stop and reconsider")).toBe(
      "steering",
    );
  });

  it("classifies 'use X instead' as steering", () => {
    expect(
      classifyPromptIntent("build a widget", "use TypeScript instead"),
    ).toBe("steering");
  });

  it("classifies long new-task prompts as new-task", () => {
    expect(
      classifyPromptIntent(
        "build a widget",
        "create a complete REST API for user management with authentication, authorization, and rate limiting",
      ),
    ).toBe("new-task");
  });

  it("classifies 'fix the bug in the login handler' as new-task", () => {
    expect(
      classifyPromptIntent("build a widget", "fix the bug in the login handler"),
    ).toBe("new-task");
  });
});

// ─── Transition matrix — all legal state transitions ─────────────────────────

describe("NC-011: Task state transition matrix", () => {
  const STEERING_ELIGIBLE: TaskStatus[] = ["planning", "running", "verifying"];
  const NON_STEERING: TaskStatus[] = [
    "queued",
    "waiting-for-user",
    "completed",
    "failed",
    "cancelled",
  ];

  it.each(STEERING_ELIGIBLE)("steering is allowed in '%s' state", (status) => {
    const queue = new TaskQueue();
    const task = queue.createTask("test", "s1");

    // Advance to the target status
    if (status !== "queued") {
      queue.dequeue(); // → planning
    }
    if (status === "running" || status === "verifying") {
      queue.updateStatus(task.id, "running");
    }
    if (status === "verifying") {
      queue.updateStatus(task.id, "verifying");
    }

    expect(task.status).toBe(status);
    expect(queue.steer(task.id, "correction")).toBe(true);
  });

  it.each(NON_STEERING)(
    "steering is rejected in '%s' state",
    (status) => {
      const queue = new TaskQueue();
      const task = queue.createTask("test", "s1");

      // Advance to the target status
      if (status !== "queued") {
        queue.dequeue(); // → planning
      }
      if (
        status === "running" ||
        status === "waiting-for-user" ||
        status === "completed" ||
        status === "failed"
      ) {
        queue.updateStatus(task.id, "running");
      }
      if (status === "verifying") {
        queue.updateStatus(task.id, "verifying");
      }
      if (status === "waiting-for-user") {
        queue.updateStatus(task.id, "waiting-for-user");
      }
      if (status === "completed") {
        queue.complete(task.id, "done");
      }
      if (status === "failed") {
        queue.fail(task.id, "error");
      }
      if (status === "cancelled") {
        queue.cancel(task.id);
      }

      expect(task.status).toBe(status);
      expect(queue.steer(task.id, "correction")).toBe(false);
    },
  );
});
