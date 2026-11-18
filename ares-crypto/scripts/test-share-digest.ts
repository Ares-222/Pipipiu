// Смок новых фич 18.11: share-страница, дайджест, трейс-история, diff-метод, пороги.
// Запуск: node scripts/test-share-digest.ts  (MemoryDB, без внешних вызовов)

import { MemoryDB } from '../worker/src/core/db.ts';
import { renderSharePage } from '../worker/src/api/share.ts';
import { digestDaily } from '../worker/src/engine/monitor.ts';
import type { AppCtx } from '../worker/src/core/ctx.ts';
import type { WalletReport } from '../worker/src/core/types.ts';
import { line } from './sandbox.ts';

function fakeCtx(db: MemoryDB): AppCtx {
  return {
    db,
    kv: {
      get: async (k: string) => (k === 'share:abc' ? '{"input":"0xQR"}' : null),
      put: async () => {},
      del: async () => {},
    },
    breaker: { status: () => [] },
    prices: {},
    cfg: { adminId: 1, botToken: 'x', webhookSecret: 'x', quotaQuick: 10, quotaDeep: 2, quotaAml: 10, quotaWatches: 5, traceMaxDepth: 3, traceDefaultDepth: 2 },
    now: () => 1_800_000_000,
    isOwner: () => true,
  } as unknown as AppCtx;
}

async function main(): Promise<void> {
  const db = new MemoryDB();
  const ctx = fakeCtx(db);
  let fail = 0;
  const ok = (name: string, cond: boolean) => { console.log(`   ${cond ? 'OK' : 'FAIL'} ${name}`); if (!cond) fail++; };

  line('1) diff: lastCheckForInput до/после записи');
  ok('нет прошлой проверки', (await db.lastCheckForInput(1, 'ADDR')) === null);
  await db.addCheck({ chatId: 1, input: 'ADDR', chain: 'tron', verdict: '42/100', createdTs: 100 });
  const prev = await db.lastCheckForInput(1, 'ADDR');
  ok('нашла 42/100', prev?.verdict === '42/100');

  line('2) trace-история: save/list/get + фильтр chatId');
  const tid = await db.saveTrace({ root: 'ADDR', chain: 'tron', depth: 2, status: 'done', resultJson: '{"root":"ADDR"}', chatId: 1, createdTs: 200 });
  const lst = await db.listTraces(1, 10);
  const lst2 = await db.listTraces(2, 10);
  ok('list у владельца отдаёт', lst.length === 1 && lst[0].id === tid && lst[0].root === 'ADDR');
  ok('list не отдаёт чужому', lst2.length === 0);
  const tr = await db.getTrace(tid);
  ok('getTrace возвращает result_json', tr?.resultJson === '{"root":"ADDR"}');

  line('3) порог: updateWatchMinUsd + listWatchEvents(sinceTs)');
  const w = await db.addWatch({ chatId: 1, chain: 'tron', addr: 'ADDR', active: true, minUsd: 10 });
  await db.updateWatchMinUsd(w.id, 777);
  ok('порог обновился', (await db.listWatches(1))[0].minUsd === 777);
  await db.addWatchEvents([
    { watchId: w.id, direction: 'in', amount: 1, asset: 'USDT', counterparty: 'X', txHash: 'h1', ts: 1_799_992_800, notified: false },
    { watchId: w.id, direction: 'out', amount: 5, asset: 'TRX', counterparty: 'Y', txHash: 'h2', ts: 1_799_996_400, notified: false },
  ]);
  const evAll = await db.listWatchEvents([w.id], 10);
  const evSince = await db.listWatchEvents([w.id], 10, 1_799_994_000);
  ok('все события: 2', evAll.length === 2);
  ok('после cutoff: 1', evSince.length === 1 && evSince[0].txHash === 'h2');

  line('4) digestDaily: сводка только при событиях за сутки, группировка по чатам');
  const sent: Array<{ chatId: number; text: string }> = [];
  const sentCount = await digestDaily(ctx, async (chatId, text) => sent.push({ chatId, text }));
  ok('отправлена 1 сводка', sentCount === 1 && sent[0].chatId === 1);
  ok('в тексте есть числа', /событий: <b>2<\/b>/.test(sent[0]?.text ?? '') && /Крупнейшие/.test(sent[0]?.text ?? ''));

  line('5) share-страница: экранирование и разделы');
  const rep = {
    input: '<script>alert(1)</script>',
    createdAt: 1_800_000_000,
    verdict: { score: 42, level: 'medium', reasons: ['причина <b>1</b>'] },
    warnings: [],
    chains: [{
      chain: 'tron', account: { chain: 'tron', addr: 'ADDR', balanceNative: 12.5, tokens: [], txCount: 7, provider: 'test' },
      txs: [], findings: [{ id: 'f1', severity: 'red', title: 'T1', detail: 'D1' }],
      aml: { score: 42, level: 'medium', hits: [{ source: 'ofac', severity: 'red', hops: 0, volumeShare: 0.3, score: 30 }], exchangeExit: [], exposure: [{ key: 'cex', ru: 'Биржи', pct: 60, tone: 'ok' }], topOut: [], disclaimer: 'дисклеймер' },
    }],
  } as unknown as WalletReport;
  const html = renderSharePage(rep, 'aabbccddeeff00112233');
  ok('script экранирован', !html.includes('<script>alert'));
  ok('скоринг и уровень на месте', html.includes('42') && html.includes('СРЕДНИЙ'));
  ok('AML-раздел и exposure на месте', html.includes('ofac') && html.includes('Биржи'));
  ok('токен на странице', html.includes('aabbcc…'));

  console.log(fail === 0 ? '\nSMOK OK' : `\nSMOK FAILED: ${fail}`);
  process.exit(fail === 0 ? 0 : 1);
}

main();
