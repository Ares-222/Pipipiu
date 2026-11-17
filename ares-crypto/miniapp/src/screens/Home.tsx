import { useEffect, useState } from 'react';
import { api, type WalletReport, short } from '../api';
import { haptic } from '../tg';

export type HomeNav = 'monitor' | 'history' | 'settings';

export default function Home({ onSearch, loading, error, onOpenReport, lastReport, onOpenGraph, onAml, onNav }: {
  onSearch: (input: string) => void;
  loading: boolean;
  error: string;
  onOpenReport: () => void;
  lastReport: WalletReport | null;
  onOpenGraph: () => void;
  onAml: () => void;
  onNav: (s: HomeNav) => void;
}) {
  const [input, setInput] = useState('');
  const [history, setHistory] = useState<{ input: string; chain: string; verdict: string; createdTs: number }[]>([]);
  const [watches, setWatches] = useState<{ addr: string; chain: string }[]>([]);

  useEffect(() => {
    api<{ checks: { input: string; chain: string; verdict: string; createdTs: number }[] }>('/history?limit=5')
      .then((r) => setHistory(r.checks.slice(0, 5))).catch(() => { /* offline ok */ });
    api<{ watches: { addr: string; chain: string }[] }>('/watchlist')
      .then((r) => setWatches(r.watches)).catch(() => { /* offline ok */ });
  }, []);

  function paste() {
    haptic();
    navigator.clipboard?.readText().then((t) => setInput(t.trim())).catch(() => { /* permission denied */ });
  }

  function focusSearch(): void {
    document.querySelector<HTMLInputElement>('#home-search')?.focus();
  }

  function cta() {
    haptic();
    if (input.trim()) onSearch(input.trim());
    else focusSearch();
  }

  // Дизайн мокапа №3 (выбран заказчиком 17.11): большая CTA + чистый список
  // функций с круглыми иконками и бейджами. Действия «отчёт/расследование/
  // AML» требуют последнего отчёта — если его нет, фокусируем поле поиска.
  function needReport(action: () => void): () => void {
    return () => {
      haptic();
      if (lastReport) action();
      else focusSearch();
    };
  }

  return (
    <div className="fade-in" style={{ padding: '18px 16px 8px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
        <Logo size={32} />
        <div style={{ fontWeight: 800, fontSize: 15.5 }}>Ares<span style={{ color: 'var(--red)' }}>Crypto</span></div>
        <button className="btn btn-ghost" style={{ marginLeft: 'auto', fontSize: 11, padding: '6px 10px' }} onClick={paste}>📋 Вставить</button>
      </div>

      <div style={{ marginTop: 14, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 99, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 8 }}>
        <input
          id="home-search"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Адрес · хэш · @username · .ton"
          style={{ background: 'transparent', border: 'none', padding: 0, fontSize: 13, color: 'var(--text)', flex: 1, minWidth: 0 }}
          onKeyDown={(e) => { if (e.key === 'Enter' && input.trim()) onSearch(input.trim()); }}
        />
        <span className="microlabel" style={{ fontSize: 9, whiteSpace: 'nowrap' }}>TRON·TON·ETH·BSC·BTC·SOL</span>
      </div>

      <button className="home-cta" onClick={cta} disabled={loading}>
        {loading ? 'Анализирую…' : 'Проверить кошелёк'}
        <span>отчёт за ~8 секунд · бесплатно</span>
      </button>

      {lastReport && (
        <div className="card2" style={{ marginTop: 12, cursor: 'pointer', padding: '10px 14px' }} onClick={() => { haptic(); onOpenReport(); }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="microlabel">Последний отчёт</span>
            <span className="mono" style={{ fontSize: 12, marginLeft: 'auto' }}>{short(lastReport.chains[0]?.account.addr ?? lastReport.input, 8, 6)}</span>
          </div>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>риск {lastReport.verdict.score}/100 · открыть →</div>
        </div>
      )}
      {error && <div style={{ color: 'var(--danger)', fontSize: 12, marginTop: 6 }}>{error}</div>}

      <div style={{ marginTop: 14 }}>
        <div className="mi" onClick={needReport(onOpenReport)}>
          <div className="mic ic-ok">📊</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <b>Быстрый отчёт</b>
            <i>вердикт, профиль поведения, KPI</i>
          </div>
          <span className="chev">›</span>
        </div>
        <div className="mi" onClick={needReport(onOpenGraph)}>
          <div className="mic ic-red">🔍</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <b>Расследование</b>
            <i>радар-граф потоков · куда уходят деньги</i>
          </div>
          <span className="chev">›</span>
        </div>
        <div className="mi" onClick={needReport(onAml)}>
          <div className="mic ic-teal">🛡</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <b>AML-досье</b>
            <i>профессиональный PDF · комплаенс-формат</i>
          </div>
          <span className="badge-new">NEW</span>
        </div>
        <div className="mi" onClick={() => { haptic(); onNav('monitor'); }}>
          <div className="mic ic-blue">🔔</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <b>Мониторинг</b>
            <i>каждые 5 минут · пуш при движениях</i>
          </div>
          {watches.length > 0 && <span className="badge-red">{watches.length}</span>}
        </div>
        <div className="mi" onClick={() => { haptic(); onNav('history'); }}>
          <div className="mic ic-amber">🕘</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <b>История проверок</b>
            <i>{history.length ? 'последние 5 · повтор в один тап' : 'пока пусто'}</i>
          </div>
          <span className="chev">›</span>
        </div>
        <div className="mi" style={{ borderBottom: 'none' }} onClick={() => { haptic(); onNav('settings'); }}>
          <div className="mic ic-purple">⚙</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <b>Настройки</b>
            <i>глубина графа · пороги алертов</i>
          </div>
          <span className="chev">›</span>
        </div>
      </div>

      {history.length > 0 && (
        <div className="card" style={{ marginTop: 12, padding: '10px 14px' }}>
          <div className="microlabel" style={{ marginBottom: 4 }}>Недавние проверки</div>
          {history.map((h, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', cursor: 'pointer' }} onClick={() => { haptic(); onSearch(h.input); }}>
              <span className="mono" style={{ fontSize: 12 }}>{short(h.input, 8, 6)}</span>
              <span style={{ fontSize: 11, color: 'var(--muted)' }}>{h.verdict}</span>
            </div>
          ))}
        </div>
      )}

      <div style={{ color: 'var(--muted)', fontSize: 10.5, marginTop: 12, textAlign: 'center' }}>
        или просто пришли адрес в чат бота<br />
        Публичные блокчейн-данные. Вероятностные оценки.
      </div>
    </div>
  );
}

export function Logo({ size = 40 }: { size?: number }) {
  // Monogram «A» — sharp edges + Ferrari red accent (design system §16), pure SVG.
  return (
    <svg width={size} height={size} viewBox="0 0 48 48">
      <defs>
        <linearGradient id="ar" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#D40000" />
          <stop offset="100%" stopColor="#8F0000" />
        </linearGradient>
      </defs>
      <rect x="1" y="1" width="46" height="46" rx="12" fill="#131315" stroke="#232328" />
      <path d="M10 38 L24 8 L38 38 L31.5 38 L24 20 L16.5 38 Z" fill="url(#ar)" />
      <path d="M18 30 L30 30" stroke="#F2F2F3" strokeWidth="3" />
    </svg>
  );
}
