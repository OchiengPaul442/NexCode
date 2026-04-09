import { randomUUID } from "crypto";
import { ChatMessage } from "../types";
import { LongTermMemoryEntry, LongTermMemoryStore } from "./longTermMemory";
import { ShortTermMemory } from "./shortTermMemory";

export class MemoryManager {
  public readonly shortTerm = new ShortTermMemory();
  public readonly longTerm: LongTermMemoryStore;

  public constructor(memoryDir: string) {
    this.longTerm = new LongTermMemoryStore(memoryDir);
  }

  public appendSessionMessage(sessionId: string, message: ChatMessage): void {
    this.shortTerm.append(sessionId, message);
  }

  public getSessionMessages(sessionId: string): ChatMessage[] {
    return this.shortTerm.getSession(sessionId);
  }

  public async rememberInteraction(
    prompt: string,
    response: string,
    tags: string[] = [],
  ): Promise<void> {
    const normalizedPrompt = prompt.trim();
    const normalizedResponse = response.replace(/\s+/g, " ").trim();
    const responseExcerpt =
      normalizedResponse.length > 320
        ? `${normalizedResponse.slice(0, 320)}…`
        : normalizedResponse;

    const entry: LongTermMemoryEntry = {
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      type: "interaction",
      text: `Prompt: ${normalizedPrompt}\nResponse excerpt: ${responseExcerpt}`,
      tags,
      metadata: {
        prompt: normalizedPrompt,
        responseExcerpt,
      },
    };

    await this.longTerm.add(entry);
  }

  public async getRelevantContext(query: string, limit = 3): Promise<string> {
    const entries = await this.longTerm.search(query, limit);
    if (entries.length === 0) {
      return "";
    }

    return entries
      .map((entry, index) => `${index + 1}. ${entry.text.slice(0, 800)}`)
      .join("\n\n");
  }
}
