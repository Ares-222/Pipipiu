import { useEffect, useRef, useState } from 'react';
import { api, type WalletReport, type TraceResult, fmt } from './api';
import { haptic, onBackButton, webApp } from './tg';
import Home from './screens/Home';
import Report from './screens/Report';
import Graph from './screens/Graph';
import TraceLoading from './screens/TraceLoading';
import Monitor from './screens/Monitor';
import History from './screens/History';
import Settings from './screens/Settings';

type Screen = 'home' | 'report' | 'graph' | 'monitor' | 'history' | 'settings';

// Deep link из кнопок бота. Telegram кладёт startapp в initDataUnsafe.start_param
// только для прямых ссылок; у inline web_app-кнопок параметр остаётся в URL страницы.
function deepLinkAddr(): string {
  const sp = webApp()?.initDataUnsafe?.start_param;
  if (sp) return sp.trim();
  const q = new URLSearchParams(window.location.search);
  return (q.get('startapp') ?? q.get('addr') ?? '').trim();
}

export default function App() {
  const [screen, setScreen] = useState<Screen>('home');
  const [report, setReport] = useState<WalletReport | null>(null);
  const [trace, setTrace] = useState<TraceResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [traceLoading, setTraceLoading] = useState(false);
  const cancelTraceRef = useRef(false);
  const lastSearchRef = useRef<string>('');

  const notify = (m: string) => { setToast(m); setTimeout(() => setToast(''), 2500); };

  async function doSearch(input: string) {
    haptic();
    lastSearchRef.current = input.trim();
    setLoading(true); setError('');
    try {
      const r = await api<{ report: WalletReport }>(`/report?addr=${encodeURIComponent(input)}`);
      setReport(r.report);
      setTrace(null);
      setScreen('report');
    } catch (e) {
      setError((e as Error).message);
    } finally { setLoading(false); }
  }

  // Свежий отчёт по текущему адресу: карточка и PDF рендерятся ТОЛЬКО из него,
  // чтобы застрявшая сессия webview не отправила устаревшие данные.
  async function refreshReport(): Promise<WalletReport | null> {
    const cur = report;
    if (!cur) return null;
    const addr = cur.chains[0]?.account.addr ?? cur.input;
    const r = await api<{ report: WalletReport }>(`/report?addr=${encodeURIComponent(addr)}`);
    setReport(r.report);
    return r.report;
  }

  // Запуск расследования: показываем честный экран этапов (TraceLoading) вместо
  // серого «загружаю…» сверху страницы. API не отдаёт промежуточный прогресс —
  // экран идёт по таймеру; отмена не разрывает fetch, но результат игнорируется
  // и переключения экрана не происходит.
  async function openGraph() {
    if (!report?.chains[0]) return;
    haptic();
    const cr = report.chains[0];
    cancelTraceRef.current = false;
    setTrace(null);
    setError('');
    setTraceLoading(true);
    try {
      const r = await api<{ trace: TraceResult }>(`/graph?addr=${encodeURIComponent(cr.account.addr)}&chain=${cr.chain}&depth=2`);
      if (cancelTraceRef.current) return;
      setTrace(r.trace);
      setScreen('graph');
    } catch (e) {
      // Ошибка трассировки не видна на экране отчёта через state error — показываем тост.
      if (!cancelTraceRef.current) notify('⚠️ Расследование не удалось: ' + (e as Error).message);
    } finally { setTraceLoading(false); }
  }

  function cancelTrace() {
    cancelTraceRef.current = true;
    setTraceLoading(false);
  }

  // BackButton navigates home from deep screens
  useEffect(() => {
    const back = () => {
      if (traceLoading) { cancelTrace(); return; } // Back во время расследования = отмена
      setScreen('home');
    };
    if (screen !== 'home') { onBackButton(back); return () => onBackButton(null); }
    onBackButton(null);
  }, [screen, traceLoading]);

  // Deep link: на первом монтировании И на каждой реактивации webview.
  // Фикс бага 22:46: форки Telegram (AyuGram) восстанавливают webview из bfcache
  // со старым React-состоянием — уходила старая карточка/PDF и «не меняющийся» граф.
  // pageshow/visibilitychange перезапускают поиск, если deep-link ведёт на другой
  // адрес. Уникальные ?t= URL в keyboards.ts — первая линия обороны, этот
  // слушатель — вторая.
  useEffect(() => {
    const rerun = () => {
      const sp = deepLinkAddr();
      if (sp && sp !== lastSearchRef.current) void doSearch(sp);
    };
    rerun();
    window.addEventListener('pageshow', rerun);
    const vis = () => { if (document.visibilityState === 'visible') rerun(); };
    document.addEventListener('visibilitychange', vis);
    return () => {
      window.removeEventListener('pageshow', rerun);
      document.removeEventListener('visibilitychange', vis);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const tabs: { id: Screen; icon: string; label: string }[] = [
    { id: 'home', icon: '⌂', label: 'Главная' },
    { id: 'monitor', icon: '🔔', label: 'Мониторинг' },
    { id: 'history', icon: '🕘', label: 'История' },
    { id: 'settings', icon: '⚙', label: 'Настройки' },
  ];

  return (
    <div style={{ paddingBottom: 70, minHeight: '100vh', background: 'var(--bg)' }}>
      {traceLoading && report?.chains[0] ? (
        <TraceLoading
          addr={report.chains[0].account.addr}
          chain={report.chains[0].chain}
          onCancel={cancelTrace}
        />
      ) : (
        <>
          {screen === 'home' && <Home onSearch={doSearch} loading={loading} error={error} onOpenReport={() => setScreen('report')} lastReport={report} />}
          {screen === 'report' && report && (
            <Report
              report={report}
              onGraph={openGraph}
              notify={notify}
              onOpenAddr={(addr) => void doSearch(addr)}
              onRefresh={refreshReport}
            />
          )}
          {screen === 'graph' && (trace || report) && (
            <Graph
              report={report}
              trace={trace}
              onOpenAddr={(addr) => void doSearch(addr)}
            />
          )}
          {screen === 'monitor' && <Monitor onOpenAddr={doSearch} />}
          {screen === 'history' && <History onOpenAddr={doSearch} />}
          {screen === 'settings' && <Settings notify={notify} />}
        </>
      )}

      {toast && <div className="fade-in" style={{ position: 'fixed', top: 12, left: 16, right: 16, background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 12, padding: '10px 14px', zIndex: 90, fontSize: 13 }}>{toast}</div>}

      <nav className="tabbar">
        {tabs.map((t) => (
          <button key={t.id} className={`tab ${screen === t.id ? 'active' : ''}`} onClick={() => { haptic(); setScreen(t.id); }}>
            <span className="ico" style={{ fontSize: 17 }}>{t.icon}</span>
            {t.label}
          </button>
        ))}
      </nav>

      {loading && screen !== 'home' && (
        <div style={{ position: 'fixed', top: 8, left: 0, right: 0, textAlign: 'center', fontSize: 11, color: 'var(--muted)', zIndex: 80 }}>загружаю…</div>
      )}
    </div>
  );
}

export function secondsAgo(ts: number): string {
  return fmt(Math.max(0, Math.floor((Date.now() / 1000 - ts) / 60))) + ' мин';
}
