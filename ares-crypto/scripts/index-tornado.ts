// Mixer deposit/withdrawal indexer (spec §9, §11.4) — Etherscan V2 logs API
// (free, full archive; publicnode prunes history, drpc limits ranges — measured).
//
// Verified Tornado Cash ETH instance proxies (etherscan eth_getCode > 0, 2026-11-14):
//   0.1 ETH  0x12D66f87A04A9E220743712CE6D9bB1B5616B8Fc
//   1 ETH    0x47CE0C6eD5B0Ce3d3A51fdb1C52DC66a7c3c2936
//   10 ETH   0x910cbd523d972eb0a6f4cae4618ad62622b39dbf
//   100 ETH  0xA160cdAB225685dA1d56aa342Ad8841c3b53f291
//
// Verified event semantics (Etherscan getabi + keccak cross-check, 2026-11-14):
//   Deposit(bytes32 commitment, uint32 leafIndex, uint256 timestamp)
//     topic0 = 0xa945e51eec50ab98c161376f0db4cf2aeba3ec92755fe2fcd388bdbbb80ff196
//     -> NO depositor in the event: depositor = tx.from (extra tx fetch per deposit)
//   Withdrawal(address to, bytes32 nullifierHash, address relayer, uint256 fee)
//     topic0 = 0xe9e508bad6d4c3227e881ca19068f099da81b5164dd6d62b2eaf1e8bc6c34931
//     -> withdrawer = first data word (relayer/fee are indexed, NOT the withdrawer)
//
// Rows in tx_deposits: 'd:<txhash>' = deposit (addr = depositor), 'w:<txhash>' = withdrawal.
// Run: node scripts/index-tornado.ts [fromBlock] [chunks]   (default: 14980000, 7)

import { makeSandbox } from './sandbox.ts';
import { fetchJson } from '../worker/src/core/http.ts';

const ES = 'https://api.etherscan.io/v2/api';
const TOPIC_DEPOSIT = '0xa945e51eec50ab98c161376f0db4cf2aeba3ec92755fe2fcd388bdbbb80ff196';
const TOPIC_WITHDRAW = '0xe9e508bad6d4c3227e881ca19068f099da81b5164dd6d62b2eaf1e8bc6c34931';
const PROXIES: { addr: string; nominal: number }[] = [
  { addr: '0x12d66f87a04a9e220743712ce6d9bb1b5616b8fc', nominal: 0.1 },
  { addr: '0x47ce0c6ed5b0ce3d3a51fdb1c52dc66a7c3c2936', nominal: 1 },
  { addr: '0x910cbd523d972eb0a6f4cae4618ad62622b39dbf', nominal: 10 },
  { addr: '0xa160cdab225685da1d56aa342ad8841c3b53f291', nominal: 100 },
];

interface LogRow { address: string; topics: string[]; blockNumber: string; transactionHash: string; timeStamp: string; data: string; }

async function getLogs(key: string, address: string, fromBlock: number, toBlock: number): Promise<LogRow[]> {
  const r = await fetchJson<{ status: string; result: LogRow[] | string }>(
    `${ES}?chainid=1&module=logs&action=getLogs&fromBlock=${fromBlock}&toBlock=${toBlock}&address=${address}&apikey=${key}`,
    { provider: 'etherscan:logs', timeoutMs: 25000 },
  );
  return Array.isArray(r.result) ? r.result : [];
}

async function txFrom(key: string, hash: string): Promise<string> {
  const r = await fetchJson<{ result: { from: string } | null }>(
    `${ES}?chainid=1&module=proxy&action=eth_getTransactionByHash&txhash=${hash}&apikey=${key}`,
    { provider: 'etherscan:proxy', timeoutMs: 15000 },
  );
  return r.result?.from?.toLowerCase() ?? '';
}

async function main() {
  const { ctx } = makeSandbox();
  const key = ctx.cfg.etherscanKey;
  const fromBlock = process.argv[2] ? parseInt(process.argv[2], 10) : 14980000;
  const chunks = process.argv[3] ? parseInt(process.argv[3], 10) : 7;
  const chunkSize = 300;
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  console.log(`ARES mixer indexer: from ${fromBlock}, ${chunks} chunks of ${chunkSize} per proxy`);

  for (const proxy of PROXIES) {
    console.log(`\nproxy ${proxy.addr} (${proxy.nominal} ETH):`);
    let dCount = 0, wCount = 0;
    for (let i = 0; i < chunks; i++) {
      const start = fromBlock + i * chunkSize;
      const logs = await getLogs(key, proxy.addr, start, start + chunkSize - 1).catch(() => [] as LogRow[]);
      await sleep(350);
      const rows: { chain: string; contract: string; commitment: string; amount: number; ts: number; addr: string }[] = [];
      for (const l of logs) {
        const t0 = l.topics?.[0];
        if (t0 === TOPIC_DEPOSIT) {
          const from = await txFrom(key, l.transactionHash).catch(() => '');
          await sleep(350);
          if (!from) continue;
          rows.push({ chain: 'eth', contract: proxy.addr, commitment: 'd:' + l.transactionHash, amount: proxy.nominal, ts: parseInt(l.timeStamp, 16), addr: from });
        } else if (t0 === TOPIC_WITHDRAW) {
          // withdrawer = first data word (20-byte address, left-padded)
          const who = '0x' + (l.data?.slice(2, 66) ?? '').slice(-40);
          rows.push({ chain: 'eth', contract: proxy.addr, commitment: 'w:' + l.transactionHash, amount: proxy.nominal, ts: parseInt(l.timeStamp, 16), addr: who });
        }
      }
      if (rows.length) {
        await ctx.db.upsertMixerDeposits(rows);
        dCount += rows.filter((r) => r.commitment.startsWith('d:')).length;
        wCount += rows.filter((r) => r.commitment.startsWith('w:')).length;
      }
    }
    console.log(`  indexed: ${dCount} deposits, ${wCount} withdrawals`);
  }

  const now = Math.floor(Date.now() / 1000);
  await ctx.db.upsertAmlSources(PROXIES.map((p) => ({
    chain: 'eth', addr: p.addr, source: 'mixer:tornado:eth', severity: 'critical',
    ref: `Tornado Cash ${p.nominal} ETH instance`, updatedTs: now,
  })));
  console.log(`\ntotal in mixer index: ${await ctx.db.mixerDepositCount()} rows | aml_sources mixers: 4`);
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
