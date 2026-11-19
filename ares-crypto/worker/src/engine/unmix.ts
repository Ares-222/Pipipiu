// Распутывание «блендера» v6 — методология из открытых исследований (см. TESTLOG):
//  · arXiv 2510.09433 (Cristodaro, Kraner, Tessone, UZH, 2025) «Clustering Deposit
//    and Withdrawal Activity in Tornado Cash»: H1 address reuse, H2 transactional
//    linkage, H3 FIFO temporal matching — до 34.7% всех выводов Tornado связаны
//    комбинацией эвристик, >$2.3 млрд;
//  · SlowMist/MistTrack (разбор кейса KuCoin): окно «вскоре после депозитов» +
//    фиксированные номиналы пулов + балансовая сходимость Σвыводов ≈ Σдепозитов;
//  · классическая база 1/n: вероятность пары не выше 1/(выводы того же номинала в окне).
// Работает ТОЛЬКО поверх D1-индекса tx_deposits (крон-коллектор mixindex.ts):
// на рантайме расследования — ноль внешних RPC-вызовов, чтение ≤5000 строк.

import { normAddr } from '../core/types.ts';
import { fmtAmount } from '../core/util.ts';
import type { MixerDepositRow } from '../core/db.ts';
import type { UnmixFinding } from '../core/types.ts';

export interface UnmixEdge { from: string; to: string; amount: number; asset: string; }

const DAY = 86400;
// FIFO-сопоставление: распределение задержек депозит→вывод heavy-tailed с кучностью
// на коротких задержках (arXiv 2510.09433) — окно 24 ч покрывает основную массу.
export const FIFO_WINDOW_SEC = 24 * 3600;
// H1/H2 в академической методологии не ограничены окном; здесь потолок 180 дней
// (глубина накопительного индекса обычно меньше).
export const REUSE_LOOKBACK_SEC = 180 * DAY;

const CONF = { H1: 0.9, H2: 0.75, FIFO_BASE: 0.2, FIFO_SPAN: 0.15, LOOP_BONUS: 0.05 } as const;

function sameNominal(a: number, b: number): boolean {
  return Math.abs(a - b) < 1e-9;
}

export function buildUnmix(opts: {
  chain: string;
  mixer: string;
  mixerLabel?: string;
  rootAddr: string;
  graphAddrs: Set<string>;
  edges: UnmixEdge[];
  deposits: MixerDepositRow[];
  withdrawals: MixerDepositRow[];
  nowSec: number;
}): UnmixFinding | null {
  const { chain, mixer, mixerLabel, rootAddr, graphAddrs, edges, deposits, withdrawals } = opts;
  const norm = (a: string) => normAddr(chain, a ?? '');

  // Депозиты ЦЕЛИ и её граф-окружения (что именно «зашло в блендер»).
  const dRows = deposits.filter(
    (d) => d.commitment.startsWith('d:') && d.addr && (graphAddrs.has(norm(d.addr)) || norm(d.addr) === norm(rootAddr)),
  );
  if (dRows.length === 0) return null;
  const wRows = withdrawals.filter((w) => w.commitment.startsWith('w:') && w.addr);

  // Соседи графа (для H2: прямой перевод между депозит- и вывод-стороной).
  const nb = new Map<string, Set<string>>();
  for (const e of edges) {
    const f = norm(e.from), t = norm(e.to);
    (nb.get(f) ?? nb.set(f, new Set()).get(f)!).add(t);
    (nb.get(t) ?? nb.set(t, new Set()).get(t)!).add(f);
  }

  // Адреса, которые выводили и позже снова депонировали (циклы «3×10 минут» из UI
  // Tornado; MistTrack фиксирует тот же паттерн) — признак «ведёт один оператор».
  const reDepositTs = new Map<string, number[]>(); // addr → ts депозитов
  for (const d of deposits) {
    if (!d.commitment.startsWith('d:') || !d.addr) continue;
    const k = norm(d.addr);
    (reDepositTs.get(k) ?? reDepositTs.set(k, []).get(k)!).push(d.ts);
  }

  const usedW = new Set<string>(); // commitment ключ занятых выводов (H1/H2 приоритетны)
  const links: UnmixFinding['links'] = [];

  // H1: адрес-депозитор позже сам выводит тот же номинал — самая сильная связь.
  for (const d of dRows) {
    const dn = norm(d.addr ?? '');
    for (const w of wRows) {
      const key = w.commitment;
      if (usedW.has(key)) continue;
      if (norm(w.addr ?? '') !== dn || !sameNominal(w.amount, d.amount)) continue;
      if (w.ts < d.ts || w.ts - d.ts > REUSE_LOOKBACK_SEC) continue;
      usedW.add(key);
      const looped = (reDepositTs.get(dn) ?? []).some((t) => t > w.ts);
      links.push({ from: d.addr ?? '', to: w.addr ?? '', amount: w.amount, p: Math.min(0.97, CONF.H1 + (looped ? CONF.LOOP_BONUS : 0)), method: 'H1 · переиспользование адреса', looped });
      break;
    }
  }

  // H2: прямой перевод между адресом-депозитором и адресом-выводителем.
  for (const d of dRows) {
    const dn = norm(d.addr ?? '');
    for (const w of wRows) {
      const key = w.commitment;
      if (usedW.has(key)) continue;
      if (!sameNominal(w.amount, d.amount)) continue;
      if (w.ts < d.ts || w.ts - d.ts > REUSE_LOOKBACK_SEC) continue;
      const wn = norm(w.addr ?? '');
      if (dn === wn || !(nb.get(dn)?.has(wn) || nb.get(wn)?.has(dn))) continue;
      usedW.add(key);
      const looped = (reDepositTs.get(wn) ?? []).some((t) => t > w.ts);
      links.push({ from: d.addr ?? '', to: w.addr ?? '', amount: w.amount, p: Math.min(0.95, CONF.H2 + (looped ? CONF.LOOP_BONUS : 0)), method: 'H2 · прямой перевод между сторонами', looped });
      break;
    }
  }

  // H3 (FIFO): жадно сопоставляем оставшиеся депозиты с ближайшими следующими
  // выводами того же номинала; уверенность выше при короткой задержке (SlowMist:
  // «выводит вскоре после депозита»), база 0.20–0.35 с затуханием за 72 ч.
  const fifoDeps = dRows
    .filter((d) => !links.some((l) => norm(l.from) === norm(d.addr ?? '') && sameNominal(l.amount, d.amount)))
    .sort((a, b) => a.ts - b.ts);
  const fifoW = wRows
    .filter((w) => !usedW.has(w.commitment))
    .sort((a, b) => a.ts - b.ts);
  for (const d of fifoDeps) {
    const c = fifoW.find((w) => sameNominal(w.amount, d.amount) && w.ts >= d.ts && w.ts - d.ts <= FIFO_WINDOW_SEC);
    if (!c) continue;
    usedW.add(c.commitment);
    const hours = (c.ts - d.ts) / 3600;
    const p = CONF.FIFO_BASE + CONF.FIFO_SPAN * Math.exp(-hours / 24);
    const looped = (reDepositTs.get(norm(c.addr ?? '')) ?? []).some((t) => t > c.ts);
    links.push({ from: d.addr ?? '', to: c.addr ?? '', amount: c.amount, p: Math.min(0.9, p + (looped ? CONF.LOOP_BONUS : 0)), method: 'H3 · FIFO по времени', looped });
  }

  // База 1/n для депозитов без доказательной связи: n = выводы того же номинала
  // в окне 24 ч. Классический статматчинг (нижняя граница вероятности).
  const nOf = (amount: number, ts: number) => wRows.filter((w) => sameNominal(w.amount, amount) && w.ts >= ts && w.ts - ts <= FIFO_WINDOW_SEC).length;
  for (const d of dRows) {
    if (links.some((l) => norm(l.from) === norm(d.addr ?? '') && sameNominal(l.amount, d.amount))) continue;
    const n = nOf(d.amount, d.ts);
    if (n === 0) continue;
    const p = 1 / n;
    const c = wRows.filter((w) => sameNominal(w.amount, d.amount) && w.ts >= d.ts && w.ts - d.ts <= FIFO_WINDOW_SEC)[0];
    if (!c) continue;
    links.push({ from: d.addr ?? '', to: c.addr ?? '', amount: c.amount, p, method: '1/n · окно 24 ч' });
  }

  if (links.length === 0) {
    // Депозиты цели есть, но пар не нашлось — честный нулевой результат с покрытием.
    const cover = deposits.length ? Math.min(...deposits.map((d) => d.ts)) : opts.nowSec;
    return {
      mixer, mixerLabel: mixerLabel ?? 'Миксер',
      deposits: dRows.map((d) => ({ addr: d.addr ?? '', amount: d.amount, ts: d.ts })),
      outputs: wRows.slice(0, 20).map((w) => ({ addr: w.addr ?? '', amount: w.amount, ts: w.ts })),
      links: [],
      note: `Депозиты цели в блендере есть (с ${new Date(cover * 1000).toISOString().slice(0, 10)}), но надёжных пар «депозит→вывод» в накопленном индексе не нашлось: H1/H2/H3 (arXiv 2510.09433) не сработали. Индекс пополняется кроном — повтори расследование позже.`,
    };
  }

  // Балансовая сходимость по SlowMist: доля депонированного, покрытая найденными парами.
  const depSum = dRows.reduce((s, d) => s + d.amount, 0) || 1;
  const linkSum = links.reduce((s, l) => s + l.amount, 0);
  const rec = Math.round((linkSum / depSum) * 100);
  const methods = [...new Set(links.map((l) => l.method ?? '1/n'))].join(' + ');
  const loops = links.filter((l) => l.looped).length;

  return {
    mixer, mixerLabel: mixerLabel ?? 'Миксер',
    deposits: dRows.map((d) => ({ addr: d.addr ?? '', amount: d.amount, ts: d.ts })),
    outputs: wRows.slice(0, 20).map((w) => ({ addr: w.addr ?? '', amount: w.amount, ts: w.ts })),
    links: links.sort((a, b) => b.p - a.p).slice(0, 8),
    note: `Методология открытых исследований (arXiv 2510.09433): ${methods}. Номинал ${fmtAmount(dRows[0].amount)} · пар: ${links.length} · балансовая сходимость ~${rec}% (Σ найденных выводов / Σ депозитов цели, приём SlowMist)${loops ? ` · циклов повторного входа: ${loops}` : ''}. Вероятностная оценка, не доказательство.`,
  };
}
