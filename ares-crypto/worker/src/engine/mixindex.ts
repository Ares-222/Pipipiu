// Крон-коллектор индекса миксеров (v6, ограничение: лимиты Cloudflare).
// Каждый запуск */5 обрабатывает ОДНУ цепь (round-robin): ≤ 4 getLogs + ≤ 4
// txFrom + ≤ 8 block-timestamps + 1 blockNumber — умещается в бюджет подзапросов
// воркера рядом с monitor-проходом.
// Два режима: c ETHERSCAN_KEY — Etherscan V2 (stable, ~1500 вызовов/день);
// без ключа (прод по умолчанию) — безключевые публичные JSON-RPC из RPC_URL
// (те же эндпоинты, что у адаптеров проекта). Чекпоинты в KV, события в D1
// tx_deposits (INSERT OR IGNORE — дубли безопасны).
// Семантика событий сверена по getabi/keccak (см. scripts/index-tornado.ts):
//   Deposit(bytes32,uint32,uint256) — депонент НЕ в событии, берётся tx.from;
//   Withdrawal(address,bytes32,address,uint256) — выводящий = первое data-слово.

import { normAddr } from '../core/types.ts';
import { fetchJson } from '../core/http.ts';
import type { AppCtx } from '../core/ctx.ts';

const ES = 'https://api.etherscan.io/v2/api';
const TOPIC_DEPOSIT = '0xa945e51eec50ab98c161376f0db4cf2aeba3ec92755fe2fcd388bdbbb80ff196';
const TOPIC_WITHDRAW = '0xe9e508bad6d4c3227e881ca19068f099da81b5164dd6d62b2eaf1e8bc6c34931';

// Безключевые RPC — списки с фолбэком (первый доступный из эфгресса CF;
// cloudflare-eth.com — официальный шлюз Cloudflare, стабилен из воркеров).
const RPC_URLS: Record<string, string[]> = {
  eth: ['https://cloudflare-eth.com', 'https://eth.llamarpc.com', 'https://ethereum-rpc.publicnode.com'],
  bsc: ['https://bsc-dataseed.binance.org', 'https://bsc-rpc.publicnode.com'],
  polygon: ['https://polygon-rpc.com', 'https://polygon-bor-rpc.publicnode.com'],
};

interface LogRow { address: string; topics: string[]; blockNumber: string; timeStamp: string; transactionHash: string; data: string; }

// Инстансы Tornado Cash Classic. ETH — проверено вживую (eth_getCode > 0,
// 2026-11-14, scripts/index-tornado.ts). BSC/Polygon — официальный список
// деплойментов docs.tornadocash.eth.limo/general/deployments.html (открыт 17.11);
// адрес 100 MATIC совпадает с 100 BNB — один CREATE2-деплой на несколько сетей.
export const TORNADO_INSTANCES: { chain: string; chainId: number; addr: string; nominal: number }[] = [
  { chain: 'eth', chainId: 1, addr: '0x12d66f87a04a9e220743712ce6d9bb1b5616b8fc', nominal: 0.1 },
  { chain: 'eth', chainId: 1, addr: '0x47ce0c6ed5b0ce3d3a51fdb1c52dc66a7c3c2936', nominal: 1 },
  { chain: 'eth', chainId: 1, addr: '0x910cbd523d972eb0a6f4cae4618ad62622b39dbf', nominal: 10 },
  { chain: 'eth', chainId: 1, addr: '0xa160cdab225685da1d56aa342ad8841c3b53f291', nominal: 100 },
  { chain: 'bsc', chainId: 56, addr: '0x84443cfd09a48af6ef360c6976c5392ac5023a1f', nominal: 0.1 },
  { chain: 'bsc', chainId: 56, addr: '0xd47438c816c9e7f2e2888e060936a499af9582b3', nominal: 1 },
  { chain: 'bsc', chainId: 56, addr: '0x330bfdade01ee9bf63c209ee33102dd334618e0a', nominal: 10 },
  { chain: 'bsc', chainId: 56, addr: '0x1e34a77868e19a6647b1f2f47b51ed72dede95dd', nominal: 100 },
  { chain: 'polygon', chainId: 137, addr: '0x1e34a77868e19a6647b1f2f47b51ed72dede95dd', nominal: 100 },
  { chain: 'polygon', chainId: 137, addr: '0xdf231d99ff8b6c6cbf4e9b9a45cbacef9339178', nominal: 1000 },
  { chain: 'polygon', chainId: 137, addr: '0xaf4c0b70b2ea9fb7487c7cbb37aada259579fe040', nominal: 10000 },
  { chain: 'polygon', chainId: 137, addr: '0xa5c2254e4253490c54cef0a4347fddb8f75a4998', nominal: 100000 },
];

const CHUNK = 300;          // безопасный диапазон getLogs для free-ключа/публичных RPC
const DEP_CAP = 4;          // максимум txFrom-запросов за один запуск
const TS_CAP = 8;           // максимум eth_getBlockByNumber за запуск (RPC-режим)
const INIT_LOOKBACK = 3000; // стартовое окно наблюдения ≈ 10 ч ETH-блоков

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const hex = (n: number) => '0x' + n.toString(16);

async function esLogs(key: string, chainId: number, address: string, from: number, to: number): Promise<LogRow[]> {
  const r = await fetchJson<{ status: string; result: LogRow[] | string }>(
    `${ES}?chainid=${chainId}&module=logs&action=getLogs&fromBlock=${from}&toBlock=${to}&address=${address}&apikey=${key}`,
    { provider: 'etherscan:logs', timeoutMs: 25000, retries: 1 },
  );
  return Array.isArray(r.result) ? r.result : [];
}

// POST на первый доступный RPC цепи: ошибка текущего эндпоинта → следующий.
async function rpcCall<T>(chain: string, method: string, params: unknown[], provider: string): Promise<T> {
  let lastErr: unknown = null;
  for (const url of RPC_URLS[chain] ?? []) {
    try {
      const res = await fetchJson<{ result?: T; error?: unknown }>(url, {
        provider, timeoutMs: 20000, retries: 1,
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      });
      return res.result as T;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr ?? new Error(`no rpc endpoint for ${chain}`);
}

// Безключевой путь: eth_getLogs + eth_getBlockByNumber для таймстампов
// (JSON-RPC eth_getLogs, в отличие от Etherscan API, поле timeStamp не отдаёт).
async function rpcLogs(chain: string, address: string, from: number, to: number, tsBudget: { left: number }): Promise<LogRow[]> {
  const raw = await rpcCall<{ address: string; topics: string[]; blockNumber: string; transactionHash: string; data: string }[]>(
    chain, 'eth_getLogs', [{ address, fromBlock: hex(from), toBlock: hex(to) }], `rpc:logs:${chain}`,
  );
  const tsCache = new Map<number, number>();
  const out: LogRow[] = [];
  for (const l of raw ?? []) {
    const blk = parseInt(l.blockNumber, 16);
    let ts = tsCache.get(blk);
    if (ts === undefined) {
      if (tsBudget.left <= 0) { out.push({ ...l, timeStamp: '0' }); continue; }
      tsBudget.left--;
      const b = await rpcCall<{ timestamp?: string }>(chain, 'eth_getBlockByNumber', [hex(blk), false], `rpc:block:${chain}`).catch(() => null);
      ts = b?.timestamp ? parseInt(b.timestamp, 16) : 0;
      tsCache.set(blk, ts);
    }
    out.push({ ...l, timeStamp: hex(ts || 0) });
  }
  return out;
}

async function latestBlockOf(chain: string, key: string, chainId: number): Promise<number> {
  if (key) {
    const r = await fetchJson<{ result: string }>(
      `${ES}?chainid=${chainId}&module=proxy&action=eth_blockNumber&apikey=${key}`,
      { provider: 'etherscan:proxy', timeoutMs: 15000, retries: 1 },
    );
    return parseInt(r.result, 16);
  }
  return parseInt(await rpcCall<string>(chain, 'eth_blockNumber', [], `rpc:latest:${chain}`), 16);
}

async function txSenderOf(chain: string, key: string, chainId: number, hash: string): Promise<string> {
  if (key) {
    const r = await fetchJson<{ result: { from: string } | null }>(
      `${ES}?chainid=${chainId}&module=proxy&action=eth_getTransactionByHash&txhash=${hash}&apikey=${key}`,
      { provider: 'etherscan:proxy', timeoutMs: 15000, retries: 1 },
    );
    return r.result?.from?.toLowerCase() ?? '';
  }
  const t = await rpcCall<{ from?: string } | null>(chain, 'eth_getTransactionByHash', [hash], `rpc:tx:${chain}`).catch(() => null);
  return t?.from?.toLowerCase() ?? '';
}

// Возвращает короткий статус для журнала; null — тихий успешный проход.
export async function collectMixerIndex(ctx: AppCtx): Promise<string | null> {
  const key = ctx.cfg.etherscanKey;
  const chains = [...new Set(TORNADO_INSTANCES.map((i) => i.chain))];
  const rr = parseInt((await ctx.kv.get('mixidx:rr')) ?? '0', 10) || 0;
  await ctx.kv.put('mixidx:rr', String(rr + 1));
  const chain = chains[rr % chains.length];
  const insts = TORNADO_INSTANCES.filter((i) => i.chain === chain);
  const chainId = insts[0].chainId;

  // Первичная регистрация миксеров в aml_sources (одна цепь — один раз).
  if ((await ctx.kv.get(`mixidx:reg:${chain}`)) !== '1') {
    const now = Math.floor(Date.now() / 1000);
    await ctx.db.upsertAmlSources(insts.map((i) => ({
      chain, addr: i.addr, source: `mixer:tornado:${chain}`, severity: 'critical',
      ref: `Tornado Cash Classic ${i.nominal} (${chain.toUpperCase()})`, updatedTs: now,
    })));
    await ctx.kv.put(`mixidx:reg:${chain}`, '1');
  }

  const latest = await latestBlockOf(chain, key, chainId);
  let dCount = 0, wCount = 0, depBudget = DEP_CAP;
  const tsBudget = { left: TS_CAP };

  for (const inst of insts) {
    const ckKey = `mixidx:${chainId}:${inst.addr}`;
    let from = parseInt((await ctx.kv.get(ckKey)) ?? '0', 10);
    if (!from) {
      from = Math.max(1, latest - INIT_LOOKBACK); // первое включение: окно ~10 ч
    }
    if (from >= latest) continue; // ничего нового
    const to = Math.min(latest, from + CHUNK);
    const logs = key
      ? await esLogs(key, chainId, inst.addr, from, to).catch(() => [] as LogRow[])
      : await rpcLogs(chain, inst.addr, from, to, tsBudget).catch(() => [] as LogRow[]);
    const rows: { chain: string; contract: string; commitment: string; amount: number; ts: number; addr?: string }[] = [];
    const depHashes: string[] = [];
    let lastBlock = from;

    for (const l of logs) {
      const blk = parseInt(l.blockNumber, 16);
      if (blk > lastBlock) lastBlock = blk;
      const ts = parseInt(l.timeStamp, 16);
      const t0 = l.topics?.[0];
      if (t0 === TOPIC_WITHDRAW) {
        // выводящий = первое data-слово (20-байтный адрес, выровнен вправо)
        const who = '0x' + (l.data?.slice(2, 66) ?? '').slice(-40);
        rows.push({ chain, contract: inst.addr, commitment: 'w:' + l.transactionHash, amount: inst.nominal, ts, addr: normAddr(chain, who) });
        wCount++;
      } else if (t0 === TOPIC_DEPOSIT) {
        depHashes.push(l.transactionHash);
      }
    }

    // Депонент берётся из транзакции (событие его не содержит) — по бюджету.
    let processed = 0;
    for (const h of depHashes) {
      if (depBudget <= 0) break;
      depBudget--;
      await sleep(220); // публичные API: пауза между личными вызовами
      const from_ = await txSenderOf(chain, key, chainId, h).catch(() => '');
      if (!from_) continue;
      const log = logs.find((l) => l.transactionHash === h && l.topics?.[0] === TOPIC_DEPOSIT);
      if (!log) continue;
      const ts = parseInt(log.timeStamp, 16);
      if (!ts) continue; // таймстамп блока не получен — повторим в следующий проход
      rows.push({ chain, contract: inst.addr, commitment: 'd:' + h, amount: inst.nominal, ts, addr: normAddr(chain, from_) });
      dCount++;
      processed++;
    }

    if (rows.length) await ctx.db.upsertMixerDeposits(rows);
    // Чекпоинт двигаем только когда все депозиты обработаны — иначе
    // интервал пересканируется в следующий запуск (INSERT OR IGNORE безопасен).
    if (processed === depHashes.length) {
      await ctx.kv.put(ckKey, String(Math.max(lastBlock, to)));
    }
    if (depBudget <= 0) break;
  }

  if (dCount || wCount) return `${chain}: +${dCount} депозитов, +${wCount} выводов в индекс миксеров (${key ? 'etherscan' : 'public rpc'})`;
  return null;
}
