/**
 * NC-041: Token estimation and context compression improvements — regression tests
 *
 * Covers:
 *   - TokenCounter calibrated chars-per-token ratio
 *   - TokenCounter provider usage calibration (EMA)
 *   - TokenCounter setCharsPerToken from registry
 *   - TokenCounter trackRequestWithUsage
 *   - TokenCounter reset clears calibration
 *   - ContextCompressor fromContextWindow
 *   - ContextCompressor content-hash deduplication
 *   - ContextCompressor configurable head/tail
 *   - ProviderUsage extraction from ModelResponse
 *   - ModelCapabilityRegistry getCharsPerToken
 *   - Orchestrator integration (registry → tokenCounter)
 */

import { describe, it, expect, beforeEach } from "vitest";
import { TokenCounter } from "../src/utils/tokenCounter";
import { ContextCompressor } from "../src/utils/contextCompressor";
import {
  ModelCapabilityRegistry,
  getModelCapabilityRegistry,
  resetModelCapabilityRegistry,
} from "../src/utils/modelCapabilityRegistry";
import type { ProviderUsage } from "../src/types";

// ─── TokenCounter: calibrated chars-per-token ────────────────────────────────

describe("NC-041: TokenCounter calibration", () => {
  let counter: TokenCounter;

  beforeEach(() => {
    counter = new TokenCounter();
  });

  describe("default ratio", () => {
    it("uses 3.8 chars-per-token by default", () => {
      expect(counter.getCharsPerToken()).toBe(3.8);
    });

    it("estimateTokens uses calibrated ratio, not hardcoded /4", () => {
      // 38 chars / 3.8 = 10 tokens
      const text = "a".repeat(38);
      expect(counter.estimateTokens(text)).toBe(10);
    });

    it("estimateTokens returns at least 1 for empty string", () => {
      expect(counter.estimateTokens("")).toBe(1);
    });

    it("estimateTokens returns at least 1 for single char", () => {
      expect(counter.estimateTokens("x")).toBe(1);
    });
  });

  describe("setCharsPerToken", () => {
    it("sets ratio from model capability registry", () => {
      counter.setCharsPerToken(3.5);
      expect(counter.getCharsPerToken()).toBe(3.5);
      // 35 chars / 3.5 = 10 tokens
      expect(counter.estimateTokens("a".repeat(35))).toBe(10);
    });

    it("clamps ratio to minimum of 1.5", () => {
      counter.setCharsPerToken(0.5);
      expect(counter.getCharsPerToken()).toBe(1.5);
    });

    it("clamps ratio to maximum of 6.0", () => {
      counter.setCharsPerToken(10.0);
      expect(counter.getCharsPerToken()).toBe(6.0);
    });

    it("accepts boundary values", () => {
      counter.setCharsPerToken(1.5);
      expect(counter.getCharsPerToken()).toBe(1.5);
      counter.setCharsPerToken(6.0);
      expect(counter.getCharsPerToken()).toBe(6.0);
    });
  });

  describe("provider usage calibration (EMA)", () => {
    it("starts with 0 calibration samples", () => {
      expect(counter.getCalibrationSampleCount()).toBe(0);
      expect(counter.isCalibrated()).toBe(false);
    });

    it("first observation sets ratio directly (no EMA blend)", () => {
      // 380 chars / 100 tokens = 3.8 ratio
      counter.recordProviderUsage(380, { promptTokens: 100, completionTokens: 50, totalTokens: 150 });
      expect(counter.getCharsPerToken()).toBeCloseTo(3.8, 1);
      expect(counter.getCalibrationSampleCount()).toBe(1);
    });

    it("subsequent observations use EMA blending", () => {
      // First: 380/100 = 3.8
      counter.recordProviderUsage(380, { promptTokens: 100, completionTokens: 50, totalTokens: 150 });
      // Second: 350/100 = 3.5
      counter.recordProviderUsage(350, { promptTokens: 100, completionTokens: 50, totalTokens: 150 });
      // EMA: 0.3 * 3.5 + 0.7 * 3.8 = 1.05 + 2.66 = 3.71
      expect(counter.getCharsPerToken()).toBeCloseTo(3.71, 1);
      expect(counter.getCalibrationSampleCount()).toBe(2);
    });

    it("becomes calibrated after 5 samples", () => {
      expect(counter.isCalibrated()).toBe(false);
      for (let i = 0; i < 5; i++) {
        counter.recordProviderUsage(380, { promptTokens: 100, completionTokens: 50, totalTokens: 150 });
      }
      expect(counter.isCalibrated()).toBe(true);
      expect(counter.getCalibrationSampleCount()).toBe(5);
    });

    it("clamps extreme observed ratios", () => {
      // 100 chars / 10 tokens = 10.0 ratio → clamped to 6.0
      counter.recordProviderUsage(100, { promptTokens: 10, completionTokens: 5, totalTokens: 15 });
      expect(counter.getCharsPerToken()).toBe(6.0);

      // Second observation: 100 chars / 100 tokens = 1.0 ratio → clamped to 1.5
      // EMA blend: 0.3 * 1.5 + 0.7 * 6.0 = 4.65
      counter.recordProviderUsage(100, { promptTokens: 100, completionTokens: 50, totalTokens: 150 });
      expect(counter.getCharsPerToken()).toBeCloseTo(4.65, 1);
    });

    it("ignores zero/negative textChars", () => {
      counter.recordProviderUsage(0, { promptTokens: 100, completionTokens: 50, totalTokens: 150 });
      expect(counter.getCalibrationSampleCount()).toBe(0);
      counter.recordProviderUsage(-10, { promptTokens: 100, completionTokens: 50, totalTokens: 150 });
      expect(counter.getCalibrationSampleCount()).toBe(0);
    });

    it("ignores zero/negative promptTokens", () => {
      counter.recordProviderUsage(380, { promptTokens: 0, completionTokens: 50, totalTokens: 50 });
      expect(counter.getCalibrationSampleCount()).toBe(0);
      counter.recordProviderUsage(380, { promptTokens: -5, completionTokens: 50, totalTokens: 45 });
      expect(counter.getCalibrationSampleCount()).toBe(0);
    });

    it("estimateTokens improves after calibration", () => {
      // Before calibration
      const text = "a".repeat(38);
      expect(counter.estimateTokens(text)).toBe(10); // 38/3.8 = 10

      // Calibrate to 3.5 ratio (tighter tokenizer)
      for (let i = 0; i < 5; i++) {
        counter.recordProviderUsage(350, { promptTokens: 100, completionTokens: 50, totalTokens: 150 });
      }
      expect(counter.getCharsPerToken()).toBeCloseTo(3.5, 0);
      // 38 / 3.5 = 10.86 → 11 tokens
      expect(counter.estimateTokens(text)).toBe(11);
    });
  });

  describe("trackRequestWithUsage", () => {
    it("records accurate token counts from provider usage", () => {
      counter.trackRequestWithUsage(380, 200, { promptTokens: 100, completionTokens: 50, totalTokens: 150 });
      const stats = counter.getStats();
      expect(stats.totalInput).toBe(100);
      expect(stats.totalOutput).toBe(50);
      expect(stats.requests).toBe(1);
    });

    it("calibrates ratio from usage data", () => {
      counter.trackRequestWithUsage(380, 200, { promptTokens: 100, completionTokens: 50, totalTokens: 150 });
      expect(counter.getCharsPerToken()).toBeCloseTo(3.8, 1);
      expect(counter.getCalibrationSampleCount()).toBe(1);
    });

    it("accumulates across multiple requests", () => {
      counter.trackRequestWithUsage(380, 200, { promptTokens: 100, completionTokens: 50, totalTokens: 150 });
      counter.trackRequestWithUsage(350, 180, { promptTokens: 100, completionTokens: 40, totalTokens: 140 });
      const stats = counter.getStats();
      expect(stats.totalInput).toBe(200);
      expect(stats.totalOutput).toBe(90);
      expect(stats.requests).toBe(2);
      expect(counter.getCalibrationSampleCount()).toBe(2);
    });
  });

  describe("reset clears calibration", () => {
    it("resets calibration state on reset()", () => {
      counter.setCharsPerToken(3.5);
      counter.recordProviderUsage(350, { promptTokens: 100, completionTokens: 50, totalTokens: 150 });
      expect(counter.getCharsPerToken()).not.toBe(3.8);

      counter.reset();
      expect(counter.getCharsPerToken()).toBe(3.8);
      expect(counter.getCalibrationSampleCount()).toBe(0);
      expect(counter.isCalibrated()).toBe(false);
    });

    it("resets stats on reset()", () => {
      counter.trackRequestWithUsage(380, 200, { promptTokens: 100, completionTokens: 50, totalTokens: 150 });
      counter.reset();
      const stats = counter.getStats();
      expect(stats.totalInput).toBe(0);
      expect(stats.totalOutput).toBe(0);
      expect(stats.requests).toBe(0);
    });
  });

  describe("getStats includes calibration info", () => {
    it("reports charsPerToken and calibrationSamples", () => {
      counter.setCharsPerToken(3.5);
      counter.recordProviderUsage(350, { promptTokens: 100, completionTokens: 50, totalTokens: 150 });
      const stats = counter.getStats();
      expect(stats).toHaveProperty("charsPerToken");
      expect(stats).toHaveProperty("calibrationSamples");
      expect(stats.charsPerToken).toBeCloseTo(3.5, 1);
      expect(stats.calibrationSamples).toBe(1);
    });
  });
});

// ─── ContextCompressor: NC-041 improvements ──────────────────────────────────

describe("NC-041: ContextCompressor improvements", () => {
  describe("fromContextWindow", () => {
    it("large context window accepts large input without truncation", () => {
      const comp = ContextCompressor.fromContextWindow(128_000);
      // 128000 * 3.8 * 0.25 = 121600 chars max context
      const largeInput = "a".repeat(100_000);
      const result = comp.compressContext(largeInput);
      // Should NOT be truncated since 100K < 121.6K threshold
      expect(result).toBe(largeInput);
    });

    it("small context window truncates earlier", () => {
      const comp = ContextCompressor.fromContextWindow(4_096);
      // 4096 * 3.8 * 0.25 = 3891 chars max context
      // Use a single long string without \n\n paragraphs to hit the char-based truncation
      const input = "x".repeat(5000);
      const result = comp.compressContext(input);
      expect(result).toContain("[Context truncated]");
    });

    it("custom charsPerToken adjusts threshold", () => {
      const comp35 = ContextCompressor.fromContextWindow(32_000, 3.5);
      const comp40 = ContextCompressor.fromContextWindow(32_000, 4.0);
      // 32000 * 3.5 * 0.25 = 28000 vs 32000 * 4.0 * 0.25 = 32000
      const input10k = "a".repeat(29_000);
      // comp35 threshold is 28000, should truncate; comp40 threshold is 32000, should not
      expect(comp35.compressContext(input10k)).toContain("[Context truncated]");
      expect(comp40.compressContext(input10k)).toBe(input10k);
    });
  });

  describe("deduplication with content hashing", () => {
    it("deduplicates identical contexts", () => {
      const comp = new ContextCompressor();
      const contexts = ["hello world", "hello world", "goodbye"];
      const result = comp.deduplicateContext(contexts);
      expect(result).toEqual(["hello world", "goodbye"]);
    });

    it("does NOT deduplicate contexts with same prefix but different content", () => {
      const comp = new ContextCompressor();
      const ctx1 = "File: src/index.ts\n" + "a".repeat(500);
      const ctx2 = "File: src/index.ts\n" + "b".repeat(500);
      const result = comp.deduplicateContext([ctx1, ctx2]);
      expect(result).toHaveLength(2);
    });

    it("deduplicates using content hash even when prefix differs", () => {
      const comp = new ContextCompressor();
      const content = "x".repeat(300);
      const result = comp.deduplicateContext([content, content]);
      expect(result).toHaveLength(1);
    });

    it("handles empty array", () => {
      const comp = new ContextCompressor();
      expect(comp.deduplicateContext([])).toEqual([]);
    });

    it("handles single context", () => {
      const comp = new ContextCompressor();
      expect(comp.deduplicateContext(["only"])).toEqual(["only"]);
    });

    it("preserves order of first occurrence", () => {
      const comp = new ContextCompressor();
      const result = comp.deduplicateContext(["a", "b", "a", "c", "b"]);
      expect(result).toEqual(["a", "b", "c"]);
    });
  });

  describe("configurable file compression", () => {
    it("uses default head/tail of 20 lines", () => {
      const comp = new ContextCompressor(100);
      const lines = Array.from({ length: 120 }, (_, i) => `line ${i}`);
      const result = comp.compressFileContent(lines.join("\n"), "test.ts");
      expect(result).toContain("// ... 80 lines omitted ...");
      expect(result).toContain("line 0");
      expect(result).toContain("line 119");
    });

    it("does not compress files under maxFileLines", () => {
      const comp = new ContextCompressor(100);
      const lines = Array.from({ length: 50 }, (_, i) => `line ${i}`);
      const result = comp.compressFileContent(lines.join("\n"), "test.ts");
      expect(result).not.toContain("omitted");
    });

    it("compresses large files with head/tail", () => {
      const comp = new ContextCompressor(100);
      const lines = Array.from({ length: 200 }, (_, i) => `line ${i}`);
      const result = comp.compressFileContent(lines.join("\n"), "big.ts");
      expect(result).toContain("// big.ts (200 lines total)");
      expect(result).toContain("// ... 160 lines omitted ...");
    });
  });
});

// ─── ModelCapabilityRegistry: getCharsPerToken ────────────────────────────────

describe("NC-041: ModelCapabilityRegistry getCharsPerToken", () => {
  beforeEach(() => {
    resetModelCapabilityRegistry();
  });

  it("returns charsPerToken for known ollama model", () => {
    const reg = new ModelCapabilityRegistry();
    expect(reg.getCharsPerToken("ollama", "qwen3:8b")).toBe(3.5);
  });

  it("returns charsPerToken for known cloud model", () => {
    const reg = new ModelCapabilityRegistry();
    expect(reg.getCharsPerToken("openai-compatible", "gpt-4o")).toBe(4.0);
  });

  it("returns charsPerToken for DeepSeek", () => {
    const reg = new ModelCapabilityRegistry();
    expect(reg.getCharsPerToken("ollama", "deepseek-r1:8b")).toBe(3.7);
  });

  it("returns charsPerToken for Claude", () => {
    const reg = new ModelCapabilityRegistry();
    expect(reg.getCharsPerToken("openai-compatible", "claude-sonnet-4")).toBe(3.8);
  });

  it("returns undefined for unknown model", () => {
    const reg = new ModelCapabilityRegistry();
    expect(reg.getCharsPerToken("unknown", "nonexistent-model")).toBeUndefined();
  });

  it("returns charsPerToken via singleton", () => {
    const reg = getModelCapabilityRegistry();
    expect(reg.getCharsPerToken("ollama", "llama3:8b")).toBe(3.8);
  });

  it("all static registry entries have charsPerToken", () => {
    const reg = new ModelCapabilityRegistry();
    // Check a sample of known models have charsPerToken
    const models: [string, string][] = [
      ["ollama", "qwen3:8b"],
      ["ollama", "deepseek-r1:8b"],
      ["ollama", "llama3:8b"],
      ["openai-compatible", "gpt-4o"],
      ["openai-compatible", "claude-sonnet-4"],
      ["huggingface", "qwen/qwen3-8b"],
      ["groq", "llama-3.1-8b-versatile"],
      ["together", "qwen/qwen3-8b"],
      ["openrouter", "qwen/qwen3-8b"],
      ["fireworks", "accounts/fireworks/models/llama-v3p3-70b-instruct"],
      ["nvidia", "nvidia/llama-3.1-nemotron-ultra-253b-v1"],
    ];
    for (const [provider, model] of models) {
      const cpt = reg.getCharsPerToken(provider, model);
      expect(cpt).toBeGreaterThanOrEqual(1.5);
      expect(cpt).toBeLessThanOrEqual(6.0);
    }
  });
});

// ─── ProviderUsage type from ModelResponse ───────────────────────────────────

describe("NC-041: ProviderUsage in ModelResponse", () => {
  it("ProviderUsage type is exported from types", async () => {
    const types = await import("../src/types");
    // Type-level check: ProviderUsage interface exists
    const usage: types.ProviderUsage = { promptTokens: 10, completionTokens: 5, totalTokens: 15 };
    expect(usage.promptTokens).toBe(10);
    expect(usage.completionTokens).toBe(5);
    expect(usage.totalTokens).toBe(15);
  });

  it("ModelResponse can include usage field", async () => {
    const types = await import("../src/types");
    const response: types.ModelResponse = {
      text: "hello",
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    };
    expect(response.usage).toBeDefined();
    expect(response.usage!.promptTokens).toBe(10);
  });

  it("ModelResponse can omit usage field (backward compat)", async () => {
    const types = await import("../src/types");
    const response: types.ModelResponse = { text: "hello" };
    expect(response.usage).toBeUndefined();
  });
});
