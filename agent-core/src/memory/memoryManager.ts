import { randomUUID } from "crypto";
import { ChatMessage } from "../types";
import { LongTermMemoryEntry, LongTermMemoryStore } from "./longTermMemory";
import { ShortTermMemory } from "./shortTermMemory";

export class MemoryManager {
  public readonly shortTerm: ShortTermMemory;
  public readonly longTerm: LongTermMemoryStore;

  public constructor(memoryDir: string) {
    this.shortTerm = new ShortTermMemory(40, memoryDir);
    this.longTerm = new LongTermMemoryStore(memoryDir);
  }

  public async initialize(): Promise<void> {
    await this.shortTerm.loadPersistedSessions();
  }

  public appendSessionMessage(sessionId: string, message: ChatMessage): void {
    this.shortTerm.append(sessionId, message);
  }

  public getSessionMessages(sessionId: string): ChatMessage[] {
    return this.shortTerm.getSession(sessionId);
  }

  public getSessionContext(sessionId: string, maxChars = 3000): string {
    return this.shortTerm.buildContextSummary(sessionId, maxChars);
  }

  public async rememberInteraction(
    prompt: string,
    response: string,
    tags: string[] = [],
    metadata?: {
      mode?: string;
      provider?: string;
      model?: string;
      filesEdited?: string[];
      toolUsed?: string[];
    },
  ): Promise<void> {
    const normalizedPrompt = prompt.trim();
    const normalizedResponse = response.replace(/\s+/g, " ").trim();
    const responseExcerpt =
      normalizedResponse.length > 400
        ? `${normalizedResponse.slice(0, 400)}...`
        : normalizedResponse;

    const enrichedTags = [...new Set([...tags, ...(metadata?.mode ? [metadata.mode] : [])])];

    const entry: LongTermMemoryEntry = {
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      type: "interaction",
      text: [
        `Prompt: ${normalizedPrompt}`,
        `Response excerpt: ${responseExcerpt}`,
        metadata?.filesEdited?.length
          ? `Files edited: ${metadata.filesEdited.join(", ")}`
          : "",
        metadata?.toolUsed?.length
          ? `Tools used: ${metadata.toolUsed.join(", ")}`
          : "",
      ]
        .filter(Boolean)
        .join("\n"),
      tags: enrichedTags,
      metadata: {
        prompt: normalizedPrompt,
        responseExcerpt,
        mode: metadata?.mode,
        provider: metadata?.provider,
        model: metadata?.model,
        filesEdited: metadata?.filesEdited,
        toolUsed: metadata?.toolUsed,
      },
    };

    await this.longTerm.add(entry);
  }

  public async rememberNote(
    text: string,
    tags: string[] = [],
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    const normalizedText = text.trim();
    if (!normalizedText) {
      return;
    }

    const entry: LongTermMemoryEntry = {
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      type: "note",
      text: normalizedText,
      tags,
      metadata,
    };

    await this.longTerm.add(entry);
  }

  public async getRelevantContext(
    query: string,
    limit = 5,
  ): Promise<string> {
    const entries = await this.longTerm.search(query, limit);
    if (entries.length === 0) {
      return "";
    }

    return entries
      .map((entry, index) => {
        const text = entry.text.slice(0, 600);
        const timestamp = entry.timestamp
          ? ` [${new Date(entry.timestamp).toLocaleDateString()}]`
          : "";
        return `${index + 1}. ${text}${timestamp}`;
      })
      .join("\n\n");
  }
}
