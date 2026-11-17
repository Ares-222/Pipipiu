// Standalone OFAC + ScamSniffer sync for production D1 (spec §22.4).
// In the Worker this runs as a daily cron (index.ts scheduled); this script is for
// manual runs / initial fill. Requires wrangler D1 binding — in production prefer:
//   curl the worker /admin? no — simply call it once via `wrangler d1 execute` fallback:
// This sandbox variant fills a local JSON dump that the dev-polling bot picks up.
// Run: ARES_DB_DUMP=/tmp/ares-db.json node scripts/sync-ofac.ts

import { makeSandbox } from './sandbox.ts';
import { syncOfac, syncScamSniffer, downloadOfac, downloadScamSniffer } from '../worker/src/engine/feeds.ts';

async function main() {
  const { ctx } = makeSandbox();
  const csv = await downloadOfac();
  const r1 = await syncOfac(ctx.db, csv);
  const scam = await downloadScamSniffer();
  const r2 = await syncScamSniffer(ctx.db, scam);
  console.log(`sync done: OFAC +${r1.inserted} (labels ${r1.labels}), ScamSniffer +${r2}`);
  console.log(`totals: aml_sources=${await ctx.db.amlSourceCount()} labels=${await ctx.db.labelCount()}`);
  if (process.env.ARES_DB_DUMP) console.log(`dump saved: ${process.env.ARES_DB_DUMP}`);
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
