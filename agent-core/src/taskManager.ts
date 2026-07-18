import { randomUUID } from "crypto";
import {
  Task,
  TaskStatus,
  TaskEvent,
  OrchestratorEvent,
  OrchestratorRequest,
  ProviderId,
  AgentMode,
  ReasoningEffort,
  RequestAttachment,
} from "./types";
import { TaskQueue, classifyPromptIntent } from "./taskQueue";

export interface TaskManagerOptions {
  maxConcurrent?: number;
}

export interface TaskExecutionResult {
  taskId: string;
  status: TaskStatus;
  result?: string;
  error?: string;
}

export class TaskQueueManager {
  private queue: TaskQueue;
  private runningTasks = new Map<string, AbortController>();
  private taskPrompts = new Map<string, string>();

  constructor(options: TaskManagerOptions = {}) {
    this.queue = new TaskQueue(options.maxConcurrent);
  }

  onEvent(listener: (event: TaskEvent) => void): () => void {
    return this.queue.onEvent(listener);
  }

  submitTask(
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
    const task = this.queue.createTask(prompt, sessionId, options);
    this.taskPrompts.set(task.id, prompt);
    return task;
  }

  steerTask(taskId: string, message: string): boolean {
    return this.queue.steer(taskId, message);
  }

  classifyAndRoute(
    activeTaskId: string | undefined,
    newPrompt: string,
    sessionId: string,
    options: {
      mode?: AgentMode;
      provider?: ProviderId;
      model?: string;
      temperature?: number;
      reasoningEffort?: ReasoningEffort;
      allowWebSearch?: boolean;
      attachmentIds?: string[];
    } = {},
  ): { action: "steer" | "queue"; task: Task } {
    if (activeTaskId) {
      const activeTask = this.queue.getTask(activeTaskId);
      if (activeTask && activeTask.status === "running") {
        const intent = classifyPromptIntent(activeTask.prompt, newPrompt);
        if (intent === "steering") {
          this.queue.steer(activeTaskId, newPrompt);
          return { action: "steer", task: activeTask };
        }
      }
    }

    const task = this.submitTask(newPrompt, sessionId, options);
    return { action: "queue", task };
  }

  startTask(taskId: string): Task | undefined {
    const task = this.queue.getTask(taskId);
    if (!task) {
      return undefined;
    }

    const controller = new AbortController();
    task.abortController = controller;
    this.runningTasks.set(taskId, controller);
    this.queue.updateStatus(taskId, "running");
    return task;
  }

  popSteeringMessage(taskId: string): string | undefined {
    const task = this.queue.getTask(taskId);
    if (!task || task.steeringMessages.length === 0) {
      return undefined;
    }
    return task.steeringMessages.shift();
  }

  completeTask(taskId: string, result: string): void {
    this.queue.complete(taskId, this.buildActivityResult(taskId, result));
    this.runningTasks.delete(taskId);
    this.taskPrompts.delete(taskId);
  }

  failTask(taskId: string, error: string): void {
    this.queue.fail(taskId, error);
    this.runningTasks.delete(taskId);
    this.taskPrompts.delete(taskId);
  }

  cancelTask(taskId: string): boolean {
    const success = this.queue.cancel(taskId);
    if (success) {
      this.runningTasks.delete(taskId);
      this.taskPrompts.delete(taskId);
    }
    return success;
  }

  getTask(taskId: string): Task | undefined {
    return this.queue.getTask(taskId);
  }

  getActiveTasks(): Task[] {
    return this.queue.getActiveTasks();
  }

  getQueuedTasks(): Task[] {
    return this.queue.getQueuedTasks();
  }

  getAllTasks(): Task[] {
    return this.queue.getAllTasks();
  }

  getPendingCount(): number {
    return this.queue.getPendingCount();
  }

  getActiveCount(): number {
    return this.queue.getActiveCount();
  }

  canAcceptNewTask(): boolean {
    return this.queue.canAcceptNewTask();
  }

  getNextQueuedTask(): { task: Task; request: OrchestratorRequest } | undefined {
    const item = this.queue.dequeue();
    if (!item) {
      return undefined;
    }

    const task = this.queue.getTask(item.taskId);
    if (!task) {
      return undefined;
    }

    const controller = new AbortController();
    task.abortController = controller;
    this.runningTasks.set(item.taskId, controller);

    const request: OrchestratorRequest = {
      prompt: item.prompt,
      provider: item.provider,
      model: item.model,
      mode: item.mode,
      temperature: item.temperature,
      reasoningEffort: item.reasoningEffort,
      allowWebSearch: item.allowWebSearch,
      abortSignal: controller.signal,
      attachments: task.attachments ?? [],
    };

    return { task, request };
  }

  private buildActivityResult(taskId: string, result: string): string {
    const prompt = this.taskPrompts.get(taskId) ?? "";
    const truncated = prompt.length > 80 ? prompt.slice(0, 80) + "..." : prompt;
    return result;
  }

  clear(): void {
    for (const [id, controller] of this.runningTasks) {
      controller.abort("queue-cleared");
    }
    this.runningTasks.clear();
    this.taskPrompts.clear();
    this.queue.clear();
  }

  removeCompleted(maxAge?: number): number {
    return this.queue.removeCompleted(maxAge);
  }
}
