import { type ChatMessage, type ProviderUsage, type ToolCallRequestTool } from "../types";

export const OVERHEAD_PER_MESSAGE = 4;
export const TOOL_SCHEMA_OVERHEAD = 200;
export const MIN_OUTPUT_RESERVE = 4096;
export const SAFETY_MARGIN = 1024;

/**
 * Default chars-per-token ratio. The old heuristic used 4.0 uniformly.
 * Real tokenizers vary: BPE models average ~3.5-4.2 for English prose,
 * ~2.5-3.5 for code, and ~3-5 for structured JSON. We default to 3.8
 * as a slightly more accurate baseline for mixed code/prose content.
 */
const DEFAULT_CHARS_PER_TOKEN = 3.8;

/**
 * Exponential moving average smoothing factor for provider usage calibration.
 * Higher = more weight on recent observations. 0.3 = 30% new, 70% old.
 */
const CALIBRATION_ALPHA = 0.3;

/**
 * Minimum observations before we trust the calibrated ratio over the default.
 */
const MIN_CALIBRATION_SAMPLES = 5;

/**
 * Clamp bounds for the calibrated chars-per-token ratio.
 * Prevents extreme values from pathological inputs.
 */
const MIN_CHARS_PER_TOKEN = 1.5;
const MAX_CHARS_PER_TOKEN = 6.0;

export class TokenCounter {
  private totalInputTokens = 0;
  private totalOutputTokens = 0;
  private requestCount = 0;
  private turnInputTokens = 0;
  private turnOutputTokens = 0;
  private turnRequestCount = 0;

  /**
   * Calibrated chars-per-token ratio. Starts at DEFAULT_CHARS_PER_TOKEN
   * and is updated via exponential moving average as real provider usage
   * data becomes available through recordProviderUsage().
   */
  private calibratedCharsPerToken: number = DEFAULT_CHARS_PER_TOKEN;
  private calibrationSampleCount = 0;

  /**
   * Estimates token count for a text string.
   * Uses the calibrated chars-per-token ratio (updated by real provider
   * usage data when available), falling back to the static default.
   */
  estimateTokens(text: string): number {
    return Math.max(1, Math.ceil(text.length / this.calibratedCharsPerToken));
  }

  /**
   * Records real provider-reported usage to calibrate the estimation ratio.
   * Uses exponential moving average: newRatio = alpha * observedRatio + (1 - alpha) * oldRatio.
   * This converges to the true ratio over time while remaining stable.
   *
   * @param textChars - The character count of the input text sent to the provider.
   * @param usage - Provider-reported token usage from the API response.
   */
  recordProviderUsage(textChars: number, usage: ProviderUsage): void {
    if (textChars <= 0 || usage.promptTokens <= 0) return;

    const observedRatio = textChars / usage.promptTokens;

    // Clamp to reasonable bounds to prevent pathological calibration
    const clampedRatio = Math.max(MIN_CHARS_PER_TOKEN, Math.min(MAX_CHARS_PER_TOKEN, observedRatio));

    if (this.calibrationSampleCount === 0) {
      this.calibratedCharsPerToken = clampedRatio;
    } else {
      this.calibratedCharsPerToken =
        CALIBRATION_ALPHA * clampedRatio + (1 - CALIBRATION_ALPHA) * this.calibratedCharsPerToken;
    }
    this.calibrationSampleCount++;
  }

  /**
   * Returns true if enough calibration samples have been collected
   * to trust the calibrated ratio over the default.
   */
  isCalibrated(): boolean {
    return this.calibrationSampleCount >= MIN_CALIBRATION_SAMPLES;
  }

  /**
   * Returns the current calibrated chars-per-token ratio.
   * Useful for diagnostics and tests.
   */
  getCharsPerToken(): number {
    return this.calibratedCharsPerToken;
  }

  /**
   * NC-041: Sets a model-specific chars-per-token ratio from the
   * ModelCapabilityRegistry. This overrides the default before any
   * provider usage calibration occurs. Calibration will further
   * refine this value over time.
   *
   * @param ratio - The model's known chars-per-token ratio.
   */
  setCharsPerToken(ratio: number): void {
    this.calibratedCharsPerToken = Math.max(MIN_CHARS_PER_TOKEN, Math.min(MAX_CHARS_PER_TOKEN, ratio));
  }

  /**
   * Returns the number of calibration samples collected.
   */
  getCalibrationSampleCount(): number {
    return this.calibrationSampleCount;
  }

  estimateRequestTokens(
    messages: ChatMessage[],
    tools?: ToolCallRequestTool[],
  ): number {
    let tokens = 0;

    for (const msg of messages) {
      tokens += this.estimateTokens(msg.content);
      tokens += OVERHEAD_PER_MESSAGE;
      if (msg.tool_calls) {
        for (const tc of msg.tool_calls) {
          tokens += this.estimateTokens(tc.function.arguments);
        }
      }
    }

    if (tools && tools.length > 0) {
      tokens += tools.length * TOOL_SCHEMA_OVERHEAD;
    }

    return tokens;
  }

  calculateInputBudget(
    contextWindow: number,
    maxOutputTokens?: number,
  ): number {
    const outputReserve = Math.max(
      MIN_OUTPUT_RESERVE,
      maxOutputTokens ?? MIN_OUTPUT_RESERVE,
    );
    return Math.max(0, contextWindow - outputReserve - SAFETY_MARGIN);
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

  /**
   * NC-041: Track a request using provider-reported usage data when available.
   * This simultaneously records accurate token counts AND calibrates the
   * estimation heuristic for future requests.
   *
   * @param inputChars - Character count of the input sent to the provider.
   * @param outputChars - Character count of the output received.
   * @param usage - Provider-reported token usage (from API response).
   */
  trackRequestWithUsage(
    inputChars: number,
    outputChars: number,
    usage: ProviderUsage,
  ): void {
    // Use real token counts from the provider
    this.totalInputTokens += usage.promptTokens;
    this.totalOutputTokens += usage.completionTokens;
    this.requestCount++;
    this.turnInputTokens += usage.promptTokens;
    this.turnOutputTokens += usage.completionTokens;
    this.turnRequestCount++;

    // Calibrate the estimation ratio for future requests
    this.recordProviderUsage(inputChars, usage);
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
      charsPerToken: this.calibratedCharsPerToken,
      calibrationSamples: this.calibrationSampleCount,
    };
  }

  reset(): void {
    this.totalInputTokens = 0;
    this.totalOutputTokens = 0;
    this.requestCount = 0;
    this.turnInputTokens = 0;
    this.turnOutputTokens = 0;
    this.turnRequestCount = 0;
    this.calibratedCharsPerToken = DEFAULT_CHARS_PER_TOKEN;
    this.calibrationSampleCount = 0;
  }
}
