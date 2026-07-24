export class SessionCompressor {
  private maxMessages: number;
  private maxCharsPerMessage: number;

  constructor(maxMessages: number = 20, maxCharsPerMessage: number = 2000) {
    this.maxMessages = Math.max(3, maxMessages);
    this.maxCharsPerMessage = maxCharsPerMessage;
  }

  compressSession(
    messages: Array<{ role: string; text: string; attachments?: any[] }>,
  ): Array<{ role: string; text: string }> {
    if (messages.length <= this.maxMessages) {
      return messages;
    }

    const recentCount = this.maxMessages - 3;
    const firstTwo = messages.slice(0, 2);
    const recent = messages.slice(-recentCount);
    const middle = messages.slice(2, -recentCount);
    const summary = this.summarizeMessages(middle);

    return [
      ...firstTwo,
      {
        role: "system",
        text: `[Context: ${middle.length} earlier messages summarized] ${summary}`,
      },
      ...recent,
    ];
  }

  private summarizeMessages(
    messages: Array<{ role: string; text: string }>,
  ): string {
    const topics = new Set<string>();
    const actions = new Set<string>();
    const files = new Set<string>();
    const STOP_WORDS = new Set([
      "the", "and", "for", "that", "this", "with", "from", "have", "been",
      "are", "was", "were", "will", "would", "could", "should", "about",
      "their", "there", "than", "then", "them", "they", "these", "those",
      "your", "you", "what", "when", "where", "which", "who", "how", "can",
      "may", "not", "but", "also", "just", "only", "very", "into", "over",
      "such", "some", "more", "other", "each", "every", "most", "any",
    ]);
    const ACTION_VERBS = new Set([
      "fix", "add", "create", "update", "delete", "refactor", "implement", "build",
      "test", "deploy", "review", "explain", "analyze", "optimize", "debug", "configure",
      "setup", "generate", "write", "read", "search", "run", "execute", "install",
      "move", "rename", "replace", "check", "verify", "validate", "commit", "merge",
      "push", "pull", "fetch", "clone", "init", "start", "stop", "restart", "enable",
      "disable", "toggle", "switch", "select", "choose", "pick", "open", "close",
      "show", "hide", "expand", "collapse", "increase", "decrease", "reduce", "improve",
      "enhance", "simplify", "clean", "remove", "extract", "split", "combine", "sort",
      "filter", "group", "transform", "convert", "parse", "format", "encode", "decode",
      "encrypt", "decrypt", "compress", "upload", "download", "sync", "connect",
      "disconnect", "send", "receive", "load", "save", "export", "import", "backup",
      "restore", "migrate", "upgrade", "downgrade", "patch", "rollback", "revert",
      "reset", "clear", "flush", "purge", "archive", "lock", "unlock", "approve",
      "reject", "accept", "deny", "grant", "revoke", "allow", "forbid", "permit",
      "restrict", "limit", "schedule", "cancel", "abort", "retry", "skip", "pass",
      "fail", "monitor", "track", "measure", "profile", "inspect", "scan", "find",
      "locate", "discover", "explore", "browse", "navigate",
    ]);
    const FILE_PATTERN = /\b[\w\-./]+\.(ts|tsx|js|jsx|json|md|txt|py|rb|go|rs|java|c|cpp|h|hpp|css|scss|html|xml|yaml|yml|toml|cfg|ini|env|sh|bash|zsh|fish|ps1|cmd|bat)\b/g;

    for (const msg of messages) {
      const words = msg.text.toLowerCase().split(/\s+/);
      for (const word of words) {
        const cleaned = word.replace(/[^a-z0-9._/-]/g, "");
        if (cleaned.length > 3 && !STOP_WORDS.has(cleaned)) {
          if (ACTION_VERBS.has(cleaned)) {
            actions.add(cleaned);
          } else if (cleaned.length > 5) {
            topics.add(cleaned);
          }
        }
      }
      const fileMatches = msg.text.match(FILE_PATTERN);
      if (fileMatches) {
        for (const f of fileMatches) {
          files.add(f);
        }
      }
    }

    const parts: string[] = [];
    if (actions.size > 0) {
      parts.push(`Actions discussed: ${Array.from(actions).slice(0, 6).join(", ")}`);
    }
    if (topics.size > 0) {
      parts.push(`Topics: ${Array.from(topics).slice(0, 8).join(", ")}`);
    }
    if (files.size > 0) {
      parts.push(`Files involved: ${Array.from(files).slice(0, 5).join(", ")}`);
    }
    if (parts.length === 0) {
      parts.push("Earlier conversation context.");
    }

    return parts.join(". ") + ".";
  }

  compressMessage(text: string): string {
    if (text.length <= this.maxCharsPerMessage) {
      return text;
    }

    const paragraphs = text.split("\n\n");
    if (paragraphs.length > 2) {
      return `${paragraphs[0]}\n\n[... ${paragraphs.length - 2} paragraphs omitted ...]\n\n${paragraphs[paragraphs.length - 1]}`;
    }

    return text.slice(0, this.maxCharsPerMessage) + "\n\n[Message truncated]";
  }
}
