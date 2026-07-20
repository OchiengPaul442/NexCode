import fs from "fs/promises";
import path from "path";
import { scoreKeywordOverlap } from "../utils/text";

const MAX_ENTRIES = 2000;

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
  recencyBonus: number;
}

interface ParsedMemoryQuery {
  text: string;
  tags: string[];
  type?: LongTermMemoryEntry["type"];
  sinceTimestamp?: number;
}

export interface LongTermMemoryStoreOptions {
  memoryDir: string;
  /** Optional callback invoked when a persistence error occurs. */
  onError?: (error: Error) => void;
}

export class LongTermMemoryStore {
  private readonly filePath: string;
  private readonly legacyFilePath: string;
  private readonly onError?: (error: Error) => void;
  private cache: LongTermMemoryEntry[] | null = null;
  private cacheMtimeMs = -1;
  private writeQueue = Promise.resolve();
  private disposed = false;
  private lastError: Error | null = null;

  public constructor(memoryDirOrOptions: string | LongTermMemoryStoreOptions) {
    let memoryDir: string;
    if (typeof memoryDirOrOptions === "string") {
      memoryDir = memoryDirOrOptions;
      this.onError = undefined;
    } else {
      memoryDir = memoryDirOrOptions.memoryDir;
      this.onError = memoryDirOrOptions.onError;
    }
    this.filePath = path.join(memoryDir, "long-term-memory.jsonl");
    this.legacyFilePath = path.join(memoryDir, "long-term-memory.json");
  }

  public async add(entry: LongTermMemoryEntry): Promise<void> {
    if (this.disposed) {
      return;
    }

    this.writeQueue = this.writeQueue.then(async () => {
      try {
        await this.ensureFile();
        await fs.appendFile(
          this.filePath,
          `${JSON.stringify(entry)}\n`,
          "utf8",
        );

        if (this.cache) {
          this.cache.push(entry);
          this.cacheMtimeMs = Date.now();

          if (this.cache.length > MAX_ENTRIES) {
            await this.evictOldest();
          }
        }
        this.lastError = null;
      } catch (error) {
        this.captureError(error, "add entry");
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

    if (all.length === 0) {
      return [];
    }

    const now = Date.now();
    const oneDayMs = 86_400_000;

    const filtered: LongTermMemoryEntry[] = [];
    for (const entry of all) {
      if (
        parsedQuery.type &&
        entry.type.toLowerCase() !== parsedQuery.type.toLowerCase()
      ) {
        continue;
      }

      if (
        typeof parsedQuery.sinceTimestamp === "number" &&
        new Date(entry.timestamp).getTime() < parsedQuery.sinceTimestamp
      ) {
        continue;
      }

      if (parsedQuery.tags.length > 0) {
        const entryTags = new Set(entry.tags.map((tag) => tag.toLowerCase()));
        let allTagsMatch = true;
        for (const tag of parsedQuery.tags) {
          if (!entryTags.has(tag.toLowerCase())) {
            allTagsMatch = false;
            break;
          }
        }
        if (!allTagsMatch) {
          continue;
        }
      }

      filtered.push(entry);
    }

    const ranked: SearchResult[] = [];
    for (const entry of filtered) {
      const searchableText = `${entry.text} ${entry.tags.join(" ")}`;
      const score = scoreKeywordOverlap(parsedQuery.text, searchableText);
      const overlapCount = countKeywordOverlap(parsedQuery.text, searchableText);

      if (score < 0.15 || overlapCount < 1) {
        continue;
      }

      const entryAge = now - new Date(entry.timestamp).getTime();
      const recencyBonus = entryAge < oneDayMs ? 0.1 : entryAge < 7 * oneDayMs ? 0.05 : 0;

      ranked.push({ entry, score, overlapCount, recencyBonus });
    }

    ranked.sort(
      (left, right) =>
        right.score + right.recencyBonus - (left.score + left.recencyBonus),
    );

    return ranked.slice(0, limit).map((item) => item.entry);
  }

  /**
   * Waits for all queued writes to complete.
   * Returns true if all writes succeeded.
   */
  public async flush(): Promise<boolean> {
    await this.writeQueue;
    return this.lastError === null;
  }

  /**
   * Waits for all queued writes and prevents further writes.
   * Returns true if all writes succeeded.
   */
  public async dispose(): Promise<boolean> {
    this.disposed = true;
    await this.writeQueue;
    return this.lastError === null;
  }

  /**
   * Returns the last persistence error, or null if none occurred.
   */
  public getLastError(): Error | null {
    return this.lastError;
  }

  /**
   * Returns true if any persistence operation has failed.
   */
  public hasPersistenceError(): boolean {
    return this.lastError !== null;
  }

  private async evictOldest(): Promise<void> {
    if (!this.cache || this.cache.length <= MAX_ENTRIES) {
      return;
    }

    this.cache.sort(
      (a, b) =>
        new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
    );
    this.cache = this.cache.slice(this.cache.length - MAX_ENTRIES);

    const recovered = this.cache
      .map((e) => JSON.stringify(e))
      .join("\n");
    try {
      await fs.writeFile(
        this.filePath,
        `${recovered}${recovered ? "\n" : ""}`,
        "utf8",
      );
      this.cacheMtimeMs = Date.now();
      this.lastError = null;
    } catch (error) {
      // On write failure, reload cache from disk to stay consistent
      this.captureError(error, "evict oldest");
      try {
        const raw = await fs.readFile(this.filePath, "utf8");
        const lines = raw.split(/\r?\n/).filter((l) => l.trim());
        this.cache = lines.map((l) => JSON.parse(l) as LongTermMemoryEntry).filter(
          (e) => e && e.id && e.timestamp && e.type,
        );
      } catch {
        // File doesn't exist or is corrupt, start fresh
        this.cache = [];
      }
    }
  }

  private async readAll(): Promise<LongTermMemoryEntry[]> {
    await this.ensureFile();

    try {
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
    } catch (error) {
      this.captureError(error, "read all");
      return this.cache ?? [];
    }
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

  /**
   * Recover from corruption by writing the recovered lines back.
   * This runs through the write queue to avoid racing with concurrent adds.
   */
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

  private captureError(error: unknown, context: string): void {
    const err =
      error instanceof Error
        ? new Error(`LongTermMemoryStore ${context}: ${error.message}`)
        : new Error(`LongTermMemoryStore ${context}: ${String(error)}`);
    this.lastError = err;
    this.onError?.(err);
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
