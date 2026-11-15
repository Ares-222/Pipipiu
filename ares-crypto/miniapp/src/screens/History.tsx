import { useEffect, useState } from 'react';
import { api, short } from '../api';
import { haptic } from '../tg';

export default function History({ onOpenAddr }: { onOpenAddr: (a: string) => void }) {
  const [checks, setChecks] = useState<{ id: number; input: string; chain: string; verdict: string; createdTs: number }[]>([]);
  const [q, setQ] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    api<{ checks: typeof checks }>('/history').then((r) => setChecks(r.checks)).catch((e) => setError((e as Error).message));
  }, []);

  const filtered = checks.filter((c) => c.input.toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="fade-in" style={{ padding: 14 }}>
      <div className="microlabel" style={{ marginBottom: 8 }}>История проверок</div>
      <input placeholder="Поиск по адресу…" value={q} onChange={(e) => setQ(e.target.value)} style={{ marginBottom: 10 }} />
      {error && <div style={{ color: 'var(--danger)', fontSize: 12 }}>{error}</div>}
      {filtered.length === 0 && !error && <div className="card" style={{ color: 'var(--muted)', fontSize: 13 }}>Пока пусто.</div>}
      {filtered.map((c) => (
        <div key={c.id} className="card2" style={{ marginBottom: 8, cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }} onClick={() => { haptic(); onOpenAddr(c.input); }}>
          <div>
            <div className="mono" style={{ fontSize: 12 }}>{short(c.input, 12, 8)}</div>
            <div style={{ fontSize: 11, color: 'var(--muted)' }}>{c.chain.toUpperCase()} · {new Date(c.createdTs * 1000).toLocaleString('ru-RU')}</div>
          </div>
          <span className="badge">{c.verdict}</span>
        </div>
      ))}
    </div>
  );
}
