// KV abstraction: Workers KV in production, in-memory for sandbox tests.
// TTL semantics: expired entries treated as missing.

export interface KVLike {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, ttlSec?: number): Promise<void>;
  delete(key: string): Promise<void>;
}

interface Entry { v: string; exp: number; }

export class MemoryKV implements KVLike {
  private m = new Map<string, Entry>();
  async get(key: string): Promise<string | null> {
    const e = this.m.get(key);
    if (!e) return null;
    if (e.exp && Date.now() > e.exp) { this.m.delete(key); return null; }
    return e.v;
  }
  async put(key: string, value: string, ttlSec?: number): Promise<void> {
    this.m.set(key, { v: value, exp: ttlSec ? Date.now() + ttlSec * 1000 : 0 });
  }
  async delete(key: string): Promise<void> {
    this.m.delete(key);
  }
}

// Cached JSON helpers used across adapters.
export async function cachedJson<T>(kv: KVLike, key: string, ttlSec: number, loader: () => Promise<T>): Promise<{ value: T; hit: boolean }> {
  // KV is an optimization, not a dependency: fall through to the source if it is unavailable.
  let hit: string | null = null;
  try { hit = await kv.get(key); } catch { /* fail open; load fresh data */ }
  if (hit) {
    try { return { value: JSON.parse(hit) as T, hit: true }; } catch { /* fall through */ }
  }
  const value = await loader();
  try { await kv.put(key, JSON.stringify(value), ttlSec); } catch { /* cache write failure must not fail the request */ }
  return { value, hit: false };
}

// KV key plan per spec §18:
//   prof:{chain}:{addr} 10min, tx:{chain}:{addr}:{page} 10min,
//   lbl:{chain}:{addr} 24h, px:{symbol} 5min, ofac:synced_at,
//   fz:{chain}:{addr} 6h (issuer freeze), gp:{chain}:{addr} 6h (GoPlus),
//   ai:model 6h, ai:c:{chain}:{addr}:{score} 12h
export const KV_TTL = {
  profile: 600,
  txPage: 600,
  labels: 86400,
  price: 300,
  detectProbe: 300,
  freeze: 21600,   // freeze/goplus — медленно меняющееся on-chain состояние
  goplus: 21600,
  aiModel: 21600,
};
