/**
 * NC-015: Model Capability Registry — regression tests
 *
 * Covers:
 *   - Static registry lookup for known models (all providers)
 *   - Provider-qualified keys
 *   - User overrides (highest priority)
 *   - Provider metadata overrides
 *   - Unknown models get conservative defaults
 *   - Backward compatibility with detectModelCapabilities()
 *   - Heuristic fallback still works for unrecognized models
 *   - Registry reset and singleton behavior
 *   - Edge cases (empty model, whitespace, case sensitivity)
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  ModelCapabilityRegistry,
  getModelCapabilityRegistry,
  resetModelCapabilityRegistry,
} from "../src/utils/modelCapabilityRegistry";
import { detectModelCapabilities } from "../src/providers/modelRouter";

describe("NC-015: ModelCapabilityRegistry", () => {
  beforeEach(() => {
    resetModelCapabilityRegistry();
  });

  // ─── Static registry: known models ────────────────────────────────────

  describe("static registry", () => {
    it("returns 128K context and thinking+tools for ollama:qwen3:8b", () => {
      const reg = new ModelCapabilityRegistry();
      const entry = reg.lookup("ollama", "qwen3:8b");
      expect(entry).toBeDefined();
      expect(entry!.contextWindow).toBe(128_000);
      expect(entry!.hasThinking).toBe(true);
      expect(entry!.hasToolCalling).toBe(true);
      expect(entry!.source).toBe("registry");
    });

    it("returns 32K context and no thinking for ollama:qwen2.5-coder:14b", () => {
      const reg = new ModelCapabilityRegistry();
      const entry = reg.lookup("ollama", "qwen2.5-coder:14b");
      expect(entry).toBeDefined();
      expect(entry!.contextWindow).toBe(32_768);
      expect(entry!.hasThinking).toBe(false);
      expect(entry!.hasToolCalling).toBe(true);
    });

    it("returns 128K context and thinking for ollama:deepseek-r1:8b", () => {
      const reg = new ModelCapabilityRegistry();
      const entry = reg.lookup("ollama", "deepseek-r1:8b");
      expect(entry).toBeDefined();
      expect(entry!.contextWindow).toBe(128_000);
      expect(entry!.hasThinking).toBe(true);
      expect(entry!.hasToolCalling).toBe(true);
    });

    it("returns 128K context and thinking for ollama:glm5", () => {
      const reg = new ModelCapabilityRegistry();
      const entry = reg.lookup("ollama", "glm5");
      expect(entry).toBeDefined();
      expect(entry!.contextWindow).toBe(128_000);
      expect(entry!.hasThinking).toBe(true);
    });

    it("returns 128K context and thinking for ollama:kimi-k2", () => {
      const reg = new ModelCapabilityRegistry();
      const entry = reg.lookup("ollama", "kimi-k2");
      expect(entry).toBeDefined();
      expect(entry!.contextWindow).toBe(128_000);
      expect(entry!.hasThinking).toBe(true);
    });

    it("returns 32K context and no tools for ollama:nemotron-mini", () => {
      const reg = new ModelCapabilityRegistry();
      const entry = reg.lookup("ollama", "nemotron-mini");
      expect(entry).toBeDefined();
      expect(entry!.contextWindow).toBe(32_768);
      expect(entry!.hasToolCalling).toBe(false);
    });

    it("returns 128K context for openai-compatible:gpt-4o", () => {
      const reg = new ModelCapabilityRegistry();
      const entry = reg.lookup("openai-compatible", "gpt-4o");
      expect(entry).toBeDefined();
      expect(entry!.contextWindow).toBe(128_000);
      expect(entry!.hasToolCalling).toBe(true);
      expect(entry!.hasThinking).toBe(false);
    });

    it("returns 128K context and thinking for openai-compatible:claude-sonnet-4", () => {
      const reg = new ModelCapabilityRegistry();
      const entry = reg.lookup("openai-compatible", "claude-sonnet-4");
      expect(entry).toBeDefined();
      expect(entry!.contextWindow).toBe(128_000);
      expect(entry!.hasThinking).toBe(true);
      expect(entry!.hasToolCalling).toBe(true);
    });

    it("returns correct entry for groq models", () => {
      const reg = new ModelCapabilityRegistry();
      const entry = reg.lookup("groq", "llama-3.3-70b-versatile");
      expect(entry).toBeDefined();
      expect(entry!.contextWindow).toBe(128_000);
      expect(entry!.hasToolCalling).toBe(true);
      expect(entry!.hasThinking).toBe(false);
    });

    it("returns correct entry for together models", () => {
      const reg = new ModelCapabilityRegistry();
      const entry = reg.lookup("together", "qwen/qwen3-8b");
      expect(entry).toBeDefined();
      expect(entry!.contextWindow).toBe(128_000);
      expect(entry!.hasThinking).toBe(true);
      expect(entry!.hasToolCalling).toBe(true);
    });

    it("returns correct entry for openrouter models", () => {
      const reg = new ModelCapabilityRegistry();
      const entry = reg.lookup("openrouter", "qwen/qwen3-8b");
      expect(entry).toBeDefined();
      expect(entry!.contextWindow).toBe(128_000);
      expect(entry!.hasThinking).toBe(true);
    });

    it("returns correct entry for huggingface models", () => {
      const reg = new ModelCapabilityRegistry();
      const entry = reg.lookup("huggingface", "qwen/qwen3-8b");
      expect(entry).toBeDefined();
      expect(entry!.hasThinking).toBe(true);
      expect(entry!.hasToolCalling).toBe(true);
      expect(entry!.contextWindow).toBe(128_000);
    });
  });

  // ─── Unknown models → conservative defaults ────────────────────────────

  describe("unknown models", () => {
    it("returns undefined for completely unknown model", () => {
      const reg = new ModelCapabilityRegistry();
      expect(reg.lookup("ollama", "unknown-model:latest")).toBeUndefined();
    });

    it("returns undefined for unknown model with no provider", () => {
      const reg = new ModelCapabilityRegistry();
      expect(reg.lookup(undefined, "totally-fake-model")).toBeUndefined();
    });

    it("returns undefined for empty model", () => {
      const reg = new ModelCapabilityRegistry();
      expect(reg.lookup("ollama", "")).toBeUndefined();
    });

    it("returns undefined for whitespace-only model", () => {
      const reg = new ModelCapabilityRegistry();
      expect(reg.lookup("ollama", "   ")).toBeUndefined();
    });
  });

  // ─── User overrides (highest priority) ────────────────────────────────

  describe("user overrides", () => {
    it("user override takes precedence over static registry", () => {
      const reg = new ModelCapabilityRegistry();

      // Static registry says ollama:qwen3:8b has 128K context
      const before = reg.lookup("ollama", "qwen3:8b");
      expect(before!.contextWindow).toBe(128_000);

      // User overrides to 64K
      reg.registerUserOverride("ollama", "qwen3:8b", {
        hasThinking: false,
        hasToolCalling: true,
        contextWindow: 64_000,
      });

      const after = reg.lookup("ollama", "qwen3:8b");
      expect(after!.contextWindow).toBe(64_000);
      expect(after!.hasThinking).toBe(false);
      expect(after!.source).toBe("user-override");
    });

    it("user override applies to unknown models", () => {
      const reg = new ModelCapabilityRegistry();

      expect(reg.lookup("ollama", "my-custom-model")).toBeUndefined();

      reg.registerUserOverride("ollama", "my-custom-model", {
        hasThinking: true,
        hasToolCalling: true,
        contextWindow: 256_000,
      });

      const entry = reg.lookup("ollama", "my-custom-model");
      expect(entry).toBeDefined();
      expect(entry!.contextWindow).toBe(256_000);
      expect(entry!.hasThinking).toBe(true);
      expect(entry!.hasToolCalling).toBe(true);
      expect(entry!.source).toBe("user-override");
    });

    it("user override without provider still works", () => {
      const reg = new ModelCapabilityRegistry();

      reg.registerUserOverride(undefined, "generic-model", {
        hasThinking: false,
        hasToolCalling: false,
        contextWindow: 16_000,
      });

      const entry = reg.lookup(undefined, "generic-model");
      expect(entry).toBeDefined();
      expect(entry!.contextWindow).toBe(16_000);
      expect(entry!.source).toBe("user-override");
    });
  });

  // ─── Provider metadata overrides ──────────────────────────────────────

  describe("provider metadata overrides", () => {
    it("provider metadata overrides static registry", () => {
      const reg = new ModelCapabilityRegistry();

      reg.registerProviderMetadata("ollama", "qwen3:8b", {
        hasThinking: true,
        hasToolCalling: true,
        contextWindow: 200_000,
      });

      const entry = reg.lookup("ollama", "qwen3:8b");
      expect(entry!.contextWindow).toBe(200_000);
      expect(entry!.source).toBe("provider-metadata");
    });

    it("user override takes precedence over provider metadata", () => {
      const reg = new ModelCapabilityRegistry();

      reg.registerProviderMetadata("ollama", "qwen3:8b", {
        hasThinking: true,
        hasToolCalling: true,
        contextWindow: 200_000,
      });

      reg.registerUserOverride("ollama", "qwen3:8b", {
        hasThinking: false,
        hasToolCalling: false,
        contextWindow: 50_000,
      });

      const entry = reg.lookup("ollama", "qwen3:8b");
      expect(entry!.contextWindow).toBe(50_000);
      expect(entry!.source).toBe("user-override");
    });
  });

  // ─── Key construction ─────────────────────────────────────────────────

  describe("makeKey", () => {
    it("builds provider:model key", () => {
      expect(ModelCapabilityRegistry.makeKey("ollama", "qwen3:8b")).toBe("ollama:qwen3:8b");
    });

    it("normalizes to lowercase", () => {
      expect(ModelCapabilityRegistry.makeKey("Ollama", "Qwen3:8B")).toBe("ollama:qwen3:8b");
    });

    it("trims whitespace", () => {
      expect(ModelCapabilityRegistry.makeKey("ollama", "  qwen3:8b  ")).toBe("ollama:qwen3:8b");
    });

    it("returns just model when provider is undefined", () => {
      expect(ModelCapabilityRegistry.makeKey(undefined, "qwen3:8b")).toBe("qwen3:8b");
    });
  });

  // ─── Singleton behavior ───────────────────────────────────────────────

  describe("singleton", () => {
    it("returns same instance from getModelCapabilityRegistry", () => {
      const a = getModelCapabilityRegistry();
      const b = getModelCapabilityRegistry();
      expect(a).toBe(b);
    });

    it("reset creates new instance", () => {
      const a = getModelCapabilityRegistry();
      resetModelCapabilityRegistry();
      const b = getModelCapabilityRegistry();
      expect(a).not.toBe(b);
    });
  });

  // ─── clearOverrides ───────────────────────────────────────────────────

  describe("clearOverrides", () => {
    it("clears user and provider overrides but not static entries", () => {
      const reg = new ModelCapabilityRegistry();
      const staticBefore = reg.lookup("ollama", "qwen3:8b");

      reg.registerUserOverride("ollama", "qwen3:8b", {
        hasThinking: false,
        hasToolCalling: false,
        contextWindow: 1_000,
      });
      expect(reg.lookup("ollama", "qwen3:8b")!.contextWindow).toBe(1_000);

      reg.clearOverrides();

      const afterClear = reg.lookup("ollama", "qwen3:8b");
      expect(afterClear!.contextWindow).toBe(staticBefore!.contextWindow);
    });
  });

  // ─── has() ────────────────────────────────────────────────────────────

  describe("has()", () => {
    it("returns true for known model", () => {
      const reg = new ModelCapabilityRegistry();
      expect(reg.has("ollama", "qwen3:8b")).toBe(true);
    });

    it("returns false for unknown model", () => {
      const reg = new ModelCapabilityRegistry();
      expect(reg.has("ollama", "nonexistent")).toBe(false);
    });

    it("returns true after registering override", () => {
      const reg = new ModelCapabilityRegistry();
      reg.registerUserOverride("ollama", "custom", {
        hasThinking: false,
        hasToolCalling: false,
        contextWindow: 8_000,
      });
      expect(reg.has("ollama", "custom")).toBe(true);
    });
  });

  // ─── size ─────────────────────────────────────────────────────────────

  describe("size", () => {
    it("reports static entry count", () => {
      const reg = new ModelCapabilityRegistry();
      expect(reg.size).toBeGreaterThan(0);
    });

    it("increases after adding overrides", () => {
      const reg = new ModelCapabilityRegistry();
      const before = reg.size;
      reg.registerUserOverride("ollama", "new-model", {
        hasThinking: false,
        hasToolCalling: false,
        contextWindow: 8_000,
      });
      expect(reg.size).toBe(before + 1);
    });
  });
});

// ─── detectModelCapabilities backward compatibility ──────────────────────────

describe("NC-015: detectModelCapabilities with registry", () => {
  beforeEach(() => {
    resetModelCapabilityRegistry();
  });

  describe("registry-backed lookups", () => {
    it("detects ollama:qwen3:8b capabilities from registry", () => {
      const caps = detectModelCapabilities("qwen3:8b", "ollama");
      expect(caps.contextWindow).toBe(128_000);
      expect(caps.hasThinking).toBe(true);
      expect(caps.hasToolCalling).toBe(true);
    });

    it("detects ollama:qwen2.5-coder:14b capabilities from registry", () => {
      const caps = detectModelCapabilities("qwen2.5-coder:14b", "ollama");
      expect(caps.contextWindow).toBe(32_768);
      expect(caps.hasThinking).toBe(false);
      expect(caps.hasToolCalling).toBe(true);
    });

    it("detects ollama:deepseek-r1:8b capabilities from registry", () => {
      const caps = detectModelCapabilities("deepseek-r1:8b", "ollama");
      expect(caps.contextWindow).toBe(128_000);
      expect(caps.hasThinking).toBe(true);
      expect(caps.hasToolCalling).toBe(true);
    });

    it("detects openai-compatible:gpt-4o capabilities from registry", () => {
      const caps = detectModelCapabilities("gpt-4o", "openai-compatible");
      expect(caps.contextWindow).toBe(128_000);
      expect(caps.hasToolCalling).toBe(true);
      expect(caps.hasThinking).toBe(false);
    });

    it("detects openai-compatible:claude-sonnet-4 capabilities from registry", () => {
      const caps = detectModelCapabilities("claude-sonnet-4", "openai-compatible");
      expect(caps.contextWindow).toBe(128_000);
      expect(caps.hasThinking).toBe(true);
      expect(caps.hasToolCalling).toBe(true);
    });

    it("detects groq:llama-3.3-70b-versatile from registry", () => {
      const caps = detectModelCapabilities("llama-3.3-70b-versatile", "groq");
      expect(caps.contextWindow).toBe(128_000);
      expect(caps.hasToolCalling).toBe(true);
      expect(caps.hasThinking).toBe(false);
    });
  });

  describe("unknown models — conservative heuristic fallback", () => {
    it("unknown model without provider gets 32K context (not 64K)", () => {
      const caps = detectModelCapabilities("unknown-model:latest");
      expect(caps.contextWindow).toBe(32_000);
      expect(caps.hasToolCalling).toBe(false);
      expect(caps.hasThinking).toBe(false);
    });

    it("empty model gets 32K context", () => {
      const caps = detectModelCapabilities("");
      expect(caps.contextWindow).toBe(32_000);
    });

    it("unknown model with known provider still falls back to heuristic", () => {
      const caps = detectModelCapabilities("some-obscure-model:3b", "ollama");
      expect(caps.contextWindow).toBe(32_000);
      expect(caps.hasToolCalling).toBe(false);
      expect(caps.hasThinking).toBe(false);
    });
  });

  describe("heuristic fallback for unrecognized models with known substrings", () => {
    it("model containing 'deepseek-r1' gets thinking from heuristic", () => {
      const caps = detectModelCapabilities("deepseek-r1:32b-custom", "ollama");
      expect(caps.hasThinking).toBe(true);
    });

    it("model containing 'qwen3' gets thinking from heuristic", () => {
      const caps = detectModelCapabilities("qwen3-custom-finetune", "ollama");
      expect(caps.hasThinking).toBe(true);
    });

    it("model containing 'gpt-4' gets 128K from heuristic", () => {
      const caps = detectModelCapabilities("gpt-4-fine-tuned-v2", "openai-compatible");
      expect(caps.contextWindow).toBe(128_000);
      expect(caps.hasToolCalling).toBe(true);
    });

    it("model containing 'llama' gets tool calling from heuristic", () => {
      const caps = detectModelCapabilities("llama-custom-fine-tune", "ollama");
      expect(caps.hasToolCalling).toBe(true);
    });
  });

  describe("backward compatibility with existing test expectations", () => {
    it("qwen2.5-coder:14b still gets 32768 context", () => {
      expect(detectModelCapabilities("qwen2.5-coder:14b").contextWindow).toBe(32768);
    });

    it("qwen2.5-coder:7b still gets 32768 context", () => {
      expect(detectModelCapabilities("qwen2.5-coder:7b").contextWindow).toBe(32768);
    });

    it("deepseek-r1:8b still gets 128000 context and thinking", () => {
      const caps = detectModelCapabilities("deepseek-r1:8b");
      expect(caps.contextWindow).toBe(128000);
      expect(caps.hasThinking).toBe(true);
    });

    it("qwen3:8b still gets 128000 context and thinking", () => {
      const caps = detectModelCapabilities("qwen3:8b");
      expect(caps.contextWindow).toBe(128000);
      expect(caps.hasThinking).toBe(true);
    });

    it("unknown model gets 32000 context (NC-015 change: was 64000)", () => {
      const caps = detectModelCapabilities("unknown-model:latest");
      expect(caps.contextWindow).toBe(32000);
    });

    it("empty string gets 32000 context (NC-015 change: was 64000)", () => {
      const caps = detectModelCapabilities("");
      expect(caps.contextWindow).toBe(32000);
    });

    it("is case-insensitive for heuristic", () => {
      expect(detectModelCapabilities("QWEN2.5-CODER:14B").contextWindow).toBe(32768);
      expect(detectModelCapabilities("DeepSeek-R1:8B").contextWindow).toBe(128000);
    });

    it("qwen2.5-coder:14b has no thinking", () => {
      expect(detectModelCapabilities("qwen2.5-coder:14b").hasThinking).toBe(false);
    });

    it("llama3:8b has no thinking", () => {
      expect(detectModelCapabilities("llama3:8b").hasThinking).toBe(false);
    });

    it("qwen2.5-coder:14b has tool calling", () => {
      expect(detectModelCapabilities("qwen2.5-coder:14b").hasToolCalling).toBe(true);
    });

    it("deepseek-r1:8b has tool calling", () => {
      expect(detectModelCapabilities("deepseek-r1:8b").hasToolCalling).toBe(true);
    });

    it("qwen3:8b has tool calling", () => {
      expect(detectModelCapabilities("qwen3:8b").hasToolCalling).toBe(true);
    });

    it("llama3:8b has tool calling", () => {
      expect(detectModelCapabilities("llama3:8b").hasToolCalling).toBe(true);
    });

    it("unknown model has no tool calling", () => {
      expect(detectModelCapabilities("unknown-model:latest").hasToolCalling).toBe(false);
    });
  });
});

// ─── Integration: registry overrides flow through detectModelCapabilities ────

describe("NC-015: integration — registry overrides affect detectModelCapabilities", () => {
  beforeEach(() => {
    resetModelCapabilityRegistry();
  });

  it("user override applied to registry is reflected in detectModelCapabilities", () => {
    const reg = getModelCapabilityRegistry();
    reg.registerUserOverride("ollama", "my-model", {
      hasThinking: true,
      hasToolCalling: true,
      contextWindow: 256_000,
    });

    const caps = detectModelCapabilities("my-model", "ollama");
    expect(caps.contextWindow).toBe(256_000);
    expect(caps.hasThinking).toBe(true);
    expect(caps.hasToolCalling).toBe(true);
  });

  it("provider metadata override is reflected in detectModelCapabilities", () => {
    const reg = getModelCapabilityRegistry();
    reg.registerProviderMetadata("groq", "llama-3.3-70b-versatile", {
      hasThinking: false,
      hasToolCalling: true,
      contextWindow: 256_000,
    });

    const caps = detectModelCapabilities("llama-3.3-70b-versatile", "groq");
    expect(caps.contextWindow).toBe(256_000);
  });

  it("clearing overrides restores static registry behavior", () => {
    const reg = getModelCapabilityRegistry();
    reg.registerUserOverride("ollama", "qwen3:8b", {
      hasThinking: false,
      hasToolCalling: false,
      contextWindow: 8_000,
    });

    expect(detectModelCapabilities("qwen3:8b", "ollama").contextWindow).toBe(8_000);

    reg.clearOverrides();

    expect(detectModelCapabilities("qwen3:8b", "ollama").contextWindow).toBe(128_000);
  });
});
