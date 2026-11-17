// Cloudflare Worker entry: /tg-webhook + /api/* + scheduled (cron */5 + daily sync).
// Bindings: DB (D1), CACHE (KV), TRACER_DO / MONITOR_DO (Durable Objects).

import { configFromEnv } from './core/ctx.ts';
import type { AppCtx } from './core/ctx.ts';
import { CircuitBreaker } from './core/http.ts';
import { PriceService } from './core/prices.ts';
import { WorkerKV } from './worker-kv.ts';
import type { KVNamespaceLike } from './worker-kv.ts';
import { D1DB } from './worker-d1.ts';
import type { D1DatabaseLike } from './worker-d1.ts';
import { AdapterRegistry } from './adapters/registry.ts';
import { BotApi } from './tg/bot.ts';
import { handleUpdate } from './tg/router.ts';
import { handleApi } from './api/routes.ts';
import { monitorCycle } from './engine/monitor.ts';
import { syncOfac, syncScamSniffer, downloadOfac, downloadScamSniffer } from './engine/feeds.ts';
import type { TgUpdate } from './tg/bot-types.ts';
import { TracerDO } from './do/tracer-do.ts';
import { MonitorDO } from './do/monitor-do.ts';

// DO classes must be exported from the entry module for wrangler migrations.
export { TracerDO, MonitorDO };

export interface Env {
  DB: D1DatabaseLike;
  CACHE: KVNamespaceLike;
  TRACER_DO: DurableObjectNamespace;
  MONITOR_DO: DurableObjectNamespace;
  BOT_TOKEN: string;
  ADMIN_ID: string;
  ETHERSCAN_KEY: string;
  TRONGRID_KEY: string;
  TONCENTER_KEY?: string;
  GITHUB_TOKEN?: string;
  OPENROUTER_API_KEY?: string;   // AI-комментарий (/ai), модель бесплатная
  OPENROUTER_MODEL?: string;
  TG_WEBHOOK_SECRET?: string;
  MINIAPP_URL?: string;
}

function makeCtx(env: Env): AppCtx {
  const cfg = configFromEnv({
    BOT_TOKEN: env.BOT_TOKEN,
    ADMIN_ID: env.ADMIN_ID,
    ETHERSCAN_KEY: env.ETHERSCAN_KEY,
    TRONGRID_KEY: env.TRONGRID_KEY,
    TONCENTER_KEY: env.TONCENTER_KEY ?? '',
    GITHUB_TOKEN: env.GITHUB_TOKEN,
    OPENROUTER_API_KEY: env.OPENROUTER_API_KEY,
    OPENROUTER_MODEL: env.OPENROUTER_MODEL,
    TG_WEBHOOK_SECRET: env.TG_WEBHOOK_SECRET,
    MINIAPP_URL: env.MINIAPP_URL,
  });
  const kv = new WorkerKV(env.CACHE);
  const db = new D1DB(env.DB);
  const breaker = new CircuitBreaker();
  const prices = new PriceService(kv as never);
  return {
    cfg, kv, db, breaker, prices,
    now: () => Math.floor(Date.now() / 1000),
    isOwner: (chatId: number) => chatId === cfg.adminId,
  };
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const ctx = makeCtx(env);
    const api = new BotApi(ctx);
    const registry = new AdapterRegistry(ctx);

    // CORS preflight
    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type, x-init-data', 'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS' } });
    }

    // Telegram webhook (secret_token verified at the gateway level by CF route config;
    // also accept ?secret= for belt-and-braces)
    if (url.pathname === '/tg-webhook' && req.method === 'POST') {
      const secret = url.searchParams.get('secret') ?? req.headers.get('x-telegram-bot-api-secret-token') ?? '';
      if (ctx.cfg.webhookSecret && secret !== ctx.cfg.webhookSecret) {
        return new Response('forbidden', { status: 403 });
      }
      const update = await req.json() as TgUpdate;
      await handleUpdate({ ctx, registry, api, botUsername: undefined }, update);
      return new Response('ok');
    }

    if (url.pathname.startsWith('/api/')) {
      return handleApi(req, {
        ctx,
        registry,
        sendPhoto: async (chatId, jpeg, caption) => { await api.sendPhoto(chatId, jpeg, caption); },
        sendDocument: async (chatId, bytes, filename, caption) => { await api.sendDocument(chatId, bytes, filename, caption); },
      }, url);
    }

    if (url.pathname === '/healthz') {
      return new Response(JSON.stringify({ ok: true, ts: Date.now(), breaker: ctx.breaker.status() }), { headers: { 'content-type': 'application/json' } });
    }

    return new Response('ares crypto worker: /tg-webhook, /api/*, /healthz', { status: 404 });
  },

  // cron: */5 * * * * — monitor pass; 0 6 * * * — OFAC/scam-db sync (2 cron triggers ≤ 3 allowed)
  async scheduled(event: ScheduledEvent, env: Env): Promise<void> {
    const ctx = makeCtx(env);
    const api = new BotApi(ctx);
    const registry = new AdapterRegistry(ctx);

    if (event.cron === '0 6 * * *') {
      // daily feeds sync (spec §8.1)
      try {
        const csv = await downloadOfac();
        const r = await syncOfac(ctx.db, csv);
        const scam = await downloadScamSniffer();
        const s = await syncScamSniffer(ctx.db, scam);
        await api.sendMessage(ctx.cfg.adminId, ` syncing done: OFAC ${r.inserted}, ScamSniffer ${s}`).catch(() => { /* ignore */ });
      } catch (e) {
        await ctx.db.addErrorLog('cron-sync', String((e as Error).message));
      }
      return;
    }

    // monitor cycle (spec §12): batches of 15 via budget; more watches -> next alarm
    try {
      const r = await monitorCycle(ctx, registry, 15);
      for (const a of r.alerts) {
        await api.sendMessage(a.chatId, a.text).catch(() => { /* ignore */ });
      }
      // if more watches pending, re-schedule via DO alarm (spec §12 batching)
      const all = await ctx.db.listWatches();
      const active = all.filter((w) => w.active);
      if (active.length > 15) {
        const id = env.MONITOR_DO.idFromName('monitor');
        const stub = env.MONITOR_DO.get(id);
        await stub.fetch('https://do/continue', { method: 'POST', body: JSON.stringify({ offset: 15 }) });
      }
    } catch (e) {
      await ctx.db.addErrorLog('cron-monitor', String((e as Error).message));
    }
  },
};

// Durable Object types come from the runtime; declared here for TypeScript.
declare abstract class DurableObjectNamespace {
  idFromName(name: string): DurableObjectId;
  get(id: DurableObjectId): { fetch(url: string, init?: RequestInit): Promise<Response> };
}
declare abstract class DurableObjectId { toString(): string; }

// Cloudflare runtime type for scheduled handler (cron info)
interface ScheduledEvent { cron: string; scheduledTime: number; }
