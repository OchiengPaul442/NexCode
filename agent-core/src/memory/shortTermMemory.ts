import { ChatMessage } from "../types";

export class ShortTermMemory {
  private readonly sessions = new Map<string, ChatMessage[]>();

  public constructor(private readonly maxMessagesPerSession = 40) {}

  public append(sessionId: string, message: ChatMessage): void {
    const existing = this.sessions.get(sessionId) ?? [];
    existing.push(message);

    if (existing.length > this.maxMessagesPerSession) {
      existing.splice(0, existing.length - this.maxMessagesPerSession);
    }

    this.sessions.set(sessionId, existing);
  }

  public getSession(sessionId: string): ChatMessage[] {
    return [...(this.sessions.get(sessionId) ?? [])];
  }

  public clearSession(sessionId: string): void {
    this.sessions.delete(sessionId);
  }
}
