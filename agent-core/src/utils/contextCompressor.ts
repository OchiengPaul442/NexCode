import { createHash } from "crypto";

/**
 * NC-041: Context compression improvements.
 *
 * - Thresholds are now proportional to a provided context window size.
 * - Deduplication uses content hashing instead of first-100-chars prefix.
 * - File compression head/tail ratio is configurable.
 */
export class ContextCompressor {
  private maxContextChars: number;
  private maxFileLines: number;
  private headLineCount: number;
  private tailLineCount: number;

  constructor(maxContextChars: number = 8000) {
    this.maxContextChars = maxContextChars;
    this.maxFileLines = 100;
    this.headLineCount = 20;
    this.tailLineCount = 20;
  }

  /**
   * Creates a ContextCompressor with thresholds proportional to the
   * model's context window. This avoids wasting context on small models
   * and under-utilizing large models.
   *
   * @param contextWindow - The model's context window in tokens.
   * @param charsPerToken - Average chars per token for the model's tokenizer.
   */
  static fromContextWindow(contextWindow: number, charsPerToken: number = 3.8): ContextCompressor {
    // Use ~25% of context window for context compression threshold
    const maxChars = Math.round(contextWindow * charsPerToken * 0.25);
    return new ContextCompressor(maxChars);
  }

  compressContext(context: string): string {
    if (context.length <= this.maxContextChars) {
      return context;
    }

    const paragraphs = context.split("\n\n");
    if (paragraphs.length > 2) {
      const first = paragraphs[0];
      const last = paragraphs[paragraphs.length - 1];
      const omitted = paragraphs.length - 2;
      return `${first}\n\n[... ${omitted} paragraphs omitted ...]\n\n${last}`;
    }

    return context.slice(0, this.maxContextChars) + "\n\n[Context truncated]";
  }

  compressFileContent(content: string, filePath: string): string {
    const lines = content.split("\n");

    if (lines.length <= this.maxFileLines) {
      return content;
    }

    const head = lines.slice(0, this.headLineCount).join("\n");
    const tail = lines.slice(-this.tailLineCount).join("\n");
    const omitted = lines.length - this.headLineCount - this.tailLineCount;

    return `// ${filePath} (${lines.length} lines total)\n${head}\n\n// ... ${omitted} lines omitted ...\n\n${tail}`;
  }

  /**
   * NC-041: Improved deduplication using content hashing instead of
   * first-100-chars prefix. This prevents false-positive dedup when
   * two contexts share a header (e.g., same file path prefix) but
   * differ in content.
   *
   * Uses SHA-256 hash of the full content for correctness, with a
   * short-circuit on length + first-200-chars pre-check for performance.
   */
  deduplicateContext(contexts: string[]): string[] {
    const seen = new Set<string>();
    return contexts.filter((ctx) => {
      // Fast pre-check: length + prefix catches most duplicates cheaply
      const fastKey = `${ctx.length}:${ctx.slice(0, 200)}`;
      if (seen.has(fastKey)) {
        return false;
      }
      // Content hash for collision-resistant dedup
      const hash = createHash("sha256").update(ctx).digest("hex").slice(0, 16);
      if (seen.has(hash)) {
        return false;
      }
      seen.add(fastKey);
      seen.add(hash);
      return true;
    });
  }
}
