import { randomUUID } from "crypto";
import { ChatMessage } from "../types";
import { LongTermMemoryEntry, LongTermMemoryStore } from "./longTermMemory";
import { ShortTermMemory } from "./shortTermMemory";

export function redactSecrets(text: string): string {
  return text
    .replace(/\b(sk-[a-zA-Z0-9]{20,})\b/g, "[REDACTED_API_KEY]")
    .replace(/\b(AKIA[0-9A-Z]{16})\b/g, "[REDACTED_AWS_KEY]")
    .replace(/\b(ghp_[a-zA-Z0-9]{36})\b/g, "[REDACTED_GITHUB_TOKEN]")
    .replace(/\b(github_pat_[a-zA-Z0-9_]{82})\b/g, "[REDACTED_GITHUB_PAT]")
    .replace(/Bearer\s+[a-zA-Z0-9._\-]{20,}/g, "Bearer [REDACTED_TOKEN]")
    .replace(
      /(SECRET|TOKEN|PASSWORD|API_KEY|API_SECRET|ACCESS_KEY|PRIVATE_KEY)\s*[:=]\s*(?!\[REDACTED)\S+/gi,
      "$1=[REDACTED]",
    )
    .replace(
      /-----BEGIN\s+(RSA\s+)?PRIVATE\s+KEY-----[\s\S]*?-----END\s+(RSA\s+)?PRIVATE\s+KEY-----/g,
      "[REDACTED_PRIVATE_KEY]",
    )
    .replace(
      /(mongodb|postgres|mysql|redis):\/\/[^\s]+/g,
      "[REDACTED_CONNECTION_STRING]",
    );
}

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
}
