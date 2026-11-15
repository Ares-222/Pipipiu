// Behavioral profile engine (spec §10): KPI cards, named findings with severity,
// wallet-type classification with confidence, transit matching.
// Pure functions over normalized txs — fully testable offline.

import type { Tx, Kpi, Finding, RoleScores, Classification, TransitInfo, TransitPair, Label } from '../core/types.ts';
import { fmtAmount, fmtUsd, fmtInt, fmtPct, median, cv, modeValue, shortAddr } from '../core/util.ts';

export interface ProfileInput {
  addr: string;
  account: { createdAt?: number; txCount?: number };
  txs: Tx[];
  now: number;
  labels?: Map<string, Label>;      // counterparty labels (from LabelEngine)
  priceOf?: (symbol: string) => number | undefined;
}

export interface ProfileResult {
  kpi: Kpi;
  mainAsset: string;
  findings: Finding[];
  classification: Classification;
  transit: TransitInfo;
  riskScore: number;               // 0..100 «признаки риска»
}

const clamp = (v: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, v));

export function buildProfile(inp: ProfileInput): ProfileResult {
  // SPAM guard: scam airdrops push absurd human-unit amounts (measured: 5.8e61 on
  // the USDT contract's recent transfers). Anything above 1e12 units is excluded.
  const SPAM_LIMIT = 1e12;
  const txs = inp.txs.filter((t) => t.direction !== 'self' && t.amount <= SPAM_LIMIT);
  const now = inp.now;

  // main asset = asset with max turnover
  const volByAsset = new Map<string, number>();
  for (const t of txs) volByAsset.set(t.asset, (volByAsset.get(t.asset) ?? 0) + t.amount);
  const mainAsset = [...volByAsset.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'USDT';

  const priceOf = inp.priceOf ?? (() => undefined);
  const usd = (t: Tx): number => {
    const p = priceOf(t.asset);
    return p !== undefined ? t.amount * p : t.amount; // if no price, treat as USD units (stablecoins)
  };

  const ins = txs.filter((t) => t.direction === 'in');
  const outs = txs.filter((t) => t.direction === 'out');
  const mainIns = ins.filter((t) => t.asset === mainAsset);
  const mainOuts = outs.filter((t) => t.asset === mainAsset);

  // ---------- KPI (USD-normalized; per-asset breakdown available in report) ----------
  const receivedUsd = ins.reduce((s, t) => s + usd(t), 0);
  const sentUsd = outs.reduce((s, t) => s + usd(t), 0);
  const receivedCount = ins.length;
  const sentCount = outs.length;
  const cpIn = new Set(ins.map((t) => t.from.toLowerCase())).size;
  const cpOut = new Set(outs.map((t) => t.to.toLowerCase())).size;
  const turnover = receivedUsd + sentUsd;
  const amounts = [...ins, ...outs].map((t) => usd(t)).filter((x) => x > 0);
  const settledPct = receivedUsd > 0 ? Math.max(0, ((receivedUsd - sentUsd) / receivedUsd) * 100) : 0;
  const firstTs = txs.length ? Math.min(...txs.map((t) => t.ts)) : undefined;
  const isContract = (inp.account as { isContract?: boolean }).isContract === true;
  // for contracts the creation ts from free sources is unreliable — don't state age as fact
  const ageDays = isContract
    ? null
    : (inp.account.createdAt !== undefined
      ? Math.max(0, Math.floor((now - inp.account.createdAt) / 86400))
      : (firstTs ? Math.max(0, Math.floor((now - firstTs) / 86400)) : null));
  const activeDays = new Set(txs.map((t) => new Date(t.ts * 1000).toISOString().slice(0, 10))).size;

  const kpi: Kpi = {
    received: receivedUsd,
    receivedCount,
    sent: sentUsd,
    sentCount,
    settledPct,
    counterpartiesIn: cpIn,
    counterpartiesOut: cpOut,
    turnover,
    avgTx: amounts.length ? turnover / amounts.length : 0,
    medianTx: median(amounts),
    maxTx: amounts.length ? Math.max(...amounts) : 0,
    activeDays,
    ageDays,
  };

  // ---------- transit matching (spec §10, greedy by time) ----------
  const transit = matchTransit(mainIns, mainOuts);

  // ---------- findings ----------
  const findings: Finding[] = [];
  const push = (f: Finding) => findings.push(f);

  // fresh_big_turnover
  if (ageDays !== null && ageDays < 30 && turnover > 100_000) {
    push({
      id: 'fresh_big_turnover', severity: 'red', title: 'Свежий адрес с большим оборотом',
      detail: `Адрес создан ${ageDays} дн. назад, оборот уже ${fmtUsd(turnover)}`,
      graphRef: true,
    });
  }

  // fan_out / fan_in
  const ratioOut = cpIn > 0 ? cpOut / cpIn : (cpOut > 20 ? 99 : 0);
  const ratioIn = cpOut > 0 ? cpIn / cpOut : (cpIn > 20 ? 99 : 0);
  if (ratioOut >= 10 && cpOut >= 20) {
    const top = topCounterparties(outs, 'to', 8, inp.labels);
    push({
      id: 'fan_out', severity: 'yellow', title: 'Веерная рассылка (fan-out)',
      detail: `${fmtInt(cpOut)} получателей против ${fmtInt(cpIn)} отправителей — массовая раздача`,
      addresses: top, graphRef: true,
    });
  }
  if (ratioIn >= 10 && cpIn >= 20) {
    const top = topCounterparties(ins, 'from', 8, inp.labels);
    push({
      id: 'fan_in', severity: 'yellow', title: 'Веерный сбор (fan-in)',
      detail: `${fmtInt(cpIn)} отправителей против ${fmtInt(cpOut)} получателей — массовый сбор`,
      addresses: top, graphRef: true,
    });
  }

  // zero_residue
  if (settledPct < 2 && turnover > 10_000) {
    push({
      id: 'zero_residue', severity: 'yellow', title: 'Нулевой остаток при обороте',
      detail: `Оборот ${fmtUsd(turnover)}, но на адресе не оседает ничего (${fmtPct(settledPct)}) — кошелёк не для хранения`,
    });
  }

  // machine_rhythm — reference quality bar: flag regular bursts (modal interval ≈ 0)
  // even when CV is inflated by a few large gaps (etalon example: CV=3.93 + modal 0 min).
  const sorted = [...txs].sort((a, b) => a.ts - b.ts);
  const intervals: number[] = [];
  for (let i = 1; i < sorted.length; i++) intervals.push(sorted[i].ts - sorted[i - 1].ts);
  if (intervals.length >= 10) {
    const cvv = cv(intervals);
    const modal = modeValue(intervals, 60000);
    const share120 = intervals.filter((x) => x <= 120).length / intervals.length;
    if ((cvv < 0.35 && modal < 5 * 60) || (modal <= 60 && share120 > 0.5)) {
      push({
        id: 'machine_rhythm', severity: 'yellow', title: 'Машинный ритм операций',
        detail: `Интервалы слишком регулярны (CV=${cvv.toFixed(2)}, модальный интервал ${Math.round(modal / 60)} мин, ${fmtPct(share120 * 100)} операций в пачках ≤2 мин) — работает скрипт`,
      });
    }
  }

  // exchange_exit
  const cexPartners: { addr: string; label: string; amounts: string }[] = [];
  if (inp.labels) {
    for (const t of txs) {
      const other = t.direction === 'in' ? t.from : t.to;
      const l = inp.labels.get(other.toLowerCase());
      if (l && (l.category === 'cex' || l.category === 'payment')) {
        const key = other.toLowerCase();
        if (!cexPartners.find((x) => x.addr === key)) {
          cexPartners.push({ addr: key, label: `${l.name} (${l.category})`, amounts: `${t.direction === 'in' ? '↑' : '↓'}${fmtAmount(t.amount)} ${t.asset}` });
        }
      }
    }
  }
  if (cexPartners.length > 0) {
    push({
      id: 'exchange_exit', severity: 'blue', title: 'Прямой выход на биржи',
      detail: `${cexPartners.length} биржевых/платёжных контрагентов — точка деанонимизации через KYC`,
      addresses: cexPartners.slice(0, 4), graphRef: true,
    });
  }

  // peel_chain: big in → almost all out (minus residue), repeatedly
  let peelHits = 0;
  for (const o of mainOuts) {
    const prior = mainIns.find((i) => i.ts <= o.ts && o.ts - i.ts <= 86400 && o.amount >= i.amount * 0.9 && o.amount <= i.amount * 1.02 && i.amount >= 1000);
    if (prior) peelHits++;
  }
  if (peelHits >= 3) {
    push({
      id: 'peel_chain', severity: 'yellow', title: 'Peel-подобная схема',
      detail: `${peelHits} циклов «пришло крупное → ушло почти всё в течение суток» — классический peel-паттерн`,
      graphRef: true,
    });
  }

  // rapid_transit
  if (transit.pct > 50 && transit.under60Pct > 50) {
    push({
      id: 'rapid_transit', severity: 'yellow', title: 'Быстрый транзит',
      detail: `${fmtPct(transit.under60Pct)} сопоставленных входов уходят дальше в течение часа`,
    });
  }

  // round_amounts (ручные/продажные переводы)
  const outAmts = mainOuts.map((t) => t.amount).filter((a) => a >= 100);
  if (outAmts.length >= 10) {
    const roundShare = outAmts.filter((a) => a % 500 === 0 || a % 1000 === 0).length / outAmts.length;
    if (roundShare > 0.6) {
      push({
        id: 'round_amounts', severity: 'gray', title: 'Круглые суммы',
        detail: `${fmtPct(roundShare * 100)} исходящих — круглые суммы (кратны 500/1000 ${mainAsset}) — ручные или продажные переводы`,
      });
    }
  }

  // dust_attack
  const dustSenders = new Set(ins.filter((t) => usd(t) < 2 && t.asset === mainAsset).map((t) => t.from.toLowerCase()));
  if (dustSenders.size >= 10) {
    push({
      id: 'dust_attack', severity: 'yellow', title: 'Dust-атака',
      detail: `${dustSenders.size} адресов присылали суммы <$2 — проверь их на скам-метки`,
    });
  }

  // ---------- classification ----------
  const scores = computeScores({ kpi, ratioOut, ratioIn, intervals: intervals.length, transit, labels: inp.labels, txs, addr: inp.addr, cexCount: cexPartners.length });
  const classification = classify(scores);

  // ---------- risk score ----------
  let risk = 0;
  for (const f of findings) {
    risk += f.severity === 'red' ? 22 : f.severity === 'yellow' ? 12 : f.severity === 'blue' ? 6 : 3;
  }
  risk = clamp(risk);

  return { kpi, mainAsset, findings, classification, transit, riskScore: risk };
}

// ---------- helpers ----------

function topCounterparties(txs: Tx[], side: 'from' | 'to', n: number, labels?: Map<string, Label>): Finding['addresses'] {
  const agg = new Map<string, { amount: number; count: number; asset: string }>();
  for (const t of txs) {
    const key = (side === 'from' ? t.from : t.to) ?? '';
    if (!key) continue;
    const cur = agg.get(key.toLowerCase()) ?? { amount: 0, count: 0, asset: t.asset };
    cur.amount += t.amount;
    cur.count += 1;
    agg.set(key.toLowerCase(), cur);
  }
  return [...agg.entries()]
    .sort((a, b) => b[1].amount - a[1].amount)
    .slice(0, n)
    .map(([addr, v]) => {
      const l = labels?.get(addr);
      return { addr: shortAddr(addr, 10, 6), label: l?.name, amounts: `${v.asset} ${fmtAmount(v.amount)} ×${v.count}` };
    });
}

export function matchTransit(ins: Tx[], outs: Tx[], windowSec = 7 * 86400, tolerance = 0.05): TransitInfo {
  const usedOut = new Set<number>();
  const pairs: TransitPair[] = [];
  const sortedIn = [...ins].sort((a, b) => a.ts - b.ts);
  const sortedOut = [...outs].sort((a, b) => a.ts - b.ts); // ascending
  for (const i of sortedIn) {
    // find the earliest unmatched out after i.ts with similar amount (greedy, closest by time)
    let best = -1, bestDelay = Infinity;
    for (let j = 0; j < sortedOut.length; j++) {
      if (usedOut.has(j)) continue;
      const o = sortedOut[j];
      if (o.ts < i.ts) continue;
      if (o.ts - i.ts > windowSec) break;
      if (o.amount < i.amount * (1 - tolerance) || o.amount > i.amount * (1 + tolerance)) continue;
      const delay = o.ts - i.ts;
      if (delay < bestDelay) { bestDelay = delay; best = j; }
    }
    if (best >= 0) {
      usedOut.add(best);
      const o = sortedOut[best];
      pairs.push({ delayMin: Math.round((o.ts - i.ts) / 60), inAmount: i.amount, outAmount: o.amount, to: o.to });
    }
  }
  const matched = pairs.length;
  const ofIn = ins.length;
  const delays = pairs.map((p) => p.delayMin).sort((a, b) => a - b);
  const medianHold = delays.length ? median(delays) : null;
  const under60 = delays.filter((d) => d <= 60).length;
  const top = [...pairs].sort((a, b) => a.delayMin - b.delayMin).slice(0, 8);
  return {
    matched,
    ofIn,
    pct: ofIn > 0 ? (matched / ofIn) * 100 : 0,
    medianHoldMin: medianHold,
    under60Pct: matched > 0 ? (under60 / matched) * 100 : 0,
    top,
  };
}

function computeScores(a: {
  kpi: Kpi; ratioOut: number; ratioIn: number; intervals: number;
  transit: TransitInfo; labels?: Map<string, Label>; txs: Tx[]; addr: string; cexCount: number;
}): RoleScores {
  const { kpi, ratioOut, ratioIn, transit, labels } = a;
  const fanout = clamp(Math.min(100, Math.log10(Math.max(1, ratioOut)) * 45 + (kpi.settledPct < 2 ? 15 : 0)));
  const fanin = clamp(Math.min(100, Math.log10(Math.max(1, ratioIn)) * 45 + (kpi.settledPct > 80 ? 15 : 0)));
  const cexService = labels?.get(a.addr.toLowerCase()) && ['cex', 'payment', 'service'].includes(labels.get(a.addr.toLowerCase())!.category)
    ? 85
    : clamp(20 + a.cexCount * 10);
  const transitScore = clamp(transit.pct * 0.8 + transit.under60Pct * 0.2);
  const personal = clamp(
    (kpi.receivedCount + kpi.sentCount < 60 ? 45 : 10)
    + (kpi.counterpartiesIn + kpi.counterpartiesOut < 15 ? 30 : 5)
    + (a.intervals < 20 ? 20 : 5),
  );
  const auto = a.intervals >= 10 ? clamp(35 + (transit.pct > 40 ? 20 : 0)) : 10;
  return { fanout, fanin, auto, cexService, transit: transitScore, personal };
}

function classify(scores: RoleScores): Classification {
  const roles: { key: keyof RoleScores; title: string; hint: string }[] = [
    { key: 'fanout', title: 'Раздающий кошелёк (выплаты/дропы)', hint: 'раздача' },
    { key: 'fanin', title: 'Собирающий кошелёк (приём платежей)', hint: 'сбор' },
    { key: 'auto', title: 'Автоматический кошелёк (скрипт/бот)', hint: 'автомат' },
    { key: 'cexService', title: 'Биржа / платёжный сервис', hint: 'биржа/сервис' },
    { key: 'transit', title: 'Транзитный кошелёк (переводит дальше)', hint: 'транзит' },
    { key: 'personal', title: 'Личный кошелёк', hint: 'личный' },
  ];
  const entries = roles.map((r) => ({ ...r, v: scores[r.key] })).sort((x, y) => y.v - x.v);
  const top = entries[0];
  const second = entries[1];
  const title = top.v >= 40 ? top.title : 'Смешанный профиль (однозначной роли не видно)';
  const confidence: 'high' | 'mid' | 'low' =
    top.v >= 60 && second.v <= top.v - 15 ? 'high' : top.v >= 40 ? 'mid' : 'low';
  return {
    title,
    confidence,
    scores: {
      fanout: Math.round(scores.fanout),
      fanin: Math.round(scores.fanin),
      auto: Math.round(scores.auto),
      cexService: Math.round(scores.cexService),
      transit: Math.round(scores.transit),
      personal: Math.round(scores.personal),
    },
  };
}
