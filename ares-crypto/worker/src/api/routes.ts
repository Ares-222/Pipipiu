// REST API for the Telegram Mini App (spec §15). Auth: Telegram initData
// (HMAC by bot token, official scheme) in the `x-init-data` header — no passwords.

import type { AppCtx } from '../core/ctx.ts';
import type { AdapterRegistry } from '../adapters/registry.ts';
import { validateInitData } from '../core/tgauth.ts';
import { buildWalletReport, buildTxCard } from '../service/report.ts';
import type { WalletReport } from '../core/types.ts';
import { runTrace } from '../engine/tracer.ts';
import { addWatch, monitorCycle } from '../engine/monitor.ts';
import { getUser, getSettings, updateSettings, checkQuota, incQuota, quotaText } from '../engine/quota.ts';
import { telegramLinks, resolveTelegram, resolveTonDomain } from '../engine/tonosint.ts';
import { compareAddresses } from '../engine/compare.ts';
import { searchTonTransfers } from '../engine/tonsearch.ts';
import { cachedJson, KV_TTL } from '../core/kv.ts';

export interface ApiDeps {
  ctx: AppCtx;
  registry: AdapterRegistry;
  sendPhoto: (chatId: number, jpegBytes: Uint8Array, caption?: string) => Promise<void>;
  sendDocument: (chatId: number, bytes: Uint8Array, filename: string, caption?: string, mime?: string) => Promise<void>;
}

interface AuthedReq {
  chatId: number;
  username?: string;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*' } });
}

function err(message: string, status = 400): Response {
  return json({ ok: false, error: message }, status);
}

export async function handleApi(req: Request, deps: ApiDeps, url: URL): Promise<Response> {
  const { ctx } = deps;
  const auth = await authUser(req, ctx);
  if (!auth) return err('401: недействительный initData (подпись Telegram не совпала)', 401);
  const chatId = auth.chatId;

  try {
    const path = url.pathname.replace(/^\/api/, '');

    // ---- report (single source of truth) ----
    // №24 (v7): KV-кэш отчёта на 15 минут. Повторные проверки/диплинки/share
    // не жгут fetch к провайдерам; ?force=1 (кнопка «Обновить») идёт в обход.
    // Кэш-хит честный: квота НЕ списывается (провайдеры не трогались), diff
    // прошлой проверки не пересчитывается.
    if (path === '/report' && req.method === 'GET') {
      const addr = url.searchParams.get('addr') ?? '';
      const force = url.searchParams.get('force') === '1';
      const cacheKey = `rep:${addr.trim()}`;
      if (!force) {
        const hit = await ctx.kv.get(cacheKey).catch(() => null);
        if (hit) {
          try {
            const rep = JSON.parse(hit) as WalletReport;
            if (rep?.chains?.length >= 0 && rep.createdAt) {
              return json({ ok: true, report: rep, cached: true });
            }
          } catch { /* повреждённая запись — идём свежим путём */ }
        }
      }
      const q = await checkQuota(ctx, chatId, 'quick');
      if (!q.ok) return err(quotaText('quick', q.left, q.resetLocal), 429);
      // №14 diff повторной проверки: предыдущая проверка того же адреса — до записи новой.
      const prev = await ctx.db.lastCheckForInput(chatId, addr);
      const rep = await buildWalletReport(ctx, deps.registry, addr);
      // Записи (квота, история) — не критичны для отчёта: при отказе D1 (лимит
      // rows_written/сутки) честно деградируем, отчёт всё равно отдаётся.
      try { await incQuota(ctx, chatId, 'quick'); } catch { /* лимит D1 — квота не засчитана */ }
      try {
        await ctx.db.addCheck({ chatId, input: addr, chain: rep.chains[0]?.chain ?? '', verdict: `${rep.verdict.score}/100`, createdTs: ctx.now(), summaryJson: JSON.stringify({ from: 'miniapp' }) });
      } catch { /* лимит D1 — история не записана */ }
      const repJson = JSON.stringify(rep);
      if (repJson.length < 400_000 && rep.chains.length > 0) {
        await ctx.kv.put(cacheKey, repJson, 900).catch(() => { /* кэш — оптимизация, не зависимость */ });
      }
      const prevScore = prev ? parseInt(prev.verdict, 10) : NaN;
      return json({
        ok: true, report: rep,
        prev: prev && !Number.isNaN(prevScore) ? { score: prevScore, ts: prev.createdTs } : undefined,
      });
    }

    // ---- transaction card ----
    if (path === '/tx' && req.method === 'GET') {
      const hash = url.searchParams.get('hash') ?? '';
      const chain = url.searchParams.get('chain') ?? '';
      let card = null;
      if (chain) card = await buildTxCard(ctx, deps.registry, chain as never, hash).catch(() => null);
      else {
        for (const c of ['eth', 'tron', 'ton'] as const) {
          card = await buildTxCard(ctx, deps.registry, c, hash).catch(() => null);
          if (card) break;
        }
      }
      return card ? json({ ok: true, card }) : err('транзакция не найдена', 404);
    }

    // ---- graph / trace ----
    // №25 (v7): если свежий отчёт по этому адресу уже в KV-кэше (№24), история
    // цели переиспользуется как seed — трейсер тратит бюджет на 2-й круг.
    if (path === '/graph' && req.method === 'GET') {
      const addr = url.searchParams.get('addr') ?? '';
      const chain = url.searchParams.get('chain') ?? '';
      const depth = Math.min(parseInt(url.searchParams.get('depth') ?? '2', 10) || 2, ctx.cfg.traceMaxDepth);
      const q = await checkQuota(ctx, chatId, 'deep');
      if (!q.ok) return err(quotaText('deep', q.left, q.resetLocal), 429);
      let seedTxs: import('../core/types.ts').Tx[] | undefined;
      try {
        const repHit = await ctx.kv.get(`rep:${addr.trim()}`).catch(() => null);
        if (repHit) {
          const rep = JSON.parse(repHit) as WalletReport;
          const cr = rep.chains?.find((c) => c.chain === chain) ?? rep.chains?.[0];
          if (cr?.txs?.length) seedTxs = cr.txs;
        }
      } catch { /* seed — оптимизация, не зависимость */ }
      const res = await runTrace(ctx, deps.registry, chain, addr, { depth, fetchBudget: 28, seedTxs });
      try { await incQuota(ctx, chatId, 'deep'); } catch { /* лимит D1 — квота не засчитана */ }
      // №7 история расследований: сохраняем результат (метаданные всегда, тяжёлая
      // версия — если влезает в лимит D1-байнда), чтобы открыть граф из «Истории».
      let traceId = 0;
      try {
        const js = JSON.stringify(res);
        traceId = await ctx.db.saveTrace({
          root: addr, chain, depth, status: 'done',
          resultJson: js.length < 900_000 ? js : undefined, chatId, createdTs: ctx.now(),
        });
      } catch (e) {
        await ctx.db.addErrorLog('graph-save', String((e as Error).message));
      }
      return json({ ok: true, trace: res, traceId });
    }

    // ---- trace history (№7): список расследований + открытие сохранённого ----
    if (path === '/trace-history' && req.method === 'GET') {
      const traces = await ctx.db.listTraces(chatId, 20);
      return json({ ok: true, traces: traces.map((t) => ({ id: t.id, root: t.root, chain: t.chain, depth: t.depth, createdTs: t.createdTs })) });
    }
    if (path === '/trace' && req.method === 'GET') {
      const id = parseInt(url.searchParams.get('id') ?? '0', 10) || 0;
      const t = id ? await ctx.db.getTrace(id) : null;
      if (!t || t.chatId !== chatId || !t.resultJson) return err('расследование не найдено', 404);
      return json({ ok: true, trace: JSON.parse(t.resultJson), traceId: t.id, createdTs: t.createdTs });
    }

    // ---- photo card upload (spec §17 pipeline A: client-canvas -> worker -> sendPhoto) ----
    if (path === '/render' && req.method === 'POST') {
      const body = await req.json().catch(() => null) as { jpeg?: string; caption?: string } | null;
      if (!body?.jpeg) return err('нет jpeg');
      const b64 = body.jpeg.includes(',') ? body.jpeg.slice(body.jpeg.indexOf(',') + 1) : body.jpeg;
      const bin = Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
      await deps.sendPhoto(chatId, bin, body.caption);
      return json({ ok: true });
    }

    // ---- PDF / CSV upload (K7: client-side jsPDF/CSV -> worker -> sendDocument) ----
    // v7 (№19): поле csv — тот же релей для табличного экспорта транзакций.
    if (path === '/pdf' && req.method === 'POST') {
      const body = await req.json().catch(() => null) as { pdf?: string; csv?: string; filename?: string; caption?: string } | null;
      if (!body?.pdf && !body?.csv) return err('нет pdf/csv');
      const isCsv = !body.pdf;
      const b64raw = body.pdf ?? body.csv!;
      const b64 = b64raw.includes(',') ? b64raw.slice(b64raw.indexOf(',') + 1) : b64raw;
      const bin = Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
      await deps.sendDocument(chatId, bin, body.filename ?? (isCsv ? 'ares-export.csv' : 'ares-report.pdf'), body.caption, isCsv ? 'text/csv' : 'application/pdf');
      return json({ ok: true });
    }

    // ---- №14 compare: пересечение двух кошельков ----
    if (path === '/compare' && req.method === 'GET') {
      const a = url.searchParams.get('a') ?? '';
      const b = url.searchParams.get('b') ?? '';
      const chain = url.searchParams.get('chain') ?? 'tron';
      if (!a || !b) return err('нужны a и b');
      const q = await checkQuota(ctx, chatId, 'quick');
      if (!q.ok) return err(quotaText('quick', q.left, q.resetLocal), 429);
      const res = await compareAddresses(ctx, deps.registry, chain, a, b);
      await incQuota(ctx, chatId, 'quick');
      return json({ ok: true, compare: res });
    }

    // ---- №4 tonsearch: перевод по memo/сумме/времени ----
    if (path === '/tonsearch' && req.method === 'GET') {
      const addr = url.searchParams.get('addr') ?? '';
      const memo = url.searchParams.get('memo') ?? undefined;
      const amount = parseFloat(url.searchParams.get('amount') ?? '') || undefined;
      const days = parseInt(url.searchParams.get('days') ?? '', 10) || undefined;
      if (!addr) return err('нужен addr');
      if (!memo && !amount) return err('нужен memo или amount');
      const res = await searchTonTransfers(ctx, deps.registry, addr, { memo, amount, days });
      return json({ ok: true, search: res });
    }

    // ---- №8 multichain: один EVM-адрес на нескольких сетях ----
    if (path === '/multichain' && req.method === 'GET') {
      const addr = url.searchParams.get('addr') ?? '';
      if (!/^0x[0-9a-fA-F]{40}$/.test(addr.trim())) return err('нужен EVM-адрес 0x…');
      const chains = ['eth', 'bsc', 'polygon'] as const;
      const rows = await Promise.allSettled(chains.map(async (c) => {
        const adapter = deps.registry.get(c);
        if (!adapter) throw new Error('нет адаптера');
        const { value: acc } = await cachedJson(
          ctx.kv, `prof:${c}:${addr.trim().toLowerCase()}`, KV_TTL.profile,
          () => adapter.account(addr.trim()),
        );
        return { chain: c, balance: acc.balanceNative, isContract: !!acc.isContract, provider: acc.provider, partial: !!acc.partial };
      }));
      return json({
        ok: true,
        chains: rows.map((r, i) => r.status === 'fulfilled'
          ? r.value
          : { chain: chains[i], error: String((r.reason as Error)?.message ?? 'недоступен').slice(0, 120) }),
      });
    }

    // ---- №23 quota dashboard: честные остатки лимитов ----
    if (path === '/me' && req.method === 'GET') {
      const u = await getUser(ctx, chatId);
      const watches = (await ctx.db.listWatches(chatId)).filter((w) => w.active).length;
      const tomorrow = new Date((ctx.now() + 86400) * 1000).toISOString().slice(0, 16).replace('T', ' ');
      return json({
        ok: true,
        user: {
          quickUsed: u.quickUsed, deepUsed: u.deepUsed, amlUsed: u.amlUsed,
          watchesUsed: watches,
          isOwner: ctx.isOwner(chatId),
          resetAt: `${tomorrow} UTC`,
        },
        quota: { quick: ctx.cfg.quotaQuick, deep: ctx.cfg.quotaDeep, aml: ctx.cfg.quotaAml, watches: ctx.cfg.quotaWatches },
      });
    }

    // ---- ton osint ----
    if (path === '/ton' && req.method === 'GET') {
      const q0 = url.searchParams.get('q') ?? '';
      let addr = q0;
      let resolvedNote = '';
      if (q0.startsWith('@')) {
        const r = await resolveTelegram(ctx, q0);
        if (!r?.addr) return err('юзернейм не привязан к TON-кошельку', 404);
        addr = r.addr;
        resolvedNote = r.note;
      } else if (q0.includes('.ton')) {
        const r = await resolveTonDomain(ctx, q0);
        if (!r?.addr) return err('домен не найден', 404);
        addr = r.addr;
      }
      const links = await telegramLinks(ctx, addr);
      return json({ ok: true, addr, links, resolvedNote });
    }

    // ---- watch ----
    if (path === '/watch' && req.method === 'POST') {
      const body = await req.json().catch(() => null) as { addr?: string; chain?: string; minUsd?: number } | null;
      if (!body?.addr) return err('нет addr');
      // №10 пороговые алерты: порог можно задать персонально для адреса
      // (по умолчанию — глобальный из настроек).
      const personal = typeof body.minUsd === 'number' && isFinite(body.minUsd) && body.minUsd >= 0 ? body.minUsd : undefined;
      const w = await addWatch(ctx, chatId, body.chain ?? 'tron', body.addr, personal ?? (await getSettings(ctx, chatId)).minAlertUsd);
      return json({ ok: true, watch: w });
    }
    if (path === '/watch-min' && req.method === 'POST') {
      const body = await req.json().catch(() => null) as { id?: number; minUsd?: number } | null;
      const id = body?.id ?? 0;
      const minUsd = body?.minUsd;
      if (!id || typeof minUsd !== 'number' || !isFinite(minUsd) || minUsd < 0) return err('нужны id и minUsd ≥ 0');
      const mine = await ctx.db.listWatches(chatId);
      if (!mine.some((w) => w.id === id)) return err('адрес не найден в твоём списке', 404);
      await ctx.db.updateWatchMinUsd(id, minUsd);
      return json({ ok: true });
    }
    if (path === '/watch' && req.method === 'DELETE') {
      const addr = url.searchParams.get('addr') ?? '';
      const mine = await ctx.db.listWatches(chatId);
      let removed = 0;
      for (const row of mine) {
        if (row.addr.toLowerCase() === addr.toLowerCase()) {
          await ctx.db.updateWatchState(row.id, row.lastStateJson ?? '{}', row.lastCheck ?? 0, false);
          removed++;
        }
      }
      return json({ ok: removed > 0, removed });
    }
    if (path === '/watchlist' && req.method === 'GET') {
      const mine = await ctx.db.listWatches(chatId);
      const events = await ctx.db.listWatchEvents(mine.map((w) => w.id), 30);
      return json({ ok: true, watches: mine.filter((w) => w.active), events });
    }

    // ---- history ----
    if (path === '/history' && req.method === 'GET') {
      const checks = await ctx.db.listChecks(chatId, 30);
      return json({ ok: true, checks });
    }

    // ---- settings ----
    if (path === '/settings' && req.method === 'GET') {
      return json({ ok: true, settings: await getSettings(ctx, chatId), quota: { quick: ctx.cfg.quotaQuick, deep: ctx.cfg.quotaDeep, aml: ctx.cfg.quotaAml, watches: ctx.cfg.quotaWatches } });
    }
    if (path === '/settings' && req.method === 'POST') {
      const body = await req.json().catch(() => null) as Record<string, unknown> | null;
      if (body) await updateSettings(ctx, chatId, body);
      return json({ ok: true, settings: await getSettings(ctx, chatId) });
    }

    // ---- run monitor pass manually (useful for testing) ----
    if (path === '/monitor-run' && req.method === 'POST') {
      const r = await monitorCycle(ctx, deps.registry);
      return json({ ok: true, checked: r.checked, alerts: r.alerts.length });
    }

    // ---- №12 share: публичная ссылка «только чтение» на снимок отчёта (KV, TTL 7 дней) ----
    if (path === '/share' && req.method === 'POST') {
      const body = await req.json().catch(() => null) as { report?: WalletReport } | null;
      if (!body?.report?.chains?.length) return err('нет отчёта');
      const js = JSON.stringify(body.report);
      if (js.length > 500_000) return err('отчёт слишком большой для ссылки');
      const token = crypto.randomUUID().replace(/-/g, '').slice(0, 20);
      await ctx.kv.put(`share:${token}`, js, 604800);
      return json({ ok: true, url: `${url.origin}/r/${token}` });
    }

    return err('неизвестный эндпоинт', 404);
  } catch (e) {
    await ctx.db.addErrorLog('api', String((e as Error).message));
    return err('внутренняя ошибка: ' + (e as Error).message.slice(0, 120), 500);
  }
}

async function authUser(req: Request, ctx: AppCtx): Promise<AuthedReq | null> {
  const initData = req.headers.get('x-init-data') ?? '';
  const data = await validateInitData(initData, ctx.cfg.botToken);
  if (!data?.user?.id) return null;
  return { chatId: data.user.id, username: data.user.username };
}
