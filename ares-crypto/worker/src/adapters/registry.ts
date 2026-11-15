// AdapterRegistry: all chain adapters + probe resolution for input detection.

import type { ChainAdapter, ChainId, TxPage, Account, Page } from '../core/types.ts';
import type { AppCtx } from '../core/ctx.ts';
import type { ProbeRegistry } from '../core/detect.ts';
import { TronAdapter } from './tron.ts';
import { TonAdapter } from './ton.ts';
import { EvmAdapter, detectEvmAddr } from './evm.ts';
import { BtcAdapter } from './btc.ts';
import { SolAdapter } from './sol.ts';

const EVM_SET: ('eth' | 'bsc' | 'polygon' | 'op' | 'arb' | 'base')[] = ['eth', 'bsc', 'polygon', 'op', 'arb', 'base'];

export class AdapterRegistry implements ProbeRegistry {
  private ctx: AppCtx;
  private map: Map<ChainId, ChainAdapter> = new Map();

  constructor(ctx: AppCtx) {
    this.ctx = ctx;
    this.map.set('tron', new TronAdapter(ctx));
    this.map.set('ton', new TonAdapter(ctx));
    for (const c of EVM_SET) this.map.set(c, new EvmAdapter(c, ctx));
    this.map.set('btc', new BtcAdapter(ctx));
    this.map.set('sol', new SolAdapter(ctx));
  }

  get(chain: ChainId): ChainAdapter | undefined {
    return this.map.get(chain);
  }

  list(): ChainAdapter[] {
    return [...this.map.values()];
  }

  // Light probe "address exists on chain" with hard timeout (spec §6.2, 3 s).
  async probe(chain: ChainId, addr: string, timeoutMs = 3000): Promise<boolean> {
    const a = this.map.get(chain);
    if (!a) return false;
    const run = async (): Promise<boolean> => {
      try {
        if (a.probe) return await a.probe(addr);
        const acc = await a.account(addr);
        // TronGrid returns empty data for unactivated address — not "exists".
        if (chain === 'tron') return (acc.balanceNative ?? 0) > 0 || (acc.txCount ?? 0) > 0 || acc.createdAt !== undefined;
        if (chain === 'ton') return true; // tonapi returns uninit status as valid response — treat format-valid as candidate
        if (a instanceof EvmAdapter) return true; // any 0x addr is valid on EVM
        if (chain === 'btc') return (acc.txCount ?? 0) > 0 || (acc.balanceNative ?? 0) > 0;
        return true;
      } catch {
        return false;
      }
    };
    return withTimeout(run(), timeoutMs, false);
  }

  // tx probe: does this hash exist on chain (spec §6: 64-hex ambiguity).
  async probeTx(chain: ChainId, hash: string, timeoutMs = 3000): Promise<boolean> {
    const a = this.map.get(chain);
    if (!a) return false;
    const run = async (): Promise<boolean> => {
      try { return (await a.tx(hash)) !== null; } catch { return false; }
    };
    return withTimeout(run(), timeoutMs, false);
  }

  // Detect matrix for pure-format resolution.
  detectFormatChains(addr: string): ChainId[] {
    if (detectEvmAddr(addr)) return [...EVM_SET];
    return [];
  }

  async account(chain: ChainId, addr: string): Promise<Account> {
    const a = this.map.get(chain);
    if (!a) throw new Error(`no adapter for ${chain}`);
    return a.account(addr);
  }

  async transactions(chain: ChainId, addr: string, page?: Page): Promise<TxPage> {
    const a = this.map.get(chain);
    if (!a) throw new Error(`no adapter for ${chain}`);
    return a.transactions(addr, page);
  }

  async tx(chain: ChainId, hash: string): Promise<Awaited<ReturnType<ChainAdapter['tx']>>> {
    const a = this.map.get(chain);
    if (!a) return null;
    return a.tx(hash);
  }

  async tokens(chain: ChainId, addr: string): Promise<import('../core/types.ts').TokenBalance[]> {
    const a = this.map.get(chain);
    if (!a) return [];
    return a.tokens ? a.tokens(addr) : [];
  }

  async nfts(chain: ChainId, addr: string): Promise<import('../core/types.ts').Nft[]> {
    const a = this.map.get(chain);
    if (!a) return [];
    return a.nfts ? a.nfts(addr) : [];
  }

  async price(chain: ChainId): Promise<number | undefined> {
    const a = this.map.get(chain);
    if (!a) return undefined;
    return a.priceUsd();
  }
}

async function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    p.catch(() => fallback),
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}
