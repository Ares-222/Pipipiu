// Демо меток 🏷 «биржа/сервис»: берём адреса с метками из фидов (OFAC/ScamSniffer),
// прогоняем тот же buildWalletReport, что в боте, и отправляем отчёт в чат —
// чтобы заказчик увидел, как выглядят метки на помеченных контрагентах.
// Run: node scripts/test-labels-demo.ts

import { makeSandbox } from './sandbox.ts';
import { BotApi } from '../worker/src/tg/bot.ts';
import { buildWalletReport } from '../worker/src/service/report.ts';
import { renderReport } from '../worker/src/tg/formatter.ts';
import { syncOfac, syncScamSniffer, downloadOfac, downloadScamSniffer } from '../worker/src/engine/feeds.ts';

async function main(): Promise<void> {
  const { ctx, registry } = makeSandbox();
  const api = new BotApi(ctx);
  // фиды могли не дожить до этого запуска (дамп пересобирается) — синкаем как в dev-polling
  try {
    const csv = await downloadOfac();
    const r1 = await syncOfac(ctx.db, csv);
    const scam = await downloadScamSniffer();
    const r2 = await syncScamSniffer(ctx.db, scam);
    console.log(`feeds: OFAC ${r1.inserted}, ScamSniffer ${r2}`);
  } catch (e) { console.log('feeds sync skipped:', (e as Error).message); }
  const labels = await ctx.db.listLabels(200);
  console.log(`меток в базе: ${labels.length}`);
  const byCat = new Map<string, number>();
  for (const l of labels) byCat.set(l.category, (byCat.get(l.category) ?? 0) + 1);
  console.log('по категориям:', [...byCat.entries()].map(([k, v]) => `${k}:${v}`).join(' '));

  // берём самый свежий меченый адрес (не token) — у него в отчёте будут 🏷-строки
  const demo = labels.find((l) => l.category !== 'token' && l.chain === 'eth') ?? labels.find((l) => l.category !== 'token');
  if (!demo) { console.log('нет демо-метки'); return; }
  console.log(`демо: ${demo.chain}:${demo.addr} → «${demo.name}» (${demo.category}, ${demo.confidence}, источник: ${demo.source})`);

  const rep = await buildWalletReport(ctx, registry, demo.addr);
  const parts = renderReport(rep);
  const header = `🏷 <b>Как выглядят метки</b> — отчёт адреса из базы меток (${demo.name}, ${demo.category}). У твоего адреса TRKhSYVu… контрагенты — безымянные личные кошельки, поэтому там меток не было: метка появляется, когда кошелёк опознан в OFAC / ScamSniffer / базе сервисов.\n\n`;
  const text = header + parts.join('\n');
  await api.sendMessage(ctx.cfg.adminId, text.slice(0, 4000), undefined);
  console.log('-- отправлено (sendMessage ok)');
  console.log(text.slice(0, 600));
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
