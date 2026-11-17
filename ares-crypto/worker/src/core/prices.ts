// USD prices: CoinGecko simple/price primary, DeFiLlama coins API fallback.
// Cached 5 min per spec §18 (px:{symbol}).

import { cachedJson, KV_TTL } from './kv.ts';
import type { KVLike } from './kv.ts';
import { fetchJson } from './http.ts';
import { toNum } from './util.ts';

// coingecko id -> symbol
export const CG_IDS = [
  'tron', 'the-open-network', 'ethereum', 'binancecoin', 'matic-network',
  'optimism', 'arbitrum', 'bitcoin', 'solana', 'tether', 'usd-coin',
] as const;

const SYMBOL_TO_ID: Record<string, string> = {
  TRX: 'tron', TON: 'the-open-network', ETH: 'ethereum', BNB: 'binancecoin',
  POL: 'matic-network', MATIC: 'matic-network', OP: 'optimism', ARB: 'arbitrum',
  BTC: 'bitcoin', SOL: 'solana', USDT: 'tether', USDC: 'usd-coin',
};

export class PriceService {
  private kv: KVLike;
  private mem = new Map<string, { v: number; exp: number }>();

  constructor(kv: KVLike) {
    this.kv = kv;
  }

  async priceBySymbol(symbol: string): Promise<number | undefined> {
    const sym = symbol.toUpperCase();
    const cgId = SYMBOL_TO_ID[sym];
    if (!cgId) return undefined;
    return this.priceByCgId(cgId);
  }

  async priceByCgId(cgId: string): Promise<number | undefined> {
    const key = `px:${cgId}`;
    const m = this.mem.get(key);
    if (m && Date.now() < m.exp) return m.v;
    const { value } = await cachedJson<{ usd?: number }>(this.kv, key, KV_TTL.price, async () => {
      // primary: CoinGecko
      try {
        const r = await fetchJson<Record<string, { usd: number }>>(
          `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(cgId)}&vs_currencies=usd`,
          { provider: 'coingecko', timeoutMs: 6000, retries: 1 },
        );
        const usd = r?.[cgId]?.usd;
        if (usd && usd > 0) return { usd };
      } catch { /* fall through to defillama */ }
      // fallback: DeFiLlama coins API (no key)
      const r2 = await fetchJson<{ coins: Record<string, { price: number }> }>(
        `https://coins.llama.fi/prices/current/coingecko:${encodeURIComponent(cgId)}`,
        { provider: 'defillama', timeoutMs: 6000, retries: 0 },
      );
      const usd2 = r2?.coins?.[`coingecko:${cgId}`]?.price;
      return { usd: usd2 && usd2 > 0 ? usd2 : 0 };
    });
    const usd = toNum(value?.usd);
    if (usd > 0) this.mem.set(key, { v: usd, exp: Date.now() + 30_000 }); // small in-memory micro-cache
    return usd > 0 ? usd : undefined;
  }

  // Batch for report rendering (single API call, still cached).
  async pricesByCgIds(ids: string[]): Promise<Record<string, number>> {
    const out: Record<string, number> = {};
    const missing: string[] = [];
    for (const id of ids) {
      const m = this.mem.get(`px:${id}`);
      if (m && Date.now() < m.exp) out[id] = m.v;
      else missing.push(id);
    }
    if (missing.length) {
      try {
        const r = await fetchJson<Record<string, { usd: number }>>(
          `https://api.coingecko.com/api/v3/simple/price?ids=${missing.join(',')}&vs_currencies=usd`,
          { provider: 'coingecko', timeoutMs: 6000, retries: 1 },
        );
        for (const id of missing) {
          const usd = toNum(r?.[id]?.usd);
          if (usd > 0) { out[id] = usd; this.mem.set(`px:${id}`, { v: usd, exp: Date.now() + 30_000 }); }
        }
      } catch {
        try {
          const r2 = await fetchJson<{ coins: Record<string, { price: number }> }>(
            `https://coins.llama.fi/prices/current/${missing.map((i) => `coingecko:${i}`).join(',')}`,
            { provider: 'defillama', timeoutMs: 6000, retries: 0 },
          );
          for (const id of missing) {
            const usd = toNum(r2?.coins?.[`coingecko:${id}`]?.price);
            if (usd > 0) { out[id] = usd; this.mem.set(`px:${id}`, { v: usd, exp: Date.now() + 30_000 }); }
          }
        } catch { /* prices unavailable — callers degrade gracefully */ }
      }
    }
    return out;
  }
}
