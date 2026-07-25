import fs from "fs/promises";
import path from "path";

/**
 * Memory entry types.
 */
export type MemoryEntryType = 
  | "file-pattern" 
  | "convention" 
  | "structure" 
  | "workflow" 
  | "error-pattern";

/**
 * A single memory entry.
 */
export interface MemoryEntry {
  id: string;
  type: MemoryEntryType;
  key: string;
  value: string;
  timestamp: number;
  confidence: number;
  tags: string[];
}

/**
 * Auto-memory system that learns project conventions across sessions.
 * 
 * Features:
 * - Track file patterns, coding conventions, project structure
 * - Learn from successful operations
 * - Store in .opencode/memory/ directory
 * - Index for fast retrieval
 */
export class AutoMemory {
  private readonly memoryDir: string;
  private entries: Map<string, MemoryEntry> = new Map();
  private loaded = false;

  constructor(workspaceRoot: string) {
    this.memoryDir = path.join(workspaceRoot, ".opencode", "memory");
  }

  /**
   * Load memory from disk.
   */
  async load(): Promise<void> {
    if (this.loaded) return;

    try {
      await fs.mkdir(this.memoryDir, { recursive: true });
      const indexPath = path.join(this.memoryDir, "index.json");
      
      try {
        const content = await fs.readFile(indexPath, "utf8");
        const data = JSON.parse(content);
        if (Array.isArray(data)) {
          for (const entry of data) {
            this.entries.set(entry.id, entry);
          }
        }
      } catch {
        // No index file yet
      }

      this.loaded = true;
    } catch {
      // Best effort
      this.loaded = true;
    }
  }

  /**
   * Save memory to disk.
   */
  async save(): Promise<void> {
    try {
      await fs.mkdir(this.memoryDir, { recursive: true });
      const indexPath = path.join(this.memoryDir, "index.json");
      const data = Array.from(this.entries.values());
      await fs.writeFile(indexPath, JSON.stringify(data, null, 2), "utf8");
    } catch {
      // Best effort
    }
  }

  /**
   * Add a memory entry.
   */
  async addEntry(
    type: MemoryEntryType,
    key: string,
    value: string,
    tags: string[] = [],
  ): Promise<void> {
    const id = `${type}-${key}-${Date.now()}`;
    const entry: MemoryEntry = {
      id,
      type,
      key,
      value,
      timestamp: Date.now(),
      confidence: 1.0,
      tags,
    };

    this.entries.set(id, entry);
    await this.save();
  }

  /**
   * Search memory entries.
   */
  search(query: string, limit = 10): MemoryEntry[] {
    const queryLower = query.toLowerCase();
    const results: Array<{ entry: MemoryEntry; score: number }> = [];

    for (const entry of this.entries.values()) {
      let score = 0;

      // Score by key match
      if (entry.key.toLowerCase().includes(queryLower)) {
        score += 10;
      }

      // Score by value match
      if (entry.value.toLowerCase().includes(queryLower)) {
        score += 5;
      }

      // Score by tag match
      for (const tag of entry.tags) {
        if (tag.toLowerCase().includes(queryLower)) {
          score += 3;
        }
      }

      // Score by recency (newer = higher score)
      const age = Date.now() - entry.timestamp;
      const recencyScore = Math.max(0, 1 - age / (30 * 24 * 60 * 60 * 1000)); // 30 days
      score += recencyScore * 2;

      // Score by confidence
      score *= entry.confidence;

      if (score > 0) {
        results.push({ entry, score });
      }
    }

    // Sort by score descending
    results.sort((a, b) => b.score - a.score);

    return results.slice(0, limit).map((r) => r.entry);
  }

  /**
   * Get memory context for injection into prompts.
   */
  getContext(maxChars = 2000): string {
    const entries = Array.from(this.entries.values())
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, 20);

    if (entries.length === 0) return "";

    const lines = entries.map((e) => {
      const age = Math.floor((Date.now() - e.timestamp) / (24 * 60 * 60 * 1000));
      return `- [${e.type}] ${e.key}: ${e.value.slice(0, 100)} (${age}d ago)`;
    });

    const context = `Project memory:\n${lines.join("\n")}`;
    return context.slice(0, maxChars);
  }

  /**
   * Learn from a successful operation.
   */
  async learnFromOperation(
    operation: string,
    result: string,
    files: string[] = [],
  ): Promise<void> {
    // Extract file patterns
    for (const file of files) {
      const ext = path.extname(file);
      if (ext) {
        await this.addEntry("file-pattern", ext, `Files with ${ext} extension`, ["file-extension"]);
      }
    }

    // Extract conventions from successful operations
    if (result.includes("success") || result.includes("completed")) {
      await this.addEntry("workflow", operation, result.slice(0, 200), ["successful"]);
    }
  }

  /**
   * Prune old or low-confidence entries.
   */
  async prune(maxAge = 30 * 24 * 60 * 60 * 1000): Promise<void> {
    const now = Date.now();
    const toDelete: string[] = [];

    for (const [id, entry] of this.entries) {
      if (now - entry.timestamp > maxAge || entry.confidence < 0.3) {
        toDelete.push(id);
      }
    }

    for (const id of toDelete) {
      this.entries.delete(id);
    }

    if (toDelete.length > 0) {
      await this.save();
    }
  }
}
