// Живая проверка безключевого пути коллектора: реальные публичные RPC
// (llamarpc/bsc-dataseed/polygon-rpc), три round-robin прохода, строки в MemoryDB.
import { makeSandbox } from './sandbox.ts';
import { collectMixerIndex } from '../worker/src/engine/mixindex.ts';

const { ctx } = makeSandbox();
(ctx.cfg as { etherscanKey: string }).etherscanKey = ''; // прод-режим: без ключа
for (const i of [1, 2, 3]) {
  const st = await collectMixerIndex(ctx).catch((e) => `ERROR ${String(e)}`);
  console.log(`run${i}:`, st);
}
for (const chain of ['eth', 'bsc', 'polygon']) console.log(`rows ${chain}:`, await ctx.db.mixerDepositCount(chain));
const src = await ctx.db.listAmlSources(500);
console.log('mixer sources:', src.filter((r) => r.source.startsWith('mixer:')).length);
