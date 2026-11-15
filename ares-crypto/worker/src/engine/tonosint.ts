// TON OSINT (spec §13): NFT usernames / anonymous numbers / .ton domains →
// probable Telegram links. Always probabilistic: confidence high (held long),
// mid (bought recently), low (just resold). Never stated as fact.

import type { Nft, TelegramOsint, Confidence } from '../core/types.ts';
import type { AppCtx } from '../core/ctx.ts';
import { fetchJson } from '../core/http.ts';

const TONAPI = 'https://tonapi.io/v2';

interface NftItem {
  address: string;
  name?: string;
  sale_date?: number;
  last_sale_price?: number;
  owner?: { address?: string };
  collection?: { address?: string; name?: string };
  metadata?: { name?: string; description?: string };  // real name lives here (top-level name often null)
}

async function fetchNftItems(ctx: AppCtx, addr: string): Promise<NftItem[]> {
  const r = await fetchJson<{ nft_items?: NftItem[] }>(
    `${TONAPI}/accounts/${addr}/nfts?limit=1000&indirect_ownership=false`,
    { provider: 'tonapi', breaker: ctx.breaker, allow404: true },
  );
  return r?.nft_items ?? [];
}

function confidenceFor(item: NftItem, now: number): Confidence {
  const sale = item.sale_date ?? 0;
  if (!sale) return 'high';            // no resale on record, held long
  const ageDays = (now - sale) / 86400;
  if (ageDays > 30) return 'high';
  if (ageDays > 2) return 'mid';
  return 'low';
}

// Main: what Telegram links does this wallet hold?
export async function telegramLinks(ctx: AppCtx, addr: string): Promise<TelegramOsint> {
  const now = Math.floor(Date.now() / 1000);
  const items = await fetchNftItems(ctx, addr);
  const out: TelegramOsint = { usernames: [], numbers: [], domains: [], otherNft: [] };
  for (const it of items) {
    const coll = (it.collection?.name ?? '').toLowerCase();
    const name = (it.metadata?.name ?? it.name ?? '').trim();
    const conf = confidenceFor(it, now);
    if (coll.includes('telegram username')) {
      const uname = name.startsWith('@') ? name : `@${name}`;
      out.usernames.push({ username: uname, confidence: conf, acquiredTs: it.sale_date });
    } else if (coll.includes('anonymous telegram number') || coll.includes('telegram number')) {
      out.numbers.push({ number: name, confidence: conf, acquiredTs: it.sale_date });
    } else if (name.endsWith('.ton') || coll.includes('dns')) {
      out.domains.push({ domain: name, confidence: conf });
    } else {
      out.otherNft.push({ name: name || '(без имени)', collection: it.collection?.name ?? '' });
    }
  }
  if (out.usernames.length || out.numbers.length) {
    out.note = 'Связь «кошелёк → Telegram» вероятностная: NFT может быть перепродан. Достоверность по сроку владения.';
  }
  return out;
}

// Reverse: @username → probable wallet (via TON DNS .t.me subdomains, official TON DNS).
export async function resolveTelegram(ctx: AppCtx, username: string): Promise<{ addr?: string; confidence: Confidence; note: string } | null> {
  const u = username.replace(/^@/, '').toLowerCase();
  try {
    const r = await fetchJson<{ wallet?: { address?: string } } | null>(
      `${TONAPI}/dns/${encodeURIComponent(u)}.t.me/resolve`,
      { provider: 'tonapi', breaker: ctx.breaker, allow404: true, timeoutMs: 6000 },
    );
    const raw = r?.wallet?.address;
    if (!raw) return null;
    return {
      addr: raw,
      confidence: 'mid',
      note: 'Резолв через TON DNS (.t.me) — владелец сам привязал кошелёк к юзернейму в приложении Telegram.',
    };
  } catch {
    return null;
  }
}

// Reverse: .ton domain → wallet.
export async function resolveTonDomain(ctx: AppCtx, domain: string): Promise<{ addr?: string; expiring?: number } | null> {
  const d = domain.replace(/^@/, '').toLowerCase();
  const full = d.endsWith('.ton') ? d : `${d}.ton`;
  try {
    const r = await fetchJson<{ wallet?: { address?: string }; expiring_at?: number } | null>(
      `${TONAPI}/dns/${encodeURIComponent(full)}/resolve`,
      { provider: 'tonapi', breaker: ctx.breaker, allow404: true, timeoutMs: 6000 },
    );
    if (!r?.wallet?.address) return null;
    return { addr: r.wallet.address, expiring: r.expiring_at };
  } catch {
    return null;
  }
}

// NFT → adapter-level Nft list (used by report builder)
export function toNftList(items: NftItem[]): Nft[] {
  return items.map((it) => ({
    name: it.name ?? '',
    collectionName: it.collection?.name ?? '',
    address: it.address,
  }));
}
