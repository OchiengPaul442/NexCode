import { randomUUID } from "crypto";

export interface EvidenceRecord {
  id: string;
  type: "tool_output" | "file_content" | "command_output" | "diff";
  content: string;
  truncated: boolean;
  metadata: {
    source: string;
    timestamp: string;
    sizeBytes: number;
    mimeType?: string;
  };
}

const MAX_STORE_SIZE = 100;
const MAX_EVIDENCE_SIZE = 50_000;

export class EvidenceStore {
  private records = new Map<string, EvidenceRecord>();
  private insertionOrder: string[] = [];

  add(evidence: Omit<EvidenceRecord, "id">): string {
    const id = `ev-${randomUUID().slice(0, 8)}`;
    const truncated = evidence.content.length > MAX_EVIDENCE_SIZE;
    const content = truncated
      ? evidence.content.slice(0, MAX_EVIDENCE_SIZE)
      : evidence.content;

    const record: EvidenceRecord = {
      id,
      ...evidence,
      content,
      truncated,
      metadata: {
        ...evidence.metadata,
        sizeBytes: content.length,
      },
    };

    this.records.set(id, record);
    this.insertionOrder.push(id);

    if (this.insertionOrder.length > MAX_STORE_SIZE) {
      const oldest = this.insertionOrder.shift();
      if (oldest) {
        this.records.delete(oldest);
      }
    }

    return id;
  }

  retrieve(evidenceId: string): EvidenceRecord | undefined {
    return this.records.get(evidenceId);
  }

  getSummary(evidenceId: string, maxChars: number = 500): string {
    const record = this.records.get(evidenceId);
    if (!record) {
      return `[Evidence ${evidenceId} not found]`;
    }

    if (record.content.length <= maxChars) {
      return record.content;
    }

    return record.content.slice(0, maxChars) + "\n... [truncated, full output by evidence ID]";
  }

  getLogRange(evidenceId: string, start: number, end: number): string {
    const record = this.records.get(evidenceId);
    if (!record) {
      return `[Evidence ${evidenceId} not found]`;
    }

    const lines = record.content.split("\n");
    return lines.slice(start, end).join("\n");
  }

  clear(): void {
    this.records.clear();
    this.insertionOrder = [];
  }
}
