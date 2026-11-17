import { useEffect, useState } from 'react';
import { api, type WalletReport, short } from '../api';
import { haptic } from '../tg';

export default function Home({ onSearch, loading, error, onOpenReport, lastReport }: {
  onSearch: (input: string) => void;
  loading: boolean;
  error: string;
  onOpenReport: () => void;
  lastReport: WalletReport | null;
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

  return (
    <div className="fade-in" style={{ padding: '18px 14px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
        <Logo />
        <div>
          <div className="head" style={{ fontWeight: 700, fontSize: 17 }}>ARES CRYPTO</div>
          <div className="microlabel">Wallet OSINT · Analytics</div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 12 }}>
        <div className="microlabel" style={{ marginBottom: 8 }}>Проверка кошелька</div>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Адрес · хэш · @username · .ton"
          style={{ fontSize: 13 }}
          onKeyDown={(e) => { if (e.key === 'Enter' && input.trim()) onSearch(input.trim()); }}
        />
        <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
          <button className="btn btn-red" style={{ flex: 1 }} disabled={loading || !input.trim()} onClick={() => onSearch(input.trim())}>
            {loading ? 'Анализирую…' : '🔍 Проверить'}
          </button>
          <button className="btn" onClick={paste}>📋 Вставить</button>
        </div>
        {error && <div style={{ color: 'var(--danger)', fontSize: 12, marginTop: 8 }}>{error}</div>}
        <div style={{ color: 'var(--muted)', fontSize: 11, marginTop: 8 }}>
          TRON · TON · ETH · BSC · Polygon · OP · Arbitrum · Base · BTC · Solana
        </div>
      </div>

      {lastReport && (
        <div className="card2" style={{ marginBottom: 12, cursor: 'pointer' }} onClick={() => { haptic(); onOpenReport(); }}>
          <div className="microlabel">Последний отчёт</div>
          <div className="mono" style={{ fontSize: 12, marginTop: 4 }}>{short(lastReport.chains[0]?.account.addr ?? lastReport.input)}</div>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>риск {lastReport.verdict.score}/100 · открыть →</div>
        </div>
      )}

      {watches.length > 0 && (
        <div className="card" style={{ marginBottom: 12 }}>
          <div className="microlabel" style={{ marginBottom: 6 }}>Мониторинг · {watches.length}</div>
          {watches.slice(0, 3).map((w) => (
            <div key={w.addr} className="mono" style={{ fontSize: 12, padding: '4px 0' }}>
              <span style={{ color: 'var(--ok)' }}>●</span> {short(w.addr)}
            </div>
          ))}
        </div>
      )}

      {history.length > 0 && (
        <div className="card">
          <div className="microlabel" style={{ marginBottom: 6 }}>Недавние проверки</div>
          {history.map((h, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', cursor: 'pointer' }} onClick={() => { haptic(); onSearch(h.input); }}>
              <span className="mono" style={{ fontSize: 12 }}>{short(h.input)}</span>
              <span style={{ fontSize: 11, color: 'var(--muted)' }}>{h.verdict}</span>
            </div>
          ))}
        </div>
      )}

      <div style={{ color: 'var(--muted)', fontSize: 11, marginTop: 16, textAlign: 'center' }}>
        Публичные блокчейн-данные. Вероятностные оценки.<br />Не является финансовым советом или юридическим доказательством.
      </div>
    </div>
  );
}

export function Logo({ size = 40 }: { size?: number }) {
  // Monogram «A» — sharp edges + red accent (design system §16), pure SVG.
  return (
    <svg width={size} height={size} viewBox="0 0 48 48">
      <defs>
        <linearGradient id="ar" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#FF2800" />
          <stop offset="100%" stopColor="#C21807" />
        </linearGradient>
      </defs>
      <rect x="1" y="1" width="46" height="46" rx="12" fill="#131315" stroke="#232328" />
      <path d="M10 38 L24 8 L38 38 L31.5 38 L24 20 L16.5 38 Z" fill="url(#ar)" />
      <path d="M18 30 L30 30" stroke="#F2F2F3" strokeWidth="3" />
    </svg>
  );
}
