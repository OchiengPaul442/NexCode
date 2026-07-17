export class TokenCounter {
  private totalInputTokens = 0;
  private totalOutputTokens = 0;
  private requestCount = 0;
  private turnInputTokens = 0;
  private turnOutputTokens = 0;
  private turnRequestCount = 0;

  estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  trackRequest(input: string, output: string): void {
    const inputTokens = this.estimateTokens(input);
    const outputTokens = this.estimateTokens(output);
    this.totalInputTokens += inputTokens;
    this.totalOutputTokens += outputTokens;
    this.requestCount++;
    this.turnInputTokens += inputTokens;
    this.turnOutputTokens += outputTokens;
    this.turnRequestCount++;
  }

  startNewTurn(): void {
    this.turnInputTokens = 0;
    this.turnOutputTokens = 0;
    this.turnRequestCount = 0;
  }

  getTurnStats() {
    return {
      input: this.turnInputTokens,
      output: this.turnOutputTokens,
      total: this.turnInputTokens + this.turnOutputTokens,
      requests: this.turnRequestCount,
    };
  }

  getStats() {
    return {
      totalInput: this.totalInputTokens,
      totalOutput: this.totalOutputTokens,
      total: this.totalInputTokens + this.totalOutputTokens,
      requests: this.requestCount,
      avgInputPerRequest:
        this.requestCount > 0
          ? Math.round(this.totalInputTokens / this.requestCount)
          : 0,
    };
  }

  reset(): void {
    this.totalInputTokens = 0;
    this.totalOutputTokens = 0;
    this.requestCount = 0;
    this.turnInputTokens = 0;
    this.turnOutputTokens = 0;
    this.turnRequestCount = 0;
  }
}
