import fs from "fs/promises";
import path from "path";
import { redactSecrets } from "../utils/redact";

export interface AuditEntry {
  timestamp: string;
  toolName: string;
  arg: string;
  approved: boolean;
  approvalRequired: boolean;
  ok: boolean;
  outputPreview: string;
  durationMs: number;
}

export interface AuditLogOptions {
  workspaceRoot: string;
  /** Optional callback invoked when a flush fails. */
  onError?: (error: Error) => void;
}

/**
 * Persists audit entries to a JSONL file with a serialized write queue.
 *
 * - Entries are buffered and flushed either when the buffer reaches 10
 *   entries or after a 5-second timer.
 * - A write queue serializes flushes so that concurrent callers cannot
 *   interleave file writes.
 * - If a flush fails, the entries are re-queued instead of being lost.
 * - `dispose()` flushes remaining entries and clears the timer.
 */
export class AuditLog {
  private readonly logPath: string;
  private readonly onError?: (error: Error) => void;
  private buffer: AuditEntry[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private writeQueue = Promise.resolve();
  private disposed = false;
  private lastError: Error | null = null;

  public constructor(workspaceRootOrOptions: string | AuditLogOptions) {
    let workspaceRoot: string;
    if (typeof workspaceRootOrOptions === "string") {
      workspaceRoot = workspaceRootOrOptions;
      this.onError = undefined;
    } else {
      workspaceRoot = workspaceRootOrOptions.workspaceRoot;
      this.onError = workspaceRootOrOptions.onError;
    }
    // Use workspace root for audit log (project-specific)
    this.logPath = path.join(workspaceRoot, ".nexcode-audit.jsonl");
  }

  public async log(entry: AuditEntry): Promise<void> {
    if (this.disposed) {
      return;
    }

    const redacted: AuditEntry = {
      ...entry,
      arg: redactSecrets(entry.arg),
      outputPreview: redactSecrets(entry.outputPreview),
    };
    this.buffer.push(redacted);

    if (this.buffer.length >= 10) {
      await this.flush();
    } else if (!this.flushTimer && !this.disposed) {
      this.flushTimer = setTimeout(() => {
        void this.flush();
      }, 5000);
    }
  }

  /**
   * Flushes buffered entries to disk. Serialized through a write queue so
   * concurrent calls do not interleave. If the write fails, entries are
   * re-queued for a subsequent flush attempt.
   */
  public async flush(): Promise<boolean> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

    if (this.buffer.length === 0) {
      await this.writeQueue;
      return this.lastError === null;
    }

    // Atomically take all buffered entries. This synchronous splice
    // ensures no new entries pushed during the async write are lost
    // or double-counted.
    const entriesToWrite = this.buffer.splice(0);

    this.writeQueue = this.writeQueue.then(async () => {
      try {
        await fs.mkdir(path.dirname(this.logPath), { recursive: true });
        const lines =
          entriesToWrite.map((e) => JSON.stringify(e)).join("\n") + "\n";
        await fs.appendFile(this.logPath, lines, "utf8");
        this.lastError = null;
      } catch (error) {
        const err =
          error instanceof Error ? error : new Error(String(error));
        this.lastError = err;
        this.onError?.(err);
        // Re-queue entries so they are not permanently lost
        this.buffer.unshift(...entriesToWrite);
      }
    });

    await this.writeQueue;
    return this.lastError === null;
  }

  /**
   * Flushes remaining entries and prevents further writes.
   * Returns true if all writes succeeded.
   */
  public async dispose(): Promise<boolean> {
    this.disposed = true;
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    // Final flush attempt
    if (this.buffer.length > 0) {
      await this.flush();
    }
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
   * Returns true if any flush has failed since construction or last reset.
   */
  public hasPersistenceError(): boolean {
    return this.lastError !== null;
  }

  /**
   * Returns the number of entries currently buffered (not yet flushed).
   */
  public getBufferedCount(): number {
    return this.buffer.length;
  }
}
