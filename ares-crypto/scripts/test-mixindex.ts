// Локальная проверка крон-коллектора mixindex: один round-robin проход с
// реальным Etherscan (ключ из .env), строки в MemoryDB sandbox.
import { makeSandbox } from './sandbox.ts';
import { collectMixerIndex } from '../worker/src/engine/mixindex.ts';

const { ctx } = makeSandbox();
const st = await collectMixerIndex(ctx);
console.log('status:', st);
console.log('rows in index:', await ctx.db.mixerDepositCount());
for (const chain of ['eth', 'bsc', 'polygon']) console.log(`  ${chain}:`, await ctx.db.mixerDepositCount(chain));
const eth = await ctx.db.getMixerDeposits('eth', '0xa160cdab225685da1d56aa342ad8841c3b53f291', 0, Math.floor(Date.now() / 1000));
console.log('sample 100ETH rows:', eth.slice(0, 3).map((r) => `${r.commitment.slice(0, 14)}… amt=${r.amount} addr=${r.addr?.slice(0, 10)}`));
