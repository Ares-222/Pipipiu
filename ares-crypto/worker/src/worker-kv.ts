// Workers KV implementation of KVLike (production).

export interface KVNamespaceLike {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
}

export class WorkerKV {
  constructor(private ns: KVNamespaceLike) {}

  async get(key: string): Promise<string | null> {
    return this.ns.get(key);
  }
  async put(key: string, value: string, ttlSec?: number): Promise<void> {
    // KV minimum TTL is 60 s
    const ttl = Math.max(60, ttlSec ?? 600);
    await this.ns.put(key, value, { expirationTtl: ttl });
  }
  async delete(key: string): Promise<void> {
    await this.ns.delete(key);
  }
}
