import { useEffect, useMemo, useRef, useState } from 'react';
import cytoscape from 'cytoscape';
import { fmt, short, categoryRu, categoryRuFull, categoryIcon, type WalletReport, type TraceResult, type GraphNode } from '../api';
import { haptic } from '../tg';

// Палитра типов узлов. Приоритет честности: метка провайдера > структурная
// эвристика (probable: полупрозрачный цвет + «?» + пунктирная рамка) >
// личный/неопознанный. Цвета различимы между собой.
const CAT_COLORS: Record<string, string> = {
  cex: '#3B82F6', tgbots: '#EC4899', service: '#2DD4BF', payment: '#F59E0B', bridge: '#8B5CF6',
  mixer: '#FF2800', scam: '#FF4D6D', sanctioned: '#E5E7EB', contract: '#6B7280',
  token: '#10B981', personal: '#9CA3AF',
};
const CAT_ORDER = ['cex', 'tgbots', 'service', 'payment', 'bridge', 'mixer', 'scam', 'sanctioned', 'contract', 'token', 'personal'];

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
    const els = [
      ...nodes.map((n) => ({
        data: {
          id: n.id,
          label: nodeLabel(n),
          color: colorOf(n),
          size: Math.max(14, Math.min(46, 12 + Math.sqrt(Math.max(1, n.volume)) * 0.15)),
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
          'font-size': 9,
          'font-family': 'JetBrains Mono, monospace',
          'text-valign': 'bottom',
          'text-margin-y': 6,
          width: 'data(size)',
          height: 'data(size)',
          'border-width': (el) => (el.data('marked') ? 2 : 0),
          'border-style': 'dashed',
          'border-color': '#F59E0B',
        } as cytoscape.Css.Node },
        { selector: 'node.is-root', style: {
          'border-width': 3,
          'border-color': '#FF2800',
          'shadow-blur': 18,
          'shadow-color': '#FF2800',
          'shadow-opacity': 0.8,
        } as cytoscape.Css.Node },
        { selector: 'edge', style: {
          width: 1.5,
          'line-color': '#3A3A42',
          'curve-style': 'bezier',
          label: (el) => {
            const i = parseInt(String(el.id()).slice(1), 10);
            return showLabels && topEdgeIdx.has(i) ? el.data('label') : '';
          },
          'font-size': 8,
          color: '#8A8A90',
          'text-rotation': 'autorotate',
          'line-style': (el) => (el.data('probable') ? 'dashed' : 'solid'),
        } as cytoscape.Css.Edge },
      ],
      layout: { name: 'cose', animate: true, animationDuration: 400, padding: 30 } as cytoscape.LayoutOptions,
    });
    cy.nodes().forEach((n) => {
      if (n.data('id') === nodes[0]?.id) n.addClass('is-root');
    });
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
    return () => { cy.destroy(); cyRef.current = null; };
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
      <div className="microlabel" style={{ marginBottom: 8 }}>
        Граф потоков · {trace?.chain?.toUpperCase() ?? report?.chains[0]?.chain?.toUpperCase()} · узлов {nodes.length} · связей {edges.length}
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
      <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
        <button className="btn" style={{ fontSize: 11, padding: '7px 10px' }} onClick={() => setShowLabels(!showLabels)}>{showLabels ? 'Скрыть подписи' : 'Показать подписи'}</button>
        <button className="btn" style={{ fontSize: 11, padding: '7px 10px' }} onClick={() => { setMinEdge(0); }}>Все суммы</button>
        <button className="btn" style={{ fontSize: 11, padding: '7px 10px' }} onClick={() => setMinEdge(1000)}>≥ 1000</button>
        <button className="btn" style={{ fontSize: 11, padding: '7px 10px' }} onClick={() => setMinEdge(10000)}>≥ 10k</button>
      </div>
      <div id="graph-wrap" ref={wrapRef} style={{
        height: 420, background: '#0F0F12', border: '1px solid var(--border)', borderRadius: 14, position: 'relative', overflow: 'hidden',
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
      {trace?.leaks && trace.leaks.length > 0 && (
        <>
          <div className="microlabel" style={{ margin: '14px 4px 6px' }}>Куда утекло · направлений {trace.leaks.length}</div>
          <div className="card">
            {trace.leaks.slice(0, 10).map((l, i) => {
              const col = CAT_COLORS[l.category ?? 'personal'] ?? '#9CA3AF';
              return (
                <div key={i} style={{ padding: '7px 0', borderTop: i ? '1px solid var(--border)' : undefined }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 12 }}>
                    <span className="mono" style={{ color: 'var(--info)', cursor: 'pointer' }} onClick={() => onOpenAddr(l.addr)}>
                      {categoryIcon(l.category)} {short(l.addr)}{l.label && !l.label.endsWith('?') ? ` · ${l.label}` : ''}
                    </span>
                    <span className="mono" style={{ whiteSpace: 'nowrap' }}>{fmt(l.amount)} {l.asset} · {Math.round(l.share * 100)}%</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 5 }}>
                    <div style={{ flex: 1, height: 5, background: '#1C1C22', borderRadius: 3, overflow: 'hidden' }}>
                      <div style={{ width: `${Math.max(2, Math.round(l.share * 100))}%`, height: '100%', background: col }} />
                    </div>
                    <span style={{ fontSize: 11, color: l.category && l.category !== 'personal' ? 'var(--warn)' : 'var(--muted)' }}>
                      {categoryRuFull(l.category, l.probable)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
      {trace?.truncated && <div style={{ fontSize: 12, color: 'var(--warn)', marginTop: 8 }}>⚠️ Остановился по бюджету запросов — кнопка «продолжить глубже» в боте достроит граф.</div>}
      <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 8, lineHeight: 1.5 }}>
        Цвет узла = тип: 🏦 биржа · 🔧 сервис/биржа? · 💳 платёжный · 🌉 мост · 🌀 миксер · 🚨 скам · ⛔ санкционный · 👤 личный/неопознанный. Полупрозрачный узел со «?» — предположительно (эвристика по структуре потоков). Белый с красной рамкой — цель. Размер = объём движений.
      </div>
    </div>
  );
}
