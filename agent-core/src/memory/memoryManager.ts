import { randomUUID } from "crypto";
import { type ChatMessage } from "../types";
import { type LongTermMemoryEntry, LongTermMemoryStore } from "./longTermMemory";
import { ShortTermMemory } from "./shortTermMemory";
import { redactSecrets } from "../utils/redact";

export { redactSecrets } from "../utils/redact";

export interface MemoryManagerOptions {
  memoryDir: string;
  /** Optional callback invoked when any persistence operation fails. */
  onError?: (error: Error) => void;
}

export class MemoryManager {
  public readonly shortTerm: ShortTermMemory;
  public readonly longTerm: LongTermMemoryStore;

  public constructor(memoryDirOrOptions: string | MemoryManagerOptions) {
    let memoryDir: string;
    let onError: ((error: Error) => void) | undefined;

    if (typeof memoryDirOrOptions === "string") {
      memoryDir = memoryDirOrOptions;
      onError = undefined;
    } else {
      memoryDir = memoryDirOrOptions.memoryDir;
      onError = memoryDirOrOptions.onError;
    }

    this.shortTerm = new ShortTermMemory({
      maxMessagesPerSession: 40,
      persistDir: memoryDir,
      onError,
    });
    this.longTerm = new LongTermMemoryStore({
      memoryDir,
      onError,
    });
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
      attachmentsUsed?: string[];
    },
  ): Promise<void> {
    const normalizedPrompt = redactSecrets(prompt.trim());
    const normalizedResponse = redactSecrets(response.replace(/\s+/g, " ").trim());
    const responseExcerpt =
      normalizedResponse.length > 400
        ? `${normalizedResponse.slice(0, 400)}...`
        : normalizedResponse;

    const enrichedTags = [...new Set([...tags, ...(metadata?.mode ? [metadata.mode] : [])])];

    const entry: LongTermMemoryEntry = {
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      type: "interaction",
      text: redactSecrets(
        [
          `Prompt: ${normalizedPrompt}`,
          `Response excerpt: ${responseExcerpt}`,
          metadata?.filesEdited?.length
            ? `Files edited: ${metadata.filesEdited.join(", ")}`
            : "",
          metadata?.toolUsed?.length
            ? `Tools used: ${metadata.toolUsed.join(", ")}`
            : "",
          metadata?.attachmentsUsed?.length
            ? `Attachments: ${metadata.attachmentsUsed.join(", ")}`
            : "",
        ]
          .filter(Boolean)
          .join("\n"),
      ),
      tags: enrichedTags,
      metadata: {
        prompt: normalizedPrompt,
        responseExcerpt,
        mode: metadata?.mode,
        provider: metadata?.provider,
        model: metadata?.model,
        filesEdited: metadata?.filesEdited,
        toolUsed: metadata?.toolUsed,
        attachmentsUsed: metadata?.attachmentsUsed,
      },
    };

    await this.longTerm.add(entry);
  }

  public async rememberNote(
    text: string,
    tags: string[] = [],
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    const normalizedText = redactSecrets(text.trim());
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

  /**
   * Flushes all pending persistence operations for both short-term and
   * long-term memory stores.
   * Returns true if all operations succeeded.
   */
  public async flush(): Promise<boolean> {
    const [shortTermOk, longTermOk] = await Promise.all([
      this.shortTerm.flush(),
      this.longTerm.flush(),
    ]);
    return shortTermOk && longTermOk;
  }

  /**
   * Flushes pending writes and prevents further persistence operations.
   * Returns true if all operations succeeded.
   */
  public async dispose(): Promise<boolean> {
    const [shortTermOk, longTermOk] = await Promise.all([
      this.shortTerm.dispose(),
      this.longTerm.dispose(),
    ]);
    return shortTermOk && longTermOk;
  }

  /**
   * Returns true if any persistence operation has failed in either store.
   */
  public hasPersistenceError(): boolean {
    return (
      this.shortTerm.hasPersistenceError() ||
      this.longTerm.hasPersistenceError()
    );
  }
}
