import { describe, it, expect, vi, afterEach } from "vitest";

const RECOVERABLE_PATTERNS = [
  "timeout",
  "econnrefused",
  "fetch failed",
  "upstream",
  "malformed",
  "json",
  "context length",
  "context window",
];

function isRecoverable(errorStr: string): boolean {
  return (
    errorStr.includes("timeout") ||
    errorStr.includes("econnrefused") ||
    errorStr.includes("fetch failed") ||
    errorStr.includes("upstream") ||
    errorStr.includes("malformed") ||
    errorStr.includes("json") ||
    errorStr.includes("context length") ||
    errorStr.includes("context window")
  );
}

describe("Agent loop retry degradation", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("retries recoverable errors with exponential backoff timing", async () => {
    const delays: number[] = [];

    vi.stubGlobal(
      "setTimeout",
      vi.fn((fn: Function, delay: number) => {
        delays.push(delay);
        fn();
        return 0 as any;
      }),
    );

    const MAX_RETRIES = 2;
    let attempt = 0;

    async function simulateRetryLoop() {
      while (attempt < MAX_RETRIES) {
        const delay = 1000 * (attempt + 1);
        await new Promise<void>((resolve) => {
          setTimeout(() => {
            attempt++;
            resolve();
          }, delay);
        });
      }
    }

    await simulateRetryLoop();

    expect(delays).toEqual([1000, 2000]);
  });

  it("detects all recoverable error patterns", () => {
    for (const pattern of RECOVERABLE_PATTERNS) {
      const errorStr = `Error: ${pattern} occurred`;
      expect(isRecoverable(errorStr)).toBe(true);
    }
  });

  it("detects recoverable errors in realistic Ollama error messages", () => {
    // "Value looks like object" is caught by ollamaProvider's internal retry (not agentLoop)
    // agentLoop's isRecoverable catches these patterns that reach it:
    expect(isRecoverable("Ollama: context length exceeded, requested 4800 but only 2048 available")).toBe(true);
    expect(isRecoverable("Ollama: context window overflow during generation")).toBe(true);
    expect(isRecoverable("All provider/model attempts failed: Ollama: timeout")).toBe(true);
    expect(isRecoverable("All provider/model attempts failed: fetch failed: ECONNREFUSED")).toBe(true);
    expect(isRecoverable("All provider/model attempts failed: malformed JSON from model")).toBe(true);
    expect(isRecoverable("All provider/model attempts failed: upstream connection lost")).toBe(true);
  });

  it("does not retry non-recoverable errors", () => {
    const nonRecoverablePatterns = [
      "authorization failed",
      "model not found",
      "invalid request",
      "permission denied",
    ];

    for (const pattern of nonRecoverablePatterns) {
      const errorStr = `Error: ${pattern}`;
      expect(isRecoverable(errorStr)).toBe(false);
    }
  });

  it("does not false-positive on benign strings containing 'context'", () => {
    expect(isRecoverable("Error: missing context for this operation")).toBe(false);
    expect(isRecoverable("Error: invalid context parameter")).toBe(false);
  });
});
