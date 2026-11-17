// Quota smoke test (spec §19): 40 quick/day for non-admin; admin unlimited.
// Run: node scripts/test-quota.ts

import { makeSandbox } from './sandbox.ts';
import { checkQuota, incQuota } from '../worker/src/engine/quota.ts';

const { ctx } = makeSandbox();

async function main() {
  console.log('ARES CRYPTO — QUOTA TEST (§19: quick 40/day, admin — без лимитов)');
  const user = 111111111;

  // exhaust the quick quota
  let blocked = -1;
  for (let i = 0; i < 45; i++) {
    const q = await checkQuota(ctx, user, 'quick');
    if (!q.ok) { blocked = i; break; }
    await incQuota(ctx, user, 'quick');
  }
  console.log(`blocked on attempt ${blocked + 1} (expected 41st = after 40 used) -> ${blocked === 40 ? 'OK' : 'FAIL'}`);

  // admin unlimited
  const admin = ctx.cfg.adminId;
  let adminOk = true;
  for (let i = 0; i < 50; i++) {
    const q = await checkQuota(ctx, admin, 'quick');
    if (!q.ok) { adminOk = false; break; }
    await incQuota(ctx, admin, 'quick');
  }
  console.log(`admin 50 checks -> ${adminOk ? 'OK (unlimited)' : 'FAIL'}`);

  // deep + aml quotas
  await ctx.db.upsertUser({ chatId: 222, createdTs: 0, quotaDay: 'old', quickUsed: 0, deepUsed: 5, amlUsed: 0, watchesUsed: 0, quotaDayOld: undefined } as never).catch(() => { /* noop */ });
  const qd = await checkQuota(ctx, 222, 'deep');
  console.log(`deep quota after day rollover: left=${qd.left} (expected 5 — сброс на новый день: ${qd.left === 5 ? 'OK' : 'FAIL'})`);
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
