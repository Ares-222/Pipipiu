// GoPlus Security address risk — keyless free API (https://docs.gopluslabs.io).
// Source picked up from GitHub research (2026-11-16): Soniavasseur/Wallet-Risk-Scanner
// ("GoPlus Security (keyless)") and 0xBreak/SpiderAml ("live lookup per request").
//
// Sandbox note (2026-11-16): api.gopluslabs.com is unreachable from sandbox egress
// (TLS SNI "unrecognized name"); from Cloudflare Workers egress it is a plain GET.
// Module therefore degrades gracefully: null on any failure, breaker protects limits.
//
// API: GET /api/v1/address_security/{address}?chain_id=1 → { result: { is_...: 0|1 } }
// Free tier: ~30 req/min per IP — covered by KV cache (6h per address) + quota.

import type { AppCtx } from '../core/ctx.ts';
import { fetchJson } from '../core/http.ts';
import { cachedJson, KV_TTL } from '../core/kv.ts';

const API = 'https://api.gopluslabs.com/api/v1/address_security';

const CHAIN_ID: Record<string, number> = { eth: 1, bsc: 56, polygon: 137, op: 10, arb: 42161, base: 8453 };

// Only flags that make sense at ADDRESS level; ru names for the report.
export const GOPLUS_FLAGS: Record<string, string> = {
  is_blacklisted: 'в блэклисте (GoPlus)',
  is_money_laundering: 'связь с отмыванием',
  is_phishing_activities: 'фишинг',
  is_hacking_activities: 'взломы/эксплойты',
  is_darkweb_activities: 'даркнет',
  is_mixing: 'миксеры',
  is_stealing_address: 'кражи средств',
  is_honeypot_related: 'honeypot-связь',
};

export interface GoplusFlag { key: string; ru: string; severity: 'high' | 'critical' }

export interface GoplusResult { flags: GoplusFlag[]; provider: string }

export async function goplusAddressRisk(ctx: AppCtx, chain: string, addr: string): Promise<GoplusResult | null> {
  const cid = CHAIN_ID[chain];
  if (!cid || !/^0x[0-9a-fA-F]{40}$/.test(addr)) return null;
  const a = addr.toLowerCase();
  const key = `gp:${chain}:${a}`;
  // Никогда не бросаем: GoPlus — опциональный источник, отчёт не должен падать
  try {
    const { value } = await cachedJson<GoplusResult | null>(ctx.kv, key, KV_TTL.goplus, async () => {
      const res = await fetchJson<{ code?: number; result?: Record<string, unknown> }>(
        `${API}/${a}?chain_id=${cid}`,
        { provider: 'goplus', breaker: ctx.breaker, timeoutMs: 9000, retries: 1 },
      );
      const raw = res?.result;
      if (!raw) return null;
      const flags: GoplusFlag[] = [];
      for (const [k, ru] of Object.entries(GOPLUS_FLAGS)) {
        if (raw[k] !== undefined && String(raw[k]) !== '0') {
          flags.push({ key: `goplus:${k}`, ru, severity: k === 'is_blacklisted' ? 'critical' : 'high' });
        }
      }
      return { flags, provider: 'gopluslabs keyless' };
    });
    return value;
  } catch (e) {
    void ctx.db.addErrorLog('goplus', String((e as Error)?.message ?? e).slice(0, 300)).catch(() => {});
    return null;
  }
}
