// Monitor (spec §12): 5-min watch cycle. Pure logic here; the Worker cron
// (scheduled handler) and DO alarms orchestrate batches in production.

import type { Tx } from '../core/types.ts';
import { CHAINS } from '../core/types.ts';
import type { AppCtx } from '../core/ctx.ts';
import type { AdapterRegistry } from '../adapters/registry.ts';
import type { WatchRow } from '../core/db.ts';
import { renderWatchAlert } from '../tg/formatter.ts';
import { parseJsonSafe } from '../core/util.ts';

export interface MonitorAlert {
  chatId: number;
  text: string;
  chain: string;
  addr: string;
}

export interface MonitorCycleResult {
  alerts: MonitorAlert[];
  checked: number;
  failures: { addr: string; err: string }[];
}

const FAIL_THRESHOLD = 3;

export async function monitorCycle(
  ctx: AppCtx,
  registry: AdapterRegistry,
  limit = 15,
): Promise<MonitorCycleResult> {
  const now = ctx.now();
  const watches = (await ctx.db.listWatches()).filter((w) => w.active).slice(0, limit);
  const alerts: MonitorAlert[] = [];
  const failures: { addr: string; err: string }[] = [];

  for (const w of watches) {
    try {
      const page = await registry.transactions(w.chain as never, w.addr, { limit: 20 });
      const lastCheck = w.lastCheck ?? 0;
      const seen = parseJsonSafe<Record<string, true>>(w.lastStateJson, {});
      const news = page.txs.filter((t) => t.ts > lastCheck && !seen[t.hash] && t.direction !== 'self');

      const labelFor = (t: Tx) => {
        const l = t.direction === 'in' ? t.labelFrom : t.labelTo;
        return l ? `${l.name} (${l.category})` : undefined;
      };
      const counterparty = (t: Tx) => (t.direction === 'in' ? t.from : t.to);

      const minUsd = w.minUsd ?? 10;
      const isStable = (t: Tx) => t.asset === 'USDT' || t.asset === 'USDC';
      const significant = news.filter((t) => isStable(t) ? t.amount >= minUsd : true); // price-free filter for stables; others pass through

      // mark seen + update state even if nothing new
      const seenNext: Record<string, true> = { ...seen };
      for (const t of page.txs.slice(0, 50)) seenNext[t.hash] = true;

      let balanceText: string | undefined;
      try {
        const acc = await registry.account(w.chain as never, w.addr);
        const sym = CHAINS[w.chain as keyof typeof CHAINS]?.native ?? '';
        balanceText = `${acc.balanceNative} ${sym}`;
      } catch { /* optional */ }

      for (const t of significant.slice(0, 10)) {
        await ctx.db.addWatchEvents([{
          watchId: w.id, direction: t.direction as 'in' | 'out', amount: t.amount, asset: t.asset,
          counterparty: counterparty(t), label: labelFor(t), txHash: t.hash, ts: t.ts, notified: false,
        }]);
        const explorerUrl = CHAINS[w.chain as keyof typeof CHAINS]?.explorerTx(t.hash) ?? '';
        alerts.push({
          chatId: w.chatId,
          text: renderWatchAlert({
            direction: t.direction as 'in' | 'out',
            amount: t.amount, asset: t.asset,
            counterparty: counterparty(t),
            label: labelFor(t),
            addr: w.addr, balance: balanceText,
            ts: t.ts, chain: w.chain, txHash: t.hash, explorerUrl,
          }),
          chain: w.chain, addr: w.addr,
        });
      }

      const failCount = 0; // success resets
      await ctx.db.updateWatchState(w.id, JSON.stringify(seenNext), now, undefined);
      void failCount;
    } catch (e) {
      failures.push({ addr: w.addr, err: (e as Error).message.slice(0, 100) });
      // degradation tracking: after FAIL_THRESHOLD consecutive failures warn the user
      const st = parseJsonSafe<{ fails?: number }>(w.lastStateJson, {});
      const fails = (st.fails ?? 0) + 1;
      await ctx.db.updateWatchState(w.id, JSON.stringify({ ...st, fails }), ctx.now(), undefined);
      if (fails >= FAIL_THRESHOLD) {
        alerts.push({
          chatId: w.chatId,
          text: `⚠️ Мониторинг временно деградирован: источник для <code>${w.addr}</code> недоступен (${fails} неудач подряд). Продолжаю ретраи каждые 5 минут, данные придут после восстановления.`,
          chain: w.chain, addr: w.addr,
        });
      }
    }
  }

  return { alerts, checked: watches.length, failures };
}

export async function addWatch(ctx: AppCtx, chatId: number, chain: string, addr: string, minUsd: number): Promise<WatchRow> {
  const u = await ctx.db.getUser(chatId);
  const isAdmin = ctx.isOwner(chatId);
  const limit = isAdmin ? 50 : ctx.cfg.quotaWatches;
  const mine = (await ctx.db.listWatches(chatId)).filter((w) => w.active);
  if (mine.length >= limit) {
    throw new Error(`Лимит отслеживания: ${limit} адресов${isAdmin ? '' : ' (админ — до 50)'}. Отпиши один: /unwatch`);
  }
  void u;
  const w = await ctx.db.addWatch({ chatId, chain, addr, active: true, minUsd });
  return w;
}

// №11 Ежедневная сводка (cron 0 7 * * *): по каждому пользователю с активными
// адресами — что изменилось за сутки (события уже в watch_events). Тишина, если
// событий нет: сводка не должна превращаться в спам.
export async function digestDaily(ctx: AppCtx, send: (chatId: number, text: string) => Promise<void>): Promise<number> {
  const all = (await ctx.db.listWatches()).filter((w) => w.active);
  if (!all.length) return 0;
  const byChat = new Map<number, typeof all>();
  for (const w of all) {
    const arr = byChat.get(w.chatId) ?? [];
    arr.push(w);
    byChat.set(w.chatId, arr);
  }
  const since = ctx.now() - 86400;
  let sent = 0;
  for (const [chatId, watches] of byChat) {
    const events = await ctx.db.listWatchEvents(watches.map((w) => w.id), 50, since);
    if (!events.length) continue;
    const inEv = events.filter((e) => e.direction === 'in');
    const outEv = events.filter((e) => e.direction === 'out');
    const lines: string[] = ['📋 <b>Сводка за 24 часа</b>', ''];
    lines.push(`Адресов под наблюдением: <b>${watches.length}</b> · событий: <b>${events.length}</b> (▼ входящих ${inEv.length} · ▲ исходящих ${outEv.length})`);
    const biggest = [...events].sort((a, b) => b.amount - a.amount).slice(0, 5);
    if (biggest.length) lines.push('', '<b>Крупнейшие движения:</b>');
    for (const e of biggest) {
      const dir = e.direction === 'in' ? '▼ вход' : '▲ вывод';
      const cp = e.counterparty ? `${shortAddr(e.counterparty)}${e.label ? ` (${e.label})` : ''}` : '';
      lines.push(`${dir} · <b>${e.amount} ${e.asset}</b> ${cp ? `· ${cp}` : ''}`);
    }
    lines.push('', 'Подробности — «🔔 Мониторинг» в мини-аппе.');
    await send(chatId, lines.join('\n'));
    sent++;
  }
  return sent;
}

function shortAddr(a: string): string {
  return a && a.length > 14 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a;
}
