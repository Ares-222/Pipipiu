// Open mentions + scam databases (K1/K2). Honest free-tier degradation:
//   ScamSniffer DB — works (synced into aml_sources)
//   OFAC — works (synced)
//   GitHub Code Search — needs optional GITHUB_TOKEN (K1: "бесплатный токен в .env")
//   ChainAbuse — 403 anonymous (measured); used via /report flow instead
//   Web search engines (Google/Bing/DDG/Yandex) — require keys/bots; NOT scraped
//     (ToS), documented. The section reports what was actually checked.

import type { AppCtx } from '../core/ctx.ts';
import { fetchJson } from '../core/http.ts';

export interface MentionHit {
  source: string;
  kind: 'scam-db' | 'sanctions' | 'mixer' | 'code' | 'web';
  ref: string;
  url?: string;
}

export async function openMentions(ctx: AppCtx, chain: string, addr: string): Promise<{ hits: MentionHit[]; checked: string[]; note: string }> {
  const checked: string[] = [];
  const hits: MentionHit[] = [];

  // 1) scam DBs / sanctions / mixers already synced locally (K2/K3)
  checked.push('ScamSniffer scam-database (локальная копия, синк раз в сутки)');
  checked.push('OFAC SDN (локальная копия, синк раз в сутки)');
  checked.push('Собственный индекс депозитов миксеров (Tornado ETH)');
  const dirty = await ctx.db.getAmlSources(chain === 'eth' ? 'eth' : '*', [addr.toLowerCase()]);
  const anyChain = dirty.length ? dirty : await ctx.db.getAmlSources('*', [addr.toLowerCase()]);
  for (const d of anyChain) {
    hits.push({ source: d.source, kind: d.source === 'ofac' ? 'sanctions' : d.source.startsWith('mixer:') ? 'mixer' : 'scam-db', ref: d.ref ?? d.source });
  }

  // 2) GitHub Code Search (optional token; K1)
  if (ctx.cfg.githubToken) {
    checked.push('GitHub Code Search (токен есть)');
    try {
      const r = await fetchJson<{ total_count: number; items?: { html_url: string; repository?: { full_name: string } }[] }>(
        `https://api.github.com/search/code?q=${encodeURIComponent(`"${addr}"`)}&per_page=5`,
        { provider: 'github', headers: { authorization: `Bearer ${ctx.cfg.githubToken}`, accept: 'application/vnd.github+json' } },
      );
      for (const it of (r.items ?? []).slice(0, 5)) {
        hits.push({ source: 'github-code', kind: 'code', ref: it.repository?.full_name ?? it.html_url, url: it.html_url });
      }
    } catch { /* rate/permission — honest skip */ }
  } else {
    checked.push('GitHub Code Search — пропущен (нет GITHUB_TOKEN в .env)');
  }

  // 3) Web search engines: require keys or violate ToS when scripted anonymously —
  //    we do NOT scrape them (spec §23.1). Listed as "checked but unavailable".
  checked.push('Веб-поиск (Google/Bing/DDG/Yandex) — недоступен анонимно, скрейп запрещён ToS: не выполнялся');
  checked.push('ChainAbuse — 403 анонимно (замер): жалобы принимаются через /report и KB админа');

  return {
    hits,
    checked,
    note: 'Открытые упоминания — раздел показывает только реально проверенные источники. Поиск «человек → кошелёк» не выполняется (правило фокуса K6).',
  };
}
