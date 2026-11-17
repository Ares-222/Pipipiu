import { useEffect, useState } from 'react';
import { api, fmt, short, fmtPct } from '../api';
import { haptic } from '../tg';

export default function Monitor({ onOpenAddr }: { onOpenAddr: (a: string) => void }) {
  const [watches, setWatches] = useState<{ id: number; addr: string; chain: string; minUsd: number; active: boolean }[]>([]);
  const [events, setEvents] = useState<{ id: number; direction: string; amount: number; asset: string; counterparty: string; label?: string; ts: number; watchId: number }[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    api<{ watches: typeof watches; events: typeof events }>('/watchlist')
      .then((r) => { setWatches(r.watches); setEvents(r.events); })
      .catch((e) => setError((e as Error).message));
  }, []);

  async function unwatch(addr: string) {
    haptic();
    try {
      await api(`/watch?addr=${encodeURIComponent(addr)}`, { method: 'DELETE' });
      setWatches((w) => w.filter((x) => x.addr !== addr));
    } catch (e) { setError((e as Error).message); }
  }

  return (
    <div className="fade-in" style={{ padding: 14 }}>
      <div className="microlabel" style={{ marginBottom: 8 }}>Мониторинг · проверка каждые 5 минут</div>
      {error && <div style={{ color: 'var(--danger)', fontSize: 12 }}>{error}</div>}
      {watches.length === 0 && !error && (
        <div className="card" style={{ color: 'var(--muted)', fontSize: 13 }}>
          Список пуст. Добавь адрес кнопкой 🔔 Следить на экране отчёта.
        </div>
      )}
      {watches.map((w) => (
        <div key={w.id} className="card" style={{ marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="dot" style={{ background: 'var(--ok)' }} />
          <div style={{ flex: 1 }}>
            <div className="mono" style={{ fontSize: 12 }}>{short(w.addr, 10, 6)}</div>
            <div style={{ fontSize: 11, color: 'var(--muted)' }}>{w.chain} · фильтр ≥ ${w.minUsd}</div>
          </div>
          <button className="btn" style={{ fontSize: 11, padding: '6px 10px' }} onClick={() => onOpenAddr(w.addr)}>📊</button>
          <button className="btn" style={{ fontSize: 11, padding: '6px 10px' }} onClick={() => unwatch(w.addr)}>✕</button>
        </div>
      ))}

      {events.length > 0 && (
        <>
          <div className="microlabel" style={{ margin: '14px 4px 6px' }}>Лента событий</div>
          <div className="card">
            {events.map((e) => (
              <div key={e.id} style={{ padding: '7px 0', borderBottom: '1px solid var(--border)', fontSize: 12 }}>
                <span style={{ color: e.direction === 'in' ? 'var(--ok)' : 'var(--danger)' }}>
                  {e.direction === 'in' ? '🔻 ВХОДЯЩАЯ' : '🔺 ИСХОДЯЩАЯ'}
                </span>
                <span className="mono"> {fmt(e.amount)} {e.asset}</span>
                <div style={{ color: 'var(--muted)', fontSize: 11, marginTop: 2 }}>
                  {e.direction === 'in' ? 'от' : 'кому'} <span className="mono">{short(e.counterparty, 8, 6)}</span>{e.label ? ` · 🏷 ${e.label}` : ''} · {new Date(e.ts * 1000).toLocaleString('ru-RU')}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
      <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 10 }}>
        Каждые 5 минут: новые входящие/исходящие с прошлого шага, изменение баланса, метки контрагентов. Минимальная сумма фильтра — в настройках ({fmtPct(0)} — см. /settings).
      </div>
    </div>
  );
}
