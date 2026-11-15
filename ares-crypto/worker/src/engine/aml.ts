// AML engine (spec §9): free dirty-source scoring on public data.
// Sources of dirt (aml_sources table): OFAC SDN (critical), mixer deposits (mixer:*),
// scam DBs (scam-sniffer etc.), admin KB scam labels.
//
// score(i) = base(i) × volumeShare(i) × timeDecay(i)
//   base: direct contact = 100; 1 hop = 70; 2 hops = 45; 3 hops = 20
//   volumeShare: share of incoming volume traceable to this source (0..1)
//   timeDecay: 0.5^(age of contact in years)
// total = 100 × (1 − Π(1 − score(i)/100))
// Verdict bands: 0–20 clean, 21–40 low, 41–60 medium, 61–80 high, 81–100 critical.

import type { Tx, AmlHit, AmlResult } from '../core/types.ts';
import type { AppCtx } from '../core/ctx.ts';
import { LabelEngine } from './labels.ts';

const BASE_BY_HOPS: Record<number, number> = { 0: 100, 1: 70, 2: 45, 3: 20 };

export interface AmlInput {
  chain: string;
  addr: string;
  txs: Tx[];                        // incoming + outgoing history of the target (already labeled partially)
  counterparties2hop?: { via: string; addr: string; ts: number; amountIn?: number }[]; // optional second layer
  now: number;
}

export async function scoreAml(ctx: AppCtx, inp: AmlInput): Promise<AmlResult> {
  const labels = new LabelEngine(ctx);
  const now = inp.now;
  const lower = (a: string) => (a ?? '').toLowerCase();

  const ins = inp.txs.filter((t) => t.direction === 'in');
  const totalIn = ins.reduce((s, t) => s + t.amount, 0) || 1;

  // All counterparties of the target (1 hop)
  const hop1 = new Map<string, { volumeIn: number; firstTs?: number; lastTs?: number }>();
  for (const t of ins) {
    const k = lower(t.from);
    const cur = hop1.get(k) ?? { volumeIn: 0 };
    cur.volumeIn += t.amount;
    cur.firstTs = cur.firstTs === undefined ? t.ts : Math.min(cur.firstTs, t.ts);
    cur.lastTs = cur.lastTs === undefined ? t.ts : Math.max(cur.lastTs, t.ts);
    hop1.set(k, cur);
  }

  const hits: AmlHit[] = [];
  const exchangeExit: { addr: string; label: string }[] = [];

  // 1) direct dirty check on the target itself
  const direct = await ctx.db.getAmlSources(inp.chain, [inp.addr]);
  for (const d of direct) {
    hits.push({
      source: d.source,
      severity: d.severity,
      hops: 0,
      volumeShare: 1,
      score: 100,
      ref: d.ref,
    });
  }

  // 2) 1-hop: dirty counterparties
  const cpAddrs = [...hop1.keys()];
  const dirty = await ctx.db.getAmlSources(inp.chain, cpAddrs);
  const dirtyByAddr = new Map(dirty.map((d) => [lower(d.addr), d]));

  // mixer deposit index: did any counterparty receive from/interact with a mixer contract?
  // (mixers are registered in aml_sources as source 'mixer:...' too)
  const labelsMap = await labels.bestLabels(inp.chain, cpAddrs.slice(0, 40));
  for (const [addr, v] of hop1) {
    const d = dirtyByAddr.get(addr);
    const l = labelsMap.get(addr);
    if (l && (l.category === 'cex' || l.category === 'payment')) {
      exchangeExit.push({ addr, label: `${l.name} (${l.category})` });
    }
    if (!d) continue;
    const share = clamp01(v.volumeIn / totalIn);
    const ageYears = v.firstTs ? (now - v.firstTs) / (365.25 * 86400) : 0.5;
    const decay = 0.5 ** ageYears;
    const score = (BASE_BY_HOPS[1] ?? 20) * share * decay;
    hits.push({
      source: d.source,
      severity: d.severity,
      hops: 1,
      path: [inp.addr, addr],
      volumeShare: share,
      contactTs: v.firstTs,
      score,
      ref: d.ref,
    });
  }

  // 3) 2-hop (optional input from tracer): dirty addr reachable via one counterparty
  for (const c of inp.counterparties2hop ?? []) {
    const d = (await ctx.db.getAmlSources(inp.chain, [c.addr]))[0];
    if (!d) continue;
    const viaVolume = hop1.get(lower(c.via))?.volumeIn ?? 0;
    const share = clamp01(viaVolume / totalIn);
    const ageYears = c.ts ? (now - c.ts) / (365.25 * 86400) : 0.5;
    const decay = 0.5 ** ageYears;
    const score = (BASE_BY_HOPS[2] ?? 10) * share * decay;
    hits.push({
      source: d.source, severity: d.severity, hops: 2,
      path: [inp.addr, c.via, c.addr],
      volumeShare: share, contactTs: c.ts, score, ref: d.ref,
    });
  }

  // combine (spec §9 formula)
  let prod = 1;
  for (const h of hits) prod *= 1 - clamp01(h.score / 100);
  const total = Math.round(100 * (1 - prod));

  const level = total <= 20 ? 'clean' : total <= 40 ? 'low' : total <= 60 ? 'medium' : total <= 80 ? 'high' : 'critical';

  return {
    score: total,
    level,
    hits: hits.sort((a, b) => b.score - a.score),
    exchangeExit,
    disclaimer: 'Эвристическая оценка на публичных данных; не заменяет коммерческий AML. ' +
      'Каждый источник помечен: hops (расстояние), доля объёма, возраст контакта.',
  };
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

// Verdict for quick report (risk verdict combines profile risk + AML)
export function combineVerdict(profileRisk: number, amlScore: number): { score: number; level: 'clean' | 'low' | 'medium' | 'high' | 'critical' } {
  const score = Math.round(Math.max(profileRisk * 0.8, amlScore * 0.9 + profileRisk * 0.2));
  const level = score <= 20 ? 'clean' : score <= 40 ? 'low' : score <= 60 ? 'medium' : score <= 80 ? 'high' : 'critical';
  return { score, level };
}
