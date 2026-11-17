import { useEffect, useMemo, useRef, useState } from 'react';
import cytoscape from 'cytoscape';
import { fmt, short, categoryRu, categoryRuFull, categoryIcon, type WalletReport, type TraceResult, type GraphNode, type UnmixFinding } from '../api';
import type { TraceResultLeak } from '../api';
import { haptic } from '../tg';

// Экран расследования (редизайн 17.11: «серый и не особо понятный» → наглядный).
// Ключевые решения:
//  1) ВЕРДИКТ сверху: куда уходят деньги из целевого кошелька — до того, как
//     пользователь погрузился в граф;
//  2) контрастные узлы/рёбра: толщина ребра = объём USDT, ярко-янтарные — крупнейшие
//     потоки, стрелки направления, пульсирующая красная «ЦЕЛЬ»;
//  3) ИТОГ-карточки утечек с долей и типом контрагента;
//  4) unmix-матчинг миксеров показывается отдельно с вероятностями.
// Палитра типов узлов. Приоритет честности: метка провайдера > структурная
// эвристика (probable: полупрозрачный цвет + «?» + пунктирная рамка) >
// личный/неопознанный. Цвета различимы между собой.
const CAT_COLORS: Record<string, string> = {
  cex: '#3B82F6', tgbots: '#EC4899', service: '#2DD4BF', payment: '#F59E0B', bridge: '#8B5CF6',
  mixer: '#FF2800', scam: '#FF4D6D', sanctioned: '#E5E7EB', contract: '#6B7280',
  token: '#10B981', personal: '#9CA3AF',
};
const CAT_ORDER = ['cex', 'tgbots', 'service', 'payment', 'bridge', 'mixer', 'scam', 'sanctioned', 'contract', 'token', 'personal'];
const DANGER_CATS = new Set(['mixer', 'scam', 'sanctioned']);

function colorOf(n: GraphNode): string {
  const base = CAT_COLORS[n.category ?? 'personal'] ?? '#9CA3AF';
  return n.probable ? `${base}99` : base;
}

function nodeLabel(n: GraphNode): string {
  if (n.isRoot) return '🎯 ЦЕЛЬ';
  const icon = categoryIcon(n.category);
  if (n.label) {
    const name = n.label.length > 18 ? `${n.label.slice(0, 17)}…` : n.label;
    return `${icon} ${name}${n.probable && !n.label.endsWith('?') ? ' ?' : ''}`;
  }
  return `${icon} ${short(n.addr, 8, 4)}${n.probable ? ' ?' : ''}`;
}

function chipLabel(cat: string, allProbable: boolean): string {
  if (cat === 'service' && allProbable) return 'Биржа/сервис?';
  if (cat === 'personal') return 'Личный/неопознанный';
  return categoryRu(cat);
}

type Verdict = { tone: 'bad' | 'warn' | 'ok'; icon: string; title: string; detail: string };

function computeVerdict(nodes: GraphNode[], leaks: TraceResultLeak[]): Verdict {
  const dangerLeaks = leaks.filter((l) => DANGER_CATS.has(l.category ?? ''));
  const dangerShare = dangerLeaks.reduce((s, l) => s + l.share, 0);
  const cnt = (c: string) => nodes.filter((n) => !n.isRoot && n.category === c).length;
  const mixerCnt = cnt('mixer'), scamCnt = cnt('scam'), sancCnt = cnt('sanctioned');
  const dangerCnt = mixerCnt + scamCnt + sancCnt;

  if (dangerShare > 0.02) {
    const names = [...new Set(dangerLeaks.map((l) => categoryRuFull(l.category, l.probable)))].join(', ');
    return {
      tone: 'bad', icon: '🚨', title: `Высокий риск: ~${Math.round(dangerShare * 100)}% исходящих уходит в рисковые точки`,
      detail: `${names}. Это прямые переводы от целевого кошелька — самые надёжные сигналы.`,
    };
  }
  if (dangerCnt > 0) {
    const parts: string[] = [];
    if (mixerCnt) parts.push(`миксеров ${mixerCnt}`);
    if (scamCnt) parts.push(`скам-адресов ${scamCnt}`);
    if (sancCnt) parts.push(`санкционных ${sancCnt}`);
    return {
      tone: 'warn', icon: '⚠️', title: 'В графе есть рисковые узлы',
      detail: `${parts.join(' · ')}. Прямые исходящие платежи целевого кошелька — на нейтральные адреса, но рисковые точки в его окружении.`,
    };
  }
  return {
    tone: 'ok', icon: '✅', title: 'Рисковых конечных точек не найдено',
    detail: 'Среди прямых исходящих нет миксеров, скам- и санкционных адресов. Это не гарантия чистоты — смотрите AML-скоринг в отчёте.',
  };
}

export default function Graph({ report, trace, onOpenAddr }: {
  report: WalletReport | null;
  trace: TraceResult | null;
  onOpenAddr: (addr: string) => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<cytoscape.Core | null>(null);
  const [selected, setSelected] = useState<GraphNode | null>(null);
  const [minEdge, setMinEdge] = useState(0);
  const [showLabels, setShowLabels] = useState(true);

  const nodes = trace?.nodes ?? [];
  const edges = trace?.edges ?? [];
  const unmix = (trace?.unmix ?? []) as UnmixFinding[];

  // ВЕРДИКТ: считается из прямых исходящих (leaks) и рисковых узлов графа.
  const verdict = useMemo(() => computeVerdict(nodes, trace?.leaks ?? []), [nodes, trace]);

  // Стат-чипы: узлы/связи/глубина/оборот в графе.
  const stats = useMemo(() => {
    const turnover = edges.reduce((s, e) => s + e.amount, 0);
    return [
      { k: 'Узлов', v: String(nodes.length) },
      { k: 'Связей', v: String(edges.length) },
      { k: 'Глубина', v: `${trace?.depth ?? 2} хоп.` },
      { k: 'Оборот', v: `${fmt(turnover, 0)} ${edges[0]?.asset ?? ''}` },
    ];
  }, [nodes, edges, trace]);

  // Легенда: какие категории реально есть в графе (+ сколько узлов каждого типа).
  const legend = useMemo(() => {
    const m = new Map<string, { count: number; allProbable: boolean }>();
    for (const n of nodes) {
      const k = n.category ?? 'personal';
      const cur = m.get(k) ?? { count: 0, allProbable: true };
      cur.count += 1;
      cur.allProbable = cur.allProbable && !!n.probable;
      m.set(k, cur);
    }
    return [...m.entries()]
      .sort((a, b) => CAT_ORDER.indexOf(a[0]) - CAT_ORDER.indexOf(b[0]))
      .map(([cat, v]) => ({ cat, ...v }));
  }, [nodes]);

  // Подписи сумм — только на топ-12 рёбрах по объёму, иначе полотно = шум.
  const topEdgeIdx = useMemo(
    () => new Set(edges.map((e, i) => [e.amount, i] as const).sort((a, b) => b[0] - a[0]).slice(0, 12).map((x) => x[1])),
    [edges],
  );

  useEffect(() => {
    if (!wrapRef.current || nodes.length === 0) return;
    const rootId = nodes.find((n) => n.isRoot)?.id;
    const els = [
      ...nodes.map((n) => ({
        data: {
          id: n.id,
          label: nodeLabel(n),
          color: n.isRoot ? '#FF2800' : colorOf(n), // цель — красное ядро, как на радаре запуска
          size: Math.max(18, Math.min(52, 14 + Math.sqrt(Math.max(1, n.volume)) * 0.16)),
          marked: (!!n.category && n.category !== 'personal') || !!n.probable,
        },
      })),
      ...edges.map((e, i) => ({
        data: {
          id: `e${i}`,
          source: e.from,
          target: e.to,
          label: `${fmt(e.amount, 0)} ${e.asset}`,
          probable: e.probable,
          top: topEdgeIdx.has(i),
          width: Math.min(7, 1.6 + Math.log10(Math.max(1, e.amount)) / 1.35),
        },
      })),
    ];
    const cy = cytoscape({
      container: wrapRef.current,
      elements: els,
      style: [
        { selector: 'node', style: {
          'background-color': 'data(color)',
          label: showLabels ? 'data(label)' : '',
          color: '#F2F2F3',
          'font-size': 10,
          'font-weight': 600,
          'font-family': 'JetBrains Mono, monospace',
          'text-valign': 'bottom',
          'text-margin-y': 7,
          'text-outline-color': '#0A0A0B',
          'text-outline-width': 2.5,
          width: 'data(size)',
          height: 'data(size)',
          'border-width': (el) => (el.data('marked') ? 2 : 0),
          'border-style': 'dashed',
          'border-color': '#F59E0B',
        } as cytoscape.Css.Node },
        { selector: 'node.is-root', style: {
          'border-width': 3.5,
          'border-style': 'solid',
          'border-color': '#FF2800',
          'shadow-blur': 22,
          'shadow-color': '#FF2800',
          'shadow-opacity': 0.85,
        } as cytoscape.Css.Node },
        { selector: 'edge', style: {
          width: 'data(width)',
          'line-color': (el) => (el.data('top') ? '#F59E0B' : '#43434E'),
          'target-arrow-shape': 'triangle',
          'target-arrow-color': (el) => (el.data('top') ? '#F59E0B' : '#43434E'),
          'arrow-scale': 1.1,
          'curve-style': 'bezier',
          label: (el) => {
            const i = parseInt(String(el.id()).slice(1), 10);
            return showLabels && topEdgeIdx.has(i) ? el.data('label') : '';
          },
          'font-size': 9,
          'font-weight': 700,
          color: (el) => (el.data('top') ? '#FFD166' : '#A0A0A8'),
          'text-background-color': '#0A0A0B',
          'text-background-opacity': 0.8,
          'text-background-padding': '2px',
          'text-rotation': 'autorotate',
          'line-style': (el) => (el.data('probable') ? 'dashed' : 'solid'),
        } as cytoscape.Css.Edge },
      ],
      layout: { name: 'cose', animate: true, animationDuration: 400, padding: 40 } as cytoscape.LayoutOptions,
    });
    cy.nodes().forEach((n) => {
      if (n.data('id') === nodes[0]?.id) n.addClass('is-root');
    });
    // Пульс «ЦЕЛИ»: чередуем свечение ядра — глаз сразу находит проверяемый кошелёк.
    let flip = false;
    const pulseIv = setInterval(() => {
      flip = !flip;
      cy.batch(() => {
        cy.nodes().filter((n) => n.id() === rootId).style('shadow-opacity', flip ? 0.9 : 0.3);
      });
    }, 850);
    cy.on('tap', 'node', (evt) => {
      haptic();
      const id = evt.target.id() as string;
      const n = nodes.find((x) => x.id === id);
      setSelected(n ?? null);
    });
    cy.on('tap', (evt) => {
      if (evt.target === cy) setSelected(null);
    });
    cyRef.current = cy;
    return () => { clearInterval(pulseIv); cy.destroy(); cyRef.current = null; };
  }, [trace, showLabels, topEdgeIdx]);

  useEffect(() => {
    // min edge filter
    const cy = cyRef.current;
    if (!cy) return;
    cy.edges().forEach((e) => {
      const idx = parseInt(e.id().slice(1), 10);
      const ed = edges[idx];
      if (ed) e.style('display', ed.amount >= minEdge ? 'element' : 'none');
    });
  }, [minEdge]);

  return (
    <div className="fade-in" style={{ padding: 14 }}>
      <div className="microlabel" style={{ marginBottom: 8, fontSize: 11 }}>
        Расследование · {trace?.chain?.toUpperCase() ?? report?.chains[0]?.chain?.toUpperCase()}
      </div>

      {/* ВЕРДИКТ — главное, что должен понять пользователь до чтения графа */}
      <div className={`verdict verdict-${verdict.tone}`} style={{ marginBottom: 10 }}>
        <span style={{ fontSize: 20, lineHeight: 1.1 }}>{verdict.icon}</span>
        <div>
          <div style={{ fontWeight: 700, fontSize: 13.5 }}>{verdict.title}</div>
          <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 2, lineHeight: 1.45 }}>{verdict.detail}</div>
        </div>
      </div>

      {/* Стат-чипы */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
        {stats.map((s) => (
          <span key={s.k} className="stat-chip">{s.k}: <b>{s.v}</b></span>
        ))}
      </div>

      {legend.length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
          {legend.map((l) => (
            <span key={l.cat} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, background: '#17171C', border: '1px solid var(--border)', borderRadius: 999, padding: '4px 9px' }}>
              <span style={{ width: 9, height: 9, borderRadius: '50%', background: CAT_COLORS[l.cat] ?? '#9CA3AF', flexShrink: 0 }} />
              <span style={{ color: '#F2F2F3' }}>{categoryIcon(l.cat)} {chipLabel(l.cat, l.allProbable)}</span>
              <span style={{ color: 'var(--muted)' }}>×{l.count}</span>
            </span>
          ))}
        </div>
      )}

      <details className="guide" style={{ marginBottom: 8 }}>
        <summary>❓ Как читать граф</summary>
        <div style={{ marginTop: 6, lineHeight: 1.55 }}>
          Стрелка = направление перевода, толщина = объём, янтарный цвет = крупнейший поток.
          Белый узел с красной рамкой и свечением — проверяемый кошелёк (ЦЕЛЬ).
          Цвет узла = тип: 🏦 биржа · 🔧 сервис/биржа? · 💳 платёжный · 🌉 мост · 🌀 миксер · 🚨 скам · ⛔ санкционный · 🤖 Telegram-бот · 👤 личный/неопознанный.
          Полупрозрачный узел со «?» и пунктирной рамкой — предположение по структуре потоков, не метка провайдера.
          Тап по узлу — детали и переход к его отчёту.
        </div>
      </details>

      <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
        <button className="btn" style={{ fontSize: 11, padding: '7px 10px' }} onClick={() => setShowLabels(!showLabels)}>{showLabels ? 'Скрыть подписи' : 'Показать подписи'}</button>
        <button className="btn" style={{ fontSize: 11, padding: '7px 10px' }} onClick={() => { setMinEdge(0); }}>Все суммы</button>
        <button className="btn" style={{ fontSize: 11, padding: '7px 10px' }} onClick={() => setMinEdge(1000)}>≥ 1000</button>
        <button className="btn" style={{ fontSize: 11, padding: '7px 10px' }} onClick={() => setMinEdge(10000)}>≥ 10k</button>
      </div>
      <div id="graph-wrap" ref={wrapRef} style={{
        height: 460,
        background: 'radial-gradient(900px 420px at 50% 0%, #15151B 0%, #0F0F12 60%)',
        border: '1px solid var(--border)', borderRadius: 14, position: 'relative', overflow: 'hidden',
      }}>
        {selected && (
          <div className="side-sheet fade-in">
            <div className="microlabel">{selected.isRoot ? 'Целевой узел' : categoryRuFull(selected.category, selected.probable)}</div>
            {selected.probable && !selected.isRoot && (
              <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>оценка по структуре потоков — не метка провайдера</div>
            )}
            <div className="mono" style={{ fontSize: 11, margin: '4px 0', wordBreak: 'break-all' }}>{selected.addr}</div>
            {selected.label && <div style={{ fontSize: 12, color: 'var(--warn)' }}>🏷 {selected.label}</div>}
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
              объём {fmt(selected.volume)} · вход {fmt(selected.in)} · выход {fmt(selected.out)} · {selected.txCount} tx
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <button className="btn btn-red" style={{ fontSize: 12, padding: '8px 12px' }} onClick={() => onOpenAddr(selected.addr)}>Открыть отчёт по нему</button>
              <button className="btn" style={{ fontSize: 12, padding: '8px 12px' }} onClick={() => setSelected(null)}>Закрыть</button>
            </div>
          </div>
        )}
      </div>

      {/* Unmix: статистическое распутывание миксеров (вероятностный матчинг) */}
      {unmix.length > 0 && (
        <>
          <div className="microlabel" style={{ margin: '16px 4px 6px' }}>Unmix · распутывание миксеров · {unmix.length}</div>
          <div className="card">
            {unmix.map((u, i) => (
              <div key={i} style={{ padding: '8px 0', borderTop: i ? '1px solid var(--border)' : undefined }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--danger)' }}>🌀 {u.mixerLabel ?? 'Миксер'} · <span className="mono" style={{ fontSize: 11 }}>{short(u.mixer, 8, 6)}</span></div>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 3, lineHeight: 1.45 }}>{u.note}</div>
                {u.links.slice(0, 6).map((l, j) => (
                  <div key={j} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, fontSize: 12, marginTop: 6 }}>
                    <span className="mono" style={{ color: 'var(--info)', cursor: 'pointer' }} onClick={() => onOpenAddr(l.from)}>{short(l.from, 6, 4)}</span>
                    <span className="mono" style={{ color: 'var(--muted)', whiteSpace: 'nowrap' }}>{fmt(l.amount)} · связь ~{Math.round(l.p * 100)}%</span>
                    <span className="mono" style={{ color: 'var(--warn)', cursor: 'pointer' }} onClick={() => onOpenAddr(l.to)}>{short(l.to, 6, 4)}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </>
      )}

      {trace?.leaks && trace.leaks.length > 0 && (
        <>
          <div className="microlabel" style={{ margin: '16px 4px 8px' }}>Итог · куда уходят деньги · направлений {trace.leaks.length}</div>
          {trace.leaks.slice(0, 10).map((l, i) => (
            <LeakCard key={i} l={l} rank={i + 1} onOpenAddr={onOpenAddr} />
          ))}
        </>
      )}

      {trace?.truncated && (
        <div className="card2" style={{ marginTop: 10, borderColor: 'rgba(245,158,11,.4)' }}>
          <div style={{ fontSize: 12, color: 'var(--warn)' }}>⚠️ Граф недостроен: остановился по бюджету запросов free-тарифов.</div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 3 }}>Кнопка «продолжить глубже» в боте достроит граф с этого места.</div>
        </div>
      )}
      <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 10, lineHeight: 1.5 }}>
        Вероятностные оценки по публичным данным блокчейна. Не является доказательством.
      </div>
    </div>
  );
}

// Итоговая карточка утечки: тип контрагента цветом, доля исходящих, сумма, переход к отчёту.
function LeakCard({ l, rank, onOpenAddr }: {
  l: TraceResultLeak;
  rank: number;
  onOpenAddr: (addr: string) => void;
}) {
  const cat = l.category ?? 'personal';
  const col = CAT_COLORS[cat] ?? '#9CA3AF';
  const danger = DANGER_CATS.has(cat);
  const pct = Math.max(2, Math.round(l.share * 100));
  return (
    <div className={`leak-card ${danger ? 'leak-danger' : ''}`} style={{ borderLeftColor: col }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', minWidth: 0 }}>
          <span style={{ fontSize: 18 }}>{categoryIcon(cat)}</span>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 12.5, fontWeight: 600, color: danger ? 'var(--danger)' : 'var(--text)' }}>
              {categoryRuFull(cat, l.probable)} {danger && '· риск'}
            </div>
            <span className="mono" style={{ fontSize: 11, color: 'var(--info)', cursor: 'pointer', wordBreak: 'break-all' }} onClick={() => onOpenAddr(l.addr)}>
              {short(l.addr, 8, 6)}{l.label && !l.label.endsWith('?') ? ` · ${l.label}` : ''}
            </span>
          </div>
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <div className="mono" style={{ fontSize: 13, fontWeight: 700 }}>{fmt(l.amount)} {l.asset}</div>
          <div style={{ fontSize: 11, color: 'var(--muted)' }}>#{rank} · {pct}% исходящих</div>
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 7 }}>
        <div style={{ flex: 1, height: 6, background: '#1C1C22', borderRadius: 3, overflow: 'hidden' }}>
          <div style={{ width: `${pct}%`, height: '100%', background: danger ? 'var(--danger)' : col }} />
        </div>
      </div>
    </div>
  );
}
