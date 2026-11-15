// Input detector (spec §6): format matrix + parallel probe for ambiguous inputs.
// Never says "unknown chain" without probing.

import type { ChainId, DetectCandidate, InputKind } from './types.ts';
import { isHex64, isEvmAddr, b58decode } from './util.ts';

const B58_RE = /^[1-9A-HJ-NP-Za-km-z]+$/;

export function normalizeInput(raw: string): string {
  let s = (raw ?? '').trim();
  // t.me links -> @username
  const tm = s.match(/(?:https?:\/\/)?t\.me\/(@?[A-Za-z0-9_]{3,64})\/?/i);
  if (tm) return tm[1].startsWith('@') ? tm[1].toLowerCase() : '@' + tm[1].toLowerCase();
  if (s.includes(' ')) s = s.replace(/\s+/g, '');
  return s;
}

// Pure format classification (no network). Returns candidates ordered by certainty.
export function detectFormat(raw: string): DetectCandidate[] {
  const s = normalizeInput(raw);
  const out: DetectCandidate[] = [];
  if (!s) return out;

  // Telegram username / .ton domain / links
  if (s.startsWith('@') && /^[a-zA-Z0-9_]{3,64}$/.test(s.slice(1))) {
    out.push({ kind: 'telegram', chains: ['ton'], clean: s.slice(1) });
    return out;
  }
  if (/^[a-zA-Z0-9-]{3,64}\.ton$/.test(s)) {
    out.push({ kind: 'ton-dns', chains: ['ton'], clean: s.toLowerCase() });
    return out;
  }
  if (/^(https?:\/\/)?t\.me\//i.test(raw ?? '') || s.startsWith('@')) {
    out.push({ kind: 'telegram', chains: ['ton'], clean: s.replace(/^@/, '') });
    return out;
  }

  // EVM address
  if (isEvmAddr(s)) {
    out.push({ kind: 'evm-addr', chains: ['eth', 'bsc', 'polygon', 'op', 'arb', 'base'], clean: s.toLowerCase() });
    return out;
  }

  // TON user-friendly: EQ/UQ + 46 chars (48 total), or raw 0:<64hex>
  if (/^(EQ|UQ)[0-9A-Za-z_-]{46}$/.test(s) || /^0:[0-9a-fA-F]{64}$/.test(s)) {
    out.push({ kind: 'ton-addr', chains: ['ton'], clean: s });
    return out;
  }

  // TRON: T + 33 base58 chars (34 total), checksum verified by adapter probe.
  if (/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(s)) {
    const dec = b58decode(s);
    if (dec && dec.length === 25 && dec[0] === 0x41) {
      out.push({ kind: 'tron-addr', chains: ['tron'], clean: s });
      return out;
    }
  }

  // Bitcoin
  if (/^(bc1[a-z0-9]{11,71}|[13][1-9A-HJ-NP-Za-km-z]{25,62})$/.test(s)) {
    out.push({ kind: 'btc-addr', chains: ['btc'], clean: s });
    return out;
  }

  // 64 hex: tx hash (EVM / TRON / TON raw) — ambiguous, resolved by probe.
  if (isHex64(s)) {
    out.push({ kind: 'tx-hash', chains: ['eth', 'tron', 'ton'], clean: s.toLowerCase() });
    return out;
  }

  // Base58 32..44 (Solana pubkey / BTC legacy) — ambiguous.
  if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s) && B58_RE.test(s)) {
    out.push({ kind: 'sol-b58', chains: ['sol', 'btc'], clean: s });
    return out;
  }

  return out;
}

export interface ProbeRegistry {
  // Light check "does this address exist on this chain" — must be a cheap call.
  probe(chain: ChainId, addr: string, timeoutMs?: number): Promise<boolean>;
  // tx lookup for hash inputs
  probeTx(chain: ChainId, hash: string, timeoutMs?: number): Promise<boolean>;
}

// Probe ambiguous candidates. Priority per spec §6: TRON → TON → ETH → BTC → SOL.
const PROBE_ORDER: ChainId[] = ['tron', 'ton', 'eth', 'btc', 'sol'];

export async function resolveInput(
  raw: string,
  registry: ProbeRegistry,
  probeTimeoutMs = 3000,
): Promise<{ candidates: DetectCandidate[]; kind: InputKind | null; clean: string | null; probed: string[] }> {
  const fmt = detectFormat(raw);
  const probed: string[] = [];

  if (fmt.length === 0) {
    return { candidates: [], kind: null, clean: null, probed };
  }
  const first = fmt[0];

  // Unambiguous address formats: single probe to confirm existence (per spec, never
  // report "unknown chain" without trying; but format is certain — one probe is enough).
  if (first.kind === 'tron-addr' || first.kind === 'ton-addr' || first.kind === 'btc-addr') {
    const chain = first.chains[0];
    probed.push(chain);
    const ok = await registry.probe(chain, first.clean, probeTimeoutMs);
    return { candidates: fmt, kind: ok ? first.kind : null, clean: first.clean, probed };
  }

  if (first.kind === 'evm-addr') {
    // All EVM chains in parallel; keep the ones that answered.
    probed.push(...first.chains);
    const results = await Promise.allSettled(
      first.chains.map((c) => registry.probe(c, first.clean, probeTimeoutMs).then((ok) => ({ c, ok }))),
    );
    const chains: ChainId[] = [];
    for (const r of results) {
      if (r.status === 'fulfilled' && r.value.ok) chains.push(r.value.c);
    }
    if (chains.length === 0) {
      // EVM address is format-valid even if all providers failed — return format
      // candidates and let the caller decide (partial degradation).
      return { candidates: fmt, kind: 'evm-addr', clean: first.clean, probed };
    }
    return { candidates: [{ ...first, chains }], kind: 'evm-addr', clean: first.clean, probed };
  }

  if (first.kind === 'tx-hash') {
    probed.push(...first.chains);
    for (const c of PROBE_ORDER) {
      if (!first.chains.includes(c)) continue;
      const ok = await registry.probeTx(c, first.clean, probeTimeoutMs);
      if (ok) return { candidates: [{ ...first, chains: [c] }], kind: 'tx-hash', clean: first.clean, probed };
    }
    return { candidates: fmt, kind: 'tx-hash', clean: first.clean, probed };
  }

  if (first.kind === 'sol-b58') {
    probed.push(...first.chains);
    // SOL first (more likely for modern users), then BTC legacy.
    for (const c of ['sol', 'btc'] as ChainId[]) {
      const ok = await registry.probe(c, first.clean, probeTimeoutMs);
      if (ok) return { candidates: [{ ...first, chains: [c] }], kind: 'sol-b58', clean: first.clean, probed };
    }
    return { candidates: fmt, kind: null, clean: first.clean, probed };
  }

  // telegram / ton-dns: no probe needed here.
  return { candidates: fmt, kind: first.kind, clean: first.clean, probed };
}

// Suggested fixes for a failed input (spec §6.4): common paste errors.
export function suggestFixes(raw: string): string[] {
  const s = normalizeInput(raw);
  const tips: string[] = [];
  if (/^0x[0-9a-fA-F]{50}$/.test(s) && s.length === 52) tips.push('Похоже на TRON-адрес в hex: попробуй base58 (начинается с T).');
  if (/^T[0-9A-Za-z]{33}$/.test(s) && !/^[1-9A-HJ-NP-Za-km-z]+$/.test(s.slice(1))) tips.push('В адресе TRON есть недопустимые символы (0, O, I, l) — проверь копипаст.');
  if (s.length > 70) tips.push('Строка слишком длинная: возможно, вставлен не адрес, а ссылка или ключ.');
  if (/^[a-zA-Z0-9_]{4,64}$/.test(s) && !s.startsWith('@')) tips.push('Если это Telegram-юзернейм, отправь его с @: @' + s);
  if (tips.length === 0) tips.push('Проверь, что скопирован полный адрес (или хэш) без лишних символов.');
  return tips;
}
