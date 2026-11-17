// Sandbox context: builds AppCtx with in-memory KV/DB from local .env.
// Used by all test scripts and dev-polling. Production uses worker-d1/worker-kv instead.

import { readFileSync, writeFileSync } from 'node:fs';
import { MemoryKV } from '../worker/src/core/kv.ts';
import { MemoryDB } from '../worker/src/core/db.ts';
import { CircuitBreaker } from '../worker/src/core/http.ts';
import { PriceService } from '../worker/src/core/prices.ts';
import { configFromEnv } from '../worker/src/core/ctx.ts';
import type { AppCtx } from '../worker/src/core/ctx.ts';
import { AdapterRegistry } from '../worker/src/adapters/registry.ts';

export function loadEnv(path = '/home/z/my-project/ares-crypto/.env'): Record<string, string> {
  const env: Record<string, string> = {};
  try {
    const txt = readFileSync(path, 'utf8');
    for (const line of txt.split('\n')) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m) env[m[1]] = m[2].trim();
    }
  } catch { /* .env optional */ }
  return env;
}

export interface Sandbox {
  ctx: AppCtx;
  registry: AdapterRegistry;
}

export function makeSandbox(): Sandbox {
  const env = { ...loadEnv(), ...process.env };
  const cfg = configFromEnv(env);
  const kv = new MemoryKV();
  const db = new MemoryDB();
  // cross-process persistence for sandbox tests (mixer index, labels, feeds):
  // ARES_DB_DUMP=/path/to/dump.json — load on start
  const dumpPath = env.ARES_DB_DUMP;
  if (dumpPath) {
    try {
      const data = JSON.parse(readFileSync(dumpPath, 'utf8')) as Record<string, unknown[]>;
      for (const [k, v] of Object.entries(data)) {
        if (Array.isArray((db as unknown as Record<string, unknown[]>)[k])) {
          (db as unknown as Record<string, unknown[]>)[k] = v;
        }
      }
    } catch { /* fresh db */ }
  }
  const breaker = new CircuitBreaker();
  const prices = new PriceService(kv);
  const ctx: AppCtx = {
    cfg,
    kv,
    db,
    breaker,
    prices,
    now: () => Math.floor(Date.now() / 1000),
    isOwner: (chatId: number) => chatId === cfg.adminId,
  };
  const registry = new AdapterRegistry(ctx);
  if (dumpPath) {
    process.on('exit', () => {
      const dbRec = db as unknown as Record<string, unknown[]>;
      const data: Record<string, unknown[]> = {};
      for (const key of ['labels', 'aml', 'deposits', 'clusters']) data[key] = dbRec[key] ?? [];
      writeFileSync(dumpPath, JSON.stringify(data));
    });
    // SIGTERM/SIGINT (timeout, Ctrl+C) по умолчанию убивают процесс без 'exit' —
    // превращаем их в graceful exit, чтобы дамп (метки/фиды) успел записаться.
    for (const sig of ['SIGTERM', 'SIGINT'] as const) {
      process.on(sig, () => process.exit(0));
    }
  }
  return { ctx, registry };
}

export function line(title: string): void {
  console.log(`\n=== ${title} ===`);
}
