import { useEffect, useState } from 'react';
import { api, type WalletReport, type TraceResult, fmt } from './api';
import { haptic, onBackButton, webApp } from './tg';
import Home from './screens/Home';
import Report from './screens/Report';
import Graph from './screens/Graph';
import Monitor from './screens/Monitor';
import History from './screens/History';
import Settings from './screens/Settings';

type Screen = 'home' | 'report' | 'graph' | 'monitor' | 'history' | 'settings';

export default function App() {
  const [screen, setScreen] = useState<Screen>('home');
  const [report, setReport] = useState<WalletReport | null>(null);
  const [trace, setTrace] = useState<TraceResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');

  const notify = (m: string) => { setToast(m); setTimeout(() => setToast(''), 2500); };

  async function doSearch(input: string) {
    haptic();
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

  async function openGraph() {
    if (!report?.chains[0]) return;
    setLoading(true); setError('');
    try {
      const cr = report.chains[0];
      const r = await api<{ trace: TraceResult }>(`/graph?addr=${encodeURIComponent(cr.account.addr)}&chain=${cr.chain}&depth=2`);
      setTrace(r.trace);
      setScreen('graph');
    } catch (e) { setError((e as Error).message); } finally { setLoading(false); }
  }

  // BackButton navigates home from deep screens
  useEffect(() => {
    const back = () => { setScreen('home'); };
    if (screen !== 'home') { onBackButton(back); return () => onBackButton(null); }
    onBackButton(null);
  }, [screen]);

  useEffect(() => {
    // startapp param: deep link from the bot's photo-card button
    const app = webApp();
    const sp = app?.initDataUnsafe?.start_param;
    if (sp) void doSearch(sp);
  }, []);

  const tabs: { id: Screen; icon: string; label: string }[] = [
    { id: 'home', icon: '⌂', label: 'Главная' },
    { id: 'monitor', icon: '🔔', label: 'Мониторинг' },
    { id: 'history', icon: '🕘', label: 'История' },
    { id: 'settings', icon: '⚙', label: 'Настройки' },
  ];

  return (
    <div style={{ paddingBottom: 70, minHeight: '100vh', background: 'var(--bg)' }}>
      {screen === 'home' && <Home onSearch={doSearch} loading={loading} error={error} onOpenReport={() => setScreen('report')} lastReport={report} />}
      {screen === 'report' && report && (
        <Report
          report={report}
          onGraph={openGraph}
          notify={notify}
          onOpenAddr={(addr) => void doSearch(addr)}
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
