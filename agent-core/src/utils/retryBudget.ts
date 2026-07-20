/**
 * RetryBudget — shared retry budget across provider, router, and agent-loop
 * retry layers.
 *
 * Without a shared budget, retries multiply across layers:
 *   AgentLoop (3) × RouterCandidates (N) × HTTPRetries (3) = up to 9+ fetches
 *
 * The RetryBudget tracks total attempts across all layers. Each layer checks
 * `canAttempt()` before making a request and calls `recordAttempt()` after.
 * When the budget is exhausted, retries stop — preventing unbounded latency
 * and cost multiplication.
 *
 * Usage:
 *   const budget = new RetryBudget(8); // max 8 total fetches per agent turn
 *   // Pass through ProviderGenerateOptions.retryBudget
 *   // Each layer calls budget.canAttempt() before trying and budget.recordAttempt() after.
 */

export interface RetryBudgetConfig {
  /** Maximum total attempts allowed across all layers. Default: 8. */
  maxAttempts: number;
}

export class RetryBudget {
  private attempts = 0;
  private readonly maxAttempts: number;

  public constructor(maxAttemptsOrConfig: number | RetryBudgetConfig = 8) {
    if (typeof maxAttemptsOrConfig === "number") {
      this.maxAttempts = maxAttemptsOrConfig;
    } else {
      this.maxAttempts = maxAttemptsOrConfig.maxAttempts;
    }
  }

  /**
   * Returns true if another attempt is allowed within the budget.
   * Does NOT consume the budget — call recordAttempt() after the attempt.
   */
  public canAttempt(): boolean {
    return this.attempts < this.maxAttempts;
  }

  /**
   * Records one attempt. Call this after each HTTP fetch / provider call,
   * regardless of success or failure.
   */
  public recordAttempt(): void {
    this.attempts += 1;
  }

  /**
   * Returns the number of attempts consumed so far.
   */
  public getAttemptsUsed(): number {
    return this.attempts;
  }

  /**
   * Returns the maximum attempts allowed.
   */
  public getMaxAttempts(): number {
    return this.maxAttempts;
  }

  /**
   * Returns the number of remaining attempts.
   */
  public getRemaining(): number {
    return Math.max(0, this.maxAttempts - this.attempts);
  }

  /**
   * Returns a snapshot of the budget state for diagnostics.
   */
  public getSnapshot(): { used: number; max: number; remaining: number } {
    return {
      used: this.attempts,
      max: this.maxAttempts,
      remaining: this.getRemaining(),
    };
  }
}

/**
 * Creates a default retry budget for an agent turn.
 * 8 attempts covers the common case (1 explicit + 2 HTTP retries) with
 * headroom for one fallback candidate, without allowing unbounded multiplication.
 */
export function createDefaultRetryBudget(): RetryBudget {
  return new RetryBudget(8);
}
