import { useEffect, useMemo, useRef, useState } from 'react';
import cytoscape from 'cytoscape';
import { fmt, short, categoryRu, categoryRuFull, categoryIcon, CAT_COLORS, DANGER_CATS, computeGraphVerdict, type WalletReport, type TraceResult, type GraphNode, type GraphEdge, type UnmixFinding } from '../api';
import type { TraceResultLeak } from '../api';
import { haptic } from '../tg';
import { api } from '../api';
import { renderGraphPhoto } from '../graphPhoto';
import { renderFlowPhoto } from '../flowPhoto';

// Экран расследования (редизайн 17.11: «серый и не особо понятный» → наглядный;
// v7 19.11: + фото графа/потока в чат, структурные находки, теги пил-чейн/общий источник).
// Ключевые решения:
//  1) ВЕРДИКТ сверху: куда уходят деньги из целевого кошелька — до того, как
//     пользователь погрузился в граф;
//  2) контрастные узлы/рёбра: толщина ребра = объём USDT, ярко-янтарные — крупнейшие
//     потоки, стрелки направления, пульсирующая красная «ЦЕЛЬ»;
//  3) ИТОГ-карточки утечек с долей и типом контрагента;
//  4) unmix-матчинг миксеров показывается отдельно с вероятностями.
// Палитра типов узлов — в api.ts (общая с фото-рендером). Приоритет честности:
// метка провайдера > структурная эвристика (probable: полупрозрачный цвет + «?» +
// пунктирная рамка) > личный/неопознанный.

const CAT_ORDER = ['cex', 'tgbots', 'service', 'payment', 'bridge', 'mixer', 'scam', 'sanctioned', 'contract', 'token', 'personal'];

// v7.2.1: тикер нативной монеты по сети — для строки «Баланс сейчас» (формат как в отчёте).
const CHAIN_ASSET: Record<string, string> = { tron: 'TRX', ton: 'TON', btc: 'BTC', sol: 'SOL', bsc: 'BNB', polygon: 'POL', eth: 'ETH' };

function colorOf(n: GraphNode): string {
  const base = CAT_COLORS[n.category ?? 'personal'] ?? '#9CA3AF';
  return n.probable ? `${base}99` : base;
}

// Компактные суммы для второй строки подписи узла: 12500 → «12,5k», 3_400_000 → «3,4M».
function kf(n: number): string {
  const a = Math.abs(n);
  if (a >= 1e6) return `${(n / 1e6).toFixed(a >= 1e7 ? 0 : 1).replace('.', ',')}M`;
  if (a >= 1e3) return `${(n / 1e3).toFixed(a >= 1e4 ? 0 : 1).replace('.', ',')}k`;
  return fmt(n, 0);
}

// Подпись узла. Вторая строка (вх/вых) — только у прямых контактов ЦЕЛИ и у хабов:
// пользователь должен видеть ЦИФРЫ прямо на графе, не догадываясь, что за адрес.
function nodeLabel(n: GraphNode, direct: boolean, hub: boolean): string {
  if (n.isRoot) return '🎯 ЦЕЛЬ';
  const icon = categoryIcon(n.category);
  const name = n.label
    ? (n.label.length > 18 ? `${n.label.slice(0, 17)}…` : n.label)
    : short(n.addr, 8, 4);
  const q = n.probable && !n.label?.endsWith('?') ? ' ?' : '';
  const line1 = `${hub && !direct ? '◉ ' : ''}${icon} ${name}${q}`;
  if (direct || hub) return `${line1}\nвх ${kf(n.in)} · вых ${kf(n.out)}`;
  return line1;
}

function chipLabel(cat: string, allProbable: boolean): string {
  if (cat === 'service' && allProbable) return 'Биржа/сервис?';
  if (cat === 'personal') return 'Без метки · просто адрес';
  return categoryRu(cat);
}

type Verdict = { tone: 'bad' | 'warn' | 'ok'; icon: string; title: string; detail: string };

export default function Graph({ report, trace, onOpenAddr, notify }: {
  report: WalletReport | null;
  trace: TraceResult | null;
  onOpenAddr: (addr: string) => void;
  notify: (m: string) => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<cytoscape.Core | null>(null);
  const [selected, setSelected] = useState<GraphNode | null>(null);
  const [minEdge, setMinEdge] = useState(0);
  const [showLabels, setShowLabels] = useState(true);
  const [photoBusy, setPhotoBusy] = useState('');
  const [showDemoUnmix, setShowDemoUnmix] = useState(false);
  // v7.2: вид графа. «Схема потоков» — новый наглядный вид по умолчанию (жалоба
  // заказчика 19.11: радиальная паутина нечитаема); «Радар» — прежний cytoscape-вид.
  const [viewMode, setViewMode] = useState<'scheme' | 'web'>('scheme');

  // v7 (№16/№17): фото расследования и потока средств в чат — рендер в клиенте,
  // воркер только релеит JPEG в sendPhoto. Красиво и наглядно, без скриншота webview.
  async function sendPhoto(kind: 'graph' | 'flow') {
    if (!trace) return;
    haptic(); setPhotoBusy(kind);
    try {
      const jpeg = kind === 'graph' ? await renderGraphPhoto(trace) : await renderFlowPhoto(trace);
      const caption = kind === 'graph'
        ? `🔍 Расследование ${trace.chain.toUpperCase()} · ${short(trace.root, 8, 6)} · радар: ЦЕЛЬ → кольца связей`
        : `📤 Поток средств (root→leaks) · ${short(trace.root, 8, 6)} · толщина стрелки = доля исходящих`;
      await api('/render', { method: 'POST', body: JSON.stringify({ jpeg, caption }) });
      notify('📸 Фото отправлено в чат');
    } catch (e) { notify('⚠️ ' + (e as Error).message); } finally { setPhotoBusy(''); }
  }

  const nodes = trace?.nodes ?? [];
  const edges = trace?.edges ?? [];
  const unmix = (trace?.unmix ?? []) as UnmixFinding[];

  // v7.2.1: баланс цели «на данный момент» — из паспорта (report, account.balanceNative).
  // Паспорта нет (граф открыт без отчёта) — честно не показываем, не выдумываем.
  const crBal = report?.chains.find((c) => c.chain === trace?.chain) ?? report?.chains[0];
  const balAsset = CHAIN_ASSET[crBal?.chain ?? trace?.chain ?? ''] ?? '';
  const bal = crBal?.account?.balanceNative;
  const hasBal = typeof bal === 'number' && Number.isFinite(bal);
  const balLine = hasBal ? `${fmt(bal, 2)} ${balAsset}` : undefined;

  // ВЕРДИКТ: считается из прямых исходящих (leaks) и рисковых узлов графа.
  const verdict = useMemo(() => computeGraphVerdict(nodes, trace?.leaks ?? []), [nodes, trace]);

  // Стат-чипы: узлы/связи/глубина/оборот в графе + баланс цели на данный момент.
  const stats = useMemo(() => {
    const turnover = edges.reduce((s, e) => s + e.amount, 0);
    const arr = [
      { k: 'Узлов', v: String(nodes.length) },
      { k: 'Связей', v: String(edges.length) },
      { k: 'Глубина', v: `${trace?.depth ?? 2} хоп.` },
      { k: 'Оборот', v: `${fmt(turnover, 0)} ${edges[0]?.asset ?? ''}` },
    ];
    if (balLine) arr.push({ k: 'Баланс сейчас', v: balLine });
    return arr;
  }, [nodes, edges, trace, balLine]);

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

  // Прямой 1-й круг: узлы, соединённые с ЦЕЛЬЮ ребром напрямую (между ними были
  // переводы). Всё остальное — дальние связи 2-го круга (посредники). Это главный
  // ответ на вопрос «что за адреса вне потоков».
  const rootId = nodes.find((n) => n.isRoot)?.id;
  const hop1Ids = useMemo(() => {
    if (!rootId) return new Set<string>();
    const s = new Set<string>();
    for (const e of edges) {
      if (e.from === rootId && e.to !== rootId) s.add(e.to);
      if (e.to === rootId && e.from !== rootId) s.add(e.from);
    }
    return s;
  }, [nodes, edges, rootId]);

  // Хабы: топ-3 узла по обороту (кроме ЦЕЛИ) — крупные транзитные точки, через
  // которые шли деньги. ◉ в подписи + вторая строка с суммами.
  const hubIds = useMemo(
    () => new Set(nodes.filter((n) => !n.isRoot).sort((a, b) => b.volume - a.volume).slice(0, 3).map((n) => n.id)),
    [nodes],
  );

  useEffect(() => {
    if (viewMode !== 'web' || !wrapRef.current || nodes.length === 0) return;
    const els = [
      ...nodes.map((n) => ({
        data: {
          id: n.id,
          label: nodeLabel(n, hop1Ids.has(n.id), hubIds.has(n.id)),
          color: n.isRoot ? '#D40000' : colorOf(n), // цель — красное ядро, как на радаре запуска
          size: Math.max(18, Math.min(52, 14 + Math.sqrt(Math.max(1, n.volume)) * 0.16)),
          marked: (!!n.category && n.category !== 'personal') || !!n.probable,
        },
        classes: hop1Ids.has(n.id) ? (hubIds.has(n.id) ? 'hop1 hub' : 'hop1') : (hubIds.has(n.id) ? 'far hub' : 'far'),
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
        classes: rootId && (e.from === rootId || e.to === rootId) ? 'direct' : '',
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
        // Прямой контакт цели: сплошная яркая рамка В ЦВЕТ узла — «между ними были переводы».
        { selector: 'node.hop1', style: {
          'border-width': 3,
          'border-style': 'solid',
          'border-color': 'data(color)',
          opacity: 1,
        } as cytoscape.Css.Node },
        // Дальняя связь: полупрозрачная, тонкая серая рамка — «второстепенный адрес».
        { selector: 'node.far', style: {
          'border-width': 1,
          'border-style': 'solid',
          'border-color': '#3A3A44',
          opacity: 0.62,
        } as cytoscape.Css.Node },
        { selector: 'node.hub', style: { 'font-size': 11.5 } },
        { selector: 'node.is-root', style: {
          'border-width': 3.5,
          'border-style': 'solid',
          'border-color': '#D40000',
          'shadow-blur': 22,
          'shadow-color': '#D40000',
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
        // Рёбра из/в ЦЕЛЬ: чуть светлее остальных серых — «переводы самого кошелька».
        { selector: 'edge.direct', style: {
          'line-color': (el) => (el.data('top') ? '#F59E0B' : '#71717F'),
          'target-arrow-color': (el) => (el.data('top') ? '#F59E0B' : '#71717F'),
        } as cytoscape.Css.Edge },
      ],
      // Концентрическая раскладка (17.11): граф = радар. ЦЕЛЬ — красное ядро в
      // центре, прямые контакты — первое кольцо, дальние связи — внешний круг.
      // Это буквально отвечает на вопрос «что за адреса вне потоков» и совпадает
      // с дизайном радара запуска. Cose давал широкую раскладку, не заполнявшую
      // вертикаль полотна.
      layout: {
        name: 'concentric', animate: true, animationDuration: 450, padding: 40,
        concentric: (n: cytoscape.NodeSingular) => (n.data('id') === rootId ? 100 : hop1Ids.has(n.data('id')) ? 70 : 40),
        levelWidth: () => 1.2,
        minNodeSpacing: 44,
        spacingFactor: 1.55,
      } as cytoscape.LayoutOptions,
    });
    // После раскладки вписываем граф в полотно целиком.
    cy.on('layoutstop', () => cy.fit(undefined, 40));
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
  }, [trace, showLabels, topEdgeIdx, viewMode]);

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
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 6 }}>
          {legend.map((l) => (
            <span key={l.cat} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, background: '#17171C', border: '1px solid var(--border)', borderRadius: 999, padding: '4px 9px' }}>
              <span style={{ width: 9, height: 9, borderRadius: '50%', background: CAT_COLORS[l.cat] ?? '#9CA3AF', flexShrink: 0 }} />
              <span style={{ color: '#F2F2F3' }}>{categoryIcon(l.cat)} {chipLabel(l.cat, l.allProbable)}</span>
              <span style={{ color: 'var(--muted)' }}>×{l.count}</span>
            </span>
          ))}
        </div>
      )}

      {/* v7.2: переключатель вида — «Схема потоков» (по умолчанию; жалоба 19.11 на радиальную паутину) / «Радар» */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        <button className={viewMode === 'scheme' ? 'btn btn-red' : 'btn'} style={{ fontSize: 12, padding: '8px 10px', flex: 1 }} onClick={() => { haptic(); setViewMode('scheme'); }}>▦ Схема потоков</button>
        <button className={viewMode === 'web' ? 'btn btn-red' : 'btn'} style={{ fontSize: 12, padding: '8px 10px', flex: 1 }} onClick={() => { haptic(); setViewMode('web'); }}>🕸 Радар связей</button>
      </div>

      {viewMode === 'scheme' ? (
        <>
          <div className="graph-hint" style={{ marginBottom: 8 }}>
            <b>Схема потоков:</b> сверху — проверяемый кошелёк (ЦЕЛЬ); ниже — кто входит и куда уходят деньги, сгруппировано по типам адресов. Полоса = доля направления; «?» — тип угадан по потокам, не метка провайдера. Тапни адрес — откроется отчёт по нему. Полный круг связей — во «🕸 Радаре».
          </div>
          <FlowScheme nodes={nodes} edges={edges} rootId={rootId} balLine={balLine} onOpenAddr={onOpenAddr} />
        </>
      ) : (
        <>
      {/* Визуальный язык графа — всегда на виду: размер, толщина, рамки, стрелки */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
        <span className="glyph-chip">⭕ размер круга = оборот адреса</span>
        <span className="glyph-chip">➜ толщина стрелки = сумма перевода</span>
        <span className="glyph-chip glyph-amber">янтарные стрелки — крупнейшие потоки</span>
        <span className="glyph-chip">
          <span style={{ width: 9, height: 9, borderRadius: '50%', border: '2px solid #55D6BE', flexShrink: 0 }} />
          яркая рамка — прямой контакт ({hop1Ids.size})
        </span>
        <span className="glyph-chip">
          <span style={{ width: 9, height: 9, borderRadius: '50%', border: '1px solid #3A3A44', opacity: 0.6, flexShrink: 0 }} />
          тусклые — дальние связи ({nodes.length - 1 - hop1Ids.size})
        </span>
        {(trace?.structure?.peel?.length ?? 0) > 0 && <span className="glyph-chip">⛓ узел пил-чейна</span>}
        {(trace?.structure?.funders?.length ?? 0) > 0 && <span className="glyph-chip">🔗 общий источник</span>}
      </div>

      {/* Шпаргалка одним взглядом — всегда раскрыта (details оставлен для деталей) */}
      <div className="graph-hint" style={{ marginBottom: 8 }}>
        <b>Граф — это радар:</b> в красном ядре — проверяемый кошелёк (ЦЕЛЬ); <b>первое кольцо</b> — прямые контакты ({hop1Ids.size}), с ними были переводы напрямую; <b>внешний круг</b> — дальние связи ({Math.max(0, nodes.length - 1 - hop1Ids.size)}) через посредников. Подпись — публичная метка или адрес; у первого кольца и хабов есть вторая строка: сколько вошло/вышло. <span style={{ color: 'var(--warn)' }}>Пунктирная янтарная рамка</span> = тип угадан по потокам (с «?»). Тапни круг — карточка с деталями.
      </div>

      <details className="guide" style={{ marginBottom: 8 }}>
        <summary>❓ Подробнее: цвета, стрелки, точность</summary>
        <div style={{ marginTop: 6, lineHeight: 1.55 }}>
          Стрелка = направление перевода, толщина = объём, янтарный цвет = крупнейший поток; рёбра из ЦЕЛИ и в ЦЕЛЬ чуть светлее остальных — это переводы самого кошелька.
          Красное ядро с свечением в центре — проверяемый кошелёк (ЦЕЛЬ). Первое кольцо вокруг ядра — прямые контакты (сплошная яркая рамка в цвет). Внешний круг — дальние связи (тусклые, полупрозрачные).
          Цвет круга = тип: 🏦 биржа · 🔧 сервис/биржа? · 💳 платёжный · 🌉 мост · 🌀 миксер · 🚨 скам · ⛔ санкционный · 🤖 Telegram-бот · 👤 без метки.
          Полупрозрачный узел со «?» и пунктирной рамкой — предположение по структуре потоков, не метка провайдера.
        </div>
      </details>

      <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
        <button className="btn" style={{ fontSize: 11, padding: '7px 10px' }} onClick={() => setShowLabels(!showLabels)}>{showLabels ? 'Скрыть подписи' : 'Показать подписи'}</button>
        <button className="btn" style={{ fontSize: 11, padding: '7px 10px' }} onClick={() => { setMinEdge(0); }}>Все суммы</button>
        <button className="btn" style={{ fontSize: 11, padding: '7px 10px' }} onClick={() => setMinEdge(1000)}>≥ 1000</button>
        <button className="btn" style={{ fontSize: 11, padding: '7px 10px' }} onClick={() => setMinEdge(10000)}>≥ 10k</button>
      </div>
      <div id="graph-wrap" ref={wrapRef} style={{
        height: 560,
        background: 'radial-gradient(900px 420px at 50% 0%, #15151B 0%, #0F0F12 60%)',
        border: '1px solid var(--border)', borderRadius: 14, position: 'relative', overflow: 'hidden',
      }}>
        {selected && (
          <div className="side-sheet fade-in">
            <div className="microlabel">{selected.isRoot ? 'Целевой узел' : categoryRuFull(selected.category, selected.probable)}</div>
            {selected.isRoot ? (
              <div style={{ fontSize: 11.5, color: 'var(--danger)', marginTop: 2 }}>🎯 проверяемый кошелёк — центр графа</div>
            ) : hop1Ids.has(selected.id) ? (
              <div style={{ fontSize: 11.5, color: 'var(--ok)', marginTop: 2 }}>🔗 прямой контакт с ЦЕЛЬЮ: между ними были переводы напрямую</div>
            ) : (
              <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 2 }}>○ дальняя связь: 2-й круг графа — связан с целью через посредников</div>
            )}
            {selected.probable && !selected.isRoot && (
              <div style={{ fontSize: 11, color: 'var(--warn)', marginTop: 2 }}>тип угадан по структуре потоков — не метка провайдера</div>
            )}
            {hubIds.has(selected.id) && !selected.isRoot && (
              <div style={{ fontSize: 11, color: 'var(--warn)', marginTop: 2 }}>◉ хаб: один из крупнейших по обороту в этой выборке</div>
            )}
            {selected.peel && (
              <div style={{ fontSize: 11, color: 'var(--warn)', marginTop: 2 }}>⛓ узел пил-чейна: «раздевающаяся» цепочка — каждый переход уносит большую часть объёма</div>
            )}
            {selected.assoc && (
              <div style={{ fontSize: 11, color: 'var(--info)', marginTop: 2 }}>🔗 у этого узла и ещё одного общий источник финансирования — косвенная связь</div>
            )}
            <div className="mono" style={{ fontSize: 11, margin: '4px 0', wordBreak: 'break-all' }}>{selected.addr}</div>
            {selected.label && <div style={{ fontSize: 12, color: 'var(--warn)' }}>🏷 {selected.label}</div>}
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4, lineHeight: 1.5 }}>
              Оборот: <b style={{ color: 'var(--text)' }}>{fmt(selected.volume)}</b> · вход {fmt(selected.in)} · выход {fmt(selected.out)} · {selected.txCount} tx
            </div>
            {selected.isRoot && balLine && (
              <div style={{ fontSize: 11.5, color: 'var(--text)', marginTop: 3 }}>
                💰 Баланс на данный момент: <b className="mono">{balLine}</b>
              </div>
            )}
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <button className="btn btn-red" style={{ fontSize: 12, padding: '8px 12px' }} onClick={() => onOpenAddr(selected.addr)}>Открыть отчёт по нему</button>
              <button className="btn" style={{ fontSize: 12, padding: '8px 12px' }} onClick={() => setSelected(null)}>Закрыть</button>
            </div>
          </div>
        )}
      </div>
        </>
      )}

      {/* Фото в чат: «Граф» — радар (вид «Радар»), «Поток» — схема root→leaks; рендер в клиенте */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
        {viewMode === 'web' && (
          <button className="btn btn-red" style={{ fontSize: 11, padding: '7px 10px' }} onClick={() => void sendPhoto('graph')} disabled={photoBusy === 'graph'}>{photoBusy === 'graph' ? '…' : '📸 Граф в чат'}</button>
        )}
        <button className="btn btn-red" style={{ fontSize: 11, padding: '7px 10px' }} onClick={() => void sendPhoto('flow')} disabled={photoBusy === 'flow'}>{photoBusy === 'flow' ? '…' : '📸 Поток в чат'}</button>
      </div>

      {/* v7: структурная картина — то, что отличает «распутывание» от веера вылетов */}
      {(trace?.findings ?? []).length > 0 && (
        <>
          <div className="microlabel" style={{ margin: '16px 4px 8px' }}>Структура графа · распутанные связи</div>
          {trace!.findings.map((f, i) => (
            <div key={i} className="card2" style={{ marginBottom: 6, fontSize: 12, lineHeight: 1.5, borderColor: 'rgba(245,158,11,.35)' }}>
              <b style={{ color: 'var(--warn)' }}>{f.startsWith('Пил-чейн') ? '⛓ ' : f.startsWith('Общий источник') ? '🔗 ' : '🌉 '}</b>
              {f}
            </div>
          ))}
        </>
      )}

      {/* Unmix: «человекочитаемое» распутывание миксеров — утверждённый визуал 18.11
          (вердикт + истории связей). v7.1: секция ВСЕГДА видна — честный пустой слот
          с объяснением, почему блока нет, и предпросмотр на вымышленных данных. */}
      <div className="microlabel" style={{ margin: '16px 4px 6px' }}>
        Unmix · распутывание миксеров{unmix.length ? ` · ${unmix.length}` : ''}
      </div>
      {unmix.length > 0 && unmix.map((u, i) => (
        <UnmixStory key={i} u={u} chain={trace?.chain ?? ''} onOpenAddr={onOpenAddr} />
      ))}
      {unmix.length === 0 && (
        <div className="card2" style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--warn)' }}>🌀 Следов миксера (Tornado Cash) в графе не найдено</div>
          <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 5, lineHeight: 1.5 }}>
            Блок с историями связей появляется здесь и в PDF только когда адрес или его
            окружение вносили/выводили средства через миксер, а индекс депозитов покрывает
            этот период. Индекс собирается для Ethereum · BSC · Polygon; для TRON/TON/BTC/SOL
            распутывание миксеров не применимо — там работают пил-чейн, AML-экспозиция и мультичейн.
          </div>
          <button
            className="btn"
            style={{ marginTop: 8, fontSize: 12 }}
            onClick={() => { haptic(); setShowDemoUnmix(!showDemoUnmix); }}
          >
            {showDemoUnmix ? 'Скрыть пример' : '👁 Показать, как выглядит блок'}
          </button>
        </div>
      )}
      {showDemoUnmix && unmix.length === 0 && (
        <div>
          <div style={{ fontSize: 11, color: 'var(--warn)', margin: '0 4px 6px' }}>
            ⚠️ ПРИМЕР ДАННЫХ · адреса и суммы вымышленные — это демонстрация визуала, не твоё расследование
          </div>
          <UnmixStory u={DEMO_UNMIX} chain="eth" onOpenAddr={() => notify('Это пример данных — адреса вымышленные, переход отключён')} />
        </div>
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

// ---------- v7.2: СХЕМА ПОТОКОВ — новый вид по умолчанию вместо радиальной паутины ----------
// ЦЕЛЬ сверху; ниже два потока (входят/уходят), контрагенты сгруппированы по типам
// адресов, полоса = доля направления. Отвечает на «куда уходят деньги» без чтения паутины.
function flowGroups(nodes: GraphNode[], list: GraphEdge[], side: 'in' | 'out') {
  const map = new Map<string, { cat: string; subtotal: number; rows: { n: GraphNode; amount: number; probable: boolean }[] }>();
  for (const e of list) {
    const n = nodes.find((x) => x.id === (side === 'in' ? e.from : e.to));
    if (!n) continue;
    const cat = n.category ?? 'personal';
    const g = map.get(cat) ?? { cat, subtotal: 0, rows: [] };
    g.subtotal += e.amount;
    g.rows.push({ n, amount: e.amount, probable: !!e.probable || !!n.probable });
    map.set(cat, g);
  }
  return [...map.values()]
    .map((g) => ({ ...g, rows: g.rows.sort((a, b) => b.amount - a.amount) }))
    .sort((a, b) => b.subtotal - a.subtotal);
}

function FlowScheme({ nodes, edges, rootId, balLine, onOpenAddr }: {
  nodes: GraphNode[];
  edges: GraphEdge[];
  rootId?: string;
  balLine?: string;
  onOpenAddr: (a: string) => void;
}) {
  const root = nodes.find((n) => n.isRoot);
  const asset = edges[0]?.asset ?? '';
  const inE = edges.filter((e) => e.to === rootId);
  const outE = edges.filter((e) => e.from === rootId);
  const sumIn = inE.reduce((s, e) => s + e.amount, 0);
  const sumOut = outE.reduce((s, e) => s + e.amount, 0);
  const hop2 = edges.filter((e) => e.from !== rootId && e.to !== rootId);
  const lanes: { key: 'in' | 'out'; title: string; icon: string; color: string; list: GraphEdge[]; sum: number; noun: string }[] = [
    { key: 'in', title: 'Входят', icon: '▼', color: '#55D6BE', list: inE, sum: sumIn, noun: 'источников' },
    { key: 'out', title: 'Уходят', icon: '▲', color: '#F59E0B', list: outE, sum: sumOut, noun: 'получателей' },
  ];
  return (
    <div className="fs-wrap">
      <div className="fs-root">
        <div className="fs-root-ico">🎯</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="fs-root-lab">{root?.label ?? 'ЦЕЛЬ'}{root?.probable ? ' ?' : ''}</div>
          <div className="mono fs-root-sub">{short(root?.addr ?? '', 10, 8)} · {(root?.chain ?? '').toUpperCase()} · tx {root?.txCount ?? 0}</div>
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <div className="mono" style={{ fontSize: 12, fontWeight: 700, color: '#55D6BE' }}>↓ {fmt(sumIn, 1)}</div>
          <div className="mono" style={{ fontSize: 12, fontWeight: 700, color: '#F59E0B' }}>↑ {fmt(sumOut, 1)} {asset}</div>
          {balLine && <div className="mono" style={{ fontSize: 10.5, color: 'var(--muted)', marginTop: 3 }}>баланс {balLine}</div>}
        </div>
      </div>
      <div className="fs-spine" />
      {lanes.map((lane) => {
        const groups = flowGroups(nodes, lane.list, lane.key);
        return (
          <div className="fs-lane" key={lane.key}>
            <div className="fs-lane-head" style={{ borderLeftColor: lane.color }}>
              <span style={{ color: lane.color, fontWeight: 800 }}>{lane.icon}</span>
              <b>{lane.title}</b>
              <span className="mono">{fmt(lane.sum, 1)} {asset}</span>
              <span style={{ color: 'var(--muted)', marginLeft: 'auto' }}>· {lane.list.length} {lane.noun}</span>
            </div>
            {lane.list.length === 0 && (
              <div className="fs-empty">Прямых {lane.key === 'in' ? 'входящих' : 'исходящих'} переводов в этой выборке не видно — все связи цели идут через посредников (круги 2-го порядка, см. «🕸 Радар»).</div>
            )}
            {groups.map((g) => {
              const share = lane.sum > 0 ? Math.round((g.subtotal / lane.sum) * 100) : 0;
              const col = CAT_COLORS[g.cat] ?? '#9CA3AF';
              const anyProb = g.rows.some((r) => r.probable);
              const shown = g.rows.slice(0, 4);
              return (
                <div className="fs-group" key={g.cat}>
                  <div className="fs-ghead">
                    <span style={{ fontSize: 14 }}>{categoryIcon(g.cat)}</span>
                    <span style={{ color: col, fontWeight: 700, fontSize: 12.5 }}>{categoryRuFull(g.cat, anyProb)}</span>
                    <span className="mono" style={{ marginLeft: 'auto', fontSize: 12 }}>{fmt(g.subtotal, 1)} · {share}%</span>
                  </div>
                  <div className="fs-gbar"><i style={{ width: `${Math.max(3, share)}%`, background: col }} /></div>
                  {shown.map((r, i) => (
                    <div className="fs-row" key={i} onClick={() => { haptic(); onOpenAddr(r.n.addr); }}>
                      <span className="mono fs-addr">{r.n.label ?? short(r.n.addr, 6, 4)}{r.probable ? ' ?' : ''}</span>
                      <span className="mono fs-amt">{fmt(r.amount, 1)}</span>
                      <span className="fs-pct">{lane.sum > 0 ? Math.round((r.amount / lane.sum) * 100) : 0}%</span>
                    </div>
                  ))}
                  {g.rows.length > 4 && <div className="fs-more">+{g.rows.length - 4} адресов в этой группе — полный список в «🕸 Радаре» и PDF</div>}
                </div>
              );
            })}
          </div>
        );
      })}
      {hop2.length > 0 && (
        <div className="fs-hop2">🔗 Через посредников минуя цель: {hop2.length} связей (2-й круг). Кто именно и с какими суммами — переключись на «🕸 Радар связей».</div>
      )}
    </div>
  );
}

// ---------- Unmix: карточка «человеческим языком» (утверждено заказчиком 18.11) ----------
// Чёрный + красный, уверенность — яркостью красного. История каждой связи — одна понятная фраза.
const UM_WORDS: Array<[number, string, string]> = [
  [0.8, 's3', 'почти наверняка'], [0.5, 's2', 'скорее всего'], [0.3, 's1', 'возможно'], [0, 's0', 'маловероятно'],
];
const UM_METHOD_CHIP: Record<string, { text: string; strong?: boolean }> = {
  H1: { text: 'один и тот же адрес внёс и выводил', strong: true },
  H2: { text: 'прямой перевод виден в блокчейне', strong: true },
  H3: { text: 'первый совпадающий вывод (FIFO)' },
  '1/n': { text: 'совпала только сумма' },
};
const UM_STORY: Record<string, (a: string, t1: string, lat: string, t2: string) => string> = {
  H1: (a, t1, lat) => `Кошелёк цели внёс ${a} в ${t1}, а через ${lat} этот же кошелёк забрал ${a} обратно.`,
  H2: (a, t1, lat, t2) => `Внёс ${a} в ${t1}, вышел в ${t2} и сразу был переведён на соседний кошелёк — перевод между ними виден в блокчейне напрямую.`,
  H3: (a, t1, lat, t2) => `Внёс ${a} в ${t1}, вышел в ${t2} — первым из очереди после депозита. Похоже на те же деньги, но это совпадение по поведению, а не прямая связь.`,
  '1/n': (a) => `Совпал с чужим выводом только суммой (${a}). В окне были другие похожие выводы — скорее всего, это просто совпадение.`,
};
function umLevel(p: number): [number, string, string] { return UM_WORDS.find(([min]) => p >= min) ?? UM_WORDS[3]; }
function umTime(ts?: number): string {
  return ts ? new Date(ts * 1000).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }) : '';
}
function umLat(ms?: number, mw?: number): string {
  if (!ms || !mw || mw <= ms) return '';
  const m = Math.round((mw - ms) / 60);
  return m < 60 ? `${m} мин` : `${Math.floor(m / 60)} ч ${m % 60} мин`;
}

// Демо-объект для кнопки «👁 Показать, как выглядит блок»: точная копия утверждённого
// заказчиком макета от 18.11 (95/75/35/14 · сходимость ~68% · цикл ↻). Адреса
// 0xAAAA…/0xBBBB… — вымышленные, над блоком рисуется явная плашка «ПРИМЕР ДАННЫХ».
const DEMO_DAY = Date.UTC(2026, 10, 18); // 2026-11-18 00:00 UTC
const min = (h: number, m: number) => DEMO_DAY + h * 3600e3 + m * 60e3;
const DEMO_UNMIX: UnmixFinding = {
  mixer: '0x47ce0c6ed5b0ce3d3a51fdb1c52dc66a7c3c2936',
  mixerLabel: 'Tornado Cash · пример',
  deposits: [
    { addr: '0xAAAA111111111111111111111111111111111111', amount: 1, ts: Math.floor(min(4, 12) / 1000) },
    { addr: '0xBBBB222222222222222222222222222222222222', amount: 1, ts: Math.floor(min(4, 15) / 1000) },
    { addr: '0xCCCC333333333333333333333333333333333333', amount: 1, ts: Math.floor(min(4, 31) / 1000) },
    { addr: '0xDDDD444444444444444444444444444444444444', amount: 1, ts: Math.floor(min(5, 2) / 1000) },
  ],
  outputs: [
    { addr: '0xAAAA111111111111111111111111111111111111', amount: 1, ts: Math.floor(min(4, 58) / 1000) },
    { addr: '0xEEEE555555555555555555555555555555555555', amount: 1, ts: Math.floor(min(5, 26) / 1000) },
    { addr: '0xFFFF666666666666666666666666666666666666', amount: 1, ts: Math.floor(min(7, 43) / 1000) },
    { addr: '0x7777111111111111111111111111111111111111', amount: 1, ts: Math.floor(min(7, 50) / 1000) },
  ],
  links: [
    { from: '0xAAAA111111111111111111111111111111111111', to: '0xAAAA111111111111111111111111111111111111', amount: 1, p: 0.95, method: 'H1', looped: true },
    { from: '0xBBBB222222222222222222222222222222222222', to: '0xEEEE555555555555555555555555555555555555', amount: 1, p: 0.75, method: 'H2' },
    { from: '0xCCCC333333333333333333333333333333333333', to: '0xFFFF666666666666666666666666666666666666', amount: 1, p: 0.35, method: 'H3' },
    { from: '0xDDDD444444444444444444444444444444444444', to: '0x7777111111111111111111111111111111111111', amount: 1, p: 0.14, method: '1/n' },
  ],
  note: 'Номинал 1 ETH · сходимость ~68% · циклов повторного входа: 1',
};
function UnmixStory({ u, chain, onOpenAddr }: { u: UnmixFinding; chain: string; onOpenAddr: (a: string) => void }) {
  const rec = Number((u.note.match(/сходимость ~(\d+)%/) ?? [])[1] ?? NaN);
  const loops = Number((u.note.match(/циклов повторного входа: (\d+)/) ?? [])[1] ?? 0);
  const unit = u.note.match(/Номинал [\d.,]+\s*([A-Za-z]{2,6})/)?.[1] ?? ({ ethereum: 'ETH', tron: 'TRX', bsc: 'BNB' } as Record<string, string>)[chain] ?? '';
  const sumD = u.deposits.reduce((s, d) => s + d.amount, 0);
  const traced = u.links.reduce((s, l) => s + l.amount, 0);
  return (
    <div className="card" style={{ marginBottom: 10 }}>
      <div className="um-mxhead">
        <div className="um-mxico">🌀</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 800 }}>{u.mixerLabel ?? 'Миксер'}{unit ? ` · номинал ${unit}` : ''}</div>
          <div className="mono" style={{ fontSize: 10.5, color: 'var(--muted)', marginTop: 2, wordBreak: 'break-all' }}>
            {short(u.mixer, 8, 6)} · {u.links.length} связей из {u.deposits.length} депозитов
          </div>
        </div>
      </div>
      <div className="um-verdict">
        <div style={{ fontSize: 13, fontWeight: 800 }}>
          {u.links.length ? 'Деньги прошли через миксер — след потерян?' : 'Деньги в миксере есть — пар не нашлось'}
        </div>
        <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 4, lineHeight: 1.5 }}>
          {u.links.length
            ? 'Миксер смешивает чужие переводы, чтобы спрятать след. Но следы остаются — вот что удалось восстановить.'
            : 'Индекс выводов пополняется кроном: повтори расследование позже — пары могут найтись.'}
        </div>
        {u.links.length > 0 && !Number.isNaN(rec) && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10 }}>
            <div style={{ flex: 1, height: 8, borderRadius: 99, background: 'rgba(10,10,11,.6)', overflow: 'hidden' }}>
              <div style={{ width: `${rec}%`, height: '100%', background: 'linear-gradient(90deg, var(--red), #FF6B57)' }} />
            </div>
            <span className="mono" style={{ fontSize: 10.5, color: 'var(--muted)', whiteSpace: 'nowrap' }}>
              {Number.isNaN(rec) ? '' : `сходимость ~${rec}%`}{unit ? ` · ~${fmt(traced, 1)} из ${fmt(sumD, 1)} ${unit}` : ''}{loops ? ` · циклов ↻ ${loops}` : ''}
            </span>
          </div>
        )}
      </div>
      {u.links.length > 0 && (
        <div>
          {u.links.slice(0, 5).map((l, j) => {
            const kind = (l.method ?? '1/n').split(' ')[0];
            const [, sc, word] = umLevel(l.p);
            const d = u.deposits.find((x) => x.addr === l.from);
            const w = u.outputs.find((x) => x.addr === l.to);
            const lat = umLat(d?.ts, w?.ts);
            const a = fmt(l.amount, 2) + (unit ? ` ${unit}` : '');
            const story = (UM_STORY[kind] ?? UM_STORY['1/n'])(a, umTime(d?.ts) || '—', lat || 'некоторое время', umTime(w?.ts) || '—');
            const chip = UM_METHOD_CHIP[kind] ?? UM_METHOD_CHIP['1/n'];
            return (
              <div className="um-srow" key={j}>
                <div className="um-num">{j + 1}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="um-stext">{story}</div>
                  <div className="um-shy">
                    <span className={`um-rw ${chip.strong ? 'strong' : 'soft'}`}>{chip.text}</span>
                    {l.looped && <span className="um-rw soft">↻ после вывода снова внёс в миксер</span>}
                  </div>
                  <div className="mono" style={{ fontSize: 10, color: 'var(--muted)', marginTop: 4 }}>
                    <span style={{ color: 'var(--muted)', cursor: 'pointer' }} onClick={() => onOpenAddr(l.from)}>{short(l.from, 6, 4)}</span>
                    {' → '}
                    <span style={{ color: 'var(--muted)', cursor: 'pointer' }} onClick={() => onOpenAddr(l.to)}>{short(l.to, 6, 4)}</span>
                  </div>
                </div>
                <div className="um-pcol">
                  <span className={`mono um-v ${sc}`}>{Math.round(l.p * 100)}%</span>
                  <div className="um-l">{word}</div>
                  <div className="um-mini"><i className={sc} style={{ width: `${Math.round(l.p * 100)}%` }} /></div>
                </div>
              </div>
            );
          })}
          {u.links.length > 5 && (
            <div style={{ fontSize: 10.5, color: 'var(--muted)', padding: '8px 0 2px', borderTop: '1px solid var(--border)' }}>
              +{u.links.length - 5} связей ниже порога — полный список в PDF-отчёте
            </div>
          )}
          <div className="um-howto">
            <b>Как читать цифры.</b> Процент — это уверенность движка, не клятва:{' '}
            <span style={{ color: '#FF6B57', fontWeight: 700 }}>80%+ сильные доказательства</span> (ошибка маловероятна),{' '}
            <b>50–80%</b> — веские основания, <b>менее 50%</b> — совпадения, для дела использовать с осторожностью.
            Чем ярче красный — тем сильнее связь. Время — UTC.
          </div>
          <div className="um-foot">
            ↻ Цикл повторного входа (снова внёс → снова вывел) — классическое поведение «отмывателя», учтено движком.
            {' '}Оценка вероятностная, не доказательство.
          </div>
        </div>
      )}
    </div>
  );
}
