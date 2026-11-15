// K1/K2 smoke test: открытые упоминания + скам-базы + санкции (честная деградация).
// Run: node scripts/test-references.ts

import { makeSandbox, line } from './sandbox.ts';
import { openMentions } from '../worker/src/engine/references.ts';
import { syncOfac, syncScamSniffer, downloadOfac, downloadScamSniffer } from '../worker/src/engine/feeds.ts';

const { ctx } = makeSandbox();

async function main() {
  console.log('ARES CRYPTO — K1/K2 OPEN MENTIONS SMOKE TEST');

  // seed feeds (real data)
  const csv = await downloadOfac();
  await syncOfac(ctx.db, csv);
  const scam = await downloadScamSniffer();
  await syncScamSniffer(ctx.db, scam);

  // take a REAL scam-db address as the target (K6: вход — только крипто-объект)
  const rows = await ctx.db.listAmlSources(100000);
  const scamAddr = rows.find((r) => r.source === 'scamsniffer' && r.chain === 'eth')?.addr;
  if (!scamAddr) { console.log('FAIL: нет скам-адреса'); return; }
  console.log('target (реальный адрес из ScamSniffer):', scamAddr);

  const r = await openMentions(ctx, 'eth', scamAddr);
  console.log('\nHITS:');
  for (const h of r.hits) console.log(`  · [${h.kind}] ${h.source}: ${h.ref?.slice(0, 60)}`);
  console.log('\nCHECKED (честный список источников):');
  for (const c of r.checked) console.log(`  · ${c}`);
  console.log('\nnote:', r.note);
  console.log('\nPASS:', r.hits.some((h) => h.kind === 'scam-db'));
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
