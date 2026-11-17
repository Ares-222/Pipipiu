// Russian report formatter (spec §14/§10/§3). Telegram HTML.
// Every probabilistic output carries explicit confidence marks; every report ends
// with the disclaimer. Long outputs are split into ≤4096-char parts.

import type { WalletReport, ChainReport, AmlResult, TraceResult } from '../core/types.ts';
import { CHAINS, LABEL_CATEGORIES, DISCLAIMER } from '../core/types.ts';
import type { TxCard } from '../service/report.ts';
import { fmtAmount, fmtUsd, fmtInt, fmtPct, fmtDate, fmtDateTime, shortAddr } from '../core/util.ts';

export function esc(s: string): string {
  return (s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const LEVEL_RU: Record<string, string> = {
  clean: 'ЧИСТЫЙ', low: 'НИЗКИЙ', medium: 'СРЕДНИЙ', high: 'ВЫСОКИЙ', critical: 'КРИТИЧЕСКИЙ',
};
const LEVEL_EMOJI: Record<string, string> = {
  clean: '🟢', low: '🟢', medium: '🟡', high: '🟠', critical: '🔴',
};
const SEV_DOT: Record<string, string> = { red: '🔴', yellow: '🟡', blue: '🔵', gray: '⚪' };

export function renderReport(rep: WalletReport): string[] {
  const parts: string[] = [];
  let cur = '';
  const push = (chunk: string) => {
    if ((cur + chunk).length > 3900) {
      parts.push(cur);
      cur = chunk;
    } else cur += chunk;
  };

  push(`🎯 <b>ARES CRYPTO · ОТЧЁТ ПО КОШЕЛЬКУ</b>\n`);
  if (rep.chains.length === 0) {
    for (const w of rep.warnings) push(`⚠️ ${esc(w)}\n`);
    push(`\n<i>${DISCLAIMER}</i>`);
    parts.push(cur);
    return parts;
  }

  push(`${LEVEL_EMOJI[rep.verdict.level] ?? '⚪'} <b>Вердикт риска: ${rep.verdict.score}/100 — ${LEVEL_RU[rep.verdict.level] ?? '?'}</b>`);
  if (rep.verdict.reasons.length) push(`· ${esc(rep.verdict.reasons.slice(0, 4).join(' · '))}`);
  push('\n');

  for (const cr of rep.chains) {
    push(renderChain(cr, rep));
  }

  for (const w of rep.warnings) push(`⚠️ <i>${esc(w)}</i>\n`);
  push(`\n<i>${DISCLAIMER}</i>`);
  parts.push(cur);
  return parts;
}

function renderChain(cr: ChainReport, rep: WalletReport): string {
  const info = CHAINS[cr.chain];
  const a = cr.account;
  const out: string[] = [];
  out.push(`\n━━ <b>${esc(info.name)}</b> ━━`);
  out.push(`<code>${esc(a.addr)}</code>`);
  out.push(`💰 Баланс: <b>${fmtAmount(a.balanceNative)} ${info.native}</b>`);

  // tokens (top 6)
  const toks = a.tokens.slice(0, 6);
  if (toks.length) {
    const lines = toks.map((t) => `  · ${esc(t.symbol)}: ${fmtAmount(t.amount)}`);
    out.push(`🪙 Токены:\n${lines.join('\n')}`);
  }
  if (a.tokens.length > 6) out.push(`  … и ещё ${a.tokens.length - 6}`);

  const k = cr.kpi;
  if (k) {
    out.push(`📊 <b>KPI</b> (${cr.txs.length} последних движений)`);
    out.push(`· Получено: <b>${fmtUsd(k.received)}</b> (${fmtInt(k.receivedCount)} операций)`);
    out.push(`· Отправлено: <b>${fmtUsd(k.sent)}</b> (${fmtInt(k.sentCount)} операций)`);
    out.push(`· Осело на адресе: <b>${fmtPct(k.settledPct)}</b> от входящего`);
    out.push(`· Контрагентов: ${fmtInt(k.counterpartiesIn)} отправ. / ${fmtInt(k.counterpartiesOut)} получ.`);
    out.push(`· Оборот: <b>${fmtUsd(k.turnover)}</b>`);
    out.push(`· Средний перевод: ${fmtUsd(k.avgTx)} · медиана ${fmtUsd(k.medianTx)}`);
    out.push(`· Крупнейший: ${fmtUsd(k.maxTx)}`);
    out.push(`· Активных дней: ${fmtInt(k.activeDays)}${k.ageDays !== null ? ` · возраст ${fmtInt(k.ageDays)} дн.` : ''}`);
  }

  if (cr.classification) {
    const s = cr.classification.scores;
    out.push(`🧬 <b>Профиль: ${esc(cr.classification.title)}</b> · достоверность: <b>${cr.classification.confidence}</b>`);
    out.push(`Раздача ${s.fanout} · Сбор ${s.fanin} · Автомат ${s.auto} · Биржа/сервис ${s.cexService} · Транзит ${s.transit} · Личный ${s.personal}`);
  }

  if (cr.findings.length) {
    out.push(`⚠️ <b>Признаки риска ${Math.min(100, cr.findings.reduce((n, f) => n + (f.severity === 'red' ? 22 : f.severity === 'yellow' ? 12 : f.severity === 'blue' ? 6 : 3), 0))}/100</b>`);
    for (const f of cr.findings.slice(0, 6)) {
      out.push(`${SEV_DOT[f.severity]} <b>${esc(f.title)}</b> — ${esc(f.detail)}`);
    }
  }

  if (cr.transit && cr.transit.matched > 0) {
    const t = cr.transit;
    out.push(`🔄 <b>Транзитность:</b> сопоставлено пар ${fmtPct(t.pct)} (${t.matched} из ${t.ofIn}), медиана удержания ${t.medianHoldMin ?? '—'} мин`);
    for (const p of t.top.slice(0, 5)) {
      out.push(`  ${p.delayMin} мин: ${fmtAmount(p.inAmount)} → ${fmtAmount(p.outAmount)} → <code>${esc(shortAddr(p.to, 8, 6))}</code>${p.toLabel ? ` ${esc(p.toLabel)}` : ''}`);
    }
  }

  if (cr.aml) {
    out.push(renderAml(cr.aml));
  }

  if (cr.telegram && (cr.telegram.usernames.length || cr.telegram.numbers.length || cr.telegram.domains.length)) {
    const tg = cr.telegram;
    out.push(`📨 <b>Связи с Telegram (TON):</b>`);
    for (const u of tg.usernames.slice(0, 5)) {
      out.push(`· ${esc(u.username)} — <i>вероятный Telegram (${u.confidence})</i> · t.me/${u.username.replace('@', '')}`);
    }
    for (const n of tg.numbers.slice(0, 3)) out.push(`· Анонимный номер ${esc(n.number)} (${n.confidence})`);
    for (const d of tg.domains.slice(0, 5)) out.push(`· Домен ${esc(d.domain)} (${d.confidence})`);
    if (tg.note) out.push(`<i>${esc(tg.note)}</i>`);
  }

  return out.join('\n') + '\n';
}

const EXP_BAR_FILL = '▰';
const EXP_BAR_EMPTY = '▱';

function expBar(pct: number, width = 10): string {
  const filled = Math.max(pct >= 1 ? 1 : 0, Math.min(width, Math.round((pct / 100) * width)));
  return EXP_BAR_FILL.repeat(filled) + EXP_BAR_EMPTY.repeat(width - filled);
}

const KIND_ICON: Record<string, string> = {
  cex: '🏦', payment: '💳', mixer: '🌀', bridge: '🌉', scam: '🚨',
  sanctioned: '⛔', contract: '📄', tgbots: '🤖', service: '🔧', token: '🪙', personal: '👤',
};

function kindOf(category?: string): string {
  if (!category) return '👤 личный/неименованный';
  const ru = LABEL_CATEGORIES[category]?.ru ?? category;
  return `${KIND_ICON[category] ?? '👤'} ${ru}`;
}

export function renderAml(aml: AmlResult): string {
  const lines: string[] = [];
  lines.push(`🛡 <b>AML: ${aml.score}/100 — ${LEVEL_RU[aml.level] ?? '?'}</b>`);

  // Происхождение средств (exposure по меткам контрагентов)
  if (aml.exposure?.length) {
    lines.push(`<b>Происхождение входящих средств</b> (по публичным меткам):`);
    for (const e of aml.exposure.slice(0, 8)) {
      lines.push(`${expBar(e.pct)} ${esc(e.ru)} — <b>${fmtPct(e.pct)}</b>`);
    }
  }

  for (const h of aml.hits.slice(0, 6)) {
    lines.push(`· <b>${esc(h.source)}</b> (${h.severity}): ${h.hops === 0 ? 'прямой контакт' : `${h.hops} хоп`}, доля объёма ${fmtPct(h.volumeShare * 100)}${h.path ? `, путь: ${esc(h.path.map((p) => shortAddr(p, 6, 4)).join(' → '))}` : ''}`);
  }

  // Куда ушло: тип получателя (биржа/сервис/личный) + сумма + доля
  if (aml.topOut?.length) {
    lines.push(`<b>Куда ушло</b> (крупнейшие исходящие):`);
    for (const o of aml.topOut.slice(0, 5)) {
      const sum = o.usd !== undefined ? fmtUsd(o.usd) : `${fmtAmount(o.amount)} ${esc(o.asset)}`;
      lines.push(`· ${sum} → <code>${esc(shortAddr(o.addr, 8, 6))}</code> — ${esc(kindOf(o.category))}${o.label ? ` 🏷 ${esc(o.label)}` : ''} · ${Math.round(o.share * 100)}%`);
    }
  }

  if (aml.exchangeExit.length) {
    lines.push(`· Точка KYC-деанонимизации: ${aml.exchangeExit.slice(0, 3).map((e) => esc(e.label)).join(', ')}`);
  }
  lines.push(`<i>${esc(aml.disclaimer)}</i>`);
  return lines.join('\n');
}

export function renderTxCard(card: TxCard): string {
  const info = CHAINS[card.chain];
  const out: string[] = [];
  out.push(`🧾 <b>ТРАНЗАКЦИЯ · ${esc(info.name)}</b>`);
  out.push(`<code>${esc(card.hash)}</code>`);
  out.push(`Время: ${card.ts ? fmtDateTime(card.ts) : '—'} · статус: ${card.status === 'success' ? '✅ успешно' : card.status}`);
  out.push(`От кого: <code>${esc(shortAddr(card.from, 10, 8))}</code>${card.labelFrom ? ` — 🏷 ${esc(card.labelFrom.name)}` : ''}`);
  out.push(`Кому: <code>${esc(shortAddr(card.to, 10, 8))}</code>${card.labelTo ? ` — 🏷 ${esc(card.labelTo.name)}` : ''}`);
  out.push(`Сумма: <b>${fmtAmount(card.amount)} ${esc(card.asset)}</b>`);
  out.push(`Комиссия: ${fmtAmount(card.fee)} ${esc(card.feeAsset)}`);
  if (card.memo) out.push(`Memo: «${esc(card.memo)}»`);
  out.push(`\n${card.explorerUrl}`);
  out.push(`<i>${DISCLAIMER}</i>`);
  return out.join('\n');
}

export function renderTraceProgress(step: number, totalSteps: number, expanded: number, note: string): string {
  return `🔍 <b>РАССЛЕДОВАНИЕ</b> · шаг ${step}/${totalSteps}\nРазворачиваю контрагентов: ${expanded} кошельков в графе\n<i>${esc(note)}</i>`;
}

export function renderTraceResult(res: TraceResult): string[] {
  const parts: string[] = [];
  let cur = '';
  const push = (c: string) => {
    if ((cur + c).length > 3900) { parts.push(cur); cur = c; } else cur += c;
  };
  push(`🔍 <b>РАССЛЕДОВАНИЕ · ${esc(res.chain.toUpperCase())}</b>\nКорневой: <code>${esc(res.root)}</code>\nГлубина: ${res.depth} · узлов: ${res.nodes.length} · связей: ${res.edges.length}\n`);

  // состав графа: кто окружает цель (биржи/сервисы/миксеры/личные)
  const comp = new Map<string, { n: number; allProbable: boolean }>();
  for (const n of res.nodes.slice(1)) {
    const k = n.category ?? 'personal';
    const cur = comp.get(k) ?? { n: 0, allProbable: true };
    cur.n += 1;
    cur.allProbable = cur.allProbable && !!n.probable;
    comp.set(k, cur);
  }
  if (comp.size) {
    const compLine = [...comp.entries()]
      .sort((a, b) => b[1].n - a[1].n)
      .map(([k, v]) => {
        const label = (k === 'service' && v.allProbable) ? '🔧 Биржа/сервис? (вероятно)' : v.allProbable && k !== 'personal' ? `${esc(kindOf(k))} (вероятно)` : esc(kindOf(k));
        return `${label}: ${v.n}`;
      })
      .join(' · ');
    push(`<b>ОКРУЖЕНИЕ ЦЕЛИ</b> (метки провайдеров + структура потоков):\n${compLine}\n\n`);
  }

  const dirtyNodes = res.nodes.filter((n) => !n.isRoot && (n.category === 'scam' || n.category === 'sanctioned' || n.category === 'mixer'));
  if (dirtyNodes.length) {
    push(`🚨 <b>В графе есть опасные узлы</b> (${dirtyNodes.length}): ${dirtyNodes.slice(0, 5).map((n) => `<code>${esc(shortAddr(n.addr, 6, 4))}</code>${n.label ? ` 🏷 ${esc(n.label)}` : ''}`).join(', ')}\n\n`);
  }

  push(`<b>КУДА УТЕКЛО</b> (топ-направления):\n`);
  for (const l of res.leaks.slice(0, 8)) {
    const kind = l.probable && l.category === 'service' ? '🔧 Биржа/сервис? (вероятно)' : `${esc(kindOf(l.category))}${l.probable ? ' (вероятно)' : ''}`;
    const cat = ` — ${kind}${l.label && !l.label.endsWith('?') ? ` 🏷 ${esc(l.label)}` : ''}`;
    push(`· ${fmtAmount(l.amount)} ${esc(l.asset)} (${fmtPct(l.share * 100)}) → <code>${esc(shortAddr(l.addr, 8, 6))}</code>${cat}\n`);
  }
  push(`\n<b>НАЙДЕННЫЕ КОШЕЛЬКИ:</b>\n`);
  for (const n of res.nodes.slice(1, 12)) {
    const kind = n.probable && n.category === 'service'
      ? '🔧 Биржа/сервис? (вероятно)'
      : `${esc(kindOf(n.category))}${n.probable ? ' (вероятно)' : ''}${n.label && !n.label.endsWith('?') ? ` · 🏷 ${esc(n.label)}` : ''}`;
    push(`· <code>${esc(shortAddr(n.addr, 8, 6))}</code> — ${kind} · объём ${fmtAmount(n.volume)}\n`);
  }
  if (res.unmix && res.unmix.length) {
    push(`\n🌀 <b>РАСПУТЫВАНИЕ МИКСЕРА</b> (вероятностная эвристика):\n`);
    for (const u of res.unmix) {
      push(`Миксер: <code>${esc(shortAddr(u.mixer, 8, 6))}</code>${u.mixerLabel ? ` ${esc(u.mixerLabel)}` : ''}\n`);
      for (const d of u.deposits.slice(0, 3)) push(`· заведено: ${fmtAmount(d.amount)} от <code>${esc(shortAddr(d.addr, 6, 4))}</code> ${fmtDate(d.ts)}\n`);
      for (const l of u.links.slice(0, 4)) push(`· вероятный вывод: <code>${esc(shortAddr(l.to, 6, 4))}</code> ${fmtAmount(l.amount)} — <b>p≈${fmtPct(l.p)}</b>\n`);
      push(`<i>${esc(u.note)}</i>\n`);
    }
  }
  if (res.truncated) push(`\n⚠️ Остановился по бюджету запросов — кнопка «продолжить глубже» достроит граф.\n`);
  push(`\n<i>${DISCLAIMER}</i>`);
  parts.push(cur);
  return parts;
}

export function renderWatchAlert(ev: {
  direction: 'in' | 'out'; amount: number; asset: string; counterparty: string;
  label?: string; addr: string; balance?: string; ts: number; chain: string; txHash: string; explorerUrl: string;
}): string {
  const arrow = ev.direction === 'in' ? '🔻 ВХОДЯЩАЯ' : '🔺 ИСХОДЯЩАЯ';
  const fromTo = ev.direction === 'in' ? 'от' : 'кому';
  const cpLabel = ev.label ? ` · 🏷 ${esc(ev.label)}` : '';
  return [
    `${arrow} · <b>${fmtAmount(ev.amount)} ${esc(ev.asset)}</b>`,
    `${fromTo} <code>${esc(shortAddr(ev.counterparty, 10, 8))}</code>${cpLabel}`,
    `→ кошелёк <code>${esc(shortAddr(ev.addr, 8, 6))}</code>${ev.balance ? ` · баланс: ${esc(ev.balance)}` : ''}`,
    `${fmtDateTime(ev.ts)} · ${esc(CHAINS[ev.chain as keyof typeof CHAINS]?.name ?? ev.chain)}`,
    esc(ev.explorerUrl),
  ].join('\n');
}

export function labelBadge(l: { name: string; category: string; confidence: string }): string {
  const cat = LABEL_CATEGORIES[l.category];
  return `🏷 ${esc(l.name)} (${esc(cat?.ru ?? l.category)}, ${l.confidence})`;
}
