// Tracer (spec §11): budget-aware BFS over counterparties + mixer unmixing.
// On Workers this is orchestrated step-by-step by a Durable Object (fetch budget
// 50/invocation); runTrace() here executes one bounded run and reports truncation.

import type { TraceResult, GraphNode, GraphEdge, Tx, UnmixFinding } from '../core/types.ts';
import { CHAINS, normAddr } from '../core/types.ts';
import type { AppCtx } from '../core/ctx.ts';
import type { AdapterRegistry } from '../adapters/registry.ts';
import { fetchCount, resetFetchCount } from '../core/http.ts';
import { LabelEngine } from './labels.ts';
import { buildUnmix } from './unmix.ts';

export interface TraceOpts {
  depth?: number;         // default 2 (1..4)
  width?: number;         // top-K counterparties per node, default 6
  fetchBudget?: number;   // default 30
  onProgress?: (step: number, totalSteps: number, expanded: number, note: string) => void;
  unmix?: boolean;        // default true
}

export async function runTrace(
  ctx: AppCtx,
  registry: AdapterRegistry,
  chain: string,
  root: string,
  opts: TraceOpts = {},
): Promise<TraceResult> {
  const depth = Math.min(Math.max(1, opts.depth ?? ctx.cfg.traceDefaultDepth), ctx.cfg.traceMaxDepth);
  const width = Math.min(opts.width ?? 6, 10);
  const budget = opts.fetchBudget ?? 30;
  resetFetchCount();

  const nodes = new Map<string, GraphNode>();
  const edges = new Map<string, GraphEdge>();
  const visited = new Set<string>();
  let frontier: { addr: string; d: number }[] = [{ addr: root, d: 0 }];
  const labelsEngine = new LabelEngine(ctx);
  const priceSymbols = new Set<string>();
  const windowCps = new Map<string, number>(); // разных контрагентов в окне tx (fan-out сигнал для эвристики)

  const rootLabel = await labelsEngine.bestLabel(chain, root).catch(() => null);
  nodes.set(nodeId(chain, root), { id: nodeId(chain, root), chain, addr: root, label: rootLabel?.name, category: rootLabel?.category, volume: 0, in: 0, out: 0, txCount: 0, isRoot: true, role: rootLabel?.category });

  let step = 0;
  const totalSteps = depth;
  const mixerNodes: { addr: string; via: string }[] = [];

  while (frontier.length && step < totalSteps) {
    step++;
    const next: { addr: string; d: number }[] = [];
    const note = `глубина ${step}: разворачиваю ${frontier.length} кошельк(ов)`;
    opts.onProgress?.(step, totalSteps, nodes.size, note);

    for (const f of frontier) {
      if (visited.has(f.addr)) continue;
      if (fetchCount() >= budget) break;
      visited.add(f.addr);
      let txs: Tx[] = [];
      try {
        const page = await registry.transactions(chain as never, f.addr, { limit: 50 });
        txs = page.txs;
      } catch {
        continue;
      }
      // aggregate counterparties
      const agg = new Map<string, { vol: number; cnt: number; first: number; last: number; asset: string; dir: 'in' | 'out' }>();
      for (const t of txs) {
        if (t.direction === 'self') continue;
        const other = t.direction === 'in' ? t.from : t.to;
        if (!other) continue;
        priceSymbols.add(t.asset);
        const cur = agg.get(other) ?? { vol: 0, cnt: 0, first: t.ts, last: t.ts, asset: t.asset, dir: t.direction };
        cur.vol += t.amount;
        cur.cnt += 1;
        cur.first = Math.min(cur.first, t.ts);
        cur.last = Math.max(cur.last, t.ts);
        agg.set(other, cur);
      }
      const top = [...agg.entries()].sort((a, b) => b[1].vol - a[1].vol).slice(0, width);
      windowCps.set(f.addr, agg.size);

      for (const [other, v] of top) {
        const fromAddr = v.dir === 'in' ? other : f.addr;
        const toAddr = v.dir === 'in' ? f.addr : other;
        const id = nodeId(chain, other);
        const n = nodes.get(id) ?? { id, chain, addr: other, volume: 0, in: 0, out: 0, txCount: 0 };
        if (v.dir === 'in') { n.in += v.vol; n.volume += v.vol; } else { n.out += v.vol; n.volume += v.vol; }
        n.txCount += v.cnt;
        nodes.set(id, n);

        const eKey = `${nodeId(chain, fromAddr)}->${nodeId(chain, toAddr)}`;
        const e = edges.get(eKey) ?? { from: nodeId(chain, fromAddr), to: nodeId(chain, toAddr), amount: 0, asset: v.asset, txCount: 0, firstTs: v.first, lastTs: v.last };
        e.amount += v.vol;
        e.txCount += v.cnt;
        e.firstTs = Math.min(e.firstTs, v.first);
        e.lastTs = Math.max(e.lastTs, v.last);
        edges.set(eKey, e);

        if (f.d + 1 < depth) next.push({ addr: other, d: f.d + 1 });
      }

      // mixer detection: is this node a registered mixer?
      const dirty = await ctx.db.getAmlSources(chain, [f.addr]);
      if (opts.unmix !== false && dirty.some((d) => d.source.startsWith('mixer:'))) {
        mixerNodes.push({ addr: f.addr, via: f.addr });
      }
    }
    frontier = next.filter((n) => !visited.has(n.addr));
    if (fetchCount() >= budget) break;
  }

  // Mixer touch via deposit index (works even if the deposit is outside the recent
  // tx window): registered mixers where the ROOT itself has indexed deposits.
  const rootId = nodeId(chain, root);
  if (opts.unmix !== false) {
    const nowSec = Math.floor(Date.now() / 1000);
    const amlRows = await ctx.db.listAmlSources(500);
    for (const a of amlRows.filter((x) => x.source.startsWith('mixer:') && (x.chain === chain || x.chain === '*'))) {
      const rows = await ctx.db.getMixerDeposits(chain, a.addr, 0, nowSec);
      const myDeps = rows.filter((r) => r.commitment.startsWith('d:') && normAddr(chain, r.addr ?? '') === normAddr(chain, root));
      if (myDeps.length === 0) continue;
      const id = nodeId(chain, a.addr);
      const n = nodes.get(id) ?? { id, chain, addr: a.addr, volume: 0, in: 0, out: 0, txCount: 0 };
      n.category = 'mixer';
      n.label = `Миксер (индекс депозитов)`;
      n.volume += myDeps.reduce((s, d) => s + d.amount, 0);
      n.txCount += myDeps.length;
      nodes.set(id, n);
      const eKey = `${rootId}->${id}`;
      const e = edges.get(eKey) ?? { from: rootId, to: id, amount: 0, asset: chain === 'eth' ? 'ETH' : 'COIN', txCount: 0, firstTs: myDeps[0].ts, lastTs: myDeps[myDeps.length - 1].ts };
      e.amount += myDeps.reduce((s, d) => s + d.amount, 0);
      e.txCount += myDeps.length;
      edges.set(eKey, e);
      mixerNodes.push({ addr: a.addr, via: a.addr });
    }
  }

  // labels for discovered nodes (batched, DB-only cost)
  const cps = [...nodes.values()].map((n) => n.addr).slice(0, 40);
  const got = await labelsEngine.bestLabels(chain, cps).catch(() => new Map());
  for (const n of nodes.values()) {
    const l = got.get(normAddr(chain, n.addr));
    if (l) { n.label = l.name; n.category = l.category; n.role = l.category; }
  }

  // Структурная эвристика для узлов БЕЗ метки (честно: вероятностная оценка,
  // не факт — UI показывает «?» и пунктирную рамку). Общий контрагент
  // нескольких кошельков = вероятный хаб (биржа/сервис) — стандартный
  // fan-in сигнал графового анализа.
  const refIn = new Map<string, Set<string>>();
  for (const e of edges.values()) {
    const fa = e.from.slice(e.from.indexOf(':') + 1);
    const ta = e.to.slice(e.to.indexOf(':') + 1);
    if (fa === ta) continue;
    const s = refIn.get(ta) ?? new Set<string>();
    s.add(fa);
    refIn.set(ta, s);
  }
  for (const n of nodes.values()) {
    if (n.category || n.isRoot) continue;
    const refs = refIn.get(n.addr)?.size ?? 0;
    const win = windowCps.get(n.addr) ?? 0;
    if (refs >= 2 || (win >= 25 && refs >= 1)) {
      n.category = 'service';
      n.role = 'service';
      n.probable = true;
      n.label = 'Биржа/сервис?';
    }
  }

  // unmix (statistical matching, spec §11.4)
  const unmixFindings: UnmixFinding[] = [];
  for (const m of mixerNodes.slice(0, 3)) {
    // Метка узла уже проставлена блоком labels выше — в шапке истории показываем
    // настоящее имя миксера («Tornado.Cash: 1 ETH»), а не generic «Миксер».
    const mLabel = nodes.get(nodeId(chain, m.addr))?.label?.replace(' (индекс депозитов)', '');
    const u = await unmixMixer(ctx, chain, m.addr, root, visited, [...edges.values()].map((e) => ({ from: e.from, to: e.to, amount: e.amount, asset: e.asset })), mLabel);
    if (u) unmixFindings.push(u);
  }

  // leaks: top out-direction flows from root
  const outEdges = [...edges.values()].filter((e) => e.from === rootId);
  const totalOut = outEdges.reduce((s, e) => s + e.amount, 0) || 1;
  const leaks = outEdges
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 10)
    .map((e) => {
      const toNode = nodes.get(e.to);
      return { addr: toNode?.addr ?? e.to, label: toNode?.label, category: toNode?.category, probable: toNode?.probable, amount: e.amount, asset: e.asset, share: e.amount / totalOut };
    });

  const truncated = fetchCount() >= budget;

  return {
    root, chain, depth,
    nodes: [...nodes.values()],
    edges: [...edges.values()],
    leaks,
    findings: [],
    unmix: unmixFindings,
    truncated,
    providersUsed: ['trongrid/tronscan/etherscan/blockstream (по сети)'],
    fetchesUsed: fetchCount(),
  };
}

async function unmixMixer(ctx: AppCtx, chain: string, mixer: string, rootAddr: string, visited: Set<string>, graphEdges: { from: string; to: string; amount: number; asset: string }[], labelHint?: string): Promise<UnmixFinding | null> {
  // v6: скоринг по методологии открытых исследований (arXiv 2510.09433 H1/H2/H3 +
  // SlowMist-сходимость + база 1/n) поверх накопительного D1-индекса крон-коллектора
  // mixindex.ts (раньше индекс наполнялся только ручным scripts/index-tornado.ts).
  const nowSec = Math.floor(Date.now() / 1000);
  const deposits = await ctx.db.getMixerDeposits(chain, mixer, 0, nowSec);
  const withdrawals = deposits.filter((d) => d.commitment.startsWith('w:'));
  const graphAddrs = new Set([...visited, rootAddr].map((a) => normAddr(chain, a)));
  return buildUnmix({
    chain, mixer, mixerLabel: labelHint || 'Миксер', rootAddr, graphAddrs,
    edges: graphEdges, deposits, withdrawals, nowSec,
  });
}

function nodeId(chain: string, addr: string): string {
  return `${chain}:${addr}`;
}

// helper used by report views
export function chainName(chain: string): string {
  return CHAINS[chain as keyof typeof CHAINS]?.name ?? chain.toUpperCase();
}
