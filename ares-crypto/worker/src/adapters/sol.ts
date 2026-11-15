// Solana adapter — basic support on public mainnet-beta RPC (strict anonymous limits).
// account: getBalance + getTokenAccountsByOwner (2 fetches).
// transactions: getSignaturesForAddress(limit) + parse last N transactions (N fetches).
// Honest partial:true — deep profiling on free Solana RPC is not feasible.

import type { ChainAdapter, Tx, TxPage, Page, Account, TokenBalance } from '../core/types.ts';
import type { AppCtx } from '../core/ctx.ts';
import { fetchJson } from '../core/http.ts';
import { toNum, lower } from '../core/util.ts';

const RPC = 'https://api.mainnet-beta.solana.com';
const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';

interface RpcResp<T> { result?: T; error?: unknown }

export function detectSolAddr(s: string): boolean {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s.trim());
}

export class SolAdapter implements ChainAdapter {
  chain = 'sol' as const;
  private ctx: AppCtx;

  constructor(ctx: AppCtx) {
    this.ctx = ctx;
  }

  detect(addr: string): boolean {
    return detectSolAddr(addr);
  }

  private async rpc<T>(method: string, params: unknown[]): Promise<T> {
    const r = await fetchJson<RpcResp<T>>(RPC, {
      provider: 'solana-rpc',
      breaker: this.ctx.breaker,
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    });
    if (r.error) throw new Error(`solana rpc error: ${JSON.stringify(r.error).slice(0, 200)}`);
    return r.result as T;
  }

  // getBalance returns { context, value }
  private async getBalanceNano(addr: string): Promise<number> {
    const r = await this.rpc<{ value: number }>('getBalance', [addr]);
    return r?.value ?? 0;
  }

  async account(addr: string): Promise<Account> {
    const nano = await this.getBalanceNano(addr);
    return {
      chain: 'sol', addr,
      balanceNative: nano / 1e9,
      tokens: [],
      provider: 'solana-rpc',
      partial: true,
      providers: ['solana-rpc'],
    };
  }

  async tokens(addr: string): Promise<TokenBalance[]> {
    try {
      const r = await this.rpc<{
        value: { account: { data: { parsed: { info: { mint: string; tokenAmount: { uiAmount: number; decimals: number } } } } } }[];
      }>('getTokenAccountsByOwner', [addr, { programId: TOKEN_PROGRAM }, { encoding: 'jsonParsed' }]);
      const out: TokenBalance[] = [];
      const mints = new Map<string, TokenBalance>();
      for (const v of r?.value ?? []) {
        const info = v.account?.data?.parsed?.info;
        if (!info || !info.tokenAmount?.uiAmount) continue;
        const cur = mints.get(info.mint) ?? { symbol: `SPL:${info.mint.slice(0, 6)}`, contract: info.mint, amount: 0, decimals: info.tokenAmount.decimals };
        cur.amount += info.tokenAmount.uiAmount;
        mints.set(info.mint, cur);
      }
      out.push(...mints.values());
      return out;
    } catch {
      return [];
    }
  }

  async transactions(addr: string, page?: Page): Promise<TxPage> {
    const limit = Math.min(page?.limit ?? 10, 15);
    const sigs = await this.rpc<{ signature: string; blockTime?: number; err: unknown }[]>(
      'getSignaturesForAddress', [addr, { limit }],
    );
    const txs: Tx[] = [];
    const providers = ['solana-rpc'];
    for (const s of sigs) {
      if (s.err) continue;
      try {
        const t = await this.rpc<{
          blockTime?: number;
          meta?: {
            fee: number;
            preBalances: number[];
            postBalances: number[];
            preTokenBalances?: { accountIndex: number; mint: string; owner?: string; uiTokenAmount: { uiAmount: number; decimals: number } }[];
            postTokenBalances?: { accountIndex: number; mint: string; owner?: string; uiTokenAmount: { uiAmount: number; decimals: number } }[];
          };
          transaction?: { message?: { accountKeys?: (string | { pubkey: string })[] } };
        }>('getTransaction', [s.signature, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 }]);
        const meta = t.meta;
        const keys = (t.transaction?.message?.accountKeys ?? []).map((k) => lower(typeof k === 'string' ? k : k.pubkey));
        const idx = keys.indexOf(lower(addr));
        if (!meta || idx < 0) continue;
        const delta = (meta.postBalances[idx] - meta.preBalances[idx] + meta.fee) / 1e9; // exclude own fee effect
        // find main counterparty by balance change
        let cpIdx = -1, cpDelta = 0;
        for (let i = 0; i < keys.length; i++) {
          if (i === idx) continue;
          const d = (meta.postBalances[i] - meta.preBalances[i]);
          if (Math.abs(d) > Math.abs(cpDelta)) { cpDelta = d; cpIdx = i; }
        }
        if (Math.abs(delta) < 1e-9) continue;
        const dir = delta > 0 ? 'in' : 'out';
        txs.push({
          hash: s.signature,
          chain: 'sol',
          ts: s.blockTime ?? 0,
          from: dir === 'in' ? (cpIdx >= 0 ? keys[cpIdx] : '') : addr,
          to: dir === 'in' ? addr : (cpIdx >= 0 ? keys[cpIdx] : ''),
          amount: Math.abs(delta) - (dir === 'out' ? 0 : 0),
          asset: 'SOL',
          fee: meta.fee / 1e9,
          direction: dir,
          kind: 'tx',
        });
      } catch { /* skip single tx */ }
    }
    txs.sort((a, b) => b.ts - a.ts);
    return { txs, providers, partial: true };
  }

  async tx(hash: string): Promise<Tx | null> {
    try {
      const t = await this.rpc<{ blockTime?: number; meta?: { fee: number; preBalances: number[]; postBalances: number[] }; transaction?: { message?: { accountKeys?: (string | { pubkey: string })[] } } }>(
        'getTransaction', [hash, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 }],
      );
      const meta = t.meta;
      const keys = (t.transaction?.message?.accountKeys ?? []).map((k) => lower(typeof k === 'string' ? k : k.pubkey));
      if (!meta) return null;
      const payer = keys[0] ?? '';
      const amounts = keys.map((k, i) => (meta.postBalances[i] - meta.preBalances[i]) / 1e9);
      let cpIdx = -1, cpDelta = 0;
      for (let i = 1; i < keys.length; i++) {
        if (Math.abs(amounts[i]) > Math.abs(cpDelta)) { cpDelta = amounts[i]; cpIdx = i; }
      }
      return {
        hash, chain: 'sol', ts: t.blockTime ?? 0,
        from: payer, to: cpIdx >= 0 ? keys[cpIdx] : '',
        amount: Math.abs(cpDelta),
        asset: 'SOL', fee: meta.fee / 1e9,
        direction: 'in', kind: 'tx',
      };
    } catch {
      return null;
    }
  }

  async priceUsd(): Promise<number | undefined> {
    return this.ctx.prices.priceBySymbol('SOL');
  }
}

export function _unused(v: number): number { return toNum(v); }
export function _lower(a: string): string { return lower(a); }
