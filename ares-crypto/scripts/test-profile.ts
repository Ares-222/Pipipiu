// M2 smoke test: profile engine (KPI, findings, transit, classification).
// A) synthetic fan-out dataset — findings must be formulated with concrete numbers.
// B) real TRON hot wallet discovered via Tronscan official tags API (vector §21).

import { makeSandbox, line } from './sandbox.ts';
import { buildProfile } from '../worker/src/engine/profile.ts';
import { AdapterRegistry } from '../worker/src/adapters/registry.ts';
import type { Tx, Label } from '../worker/src/core/types.ts';
import { fetchJson } from '../worker/src/core/http.ts';

const { ctx } = makeSandbox();

function mkTx(p: Partial<Tx> & { direction: Tx['direction']; amount: number; ts: number; other: string }, addr: string): Tx {
  return {
    hash: `hash-${Math.random().toString(36).slice(2, 10)}`,
    chain: 'tron',
    ts: p.ts,
    from: p.direction === 'in' ? p.other : addr,
    to: p.direction === 'out' ? p.other : addr,
    amount: p.amount,
    asset: p.asset ?? 'USDT',
    fee: 0,
    direction: p.direction,
    kind: 'token',
    contract: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
  };
}

async function partA() {
  line('A) SYNTHETIC fan-out wallet (drop-distribution pattern)');
  const addr = 'TFakeTargetAddressForTestOnlyXxxxxxxY';
  const now = Math.floor(Date.now() / 1000);
  const createdAt = now - 9 * 86400; // fresh address, 9 days
  const txs: Tx[] = [];
  // 2 funders send 640k and 640k
  txs.push(mkTx({ direction: 'in', amount: 640000, ts: now - 8 * 86400, other: 'TFunder1xxxxxxxxxxxxxxxxxxxxxxxxxxx' }, addr));
  txs.push(mkTx({ direction: 'in', amount: 640000, ts: now - 6 * 86400, other: 'TFunder2xxxxxxxxxxxxxxxxxxxxxxxxxxx' }, addr));
  // 582 receivers get ~1900 each, machine rhythm: every 60 sec
  let t = now - 6 * 86400 + 60;
  for (let i = 0; i < 582; i++) {
    txs.push(mkTx({ direction: 'out', amount: 1900 + (i % 7) * 3, ts: t, other: `TFanOut${i}xxxxxxxxxxxxxxxxxxxxxxxxxx` }, addr));
    t += 60;
  }
  // add matched in→out pair to test transit (2 in pairs above match: 640k in -> 632k out within 2h)
  txs.push(mkTx({ direction: 'out', amount: 639800, ts: now - 8 * 86400 + 3600, other: 'TTreasuryxxxxxxxxxxxxxxxxxxxxxxxx' }, addr));
  txs.push(mkTx({ direction: 'out', amount: 639900, ts: now - 6 * 86400 + 7200, other: 'TTreasury2xxxxxxxxxxxxxxxxxxxxxxx' }, addr));

  const res = buildProfile({
    addr, txs, now,
    account: { createdAt },
    priceOf: (s) => (s === 'USDT' ? 1 : undefined),
  });

  const k = res.kpi;
  console.log(`KPI: received=${Math.round(k.received)} (${k.receivedCount} ops), sent=${Math.round(k.sent)} (${k.sentCount} ops)`);
  console.log(`settled=${k.settledPct.toFixed(1)}% cpIn=${k.counterpartiesIn} cpOut=${k.counterpartiesOut} turnover=${Math.round(k.turnover)}`);
  console.log(`avg=${k.avgTx.toFixed(2)} median=${k.medianTx.toFixed(2)} max=${Math.round(k.maxTx)} activeDays=${k.activeDays} age=${k.ageDays}`);
  console.log('FINDINGS:');
  for (const f of res.findings) {
    console.log(`  [${f.severity}] ${f.title} — ${f.detail}`);
  }
  console.log('CLASSIFICATION:', res.classification.title, '· достоверность:', res.classification.confidence);
  console.log('SCORES:', JSON.stringify(res.classification.scores));
  console.log(`TRANSIT: matched=${res.transit.matched}/${res.transit.ofIn} (${res.transit.pct.toFixed(0)}%) medianHold=${res.transit.medianHoldMin}min`);
  console.log('riskScore:', res.riskScore);

  const ids = res.findings.map((f) => f.id);
  const expected = ['fresh_big_turnover', 'fan_out', 'zero_residue', 'machine_rhythm'];
  const missing = expected.filter((e) => !ids.includes(e));
  console.log(missing.length === 0 ? 'PASS: all 4 expected findings present' : `FAIL: missing ${missing.join(', ')}`);
  const fo = res.findings.find((f) => f.id === 'fan_out');
  if (fo) console.log('fan_out detail:', fo.detail);
}

async function partB() {
  line('B) REAL TRON hot wallet + KB label (spec §8.4: own admin knowledge base)');
  // Measured fact: Tronscan anonymous API does not expose tags/name for arbitrary
  // addresses (checked TV6MuMX…, TMuA6Yqf… — name=''), so the honest free path for
  // exchange labels is our own KB (§8.4) + OFAC + open datasets (§8.1/8.2).
  const usdt = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
  const reg = new AdapterRegistry(ctx);
  const trc20 = await reg.transactions('tron', usdt, { limit: 50 });
  // frequency aggregation: hottest counterparty of the USDT contract = live hot wallet
  const freq = new Map<string, number>();
  for (const t of trc20.txs) {
    for (const a of [t.from, t.to]) {
      if (a && a !== usdt) freq.set(a, (freq.get(a) ?? 0) + 1);
    }
  }
  const sorted = [...freq.entries()].sort((x, y) => y[1] - x[1]);
  const hotAddr = sorted[0]?.[0];
  if (!hotAddr) {
    console.log('FAIL: no counterparties found');
    return;
  }
  console.log(`discovered hot wallet by transfer frequency: ${hotAddr} (seen ${sorted[0][1]}× in 50 recent USDT transfers; next: ${sorted[1]?.[0]} ×${sorted[1]?.[1]})`);

  // seed admin KB label (as /admin addlabel would)
  await ctx.db.upsertLabel({ chain: 'tron', addr: hotAddr, category: 'cex', name: 'Exchange-hot (seed-test)', source: 'kb:seed-test', confidence: 'high', addedBy: 'admin' });

  // fetch its transfers (limit 200 trc20)
  const page = await reg.transactions('tron', hotAddr, { limit: 200 });
  console.log(`txs fetched: ${page.txs.length} (providers=${page.providers.join(',')})`);

  // counterparty labels from our DB (LabelEngine path)
  const cps = [...new Set(page.txs.flatMap((t) => [t.from, t.to]))].filter((a) => a && a !== hotAddr).slice(0, 40);
  const labels = new Map<string, Label>();
  for (const l of await ctx.db.getLabels('tron', cps)) labels.set(l.addr.toLowerCase(), l);
  // also label the USDT contract itself
  labels.set(usdt.toLowerCase(), { chain: 'tron', addr: usdt, category: 'contract', name: 'USDT (Tether TRC-20)', source: 'kb:seed-test', confidence: 'high' });
  console.log('labels in map:', [...labels.keys()].length);

  const pxUsdt = await ctx.prices.priceBySymbol('USDT');
  const pxTrx = await ctx.prices.priceBySymbol('TRX');
  const res = buildProfile({
    addr: hotAddr,
    txs: page.txs,
    now: Math.floor(Date.now() / 1000),
    account: {},
    labels,
    priceOf: (s) => (s === 'USDT' ? (pxUsdt ?? 1) : s === 'TRX' ? (pxTrx ?? 0) : undefined),
  });

  const k = res.kpi;
  console.log(`KPI: received=${Math.round(k.received)}$ (${k.receivedCount}), sent=${Math.round(k.sent)}$ (${k.sentCount}) settled=${k.settledPct.toFixed(1)}%`);
  console.log(`cpIn=${k.counterpartiesIn} cpOut=${k.counterpartiesOut} turnover=${Math.round(k.turnover)}$ avg=${k.avgTx.toFixed(2)}$ median=${k.medianTx.toFixed(2)}$ max=${Math.round(k.maxTx)}$`);
  console.log('FINDINGS:');
  for (const f of res.findings) console.log(`  [${f.severity}] ${f.title} — ${f.detail}`);
  console.log('CLASSIFICATION:', res.classification.title, '· достоверность:', res.classification.confidence);
  console.log('SCORES:', JSON.stringify(res.classification.scores));
  console.log(`TRANSIT: matched=${res.transit.matched}/${res.transit.ofIn} (${res.transit.pct.toFixed(0)}%) medianHold=${res.transit.medianHoldMin}min risk=${res.riskScore}`);
}

async function main() {
  await partA();
  await partB();
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
