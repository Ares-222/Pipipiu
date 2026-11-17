// Dirty-address feeds sync (spec §8/§9/K2/K3):
//   OFAC SDN list  — official US Treasury dump, crypto addresses in remarks (measured: 113 hits)
//   ScamSniffer    — github.com/scamsniffer/scam-database blacklist/address.json
// OpenSanctions / EtherScamDB / ChainAbuse: measured 404/403 from sandbox on 2026-11-14 —
// not usable anonymously; documented in docs/API-VERIFICATION.md.

import type { DBLike, AmlSourceRow } from '../core/db.ts';
import type { Label } from '../core/types.ts';

export const OFAC_URL = 'https://www.treasury.gov/ofac/downloads/sdn.csv';
export const SCAMDB_URL = 'https://raw.githubusercontent.com/scamsniffer/scam-database/main/blacklist/address.json';

// Currency codes seen in SDN remarks -> our chains (unknown codes -> '*')
const OFAC_CODE_TO_CHAIN: Record<string, string> = {
  XBT: 'btc', BTC: 'btc', ETH: 'eth', TRX: 'tron', USDT: 'tron', SOL: 'sol',
};

// --- minimal CSV parser (quoted fields with commas) ---
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let cur: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      cur.push(field); field = '';
    } else if (ch === '\n') {
      cur.push(field); rows.push(cur); cur = []; field = '';
    } else if (ch !== '\r') {
      field += ch;
    }
  }
  if (field || cur.length) { cur.push(field); rows.push(cur); }
  return rows;
}

export interface OfacHit { addr: string; chain: string; name: string; program: string; sdnId: string; }

// Extract crypto addresses from SDN remarks: "Digital Currency Address - XBT 1A1zP..."
export function parseOfacSdn(csv: string): OfacHit[] {
  const rows = parseCsv(csv);
  const out: OfacHit[] = [];
  const re = /Digital Currency Address\s*-\s*([A-Z0-9]{2,5})\s+([0-9a-zA-Zxu:.\-]+)/gi;
  for (const r of rows) {
    const sdnId = r[0]?.trim();
    const name = r[1]?.trim();
    const program = r[2]?.trim();
    const remarks = r[r.length - 1] ?? '';
    if (!remarks) continue;
    let m: RegExpExecArray | null;
    re.lastIndex = 0;
    while ((m = re.exec(remarks)) !== null) {
      const code = (m[1] ?? '').toUpperCase();
      const addr = (m[2] ?? '').trim().replace(/[;,\s]+$/, '');
      if (!addr) continue;
      const chain = OFAC_CODE_TO_CHAIN[code] ?? '*';
      out.push({ addr, chain, name: name ?? 'OFAC entry', program: program ?? '', sdnId });
    }
  }
  return out;
}

export async function syncOfac(db: DBLike, csvText: string): Promise<{ inserted: number; labels: number }> {
  const hits = parseOfacSdn(csvText);
  const now = Math.floor(Date.now() / 1000);
  const rows: AmlSourceRow[] = hits.map((h) => ({
    chain: h.chain,
    addr: normalizeAddr(h.addr),
    source: 'ofac',
    severity: 'critical',
    ref: `SDN ${h.sdnId}: ${h.name}${h.program ? ` (${h.program})` : ''}`,
    updatedTs: now,
  }));
  await db.upsertAmlSources(rows);
  // labels as well (для показа метки «санкционный» в отчётах/графе)
  for (const h of hits) {
    await db.upsertLabel({
      chain: h.chain,
      addr: normalizeAddr(h.addr),
      category: 'sanctioned',
      name: `OFAC: ${h.name}`,
      source: 'ofac',
      confidence: 'high',
      addedBy: 'sync:ofac',
    } as Label);
  }
  return { inserted: rows.length, labels: hits.length };
}

export async function syncScamSniffer(db: DBLike, list: string[]): Promise<number> {
  const now = Math.floor(Date.now() / 1000);
  const rows: AmlSourceRow[] = list
    .filter((a) => /^0x[0-9a-fA-F]{40}$/.test(a))
    .map((a) => ({
      chain: 'eth', addr: a.toLowerCase(), source: 'scamsniffer', severity: 'high',
      ref: 'scamsniffer/scam-database (дрейнеры/фишинг)', updatedTs: now,
    }));
  await db.upsertAmlSources(rows);
  return rows.length;
}

export function normalizeAddr(a: string): string {
  return a.startsWith('0x') ? a.toLowerCase() : a;
}

// Download helpers (used by scripts and Worker cron). Text feeds — plain fetch with
// timeout, NOT fetchJson (SDN list is CSV, scam DB is a JSON array; both handled here).
async function fetchText(url: string, provider: string, timeoutMs: number): Promise<string> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${provider}`);
    return await res.text();
  } finally {
    clearTimeout(t);
  }
}

export async function downloadOfac(): Promise<string> {
  return fetchText(OFAC_URL, 'ofac', 30000);
}

export async function downloadScamSniffer(): Promise<string[]> {
  const txt = await fetchText(SCAMDB_URL, 'github-raw', 20000);
  const arr = JSON.parse(txt) as unknown;
  return Array.isArray(arr) ? (arr as string[]) : [];
}
