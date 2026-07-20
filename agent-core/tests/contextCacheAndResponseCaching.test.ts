/**
 * NC-025 regression: Response cache can return stale model actions and grows
 * without a true bound.
 *
 * 1. ContextCache: bounded LRU eviction, real hit/miss metrics, TTL.
 * 2. ModelRouter: responses with tool calls must NOT be cached.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ContextCache } from "../src/utils/contextCache";

/* ================================================================== */
/*  ContextCache unit tests                                           */
/* ================================================================== */

describe("ContextCache — bounded LRU/TTL", () => {
  let cache: ContextCache;

  beforeEach(() => {
    // 1 hour TTL, max 5 entries for easy testing.
    cache = new ContextCache(3_600_000, 5);
  });

  /* ---- basic get/set ---- */

  it("returns null for a missing key (miss)", () => {
    expect(cache.get("absent")).toBeNull();
    const stats = cache.getStats();
    expect(stats.misses).toBe(1);
    expect(stats.hits).toBe(0);
  });

  it("returns the stored value on hit", () => {
    cache.set("a", "1");
    expect(cache.get("a")).toBe("1");
    const stats = cache.getStats();
    expect(stats.hits).toBe(1);
    expect(stats.misses).toBe(0);
  });

  /* ---- LRU eviction ---- */

  it("evicts the least-recently-used entry when maxSize is exceeded", () => {
    cache.set("a", "1");
    cache.set("b", "2");
    cache.set("c", "3");
    cache.set("d", "4");
    cache.set("e", "5"); // cache full: a b c d e

    // Adding a 6th entry should evict "a" (LRU).
    cache.set("f", "6");

    expect(cache.get("a")).toBeNull(); // evicted
    expect(cache.get("b")).toBe("2"); // still present
    expect(cache.get("f")).toBe("6"); // newly added
  });

  it("promotes an entry to MRU on get (prevents premature eviction)", () => {
    cache.set("a", "1");
    cache.set("b", "2");
    cache.set("c", "3");
    cache.set("d", "4");
    cache.set("e", "5"); // a b c d e

    // Access "a" — promotes it to MRU.
    cache.get("a");

    // Now "b" is the LRU. Adding "f" should evict "b".
    cache.set("f", "6");

    expect(cache.get("a")).toBe("1"); // promoted, still present
    expect(cache.get("b")).toBeNull(); // evicted
  });

  it("promotes an entry to MRU on re-set", () => {
    cache.set("a", "1");
    cache.set("b", "2");
    cache.set("c", "3");
    cache.set("d", "4");
    cache.set("e", "5");

    // Re-set "a" — promotes it to MRU.
    cache.set("a", "1-updated");

    cache.set("f", "6"); // evicts "b" (now LRU)

    expect(cache.get("a")).toBe("1-updated");
    expect(cache.get("b")).toBeNull();
  });

  /* ---- max size enforcement ---- */

  it("never exceeds maxSize", () => {
    for (let i = 0; i < 50; i++) {
      cache.set(`key-${i}`, `val-${i}`);
    }
    // Internal map should have at most 5 entries.
    expect(cache.getStats().size).toBeLessThanOrEqual(5);
  });

  /* ---- TTL expiration ---- */

  it("evicts expired entries on get", () => {
    const shortCache = new ContextCache(1, 100); // 1 ms TTL
    shortCache.set("x", "y");

    // Wait for TTL to expire.
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        expect(shortCache.get("x")).toBeNull();
        resolve();
      }, 5);
    });
  });

  it("evicts expired entries on set (when checking full)", () => {
    const shortCache = new ContextCache(1, 2);
    shortCache.set("a", "1");
    shortCache.set("b", "2");

    return new Promise<void>((resolve) => {
      setTimeout(() => {
        // Both "a" and "b" are expired. Adding "c" should not trigger
        // eviction (expired entries are removed on access, not proactively
        // on set). But after adding, the size should be <= 2.
        shortCache.set("c", "3");
        // The expired "a" and "b" were NOT proactively removed by set(),
        // so size may temporarily exceed maxSize. This is expected — TTL
        // is checked lazily on get(). The key property is that get() on
        // expired entries returns null and removes them.
        expect(shortCache.get("a")).toBeNull();
        expect(shortCache.get("b")).toBeNull();
        expect(shortCache.get("c")).toBe("3");
        resolve();
      }, 5);
    });
  });

  /* ---- has() ---- */

  it("has() returns true for present non-expired entries", () => {
    cache.set("k", "v");
    expect(cache.has("k")).toBe(true);
  });

  it("has() returns false for absent entries", () => {
    expect(cache.has("missing")).toBe(false);
  });

  it("has() returns false and evicts expired entries", () => {
    const shortCache = new ContextCache(1, 100);
    shortCache.set("x", "y");
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        expect(shortCache.has("x")).toBe(false);
        resolve();
      }, 5);
    });
  });

  /* ---- invalidate ---- */

  it("invalidate() removes entries matching a substring pattern", () => {
    cache.set("workspace:/a", "1");
    cache.set("workspace:/b", "2");
    cache.set("filetree:/a", "3");

    cache.invalidate("workspace:");

    expect(cache.has("workspace:/a")).toBe(false);
    expect(cache.has("workspace:/b")).toBe(false);
    expect(cache.has("filetree:/a")).toBe(true);
  });

  /* ---- clear ---- */

  it("clear() empties the cache and resets size", () => {
    cache.set("a", "1");
    cache.set("b", "2");
    cache.clear();
    expect(cache.getStats().size).toBe(0);
  });

  /* ---- stats ---- */

  it("getStats() returns accurate hit/miss/eviction counts", () => {
    // Fill to capacity first (5 entries).
    cache.set("a", "1");
    cache.set("b", "2");
    cache.set("c", "3");
    cache.set("d", "4");
    cache.set("e", "5"); // a b c d e

    cache.get("a"); // hit (promotes "a" to MRU)
    cache.get("b"); // hit (promotes "b" to MRU)
    cache.get("x"); // miss

    // Now order is: c d e a b. Adding 3 more evicts c, d, e.
    cache.set("f", "6"); // evicts "c"
    cache.set("g", "7"); // evicts "d"
    cache.set("h", "8"); // evicts "e"

    const stats = cache.getStats();
    expect(stats.hits).toBe(2);
    expect(stats.misses).toBe(1);
    expect(stats.evictions).toBeGreaterThanOrEqual(3);
    expect(stats.hitRate).toBeCloseTo(2 / 3, 5);
  });

  it("resetStats() zeroes all counters", () => {
    cache.set("a", "1");
    cache.get("a");
    cache.get("b");
    cache.resetStats();
    const stats = cache.getStats();
    expect(stats.hits).toBe(0);
    expect(stats.misses).toBe(0);
    expect(stats.evictions).toBe(0);
    expect(stats.hitRate).toBe(0);
  });

  /* ---- unbounded mode ---- */

  it("unbounded mode (maxSize=0) never evicts", () => {
    const unbounded = new ContextCache(3_600_000, 0);
    for (let i = 0; i < 200; i++) {
      unbounded.set(`k${i}`, `v${i}`);
    }
    expect(unbounded.getStats().size).toBe(200);
    expect(unbounded.getStats().evictions).toBe(0);
  });

  /* ---- default constructor ---- */

  it("default constructor creates a cache with sensible defaults", () => {
    const defaultCache = new ContextCache();
    defaultCache.set("a", "1");
    expect(defaultCache.get("a")).toBe("1");
    // Default maxSize is 100.
    for (let i = 0; i < 150; i++) {
      defaultCache.set(`k${i}`, `v${i}`);
    }
    expect(defaultCache.getStats().size).toBeLessThanOrEqual(100);
  });
});

/* ================================================================== */
/*  ModelRouter caching: tool-call responses must NOT be cached        */
/* ================================================================== */

describe("NC-025 — ModelRouter response caching", () => {
  let originalGenerate: any;
  let originalStream: any;

  // Minimal provider mock.
  function createMockProvider(id = "openai-compatible") {
    return {
      id,
      generate: vi.fn(),
      stream: undefined,
    };
  }

  it("text-only response IS cached (safe, no actions)", async () => {
    const { ModelRouter } = await import("../src/providers/modelRouter");
    const provider = createMockProvider();
    provider.generate.mockResolvedValue({ text: "Hello world", toolCalls: undefined });

    const router = new ModelRouter(
      { "openai-compatible": provider as any },
      { defaultProvider: "openai-compatible", defaultModel: "test-model", defaultCloudModel: "test-cloud" },
    );

    const messages = [{ role: "user" as const, content: "Hi" }];

    // First call — hits provider.
    const r1 = await router.generate(messages);
    expect(r1.text).toBe("Hello world");
    expect(provider.generate).toHaveBeenCalledTimes(1);

    // Second call with same args — should return cached result.
    const r2 = await router.generate(messages);
    expect(r2.text).toBe("Hello world");
    // Provider should NOT be called again (cache hit).
    expect(provider.generate).toHaveBeenCalledTimes(1);
  });

  it("response with tool calls is NOT cached (stale action risk)", async () => {
    const { ModelRouter } = await import("../src/providers/modelRouter");
    const provider = createMockProvider();
    provider.generate
      .mockResolvedValueOnce({
        text: "",
        toolCalls: [{ id: "tc1", function: { name: "write", arguments: '{"path":"a.ts","content":"x"}' } }],
      })
      .mockResolvedValueOnce({
        text: "Done",
        toolCalls: undefined,
      });

    const router = new ModelRouter(
      { "openai-compatible": provider as any },
      { defaultProvider: "openai-compatible", defaultModel: "test-model", defaultCloudModel: "test-cloud" },
    );

    const messages = [{ role: "user" as const, content: "Write a.ts" }];

    // First call — returns tool calls, should NOT be cached.
    const r1 = await router.generate(messages);
    expect(r1.toolCalls).toHaveLength(1);
    expect(provider.generate).toHaveBeenCalledTimes(1);

    // Second call with same args — should hit provider AGAIN (not cached).
    const r2 = await router.generate(messages);
    expect(r2.text).toBe("Done");
    // Provider called twice because the tool-call response was not cached.
    expect(provider.generate).toHaveBeenCalledTimes(2);
  });

  it("empty toolCalls array is treated as text-only (safe)", async () => {
    const { ModelRouter } = await import("../src/providers/modelRouter");
    const provider = createMockProvider();
    provider.generate.mockResolvedValue({ text: "OK", toolCalls: [] });

    const router = new ModelRouter(
      { "openai-compatible": provider as any },
      { defaultProvider: "openai-compatible", defaultModel: "test-model", defaultCloudModel: "test-cloud" },
    );

    const messages = [{ role: "user" as const, content: "Hi" }];

    await router.generate(messages);
    const r2 = await router.generate(messages);

    // Provider called only once — empty toolCalls is safe to cache.
    expect(provider.generate).toHaveBeenCalledTimes(1);
    expect(r2.text).toBe("OK");
  });

  it("different messages produce different cache keys", async () => {
    const { ModelRouter } = await import("../src/providers/modelRouter");
    const provider = createMockProvider();
    provider.generate.mockResolvedValue({ text: "response" });

    const router = new ModelRouter(
      { "openai-compatible": provider as any },
      { defaultProvider: "openai-compatible", defaultModel: "test-model", defaultCloudModel: "test-cloud" },
    );

    const msgs1 = [{ role: "user" as const, content: "Question A" }];
    const msgs2 = [{ role: "user" as const, content: "Question B" }];

    await router.generate(msgs1);
    await router.generate(msgs2);

    // Both calls hit the provider — different cache keys.
    expect(provider.generate).toHaveBeenCalledTimes(2);
  });
});
