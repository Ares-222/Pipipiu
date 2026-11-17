// User quotas (spec §19): quick 40/day, trace 5/day, aml 40/day, watches 5.
// Admin — unlimited. Quota day = UTC date. Stored in users table.

import type { AppCtx } from '../core/ctx.ts';
import type { UserRow } from '../core/db.ts';

export type QuotaKind = 'quick' | 'deep' | 'aml';

export async function getUser(ctx: AppCtx, chatId: number, tgUsername?: string): Promise<UserRow> {
  let u = await ctx.db.getUser(chatId);
  const day = new Date(ctx.now() * 1000).toISOString().slice(0, 10);
  if (!u) {
    u = {
      chatId,
      tgUsername,
      createdTs: ctx.now(),
      quotaDay: day,
      quickUsed: 0, deepUsed: 0, amlUsed: 0, watchesUsed: 0,
      settingsJson: JSON.stringify({ minAlertUsd: 10, traceDepth: ctx.cfg.traceDefaultDepth }),
    };
    await ctx.db.upsertUser(u);
    return u;
  }
  if (u.quotaDay !== day) {
    u = { ...u, quotaDay: day, quickUsed: 0, deepUsed: 0, amlUsed: 0, watchesUsed: 0 };
    await ctx.db.upsertUser(u);
  }
  return u;
}

export async function checkQuota(ctx: AppCtx, chatId: number, kind: QuotaKind): Promise<{ ok: boolean; left: number; resetLocal: string }> {
  if (ctx.isOwner(chatId)) return { ok: true, left: 999, resetLocal: '00:00 UTC' };
  const u = await getUser(ctx, chatId);
  const limit = kind === 'quick' ? ctx.cfg.quotaQuick : kind === 'deep' ? ctx.cfg.quotaDeep : ctx.cfg.quotaAml;
  const used = kind === 'quick' ? u.quickUsed : kind === 'deep' ? u.deepUsed : u.amlUsed;
  const left = Math.max(0, limit - used);
  const tomorrow = new Date((ctx.now() + 86400) * 1000).toISOString().slice(0, 10);
  return { ok: left > 0, left, resetLocal: tomorrow };
}

export async function incQuota(ctx: AppCtx, chatId: number, kind: QuotaKind): Promise<void> {
  if (ctx.isOwner(chatId)) return;
  const u = await getUser(ctx, chatId);
  if (kind === 'quick') u.quickUsed += 1;
  else if (kind === 'deep') u.deepUsed += 1;
  else u.amlUsed += 1;
  await ctx.db.upsertUser(u);
}

export async function updateSettings(ctx: AppCtx, chatId: number, patch: Record<string, unknown>): Promise<void> {
  const u = await getUser(ctx, chatId);
  const cur = JSON.parse(u.settingsJson ?? '{}') as Record<string, unknown>;
  await ctx.db.upsertUser({ ...u, settingsJson: JSON.stringify({ ...cur, ...patch }) });
}

export async function getSettings(ctx: AppCtx, chatId: number): Promise<{ minAlertUsd: number; traceDepth: number }> {
  const u = await getUser(ctx, chatId);
  const s = JSON.parse(u.settingsJson ?? '{}') as { minAlertUsd?: number; traceDepth?: number };
  return { minAlertUsd: s.minAlertUsd ?? 10, traceDepth: s.traceDepth ?? ctx.cfg.traceDefaultDepth };
}

export function quotaText(kind: QuotaKind, left: number, resetLocal: string): string {
  const names: Record<QuotaKind, string> = { quick: 'быстрых отчётов', deep: 'расследований', aml: 'AML-проверок' };
  return `Дневной лимит ${names[kind]} исчерпан. Осталось: 0. Обновится ${resetLocal} (UTC). Бесплатные квоты — защита лимитов провайдеров, не жадность.`;
}
