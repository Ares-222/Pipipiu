// №12 Share: публичная страница «только чтение» для снимка отчёта (/r/:token).
// Токен в KV 7 дней; страница — статичный тёмный HTML, без API и initData.
// Всё экранируется: отчёт содержит внешние строки (метки, имена), им нельзя доверять.

import type { WalletReport } from '../core/types.ts';

function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const LEVEL_RU: Record<string, string> = {
  clean: 'ЧИСТЫЙ', low: 'НИЗКИЙ', medium: 'СРЕДНИЙ', high: 'ВЫСОКИЙ', critical: 'КРИТИЧЕСКИЙ',
};
const LEVEL_COLOR: Record<string, string> = {
  clean: '#22C55E', low: '#22C55E', medium: '#F59E0B', high: '#F97316', critical: '#D40000',
};
const CAT_RU: Record<string, string> = {
  cex: 'Биржа', payment: 'Платёжный сервис', mixer: 'Миксер', bridge: 'Мост', scam: 'Скам/фишинг',
  sanctioned: 'Санкционный', contract: 'Смарт-контракт', tgbots: 'Telegram-бот', service: 'Сервис',
  token: 'Токен', personal: 'Личный',
};

function short(a: string, h = 8, t = 6): string {
  return a && a.length > h + t + 3 ? `${a.slice(0, h)}…${a.slice(-t)}` : a;
}
function fmt(n: number): string {
  const abs = Math.abs(n);
  const d = abs >= 1000 || abs === 0 ? 0 : (abs < 1 ? 4 : 2);
  return n.toFixed(d).replace(/\B(?=(\d{3})+(?!\d))/g, '\u2009');
}

export function renderSharePage(rep: WalletReport, token: string): string {
  const v = rep.verdict ?? { score: 0, level: 'low', reasons: [] };
  const cr = rep.chains?.[0];
  const acc = cr?.account;
  const aml = cr?.aml;
  const created = new Date((rep.createdAt ?? Math.floor(Date.now() / 1000)) * 1000).toLocaleString('ru-RU', { timeZone: 'UTC' }) + ' UTC';

  const findings = (cr?.findings ?? []).slice(0, 8).map((f) => `
    <div class="row"><span class="sev sev-${esc(f.severity)}">●</span>
      <div><b>${esc(f.title)}</b><div class="muted">${esc(f.detail)}</div></div></div>`).join('');

  const amlHits = (aml?.hits ?? []).slice(0, 6).map((h) => `
    <div class="row"><b>${esc(h.source)}</b> <span class="badge">${esc(h.severity)}</span>
      <span class="muted">${h.hops === 0 ? 'прямой контакт' : `${esc(h.hops)} хоп`} · доля ${Math.round(h.volumeShare * 100)}%</span></div>`).join('');

  const exposure = (aml?.exposure ?? []).slice(0, 6).map((e) => `
    <div class="exrow"><span>${esc(e.ru)}</span><span class="mono">${Math.round(e.pct)}%</span></div>
    <div class="bar"><i style="width:${Math.min(100, Math.round(e.pct))}%;background:${esc(toneColor(e.tone))}"></i></div>`).join('');

  const topOut = (aml?.topOut ?? []).slice(0, 5).map((o) => `
    <div class="row mono">${esc(short(o.addr))}${o.label ? ` · ${esc(o.label)}` : ''} · ${esc(o.usd !== undefined ? `${fmt(o.usd)} $` : `${fmt(o.amount)} ${esc(o.asset)}`)} · ${Math.round(o.share * 100)}%</div>`).join('');

  return `<!DOCTYPE html>
<html lang="ru"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Ares Crypto · снимок отчёта</title>
<style>
  :root { color-scheme: dark; }
  body { background:#0A0A0B; color:#F2F2F3; font:14px/1.5 system-ui,-apple-system,sans-serif; margin:0; }
  .wrap { max-width:560px; margin:0 auto; padding:20px 14px 40px; }
  .brand { font-size:11px; letter-spacing:.14em; text-transform:uppercase; color:#D40000; font-weight:800; margin-bottom:12px; }
  .card { background:#131315; border:1px solid #232328; border-radius:16px; padding:14px; margin-bottom:12px; }
  .mono { font-family:ui-monospace,'JetBrains Mono',monospace; }
  .muted { color:#8A8A90; font-size:11.5px; }
  .score { font-size:44px; font-weight:800; line-height:1; }
  .badge { font-size:9px; background:rgba(212,0,0,.14); color:#FF6B57; border:1px solid rgba(212,0,0,.4); border-radius:99px; padding:2px 8px; font-weight:700; }
  .row { padding:7px 0; border-top:1px solid #232328; font-size:12.5px; }
  .sev-red{color:#D40000}.sev-yellow{color:#F59E0B}.sev-blue{color:#3B82F6}.sev-gray{color:#8A8A90}
  .exrow { display:flex; justify-content:space-between; font-size:12px; margin-top:8px; }
  .bar { height:6px; border-radius:99px; background:#1A1A1D; overflow:hidden; margin-top:3px; }
  .bar i { display:block; height:100%; }
  h3 { font-size:11px; letter-spacing:.12em; text-transform:uppercase; color:#8A8A90; margin:14px 4px 6px; }
  .foot { font-size:10.5px; color:#8A8A90; line-height:1.6; }
</style></head><body><div class="wrap">
  <div class="brand">Ares Crypto · снимок отчёта · только чтение</div>

  <div class="card">
    <div class="mono muted" style="word-break:break-all">${esc(rep.input)}</div>
    ${acc ? `<div class="muted" style="margin-top:4px">${esc(acc.chain.toUpperCase())} · ${esc(fmt(acc.balanceNative))} ${esc(acc.chain === 'tron' ? 'TRX' : 'ETH')} · tx ${esc(acc.txCount ?? '—')}</div>` : ''}
    <div style="display:flex;align-items:baseline;gap:10px;margin-top:10px">
      <span class="score" style="color:${esc(LEVEL_COLOR[v.level] ?? '#8A8A90')}">${esc(v.score)}</span>
      <span class="muted">/100 · <b style="color:${esc(LEVEL_COLOR[v.level] ?? '#8A8A90')}">${esc(LEVEL_RU[v.level] ?? esc(v.level))}</b></span>
    </div>
    ${(v.reasons ?? []).slice(0, 5).map((r) => `<div class="muted" style="margin-top:4px">• ${esc(r)}</div>`).join('')}
    <div class="muted" style="margin-top:10px">Снимок от ${esc(created)}. Страница живёт 7 дней и не обновляется.</div>
  </div>

  ${findings ? `<h3>Ключевые факты</h3><div class="card">${findings}</div>` : ''}
  ${aml ? `<h3>AML · источники загрязнения</h3><div class="card">
      ${amlHits || '<div class="muted">Грязных источников в графе не найдено.</div>'}
      ${exposure ? `<h3 style="margin-top:12px">Происхождение входящих</h3>${exposure}` : ''}
      ${topOut ? `<h3 style="margin-top:12px">Крупнейшие исходящие</h3>${topOut}` : ''}
      <div class="foot" style="margin-top:10px">${esc(aml?.disclaimer ?? '')}</div>
    </div>` : ''}

  <div class="card foot">
    Снимок отчёта Ares Crypto (токен ${esc(token.slice(0, 6))}…). Публичные данные блокчейна,
    вероятностная интерпретация — не юридическое заключение. Полную проверку делай в боте:
    t.me/ — команда /check.
  </div>
</div></body></html>`;
}

function toneColor(tone: string): string {
  return ({ ok: '#22C55E', blue: '#3B82F6', warn: '#F59E0B', bad: '#D40000', dim: '#8A8A90' } as Record<string, string>)[tone] ?? '#8A8A90';
}
