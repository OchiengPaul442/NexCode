import { randomUUID } from "crypto";
import {
  Task,
  TaskStatus,
  TaskQueueItem,
  TaskEvent,
  AgentMode,
  ProviderId,
  ReasoningEffort,
  OrchestratorRequest,
  RequestAttachment,
} from "./types";

const MAX_CONCURRENT_TASKS = 3;

export class TaskQueue {
  private tasks = new Map<string, Task>();
  private queue: TaskQueueItem[] = [];
  private listeners: Array<(event: TaskEvent) => void> = [];
  private maxConcurrent: number;

  constructor(maxConcurrent: number = MAX_CONCURRENT_TASKS) {
    this.maxConcurrent = maxConcurrent;
  }

  onEvent(listener: (event: TaskEvent) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  private emit(event: TaskEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // listener error should not break the queue
      }
    }
  }

  createTask(
    prompt: string,
    sessionId: string,
    options: {
      mode?: AgentMode;
      provider?: ProviderId;
      model?: string;
      temperature?: number;
      reasoningEffort?: ReasoningEffort;
      allowWebSearch?: boolean;
      attachmentIds?: string[];
      attachments?: RequestAttachment[];
    } = {},
  ): Task {
    const taskId = `task-${randomUUID().slice(0, 8)}`;
    const task: Task = {
      id: taskId,
      sessionId,
      prompt,
      status: "queued",
      mode: options.mode ?? "coder",
      provider: options.provider ?? "ollama",
      model: options.model ?? "qwen2.5-coder:14b",
      createdAt: Date.now(),
      steeringMessages: [],
    };

    this.tasks.set(taskId, task);

    const queueItem: TaskQueueItem = {
      taskId,
      prompt,
      sessionId,
      provider: task.provider,
      model: task.model,
      mode: task.mode,
      temperature: options.temperature ?? 0.2,
      reasoningEffort: options.reasoningEffort,
      allowWebSearch: options.allowWebSearch ?? true,
      attachmentIds: options.attachmentIds ?? [],
      createdAt: task.createdAt,
    };

    this.queue.push(queueItem);
    this.emit({ type: "taskQueued", task });
    this.emit({
      type: "queueChanged",
      pendingCount: this.queue.length,
      activeCount: this.getActiveTasks().length,
    });

    return task;
  }

  steer(taskId: string, message: string): boolean {
    const task = this.tasks.get(taskId);
    if (!task || task.status !== "running") {
      return false;
    }

    task.steeringMessages.push(message);
    this.emit({ type: "taskSteered", taskId, message });
    return true;
  }

  dequeue(): TaskQueueItem | undefined {
    const activeCount = this.getActiveTasks().length;
    if (activeCount >= this.maxConcurrent) {
      return undefined;
    }

    const item = this.queue.shift();
    if (!item) {
      return undefined;
    }

    const task = this.tasks.get(item.taskId);
    if (task) {
      task.status = "planning";
      task.startedAt = Date.now();
      this.emit({ type: "taskStatusChanged", taskId: item.taskId, status: "planning" });
    }

    this.emit({
      type: "queueChanged",
      pendingCount: this.queue.length,
      activeCount: this.getActiveTasks().length,
    });

    return item;
  }

  updateStatus(taskId: string, status: TaskStatus, note?: string): void {
    const task = this.tasks.get(taskId);
    if (!task) {
      return;
    }

    task.status = status;
    if (note) {
      task.activityNote = note;
    }

    if (status === "completed" || status === "failed" || status === "cancelled") {
      task.completedAt = Date.now();
    }

    this.emit({ type: "taskStatusChanged", taskId, status, note });
    this.emit({
      type: "queueChanged",
      pendingCount: this.queue.length,
      activeCount: this.getActiveTasks().length,
    });
  }

  complete(taskId: string, result: string): void {
    const task = this.tasks.get(taskId);
    if (!task) {
      return;
    }

    task.status = "completed";
    task.result = result;
    task.completedAt = Date.now();
    this.emit({ type: "taskCompleted", taskId, result });
    this.emit({
      type: "queueChanged",
      pendingCount: this.queue.length,
      activeCount: this.getActiveTasks().length,
    });
  }

  fail(taskId: string, error: string): void {
    const task = this.tasks.get(taskId);
    if (!task) {
      return;
    }

    task.status = "failed";
    task.error = error;
    task.completedAt = Date.now();
    this.emit({ type: "taskFailed", taskId, error });
    this.emit({
      type: "queueChanged",
      pendingCount: this.queue.length,
      activeCount: this.getActiveTasks().length,
    });
  }

  cancel(taskId: string): boolean {
    const task = this.tasks.get(taskId);
    if (!task) {
      return false;
    }

    if (task.status === "completed" || task.status === "failed" || task.status === "cancelled") {
      return false;
    }

    if (task.abortController) {
      task.abortController.abort("cancelled-by-user");
    }

    task.status = "cancelled";
    task.completedAt = Date.now();

    this.queue = this.queue.filter((item) => item.taskId !== taskId);
    this.emit({ type: "taskCancelled", taskId });
    this.emit({
      type: "queueChanged",
      pendingCount: this.queue.length,
      activeCount: this.getActiveTasks().length,
    });

    return true;
  }

  getTask(taskId: string): Task | undefined {
    return this.tasks.get(taskId);
  }

  getActiveTasks(): Task[] {
    const active: Task[] = [];
    for (const task of this.tasks.values()) {
      if (task.status === "running" || task.status === "planning" || task.status === "verifying") {
        active.push(task);
      }
    }
    return active;
  }

  getQueuedTasks(): Task[] {
    return this.queue.map((item) => this.tasks.get(item.taskId)).filter((t): t is Task => !!t);
  }

  getAllTasks(): Task[] {
    return Array.from(this.tasks.values()).sort((a, b) => b.createdAt - a.createdAt);
  }

  getPendingCount(): number {
    return this.queue.length;
  }

  getActiveCount(): number {
    return this.getActiveTasks().length;
  }

  canAcceptNewTask(): boolean {
    return this.getActiveTasks().length < this.maxConcurrent;
  }

  removeCompleted(maxAge: number = 30 * 60 * 1000): number {
    const now = Date.now();
    let removed = 0;

    for (const [id, task] of this.tasks) {
      if (
        (task.status === "completed" || task.status === "failed" || task.status === "cancelled") &&
        task.completedAt &&
        now - task.completedAt > maxAge
      ) {
        this.tasks.delete(id);
        removed++;
      }
    }

    return removed;
  }

  clear(): void {
    for (const task of this.tasks.values()) {
      if (task.abortController) {
        task.abortController.abort("queue-cleared");
      }
    }

    this.tasks.clear();
    this.queue = [];
    this.emit({
      type: "queueChanged",
      pendingCount: 0,
      activeCount: 0,
    });
  }
}

export function classifyPromptIntent(
  currentTaskPrompt: string,
  newMessage: string,
): "steering" | "new-task" {
  const lower = newMessage.toLowerCase().trim();

  if (newMessage.length < 120) {
    const steeringPatterns = [
      /^(actually|instead|no,?|don'?t|stop|wait|also|additionally|make sure|don't forget|be sure)/i,
      /\b(instead of|rather than|change to|use .* instead|修正|追加)\b/i,
      /^(ok|yes|no|go|proceed|continue|do it)\b/i,
    ];

    for (const pattern of steeringPatterns) {
      if (pattern.test(lower)) {
        return "steering";
      }
    }
  }

  const taskSeparators = [
    /^(fix|refactor|add|create|implement|update|delete|remove|write|build|test|deploy|review|explain|analyze)\b/i,
    /^(bug|feature|task|todo|issue|pr|merge)\b/i,
  ];

  const hasNewTaskKeyword = taskSeparators.some((p) => p.test(lower));
  const isShortFollowUp = newMessage.length < 80 && !hasNewTaskKeyword;

  if (isShortFollowUp) {
    return "steering";
  }

  return "new-task";
}
