import { randomUUID } from "crypto";
import { EventEmitter } from "events";
import { AgentIsolation, type IsolatedWorkspace } from "./agentIsolation";
import { type ModelRouter } from "../providers/modelRouter";
import { type ToolRegistry } from "../tools/toolRegistry";
import { type ToolDefinition } from "../tools/toolProtocol";
import { type ChatMessage, type OrchestratorEvent, type ProviderId } from "../types";
import { runAgentLoop, type AgentLoopConfig } from "./agentLoop";

/**
 * Configuration for a worker in the pool.
 */
export interface WorkerConfig {
  /** Unique identifier for this worker */
  id?: string;
  /** Agent objective/task description */
  objective: string;
  /** Model to use for this worker */
  model?: string;
  /** Provider to use */
  provider?: ProviderId;
  /** Maximum number of tool iterations */
  maxToolIterations?: number;
  /** Timeout in milliseconds */
  timeoutMs?: number;
  /** Tools this worker is allowed to use (empty = all tools) */
  allowedTools?: string[];
  /** Files this worker is assigned to modify */
  assignedFiles?: string[];
}

/**
 * Result from a worker execution.
 */
export interface WorkerResult {
  /** Worker ID */
  workerId: string;
  /** Whether the worker completed successfully */
  success: boolean;
  /** Final response from the agent */
  response?: string;
  /** Files modified by this worker */
  filesModified: string[];
  /** Tool calls made by this worker */
  toolCalls: number;
  /** Duration in milliseconds */
  durationMs: number;
  /** Error message if failed */
  error?: string;
  /** Workspace used by this worker */
  workspacePath: string;
}

/**
 * Events emitted by the worker pool.
 */
export interface WorkerPoolEvent {
  type: "workerStarted" | "workerCompleted" | "workerFailed" | "workerCancelled" | "allCompleted";
  workerId: string;
  message: string;
  timestamp: number;
}

/**
 * WorkerPool manages concurrent agent execution with conflict isolation.
 * 
 * Features:
 * - Parallel execution of multiple agents
 * - Conflict isolation via git worktrees or file copies
 * - Non-overlapping file set assignment
 * - Result aggregation
 * - Cancellation support
 * - Progress tracking
 */
export class WorkerPool extends EventEmitter {
  private readonly isolation: AgentIsolation;
  private readonly workers = new Map<string, WorkerState>();
  private readonly config: WorkerPoolConfig;
  private abortController: AbortController | null = null;

  constructor(config: WorkerPoolConfig) {
    super();
    this.config = {
      maxConcurrentWorkers: 5,
      ...config,
    };
    this.isolation = new AgentIsolation({
      workspaceRoot: config.workspaceRoot,
      useWorktrees: this.config.useWorktrees,
    });
  }

  /**
   * Execute multiple worker tasks in parallel with conflict isolation.
   */
  async executeParallel(
    workers: WorkerConfig[],
    router: ModelRouter,
    tools: ToolRegistry,
    toolDefinitions: ToolDefinition[],
    agentLoopConfig: AgentLoopConfig,
  ): Promise<WorkerResult[]> {
    this.abortController = new AbortController();
    const results: WorkerResult[] = [];
    const semaphore = new Semaphore(this.config.maxConcurrentWorkers ?? 5);

    // Assign non-overlapping file sets if not specified
    const assignedFiles = this.assignFileSets(workers);

    // Create promises for all workers
    const promises = workers.map(async (workerConfig, index) => {
      const workerId = workerConfig.id || `worker-${index}`;
      const assignedFilesList = assignedFiles.get(index) || [];

      await semaphore.acquire();

      try {
        const result = await this.executeWorker(
          {
            ...workerConfig,
            id: workerId,
            assignedFiles: assignedFilesList,
          },
          router,
          tools,
          toolDefinitions,
          agentLoopConfig,
        );
        results.push(result);
        return result;
      } finally {
        semaphore.release();
      }
    });

    // Wait for all workers to complete
    await Promise.allSettled(promises);

    // Emit completion event
    this.emit("allCompleted", {
      type: "allCompleted",
      workerId: "pool",
      message: `All ${workers.length} workers completed`,
      timestamp: Date.now(),
    });

    return results;
  }

  /**
   * Execute a single worker task.
   */
  private async executeWorker(
    config: WorkerConfig,
    router: ModelRouter,
    tools: ToolRegistry,
    toolDefinitions: ToolDefinition[],
    agentLoopConfig: AgentLoopConfig,
  ): Promise<WorkerResult> {
    const workerId = config.id!;
    const startTime = Date.now();

    this.emit("workerStarted", {
      type: "workerStarted",
      workerId,
      message: `Worker ${workerId} starting: ${config.objective}`,
      timestamp: startTime,
    });

    try {
      // Create isolated workspace
      const workspace = await this.isolation.createWorkspace(workerId);
      this.workers.set(workerId, {
        config,
        workspace,
        status: "running",
        startTime,
      });

      // Build messages for the worker
      const messages: ChatMessage[] = [
        {
          role: "system",
          content: this.buildWorkerSystemPrompt(config),
        },
        {
          role: "user",
          content: config.objective,
        },
      ];

      // Run the agent loop
      const workerConfig: AgentLoopConfig = {
        maxTurns: config.maxToolIterations || agentLoopConfig.maxTurns,
        maxTokensPerTurn: agentLoopConfig.maxTokensPerTurn,
        timeoutMs: config.timeoutMs || agentLoopConfig.timeoutMs,
        hooks: agentLoopConfig.hooks,
        pathScopedRules: agentLoopConfig.pathScopedRules,
      };

      let finalResponse = "";
      const filesModified: string[] = [];
      let toolCalls = 0;

      for await (const event of runAgentLoop(
        messages,
        router,
        tools,
        toolDefinitions,
        workerConfig,
        this.abortController?.signal,
        undefined, // approvalCallback
        undefined, // reasoningEffort
        undefined, // steeringProvider
        config.model,
        config.provider,
        workspace.path,
      )) {
        if (event.type === "toolExecuted") {
          toolCalls++;
          if (event.filesChanged) {
            filesModified.push(...event.filesChanged);
          }
        }
        if (event.type === "final") {
          finalResponse = event.response?.text || "";
        }
      }

      // Merge changes back to main workspace
      const mergeResult = await this.isolation.mergeChanges(workspace.id);

      const result: WorkerResult = {
        workerId,
        success: mergeResult.success,
        response: mergeResult.success ? finalResponse : `Merge failed: ${mergeResult.output}`,
        filesModified,
        toolCalls,
        durationMs: Date.now() - startTime,
        workspacePath: workspace.path,
        error: mergeResult.success ? undefined : mergeResult.output,
      };

      this.emit("workerCompleted", {
        type: "workerCompleted",
        workerId,
        message: `Worker ${workerId} completed: ${filesModified.length} files modified`,
        timestamp: Date.now(),
      });

      return result;
    } catch (error) {
      const result: WorkerResult = {
        workerId,
        success: false,
        error: String(error),
        filesModified: [],
        toolCalls: 0,
        durationMs: Date.now() - startTime,
        workspacePath: "",
      };

      this.emit("workerFailed", {
        type: "workerFailed",
        workerId,
        message: `Worker ${workerId} failed: ${String(error).slice(0, 200)}`,
        timestamp: Date.now(),
      });

      return result;
    } finally {
      // Cleanup
      const workerState = this.workers.get(workerId);
      if (workerState) {
        try {
          await this.isolation.releaseWorkspace(workerState.workspace.id);
        } catch (cleanupError) {
          console.warn(`[workerPool] Failed to release workspace for ${workerId}: ${cleanupError}`);
        }
        this.workers.delete(workerId);
      }
    }
  }

  /**
   * Cancel all running workers.
   */
  cancelAll(): void {
    if (this.abortController) {
      this.abortController.abort();
    }
    for (const [workerId, state] of this.workers) {
      if (state.status === "running") {
        this.emit("workerCancelled", {
          type: "workerCancelled",
          workerId,
          message: `Worker ${workerId} cancelled`,
          timestamp: Date.now(),
        });
      }
    }
  }

  /**
   * Get status of all workers.
   */
  getStatus(): Array<{ id: string; status: string; objective: string }> {
    return Array.from(this.workers.entries()).map(([id, state]) => ({
      id,
      status: state.status,
      objective: state.config.objective,
    }));
  }

  /**
   * Build system prompt for a worker agent.
   */
  private buildWorkerSystemPrompt(config: WorkerConfig): string {
    const parts = [
      "You are a specialized coding agent working on a specific task.",
      "",
      `Your objective: ${config.objective}`,
      "",
    ];

    if (config.assignedFiles && config.assignedFiles.length > 0) {
      parts.push(
        "You are assigned to modify ONLY these files:",
        ...config.assignedFiles.map((f) => `- ${f}`),
        "",
        "Do NOT modify files outside your assigned set.",
        "If you need to read files outside your assigned set, that is allowed.",
        "",
      );
    }

    parts.push(
      "You have access to the following tools:",
      "- read: Read file contents",
      "- write: Create or overwrite files",
      "- edit: Edit files",
      "- terminal: Run shell commands",
      "- search: Search codebase",
      "",
      "Work efficiently and complete your objective.",
      "Report your progress and any issues encountered.",
    );

    return parts.join("\n");
  }

  /**
   * Assign non-overlapping file sets to workers.
   * If workers already have assigned files, use those.
   * Otherwise, distribute files evenly.
   */
  private assignFileSets(workers: WorkerConfig[]): Map<number, string[]> {
    const assignment = new Map<number, string[]>();

    // Check if workers already have assigned files
    const hasAssignedFiles = workers.some(
      (w) => w.assignedFiles && w.assignedFiles.length > 0,
    );

    if (hasAssignedFiles) {
      // Use existing assignments
      workers.forEach((w, i) => {
        assignment.set(i, w.assignedFiles || []);
      });
    } else {
      // No files assigned - workers will use the shared workspace
      workers.forEach((_, i) => {
        assignment.set(i, []);
      });
    }

    return assignment;
  }
}

/**
 * Worker state tracking.
 */
interface WorkerState {
  config: WorkerConfig;
  workspace: IsolatedWorkspace;
  status: "pending" | "running" | "completed" | "failed" | "cancelled";
  startTime: number;
}

/**
 * Worker pool configuration.
 */
export interface WorkerPoolConfig {
  /** Workspace root path */
  workspaceRoot: string;
  /** Maximum concurrent workers */
  maxConcurrentWorkers?: number;
  /** Whether to use git worktrees for isolation */
  useWorktrees: boolean;
}

/**
 * Simple semaphore for limiting concurrent operations.
 */
class Semaphore {
  private permits: number;
  private queue: Array<() => void> = [];

  constructor(permits: number) {
    this.permits = permits;
  }

  async acquire(): Promise<void> {
    if (this.permits > 0) {
      this.permits--;
      return;
    }
    return new Promise((resolve) => {
      this.queue.push(resolve);
    });
  }

  release(): void {
    if (this.queue.length > 0) {
      const next = this.queue.shift()!;
      next();
    } else {
      this.permits++;
    }
  }
}
