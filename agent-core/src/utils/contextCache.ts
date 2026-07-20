/**
 * Bounded LRU/TTL context cache.
 *
 * Eviction order:
 * 1. TTL-expired entries are evicted on access (lazy) and on set (when full).
 * 2. When the cache exceeds `maxSize`, the least-recently-used entry is evicted.
 *
 * LRU is maintained by moving accessed entries to the end of the insertion order
 * on every `get()` and `set()` call.
 */

export interface ContextCacheStats {
  size: number;
  hits: number;
  misses: number;
  evictions: number;
  hitRate: number;
}

export class ContextCache {
  /** Insertion-order map. The first entry is the LRU; the last is the MRU. */
  private cache = new Map<string, { value: string; timestamp: number }>();
  private ttlMs: number;
  private maxSize: number;

  private hits = 0;
  private misses = 0;
  private evictions = 0;

  /**
   * @param ttlMs   Time-to-live in milliseconds (default 60 s).
   * @param maxSize Maximum number of entries (default 100).  0 = unbounded.
   */
  constructor(ttlMs: number = 60000, maxSize: number = 100) {
    this.ttlMs = ttlMs;
    this.maxSize = maxSize;
  }

  /* ------------------------------------------------------------------ */
  /*  Public API                                                        */
  /* ------------------------------------------------------------------ */

  get(key: string): string | null {
    const entry = this.cache.get(key);
    if (!entry) {
      this.misses++;
      return null;
    }

    // TTL expired — evict lazily.
    if (this.isExpired(entry)) {
      this.cache.delete(key);
      this.misses++;
      return null;
    }

    // Touch: move to end (most-recently-used).
    this.cache.delete(key);
    this.cache.set(key, entry);

    this.hits++;
    return entry.value;
  }

  set(key: string, value: string): void {
    // If the key already exists, delete first so re-insertion puts it at the end.
    if (this.cache.has(key)) {
      this.cache.delete(key);
    }

    // Evict LRU entries when the cache is full.
    while (this.maxSize > 0 && this.cache.size >= this.maxSize) {
      this.evictLRU();
    }

    this.cache.set(key, { value, timestamp: Date.now() });
  }

  invalidate(pattern: string): void {
    const keysToDelete: string[] = [];
    for (const key of this.cache.keys()) {
      if (key.includes(pattern)) {
        keysToDelete.push(key);
      }
    }
    for (const key of keysToDelete) {
      this.cache.delete(key);
    }
  }

  clear(): void {
    this.cache.clear();
  }

  has(key: string): boolean {
    const entry = this.cache.get(key);
    if (!entry) return false;
    if (this.isExpired(entry)) {
      this.cache.delete(key);
      return false;
    }
    return true;
  }

  getStats(): ContextCacheStats {
    const total = this.hits + this.misses;
    return {
      size: this.cache.size,
      hits: this.hits,
      misses: this.misses,
      evictions: this.evictions,
      hitRate: total === 0 ? 0 : this.hits / total,
    };
  }

  /** Reset hit/miss/eviction counters (useful in tests). */
  resetStats(): void {
    this.hits = 0;
    this.misses = 0;
    this.evictions = 0;
  }

  /* ------------------------------------------------------------------ */
  /*  Internals                                                         */
  /* ------------------------------------------------------------------ */

  private isExpired(entry: { timestamp: number }): boolean {
    return Date.now() - entry.timestamp > this.ttlMs;
  }

  /** Remove the least-recently-used (first) entry. */
  private evictLRU(): void {
    const firstKey = this.cache.keys().next().value;
    if (firstKey !== undefined) {
      this.cache.delete(firstKey);
      this.evictions++;
    }
  }
}
