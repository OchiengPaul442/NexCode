import { EventEmitter } from "events";
import { type ModelRouter } from "../providers/modelRouter";
import { type ToolRegistry } from "../tools/toolRegistry";
import { type ToolDefinition } from "../tools/toolProtocol";
import { type ChatMessage, type OrchestratorEvent, type ProviderId } from "../types";
import { runAgentLoop, type AgentLoopConfig } from "./agentLoop";

/**
 * Worker states.
 */
export type WorkerState = "idle" | "running" | "completed" | "failed" | "cancelled";

/**
 * Configuration for a background worker.
 */
export interface BackgroundWorkerConfig {
  /** Unique identifier for this worker */
  id?: string;
  /** Worker objective/task description */
  objective: string;
  /** Model to use */
  model?: string;
  /** Provider to use */
  provider?: ProviderId;
  /** Maximum number of tool iterations */
  maxToolIterations?: number;
  /** Timeout in milliseconds */
  timeoutMs?: number;
  /** Workspace root path */
  workspaceRoot: string;
}

/**
 * Background worker for long-running tasks.
 * 
 * Features:
 * - Persistent state across tool calls
 * - Cancellation via abort signals
 * - Progress events for UI consumption
 * - Timeout with graceful shutdown
 * - Retry with exponential backoff
 */
export class BackgroundWorker extends EventEmitter {
  private state: WorkerState = "idle";
  private abortController: AbortController | null = null;
  private startTime: number = 0;
  private toolCallCount: number = 0;
  private filesModified: string[] = [];
  private retryCount: number = 0;
  private maxRetries: number = 3;

  constructor(private readonly config: BackgroundWorkerConfig) {
    super();
  }

  /**
   * Get the current worker state.
   */
  getState(): WorkerState {
    return this.state;
  }

  /**
   * Get worker progress information.
   */
  getProgress(): {
    state: WorkerState;
    toolCalls: number;
    filesModified: string[];
    durationMs: number;
    retryCount: number;
  } {
    return {
      state: this.state,
      toolCalls: this.toolCallCount,
      filesModified: [...this.filesModified],
      durationMs: this.startTime ? Date.now() - this.startTime : 0,
      retryCount: this.retryCount,
    };
  }

  /**
   * Start the background worker.
   */
  async start(
    router: ModelRouter,
    tools: ToolRegistry,
    toolDefinitions: ToolDefinition[],
    agentLoopConfig: AgentLoopConfig,
  ): Promise<void> {
    if (this.state === "running") {
      throw new Error("Worker is already running");
    }

    this.state = "running";
    this.startTime = Date.now();
    this.abortController = new AbortController();

    this.emit("stateChanged", { state: "running", workerId: this.config.id });

    try {
      await this.execute(router, tools, toolDefinitions, agentLoopConfig);
      this.state = "completed";
      this.emit("stateChanged", { state: "completed", workerId: this.config.id });
    } catch (error) {
      // Check if cancelled during execution
      const currentState = this.state as WorkerState;
      if (currentState === "cancelled") {
        this.emit("stateChanged", { state: "cancelled", workerId: this.config.id });
        return;
      }

      // Retry with exponential backoff
      if (this.retryCount < this.maxRetries) {
        this.retryCount++;
        const delay = 1000 * Math.pow(2, this.retryCount - 1);
        console.warn(`[background-worker] Retrying ${this.config.id} in ${delay}ms (attempt ${this.retryCount}/${this.maxRetries})`);
        
        await new Promise((resolve) => setTimeout(resolve, delay));
        
        if ((this.state as WorkerState) !== "cancelled") {
          await this.start(router, tools, toolDefinitions, agentLoopConfig);
          return;
        }
      }

      this.state = "failed";
      this.emit("stateChanged", { state: "failed", workerId: this.config.id });
      // Don't emit 'error' event as it crashes Node.js EventEmitter if no handler attached
      // Instead, emit a 'failed' event with error details
      this.emit("failed", { error: String(error), workerId: this.config.id });
    }
  }

  /**
   * Cancel the background worker.
   */
  cancel(): void {
    if (this.state !== "running") {
      return;
    }

    this.state = "cancelled";
    if (this.abortController) {
      this.abortController.abort();
    }
    this.emit("stateChanged", { state: "cancelled", workerId: this.config.id });
  }

  /**
   * Execute the worker task.
   */
  private async execute(
    router: ModelRouter,
    tools: ToolRegistry,
    toolDefinitions: ToolDefinition[],
    agentLoopConfig: AgentLoopConfig,
  ): Promise<void> {
    const messages: ChatMessage[] = [
      {
        role: "system",
        content: this.buildSystemPrompt(),
      },
      {
        role: "user",
        content: this.config.objective,
      },
    ];

    const workerConfig: AgentLoopConfig = {
      maxTurns: this.config.maxToolIterations || agentLoopConfig.maxTurns,
      maxTokensPerTurn: agentLoopConfig.maxTokensPerTurn,
      timeoutMs: this.config.timeoutMs || agentLoopConfig.timeoutMs,
      hooks: agentLoopConfig.hooks,
      pathScopedRules: agentLoopConfig.pathScopedRules,
    };

    for await (const event of runAgentLoop(
      messages,
      router,
      tools,
      toolDefinitions,
      workerConfig,
      this.abortController?.signal,
      undefined,
      undefined,
      undefined,
      this.config.model,
      this.config.provider,
      this.config.workspaceRoot,
    )) {
      // Track progress
      if (event.type === "toolExecuted") {
        this.toolCallCount++;
        if (event.filesChanged) {
          this.filesModified.push(...event.filesChanged);
        }
        this.emit("progress", {
          toolCalls: this.toolCallCount,
          filesModified: this.filesModified.length,
          lastTool: event.toolName,
        });
      }
    }
  }

  /**
   * Build system prompt for the worker.
   */
  private buildSystemPrompt(): string {
    return [
      "You are a specialized coding agent working on a long-running task.",
      "",
      `Your objective: ${this.config.objective}`,
      "",
      "You have access to the following tools:",
      "- read: Read file contents",
      "- write: Create or overwrite files",
      "- edit: Edit files",
      "- terminal: Run shell commands",
      "- search: Search codebase",
      "",
      "Work efficiently and complete your objective.",
      "Report your progress and any issues encountered.",
      "If you encounter errors, try alternative approaches before giving up.",
    ].join("\n");
  }
}
