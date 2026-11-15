// REST API for the Telegram Mini App (spec §15). Auth: Telegram initData
// (HMAC by bot token, official scheme) in the `x-init-data` header — no passwords.

import type { AppCtx } from '../core/ctx.ts';
import type { AdapterRegistry } from '../adapters/registry.ts';
import { validateInitData } from '../core/tgauth.ts';
import { buildWalletReport, buildTxCard } from '../service/report.ts';
import { runTrace } from '../engine/tracer.ts';
import { addWatch, monitorCycle } from '../engine/monitor.ts';
import { getUser, getSettings, updateSettings, checkQuota, incQuota, quotaText } from '../engine/quota.ts';
import { telegramLinks, resolveTelegram, resolveTonDomain } from '../engine/tonosint.ts';

export interface ApiDeps {
  ctx: AppCtx;
  registry: AdapterRegistry;
  sendPhoto: (chatId: number, jpegBytes: Uint8Array, caption?: string) => Promise<void>;
  sendDocument: (chatId: number, bytes: Uint8Array, filename: string, caption?: string) => Promise<void>;
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
    if (path === '/report' && req.method === 'GET') {
      const addr = url.searchParams.get('addr') ?? '';
      const q = await checkQuota(ctx, chatId, 'quick');
      if (!q.ok) return err(quotaText('quick', q.left, q.resetLocal), 429);
      const rep = await buildWalletReport(ctx, deps.registry, addr);
      await incQuota(ctx, chatId, 'quick');
      await ctx.db.addCheck({ chatId, input: addr, chain: rep.chains[0]?.chain ?? '', verdict: `${rep.verdict.score}/100`, createdTs: ctx.now(), summaryJson: JSON.stringify({ from: 'miniapp' }) });
      return json({ ok: true, report: rep });
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
    if (path === '/graph' && req.method === 'GET') {
      const addr = url.searchParams.get('addr') ?? '';
      const chain = url.searchParams.get('chain') ?? '';
      const depth = Math.min(parseInt(url.searchParams.get('depth') ?? '2', 10) || 2, ctx.cfg.traceMaxDepth);
      const q = await checkQuota(ctx, chatId, 'deep');
      if (!q.ok) return err(quotaText('deep', q.left, q.resetLocal), 429);
      const res = await runTrace(ctx, deps.registry, chain, addr, { depth, fetchBudget: 28 });
      await incQuota(ctx, chatId, 'deep');
      return json({ ok: true, trace: res });
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

    // ---- PDF upload (K7: client-side jsPDF -> worker -> sendDocument) ----
    if (path === '/pdf' && req.method === 'POST') {
      const body = await req.json().catch(() => null) as { pdf?: string; filename?: string; caption?: string } | null;
      if (!body?.pdf) return err('нет pdf');
      const b64 = body.pdf.includes(',') ? body.pdf.slice(body.pdf.indexOf(',') + 1) : body.pdf;
      const bin = Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
      await deps.sendDocument(chatId, bin, body.filename ?? 'ares-report.pdf', body.caption);
      return json({ ok: true });
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
      const body = await req.json().catch(() => null) as { addr?: string; chain?: string } | null;
      if (!body?.addr) return err('нет addr');
      const w = await addWatch(ctx, chatId, body.chain ?? 'tron', body.addr, (await getSettings(ctx, chatId)).minAlertUsd);
      return json({ ok: true, watch: w });
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
