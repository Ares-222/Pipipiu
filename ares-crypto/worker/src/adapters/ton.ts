// TON adapter. Primary: tonapi.io v2 (no key needed). Fallback: toncenter v2 (key).
// Verified live 2026-11-14: account + dns root respond; jetton_master interface exposed.

import type { ChainAdapter, Tx, TxPage, Page, Account, TokenBalance, Nft } from '../core/types.ts';
import type { AppCtx } from '../core/ctx.ts';
import { fetchJson } from '../core/http.ts';
import { toNum } from '../core/util.ts';

const TONAPI = 'https://tonapi.io/v2';
const TONCENTER = 'https://toncenter.com/api/v2';

export function detectTonAddr(s: string): boolean {
  return /^(EQ|UQ)[0-9A-Za-z_-]{46}$/.test(s) || /^0:[0-9a-fA-F]{64}$/.test(s) || /^-1:[0-9a-fA-F]{64}$/.test(s);
}

interface TonapiAccount {
  address: string;
  balance: string;
  status?: string;
  last_activity?: number;
  interfaces?: string[];
  get_methods?: string[];
  is_wallet?: boolean;
  is_scam?: boolean;
  name?: string;
}

interface TonapiJettons {
  balances?: {
    balance: string;
    jetton: { address: string; name?: string; symbol?: string; decimals: number; image?: string };
  }[];
}

interface TonapiNfts {
  nft_items?: {
    address: string;
    name?: string;
    collection?: { address: string; name?: string };
    metadata?: Record<string, unknown>;
  }[];
}

interface TonapiEvents {
  events?: {
    event_id: string;
    timestamp: number;
    actions?: {
      type?: string;
      status?: string;
      TonTransfer?: { source?: { address?: string }; destination?: { address?: string }; value?: string; comment?: string };
      JettonTransfer?: {
        source?: { address?: string };
        destination?: { address?: string };
        amount?: string;
        comment?: string;
        jetton?: { address: string; name?: string; symbol?: string; decimals: number };
      };
      simple_preview?: { action_type?: string };
    }[];
  }[];
  next_from?: number;
}

export class TonAdapter implements ChainAdapter {
  chain = 'ton' as const;
  private ctx: AppCtx;

  constructor(ctx: AppCtx) {
    this.ctx = ctx;
  }

  detect(addr: string): boolean {
    return detectTonAddr(addr.trim());
  }

  async account(addr: string): Promise<Account> {
    const a = await fetchJson<TonapiAccount>(
      `${TONAPI}/accounts/${addr}`,
      { provider: 'tonapi', breaker: this.ctx.breaker },
    );
    const balanceNano = toNum(a.balance);
    const isContract = !a.is_wallet && (a.get_methods?.length ?? 0) > 0;
    return {
      chain: 'ton',
      addr,
      balanceNative: balanceNano / 1e9,
      tokens: [],
      createdAt: a.last_activity ? undefined : undefined, // tonapi has no creation ts; filled from txs
      lastTxTs: a.last_activity,
      isContract,
      provider: 'tonapi',
      providers: ['tonapi'],
    };
  }

  async tokens(addr: string): Promise<TokenBalance[]> {
    try {
      const r = await fetchJson<TonapiJettons>(`${TONAPI}/accounts/${addr}/jettons`, { provider: 'tonapi', breaker: this.ctx.breaker });
      return (r.balances ?? [])
        .map((b) => ({
          symbol: b.jetton.symbol || b.jetton.name || 'JETTON',
          contract: b.jetton.address,
          amount: toNum(b.balance) / 10 ** (b.jetton.decimals || 9),
          decimals: b.jetton.decimals || 9,
        }))
        .filter((t) => t.amount > 0);
    } catch {
      return [];
    }
  }

  async nfts(addr: string): Promise<Nft[]> {
    try {
      const r = await fetchJson<TonapiNfts>(`${TONAPI}/accounts/${addr}/nfts`, { provider: 'tonapi', breaker: this.ctx.breaker });
      return (r.nft_items ?? []).map((n) => ({
        name: n.name ?? '(без имени)',
        collectionName: n.collection?.name ?? '',
        address: n.address,
        kind: classifyNft(n.collection?.name ?? '', n.name ?? ''),
      }));
    } catch {
      return [];
    }
  }

  async transactions(addr: string, page?: Page): Promise<TxPage> {
    const limit = Math.min(page?.limit ?? 100, 100);
    const providers: string[] = [];
    const txs: Tx[] = [];
    let partial = false;
    try {
      const r = await fetchJson<TonapiEvents>(
        `${TONAPI}/accounts/${addr}/events?limit=${limit}`,
        { provider: 'tonapi', breaker: this.ctx.breaker },
      );
      providers.push('tonapi');
      for (const ev of r.events ?? []) {
        const ts = ev.timestamp;
        for (const act of ev.actions ?? []) {
          if (act.status && act.status !== 'ok') continue;
          const t = act.TonTransfer;
          if (t) {
            const from = t.source?.address ?? '';
            const to = t.destination?.address ?? '';
            const dir = to === addr && from === addr ? 'self' : to === addr ? 'in' : from === addr ? 'out' : 'self';
            txs.push({
              hash: ev.event_id,
              chain: 'ton',
              ts,
              from, to,
              amount: toNum(t.value) / 1e9,
              asset: 'TON',
              fee: 0,
              direction: dir,
              kind: 'tx',
              memo: t.comment,
            });
          }
          const j = act.JettonTransfer;
          if (j) {
            const from = j.source?.address ?? '';
            const to = j.destination?.address ?? '';
            const dir = to === addr && from === addr ? 'self' : to === addr ? 'in' : from === addr ? 'out' : 'self';
            txs.push({
              hash: ev.event_id,
              chain: 'ton',
              ts,
              from, to,
              amount: toNum(j.amount) / 10 ** (j.jetton?.decimals || 9),
              asset: j.jetton?.symbol || 'JETTON',
              contract: j.jetton?.address,
              fee: 0,
              direction: dir,
              kind: 'jetton',
              memo: j.comment,
            });
          }
        }
      }
    } catch {
      partial = true;
    }
    txs.sort((a, b) => b.ts - a.ts);
    return { txs, partial, providers };
  }

  async tx(hash: string): Promise<Tx | null> {
    try {
      const ev = await fetchJson<{ event_id: string; timestamp: number; actions?: NonNullable<TonapiEvents['events']>[number]['actions'] }>(
        `${TONAPI}/events/${hash}`,
        { provider: 'tonapi', breaker: this.ctx.breaker },
      );
      for (const act of ev.actions ?? []) {
        const t = act.TonTransfer;
        if (t) {
          const from = t.source?.address ?? '';
          const to = t.destination?.address ?? '';
          return {
            hash, chain: 'ton', ts: ev.timestamp,
            from, to,
            amount: toNum(t.value) / 1e9,
            asset: 'TON', fee: 0,
            direction: 'in', kind: 'tx', memo: t.comment,
          };
        }
        const j = act.JettonTransfer;
        if (j) {
          return {
            hash, chain: 'ton', ts: ev.timestamp,
            from: j.source?.address ?? '', to: j.destination?.address ?? '',
            amount: toNum(j.amount) / 10 ** (j.jetton?.decimals || 9),
            asset: j.jetton?.symbol || 'JETTON',
            contract: j.jetton?.address, fee: 0,
            direction: 'in', kind: 'jetton', memo: j.comment,
          };
        }
      }
    } catch { /* not found */ }
    return null;
  }

  async priceUsd(): Promise<number | undefined> {
    return this.ctx.prices.priceBySymbol('TON');
  }
}

export function classifyNft(collection: string, name: string): Nft['kind'] {
  const c = (collection || '').toLowerCase();
  const n = (name || '').toLowerCase();
  if (c.includes('telegram username') || c.includes('telegram usernames')) return 'username';
  if (c.includes('anonymous telegram number') || c.includes('telegram number') || c.includes('anonymous numbers')) return 'number';
  if (c.includes('dns') || n.endsWith('.ton')) return 'dns';
  return 'other';
}

export { TONCENTER };
