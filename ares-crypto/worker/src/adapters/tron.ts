// TRON adapter. Primary: TronGrid API (key), fallback: Tronscan public API.
// Verified live 2026-11-14: both respond; trc20 endpoint returns token_info with decimals.

import type { ChainAdapter, Tx, TxPage, Page, Account, TokenBalance } from '../core/types.ts';
import type { AppCtx } from '../core/ctx.ts';
import { fetchJson } from '../core/http.ts';
import { hexToTronBase58, tronBase58ToHex, toNum, lower } from '../core/util.ts';
import { b58decode } from '../core/util.ts';

const TG = 'https://api.trongrid.io';
const TS = 'https://apilist.tronscanapi.com';

function tgHeaders(ctx: AppCtx): Record<string, string> {
  const h: Record<string, string> = { accept: 'application/json' };
  if (ctx.cfg.trongridKey) h['TRON-PRO-API-KEY'] = ctx.cfg.trongridKey;
  return h;
}

export function detectTronAddr(s: string): boolean {
  if (!/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(s)) return false;
  const dec = b58decode(s);
  return !!dec && dec.length === 25 && dec[0] === 0x41;
}

interface TronGridTxRaw {
  txID: string;
  block_timestamp: number;
  ret?: { contractRet?: string; fee?: number }[];
  raw_data: {
    contract: {
      type: string;
      parameter: {
        value: { amount?: number; owner_address?: string; to_address?: string; data?: string; contract_address?: string };
      };
    }[];
  };
}

interface Trc20Raw {
  transaction_id: string;
  token_info: { symbol: string; address: string; decimals: number; name: string };
  block_timestamp: number;
  from: string;
  to: string;
  type: string;
  value: string;
}

interface TronScanAccount {
  address?: string;
  balance?: number;
  create_time?: number;
  totalTransactionCount?: number;
  totalFrozenBalanceForAddress?: number;
  is_contract?: boolean;
  accountType?: string | number;   // measured: 2 (number) for contracts
  trc20token_balances?: { tokenId: string; balance: string; tokenAbbr: string; tokenDecimal: number }[];
  tags?: { name?: string; tagType?: string }[];
  identity?: { name?: string } | null;
}

export class TronAdapter implements ChainAdapter {
  chain = 'tron' as const;
  private ctx: AppCtx;

  constructor(ctx: AppCtx) {
    this.ctx = ctx;
  }

  detect(addr: string): boolean {
    return detectTronAddr(addr.trim());
  }

  // Light probe: walletsolidity/getaccount with visible:true + base58 returns a tiny
  // object even for huge contracts (full /v1/accounts payload can exceed 3s budget).
  // Measured: returns {} for unactivated addresses, type:"Contract" for contracts.
  async probe(addr: string): Promise<boolean> {
    const r = await fetchJson<{ address?: string; balance?: number; type?: string }>(
      `${TG}/walletsolidity/getaccount`,
      {
        provider: 'trongrid',
        breaker: this.ctx.breaker,
        method: 'POST',
        headers: { ...tgHeaders(this.ctx), 'content-type': 'application/json' },
        body: JSON.stringify({ address: addr, visible: true }),
        timeoutMs: 2800,
        retries: 0,
      },
    );
    return !!r && (r.address !== undefined || r.balance !== undefined || r.type !== undefined);
  }

  async account(addr: string): Promise<Account> {
    const acc = await fetchJson<{ data: Record<string, unknown>[]; success?: boolean }>(
      `${TG}/v1/accounts/${addr}`,
      { provider: 'trongrid', breaker: this.ctx.breaker, headers: tgHeaders(this.ctx) },
    );
    const d = acc.data?.[0] as Record<string, unknown> | undefined;
    const balanceSun = toNum(d?.balance as number | undefined);
    const createdAtMs = d?.create_time as number | undefined;

    // Enrich with Tronscan: contract flag, tx count, provider tags (official API fields).
    let scan: TronScanAccount | null = null;
    try {
      scan = await fetchJson<TronScanAccount>(
        `${TS}/api/account?address=${addr}`,
        { provider: 'tronscan', breaker: this.ctx.breaker, timeoutMs: 6000, retries: 0 },
      );
    } catch { /* enrichment optional */ }

    return {
      chain: 'tron',
      addr,
      balanceNative: balanceSun / 1e6,
      tokens: [],
      txCount: scan?.totalTransactionCount ?? undefined,
      createdAt: createdAtMs ? Math.floor(createdAtMs / 1000) : undefined,
      // measured: Tronscan accountType === 2 (number) or 'ContractAccount' for contracts;
      // TronGrid exposes data[0].type === 'Contract'
      isContract: scan?.is_contract === true
        || scan?.accountType === 2
        || scan?.accountType === 'ContractAccount'
        || d?.type === 'Contract'
        || false,
      provider: scan ? 'trongrid+tronscan' : 'trongrid',
      partial: !scan,
      providers: ['trongrid', 'tronscan'],
    };
  }

  async tokens(addr: string): Promise<TokenBalance[]> {
    // Tronscan gives full TRC-20 list with symbols (official API).
    try {
      const scan = await fetchJson<TronScanAccount>(
        `${TS}/api/account?address=${addr}`,
        { provider: 'tronscan', breaker: this.ctx.breaker },
      );
      const out: TokenBalance[] = (scan.trc20token_balances ?? [])
        .map((t) => ({ symbol: t.tokenAbbr || t.tokenId, contract: t.tokenId, amount: toNum(t.balance) / 10 ** (t.tokenDecimal || 6), decimals: t.tokenDecimal || 6 }))
        .filter((t) => t.amount > 0);
      return out;
    } catch {
      return [];
    }
  }

  async transactions(addr: string, page?: Page): Promise<TxPage> {
    const limit = Math.min(page?.limit ?? 200, 200);
    const providers: string[] = [];
    let txs: Tx[] = [];
    let partial = false;

    // native TRX transfers
    try {
      const r = await fetchJson<{ data: TronGridTxRaw[]; success?: boolean }>(
        `${TG}/v1/accounts/${addr}/transactions?limit=${limit}`,
        { provider: 'trongrid', breaker: this.ctx.breaker, headers: tgHeaders(this.ctx) },
      );
      providers.push('trongrid');
      for (const raw of r.data ?? []) {
        const c = raw.raw_data?.contract?.[0];
        if (!c || c.type !== 'TransferContract') continue;
        const from = await hexToTronBase58(c.parameter.value.owner_address ?? '');
        const to = await hexToTronBase58(c.parameter.value.to_address ?? '');
        if (!from || !to) continue;
        const dir = to === addr && from === addr ? 'self' : to === addr ? 'in' : from === addr ? 'out' : 'self';
        txs.push({
          hash: raw.txID,
          chain: 'tron',
          ts: Math.floor(raw.block_timestamp / 1000),
          from, to,
          amount: (c.parameter.value.amount ?? 0) / 1e6,
          asset: 'TRX',
          fee: 0,
          direction: dir,
          kind: 'tx',
        });
      }
    } catch {
      partial = true;
    }

    // TRC-20 transfers (USDT etc.)
    try {
      const r = await fetchJson<{ data: Trc20Raw[]; success?: boolean }>(
        `${TG}/v1/accounts/${addr}/transactions/trc20?limit=${limit}`,
        { provider: 'trongrid', breaker: this.ctx.breaker, headers: tgHeaders(this.ctx) },
      );
      for (const raw of r.data ?? []) {
        const dir = raw.to === addr && raw.from === addr ? 'self' : raw.to === addr ? 'in' : raw.from === addr ? 'out' : 'self';
        txs.push({
          hash: raw.transaction_id,
          chain: 'tron',
          ts: Math.floor(raw.block_timestamp / 1000),
          from: raw.from,
          to: raw.to,
          amount: toNum(raw.value) / 10 ** (raw.token_info.decimals || 6),
          asset: raw.token_info.symbol || 'TRC20',
          contract: raw.token_info.address,
          fee: 0,
          direction: dir,
          kind: 'token',
        });
      }
    } catch {
      partial = true;
    }

    // Fallback if TronGrid failed completely: Tronscan transfers API.
    if (txs.length === 0 && partial) {
      try {
        const r = await fetchJson<{ data: { transaction_id: string; block_ts: number; from: string; to: string; amount: number; tokenInfo?: { symbol: string; tokenId: string; decimals: number }; tokenName?: string; contract_type?: number; confirmed?: boolean }[]; total?: number }>(
          `${TS}/api/transfer?limit=${Math.min(limit, 50)}&start=0&sort=-timestamp&count=true&address=${addr}`,
          { provider: 'tronscan', breaker: this.ctx.breaker },
        );
        providers.push('tronscan');
        for (const raw of r.data ?? []) {
          const isToken = !!raw.tokenInfo;
          txs.push({
            hash: raw.transaction_id,
            chain: 'tron',
            ts: Math.floor(raw.block_ts / 1000),
            from: raw.from,
            to: raw.to,
            amount: isToken ? raw.amount / 10 ** (raw.tokenInfo?.decimals ?? 6) : raw.amount / 1e6,
            asset: isToken ? (raw.tokenInfo?.symbol ?? 'TRC20') : 'TRX',
            contract: isToken ? raw.tokenInfo?.tokenId : undefined,
            fee: 0,
            direction: raw.to === addr && raw.from === addr ? 'self' : raw.to === addr ? 'in' : 'out',
            kind: isToken ? 'token' : 'tx',
          });
        }
        partial = false;
      } catch { /* stay partial */ }
    }

    txs.sort((a, b) => b.ts - a.ts);
    return { txs, partial, providers };
  }

  async tx(hash: string): Promise<Tx | null> {
    // Tronscan transaction-info is the reliable single-hash lookup (official API).
    try {
      const r = await fetchJson<Record<string, unknown>>(
        `${TS}/api/transaction-info?hash=${hash}`,
        { provider: 'tronscan', breaker: this.ctx.breaker },
      );
      if (!r || r.hash) {
        const tokenInfo = r.tokenInfo as { symbol?: string; tokenId?: string; decimals?: number } | undefined;
        const amount = toNum(r.amount as number | string | undefined);
        const from = String(r.ownerAddress ?? '');
        const to = String(r.toAddress ?? '');
        const isToken = !!tokenInfo;
        return {
          hash,
          chain: 'tron',
          ts: Math.floor(toNum(r.timestamp as number | undefined) / 1000),
          from, to,
          amount: isToken ? amount / 10 ** (tokenInfo?.decimals ?? 6) : amount / 1e6,
          asset: isToken ? (tokenInfo?.symbol ?? 'TRC20') : 'TRX',
          contract: isToken ? tokenInfo?.tokenId : undefined,
          fee: toNum((r.cost as { fee?: number } | undefined)?.fee) / 1e6,
          direction: 'in',
          kind: isToken ? 'token' : 'tx',
        };
      }
    } catch { /* fallthrough */ }
    return null;
  }

  async priceUsd(): Promise<number | undefined> {
    return this.ctx.prices.priceBySymbol('TRX');
  }
}

// USDT TRC-20 contract (canonical, verified on-chain):
export const USDT_TRON = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
export function lowerA(a: string): string { return lower(a); }
