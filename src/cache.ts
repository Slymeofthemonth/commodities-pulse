// Simple in-memory cache with TTL

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttlMs: number;
}

class Cache {
  private store = new Map<string, CacheEntry<unknown>>();

  async get<T>(key: string, fetcher: () => Promise<T>, ttlMs = 60000): Promise<T> {
    const existing = this.store.get(key) as CacheEntry<T> | undefined;
    
    if (existing && Date.now() - existing.timestamp < existing.ttlMs) {
      return existing.data;
    }

    const data = await fetcher();
    this.store.set(key, { data, timestamp: Date.now(), ttlMs });
    return data;
  }

  getAge(key: string): number | null {
    const entry = this.store.get(key);
    if (!entry) return null;
    return Math.floor((Date.now() - entry.timestamp) / 1000);
  }
}

export const cache = new Cache();
