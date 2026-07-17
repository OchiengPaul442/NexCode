export class TokenCounter {
  private totalInputTokens = 0;
  private totalOutputTokens = 0;
  private requestCount = 0;

  estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  trackRequest(input: string, output: string): void {
    this.totalInputTokens += this.estimateTokens(input);
    this.totalOutputTokens += this.estimateTokens(output);
    this.requestCount++;
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
  }
}
