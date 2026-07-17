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

  async executeParallel(
    tasks: Array<{ description: string; executor: () => Promise<string> }>,
    maxConcurrency: number = 3,
  ): Promise<SubAgentTask[]> {
    const results: SubAgentTask[] = [];
    const executing: Promise<void>[] = [];

    for (const task of tasks) {
      const subtask = this.createTask(task.description);
      results.push(subtask);

      this.updateTask(subtask.id, { status: "running" });

      const promise = task
        .executor()
        .then((result) => {
          this.updateTask(subtask.id, { status: "completed", result });
        })
        .catch((error) => {
          this.updateTask(subtask.id, { status: "failed", error: String(error) });
        });

      executing.push(promise);

      if (executing.length >= maxConcurrency) {
        await Promise.race(executing);
      }
    }

    await Promise.all(executing);
    return results;
  }
}
