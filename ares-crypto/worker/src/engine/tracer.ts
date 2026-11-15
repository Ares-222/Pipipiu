// Tracer (spec §11): budget-aware BFS over counterparties + mixer unmixing.
// On Workers this is orchestrated step-by-step by a Durable Object (fetch budget
// 50/invocation); runTrace() here executes one bounded run and reports truncation.

import type { TraceResult, GraphNode, GraphEdge, Tx, UnmixFinding } from '../core/types.ts';
import { CHAINS } from '../core/types.ts';
import type { AppCtx } from '../core/ctx.ts';
import type { AdapterRegistry } from '../adapters/registry.ts';
import { fetchCount, resetFetchCount } from '../core/http.ts';
import { LabelEngine } from './labels.ts';
import { fmtAmount } from '../core/util.ts';

export interface TraceOpts {
  depth?: number;         // default 2 (1..4)
  width?: number;         // top-K counterparties per node, default 6
  fetchBudget?: number;   // default 30
  onProgress?: (step: number, totalSteps: number, expanded: number, note: string) => void;
  unmix?: boolean;        // default true
}

const MIXER_WINDOW_SEC = 24 * 3600;

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
      const myDeps = rows.filter((r) => r.commitment.startsWith('d:') && r.addr?.toLowerCase() === root.toLowerCase());
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
    const l = got.get(n.addr.toLowerCase());
    if (l) { n.label = l.name; n.category = l.category; n.role = l.category; }
  }

  // unmix (statistical matching, spec §11.4)
  const unmixFindings: UnmixFinding[] = [];
  for (const m of mixerNodes.slice(0, 3)) {
    const u = await unmixMixer(ctx, chain, m.addr, root, visited);
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
      return { addr: toNode?.addr ?? e.to, label: toNode?.label, amount: e.amount, asset: e.asset, share: e.amount / totalOut };
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

async function unmixMixer(ctx: AppCtx, chain: string, mixer: string, rootAddr: string, _visited: Set<string>): Promise<UnmixFinding | null> {
  // Deposits INTO mixer by our graph addresses (from index built by scripts/index-tornado.ts)
  // and withdrawals OUT of mixer in matching windows (same table, kind prefix 'w:').
  const all = await ctx.db.listAmlSources(500);
  void all;
  const deposits = await ctx.db.getMixerDeposits(chain, mixer, 0, Math.floor(Date.now() / 1000));
  // deposits made by graph addresses
  const byAddr = deposits.filter((d) => d.commitment.startsWith('d:') && d.addr && (_visited.has(d.addr) || d.addr === rootAddr));
  if (byAddr.length === 0) return null;

  const withdrawals = deposits.filter((d) => d.commitment.startsWith('w:'));
  const links: UnmixFinding['links'] = [];
  for (const dep of byAddr) {
    // candidate outputs: same nominal, withdrawal after deposit, within window
    const cands = withdrawals.filter((w) =>
      Math.abs(w.amount - dep.amount) < 1e-9 && w.ts >= dep.ts && w.ts - dep.ts <= MIXER_WINDOW_SEC);
    if (cands.length === 0) continue;
    const p = 1 / cands.length; // classic statistical matching: 1/n same-nominal outputs in window
    for (const w of cands.slice(0, 4)) {
      links.push({ from: dep.addr ?? '', to: w.addr ?? '', amount: w.amount, p });
    }
  }
  if (links.length === 0) return null;
  return {
    mixer,
    mixerLabel: 'Миксер',
    deposits: byAddr.map((d) => ({ addr: d.addr ?? '', amount: d.amount, ts: d.ts })),
    outputs: withdrawals.slice(0, 20).map((w) => ({ addr: w.addr ?? '', amount: w.amount, ts: w.ts })),
    links,
    note: `Матчинг депозит→вывод в окне 24 ч по номиналу (${fmtAmount(byAddr[0].amount)}). Вероятность = 1/n совпадающих выводов. Вероятностная эвристика, не доказательство.`,
  };
}

function nodeId(chain: string, addr: string): string {
  return `${chain}:${addr}`;
}

// helper used by report views
export function chainName(chain: string): string {
  return CHAINS[chain as keyof typeof CHAINS]?.name ?? chain.toUpperCase();
}
