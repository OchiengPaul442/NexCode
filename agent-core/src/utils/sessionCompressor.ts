export class SessionCompressor {
  private maxMessages: number;
  private maxCharsPerMessage: number;

  constructor(maxMessages: number = 20, maxCharsPerMessage: number = 2000) {
    this.maxMessages = maxMessages;
    this.maxCharsPerMessage = maxCharsPerMessage;
  }

  compressSession(
    messages: Array<{ role: string; text: string; attachments?: any[] }>,
  ): Array<{ role: string; text: string }> {
    if (messages.length <= this.maxMessages) {
      return messages;
    }

    const recentCount = this.maxMessages - 2;
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
    for (const msg of messages) {
      const words = msg.text.toLowerCase().split(/\s+/);
      for (const word of words) {
        if (
          word.length > 5 &&
          !/^(the|and|for|that|this|with|from|have|been)/.test(word)
        ) {
          topics.add(word);
        }
      }
    }

    return `Discussion covered: ${Array.from(topics).slice(0, 10).join(", ")}.`;
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
