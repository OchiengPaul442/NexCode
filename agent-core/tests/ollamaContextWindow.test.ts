import { describe, it, expect } from "vitest";
import { detectModelCapabilities } from "../src/providers/modelRouter";

describe("detectModelCapabilities", () => {
  describe("contextWindow", () => {
    it("returns 32768 for qwen2.5-coder:14b", () => {
      expect(detectModelCapabilities("qwen2.5-coder:14b").contextWindow).toBe(32768);
    });

    it("returns 32768 for qwen2.5-coder:7b", () => {
      expect(detectModelCapabilities("qwen2.5-coder:7b").contextWindow).toBe(32768);
    });

    it("returns 128000 for deepseek-r1:8b", () => {
      expect(detectModelCapabilities("deepseek-r1:8b").contextWindow).toBe(128000);
    });

    it("returns 128000 for qwen3:8b", () => {
      expect(detectModelCapabilities("qwen3:8b").contextWindow).toBe(128000);
    });

    it("returns 64000 for unknown models (default)", () => {
      expect(detectModelCapabilities("unknown-model:latest").contextWindow).toBe(64000);
    });

    it("returns 64000 for empty string", () => {
      expect(detectModelCapabilities("").contextWindow).toBe(64000);
    });

    it("is case-insensitive", () => {
      expect(detectModelCapabilities("QWEN2.5-CODER:14B").contextWindow).toBe(32768);
      expect(detectModelCapabilities("DeepSeek-R1:8B").contextWindow).toBe(128000);
    });
  });

  describe("hasThinking", () => {
    it("returns true for deepseek-r1:8b", () => {
      expect(detectModelCapabilities("deepseek-r1:8b").hasThinking).toBe(true);
    });

    it("returns true for qwen3:8b", () => {
      expect(detectModelCapabilities("qwen3:8b").hasThinking).toBe(true);
    });

    it("returns false for qwen2.5-coder:14b", () => {
      expect(detectModelCapabilities("qwen2.5-coder:14b").hasThinking).toBe(false);
    });

    it("returns false for llama3:8b", () => {
      expect(detectModelCapabilities("llama3:8b").hasThinking).toBe(false);
    });

    it("returns false for unknown models", () => {
      expect(detectModelCapabilities("unknown-model:latest").hasThinking).toBe(false);
    });
  });

  describe("hasToolCalling", () => {
    it("returns true for qwen2.5-coder:14b", () => {
      expect(detectModelCapabilities("qwen2.5-coder:14b").hasToolCalling).toBe(true);
    });

    it("returns true for deepseek-r1:8b", () => {
      expect(detectModelCapabilities("deepseek-r1:8b").hasToolCalling).toBe(true);
    });

    it("returns true for qwen3:8b", () => {
      expect(detectModelCapabilities("qwen3:8b").hasToolCalling).toBe(true);
    });

    it("returns true for llama3:8b", () => {
      expect(detectModelCapabilities("llama3:8b").hasToolCalling).toBe(true);
    });

    it("returns false for unknown models", () => {
      expect(detectModelCapabilities("unknown-model:latest").hasToolCalling).toBe(false);
    });
  });
});
