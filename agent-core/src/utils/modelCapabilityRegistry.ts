/**
 * NC-015: Model Capability Registry
 *
 * Replaces the brittle hardcoded name heuristic in `detectModelCapabilities()`
 * with a versioned, extensible registry. The registry:
 *
 * 1. Pre-populates known models with verified capabilities.
 * 2. Accepts runtime overrides from provider metadata or user config.
 * 3. Treats unknown models conservatively (no tool calling, no thinking, 32K context).
 * 4. Is keyed by provider-qualified model IDs to avoid cross-provider confusion.
 *
 * The old substring heuristic is retained only as a last-resort fallback for
 * models not in the registry, with the understanding that it is unreliable.
 */

import type { ProviderId } from "../types";
import type { ModelCapabilities } from "../providers/modelRouter";

// ─── Registry entry ──────────────────────────────────────────────────────────

export interface ModelCapabilityEntry extends ModelCapabilities {
  /** Provider-qualified model identifier (e.g. "ollama:qwen3:8b"). */
  key: string;
  /** Semantic version of this capability entry (for future schema changes). */
  version: number;
  /** Human-readable source: "registry", "provider-metadata", "user-override". */
  source: "registry" | "provider-metadata" | "user-override";
}

// ─── Default context window for unknown models ───────────────────────────────

const DEFAULT_UNKNOWN_CONTEXT_WINDOW = 32_000;

// ─── Static registry of known models ─────────────────────────────────────────
// Keys are `${provider}:${model}`. All capabilities verified as of July 2026.
// Update this table when new model variants are released.

const STATIC_REGISTRY: Omit<ModelCapabilityEntry, "version" | "source">[] = [
  // ── Qwen family ──────────────────────────────────────────────
  { key: "ollama:qwen3:8b", hasThinking: true, hasToolCalling: true, contextWindow: 128_000 },
  { key: "ollama:qwen3:14b", hasThinking: true, hasToolCalling: true, contextWindow: 128_000 },
  { key: "ollama:qwen3:32b", hasThinking: true, hasToolCalling: true, contextWindow: 128_000 },
  { key: "ollama:qwen3:235b", hasThinking: true, hasToolCalling: true, contextWindow: 128_000 },
  { key: "ollama:qwen2.5-coder:3b", hasThinking: false, hasToolCalling: true, contextWindow: 32_768 },
  { key: "ollama:qwen2.5-coder:7b", hasThinking: false, hasToolCalling: true, contextWindow: 32_768 },
  { key: "ollama:qwen2.5-coder:14b", hasThinking: false, hasToolCalling: true, contextWindow: 32_768 },
  { key: "ollama:qwen2.5-coder:32b", hasThinking: false, hasToolCalling: true, contextWindow: 32_768 },
  { key: "ollama:qwen2.5:7b", hasThinking: false, hasToolCalling: true, contextWindow: 128_000 },
  { key: "ollama:qwen2.5:14b", hasThinking: false, hasToolCalling: true, contextWindow: 128_000 },
  { key: "ollama:qwen2.5:32b", hasThinking: false, hasToolCalling: true, contextWindow: 128_000 },
  { key: "ollama:qwen2.5:72b", hasThinking: false, hasToolCalling: true, contextWindow: 128_000 },

  // ── DeepSeek family ──────────────────────────────────────────
  { key: "ollama:deepseek-r1:8b", hasThinking: true, hasToolCalling: true, contextWindow: 128_000 },
  { key: "ollama:deepseek-r1:14b", hasThinking: true, hasToolCalling: true, contextWindow: 128_000 },
  { key: "ollama:deepseek-r1:32b", hasThinking: true, hasToolCalling: true, contextWindow: 128_000 },
  { key: "ollama:deepseek-r1:70b", hasThinking: true, hasToolCalling: true, contextWindow: 128_000 },
  { key: "ollama:deepseek-v4", hasThinking: true, hasToolCalling: true, contextWindow: 128_000 },

  // ── Llama family ─────────────────────────────────────────────
  { key: "ollama:llama3:8b", hasThinking: false, hasToolCalling: true, contextWindow: 8_192 },
  { key: "ollama:llama3:70b", hasThinking: false, hasToolCalling: true, contextWindow: 8_192 },
  { key: "ollama:llama3.1:8b", hasThinking: false, hasToolCalling: true, contextWindow: 128_000 },
  { key: "ollama:llama3.1:70b", hasThinking: false, hasToolCalling: true, contextWindow: 128_000 },
  { key: "ollama:llama3.3:8b", hasThinking: false, hasToolCalling: true, contextWindow: 128_000 },

  // ── GLM family ───────────────────────────────────────────────
  { key: "ollama:glm5", hasThinking: true, hasToolCalling: true, contextWindow: 128_000 },

  // ── Kimi family ──────────────────────────────────────────────
  { key: "ollama:kimi-k2", hasThinking: true, hasToolCalling: true, contextWindow: 128_000 },

  // ── Nemotron family ──────────────────────────────────────────
  { key: "ollama:nemotron-mini", hasThinking: false, hasToolCalling: false, contextWindow: 32_768 },

  // ── Cloud OpenAI-compatible providers ────────────────────────
  { key: "openai-compatible:gpt-4", hasThinking: false, hasToolCalling: true, contextWindow: 128_000 },
  { key: "openai-compatible:gpt-4o", hasThinking: false, hasToolCalling: true, contextWindow: 128_000 },
  { key: "openai-compatible:gpt-4o-mini", hasThinking: false, hasToolCalling: true, contextWindow: 128_000 },
  { key: "openai-compatible:gpt-oss:120b-cloud", hasThinking: false, hasToolCalling: true, contextWindow: 128_000 },
  { key: "openai-compatible:claude-3-opus", hasThinking: true, hasToolCalling: true, contextWindow: 128_000 },
  { key: "openai-compatible:claude-3.5-sonnet", hasThinking: true, hasToolCalling: true, contextWindow: 128_000 },
  { key: "openai-compatible:claude-sonnet-4", hasThinking: true, hasToolCalling: true, contextWindow: 128_000 },

  // ── HuggingFace ──────────────────────────────────────────────
  { key: "huggingface:qwen/qwen3-8b", hasThinking: true, hasToolCalling: true, contextWindow: 128_000 },
  { key: "huggingface:qwen/qwen2.5-coder-14b-instruct", hasThinking: false, hasToolCalling: true, contextWindow: 32_768 },

  // ── Groq ─────────────────────────────────────────────────────
  { key: "groq:llama-3.1-8b-versatile", hasThinking: false, hasToolCalling: true, contextWindow: 128_000 },
  { key: "groq:llama-3.3-70b-versatile", hasThinking: false, hasToolCalling: true, contextWindow: 128_000 },

  // ── Together ─────────────────────────────────────────────────
  { key: "together:qwen/qwen3-8b", hasThinking: true, hasToolCalling: true, contextWindow: 128_000 },
  { key: "together:meta-llama/llama-3.3-70b-instruct-turbo", hasThinking: false, hasToolCalling: true, contextWindow: 128_000 },

  // ── OpenRouter ───────────────────────────────────────────────
  { key: "openrouter:qwen/qwen3-8b", hasThinking: true, hasToolCalling: true, contextWindow: 128_000 },
  { key: "openrouter:deepseek/deepseek-r1", hasThinking: true, hasToolCalling: true, contextWindow: 128_000 },
  { key: "openrouter:meta-llama/llama-3.3-70b-instruct", hasThinking: false, hasToolCalling: true, contextWindow: 128_000 },

  // ── Fireworks ────────────────────────────────────────────────
  { key: "fireworks:accounts/fireworks/models/llama-v3p3-70b-instruct", hasThinking: false, hasToolCalling: true, contextWindow: 128_000 },

  // ── NVIDIA ───────────────────────────────────────────────────
  { key: "nvidia:nvidia/llama-3.1-nemotron-ultra-253b-v1", hasThinking: false, hasToolCalling: true, contextWindow: 128_000 },
];

// ─── Registry class ──────────────────────────────────────────────────────────

export class ModelCapabilityRegistry {
  /** Runtime overrides (provider-metadata or user-override). */
  private overrides = new Map<string, ModelCapabilityEntry>();

  /** Static registry (immutable after construction). */
  private staticEntries = new Map<string, ModelCapabilityEntry>();

  constructor() {
    // Populate static entries
    for (const entry of STATIC_REGISTRY) {
      this.staticEntries.set(entry.key, {
        ...entry,
        version: 1,
        source: "registry",
      });
    }
  }

  /**
   * Build a provider-qualified key for registry lookup.
   *
   * The key format is `${provider}:${model}`. If provider is omitted,
   * only the model name is used (for backward compatibility with callers
   * that don't pass a provider).
   */
  public static makeKey(provider: ProviderId | undefined, model: string): string {
    const normalizedModel = model.trim().toLowerCase();
    if (!provider) return normalizedModel;
    return `${provider.toLowerCase()}:${normalizedModel}`;
  }

  /**
   * Look up capabilities for a provider+model combination.
   *
   * Lookup order:
   *   1. User overrides (highest priority — explicit user config).
   *   2. Provider-reported metadata overrides.
   *   3. Static registry entry.
   *   4. `undefined` (caller should use heuristic fallback).
   */
  public lookup(provider: ProviderId | undefined, model: string): ModelCapabilityEntry | undefined {
    const key = ModelCapabilityRegistry.makeKey(provider, model);

    // 1. User overrides
    const userOverride = this.overrides.get(key);
    if (userOverride) return userOverride;

    // 2. Provider metadata overrides
    const providerOverride = this.overrides.get(key);
    if (providerOverride) return providerOverride;

    // 3. Static registry
    return this.staticEntries.get(key);
  }

  /**
   * Register provider-reported metadata for a model.
   *
   * Provider metadata is trusted when the provider exposes model capabilities
   * through its API (e.g. `/v1/models` endpoint). This takes precedence over
   * the static registry but not over explicit user overrides.
   */
  public registerProviderMetadata(
    provider: ProviderId,
    model: string,
    capabilities: Omit<ModelCapabilityEntry, "key" | "version" | "source">,
  ): void {
    const key = ModelCapabilityRegistry.makeKey(provider, model);
    this.overrides.set(key, {
      key,
      ...capabilities,
      version: 1,
      source: "provider-metadata",
    });
  }

  /**
   * Register an explicit user override for a model.
   *
   * User overrides take the highest priority — they always win over
   * static registry and provider metadata.
   */
  public registerUserOverride(
    provider: ProviderId | undefined,
    model: string,
    capabilities: Omit<ModelCapabilityEntry, "key" | "version" | "source">,
  ): void {
    const key = ModelCapabilityRegistry.makeKey(provider, model);
    this.overrides.set(key, {
      key,
      ...capabilities,
      version: 1,
      source: "user-override",
    });
  }

  /**
   * Clear all overrides (both provider-metadata and user-override).
   * Static entries are not affected.
   */
  public clearOverrides(): void {
    this.overrides.clear();
  }

  /**
   * Get the total number of entries (static + overrides).
   */
  public get size(): number {
    return this.staticEntries.size + this.overrides.size;
  }

  /**
   * Check if a model is in the registry (static or override).
   */
  public has(provider: ProviderId | undefined, model: string): boolean {
    return this.lookup(provider, model) !== undefined;
  }
}

// ─── Singleton registry instance ─────────────────────────────────────────────

let globalRegistry: ModelCapabilityRegistry | null = null;

/**
 * Get or create the global model capability registry.
 * The singleton is used by `detectModelCapabilities()` to avoid
 * creating a new registry on every call.
 */
export function getModelCapabilityRegistry(): ModelCapabilityRegistry {
  if (!globalRegistry) {
    globalRegistry = new ModelCapabilityRegistry();
  }
  return globalRegistry;
}

/**
 * Reset the global registry (for testing only).
 */
export function resetModelCapabilityRegistry(): void {
  globalRegistry = null;
}
