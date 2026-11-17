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

import type { Tx, AmlHit, AmlResult, AmlExposure, AmlTopOut, Label } from '../core/types.ts';
import type { AppCtx } from '../core/ctx.ts';
import { LabelEngine } from './labels.ts';
import { checkIssuerFreeze } from './freeze.ts';
import { goplusAddressRisk } from './goplus.ts';
import { normAddr } from '../core/types.ts';

const BASE_BY_HOPS: Record<number, number> = { 0: 100, 1: 70, 2: 45, 3: 20 };
const GOPLUS_EVM = new Set(['eth', 'bsc', 'polygon', 'op', 'arb', 'base']);

export interface AmlInput {
  chain: string;
  addr: string;
  txs: Tx[];                        // incoming + outgoing history of the target (already labeled partially)
  counterparties2hop?: { via: string; addr: string; ts: number; amountIn?: number }[]; // optional second layer
  now: number;
  priceOf?: (sym: string) => number | undefined; // usd price; dust/exposure usd-weighting
}

export async function scoreAml(ctx: AppCtx, inp: AmlInput): Promise<AmlResult> {
  const labels = new LabelEngine(ctx);
  const now = inp.now;
  const kn = (a: string) => normAddr(inp.chain, a);

  const ins = inp.txs.filter((t) => t.direction === 'in');
  const totalIn = ins.reduce((s, t) => s + t.amount, 0) || 1;

  // All counterparties of the target (1 hop)
  const hop1 = new Map<string, { volumeIn: number; firstTs?: number; lastTs?: number }>();
  for (const t of ins) {
    const k = kn(t.from);
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

  // 1b) freeze-листы эмитентов в реальном времени (Tether USDT / Circle USDC):
  //     читаем isBlackListed прямо из контрактов (подход SpiderAml / wallet-checker).
  //     false ≠ «чистый» — это лишь «не заморожен этим эмитентом».
  if (inp.chain === 'tron' || inp.chain === 'eth') {
    const fz = await checkIssuerFreeze(ctx, inp.chain, inp.addr).catch(() => null);
    for (const f of fz ?? []) {
      if (!f.frozen) continue;
      hits.push({
        source: `${f.asset.toLowerCase()}-freeze`,
        severity: 'critical',
        hops: 0,
        volumeShare: 1,
        score: 100,
        ref: `isBlackListed() в контракте ${f.asset} (${f.provider})`,
      });
      await ctx.db.upsertAmlSources([{
        chain: inp.chain, addr: kn(inp.addr),
        source: `${f.asset.toLowerCase()}-freeze`, severity: 'critical',
        ref: `${f.asset} isBlackListed on-chain`, updatedTs: now,
      }]).catch(() => { /* самонакопление не критично */ });
    }
  }

  // 1c) GoPlus Security (EVM, keyless): флаги тоже оседают в aml_sources — база растёт сама
  if (GOPLUS_EVM.has(inp.chain)) {
    const gp = await goplusAddressRisk(ctx, inp.chain, inp.addr).catch(() => null);
    for (const f of gp?.flags ?? []) {
      hits.push({
        source: f.key, severity: f.severity, hops: 0, volumeShare: 1,
        score: f.severity === 'critical' ? 100 : 90,
        ref: `GoPlus Security: ${f.ru}`,
      });
    }
    if (gp?.flags.length) {
      await ctx.db.upsertAmlSources(gp.flags.map((f) => ({
        chain: inp.chain, addr: kn(inp.addr), source: f.key, severity: f.severity,
        ref: `GoPlus: ${f.ru}`, updatedTs: now,
      }))).catch(() => { /* не критично */ });
    }
  }

  // 2) 1-hop: dirty counterparties
  const cpAddrs = [...hop1.keys()];
  const dirty = await ctx.db.getAmlSources(inp.chain, cpAddrs);
  const dirtyByAddr = new Map(dirty.map((d) => [kn(d.addr), d]));

  // mixer deposit index: did any counterparty receive from/interact with a mixer contract?
  // (mixers are registered in aml_sources as source 'mixer:...' too)
  // Labels for BOTH sides: incoming counterparties (exposure) and outgoing (topOut).
  const outs = inp.txs.filter((t) => t.direction === 'out' && t.to && t.to !== inp.addr);
  const outAgg = new Map<string, { assets: Map<string, number>; cnt: number; lastTs: number }>();
  for (const t of outs) {
    const k = kn(t.to);
    const cur = outAgg.get(k) ?? { assets: new Map<string, number>(), cnt: 0, lastTs: 0 };
    cur.assets.set(t.asset, (cur.assets.get(t.asset) ?? 0) + t.amount);
    cur.cnt += 1;
    cur.lastTs = Math.max(cur.lastTs, t.ts);
    outAgg.set(k, cur);
  }
  const labelAddrs = [...new Set([...cpAddrs, ...outAgg.keys()])].slice(0, 80);
  const labelsMap = await labels.bestLabels(inp.chain, labelAddrs);
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

  // 2b) freeze-проверка топ-контрагентов (tron/eth; KV-кэш 6 ч + limit 8 = дёшево).
  //     Замороженный контрагент — тот же сигнал, что dirty-источник на 1 хопе.
  if (inp.chain === 'tron' || inp.chain === 'eth') {
    const cpTop = [...hop1.entries()].sort((a, b) => b[1].volumeIn - a[1].volumeIn).slice(0, 8);
    for (const [addr2, v] of cpTop) {
      const fz = await checkIssuerFreeze(ctx, inp.chain, addr2).catch(() => null);
      const frozenAsset = (fz ?? []).find((f) => f.frozen);
      if (!frozenAsset) continue;
      const share = clamp01(v.volumeIn / totalIn);
      const ageYears = v.firstTs ? (now - v.firstTs) / (365.25 * 86400) : 0.5;
      const score = (BASE_BY_HOPS[1] ?? 70) * share * 0.5 ** ageYears;
      hits.push({
        source: `${frozenAsset.asset.toLowerCase()}-freeze`,
        severity: 'critical',
        hops: 1,
        path: [inp.addr, addr2],
        volumeShare: share,
        contactTs: v.firstTs,
        score,
        ref: `Контрагент заморожен в ${frozenAsset.asset} (${frozenAsset.provider})`,
      });
      await ctx.db.upsertAmlSources([{
        chain: inp.chain, addr: addr2,
        source: `${frozenAsset.asset.toLowerCase()}-freeze`, severity: 'critical',
        ref: `${frozenAsset.asset} isBlackListed on-chain`, updatedTs: now,
      }]).catch(() => { /* не критично */ });
    }
  }

  // 3) 2-hop (optional input from tracer): dirty addr reachable via one counterparty
  for (const c of inp.counterparties2hop ?? []) {
    const d = (await ctx.db.getAmlSources(inp.chain, [c.addr]))[0];
    if (!d) continue;
    const viaVolume = hop1.get(kn(c.via))?.volumeIn ?? 0;
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

  // --- exposure: происхождение входящих средств по типам источников (Quppy-формат) ---
  const exposure = buildExposure(ins, labelsMap, dirtyByAddr, inp);

  // --- topOut: куда ушло (крупнейшие исходящие направления, с типом получателя) ---
  const topOut = buildTopOut(outAgg, labelsMap, inp);

  return {
    score: total,
    level,
    hits: hits.sort((a, b) => b.score - a.score),
    exchangeExit,
    exposure,
    topOut,
    disclaimer: 'Эвристическая оценка на публичных данных; не заменяет коммерческий AML. ' +
      'Каждый источник помечен: hops (расстояние), доля объёма, возраст контакта. ' +
      'Exposure — вероятностное разнесение входящего объёма по публичным меткам контрагентов.',
  };
}

// ---------- exposure (происхождение средств) ----------

const EXPOSURE_DEFS: { key: string; ru: string; tone: AmlExposure['tone'] }[] = [
  { key: 'cex', ru: 'Биржи', tone: 'blue' },
  { key: 'dust', ru: 'Пыль (dust)', tone: 'dim' },
  { key: 'cex_risk', ru: 'Биржи повыш. риска', tone: 'warn' },
  { key: 'enforcement', ru: 'Принудит. изъятия', tone: 'bad' },
  { key: 'service', ru: 'Неименов. сервисы', tone: 'warn' },
  { key: 'custodial', ru: 'Кастодиальные кошельки', tone: 'blue' },
  { key: 'sanctioned', ru: 'Санкции', tone: 'bad' },
  { key: 'bridge', ru: 'Мосты', tone: 'blue' },
  { key: 'gambling', ru: 'Гемблинг', tone: 'warn' },
  { key: 'payment', ru: 'Платёж. сервисы', tone: 'warn' },
  { key: 'other', ru: 'Прочее', tone: 'dim' },
  { key: 'dex', ru: 'DEX', tone: 'blue' },
  { key: 'contract', ru: 'Смарт-контракты', tone: 'dim' },
  { key: 'terror', ru: 'Террофинансирование', tone: 'bad' },
  { key: 'lending', ru: 'Лендинг', tone: 'blue' },
  { key: 'jurisdiction', ru: 'Риск-юрисдикции', tone: 'warn' },
  { key: 'mixer', ru: 'Миксеры', tone: 'bad' },
  { key: 'scam', ru: 'Скамы/фишинг', tone: 'bad' },
  { key: 'personal', ru: 'Личные/неименованные', tone: 'dim' },
];

const DUST_USD = 10; // входы дешевле $10 считаем пылью (шум для скоринга)

function dirtyBucket(source: string): string {
  const s = source.toLowerCase();
  if (s.startsWith('mixer')) return 'mixer';
  if (/ofac|sanction/.test(s)) return 'sanctioned';
  if (/freeze|blacklist/.test(s)) return 'enforcement'; // USDT/USDC freeze + GoPlus is_blacklisted
  if (/goplus/.test(s)) return /mix/.test(s) ? 'mixer' : 'scam';
  if (/hack|theft|exploit|seiz/.test(s)) return 'enforcement';
  if (/scam|phish|sniff|fraud/.test(s)) return 'scam';
  if (/gambl|casino/.test(s)) return 'gambling';
  if (/terror/.test(s)) return 'terror';
  if (/lend/.test(s)) return 'lending';
  return 'other';
}

function classifyIn(
  label: Label | undefined,
  dirty: { source: string } | undefined,
  usd: number | undefined,
): string {
  if (dirty) return dirtyBucket(dirty.source);
  if (!label?.category) return usd !== undefined && usd < DUST_USD ? 'dust' : 'personal';
  const name = (label.name ?? '').toLowerCase();
  const cat = label.category;
  if (cat === 'cex') {
    if (/hot|депозит|кастод|custod/.test(name)) return 'custodial';
    if (/без\s?-?kyc|no\s?-?kyc|высок|high\s?-?risk|p2p|обменн/.test(name)) return 'cex_risk';
    return 'cex';
  }
  if (cat === 'payment') return 'payment';
  if (cat === 'mixer') return 'mixer';
  if (cat === 'bridge') return 'bridge';
  if (cat === 'scam') return 'scam';
  if (cat === 'sanctioned') return 'sanctioned';
  if (cat === 'service') return /dex|uniswap|pancake|dedust|ston\.fi|jupiter|raydium|swap/.test(name) ? 'dex' : 'service';
  if (cat === 'contract') return 'contract';
  if (cat === 'token') return 'other';
  if (cat === 'personal') return 'personal';
  return 'other';
}

function buildExposure(
  ins: Tx[],
  labelsMap: Map<string, Label>,
  dirtyByAddr: Map<string, { source: string }>,
  inp: AmlInput,
): AmlExposure[] {
  const kn = (a: string) => normAddr(inp.chain, a);
  const priced = ins.some((t) => inp.priceOf?.(t.asset) !== undefined);
  const buckets = new Map<string, number>();
  let total = 0;
  for (const t of ins) {
    if (!t.from || t.from === inp.addr) continue;
    const pricedHere = inp.priceOf?.(t.asset) !== undefined;
    if (priced && !pricedHere) continue; // смесь ценных и без-ценовых активов: считаем только оценённые
    const val = pricedHere ? t.amount * (inp.priceOf?.(t.asset) as number) : t.amount;
    const usd = pricedHere ? val : undefined;
    let key = classifyIn(labelsMap.get(kn(t.from)), dirtyByAddr.get(kn(t.from)), usd);
    if (key === 'dust' && !priced) key = 'personal';
    buckets.set(key, (buckets.get(key) ?? 0) + val);
    total += val;
  }
  if (total <= 0) return [];
  const out: AmlExposure[] = [];
  for (const def of EXPOSURE_DEFS) {
    const v = buckets.get(def.key);
    if (v === undefined) continue;
    const pct = Math.round((v / total) * 100000) / 1000; // 3 знака: пыль тоже видна
    if (pct > 0) out.push({ key: def.key, ru: def.ru, pct, tone: def.tone });
  }
  return out.sort((a, b) => b.pct - a.pct);
}

// ---------- topOut (куда ушло) ----------

function buildTopOut(
  outAgg: Map<string, { assets: Map<string, number>; cnt: number; lastTs: number }>,
  labelsMap: Map<string, Label>,
  inp: AmlInput,
): AmlTopOut[] {
  if (outAgg.size === 0) return [];
  const rows: { addr: string; label?: string; category?: string; amount: number; asset: string; usd?: number }[] = [];
  for (const [addr, v] of outAgg) {
    const l = labelsMap.get(addr);
    // активы адреса не смешиваем в единицах: считаем USD по каждому, доминирующий показываем
    let usdTotal = 0;
    let anyPriced = false;
    let domAsset = '';
    let domVal = -1;
    for (const [asset, amount] of v.assets) {
      const p = inp.priceOf?.(asset);
      const val = p === undefined ? amount : amount * p;
      if (p !== undefined) { usdTotal += amount * p; anyPriced = true; }
      if (val > domVal) { domVal = val; domAsset = asset; }
    }
    rows.push({
      addr,
      label: l?.name,
      category: l?.category,
      amount: v.assets.get(domAsset) ?? 0,
      asset: domAsset,
      usd: anyPriced ? usdTotal : undefined,
    });
  }
  const valOf = (r: { amount: number; usd?: number }) => r.usd ?? r.amount;
  const total = rows.reduce((s, r) => s + valOf(r), 0) || 1;
  return rows
    .sort((a, b) => valOf(b) - valOf(a))
    .slice(0, 6)
    .map((r) => ({
      addr: r.addr,
      label: r.label,
      category: r.category,
      amount: r.amount,
      asset: r.asset,
      usd: r.usd,
      share: Math.round((valOf(r) / total) * 1000) / 1000,
    }));
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
