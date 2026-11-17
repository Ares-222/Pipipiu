// Bitcoin adapter. Primary: blockstream.info Esplora (verified live in sandbox).
// Fallback: mempool.space Esplora-compatible API (unreachable from this sandbox IP,
// reachable from most customer networks — kept as fallback per spec §7).

import type { ChainAdapter, Tx, TxPage, Page, Account, TokenBalance } from '../core/types.ts';
import type { AppCtx } from '../core/ctx.ts';
import { fetchJson } from '../core/http.ts';
import { toNum } from '../core/util.ts';

const HOSTS = ['https://blockstream.info', 'https://mempool.space'];

export function detectBtcAddr(s: string): boolean {
  return /^(bc1[a-z0-9]{11,71}|[13][1-9A-HJ-NP-Za-km-z]{25,62})$/.test(s.trim());
}

interface EsploraAddress {
  chain_stats: { funded_txo_sum: number; spent_txo_sum: number; tx_count: number };
  mempool_stats: { funded_txo_sum: number; spent_txo_sum: number; tx_count: number };
}
interface EsploraVin { prevout?: { scriptpubkey_address?: string; value: number; scriptpubkey_type?: string } }
interface EsploraVout { scriptpubkey_address?: string; value: number }
interface EsploraTx {
  txid: string; fee: number;
  status: { confirmed: boolean; block_time?: number };
  vin: EsploraVin[];
  vout: EsploraVout[];
}

export class BtcAdapter implements ChainAdapter {
  chain = 'btc' as const;
  private ctx: AppCtx;

  constructor(ctx: AppCtx) {
    this.ctx = ctx;
  }

  detect(addr: string): boolean {
    return detectBtcAddr(addr);
  }

  private async es<T>(path: string): Promise<T> {
    let lastErr: unknown = null;
    for (const host of HOSTS) {
      try {
        return await fetchJson<T>(`${host}${path}`, { provider: host.includes('blockstream') ? 'blockstream' : 'mempool', breaker: this.ctx.breaker });
      } catch (e) { lastErr = e; }
    }
    throw lastErr instanceof Error ? lastErr : new Error('btc providers failed');
  }

  async account(addr: string): Promise<Account> {
    const a = await this.es<EsploraAddress>(`/api/address/${addr}`);
    const sats = (a.chain_stats.funded_txo_sum - a.chain_stats.spent_txo_sum)
      + (a.mempool_stats.funded_txo_sum - a.mempool_stats.spent_txo_sum);
    return {
      chain: 'btc', addr,
      balanceNative: sats / 1e8,
      tokens: [],
      txCount: a.chain_stats.tx_count + a.mempool_stats.tx_count,
      provider: HOSTS[0].includes('blockstream') ? 'blockstream' : 'mempool',
      providers: ['blockstream', 'mempool'],
    };
  }

  async tokens(_addr: string): Promise<TokenBalance[]> {
    return [];
  }

  async transactions(addr: string, page?: Page): Promise<TxPage> {
    const limit = Math.min(page?.limit ?? 50, 50);
    const raw = await this.es<EsploraTx[]>(`/api/address/${addr}/txs`);
    const providers = ['blockstream'];
    const txs: Tx[] = [];
    for (const t of raw.slice(0, limit)) {
      let received = 0, sent = 0;
      const senders: string[] = [];
      for (const vin of t.vin) {
        if (vin.prevout?.scriptpubkey_address === addr) {
          sent += vin.prevout.value;
          senders.push(addr);
        } else if (vin.prevout?.scriptpubkey_address) {
          senders.push(vin.prevout.scriptpubkey_address);
        }
      }
      let toOther = '';
      for (const v of t.vout) {
        if (v.scriptpubkey_address === addr) {
          received += v.value;
        } else if (!toOther && v.scriptpubkey_address) {
          toOther = v.scriptpubkey_address;
        }
      }
      if (received === 0 && sent === 0) continue; // unrelated tx (address in change only?) skip
      const dir = sent > 0 && received > 0 ? 'self' : sent > 0 ? 'out' : 'in';
      const counterparty = dir === 'in' ? (senders[0] ?? '') : toOther;
      txs.push({
        hash: t.txid,
        chain: 'btc',
        ts: t.status.confirmed ? (t.status.block_time ?? 0) : Math.floor(Date.now() / 1000),
        from: dir === 'in' ? counterparty : addr,
        to: dir === 'in' ? addr : counterparty,
        amount: (dir === 'out' ? sent : received) / 1e8,
        asset: 'BTC',
        fee: t.fee / 1e8,
        direction: dir,
        kind: 'tx',
      });
    }
    txs.sort((a, b) => b.ts - a.ts);
    return { txs, providers, partial: false };
  }

  async tx(hash: string): Promise<Tx | null> {
    try {
      const t = await this.es<EsploraTx>(`/api/tx/${hash}`);
      const inputs: string[] = [];
      const outs: { addr?: string; v: number }[] = [];
      for (const vin of t.vin) if (vin.prevout?.scriptpubkey_address) inputs.push(vin.prevout.scriptpubkey_address);
      for (const v of t.vout) {
        const o = outs.find((x) => x.addr === v.scriptpubkey_address);
        if (o) o.v += v.value;
        else outs.push({ addr: v.scriptpubkey_address, v: v.value });
      }
      const main = outs.sort((a, b) => b.v - a.v)[0];
      const from = inputs.sort((a, b) => inputs.filter((x) => x === a).length - inputs.filter((x) => x === b).length)[0] ?? '';
      return {
        hash, chain: 'btc',
        ts: t.status.confirmed ? (t.status.block_time ?? 0) : Math.floor(Date.now() / 1000),
        from, to: main?.addr ?? '',
        amount: (main?.v ?? 0) / 1e8,
        asset: 'BTC',
        fee: t.fee / 1e8,
        direction: 'in',
        kind: 'tx',
      };
    } catch {
      return null;
    }
  }

  async priceUsd(): Promise<number | undefined> {
    return this.ctx.prices.priceBySymbol('BTC');
  }
}

export function toBtc(sats: number): number { return toNum(sats) / 1e8; }
