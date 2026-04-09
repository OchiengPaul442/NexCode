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
  overlapCount: number;
}

interface ParsedMemoryQuery {
  text: string;
  tags: string[];
  type?: LongTermMemoryEntry["type"];
  sinceTimestamp?: number;
}

export class LongTermMemoryStore {
  private readonly filePath: string;
  private readonly legacyFilePath: string;
  private cache: LongTermMemoryEntry[] | null = null;
  private cacheMtimeMs = -1;
  private writeQueue = Promise.resolve();

  public constructor(memoryDir: string) {
    this.filePath = path.join(memoryDir, "long-term-memory.jsonl");
    this.legacyFilePath = path.join(memoryDir, "long-term-memory.json");
  }

  public async add(entry: LongTermMemoryEntry): Promise<void> {
    this.writeQueue = this.writeQueue.then(async () => {
      await this.ensureFile();
      await fs.appendFile(this.filePath, `${JSON.stringify(entry)}\n`, "utf8");

      if (this.cache) {
        this.cache.push(entry);
        this.cacheMtimeMs = Date.now();
      }
    });

    await this.writeQueue;
  }

  public async search(
    query: string,
    limit = 5,
  ): Promise<LongTermMemoryEntry[]> {
    const all = await this.readAll();
    const parsedQuery = this.parseQuery(query);

    const filtered = all.filter((entry) => {
      if (
        parsedQuery.type &&
        entry.type.toLowerCase() !== parsedQuery.type.toLowerCase()
      ) {
        return false;
      }

      if (
        typeof parsedQuery.sinceTimestamp === "number" &&
        new Date(entry.timestamp).getTime() < parsedQuery.sinceTimestamp
      ) {
        return false;
      }

      if (parsedQuery.tags.length > 0) {
        const entryTags = new Set(entry.tags.map((tag) => tag.toLowerCase()));
        for (const tag of parsedQuery.tags) {
          if (!entryTags.has(tag.toLowerCase())) {
            return false;
          }
        }
      }

      return true;
    });

    const ranked: SearchResult[] = filtered
      .map((entry) => {
        const searchableText = `${entry.text} ${entry.tags.join(" ")}`;
        return {
          entry,
          score: scoreKeywordOverlap(parsedQuery.text, searchableText),
          overlapCount: countKeywordOverlap(parsedQuery.text, searchableText),
        };
      })
      .filter((item) => item.score >= 0.25 && item.overlapCount >= 2)
      .sort((left, right) => right.score - left.score)
      .slice(0, limit);

    return ranked.map((item) => item.entry);
  }

  private async readAll(): Promise<LongTermMemoryEntry[]> {
    await this.ensureFile();

    const stats = await fs.stat(this.filePath);
    if (this.cache && stats.mtimeMs <= this.cacheMtimeMs) {
      return this.cache;
    }

    const raw = await fs.readFile(this.filePath, "utf8");
    const lines = raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    const parsedEntries: LongTermMemoryEntry[] = [];
    const recoveredLines: string[] = [];
    let hadCorruption = false;

    for (const line of lines) {
      try {
        const entry = JSON.parse(line) as LongTermMemoryEntry;
        if (!entry?.id || !entry?.timestamp || !entry?.type) {
          hadCorruption = true;
          continue;
        }
        parsedEntries.push(entry);
        recoveredLines.push(JSON.stringify(entry));
      } catch {
        hadCorruption = true;
      }
    }

    if (hadCorruption) {
      await this.recoverFromCorruption(raw, recoveredLines);
    }

    this.cache = parsedEntries;
    this.cacheMtimeMs = stats.mtimeMs;
    return parsedEntries;
  }

  private parseQuery(query: string): ParsedMemoryQuery {
    const tokens = query
      .split(/\s+/)
      .map((token) => token.trim())
      .filter(Boolean);

    const freeText: string[] = [];
    const tags: string[] = [];
    let type: LongTermMemoryEntry["type"] | undefined;
    let sinceTimestamp: number | undefined;

    for (const token of tokens) {
      if (/^tag:/i.test(token)) {
        const value = token.replace(/^tag:/i, "").trim();
        if (value) {
          tags.push(value.toLowerCase());
        }
        continue;
      }

      if (/^type:/i.test(token)) {
        const value = token
          .replace(/^type:/i, "")
          .trim()
          .toLowerCase();
        if (
          value === "interaction" ||
          value === "feedback" ||
          value === "note"
        ) {
          type = value;
        }
        continue;
      }

      if (/^since:/i.test(token)) {
        const value = token
          .replace(/^since:/i, "")
          .trim()
          .toLowerCase();
        const match = value.match(/^(\d+)([dhm])$/);
        if (match) {
          const amount = Number(match[1]);
          const unit = match[2];
          const multiplier =
            unit === "d" ? 86_400_000 : unit === "h" ? 3_600_000 : 60_000;
          sinceTimestamp = Date.now() - amount * multiplier;
        }
        continue;
      }

      freeText.push(token);
    }

    return {
      text: freeText.join(" ").trim() || query,
      tags,
      type,
      sinceTimestamp,
    };
  }

  private async ensureFile(): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });

    const hasJsonl = await this.exists(this.filePath);
    if (!hasJsonl) {
      const migrated = await this.tryMigrateLegacyFile();
      if (!migrated) {
        await fs.writeFile(this.filePath, "", "utf8");
      }
    }
  }

  private async exists(targetPath: string): Promise<boolean> {
    try {
      await fs.access(targetPath);
      return true;
    } catch {
      return false;
    }
  }

  private async tryMigrateLegacyFile(): Promise<boolean> {
    if (!(await this.exists(this.legacyFilePath))) {
      return false;
    }

    try {
      const raw = await fs.readFile(this.legacyFilePath, "utf8");
      const parsed = JSON.parse(raw) as LongTermMemoryEntry[];
      if (!Array.isArray(parsed)) {
        return false;
      }

      const lines = parsed.map((entry) => JSON.stringify(entry)).join("\n");
      await fs.writeFile(this.filePath, `${lines}${lines ? "\n" : ""}`, "utf8");
      await fs.rename(
        this.legacyFilePath,
        `${this.legacyFilePath}.migrated-${Date.now()}.bak`,
      );
      return true;
    } catch {
      return false;
    }
  }

  private async recoverFromCorruption(
    rawContent: string,
    recoveredLines: string[],
  ): Promise<void> {
    const backupPath = `${this.filePath}.corrupt-${Date.now()}.bak`;

    try {
      await fs.writeFile(backupPath, rawContent, "utf8");
    } catch {
      // Best-effort backup only.
    }

    const recovered = recoveredLines.join("\n");
    await fs.writeFile(
      this.filePath,
      `${recovered}${recovered ? "\n" : ""}`,
      "utf8",
    );
  }
}

function countKeywordOverlap(a: string, b: string): number {
  const aTokens = tokenizeForMemorySearch(a);
  const bTokens = new Set(tokenizeForMemorySearch(b));
  let overlap = 0;

  for (const token of aTokens) {
    if (bTokens.has(token)) {
      overlap += 1;
    }
  }

  return overlap;
}

function tokenizeForMemorySearch(input: string): string[] {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9_\s-]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 2);
}
