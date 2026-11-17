// Проверка крон-коллектора на мок-ответах Etherscan: full-путь (KV-чекпоинты,
// парсинг логов, txFrom, INSERT-строки, round-robin цепей) без внешних вызовов.
import { makeSandbox } from './sandbox.ts';
import { collectMixerIndex, TORNADO_INSTANCES } from '../worker/src/engine/mixindex.ts';

const LATEST = 21000000;
const DEP_HASH = '0xdeadbeef' + '1'.repeat(56);
const dep1 = TORNADO_INSTANCES.find((i) => i.chain === 'eth' && i.nominal === 10)!;

const realFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = (async (url: string | URL) => {
  const u = String(url);
  if (!u.includes('api.etherscan.io')) return realFetch(u);
  if (u.includes('eth_blockNumber')) return Response.json({ status: '1', result: '0x' + LATEST.toString(16) });
  if (u.includes('getLogs')) {
    const from = parseInt(u.match(/fromBlock=(\d+)/)![1], 10);
    if (from > LATEST - 100) return Response.json({ status: '1', result: [] });
    if (u.includes(dep1.addr.slice(2, 10))) {
      return Response.json({ status: '1', result: [
        { address: dep1.addr, topics: [ '0xa945e51eec50ab98c161376f0db4cf2aeba3ec92755fe2fcd388bdbbb80ff196', '0xc1', '0x2' ], blockNumber: '0x' + (LATEST - 50).toString(16), timeStamp: '0x673a0000', transactionHash: DEP_HASH, data: '0x0' },
        { address: dep1.addr, topics: [ '0xe9e508bad6d4c3227e881ca19068f099da81b5164dd6d62b2eaf1e8bc6c34931' ], blockNumber: '0x' + (LATEST - 40).toString(16), timeStamp: '0x673a0100', transactionHash: '0xwith1' + '2'.repeat(56), data: '0x' + '0'.repeat(24) + '9f9f9f9f9f9f9f9f9f9f9f9f9f9f9f9f9f9f9f9f' + '0'.repeat(64) },
      ] });
    }
    return Response.json({ status: '1', result: [] });
  }
  if (u.includes('eth_getTransactionByHash')) return Response.json({ status: '1', result: { from: '0xDeP11111111111111111111111111111111111111' } });
  return Response.json({ status: '0', result: 'unexpected ' + u.slice(0, 80) });
}) as typeof fetch;

const { ctx } = makeSandbox();
(ctx.cfg as { etherscanKey: string }).etherscanKey = 'mock-key'; // локальный мок-ключ
const st1 = await collectMixerIndex(ctx); // eth-проход
console.log('run1:', st1);
const st2 = await collectMixerIndex(ctx); // bsc: пусто → null
console.log('run2:', st2);
const st3 = await collectMixerIndex(ctx); // polygon: пусто → null
console.log('run3:', st3);
const rows = await ctx.db.getMixerDeposits('eth', dep1.addr, 0, 9e12);
console.log('eth 10ETH rows:', rows.length, rows.map((r) => r.commitment.slice(0, 16)).join(' | '));
console.log('deposit addr:', rows.find((r) => r.commitment.startsWith('d:'))?.addr);
console.log('withdrawal addr:', rows.find((r) => r.commitment.startsWith('w:'))?.addr);
const reg = await ctx.db.listAmlSources(500);
console.log('mixer sources registered:', reg.filter((r) => r.source.startsWith('mixer:')).length);
if (st1?.includes('+1 депозитов, +1 выводов') && rows.length === 2) console.log('COLLECTOR OK');
else { console.error('COLLECTOR FAIL'); process.exit(1); }
