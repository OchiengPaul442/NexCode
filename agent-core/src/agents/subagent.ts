import { randomUUID } from "crypto";

export interface SubAgentTask {
  id: string;
  description: string;
  status: "pending" | "running" | "completed" | "failed";
  result?: string;
  error?: string;
}

export class SubAgentManager {
  private tasks: Map<string, SubAgentTask> = new Map();

  createTask(description: string): SubAgentTask {
    const id = randomUUID();
    const task: SubAgentTask = { id, description, status: "pending" };
    this.tasks.set(id, task);
    return task;
  }

  updateTask(id: string, updates: Partial<SubAgentTask>): void {
    const task = this.tasks.get(id);
    if (task) {
      Object.assign(task, updates);
    }
  }

  getTasks(): SubAgentTask[] {
    return Array.from(this.tasks.values());
  }

  getActiveTasks(): SubAgentTask[] {
    return this.getTasks().filter((t) => t.status === "running");
  }
}
