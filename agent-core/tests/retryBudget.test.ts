/**
 * NC-040 regression tests — RetryBudget prevents unbounded retry multiplication
 * across provider, router, and agent-loop layers.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  RetryBudget,
  createDefaultRetryBudget,
  type RetryBudgetConfig,
} from "../src/utils/retryBudget";
import { ModelRouter } from "../src/providers/modelRouter";
import type {
  ModelProvider,
  ModelResponse,
  ModelRequest,
  ProviderId,
} from "../src/types";

// ─── RetryBudget unit tests ────────────────────────────────────────────────

describe("RetryBudget", () => {
  it("starts with zero attempts used", () => {
    const budget = new RetryBudget(5);
    expect(budget.canAttempt()).toBe(true);
    expect(budget.getAttemptsUsed()).toBe(0);
    expect(budget.getRemaining()).toBe(5);
  });

  it("tracks attempts correctly", () => {
    const budget = new RetryBudget(3);
    budget.recordAttempt();
    expect(budget.getAttemptsUsed()).toBe(1);
    expect(budget.getRemaining()).toBe(2);
    expect(budget.canAttempt()).toBe(true);

    budget.recordAttempt();
    expect(budget.getAttemptsUsed()).toBe(2);
    expect(budget.getRemaining()).toBe(1);
    expect(budget.canAttempt()).toBe(true);

    budget.recordAttempt();
    expect(budget.getAttemptsUsed()).toBe(3);
    expect(budget.getRemaining()).toBe(0);
    expect(budget.canAttempt()).toBe(false);
  });

  it("rejects attempts beyond max", () => {
    const budget = new RetryBudget(1);
    budget.recordAttempt();
    expect(budget.canAttempt()).toBe(false);
    budget.recordAttempt(); // does not throw
    expect(budget.getAttemptsUsed()).toBe(2);
    expect(budget.getRemaining()).toBe(0);
  });

  it("accepts RetryBudgetConfig object", () => {
    const config: RetryBudgetConfig = { maxAttempts: 12 };
    const budget = new RetryBudget(config);
    expect(budget.getMaxAttempts()).toBe(12);
    expect(budget.getRemaining()).toBe(12);
  });

  it("getSnapshot returns correct state", () => {
    const budget = new RetryBudget(8);
    expect(budget.getSnapshot()).toEqual({ used: 0, max: 8, remaining: 8 });
    budget.recordAttempt();
    budget.recordAttempt();
    expect(budget.getSnapshot()).toEqual({ used: 2, max: 8, remaining: 6 });
  });

  it("createDefaultRetryBudget creates budget with 8 max attempts", () => {
    const budget = createDefaultRetryBudget();
    expect(budget.getMaxAttempts()).toBe(8);
    expect(budget.canAttempt()).toBe(true);
  });
});

// ─── ModelRouter retry budget integration tests ─────────────────────────────

/** Minimal mock provider that records how many times generate() was called. */
function createMockProvider(
  id: ProviderId,
  shouldFail = false,
): ModelProvider & { callCount: number } {
  const mock = {
    id,
    callCount: 0,
    generate: vi.fn(async (req: ModelRequest): Promise<ModelResponse> => {
      mock.callCount++;
      // Simulate real provider behavior: consume one budget attempt per call
      if (req.retryBudget) {
        req.retryBudget.recordAttempt();
      }
      if (shouldFail) {
        throw new Error(`${id} simulated failure`);
      }
      return { text: `response from ${id}`, toolCalls: [] };
    }),
    stream: undefined,
  };
  return mock;
}

describe("ModelRouter with RetryBudget", () => {
  it("passes retryBudget through to provider.generate()", async () => {
    const retryBudget = new RetryBudget(5);
    const provider = createMockProvider("ollama");

    const router = new ModelRouter(
      { ollama: provider as unknown as ModelProvider } as Record<ProviderId, ModelProvider>,
      { defaultProvider: "ollama", defaultModel: "test-model", defaultCloudModel: "test-model" },
    );

    await router.generate([{ role: "user", content: "hello" }], {
      model: "test-model",
      retryBudget,
    });

    expect(provider.generate).toHaveBeenCalledTimes(1);
    const passedOptions = (provider.generate as any).mock.calls[0][0];
    expect(passedOptions.retryBudget).toBe(retryBudget);
    // Mock consumes the budget (simulating real provider behavior)
    expect(retryBudget.getAttemptsUsed()).toBeGreaterThanOrEqual(1);
  });

  it("stops trying candidates when budget exhausted", async () => {
    // Budget of 1 means only 1 HTTP-level attempt allowed.
    // With 2 failing providers, the budget should be exhausted after the first.
    const retryBudget = new RetryBudget(1);

    const provider1 = createMockProvider("ollama", true);
    const provider2 = createMockProvider("openai-compatible", true);

    const router = new ModelRouter(
      {
        ollama: provider1 as unknown as ModelProvider,
        "openai-compatible": provider2 as unknown as ModelProvider,
      } as Record<ProviderId, ModelProvider>,
      {
        defaultProvider: "ollama",
        defaultModel: "test-model",
        defaultCloudModel: "test-model",
        fallbackCandidates: [
          { providerId: "openai-compatible", model: "test-model" },
        ],
      },
    );

    await expect(
      router.generate([{ role: "user", content: "hello" }], {
        model: "test-model",
        retryBudget,
      }),
    ).rejects.toThrow();

    // Provider 1 should be called (budget had 1 attempt), but provider 2
    // should be skipped because the ModelRouter checks canAttempt() before
    // each candidate. After provider1's generate() consumes the budget check,
    // the router skips provider2.
    expect(provider1.callCount).toBe(1);
    // The budget is not consumed by mock providers (they don't call
    // fetchWithRetries), so we verify the router skipped provider2.
    expect(provider2.callCount).toBe(0);
  });

  it("allows multiple candidates when budget is sufficient", async () => {
    const retryBudget = new RetryBudget(10);

    const provider1 = createMockProvider("ollama", true);
    const provider2 = createMockProvider("openai-compatible", false);

    const router = new ModelRouter(
      {
        ollama: provider1 as unknown as ModelProvider,
        "openai-compatible": provider2 as unknown as ModelProvider,
      } as Record<ProviderId, ModelProvider>,
      {
        defaultProvider: "ollama",
        defaultModel: "test-model",
        defaultCloudModel: "test-model",
        fallbackCandidates: [
          { providerId: "openai-compatible", model: "test-model" },
        ],
      },
    );

    const result = await router.generate([{ role: "user", content: "hello" }], {
      model: "test-model",
      retryBudget,
    });

    expect(provider1.callCount).toBe(1);
    expect(provider2.callCount).toBe(1);
    expect(result.text).toBe("response from openai-compatible");
  });

  it("works without retryBudget (backward compatible)", async () => {
    const provider = createMockProvider("ollama");

    const router = new ModelRouter(
      { ollama: provider as unknown as ModelProvider } as Record<ProviderId, ModelProvider>,
      { defaultProvider: "ollama", defaultModel: "test-model", defaultCloudModel: "test-model" },
    );

    const result = await router.generate([{ role: "user", content: "hello" }], {
      model: "test-model",
      // No retryBudget — backward compatible
    });

    expect(result.text).toBe("response from ollama");
  });
});
