// Application context: config + injected infrastructure (kv, db, breaker, prices).
// Engines and adapters depend only on this — the Worker and the sandbox
// dev-polling script both construct it with their own implementations.

import type { KVLike } from './kv.ts';
import type { DBLike } from './db.ts';
import type { CircuitBreaker } from './http.ts';
import type { PriceService } from './prices.ts';

export interface Config {
  botToken: string;
  adminId: number;
  etherscanKey: string;
  trongridKey: string;
  toncenterKey: string;
  githubToken?: string;
  openrouterKey?: string;     // AI-комментарий (/ai): ключ OpenRouter, модель бесплатная
  openrouterModel?: string;   // фиксировать модель (иначе авто-выбор из free-списка)
  webhookSecret?: string;
  miniappUrl?: string;
  // quotas per user per day (spec §19)
  quotaQuick: number;      // 40
  quotaDeep: number;       // 5
  quotaAml: number;        // 40
  quotaWatches: number;    // 5
  traceMaxDepth: number;   // 4
  traceDefaultDepth: number; // 2
}

export const DEFAULT_CONFIG: Omit<Config, 'botToken' | 'adminId' | 'etherscanKey' | 'trongridKey'> = {
  toncenterKey: '',
  quotaQuick: 40,
  quotaDeep: 5,
  quotaAml: 40,
  quotaWatches: 5,
  traceMaxDepth: 4,
  traceDefaultDepth: 2,
};

export function configFromEnv(env: Record<string, string | undefined>): Config {
  const cfg: Config = {
    botToken: env.BOT_TOKEN ?? '',
    adminId: parseInt(env.ADMIN_ID ?? '0', 10) || 0,
    etherscanKey: env.ETHERSCAN_KEY ?? '',
    trongridKey: env.TRONGRID_KEY ?? '',
    toncenterKey: env.TONCENTER_KEY ?? '',
    githubToken: env.GITHUB_TOKEN || undefined,
    openrouterKey: env.OPENROUTER_API_KEY || undefined,
    openrouterModel: env.OPENROUTER_MODEL || undefined,
    webhookSecret: env.TG_WEBHOOK_SECRET || undefined,
    miniappUrl: env.MINIAPP_URL || undefined,
    quotaQuick: DEFAULT_CONFIG.quotaQuick,
    quotaDeep: DEFAULT_CONFIG.quotaDeep,
    quotaAml: DEFAULT_CONFIG.quotaAml,
    quotaWatches: DEFAULT_CONFIG.quotaWatches,
    traceMaxDepth: DEFAULT_CONFIG.traceMaxDepth,
    traceDefaultDepth: DEFAULT_CONFIG.traceDefaultDepth,
  };
  return cfg;
}

export interface AppCtx {
  cfg: Config;
  kv: KVLike;
  db: DBLike;
  breaker: CircuitBreaker;
  prices: PriceService;
  now(): number;
  isOwner(chatId: number): boolean;
}
