import { useEffect, useRef, useState } from 'react';
import { api, type WalletReport, type TraceResult, fmt, short } from './api';
import { haptic, onBackButton, webApp } from './tg';
import { makeAmlPdf } from './pdf/makeAmlPdf';
import Home from './screens/Home';
import Report from './screens/Report';
import Graph from './screens/Graph';
import TraceLoading from './screens/TraceLoading';
import Monitor from './screens/Monitor';
import History from './screens/History';
import Settings from './screens/Settings';
import Glossary from './screens/Glossary';

type Screen = 'home' | 'report' | 'graph' | 'monitor' | 'history' | 'settings' | 'aml' | 'glossary';

// Deep link из кнопок бота. Telegram кладёт startapp в initDataUnsafe.start_param
// для прямых ссылок (t.me/бот/AresCryptoAi и t.me/бот?startapp=...); у inline
// web_app-кнопок параметр остаётся в URL страницы. При запуске t.me-ссылки из
// браузера (tgme-превью) start_param приходит GET-параметром tgWebAppStartParam.
// Префикс AML: — запуск авто-AML-досье (кнопка «🛡 AML-отчёт (PDF)» в боте).
function deepLinkAddr(): string {
  const sp = webApp()?.initDataUnsafe?.start_param;
  if (sp) return sp.trim();
  const q = new URLSearchParams(window.location.search);
  return (q.get('startapp') ?? q.get('addr') ?? q.get('tgWebAppStartParam') ?? '').trim();
}

export default function App() {
  const [screen, setScreen] = useState<Screen>('home');
  const [report, setReport] = useState<WalletReport | null>(null);
  const [trace, setTrace] = useState<TraceResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [traceLoading, setTraceLoading] = useState(false);
  const [prevCheck, setPrevCheck] = useState<{ score: number; ts: number } | undefined>(undefined);
  const [cached, setCached] = useState(false);
  const cancelTraceRef = useRef(false);
  const lastSearchRef = useRef<string>('');

  const notify = (m: string) => { setToast(m); setTimeout(() => setToast(''), 2500); };

  async function doSearch(input: string) {
    haptic();
    lastSearchRef.current = input.trim();
    setLoading(true); setError('');
    try {
      const r = await api<{ report: WalletReport; prev?: { score: number; ts: number }; cached?: boolean }>(`/report?addr=${encodeURIComponent(input)}`);
      setReport(r.report);
      setPrevCheck(r.prev);
      setCached(!!r.cached);
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
    const r = await api<{ report: WalletReport }>(`/report?addr=${encodeURIComponent(addr)}&force=1`);
    setReport(r.report);
    setCached(false);
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

  // ---------- AML-досье: авто-поток из кнопки бота ----------
  // Кнопка «🛡 AML-отчёт (PDF)» открывает webapp с ?startapp=AML:<addr>: мини-апп
  // сам собирает отчёт, строит профессиональное AML/KYT-досье и отправляет его
  // документом в чат через /api/pdf. Пользователь видит этапы и результат.
  const lastAmlRef = useRef<string>('');
  const [amlStatus, setAmlStatus] = useState<{ state: 'work' | 'done' | 'err'; step: string; msg: string; addr: string }>({ state: 'work', step: '', msg: '', addr: '' });

  async function amlFlow(rawAddr: string, silentRerun = false): Promise<void> {
    const addr = rawAddr.trim();
    haptic();
    setScreen('aml');
    setAmlStatus({ state: 'work', step: 'Собираю транзакции и профиль кошелька…', msg: '', addr });
    if (!silentRerun) setReport(null);
    try {
      const r = await api<{ report: WalletReport }>(`/report?addr=${encodeURIComponent(addr)}`);
      setReport(r.report);
      setTrace(null);
      setAmlStatus(s => ({ ...s, step: 'Скоринг AML готов, формирую досье…' }));
      const b64 = await makeAmlPdf(r.report);
      setAmlStatus(s => ({ ...s, step: 'Отправляю документ в чат…' }));
      await api('/pdf', {
        method: 'POST',
        body: JSON.stringify({ pdf: b64, filename: `aml-${short(r.report.chains[0]?.account.addr ?? addr, 6, 4)}.pdf`, caption: '🛡 AML/KYT-досье · профессиональный скоринг по публичным источникам' }),
      });
      setAmlStatus({ state: 'done', step: '', msg: 'AML-досье отправлено в чат документом PDF.', addr });
    } catch (e) {
      setAmlStatus({ state: 'err', step: '', msg: (e as Error).message, addr });
    }
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
      // AML-поток: кнопка «🛡 AML-отчёт (PDF)» в боте ведёт сюда с ?startapp=AML:<addr>
      if (sp.startsWith('AML:')) {
        const addr = sp.slice(4);
        if (addr && addr !== lastAmlRef.current) { lastAmlRef.current = addr; void amlFlow(addr); }
        return;
      }
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
          {screen === 'home' && (
            <Home
              onSearch={doSearch}
              loading={loading}
              error={error}
              onOpenReport={() => setScreen('report')}
              lastReport={report}
              onOpenGraph={openGraph}
              onAml={() => {
                const addr = report?.chains[0]?.account.addr ?? report?.input;
                if (addr) void amlFlow(addr);
              }}
              onNav={(s) => setScreen(s)}
            />
          )}
          {screen === 'report' && report && (
            <Report
              report={report}
              trace={trace}
              onGraph={openGraph}
              notify={notify}
              onOpenAddr={(addr) => void doSearch(addr)}
              onRefresh={refreshReport}
              prev={prevCheck}
              cached={cached}
            />
          )}
          {screen === 'graph' && (trace || report) && (
            <Graph
              report={report}
              trace={trace}
              notify={notify}
              onOpenAddr={(addr) => void doSearch(addr)}
            />
          )}
          {screen === 'aml' && (
            <div className="fade-in" style={{ padding: 14 }}>
              <div className="microlabel" style={{ marginBottom: 8, fontSize: 11 }}>AML / KYT досье · профессиональный скоринг</div>
              <div className="card" style={{ padding: 16 }}>
                {amlStatus.state === 'work' && (
                  <>
                    <div className="mono" style={{ fontSize: 11, color: 'var(--info)', wordBreak: 'break-all', marginBottom: 10 }}>{amlStatus.addr}</div>
                    <div className="spinner" style={{ margin: '0 auto 12px' }} />
                    <div style={{ fontSize: 13, textAlign: 'center' }}>{amlStatus.step}</div>
                    <div style={{ fontSize: 11, color: 'var(--muted)', textAlign: 'center', marginTop: 6, lineHeight: 1.5 }}>
                      Собираю источники, считаю скоринг и exposure, верстаю PDF — обычно 10–30 секунд. Готовый документ придёт в этот чат.
                    </div>
                  </>
                )}
                {amlStatus.state === 'done' && (
                  <>
                    <div style={{ fontSize: 30, textAlign: 'center', marginBottom: 8 }}>✅</div>
                    <div style={{ fontSize: 14, fontWeight: 700, textAlign: 'center' }}>Досье отправлено в чат</div>
                    <div className="mono" style={{ fontSize: 11, color: 'var(--muted)', wordBreak: 'break-all', textAlign: 'center', margin: '8px 0' }}>{amlStatus.addr}</div>
                    <div style={{ fontSize: 11.5, color: 'var(--muted)', textAlign: 'center', lineHeight: 1.5 }}>
                      Внутри: оценка риска 0–100 со шкалой, резюме для решения, происхождение средств (exposure), источники загрязнения с путями, куда уходят средства, методология и рекомендации.
                    </div>
                    <div style={{ display: 'flex', gap: 8, marginTop: 12, justifyContent: 'center' }}>
                      <button className="btn btn-red" style={{ fontSize: 12, padding: '8px 12px' }} onClick={() => setScreen('report')}>Обычный отчёт</button>
                      <button className="btn" style={{ fontSize: 12, padding: '8px 12px' }} onClick={() => void amlFlow(amlStatus.addr, true)}>Отправить ещё раз</button>
                    </div>
                  </>
                )}
                {amlStatus.state === 'err' && (
                  <>
                    <div style={{ fontSize: 30, textAlign: 'center', marginBottom: 8 }}>⚠️</div>
                    <div style={{ fontSize: 14, fontWeight: 700, textAlign: 'center' }}>Не получилось</div>
                    <div style={{ fontSize: 11.5, color: 'var(--danger)', textAlign: 'center', margin: '8px 0', wordBreak: 'break-word' }}>{amlStatus.msg}</div>
                    <div style={{ display: 'flex', gap: 8, marginTop: 12, justifyContent: 'center' }}>
                      <button className="btn" style={{ fontSize: 12, padding: '8px 12px' }} onClick={() => void amlFlow(amlStatus.addr, true)}>Повторить</button>
                      <button className="btn" style={{ fontSize: 12, padding: '8px 12px' }} onClick={() => setScreen('home')}>На главную</button>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}
          {screen === 'monitor' && <Monitor onOpenAddr={doSearch} />}
          {screen === 'history' && <History onOpenAddr={doSearch} onOpenTrace={(t) => { setTrace(t); setScreen('graph'); }} />}
          {screen === 'settings' && <Settings notify={notify} onNav={(s) => setScreen(s)} />}
          {screen === 'glossary' && <Glossary />}
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
