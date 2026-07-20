import fs from "fs/promises";
import path from "path";
import { type InteractionFeedback } from "../types";

export interface FeedbackLoggerOptions {
  memoryDir: string;
  /** Optional callback invoked when a persistence error occurs. */
  onError?: (error: Error) => void;
}

/**
 * Serializes feedback entries to a JSONL file with a write queue.
 * Errors are surfaced through an optional callback instead of being swallowed.
 */
export class FeedbackLogger {
  private readonly logPath: string;
  private readonly onError?: (error: Error) => void;
  private writeQueue = Promise.resolve();
  private disposed = false;
  private lastError: Error | null = null;

  public constructor(memoryDirOrOptions: string | FeedbackLoggerOptions) {
    if (typeof memoryDirOrOptions === "string") {
      this.logPath = path.join(memoryDirOrOptions, "feedback-log.jsonl");
      this.onError = undefined;
    } else {
      this.logPath = path.join(memoryDirOrOptions.memoryDir, "feedback-log.jsonl");
      this.onError = memoryDirOrOptions.onError;
    }
  }

  public async log(feedback: InteractionFeedback): Promise<void> {
    if (this.disposed) {
      return;
    }

    this.writeQueue = this.writeQueue.then(async () => {
      try {
        await fs.mkdir(path.dirname(this.logPath), { recursive: true });
        await fs.appendFile(
          this.logPath,
          `${JSON.stringify(feedback)}\n`,
          "utf8",
        );
      } catch (error) {
        this.lastError =
          error instanceof Error
            ? new Error(`FeedbackLogger: ${error.message}`)
            : new Error(`FeedbackLogger: ${String(error)}`);
        this.onError?.(this.lastError);
      }
    });

    await this.writeQueue;
  }

  /**
   * Waits for all queued writes to complete.
   * Returns true if all writes succeeded, false if any failed.
   */
  public async flush(): Promise<boolean> {
    await this.writeQueue;
    return this.lastError === null;
  }

  /**
   * Waits for all queued writes to complete and prevents further writes.
   * Returns true if all writes succeeded, false if any failed.
   */
  public async dispose(): Promise<boolean> {
    this.disposed = true;
    await this.writeQueue;
    return this.lastError === null;
  }

  /**
   * Returns the last persistence error, or null if none occurred.
   */
  public getLastError(): Error | null {
    return this.lastError;
  }

  /**
   * Returns true if any write has failed since construction or last reset.
   */
  public hasPersistenceError(): boolean {
    return this.lastError !== null;
  }

  /**
   * Resets the error state. Useful after recovering from a transient failure.
   */
  public resetErrorState(): void {
    this.lastError = null;
  }
}
