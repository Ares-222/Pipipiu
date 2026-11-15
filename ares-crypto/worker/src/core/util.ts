// Small pure helpers: base58/TRON address math, number formatting (ru), stats.

const B58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

export function b58encode(bytes: Uint8Array): string {
  let num = 0n;
  for (const b of bytes) num = num * 256n + BigInt(b);
  let out = '';
  while (num > 0n) {
    out = B58_ALPHABET[Number(num % 58n)] + out;
    num = num / 58n;
  }
  // leading zero bytes -> '1'
  for (const b of bytes) {
    if (b !== 0) break;
    out = '1' + out;
  }
  return out;
}

export function b58decode(s: string): Uint8Array | null {
  let num = 0n;
  for (const ch of s) {
    const idx = B58_ALPHABET.indexOf(ch);
    if (idx < 0) return null;
    num = num * 58n + BigInt(idx);
  }
  const bytes: number[] = [];
  while (num > 0n) {
    bytes.unshift(Number(num % 256n));
    num = num / 256n;
  }
  for (const ch of s) {
    if (ch !== '1') break;
    bytes.unshift(0);
  }
  return new Uint8Array(bytes);
}

export async function sha256hex(data: Uint8Array): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', data as BufferSource);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function sha256bytes(data: Uint8Array): Promise<Uint8Array> {
  const d = await crypto.subtle.digest('SHA-256', data as BufferSource);
  return new Uint8Array(d);
}

// TRON: hex like "41..." -> base58 with 25-byte structure and double-sha256 checksum.
export async function hexToTronBase58(hex: string): Promise<string | null> {
  const h = hex.toLowerCase().replace(/^0x/, '');
  if (!/^[0-9a-f]{50}$/.test(h)) return null;
  const raw = new Uint8Array(21);
  raw[0] = 0x41;
  for (let i = 0; i < 20; i++) raw[i + 1] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  const h1 = await sha256bytes(raw);
  const h2 = await sha256bytes(h1);
  const full = new Uint8Array(25);
  full.set(raw, 0);
  full.set(h2.slice(0, 4), 21);
  return b58encode(full);
}

export async function tronBase58ToHex(b58: string): Promise<string | null> {
  const dec = b58decode(b58);
  if (!dec || dec.length !== 25) return null;
  const raw = dec.slice(0, 21);
  const h1 = await sha256bytes(raw);
  const h2 = await sha256bytes(h1);
  for (let i = 0; i < 4; i++) if (h2[i] !== dec[21 + i]) return null;
  if (raw[0] !== 0x41) return null;
  return [...raw].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function shortAddr(a: string, head = 6, tail = 6): string {
  if (!a) return '';
  if (a.length <= head + tail + 3) return a;
  return `${a.slice(0, head)}…${a.slice(-tail)}`;
}

export function isHex64(s: string): boolean {
  return /^[0-9a-fA-F]{64}$/.test(s);
}

export function isEvmAddr(s: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(s);
}

// ---------- numbers ----------

export function fmtAmount(n: number, maxDecimals = 6): string {
  if (!isFinite(n)) return String(n);
  const abs = Math.abs(n);
  let decimals = 2;
  if (abs === 0) decimals = 0;
  else if (abs < 0.01) decimals = maxDecimals;
  else if (abs < 1) decimals = Math.min(4, maxDecimals);
  else if (abs < 1000) decimals = Math.min(2, maxDecimals);
  const [int, frac] = n.toFixed(decimals).split('.');
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, '\u2009');
  const f = frac ? frac.replace(/0+$/, '') : '';
  return f ? `${grouped},${f}` : grouped;
}

export function fmtInt(n: number): string {
  return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '\u2009');
}

// "1,29 млн" / "582 345" / "1 685,59" — style of the reference report.
export function fmtCompact(n: number): string {
  const abs = Math.abs(n);
  if (!isFinite(n) || abs >= 1e15) return '>10¹⁵ (вероятно спам-токен)';
  if (abs >= 1e12) return `${fmtAmount(1e12, 0)}+`;
  if (abs >= 1e9) return `${fmtAmount(n / 1e9, 2)} млрд`;
  if (abs >= 1e6) return `${fmtAmount(n / 1e6, 2)} млн`;
  if (abs >= 1e5) return fmtAmount(n, 0);
  return fmtAmount(n, 2);
}

export function fmtUsd(n: number): string {
  return `${fmtCompact(n)} $`;
}

export function fmtPct(p: number): string {
  const s = p >= 10 ? p.toFixed(0) : p.toFixed(1);
  return `${s.replace('.', ',')}%`;
}

export function median(arr: number[]): number {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export function mean(arr: number[]): number {
  if (!arr.length) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

// Coefficient of variation of intervals — machine-rhythm detector.
export function cv(intervals: number[]): number {
  if (intervals.length < 2) return 0;
  const m = mean(intervals);
  if (m === 0) return 0;
  const sd = Math.sqrt(mean(intervals.map((x) => (x - m) ** 2)));
  return sd / m;
}

export function modeValue(arr: number[], bucketMs = 60000): number {
  if (!arr.length) return 0;
  const counts = new Map<number, number>();
  for (const v of arr) {
    const k = Math.round(v / bucketMs);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  let bestK = 0, bestC = -1;
  for (const [k, c] of counts) if (c > bestC) { bestC = c; bestK = k; }
  return bestK * bucketMs;
}

// ---------- dates ----------

export function fmtDate(ts: number): string {
  const d = new Date(ts * 1000);
  const p = (x: number) => String(x).padStart(2, '0');
  return `${p(d.getUTCDate())}.${p(d.getUTCMonth() + 1)}.${d.getUTCFullYear()}`;
}

export function fmtDateTime(ts: number): string {
  const d = new Date(ts * 1000);
  const p = (x: number) => String(x).padStart(2, '0');
  return `${p(d.getUTCDate())}.${p(d.getUTCMonth() + 1)}.${d.getUTCFullYear()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())} UTC`;
}

export function ageDays(ts: number | undefined | null, now: number): number | null {
  if (!ts) return null;
  return Math.max(0, Math.floor((now - ts) / 86400));
}

// ---------- misc ----------

export function uniq<T>(arr: T[]): T[] {
  return [...new Set(arr)];
}

export function sum(arr: number[]): number {
  return arr.reduce((a, b) => a + b, 0);
}

export function toNum(v: string | number | undefined | null): number {
  if (v === undefined || v === null) return 0;
  const n = typeof v === 'number' ? v : parseFloat(v);
  return isFinite(n) ? n : 0;
}

export function lower(a: string): string {
  return (a ?? '').toLowerCase();
}

export function parseJsonSafe<T>(s: string | null | undefined, fallback: T): T {
  if (!s) return fallback;
  try { return JSON.parse(s) as T; } catch { return fallback; }
}
