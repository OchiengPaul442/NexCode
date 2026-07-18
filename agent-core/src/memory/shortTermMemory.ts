import fs from "fs/promises";
import path from "path";
import { ChatMessage } from "../types";

const MAX_SESSIONS = 50;
const MAX_CONTEXT_MESSAGES = 12;

export class ShortTermMemory {
  private readonly sessions = new Map<string, ChatMessage[]>();
  private readonly accessOrder: string[] = [];
  private readonly persistDir?: string;
  private persistQueue = Promise.resolve();

  public constructor(
    private readonly maxMessagesPerSession = 40,
    persistDir?: string,
  ) {
    this.persistDir = persistDir;
  }

  public append(sessionId: string, message: ChatMessage): void {
    const existing = this.sessions.get(sessionId) ?? [];
    existing.push(message);

    if (existing.length > this.maxMessagesPerSession) {
      existing.splice(0, existing.length - this.maxMessagesPerSession);
    }

    this.sessions.set(sessionId, existing);
    this.touchSession(sessionId);

    if (this.sessions.size > MAX_SESSIONS) {
      this.evictOldest();
    }

    if (this.persistDir) {
      this.persistQueue = this.persistQueue
        .then(() => this.persistSession(sessionId))
        .catch(() => {});
    }
  }

  public getSession(sessionId: string): ChatMessage[] {
    this.touchSession(sessionId);
    return [...(this.sessions.get(sessionId) ?? [])];
  }

  public clearSession(sessionId: string): void {
    this.sessions.delete(sessionId);
    const idx = this.accessOrder.indexOf(sessionId);
    if (idx !== -1) {
      this.accessOrder.splice(idx, 1);
    }

    if (this.persistDir) {
      this.persistQueue = this.persistQueue
        .then(() => this.removePersistedSession(sessionId))
        .catch(() => {});
    }
  }

  public async loadPersistedSessions(): Promise<void> {
    if (!this.persistDir) {
      return;
    }

    try {
      const files = await fs.readdir(this.persistDir);
      for (const file of files) {
        if (!file.endsWith(".jsonl")) {
          continue;
        }

        const sessionId = file.replace(/\.jsonl$/, "");
        const filePath = path.join(this.persistDir, file);

        try {
          const raw = await fs.readFile(filePath, "utf8");
          const messages: ChatMessage[] = [];
          for (const line of raw.split(/\r?\n/)) {
            const trimmed = line.trim();
            if (!trimmed) {
              continue;
            }
            try {
              const msg = JSON.parse(trimmed) as ChatMessage;
              if (msg.role && msg.content) {
                messages.push(msg);
              }
            } catch {
              // Skip corrupt lines.
            }
          }

          if (messages.length > 0) {
            this.sessions.set(sessionId, messages);
            this.touchSession(sessionId);
          }
        } catch {
          // Skip unreadable files.
        }
      }
    } catch {
      // No persisted sessions yet.
    }
  }

  public buildContextSummary(sessionId: string, maxChars = 3000): string {
    const messages = this.getSession(sessionId);
    if (messages.length === 0) {
      return "";
    }

    const recent = messages.slice(-MAX_CONTEXT_MESSAGES);
    const lines: string[] = [];
    let totalChars = 0;

    for (const msg of recent) {
      const prefix = msg.role === "user" ? "User" : "Assistant";
      const content = msg.content.replace(/\s+/g, " ").trim();
      const truncated =
        content.length > 400 ? `${content.slice(0, 400)}...` : content;
      const line = `${prefix}: ${truncated}`;

      if (totalChars + line.length > maxChars) {
        break;
      }

      lines.push(line);
      totalChars += line.length;
    }

    return lines.join("\n");
  }

  private touchSession(sessionId: string): void {
    const idx = this.accessOrder.indexOf(sessionId);
    if (idx !== -1) {
      this.accessOrder.splice(idx, 1);
    }
    this.accessOrder.push(sessionId);
  }

  private evictOldest(): void {
    while (this.sessions.size > MAX_SESSIONS && this.accessOrder.length > 0) {
      const oldest = this.accessOrder.shift()!;
      this.sessions.delete(oldest);
      // Clean up persisted file
      if (this.persistDir) {
        this.persistQueue = this.persistQueue
          .then(() => this.removePersistedSession(oldest))
          .catch(() => {});
      }
    }
  }

  private async persistSession(sessionId: string): Promise<void> {
    if (!this.persistDir) {
      return;
    }

    const messages = this.sessions.get(sessionId);
    if (!messages) {
      return;
    }

    try {
      await fs.mkdir(this.persistDir, { recursive: true });
      const filePath = path.join(this.persistDir, `${sessionId}.jsonl`);
      const lines = messages.map((m) => JSON.stringify(m)).join("\n");
      await fs.writeFile(filePath, `${lines}\n`, "utf8");
    } catch {
      // Best-effort persistence.
    }
  }

  private async removePersistedSession(sessionId: string): Promise<void> {
    if (!this.persistDir) {
      return;
    }

    try {
      const filePath = path.join(this.persistDir, `${sessionId}.jsonl`);
      await fs.unlink(filePath);
    } catch {
      // File may not exist.
    }
  }
}
