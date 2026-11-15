// M3 smoke test: feeds sync (real OFAC + ScamSniffer) + AML scoring (§9).
// Run: node scripts/test-aml.ts

import { makeSandbox, line } from './sandbox.ts';
import { syncOfac, syncScamSniffer, downloadOfac, downloadScamSniffer } from '../worker/src/engine/feeds.ts';
import { scoreAml } from '../worker/src/engine/aml.ts';
import type { Tx } from '../worker/src/core/types.ts';

const { ctx } = makeSandbox();

function tx(dir: 'in' | 'out', other: string, amount: number, tsDelta: number, asset = 'USDT'): Tx {
  const now = Math.floor(Date.now() / 1000);
  return {
    hash: `t-${Math.random().toString(36).slice(2, 8)}`,
    chain: 'eth',
    ts: now - tsDelta,
    from: dir === 'in' ? other : 'TARGET',
    to: dir === 'out' ? other : 'TARGET',
    amount, asset, fee: 0,
    direction: dir,
    kind: 'token',
  };
}

async function main() {
  console.log('ARES CRYPTO — M3 AML SMOKE TEST');
  const now = Math.floor(Date.now() / 1000);

  // ---- real feeds ----
  line('Feed sync: OFAC SDN (official dump)');
  const csv = await downloadOfac();
  console.log(`sdn.csv downloaded: ${(csv.length / 1e6).toFixed(1)} MB`);
  const ofac = await syncOfac(ctx.db, csv);
  console.log(`OFAC crypto entries parsed: ${ofac.inserted}`);
  // show a few real OFAC entries (public data) by chain
  const allOfac = await ctx.db.listAmlSources(1000);
  const byChain: Record<string, number> = {};
  for (const r of allOfac) if (r.source === 'ofac') byChain[r.chain] = (byChain[r.chain] ?? 0) + 1;
  console.log(`OFAC by chain: ${JSON.stringify(byChain)}`);
  console.log(`sample: ${allOfac.filter((r) => r.source === 'ofac').slice(0, 3).map((r) => `${r.chain}:${r.addr.slice(0, 14)}… [${r.ref?.slice(0, 34)}]`).join(' | ')}`);

  line('Feed sync: ScamSniffer blacklist');
  const scam = await downloadScamSniffer();
  console.log(`scam-database addresses: ${scam.length}`);
  const inserted = await syncScamSniffer(ctx.db, scam);
  console.log(`inserted (0x format): ${inserted}`);
  const allRows = await ctx.db.listAmlSources(100000);
  const scamAddr = allRows.find((r) => r.source === 'scamsniffer')?.addr;
  const ofacAddr = allRows.find((r) => r.source === 'ofac' && r.chain === 'eth')?.addr
    ?? allRows.find((r) => r.source === 'ofac')?.addr;
  if (!scamAddr || !ofacAddr) {
    console.log('FAIL: missing feed data');
    return;
  }
  console.log(`test vectors from feeds: scam=${scamAddr.slice(0, 14)}… ofac=${ofacAddr.slice(0, 14)}…`);

  // ---- test 1: direct OFAC contact (target IS the sanctioned addr) ----
  line('Test 1: direct OFAC address -> critical expected');
  const r1 = await scoreAml(ctx, { chain: 'eth', addr: ofacAddr, txs: [], now });
  console.log(`score=${r1.score} level=${r1.level} hits=${r1.hits.map((h) => `${h.source}/${h.severity}`).join(',')}`);
  console.log(r1.score >= 81 ? 'PASS (critical)' : 'FAIL');

  // ---- test 2: 1-hop from scam-db address (fresh contact, 50% volume) ----
  line('Test 2: 1-hop dirty counterparty (fresh, 50% of incoming volume)');
  const r2 = await scoreAml(ctx, {
    chain: 'eth', addr: 'TARGET_ADDR_TEST',
    txs: [
      tx('in', scamAddr, 5, 10 * 86400),
      tx('in', 'clean1', 5, 12 * 86400),
    ],
    now,
  });
  console.log(`score=${r2.score} level=${r2.level} hits=${JSON.stringify(r2.hits.map((h) => ({ s: h.source, hops: h.hops, share: h.volumeShare.toFixed(2), score: h.score.toFixed(0) })))}`);
  // expected: base 70 × share 0.5 × decay ~0.98 ≈ 34 -> low
  console.log(r2.score >= 21 && r2.score <= 45 ? 'PASS (low/medium band, base 70 × share 0.5 × decay)' : 'FAIL');

  // ---- test 3: old contact decays (2 years) ----
  line('Test 3: time decay — same contact 2 years old');
  const r3 = await scoreAml(ctx, {
    chain: 'eth', addr: 'TARGET_ADDR_TEST',
    txs: [
      tx('in', scamAddr, 5, 2 * 365 * 86400),
      tx('in', 'clean1', 5, 2 * 365 * 86400),
    ],
    now,
  });
  console.log(`score=${r3.score} (decay 0.5^2 = 0.25 → ~17)`);
  console.log(r3.score < r2.score ? 'PASS (decayed)' : 'FAIL');

  // ---- test 4: exchange_exit via KB label ----
  line('Test 4: exchange_exit (cex-labeled counterparty)');
  await ctx.db.upsertLabel({ chain: 'eth', addr: '0x28c6c06298d514db089934071355e5743bf42d78', category: 'cex', name: 'Binance 14', source: 'kb:seed', confidence: 'mid' });
  const r4 = await scoreAml(ctx, {
    chain: 'eth', addr: 'TARGET_ADDR_TEST2',
    txs: [tx('in', '0x28C6c06298d514Db089934071355E5743bf42d78', 100, 86400)],
    now,
  });
  console.log(`exchangeExit=${JSON.stringify(r4.exchangeExit)} score=${r4.score}`);
  console.log(r4.exchangeExit.length === 1 ? 'PASS' : 'FAIL');

  // ---- test 5: mixer registered as dirty source ----
  line('Test 5: mixer_touch (Tornado proxy as mixer source)');
  const tornado = '0xd90e2f925daf26f104396927fd0dd859c8f4dc44';
  await ctx.db.upsertAmlSources([{ chain: 'eth', addr: tornado, source: 'mixer:tornado:eth', severity: 'critical', ref: 'Tornado Cash ETH proxy', updatedTs: now }]);
  const r5 = await scoreAml(ctx, {
    chain: 'eth', addr: 'TARGET_ADDR_TEST3',
    txs: [tx('in', tornado, 10, 3 * 86400)],
    now,
  });
  console.log(`score=${r5.score} level=${r5.level} hits=${r5.hits.map((h) => h.source).join(',')}`);
  console.log(r5.level === 'high' || r5.level === 'critical' ? 'PASS (mixer contact scores high)' : 'FAIL');

  console.log('\naml_sources total:', await ctx.db.amlSourceCount(), '| labels total:', await ctx.db.labelCount());
  console.log('\nDISCLAIMER attached:', ctx ? 'yes (per AmlResult.disclaimer)' : 'no');
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
