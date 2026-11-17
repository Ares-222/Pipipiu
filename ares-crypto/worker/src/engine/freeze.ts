// Live issuer-freeze check (Tether/USDC blacklists) — reads isBlackListed() straight
// from the token contracts, no list-syncing needed. Approach borrowed from GitHub
// research (2026-11-16): 0xBreak/SpiderAml (~11.6k frozen) and Niphridium/wallet-checker
// (USDT-TRC20 freeze check); both read contract state instead of maintaining lists.
//
// Measured from sandbox 2026-11-16 (probe-sources2/3/4.py):
//   TRON  triggerconstantcontract isBlackListed(address) -> proper ABI bool, no revert
//   ETH   eth_call 0xe47d6060  (keccak "isBlackListed(address)", Tether) -> proper bool
//   ETH   eth_call 0xfe575a87  (keccak "isBlacklisted(address)", USDC, lowercase 'l') -> proper bool
//   BSC   Binance-Pegged USDT has no working isBlackListed -> excluded.
// Result semantics: false does NOT mean "clean", only "not frozen by this issuer".

import type { AppCtx } from '../core/ctx.ts';
import { fetchJson } from '../core/http.ts';
import { cachedJson, KV_TTL } from '../core/kv.ts';
import { b58decode } from '../core/util.ts';

export const USDT_ETH = '0xdAC17F958D2ee523a2206206994597C13D831ec7';
export const USDC_ETH = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
export const USDT_TRON = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t'; // (same constant as adapters/tron.ts)

const SEL_USDT = '0xe47d6060'; // keccak("isBlackListed(address)")[:4]
const SEL_USDC = '0xfe575a87'; // keccak("isBlacklisted(address)")[:4]
const ETH_RPC = 'https://ethereum-rpc.publicnode.com';
const TRON_API = 'https://api.trongrid.io';

export interface FreezeStatus {
  frozen: boolean;
  asset: 'USDT' | 'USDC';
  chain: string;
  provider: string;
}

function abiAddrParam(base58OrHex: string, chain: string): string {
  if (chain === 'eth') return '0'.repeat(24) + base58OrHex.toLowerCase().replace(/^0x/, '');
  // TRON: base58 -> 25 bytes (0x41 + 20 + checksum); ABI param = 12 zero bytes + 0x41 + 20 bytes
  const dec = b58decode(base58OrHex);
  if (!dec || dec.length !== 25 || dec[0] !== 0x41) throw new Error('bad tron address');
  return '0'.repeat(24) + [...dec.slice(0, 21)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function boolFromWord(hex: string | undefined): boolean | null {
  if (!hex) return null;
  // eth_call: '0x' + 64 hex; trongrid constant_result: 64 hex БЕЗ '0x' (замер 2026-11-16)
  const w = hex.toLowerCase().replace(/^0x/, '');
  if (w.length !== 64 || !/^[0-9a-f]+$/.test(w)) return null;
  if (/^0*1$/.test(w)) return true;
  if (/^0+$/.test(w)) return false;
  return null;
}

async function ethCallBool(to: string, data: string, ctx: AppCtx): Promise<boolean | null> {
  const res = await fetchJson<{ result?: string; error?: unknown }>(ETH_RPC, {
    provider: 'rpc:eth-freeze', breaker: ctx.breaker, timeoutMs: 7000, retries: 1,
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to, data }, 'latest'] }),
  });
  return boolFromWord(res?.result);
}

async function tronCallBool(addr: string, ctx: AppCtx): Promise<boolean | null> {
  const r = await fetchJson<{ constant_result?: string[]; result?: unknown }>(
    `${TRON_API}/wallet/triggerconstantcontract`,
    {
      provider: 'trongrid-freeze', breaker: ctx.breaker, timeoutMs: 8000, retries: 1,
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        owner_address: addr,
        contract_address: USDT_TRON,
        function_selector: 'isBlackListed(address)',
        parameter: abiAddrParam(addr, 'tron'),
        visible: true,
      }),
    },
  );
  return boolFromWord(r?.constant_result?.[0]);
}

// All issuer freezes known for this chain. null = chain unsupported / all providers failed.
export async function checkIssuerFreeze(ctx: AppCtx, chain: string, addr: string): Promise<FreezeStatus[] | null> {
  const norm = chain === 'eth' ? addr.toLowerCase() : addr;
  const key = `fz:${chain}:${norm}`;
  const { value } = await cachedJson<FreezeStatus[] | null>(ctx.kv, key, KV_TTL.freeze, async () => {
    if (chain === 'tron') {
      const b = await tronCallBool(norm, ctx).catch((e) => {
        // провайдер упал — логируем честно, но не роняем отчёт
        void ctx.db.addErrorLog('freeze:tron', String((e as Error)?.message ?? e).slice(0, 300)).catch(() => {});
        return null;
      });
      if (b === null) return null;
      return [{ frozen: b, asset: 'USDT' as const, chain, provider: 'trongrid triggerconstantcontract' }];
    }
    if (chain === 'eth') {
      const out: FreezeStatus[] = [];
      const usdt = await ethCallBool(USDT_ETH, SEL_USDT + abiAddrParam(norm, 'eth'), ctx).catch((e) => {
        void ctx.db.addErrorLog('freeze:eth-usdt', String((e as Error)?.message ?? e).slice(0, 300)).catch(() => {});
        return null;
      });
      if (usdt !== null) out.push({ frozen: usdt, asset: 'USDT' as const, chain, provider: 'eth_call USDT' });
      const usdc = await ethCallBool(USDC_ETH, SEL_USDC + abiAddrParam(norm, 'eth'), ctx).catch((e) => {
        void ctx.db.addErrorLog('freeze:eth-usdc', String((e as Error)?.message ?? e).slice(0, 300)).catch(() => {});
        return null;
      });
      if (usdc !== null) out.push({ frozen: usdc, asset: 'USDC' as const, chain, provider: 'eth_call USDC' });
      return out.length ? out : null;
    }
    return null;
  });
  return value;
}
