/**
 * NC-013 regression: Model fallback is advertised but not implemented.
 *
 * resolveCandidates() must:
 *  1. Try the explicit model on the selected provider first.
 *  2. Try the same-provider default model second.
 *  3. Only cross providers when the user explicitly populates fallbackCandidates.
 *  4. Never cross providers by default (NC-001/NC-013 containment).
 *  5. Deduplicate identical provider+model pairs.
 *
 * generate()/stream() must:
 *  6. Track per-candidate failure reasons (provider, model, error, HTTP status).
 *  7. Throw a detailed error listing every candidate tried and why each failed.
 *  8. Propagate AbortError immediately without fallback.
 *  9. Not fallback after partial stream output.
 */
import { describe, it, expect, vi } from "vitest";
import { ModelRouter, type ModelRouterConfig, type FallbackCandidate } from "../src/providers/modelRouter";
import type { ModelProvider, ProviderGenerateOptions, ChatMessage, ModelResponse } from "../src/types";

/* ------------------------------------------------------------------ */
/*  Test helpers                                                       */
/* ------------------------------------------------------------------ */

function makeProvider(id: string, opts?: { generateThrows?: Error; streamThrows?: Error }): ModelProvider {
  return {
    id: id as any,
    generate: vi.fn(async () => {
      if (opts?.generateThrows) throw opts.generateThrows;
      return { text: `response from ${id}`, toolCalls: [] };
    }) as any,
    stream: opts?.streamThrows
      ? (vi.fn(async function* () { throw opts.streamThrows; }) as any)
      : undefined,
  };
}

function makeConfig(overrides?: {
  defaultProvider?: string;
  defaultModel?: string;
  defaultCloudModel?: string;
  fallbackCandidates?: FallbackCandidate[];
}): ModelRouterConfig {
  return {
    defaultProvider: (overrides?.defaultProvider ?? "ollama") as any,
    defaultModel: overrides?.defaultModel ?? "qwen3:8b",
    defaultCloudModel: overrides?.defaultCloudModel ?? "deepseek-v4-pro",
    fallbackCandidates: overrides?.fallbackCandidates,
  };
}

function makeMessages(): ChatMessage[] {
  return [{ role: "user", content: "Hello" }];
}

/* ------------------------------------------------------------------ */
/*  resolveCandidates tests                                            */
/* ------------------------------------------------------------------ */

describe("NC-013: Model fallback — resolveCandidates", () => {
  it("returns explicit model as first candidate on the selected provider", () => {
    const ollama = makeProvider("ollama");
    const router = new ModelRouter({ ollama } as any, makeConfig());

    const candidates = router.resolveCandidates({ provider: "ollama", model: "llama3:70b" });
    // explicit model llama3:70b + default qwen3:8b (different models, both added)
    expect(candidates).toHaveLength(2);
    expect(candidates[0].providerId).toBe("ollama");
    expect(candidates[0].model).toBe("llama3:70b");
    expect(candidates[1].model).toBe("qwen3:8b");
  });

  it("includes same-provider default model as second candidate when different from explicit", () => {
    const ollama = makeProvider("ollama");
    const router = new ModelRouter({ ollama } as any, makeConfig());

    const candidates = router.resolveCandidates({ provider: "ollama", model: "llama3:70b" });
    expect(candidates).toHaveLength(2);
    expect(candidates[0].model).toBe("llama3:70b");
    expect(candidates[1].model).toBe("qwen3:8b"); // defaultModel
  });

  it("deduplicates when explicit model equals same-provider default", () => {
    const ollama = makeProvider("ollama");
    const router = new ModelRouter({ ollama } as any, makeConfig());

    const candidates = router.resolveCandidates({ provider: "ollama", model: "qwen3:8b" });
    expect(candidates).toHaveLength(1);
    expect(candidates[0].model).toBe("qwen3:8b");
  });

  it("does NOT cross providers when fallbackCandidates is empty (default)", () => {
    const ollama = makeProvider("ollama");
    const hf = makeProvider("huggingface");
    const router = new ModelRouter(
      { ollama, "huggingface": hf } as any,
      makeConfig({ defaultProvider: "ollama" }),
    );

    const candidates = router.resolveCandidates({ provider: "ollama", model: "qwen3:8b" });
    // Should only have ollama candidates, never huggingface
    expect(candidates.every(c => c.providerId === "ollama")).toBe(true);
  });

  it("does NOT cross providers when fallbackCandidates is undefined (default)", () => {
    const ollama = makeProvider("ollama");
    const hf = makeProvider("huggingface");
    const router = new ModelRouter(
      { ollama, "huggingface": hf } as any,
      makeConfig({ defaultProvider: "ollama" }),
    );

    const candidates = router.resolveCandidates({ provider: "ollama", model: "qwen3:8b" });
    expect(candidates.every(c => c.providerId === "ollama")).toBe(true);
  });

  it("includes cross-provider fallback candidates only when explicitly configured", () => {
    const ollama = makeProvider("ollama");
    const hf = makeProvider("huggingface");
    const router = new ModelRouter(
      { ollama, "huggingface": hf } as any,
      makeConfig({
        defaultProvider: "ollama",
        fallbackCandidates: [{ providerId: "huggingface", model: "Qwen/Qwen3-8B" }],
      }),
    );

    // Use explicit model different from default to get 3 candidates
    const candidates = router.resolveCandidates({ provider: "ollama", model: "llama3:70b" });
    // ollama/llama3:70b (explicit), ollama/qwen3:8b (default), huggingface/Qwen/Qwen3-8B (fallback)
    expect(candidates).toHaveLength(3);
    expect(candidates[2].providerId).toBe("huggingface");
    expect(candidates[2].model).toBe("Qwen/Qwen3-8B");
  });

  it("preserves fallback candidate order", () => {
    const ollama = makeProvider("ollama");
    const hf = makeProvider("huggingface");
    const groq = makeProvider("groq");
    const router = new ModelRouter(
      { ollama, "huggingface": hf, groq } as any,
      makeConfig({
        defaultProvider: "ollama",
        fallbackCandidates: [
          { providerId: "groq", model: "llama3-70b" },
          { providerId: "huggingface", model: "Qwen/Qwen3-8B" },
        ],
      }),
    );

    // Use explicit model different from default to get all 4 candidates
    const candidates = router.resolveCandidates({ provider: "ollama", model: "llama3:70b" });
    // ollama/llama3:70b (explicit), ollama/qwen3:8b (default), groq, huggingface
    expect(candidates).toHaveLength(4);
    expect(candidates[2].providerId).toBe("groq");
    expect(candidates[3].providerId).toBe("huggingface");
  });

  it("skips fallback candidates with no matching provider instance", () => {
    const ollama = makeProvider("ollama");
    // No huggingface instance registered
    const router = new ModelRouter(
      { ollama } as any,
      makeConfig({
        defaultProvider: "ollama",
        fallbackCandidates: [{ providerId: "huggingface", model: "Qwen/Qwen3-8B" }],
      }),
    );

    const candidates = router.resolveCandidates({ provider: "ollama", model: "qwen3:8b" });
    expect(candidates.every(c => c.providerId === "ollama")).toBe(true);
  });

  it("deduplicates fallback candidate that matches explicit or default", () => {
    const ollama = makeProvider("ollama");
    const router = new ModelRouter(
      { ollama } as any,
      makeConfig({
        defaultProvider: "ollama",
        fallbackCandidates: [{ providerId: "ollama", model: "qwen3:8b" }],
      }),
    );

    const candidates = router.resolveCandidates({ provider: "ollama", model: "qwen3:8b" });
    // All three would be ollama/qwen3:8b, but dedup keeps only one
    expect(candidates).toHaveLength(1);
  });

  it("uses cloud default model for cloud providers", () => {
    const hf = makeProvider("huggingface");
    const router = new ModelRouter(
      { "huggingface": hf } as any,
      makeConfig({ defaultProvider: "huggingface", defaultCloudModel: "deepseek-v4-pro" }),
    );

    const candidates = router.resolveCandidates({ provider: "huggingface" });
    expect(candidates).toHaveLength(1);
    expect(candidates[0].model).toBe("deepseek-v4-pro");
  });

  it("uses local default model for ollama provider", () => {
    const ollama = makeProvider("ollama");
    const router = new ModelRouter(
      { ollama } as any,
      makeConfig({ defaultProvider: "ollama", defaultModel: "qwen3:8b" }),
    );

    const candidates = router.resolveCandidates({ provider: "ollama" });
    expect(candidates).toHaveLength(1);
    expect(candidates[0].model).toBe("qwen3:8b");
  });
});

/* ------------------------------------------------------------------ */
/*  generate() failure tracking and error messages                     */
/* ------------------------------------------------------------------ */

describe("NC-013: Model fallback — generate error reporting", () => {
  it("reports single candidate failure with provider/model in error", async () => {
    const ollama = makeProvider("ollama", {
      generateThrows: new Error("connection refused"),
    });
    const router = new ModelRouter({ ollama } as any, makeConfig());

    await expect(
      router.generate(makeMessages(), { provider: "ollama", model: "qwen3:8b" }),
    ).rejects.toThrow(/ollama\/qwen3:8b/);
  });

  it("reports all attempted candidates in error when multiple fail", async () => {
    const ollama = makeProvider("ollama", {
      generateThrows: new Error("connection refused"),
    });
    const hf = makeProvider("huggingface", {
      generateThrows: new Error("401 unauthorized"),
    });
    const router = new ModelRouter(
      { ollama, "huggingface": hf } as any,
      makeConfig({
        defaultProvider: "ollama",
        // Use explicit model different from default so we get 3 candidates
        fallbackCandidates: [{ providerId: "huggingface", model: "Qwen/Qwen3-8B" }],
      }),
    );

    try {
      await router.generate(makeMessages(), { provider: "ollama", model: "llama3:70b" });
      expect.fail("should have thrown");
    } catch (err: any) {
      expect(err.message).toContain("ollama/llama3:70b");
      expect(err.message).toContain("ollama/qwen3:8b");
      expect(err.message).toContain("huggingface/Qwen/Qwen3-8B");
      expect(err.message).toContain("connection refused");
      expect(err.message).toContain("401 unauthorized");
      // Should show attempt count
      expect(err.message).toContain("3 provider/model attempt(s) failed");
    }
  });

  it("includes HTTP status codes in error detail when multiple candidates fail", async () => {
    const ollama = makeProvider("ollama", {
      generateThrows: new Error("connection refused"),
    });
    const hf = makeProvider("huggingface", {
      generateThrows: Object.assign(new Error("403 forbidden"), { status: 403 }),
    });
    const router = new ModelRouter(
      { ollama, "huggingface": hf } as any,
      makeConfig({
        defaultProvider: "ollama",
        // Use explicit model different from default to get 3 candidates
        fallbackCandidates: [{ providerId: "huggingface", model: "Qwen/Qwen3-8B" }],
      }),
    );

    try {
      await router.generate(makeMessages(), { provider: "ollama", model: "llama3:70b" });
      expect.fail("should have thrown");
    } catch (err: any) {
      // Detail block only shown when >1 candidate
      expect(err.message).toContain("[HTTP 403]");
    }
  });

  it("includes troubleshooting for connection errors", async () => {
    const ollama = makeProvider("ollama", {
      generateThrows: new Error("ECONNREFUSED"),
    });
    const router = new ModelRouter({ ollama } as any, makeConfig());

    try {
      await router.generate(makeMessages(), { provider: "ollama", model: "qwen3:8b" });
      expect.fail("should have thrown");
    } catch (err: any) {
      expect(err.message).toContain("Troubleshooting");
      expect(err.message).toContain("provider is running");
    }
  });

  it("includes troubleshooting for rate limit errors", async () => {
    const ollama = makeProvider("ollama", {
      generateThrows: new Error("429 rate limit exceeded"),
    });
    const router = new ModelRouter({ ollama } as any, makeConfig());

    try {
      await router.generate(makeMessages(), { provider: "ollama", model: "qwen3:8b" });
      expect.fail("should have thrown");
    } catch (err: any) {
      expect(err.message).toContain("rate limits");
    }
  });

  it("includes troubleshooting for timeout errors", async () => {
    const ollama = makeProvider("ollama", {
      generateThrows: new Error("request timeout"),
    });
    const router = new ModelRouter({ ollama } as any, makeConfig());

    try {
      await router.generate(makeMessages(), { provider: "ollama", model: "qwen3:8b" });
      expect.fail("should have thrown");
    } catch (err: any) {
      expect(err.message).toContain("timed out");
    }
  });

  it("returns successful result on first candidate without trying fallback", async () => {
    const ollama = makeProvider("ollama");
    const hf = makeProvider("huggingface");
    const router = new ModelRouter(
      { ollama, "huggingface": hf } as any,
      makeConfig({
        defaultProvider: "ollama",
        fallbackCandidates: [{ providerId: "huggingface", model: "Qwen/Qwen3-8B" }],
      }),
    );

    const result = await router.generate(makeMessages(), {
      provider: "ollama",
      model: "qwen3:8b",
    });
    expect(result.text).toContain("ollama");
    // huggingface generate should NOT have been called
    expect(hf.generate).not.toHaveBeenCalled();
  });

  it("falls back to second candidate when first fails", async () => {
    const ollama = makeProvider("ollama", {
      generateThrows: new Error("connection refused"),
    });
    const hf = makeProvider("huggingface");
    const router = new ModelRouter(
      { ollama, "huggingface": hf } as any,
      makeConfig({
        defaultProvider: "ollama",
        fallbackCandidates: [{ providerId: "huggingface", model: "Qwen/Qwen3-8B" }],
      }),
    );

    const result = await router.generate(makeMessages(), {
      provider: "ollama",
      model: "qwen3:8b",
    });
    expect(result.text).toContain("huggingface");
    expect(hf.generate).toHaveBeenCalledTimes(1);
  });

  it("propagates AbortError immediately without trying further candidates", async () => {
    const controller = new AbortController();
    // Create a plain Error with name set to "AbortError" for the isAbortError check
    const abortError = new Error("The operation was aborted");
    (abortError as any).name = "AbortError";

    const ollama = makeProvider("ollama", { generateThrows: abortError });
    const hf = makeProvider("huggingface");
    const router = new ModelRouter(
      { ollama, "huggingface": hf } as any,
      makeConfig({
        defaultProvider: "ollama",
        fallbackCandidates: [{ providerId: "huggingface", model: "Qwen/Qwen3-8B" }],
      }),
    );

    await expect(
      router.generate(makeMessages(), {
        provider: "ollama",
        model: "qwen3:8b",
        signal: controller.signal,
      }),
    ).rejects.toThrow(/abort/i);
    expect(hf.generate).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------ */
/*  stream() failure tracking                                          */
/* ------------------------------------------------------------------ */

describe("NC-013: Model fallback — stream error reporting", () => {
  it("reports failures from stream attempts in error message", async () => {
    const ollama = makeProvider("ollama", {
      streamThrows: new Error("stream connection refused"),
    });
    const router = new ModelRouter({ ollama } as any, makeConfig());

    const gen = router.stream(makeMessages(), { provider: "ollama", model: "qwen3:8b" });

    await expect(async () => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      for await (const _chunk of gen) {
        // consume
      }
    }).rejects.toThrow(/ollama\/qwen3:8b/);
  });

  it("does not fallback after partial stream output", async () => {
    const partialStreamProvider: ModelProvider = {
      id: "ollama",
      generate: vi.fn(async () => ({ text: "", toolCalls: [] })) as any,
      stream: vi.fn(async function* () {
        yield "token1";
        yield "token2";
        throw new Error("stream broke after partial output");
      }) as any,
    };

    const hf = makeProvider("huggingface");
    const router = new ModelRouter(
      { ollama: partialStreamProvider, "huggingface": hf } as any,
      makeConfig({
        defaultProvider: "ollama",
        fallbackCandidates: [{ providerId: "huggingface", model: "Qwen/Qwen3-8B" }],
      }),
    );

    const gen = router.stream(makeMessages(), { provider: "ollama", model: "qwen3:8b" });
    const chunks: string[] = [];
    await expect(async () => {
      for await (const chunk of gen) {
        chunks.push(chunk);
      }
    }).rejects.toThrow("stream broke after partial output");
    expect(chunks).toEqual(["token1", "token2"]);
    expect(hf.generate).not.toHaveBeenCalled();
  });

  it("falls back to next provider when stream fails before any output", async () => {
    const ollama: ModelProvider = {
      id: "ollama",
      generate: vi.fn(async () => ({ text: "", toolCalls: [] })) as any,
      stream: vi.fn(async function* () {
        throw new Error("connection refused");
      }) as any,
    };

    const hf: ModelProvider = {
      id: "huggingface",
      generate: vi.fn(async () => ({ text: "fallback response", toolCalls: [] })) as any,
      stream: vi.fn(async function* () {
        yield "fallback";
      }) as any,
    };

    const router = new ModelRouter(
      { ollama, "huggingface": hf } as any,
      makeConfig({
        defaultProvider: "ollama",
        fallbackCandidates: [{ providerId: "huggingface", model: "Qwen/Qwen3-8B" }],
      }),
    );

    const chunks: string[] = [];
    for await (const chunk of router.stream(makeMessages(), {
      provider: "ollama",
      model: "qwen3:8b",
    })) {
      chunks.push(chunk);
    }
    expect(chunks).toEqual(["fallback"]);
  });
});

/* ------------------------------------------------------------------ */
/*  Backward compatibility                                             */
/* ------------------------------------------------------------------ */

describe("NC-013: Model fallback — backward compatibility", () => {
  it("works with minimal config (no fallbackCandidates)", () => {
    const ollama = makeProvider("ollama");
    const router = new ModelRouter(
      { ollama } as any,
      { defaultProvider: "ollama", defaultModel: "qwen3:8b", defaultCloudModel: "deepseek-v4-pro" },
    );

    const candidates = router.resolveCandidates({ provider: "ollama", model: "llama3:70b" });
    expect(candidates).toHaveLength(2);
    expect(candidates[0].model).toBe("llama3:70b");
    expect(candidates[1].model).toBe("qwen3:8b");
  });

  it("works with empty fallbackCandidates array", () => {
    const ollama = makeProvider("ollama");
    const router = new ModelRouter(
      { ollama } as any,
      { defaultProvider: "ollama", defaultModel: "qwen3:8b", defaultCloudModel: "deepseek-v4-pro", fallbackCandidates: [] },
    );

    const candidates = router.resolveCandidates({ provider: "ollama", model: "llama3:70b" });
    expect(candidates).toHaveLength(2);
  });

  it("existing provider config still works for generate()", async () => {
    const ollama = makeProvider("ollama");
    const router = new ModelRouter(
      { ollama } as any,
      { defaultProvider: "ollama", defaultModel: "qwen3:8b", defaultCloudModel: "deepseek-v4-pro" },
    );

    const result = await router.generate(makeMessages(), { provider: "ollama", model: "qwen3:8b" });
    expect(result.text).toContain("ollama");
  });
});

/* ------------------------------------------------------------------ */
/*  FallbackCandidate type tests                                       */
/* ------------------------------------------------------------------ */

describe("NC-013: Model fallback — FallbackCandidate edge cases", () => {
  it("skips fallback candidates with empty model", () => {
    const ollama = makeProvider("ollama");
    const hf = makeProvider("huggingface");
    const router = new ModelRouter(
      { ollama, "huggingface": hf } as any,
      makeConfig({
        defaultProvider: "ollama",
        fallbackCandidates: [{ providerId: "huggingface", model: "  " }],
      }),
    );

    const candidates = router.resolveCandidates({ provider: "ollama", model: "qwen3:8b" });
    expect(candidates.every(c => c.providerId === "ollama")).toBe(true);
  });

  it("trims whitespace from fallback candidate models", () => {
    const ollama = makeProvider("ollama");
    const hf = makeProvider("huggingface");
    const router = new ModelRouter(
      { ollama, "huggingface": hf } as any,
      makeConfig({
        defaultProvider: "ollama",
        fallbackCandidates: [{ providerId: "huggingface", model: "  Qwen/Qwen3-8B  " }],
      }),
    );

    const candidates = router.resolveCandidates({ provider: "ollama", model: "qwen3:8b" });
    const hfCandidate = candidates.find(c => c.providerId === "huggingface");
    expect(hfCandidate?.model).toBe("Qwen/Qwen3-8B");
  });

  it("label is optional and does not affect candidate matching", () => {
    const ollama = makeProvider("ollama");
    const hf = makeProvider("huggingface");
    const router = new ModelRouter(
      { ollama, "huggingface": hf } as any,
      makeConfig({
        defaultProvider: "ollama",
        fallbackCandidates: [
          { providerId: "huggingface", model: "Qwen/Qwen3-8B", label: "cloud backup" },
        ],
      }),
    );

    // Use explicit model different from default to get 3 candidates
    const candidates = router.resolveCandidates({ provider: "ollama", model: "llama3:70b" });
    expect(candidates).toHaveLength(3);
  });
});
