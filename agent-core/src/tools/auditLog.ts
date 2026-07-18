import fs from "fs/promises";
import path from "path";
import { redactSecrets } from "../utils/redact";

interface AuditEntry {
  timestamp: string;
  toolName: string;
  arg: string;
  approved: boolean;
  approvalRequired: boolean;
  ok: boolean;
  outputPreview: string;
  durationMs: number;
}

export class AuditLog {
  private readonly logPath: string;
  private buffer: AuditEntry[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(workspaceRoot: string) {
    this.logPath = path.join(workspaceRoot, ".nexcode", "audit.jsonl");
  }

  async log(entry: AuditEntry): Promise<void> {
    const redacted: AuditEntry = {
      ...entry,
      arg: redactSecrets(entry.arg),
      outputPreview: redactSecrets(entry.outputPreview),
    };
    this.buffer.push(redacted);
    if (this.buffer.length >= 10) {
      await this.flush();
    } else if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => this.flush(), 5000);
    }
  }

  async flush(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.buffer.length === 0) return;
    
    const entries = this.buffer.splice(0);
    try {
      await fs.mkdir(path.dirname(this.logPath), { recursive: true });
      const lines = entries.map(e => JSON.stringify(e)).join("\n") + "\n";
      await fs.appendFile(this.logPath, lines, "utf8");
    } catch {
      // Best-effort logging - never crash the agent
    }
  }
}
