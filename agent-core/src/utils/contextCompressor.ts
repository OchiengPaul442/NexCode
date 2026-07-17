export class ContextCompressor {
  private maxContextChars: number;

  constructor(maxContextChars: number = 8000) {
    this.maxContextChars = maxContextChars;
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

    if (lines.length <= 100) {
      return content;
    }

    const head = lines.slice(0, 20).join("\n");
    const tail = lines.slice(-20).join("\n");
    const omitted = lines.length - 40;

    return `// ${filePath} (${lines.length} lines total)\n${head}\n\n// ... ${omitted} lines omitted ...\n\n${tail}`;
  }

  deduplicateContext(contexts: string[]): string[] {
    const seen = new Set<string>();
    return contexts.filter((ctx) => {
      const key = ctx.slice(0, 100);
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
  }
}
