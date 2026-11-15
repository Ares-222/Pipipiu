import { useEffect, useRef, useState } from 'react';
import cytoscape from 'cytoscape';
import { fmt, short, type WalletReport, type TraceResult, type GraphNode } from '../api';
import { haptic } from '../tg';

const CAT_COLORS: Record<string, string> = {
  cex: '#FF2800', payment: '#F59E0B', mixer: '#A855F7', bridge: '#3B82F6',
  scam: '#FF2800', sanctioned: '#E5E7EB', contract: '#6B7280', service: '#38BDF8', personal: '#9CA3AF',
};

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

  useEffect(() => {
    if (!wrapRef.current || nodes.length === 0) return;
    const els = [
      ...nodes.map((n) => ({
        data: {
          id: n.id,
          label: n.isRoot ? 'ЦЕЛЬ' : (n.label ?? short(n.addr, 8, 4)),
          color: n.isRoot ? '#FFFFFF' : (CAT_COLORS[n.category ?? 'personal'] ?? '#9CA3AF'),
          size: Math.max(14, Math.min(46, 12 + Math.sqrt(Math.max(1, n.volume)) * 0.15)),
          marked: !!n.category && n.category !== 'personal',
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
          label: showLabels ? 'data(label)' : '',
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
  }, [trace, showLabels]);

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
            <div className="microlabel">{selected.isRoot ? 'Целевой узел' : (selected.category ?? 'контрагент')}</div>
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
          <div className="microlabel" style={{ margin: '14px 4px 6px' }}>Куда утекло</div>
          <div className="card">
            {trace.leaks.slice(0, 10).map((l, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', fontSize: 12 }}>
                <span className="mono" style={{ color: 'var(--info)', cursor: 'pointer' }} onClick={() => onOpenAddr(l.addr)}>{short(l.addr)}{l.label ? ` · ${l.label}` : ''}</span>
                <span className="mono">{fmt(l.amount)} {l.asset} · {Math.round(l.share * 100)}%</span>
              </div>
            ))}
          </div>
        </>
      )}
      {trace?.truncated && <div style={{ fontSize: 12, color: 'var(--warn)', marginTop: 8 }}>⚠️ Остановился по бюджету запросов — кнопка «продолжить глубже» в боте достроит граф.</div>}
      <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 8 }}>Пунктирное кольцо — помеченный узел. Белый с красной рамкой — цель. Размер = объём движений.</div>
    </div>
  );
}
