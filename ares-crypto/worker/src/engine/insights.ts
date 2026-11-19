// Insights (v7, 19.11): пост-обработка графа и профиля на УЖЕ собранных данных.
// Ноль дополнительных fetch — работает внутри существующих бюджетов free-тарифов.
// Модули: пил-чейны (№6, методика USENIX «How to Peel a Million» в упрощённой
// эвристике), мосты (№7, по меткам из D1 + подсказка сетей), пылевые атаки (№12),
// отпечаток активности (№9), общий источник финансирования (№15).

import type { GraphNode, GraphEdge, Tx, Finding, ActivityFingerprint } from '../core/types.ts';

// ---------- №6 пил-чейн: цепочка «раздевания» ----------

export interface PeelChain {
  path: string[];            // id узлов: root → m1 → m2 → …
  addrs: string[];           // человеко-читаемые адреса (без chain: префикса)
  amounts: number[];         // объём перевода на каждом шаге
  asset: string;
  shareKept: number;         // доля, дошедшая до конца цепочки (0..1)
}

// Линейная цепочка ≥ root+2 адресов, где на каждом шаге доминирующий исход
// уносит большую часть объёма (≥60%) и узел не похож на сервис-хаб
// (fan-out на многих получателей = биржа, а не «проводник»).
export function detectPeelChains(
  nodes: GraphNode[],
  edges: GraphEdge[],
  rootId: string,
  maxChains = 3,
): PeelChain[] {
  const nodeById = new Map(nodes.map((n) => [n.id, n] as const));
  const outMap = new Map<string, { to: string; amount: number; asset: string }[]>();
  for (const e of edges) {
    if (e.probable) continue; // unmix-связи не входят в потоковые цепочки
    const arr = outMap.get(e.from) ?? [];
    arr.push({ to: e.to, amount: e.amount, asset: e.asset });
    outMap.set(e.from, arr);
  }

  const chains: PeelChain[] = [];

  const starts = (outMap.get(rootId) ?? []).slice().sort((a, b) => b.amount - a.amount).slice(0, 6);
  for (const first of starts) {
    if (chains.some((c) => c.path[1] === first.to)) continue; // дедуп по первому посреднику
    const path: string[] = [rootId];
    const amounts: number[] = [first.amount];
    let cur = first.to;
    let ok = true;
    for (let hop = 0; hop < 3; hop++) {
      path.push(cur);
      const cat = nodeById.get(cur)?.category;
      // конечная точка: биржа/миксер/скам/мост — деньги «пришли» (или исчезли), цепь закончена
      if (cat && cat !== 'personal' && cat !== 'contract') break;
      const outs = (outMap.get(cur) ?? []).filter((e) => !path.includes(e.to));
      if (!outs.length) break;
      const total = outs.reduce((s, e) => s + e.amount, 0) || 1;
      const dom = outs.slice().sort((a, b) => b.amount - a.amount)[0];
      // «раздевание»: доминирующий исход уносит ≥60% и не растекается на многих
      if (dom.amount < 0.6 * total || outs.length > 3 || dom.amount < 0.35 * amounts[amounts.length - 1]) { ok = false; break; }
      amounts.push(dom.amount);
      cur = dom.to;
    }
    if (!ok || path.length < 3) continue;
    const kept = amounts[amounts.length - 1] / (amounts[0] || 1);
    if (kept <= 0 || kept > 1.1) continue;
    chains.push({
      path,
      addrs: path.map((id) => id.slice(id.indexOf(':') + 1)),
      amounts,
      asset: first.asset,
      shareKept: Math.min(1, kept),
    });
    if (chains.length >= maxChains) break;
  }
  return chains;
}

// ---------- №15 общий источник финансирования ----------

export interface CommonFunder {
  source: string;            // адрес-источник
  sourceLabel?: string;
  targets: string[];         // ≥2 узла графа, получавшие от него
}

// Адрес (не ЦЕЛЬ), который финансировал несколько узлов графа — косвенная связь
// между ними («один спонсор»). Классика кластерного анализа.
export function detectCommonFunders(
  nodes: GraphNode[],
  edges: GraphEdge[],
  rootId: string,
  max = 3,
): CommonFunder[] {
  const nodeById = new Map(nodes.map((n) => [n.id, n] as const));
  const funders = new Map<string, Set<string>>();
  for (const e of edges) {
    if (e.from === rootId || e.from === e.to) continue;
    const t = nodeById.get(e.to);
    if (!t || t.isRoot) continue;
    const s = funders.get(e.from) ?? new Set<string>();
    s.add(e.to);
    funders.set(e.from, s);
  }
  const out: CommonFunder[] = [];
  for (const [source, targets] of funders) {
    if (targets.size < 2) continue;
    const tArr = [...targets].slice(0, 4);
    out.push({ source: source.slice(source.indexOf(':') + 1), sourceLabel: nodeById.get(source)?.label, targets: tArr });
    if (out.length >= max) break;
  }
  return out;
}

// ---------- №7 мосты: подсказка «куда могли уйти дальше» ----------

// Названия (по меткам D1, lowercase, substring-матчинг) → список сетей моста.
// Списки сетей — публичные факты о протоколах, а не адреса: ошибиться нельзя,
// адреса берутся только из меток.
const BRIDGE_HINTS: [string, string][] = [
  ['stargate', 'Ethereum · BSC · Polygon · Arbitrum · Optimism · Base · Avalanche'],
  ['across', 'Ethereum · Arbitrum · Optimism · Base · Polygon'],
  ['wormhole', '30+ сетей (Portal Bridge)'],
  ['portal', '30+ сетей (Wormhole)'],
  ['hop', 'Ethereum · Arbitrum · Optimism · Base · Polygon · Gnosis'],
  ['celer', '30+ сетей (cBridge)'],
  ['multichain', '30+ сетей (Anyswap)'],
  ['anyswap', '30+ сетей (Multichain)'],
  ['orbiter', 'L2 Ethereum (Arbitrum · Optimism · Base · zkSync · Linea и др.)'],
  ['layerswap', 'L2 и биржи (CEX)'],
  ['owlto', 'L2 Ethereum'],
  ['debridge', '20+ сетей'],
  ['rhino', 'L2 Ethereum'],
  ['meson', 'Ethereum · L2 · Polygon · BSC'],
  ['synapse', '20+ сетей'],
  ['axelar', '20+ сетей'],
  ['connext', 'Ethereum · L2'],
  ['poly_network', 'мультичейн (Nep5/Polynetwork)'],
  ['gate bridge', 'мультичейн'],
];

export function bridgeHintFor(label: string | undefined): string | null {
  if (!label) return null;
  const l = label.toLowerCase();
  for (const [key, hint] of BRIDGE_HINTS) if (l.includes(key)) return hint;
  return null;
}

export function bridgeFinding(nodes: GraphNode[]): Finding | null {
  const bridges = nodes.filter((n) => n.category === 'bridge');
  if (!bridges.length) return null;
  const names = [...new Set(bridges.map((b) => b.label ?? shortAddr(b.addr)))].slice(0, 4);
  return {
    id: 'bridge-present',
    severity: 'blue',
    title: `Мосты в окружении: ${names.join(', ')}`,
    detail: 'Через мост деньги уходят в другую сеть — граф одной цепи на этом обрывается. Проверь тот же адрес в других сетях (мультичейн-сводка) — там он тот же для EVM.',
  };
}

// ---------- №12 пылевые атаки ----------

const DUST_USD = 2;      // «пыль» — вход меньше $2
const DUST_TXS = 10;     // ≥10 крошечных входов
const DUST_ADDRS = 5;    // с ≥5 разных адресов

export function dustFinding(txs: Tx[], priceOf: (sym: string) => number | undefined): Finding | null {
  let dustTxs = 0;
  const senders = new Set<string>();
  let sumUsd = 0;
  for (const t of txs) {
    if (t.direction !== 'in' || !t.from) continue;
    const usd = t.asset === 'USDT' || t.asset === 'USDC' ? t.amount : t.amount * (priceOf(t.asset) ?? 0);
    if (t.asset !== 'USDT' && t.asset !== 'USDC' && !priceOf(t.asset)) continue; // без цены честно не оцениваем
    if (usd > 0 && usd < DUST_USD) {
      dustTxs++;
      senders.add(t.from);
      sumUsd += usd;
    }
  }
  if (dustTxs < DUST_TXS || senders.size < DUST_ADDRS) return null;
  return {
    id: 'dust-attack',
    severity: 'yellow',
    title: `Пылевые атаки: ${dustTxs} крошечных входов с ${senders.size} адресов`,
    detail: `Суммарно ~$${sumUsd.toFixed(2)} (порог $${DUST_USD} за перевод). Пыль используется для деанонимизации: адреса-отправители могут попасть в твои эксплореры и «подсветить» связи. Не отвечай на такие переводы и не пересылай их дальше.`,
    addresses: [...senders].slice(0, 5).map((a) => ({ addr: a })),
  };
}

// ---------- №9 отпечаток активности ----------

export function activityFingerprint(txs: Tx[]): ActivityFingerprint | null {
  if (txs.length < 12) return null; // на меньшей выборке вывод был бы выдумкой
  const hist = new Array<number>(24).fill(0);
  for (const t of txs) {
    if (!t.ts) continue;
    hist[new Date(t.ts * 1000).getUTCHours()]++;
  }
  const total = hist.reduce((s, x) => s + x, 0);
  if (!total) return null;
  let best = 0, bestSum = -1;
  for (let h = 0; h < 24; h++) {
    let s = 0;
    for (let d = 0; d < 6; d++) s += hist[(h + d) % 24];
    if (s > bestSum) { bestSum = s; best = h; }
  }
  const dayShare = hist.slice(7, 22).reduce((s, x) => s + x, 0) / total;
  const center = (best + 3) % 24;
  const partOfDay = center >= 5 && center < 12
    ? 'утро'
    : center >= 12 && center < 18
      ? 'день'
      : center >= 18 && center < 23 ? 'вечер' : 'ночь';
  const tzGuess = best >= 4 && best <= 9
    ? 'пик утром UTC — похоже на дневную активность UTC+2…+4 (например, Москва/СНГ)'
    : center >= 5 && center < 23
      ? `пик в ${partOfDay} по UTC — похож на дневную активность этого пояса или близкого к нему`
      : 'пик ночью по UTC — часовой пояс или график необычные (бот/скрипт или другой полюс земного шара)';
  return {
    hist, total,
    peakFrom: best, peakTo: (best + 6) % 24,
    peakShare: bestSum / total,
    dayActiveShare: dayShare,
    note: `Пик: ${String(best).padStart(2, '0')}:00–${String((best + 6) % 24).padStart(2, '0')}:00 UTC (${Math.round((bestSum / total) * 100)}% переводов). ${tzGuess}.`,
  };
}

// ---------- форматирование ----------

export function shortAddr(a: string): string {
  return a && a.length > 14 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a;
}

// Человеческие строки findings для TraceResult (граф) — только честные формулировки.
export function structureFindings(peel: PeelChain[], funders: CommonFunder[], bridges: Finding | null): string[] {
  const out: string[] = [];
  for (const [i, p] of peel.entries()) {
    out.push(`Пил-чейн №${i + 1}: объём ~${p.amounts[0]} ${p.asset} прошёл через ${p.path.length - 1} адрес(ов), доминирующий переход на каждом шаге (эвристика «раздевания», вероятностно); до конца цепочки дошло ~${Math.round(p.shareKept * 100)}%.`);
  }
  for (const f of funders) {
    out.push(`Общий источник финансирования: ${shortAddr(f.source)}${f.sourceLabel ? ` (${f.sourceLabel})` : ''} финансировал ${f.targets.length} адрес(ов) этой сети — косвенная связь между ними.`);
  }
  if (bridges) out.push(bridges.title + ' — ' + bridges.detail);
  return out;
}
