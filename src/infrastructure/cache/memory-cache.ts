import type { Cache } from "../../domain/ports.js";

/**
 * In-process TTL cache with a size bound. Adequate for a single instance;
 * swap for a Redis adapter behind the same `Cache` port when running several.
 */
export class MemoryCache implements Cache {
  private readonly entries = new Map<string, { value: unknown; expiresAt: number }>();

  constructor(private readonly maxEntries = 10_000) {}

  async get<T>(key: string): Promise<T | undefined> {
    const e = this.entries.get(key);
    if (!e) return undefined;
    if (e.expiresAt <= Date.now()) {
      this.entries.delete(key);
      return undefined;
    }
    // Refresh insertion order so eviction is roughly LRU.
    this.entries.delete(key);
    this.entries.set(key, e);
    return e.value as T;
  }

  async set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    if (this.entries.size >= this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
    this.entries.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
  }

  get size(): number {
    return this.entries.size;
  }
}
