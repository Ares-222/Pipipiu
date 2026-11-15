// EVM adapter family (eth/bsc/polygon/op/arb/base).
// Free-verified reality (2026-11-14, curl):
//   Etherscan V2 free works for chainid 1 (eth), 137 (polygon), 42161 (arb).
//   chainid 56 (bsc), 10 (op), 8453 (base) -> "Free API access is not supported".
//   => bsc/op/base run in rpc-only mode (balances + tx-by-hash; no history on free tier),
//      honest partial:true. No paid APIs.

import type { ChainAdapter, Tx, TxPage, Page, Account, TokenBalance } from '../core/types.ts';
import { EVM_CHAINID, CHAINS } from '../core/types.ts';
import type { AppCtx } from '../core/ctx.ts';
import { fetchJson } from '../core/http.ts';
import { toNum, lower } from '../core/util.ts';

const ES = 'https://api.etherscan.io/v2/api';

const RPC_URL: Record<string, string> = {
  bsc: 'https://bsc-dataseed.binance.org',
  op: 'https://mainnet.optimism.io',
  base: 'https://mainnet.base.org',
  eth: 'https://eth.llamarpc.com',
  polygon: 'https://polygon-rpc.com',
  arb: 'https://arb1.arbitrum.io/rpc',
};

export const ETHERSCAN_FREE_CHAINS: string[] = ['eth', 'polygon', 'arb'];

export function detectEvmAddr(s: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(s.trim());
}

interface EsTxListRow {
  blockNumber: string; timeStamp: string; hash: string; from: string; to: string | null;
  value: string; gasUsed: string; gasPrice: string; isError?: string; contractAddress?: string;
  function_name?: string;
}
interface EsTokenRow {
  timeStamp: string; hash: string; from: string; to: string; value: string;
  tokenSymbol: string; tokenDecimal: string; contractAddress: string;
}

export class EvmAdapter implements ChainAdapter {
  chain: 'eth' | 'bsc' | 'polygon' | 'op' | 'arb' | 'base';
  private ctx: AppCtx;
  private etherscanMode: boolean;

  constructor(chain: 'eth' | 'bsc' | 'polygon' | 'op' | 'arb' | 'base', ctx: AppCtx) {
    this.chain = chain;
    this.ctx = ctx;
    this.etherscanMode = ETHERSCAN_FREE_CHAINS.includes(chain);
  }

  detect(addr: string): boolean {
    return detectEvmAddr(addr);
  }

  private async es(params: Record<string, string>): Promise<{ status: string; result: unknown }> {
    const chainid = EVM_CHAINID[this.chain];
    const q = new URLSearchParams({ chainid: String(chainid), apikey: this.ctx.cfg.etherscanKey, ...params });
    return fetchJson<{ status: string; result: unknown }>(`${ES}?${q.toString()}`, {
      provider: `etherscan:${this.chain}`, breaker: this.ctx.breaker,
    });
  }

  private async rpc(method: string, params: unknown[]): Promise<unknown> {
    const res = await fetchJson<{ result?: unknown; error?: unknown }>(RPC_URL[this.chain], {
      provider: `rpc:${this.chain}`,
      breaker: this.ctx.breaker,
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    });
    return res.result;
  }

  async account(addr: string): Promise<Account> {
    const info = CHAINS[this.chain];
    if (this.etherscanMode) {
      const r = await this.es({ module: 'account', action: 'balance', address: addr, tag: 'latest' });
      const wei = toNum(String(r.result));
      return {
        chain: this.chain, addr,
        balanceNative: wei / 1e18,
        tokens: [],
        provider: 'etherscan',
        providers: ['etherscan'],
      };
    }
    // rpc-only chains
    const hex = await this.rpc('eth_getBalance', [addr, 'latest']) as string;
    const wei = BigInt(hex ?? '0x0');
    return {
      chain: this.chain, addr,
      balanceNative: Number(wei) / 1e18,
      tokens: [],
      provider: 'public-rpc',
      partial: true,
      providers: ['public-rpc'],
    };
  }

  async tokens(addr: string): Promise<TokenBalance[]> {
    if (!this.etherscanMode) return [];
    const r = await this.es({
      module: 'account', action: 'tokentx', address: addr,
      startblock: '0', endblock: '99999999', page: '1', offset: '200', sort: 'desc',
    });
    const rows = (Array.isArray(r.result) ? r.result : []) as EsTokenRow[];
    if (rows.length === 0 || (typeof r.result === 'string' && /rate/i.test(r.result))) return [];
    // Aggregate by contract: net balance from transfers is unreliable; show seen tokens with total volume.
    const agg = new Map<string, TokenBalance>();
    for (const t of rows) {
      const key = t.contractAddress.toLowerCase();
      const cur = agg.get(key) ?? {
        symbol: t.tokenSymbol || 'TOKEN',
        contract: t.contractAddress,
        amount: 0,
        decimals: parseInt(t.tokenDecimal || '18', 10) || 18,
      };
      cur.amount += toNum(t.value) / 10 ** (parseInt(t.tokenDecimal || '18', 10) || 18);
      agg.set(key, cur);
    }
    return [...agg.values()].slice(0, 25);
  }

  async transactions(addr: string, page?: Page): Promise<TxPage> {
    const target = lower(addr); // EVM addresses are case-insensitive; normalize once
    if (!this.etherscanMode) {
      // Honest degradation: rpc-only chains have no free history source.
      return { txs: [], partial: true, providers: ['public-rpc'] };
    }
    const offset = Math.min(page?.limit ?? 100, 100);
    const providers: string[] = [];
    const txs: Tx[] = [];
    let partial = false;

    let rows: EsTxListRow[] = [];
    let tok: EsTokenRow[] = [];
    try {
      const r = await this.es({
        module: 'account', action: 'txlist', address: addr,
        startblock: '0', endblock: '99999999', page: '1', offset: String(offset), sort: 'desc',
      });
      rows = Array.isArray(r.result) ? (r.result as EsTxListRow[]) : [];
      providers.push(`etherscan:${this.chain}`);
    } catch { partial = true; }
    try {
      const r = await this.es({
        module: 'account', action: 'tokentx', address: addr,
        startblock: '0', endblock: '99999999', page: '1', offset: String(offset), sort: 'desc',
      });
      tok = Array.isArray(r.result) ? (r.result as EsTokenRow[]) : [];
    } catch { partial = true; }

    for (const t of rows) {
      const from = lower(t.from);
      const to = lower(t.to ?? '');
      const dir = to === target && from === target ? 'self' : to === target ? 'in' : from === target ? 'out' : 'self';
      txs.push({
        hash: t.hash,
        chain: this.chain,
        ts: parseInt(t.timeStamp, 10),
        from, to,
        amount: toNum(t.value) / 1e18,
        asset: CHAINS[this.chain].native,
        fee: (toNum(t.gasUsed) * toNum(t.gasPrice)) / 1e18,
        direction: dir,
        kind: 'tx',
      });
    }
    for (const t of tok) {
      const from = lower(t.from);
      const to = lower(t.to);
      const dir = to === target && from === target ? 'self' : to === target ? 'in' : from === target ? 'out' : 'self';
      txs.push({
        hash: t.hash,
        chain: this.chain,
        ts: parseInt(t.timeStamp, 10),
        from, to,
        amount: toNum(t.value) / 10 ** (parseInt(t.tokenDecimal || '18', 10) || 18),
        asset: t.tokenSymbol || 'TOKEN',
        contract: lower(t.contractAddress),
        fee: 0,
        direction: dir,
        kind: 'token',
      });
    }
    txs.sort((a, b) => b.ts - a.ts);
    return { txs, partial, providers };
  }

  async tx(hash: string): Promise<Tx | null> {
    if (!this.etherscanMode) {
      try {
        const raw = await this.rpc('eth_getTransactionByHash', [hash]) as Record<string, string> | null;
        if (!raw || !raw.from) return null;
        return {
          hash, chain: this.chain, ts: 0,
          from: lower(raw.from), to: lower(raw.to ?? ''),
          amount: Number(BigInt(raw.value ?? '0x0')) / 1e18,
          asset: CHAINS[this.chain].native,
          fee: 0, direction: 'in', kind: 'tx',
        };
      } catch { return null; }
    }
    const r = await this.es({ module: 'proxy', action: 'eth_getTransactionByHash', txhash: hash });
    const raw = r.result as Record<string, string> | null;
    if (!raw || !raw.from) return null;
    let ts = 0;
    try {
      const b = await this.es({ module: 'proxy', action: 'eth_getBlockByNumber', tag: raw.blockNumber, boolean: 'false' });
      const blk = b.result as Record<string, string> | null;
      if (blk?.timestamp) ts = Number(BigInt(blk.timestamp));
    } catch { /* ts unknown */ }
    const from = lower(raw.from);
    const to = lower(raw.to ?? '');
    return {
      hash, chain: this.chain, ts,
      from, to,
      amount: Number(BigInt(raw.value ?? '0x0')) / 1e18,
      asset: CHAINS[this.chain].native,
      fee: (toNum(raw.gas ?? '0') * toNum(raw.gasPrice ?? '0')) / 1e18,
      direction: from === addrOf(hash) ? 'out' : 'in',
      kind: 'tx',
    };
  }

  async priceUsd(): Promise<number | undefined> {
    const sym = CHAINS[this.chain].native;
    return this.ctx.prices.priceBySymbol(sym);
  }
}

// helper to avoid circular ctx in tx(): direction relative to nothing — neutral 'in'
function addrOf(_hash: string): string { return ''; }
