import { ChatMessage } from "../types";

const MAX_SESSIONS = 50;

export class ShortTermMemory {
  private readonly sessions = new Map<string, ChatMessage[]>();
  private readonly accessOrder: string[] = [];

  public constructor(private readonly maxMessagesPerSession = 40) {}

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
    }
  }
}
