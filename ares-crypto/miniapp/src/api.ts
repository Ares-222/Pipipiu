// API client: all requests carry Telegram initData in x-init-data (server verifies
// HMAC by bot token — no passwords, spec §5).

import { initData } from './tg';

export const API_BASE = window.ARES_CONFIG?.apiBase ?? '';

export async function api<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_BASE}/api${path}`, {
    ...opts,
    headers: {
      'content-type': 'application/json',
      'x-init-data': initData(),
      ...(opts.headers ?? {}),
    },
  });
  const body = await res.json().catch(() => ({ ok: false, error: 'bad json' })) as { ok?: boolean; error?: string } & Record<string, unknown>;
  if (!res.ok || body.ok === false) throw new Error(String(body.error ?? `HTTP ${res.status}`));
  return body as T;
}

// ---- shared client types (mirror of worker report service) ----

export interface Label { name: string; category: string; confidence: string; source?: string; }
export interface Tx {
  hash: string; chain: string; ts: number; from: string; to: string;
  amount: number; asset: string; contract?: string; fee: number;
  direction: 'in' | 'out' | 'self'; kind: string;
  labelFrom?: Label | null; labelTo?: Label | null; memo?: string;
}
export interface TokenBalance { symbol: string; contract?: string; amount: number; priceUsd?: number; }
export interface Account { chain: string; addr: string; balanceNative: number; tokens: TokenBalance[]; txCount?: number; createdAt?: number; isContract?: boolean; provider: string; partial?: boolean; }
export interface Finding { id: string; severity: 'red' | 'yellow' | 'blue' | 'gray'; title: string; detail: string; addresses?: { addr: string; label?: string; amounts?: string }[]; graphRef?: boolean; }
export interface Kpi { received: number; receivedCount: number; sent: number; sentCount: number; settledPct: number; counterpartiesIn: number; counterpartiesOut: number; turnover: number; avgTx: number; medianTx: number; maxTx: number; activeDays: number; ageDays: number | null; }
export interface Classification { title: string; confidence: string; scores: Record<string, number>; }
export interface TransitPair { delayMin: number; inAmount: number; outAmount: number; to: string; toLabel?: string; }
export interface TransitInfo { matched: number; ofIn: number; pct: number; medianHoldMin: number | null; under60Pct: number; top: TransitPair[]; }
export interface AmlHit { source: string; severity: string; hops: number; path?: string[]; volumeShare: number; score: number; ref?: string; }
export interface AmlResult { score: number; level: string; hits: AmlHit[]; exchangeExit: { addr: string; label: string }[]; disclaimer: string; }
export interface TelegramOsint { usernames: { username: string; confidence: string }[]; numbers: { number: string; confidence: string }[]; domains: { domain: string; confidence: string }[]; otherNft: { name: string; collection: string }[]; note?: string; }
export interface ChainReport {
  chain: string; account: Account; txs: Tx[]; kpi?: Kpi; findings: Finding[];
  classification?: Classification; transit?: TransitInfo; aml?: AmlResult;
  telegram?: TelegramOsint; partial?: boolean; providers?: string[];
}
export interface WalletReport {
  input: string; createdAt: number; chains: ChainReport[];
  verdict: { score: number; level: string; reasons: string[] };
  warnings: string[];
}
export interface GraphNode { id: string; chain: string; addr: string; label?: string; category?: string; volume: number; in: number; out: number; txCount: number; isRoot?: boolean; role?: string; }
export interface GraphEdge { from: string; to: string; amount: number; asset: string; txCount: number; firstTs: number; lastTs: number; probable?: boolean; p?: number; via?: string; }
export interface TraceResult { root: string; chain: string; depth: number; nodes: GraphNode[]; edges: GraphEdge[]; leaks: { addr: string; label?: string; amount: number; asset: string; share: number }[]; findings: string[]; unmix?: unknown[]; truncated?: boolean; fetchesUsed: number; }

// ---- formatting (ru, mono numbers, thin space) ----

export function fmt(n: number, maxD = 2): string {
  if (!isFinite(n)) return String(n);
  const abs = Math.abs(n);
  let d = abs >= 1000 ? (abs >= 1e5 ? 0 : 2) : (abs < 1 ? Math.min(6, maxD) : 2);
  if (abs === 0) d = 0;
  const [i, f] = n.toFixed(d).split('.');
  const gi = i.replace(/\B(?=(\d{3})+(?!\d))/g, '\u2009');
  const fr = (f ?? '').replace(/0+$/, '');
  return fr ? `${gi},${fr}` : gi;
}

export function fmtUsd(n: number): string {
  const a = Math.abs(n);
  if (a >= 1e9) return `${fmt(n / 1e9)} млрд $`;
  if (a >= 1e6) return `${fmt(n / 1e6)} млн $`;
  if (a >= 1e5) return `${fmt(n)} $`;
  return `${fmt(n)} $`;
}

export function fmtPct(p: number): string {
  const s = p >= 10 ? p.toFixed(0) : p.toFixed(1);
  return `${s.replace('.', ',')}%`;
}

export function short(a: string, h = 8, t = 6): string {
  return a && a.length > h + t + 3 ? `${a.slice(0, h)}…${a.slice(-t)}` : a;
}

export function levelRu(l: string): string {
  return ({ clean: 'ЧИСТЫЙ', low: 'НИЗКИЙ', medium: 'СРЕДНИЙ', high: 'ВЫСОКИЙ', critical: 'КРИТИЧЕСКИЙ' } as Record<string, string>)[l] ?? l;
}

export function levelColor(l: string): string {
  return ({ clean: 'var(--ok)', low: 'var(--ok)', medium: 'var(--warn)', high: '#F97316', critical: 'var(--danger)' } as Record<string, string>)[l] ?? 'var(--muted)';
}
