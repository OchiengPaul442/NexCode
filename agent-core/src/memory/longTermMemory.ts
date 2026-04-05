import fs from "fs/promises";
import path from "path";
import { scoreKeywordOverlap } from "../utils/text";

export interface LongTermMemoryEntry {
  id: string;
  timestamp: string;
  type: "interaction" | "feedback" | "note";
  text: string;
  tags: string[];
  metadata?: Record<string, unknown>;
}

interface SearchResult {
  entry: LongTermMemoryEntry;
  score: number;
}

export class LongTermMemoryStore {
  private readonly filePath: string;

  public constructor(memoryDir: string) {
    this.filePath = path.join(memoryDir, "long-term-memory.json");
  }

  public async add(entry: LongTermMemoryEntry): Promise<void> {
    const all = await this.readAll();
    all.push(entry);
    await this.writeAll(all);
  }

  public async search(
    query: string,
    limit = 5,
  ): Promise<LongTermMemoryEntry[]> {
    const all = await this.readAll();
    const ranked: SearchResult[] = all
      .map((entry) => ({
        entry,
        score: scoreKeywordOverlap(
          query,
          `${entry.text} ${entry.tags.join(" ")}`,
        ),
      }))
      .filter((item) => item.score > 0)
      .sort((left, right) => right.score - left.score)
      .slice(0, limit);

    return ranked.map((item) => item.entry);
  }

  private async readAll(): Promise<LongTermMemoryEntry[]> {
    await this.ensureFile();
    const raw = await fs.readFile(this.filePath, "utf8");
    const parsed = JSON.parse(raw) as LongTermMemoryEntry[];
    return Array.isArray(parsed) ? parsed : [];
  }

  private async writeAll(entries: LongTermMemoryEntry[]): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.writeFile(this.filePath, JSON.stringify(entries, null, 2), "utf8");
  }

  private async ensureFile(): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });

    try {
      await fs.access(this.filePath);
    } catch {
      await fs.writeFile(this.filePath, "[]", "utf8");
    }
  }
}
