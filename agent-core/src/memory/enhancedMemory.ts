import fs from "fs/promises";
import path from "path";

const MEMORY_DIR = ".nexcode-memory";
const MEMORY_INDEX = "MEMORY.md";
const MAX_MEMORY_LINES = 200;
const MAX_TOPIC_FILE_LINES = 50;

export interface MemoryEntry {
  topic: string;
  content: string;
  timestamp?: string;
  source?: string;
}

/**
 * Enhanced memory system with MEMORY.md index and topic-specific files.
 * Modeled after Claude Code's auto-memory pattern.
 * 
 * Structure:
 *   .nexcode-memory/
 *     MEMORY.md          # Index file with topic summaries
 *     topics/
 *       architecture.md  # Topic-specific notes
 *       conventions.md
 *       decisions.md
 *       ...
 */
export class EnhancedMemoryManager {
  private readonly memoryDir: string;
  private readonly topicsDir: string;
  private readonly indexPath: string;
  private indexContent = "";

  /**
   * @param storagePath - VS Code's globalStoragePath (NOT the workspace root)
   *                      Data is stored here, not in the user's project.
   */
  constructor(storagePath: string) {
    this.memoryDir = path.join(storagePath, "memory");
    this.topicsDir = path.join(this.memoryDir, "topics");
    this.indexPath = path.join(this.memoryDir, MEMORY_INDEX);
  }

  async initialize(): Promise<void> {
    try {
      await fs.mkdir(this.topicsDir, { recursive: true });
      this.indexContent = await fs.readFile(this.indexPath, "utf8").catch(() => "");
    } catch {
      // Best effort
    }
  }

  /**
   * Get memory context to inject into the agent's system prompt.
   */
  getContext(): string {
    if (!this.indexContent || this.indexContent.trim().length === 0) {
      return "";
    }

    const lines = this.indexContent.split("\n");
    if (lines.length > MAX_MEMORY_LINES) {
      const kept = lines.slice(-MAX_MEMORY_LINES);
      return `Project memory (recent, ${lines.length} total lines):\n${kept.join("\n")}`;
    }
    return `Project memory:\n${this.indexContent}`;
  }

  /**
   * Add a memory entry to a topic file and update the index.
   */
  async addEntry(entry: MemoryEntry): Promise<void> {
    const topicFile = this.getTopicFilePath(entry.topic);
    const timestamp = entry.timestamp || new Date().toISOString().slice(0, 19).replace("T", " ");
    const sourceNote = entry.source ? ` (from ${entry.source})` : "";
    const line = `- [${timestamp}]${sourceNote} ${entry.content}\n`;

    try {
      // Append to topic file
      await fs.mkdir(path.dirname(topicFile), { recursive: true });
      await fs.appendFile(topicFile, line, "utf8");

      // Update index if topic is new
      if (!this.indexContent.includes(`## ${entry.topic}`)) {
        const indexEntry = `\n## ${entry.topic}\n${entry.content.slice(0, 200)}\n`;
        this.indexContent += indexEntry;
        await this.writeIndex();
      }
    } catch {
      // Best effort
    }
  }

  /**
   * Get all entries for a specific topic.
   */
  async getTopicEntries(topic: string): Promise<string> {
    const topicFile = this.getTopicFilePath(topic);
    try {
      const content = await fs.readFile(topicFile, "utf8");
      const lines = content.split("\n");
      if (lines.length > MAX_TOPIC_FILE_LINES) {
        return lines.slice(-MAX_TOPIC_FILE_LINES).join("\n");
      }
      return content;
    } catch {
      return "";
    }
  }

  /**
   * Search across all topic files for relevant entries.
   */
  async search(query: string, limit = 10): Promise<string> {
    const results: Array<{ topic: string; line: string; score: number }> = [];
    const queryLower = query.toLowerCase();
    const queryWords = queryLower.split(/\s+/).filter(w => w.length > 2);

    try {
      const files = await fs.readdir(this.topicsDir);
      for (const file of files) {
        if (!file.endsWith(".md")) continue;
        const topic = file.replace(".md", "");
        const content = await fs.readFile(path.join(this.topicsDir, file), "utf8");
        const lines = content.split("\n");

        for (const line of lines) {
          if (!line.trim() || line.startsWith("#")) continue;
          const lineLower = line.toLowerCase();
          const score = queryWords.reduce((sum, word) => sum + (lineLower.includes(word) ? 1 : 0), 0);
          if (score > 0) {
            results.push({ topic, line: line.trim(), score });
          }
        }
      }
    } catch {
      // Best effort
    }

    results.sort((a, b) => b.score - a.score);
    return results
      .slice(0, limit)
      .map(r => `[${r.topic}] ${r.line}`)
      .join("\n");
  }

  /**
   * Prune memory to stay under limits.
   */
  async prune(): Promise<void> {
    try {
      const files = await fs.readdir(this.topicsDir);
      for (const file of files) {
        if (!file.endsWith(".md")) continue;
        const filePath = path.join(this.topicsDir, file);
        const content = await fs.readFile(filePath, "utf8");
        const lines = content.split("\n");
        if (lines.length > MAX_TOPIC_FILE_LINES) {
          const kept = lines.slice(-MAX_TOPIC_FILE_LINES);
          await fs.writeFile(filePath, kept.join("\n"), "utf8");
        }
      }

      // Prune index
      const indexLines = this.indexContent.split("\n");
      if (indexLines.length > MAX_MEMORY_LINES) {
        this.indexContent = indexLines.slice(-MAX_MEMORY_LINES).join("\n");
        await this.writeIndex();
      }
    } catch {
      // Best effort
    }
  }

  private getTopicFilePath(topic: string): string {
    const sanitized = topic.replace(/[^a-zA-Z0-9-_]/g, "_").toLowerCase();
    return path.join(this.topicsDir, `${sanitized}.md`);
  }

  private async writeIndex(): Promise<void> {
    const header = `# Project Memory\n\nThis file is an index of project-specific knowledge. Updated automatically.\n\n`;
    try {
      await fs.writeFile(this.indexPath, header + this.indexContent, "utf8");
    } catch {
      // Best effort
    }
  }
}
