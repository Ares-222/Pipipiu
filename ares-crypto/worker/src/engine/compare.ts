// /compare (№14, v7): пересечение двух кошельков одной сети — общие контрагенты
// и общий источник финансирования. История каждого адреса берётся из уже
// закэшированных страниц tx (тот же ключ KV, что у отчёта) — максимум 2 fetch
// на вызов, обычно 0 при повторных проверках.

import type { AppCtx } from '../core/ctx.ts';
import type { AdapterRegistry } from '../adapters/registry.ts';
import type { Tx } from '../core/types.ts';
import { normAddr } from '../core/types.ts';
import { cachedJson, KV_TTL } from '../core/kv.ts';
import { LabelEngine } from './labels.ts';
import { shortAddr } from './insights.ts';

export interface CommonCp {
  addr: string;
  label?: string;
  dirA: 'in' | 'out' | 'both';
  dirB: 'in' | 'out' | 'both';
  volA: number;
  volB: number;
  asset: string;
}

export interface CompareResult {
  chain: string;
  a: string;
  b: string;
  common: CommonCp[];        // общие контрагенты (топ по сумме объёмов)
  funders: string[];         // адреса, отправлявшие ОБЕИМ сторонам («общий источник»)
  receivers: string[];       // адреса, получавшие от ОБЕИХ сторон
  scanned: { a: number; b: number };
  note: string;
}

function aggTxs(txs: Tx[], self: string): Map<string, { vol: number; dirIn: boolean; dirOut: boolean; asset: string }> {
  const m = new Map<string, { vol: number; dirIn: boolean; dirOut: boolean; asset: string }>();
  const selfN = normAddr('', self);
  for (const t of txs) {
    if (!t.from || !t.to || t.direction === 'self') continue;
    const other = t.direction === 'in' ? t.from : t.to;
    if (!other || normAddr('', other) === selfN) continue;
    const cur = m.get(other) ?? { vol: 0, dirIn: false, dirOut: false, asset: t.asset };
    cur.vol += t.amount;
    if (t.direction === 'in') cur.dirIn = true; else cur.dirOut = true;
    m.set(other, cur);
  }
  return m;
}

export async function compareAddresses(
  ctx: AppCtx,
  registry: AdapterRegistry,
  chain: string,
  a: string,
  b: string,
): Promise<CompareResult> {
  const adapter = registry.get(chain as never);
  if (!adapter) throw new Error(`сеть ${chain} не поддерживается`);
  const labels = new LabelEngine(ctx);

  const load = async (addr: string) => cachedJson<{ txs: Tx[] }>(
    ctx.kv, `tx:${chain}:${addr}:0`, KV_TTL.txPage,
    async () => ({ txs: (await adapter.transactions(addr as never, { limit: 200 })).txs }),
  );

  const [ra, rb] = await Promise.all([load(a), load(b)]);
  const ma = aggTxs(ra.value.txs, a);
  const mb = aggTxs(rb.value.txs, b);

  // общие контрагенты
  const common: CommonCp[] = [];
  for (const [addr, va] of ma) {
    const vb = mb.get(addr);
    if (!vb) continue;
    common.push({
      addr,
      dirA: va.dirIn && va.dirOut ? 'both' : va.dirIn ? 'in' : 'out',
      dirB: vb.dirIn && vb.dirOut ? 'both' : vb.dirIn ? 'in' : 'out',
      volA: va.vol, volB: vb.vol, asset: va.asset,
    });
  }
  common.sort((x, y) => (y.volA + y.volB) - (x.volA + x.volB));
  const topCommon = common.slice(0, 12);
  const got = await labels.bestLabels(chain, topCommon.map((c) => c.addr)).catch(() => new Map());
  for (const c of topCommon) c.label = got.get(normAddr(chain, c.addr))?.name;

  // общий источник: кто отправлял обеим сторонам (кроме самих a/b и их взаимных переводов)
  const aN = normAddr(chain, a), bN = normAddr(chain, b);
  const funders: string[] = [];
  const receivers: string[] = [];
  for (const [addr, va] of ma) {
    const vb = mb.get(addr);
    if (!vb) continue;
    const n = normAddr(chain, addr);
    if (n === aN || n === bN) continue;
    if (va.dirIn && vb.dirIn) funders.push(addr);       // отправлял и a, и b
    if (va.dirOut && vb.dirOut) receivers.push(addr);   // получал и от a, и от b
  }

  return {
    chain,
    a, b,
    common: topCommon,
    funders: funders.slice(0, 6).map((x) => shortAddr(x)),
    receivers: receivers.slice(0, 6).map((x) => shortAddr(x)),
    scanned: { a: ra.value.txs.length, b: rb.value.txs.length },
    note: `Сравнение по последним ${Math.max(ra.value.txs.length, rb.value.txs.length)} транзакциям каждого адреса (окно выборки, не вся история). Сеть: ${chain.toUpperCase()}.`,
  };
}
