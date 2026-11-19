// tonsearch (№4, v7): поиск входящих/исходящих переводов TON по memo-комментарию,
// сумме и окну времени — сценарий «найди мой перевод». История берётся из уже
// закэшированной страницы tx (тот же ключ, что у отчёта) — максимум 1 fetch.

import type { AppCtx } from '../core/ctx.ts';
import type { AdapterRegistry } from '../adapters/registry.ts';
import type { Tx } from '../core/types.ts';
import { cachedJson, KV_TTL } from '../core/kv.ts';

export interface TonSearchMatch {
  hash: string;
  ts: number;
  from: string;
  to: string;
  amount: number;
  asset: string;
  direction: 'in' | 'out' | 'self';
  memo?: string;
  reason: string;           // почему совпало
}

export interface TonSearchResult {
  addr: string;
  matches: TonSearchMatch[];
  scanned: number;
  windowDays: number;
  partial: boolean;
  note: string;
}

export interface TonSearchOpts {
  memo?: string;
  amount?: number;          // целевая сумма (±5% или точная для стейблов)
  days?: number;            // окно, default 30
  limit?: number;           // максимум совпадений в ответе
}

export async function searchTonTransfers(
  ctx: AppCtx,
  registry: AdapterRegistry,
  addr: string,
  opts: TonSearchOpts,
): Promise<TonSearchResult> {
  const adapter = registry.get('ton');
  if (!adapter) throw new Error('TON-адаптер недоступен');
  const days = Math.min(Math.max(1, opts.days ?? 30), 120);
  const since = ctx.now() - days * 86400;

  const page = await cachedJson<{ txs: Tx[]; partial: boolean }>(
    ctx.kv, `tx:ton:${addr}:0`, KV_TTL.txPage,
    async () => {
      const p = await adapter.transactions(addr, { limit: 200 });
      return { txs: p.txs, partial: !!p.partial };
    },
  );
  const txs = page.value.txs.filter((t) => t.ts >= since);
  const memoNeedle = (opts.memo ?? '').trim().toLowerCase();
  const amount = opts.amount;

  const matches: TonSearchMatch[] = [];
  for (const t of txs) {
    const reasons: string[] = [];
    if (memoNeedle && (t.memo ?? '').toLowerCase().includes(memoNeedle)) reasons.push(`memo «${(t.memo ?? '').slice(0, 40)}»`);
    if (amount !== undefined && amount > 0) {
      const ok = Math.abs(t.amount - amount) <= amount * 0.05;
      if (ok) reasons.push(`сумма ${t.amount} ${t.asset}`);
    }
    if (reasons.length) {
      matches.push({ hash: t.hash, ts: t.ts, from: t.from, to: t.to, amount: t.amount, asset: t.asset, direction: t.direction as 'in' | 'out' | 'self', memo: t.memo, reason: reasons.join(' · ') });
    }
  }
  matches.sort((a, b) => b.ts - a.ts);

  const what = [memoNeedle ? `memo «${opts.memo}»` : '', amount ? `сумма ~${amount}` : '', `${days} дн.`].filter(Boolean).join(' · ');
  return {
    addr,
    matches: matches.slice(0, opts.limit ?? 15),
    scanned: txs.length,
    windowDays: days,
    partial: page.value.partial,
    note: `Поиск: ${what}. Просмотрено ${txs.length} переводов за ${days} дн.${page.value.partial ? ' · история частичная (free-источник отдал не все события)' : ''}.`,
  };
}
