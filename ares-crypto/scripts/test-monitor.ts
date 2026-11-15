// M7 smoke test: monitor cycle — real watch on USDT contract, synthetic lastCheck
// in the past -> "new" txs -> alerts with labels + min-USD filter.
// Run: node scripts/test-monitor.ts

import { makeSandbox, line } from './sandbox.ts';
import { monitorCycle, addWatch } from '../worker/src/engine/monitor.ts';

const { ctx, registry } = makeSandbox();

async function main() {
  console.log('ARES CRYPTO — M7 MONITOR SMOKE TEST');
  // label a counterparty so the alert carries a tag
  await ctx.db.upsertLabel({ chain: 'tron', addr: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t', category: 'contract', name: 'USDT (Tether TRC-20)', source: 'kb:seed', confidence: 'high' });

  const chatId = 5188446459;
  const w = await addWatch(ctx, chatId, 'tron', 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t', 10);
  // simulate "checked 1 hour ago" -> fresh adapter txs count as new
  await ctx.db.updateWatchState(w.id, '{}', ctx.now() - 20000);

  const t0 = Date.now();
  const r = await monitorCycle(ctx, registry, 15);
  console.log(`cycle: ${r.checked} watches, ${r.alerts.length} alerts, ${(Date.now() - t0) / 1000}s, failures=${r.failures.length}`);
  for (const a of r.alerts.slice(0, 3)) {
    console.log('--- ALERT ---');
    console.log(a.text);
  }
  const events = await ctx.db.listWatchEvents([w.id], 5);
  console.log(`events saved: ${events.length}`);

  // second run right after: no new txs -> 0 alerts (diff works)
  const r2 = await monitorCycle(ctx, registry, 15);
  console.log(`second cycle: ${r2.alerts.length} alerts (expected 0 — диф работает: ${r2.alerts.length === 0 ? 'OK' : 'FAIL'})`);

  console.log('\nPASS:', r.alerts.length > 0 && r2.alerts.length === 0);
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
