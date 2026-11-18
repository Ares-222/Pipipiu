import { useEffect, useState } from 'react';
import { api, short, type TraceResult } from '../api';
import { haptic } from '../tg';

export default function History({ onOpenAddr, onOpenTrace }: { onOpenAddr: (a: string) => void; onOpenTrace: (t: TraceResult) => void }) {
  const [checks, setChecks] = useState<{ id: number; input: string; chain: string; verdict: string; createdTs: number }[]>([]);
  const [traces, setTraces] = useState<{ id: number; root: string; chain: string; depth: number; createdTs: number }[]>([]);
  const [q, setQ] = useState('');
  const [error, setError] = useState('');
  const [busyTrace, setBusyTrace] = useState(0);

  useEffect(() => {
    api<{ checks: typeof checks }>('/history').then((r) => setChecks(r.checks)).catch((e) => setError((e as Error).message));
    api<{ traces: typeof traces }>('/trace-history').then((r) => setTraces(r.traces)).catch(() => { /* пусто, если нет сохранённых */ });
  }, []);

  // Открыть сохранённое расследование без повторного прохождения (№7).
  async function openTrace(id: number) {
    haptic(); setBusyTrace(id);
    try {
      const r = await api<{ trace: TraceResult }>(`/trace?id=${id}`);
      onOpenTrace(r.trace);
    } catch (e) { setError((e as Error).message); } finally { setBusyTrace(0); }
  }

  const filtered = checks.filter((c) => c.input.toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="fade-in" style={{ padding: 14 }}>
      <div className="microlabel" style={{ marginBottom: 8 }}>Расследования · сохранённые графы</div>
      {traces.length === 0 && <div className="card" style={{ color: 'var(--muted)', fontSize: 12 }}>Сохранённых расследований пока нет — запусти «🔍 Расследование» в отчёте; граф сохранится автоматически.</div>}
      {traces.map((t) => (
        <div key={t.id} className="card2" style={{ marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <div style={{ minWidth: 0 }}>
            <div className="mono" style={{ fontSize: 12 }}>{short(t.root, 10, 6)}</div>
            <div style={{ fontSize: 11, color: 'var(--muted)' }}>{t.chain.toUpperCase()} · глубина {t.depth} · {new Date(t.createdTs * 1000).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</div>
          </div>
          <button className="btn btn-red" style={{ fontSize: 11, padding: '6px 10px', flex: 'none' }} disabled={busyTrace === t.id} onClick={() => void openTrace(t.id)}>
            {busyTrace === t.id ? '…' : 'Открыть'}
          </button>
        </div>
      ))}

      <div className="microlabel" style={{ margin: '14px 4px 8px' }}>История проверок</div>
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
