// TON adapter. Primary: tonapi.io v2 (no key needed). Fallback: toncenter v2 (key).
// Verified live 2026-11-14: account + dns root respond; jetton_master interface exposed.

import type { ChainAdapter, Tx, TxPage, Page, Account, TokenBalance, Nft } from '../core/types.ts';
import type { AppCtx } from '../core/ctx.ts';
import { fetchJson } from '../core/http.ts';
import { toNum } from '../core/util.ts';

const TONAPI = 'https://tonapi.io/v2';
const TONCENTER = 'https://toncenter.com/api/v2';

export function detectTonAddr(s: string): boolean {
  return /^(EQ|UQ)[0-9A-Za-z_-]{46}$/.test(s) || /^(?:0|-1):[0-9a-fA-F]{64}$/.test(s);
}

// ---- нормализация TON-адресов: friendly (EQ/UQ) <-> raw (0:hex) ----
// tonapi возвращает контрагентов в raw-форме; сравнение с friendly-адресом
// запроса всегда даёт «self», а метки из датасетов хранятся в friendly-форме.

export function tonFriendlyToRaw(s: string): string | null {
  const b = s.trim().replace(/-/g, '+').replace(/_/g, '/');
  if (!/^(EQ|UQ|0:|-1:)/.test(s.trim())) return null;
  if (b.length > 48) return null; // raw-форма — не base64
  const bin = Buffer.from(b, 'base64');
  if (bin.length !== 36) return null;
  const wc = bin[1] === 0xff ? -1 : bin[1];
  return `${wc}:${bin.slice(2, 34).toString('hex')}`;
}

function crc16xmodem(buf: Buffer): number {
  let crc = 0;
  for (const byte of buf) {
    crc ^= byte << 8;
    for (let i = 0; i < 8; i++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc;
}

export function tonRawToFriendly(s: string): string | null {
  const m = /^(-?\d+):([0-9a-fA-F]{64})$/.exec(s.trim());
  if (!m) return null;
  const wc = parseInt(m[1], 10);
  if (wc !== 0 && wc !== -1) return null;
  const payload = Buffer.concat([Buffer.from([0x11, wc & 0xff]), Buffer.from(m[2], 'hex')]);
  const crc = crc16xmodem(payload);
  const buf = Buffer.concat([payload, Buffer.from([(crc >> 8) & 0xff, crc & 0xff])]);
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

interface TonCenterEnvelope<T> { ok: boolean; result?: T; error?: string; }
interface TonCenterAccount {
  balance: string;
  state?: string;
  code?: string;
  last_transaction_id?: { lt?: string; hash?: string };
}
interface TonCenterMessage { source?: string; destination?: string; value?: string; message?: string; }
interface TonCenterTransaction {
  utime?: number;
  transaction_id?: { hash?: string; lt?: string };
  fee?: string;
  in_msg?: TonCenterMessage;
  out_msgs?: TonCenterMessage[];
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
      // tonapi v2 (актуально): sender/recipient; старые поля source/destination
      // поддержаны для совместимости.
      TonTransfer?: { sender?: { address?: string }; recipient?: { address?: string }; source?: { address?: string }; destination?: { address?: string }; value?: string; amount?: string; comment?: string };
      JettonTransfer?: {
        sender?: { address?: string };
        recipient?: { address?: string };
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
    try {
      const a = await fetchJson<TonapiAccount>(
        `${TONAPI}/accounts/${addr}`,
        { provider: 'tonapi', breaker: this.ctx.breaker },
      );
      const balanceNano = toNum(a.balance);
      const isContract = !a.is_wallet && (a.get_methods?.length ?? 0) > 0;
      return {
        chain: 'ton', addr, balanceNative: balanceNano / 1e9, tokens: [],
        createdAt: a.last_activity ? undefined : undefined,
        lastTxTs: a.last_activity, isContract, provider: 'tonapi', providers: ['tonapi'],
      };
    } catch (primaryError) {
      try {
        const a = await this.tonCenter<TonCenterAccount>('getAddressInformation', { address: addr });
        return {
          chain: 'ton', addr, balanceNative: toNum(a.balance) / 1e9, tokens: [],
          isContract: !!a.code, provider: 'toncenter', providers: ['toncenter'], partial: true,
        };
      } catch (fallbackError) {
        throw new Error(`TON providers unavailable (tonapi: ${errorText(primaryError)}; toncenter: ${errorText(fallbackError)})`);
      }
    }
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
    const addrRaw = tonFriendlyToRaw(addr) ?? addr;
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
            const fromR = (t.sender ?? t.source)?.address ?? '';
            const toR = (t.recipient ?? t.destination)?.address ?? '';
            const isIn = toR === addrRaw || toR === addr;
            const isOut = fromR === addrRaw || fromR === addr;
            const dir = isIn && isOut ? 'self' : isIn ? 'in' : isOut ? 'out' : 'self';
            txs.push({
              hash: ev.event_id,
              chain: 'ton',
              ts,
              from: tonRawToFriendly(fromR) ?? fromR,
              to: tonRawToFriendly(toR) ?? toR,
              amount: toNum(t.amount ?? t.value) / 1e9,
              asset: 'TON',
              fee: 0,
              direction: dir,
              kind: 'tx',
              memo: t.comment,
            });
          }
          const j = act.JettonTransfer;
          if (j) {
            const fromR = (j.sender ?? j.source)?.address ?? '';
            const toR = (j.recipient ?? j.destination)?.address ?? '';
            const isIn = toR === addrRaw || toR === addr;
            const isOut = fromR === addrRaw || fromR === addr;
            const dir = isIn && isOut ? 'self' : isIn ? 'in' : isOut ? 'out' : 'self';
            txs.push({
              hash: ev.event_id,
              chain: 'ton',
              ts,
              from: tonRawToFriendly(fromR) ?? fromR,
              to: tonRawToFriendly(toR) ?? toR,
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
      // TON Center can still provide native-message history. Jetton actions require
      // TonAPI's decoded event feed, so this fallback is always explicitly partial.
      try {
        const rows = await this.tonCenter<TonCenterTransaction[]>('getTransactions', {
          address: addr,
          limit: String(limit),
        });
        providers.push('toncenter');
        for (const tx of rows ?? []) {
          const hash = tx.transaction_id?.hash ?? '';
          const ts = Number(tx.utime ?? 0);
          if (!hash) continue;
          const incoming = tx.in_msg;
          if (incoming && toNum(incoming.value) > 0) {
            txs.push({
              hash, chain: 'ton', ts,
              from: tonRawToFriendly(incoming.source ?? '') ?? (incoming.source ?? ''), to: addr,
              amount: toNum(incoming.value) / 1e9, asset: 'TON', fee: 0,
              direction: 'in', kind: 'tx', memo: incoming.message,
            });
          }
          for (const outgoing of tx.out_msgs ?? []) {
            if (toNum(outgoing.value) <= 0) continue;
            txs.push({
              hash, chain: 'ton', ts,
              from: addr, to: tonRawToFriendly(outgoing.destination ?? '') ?? (outgoing.destination ?? ''),
              amount: toNum(outgoing.value) / 1e9, asset: 'TON', fee: 0,
              direction: 'out', kind: 'tx', memo: outgoing.message,
            });
          }
        }
      } catch {
        partial = true;
      }
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

  private async tonCenter<T>(method: string, params: Record<string, string>): Promise<T> {
    const url = new URL(`${TONCENTER}/${method}`);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    const headers = this.ctx.cfg.toncenterKey ? { 'X-API-Key': this.ctx.cfg.toncenterKey } : undefined;
    const response = await fetchJson<TonCenterEnvelope<T>>(url.toString(), {
      provider: 'toncenter', breaker: this.ctx.breaker, headers,
    });
    if (!response.ok || response.result === undefined) {
      throw new Error(response.error || 'invalid response');
    }
    return response.result;
  }
}

function errorText(e: unknown): string {
  return e instanceof Error ? e.message.slice(0, 100) : String(e).slice(0, 100);
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
