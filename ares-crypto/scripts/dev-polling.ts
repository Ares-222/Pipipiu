// Sandbox/dev long-polling runner (spec §4/§22): lets the customer test the bot
// in real Telegram without deployment. Also used for acceptance tests (M0).
// Run: node scripts/dev-polling.ts
// Stop: Ctrl+C (sandbox harness kills it; production uses the Worker webhook).

import { makeSandbox } from './sandbox.ts';
import { BotApi, getMe } from '../worker/src/tg/bot.ts';
import { handleUpdate } from '../worker/src/tg/router.ts';
import type { RouterDeps } from '../worker/src/tg/router.ts';
import { syncOfac, syncScamSniffer, downloadOfac, downloadScamSniffer } from '../worker/src/engine/feeds.ts';

async function main(): Promise<void> {
  // персистентная база песочницы: метки, миксер-индекс, кластеры — между запусками
  process.env.ARES_DB_DUMP ??= new URL('../.sandbox-db.json', import.meta.url).pathname;
  const { ctx, registry } = makeSandbox();
  const api = new BotApi(ctx);
  const me = await getMe(ctx);
  console.log(`ARES dev-polling: bot @${me.username} (id ${me.id}) — long polling каждые 25с`);

  // seed feeds on first run (idempotent upserts)
  try {
    const csv = await downloadOfac();
    const r1 = await syncOfac(ctx.db, csv);
    const scam = await downloadScamSniffer();
    const r2 = await syncScamSniffer(ctx.db, scam);
    console.log(`feeds: OFAC ${r1.inserted}, ScamSniffer ${r2}`);
  } catch (e) {
    console.log('feeds sync skipped:', (e as Error).message);
  }

  const deps: RouterDeps = { ctx, registry, api, botUsername: me.username };

  let offset = 0;
  let lastAlertCheck = 0;
  const { monitorCycle } = await import('../worker/src/engine/monitor.ts');

  for (;;) {
    try {
      const updates = await api.getUpdates(offset, 25);
      for (const u of updates) {
        offset = u.update_id + 1;
        // process sequentially but not blocking the polling loop forever
        handleUpdate(deps, u).catch((e) => console.error('update error:', e.message));
      }
      // monitoring pass every 60s between polls
      const now = Date.now();
      if (now - lastAlertCheck > 60000) {
        lastAlertCheck = now;
        monitorCycle(ctx, registry).then((r) => {
          for (const a of r.alerts) api.sendMessage(a.chatId, a.text, undefined).catch(() => { /* ignore */ });
          if (r.alerts.length) console.log(`monitor: ${r.alerts.length} alerts`);
        }).catch((e) => console.error('monitor error:', e.message));
      }
    } catch (e) {
      console.error('poll error:', (e as Error).message);
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
