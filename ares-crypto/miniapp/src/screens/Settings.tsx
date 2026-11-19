import { useEffect, useState } from 'react';
import { api } from '../api';
import { haptic } from '../tg';

interface MeInfo {
  quickUsed: number; deepUsed: number; amlUsed: number; watchesUsed: number;
  isOwner?: boolean; resetAt?: string;
}

export default function Settings({ notify, onNav }: { notify: (m: string) => void; onNav: (s: 'glossary') => void }) {
  const [settings, setSettings] = useState<{ minAlertUsd: number; traceDepth: number }>({ minAlertUsd: 10, traceDepth: 2 });
  const [quota, setQuota] = useState<{ quick: number; deep: number; aml: number; watches: number }>({ quick: 40, deep: 5, aml: 40, watches: 5 });
  const [me, setMe] = useState<MeInfo | null>(null);

  useEffect(() => {
    api<{ settings: typeof settings; quota: typeof quota }>('/settings')
      .then((r) => { setSettings(r.settings); setQuota(r.quota); })
      .catch(() => { /* offline ok */ });
    // №23 (v7): честный дашборд остатков — /me отдаёт использованное и лимиты.
    api<{ user: MeInfo }>('/me').then((r) => setMe(r.user)).catch(() => setMe(null));
  }, []);

  async function save(patch: Record<string, number>) {
    haptic();
    try {
      const r = await api<{ settings: typeof settings }>('/settings', { method: 'POST', body: JSON.stringify(patch) });
      setSettings(r.settings);
      notify('✅ Сохранено');
    } catch (e) { notify('⚠️ ' + (e as Error).message); }
  }

  const rows: { label: string; used: number; limit: number }[] = me ? [
    { label: 'Быстрые отчёты', used: me.quickUsed, limit: quota.quick },
    { label: 'Расследования', used: me.deepUsed, limit: quota.deep },
    { label: 'AML-проверки', used: me.amlUsed, limit: quota.aml },
    { label: 'Мониторинг', used: me.watchesUsed, limit: quota.watches },
  ] : [];

  return (
    <div className="fade-in" style={{ padding: 14 }}>
      <div className="microlabel" style={{ marginBottom: 8 }}>Настройки</div>
      <div className="card" style={{ marginBottom: 10 }}>
        <div style={{ fontSize: 13, marginBottom: 6 }}>Минимальная сумма алертов мониторинга</div>
        <div style={{ display: 'flex', gap: 6 }}>
          {[5, 10, 50, 100].map((v) => (
            <button key={v} className={`btn ${settings.minAlertUsd === v ? 'btn-red' : ''}`} style={{ flex: 1, fontSize: 12 }} onClick={() => void save({ minAlertUsd: v })}>${v}</button>
          ))}
        </div>
      </div>
      <div className="card" style={{ marginBottom: 10 }}>
        <div style={{ fontSize: 13, marginBottom: 6 }}>Глубина трассировки по умолчанию</div>
        <div style={{ display: 'flex', gap: 6 }}>
          {[1, 2, 3, 4].map((v) => (
            <button key={v} className={`btn ${settings.traceDepth === v ? 'btn-red' : ''}`} style={{ flex: 1, fontSize: 12 }} onClick={() => void save({ traceDepth: v })}>{v}</button>
          ))}
        </div>
        <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6 }}>Глубже = больше контрагентов в графе, дольше и дороже по лимитам.</div>
      </div>
      <div className="card">
        <div className="microlabel" style={{ marginBottom: 8 }}>Лимиты сегодня (free-тарифы)</div>
        {me ? (
          <>
            {rows.map((r) => {
              const pct = r.limit > 0 ? Math.min(100, (r.used / r.limit) * 100) : 0;
              return (
                <div key={r.label} style={{ marginBottom: 10 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                    <span>{r.label}{me.isOwner ? ' · админ: ∞' : ''}</span>
                    <span className="mono" style={{ color: pct >= 100 ? 'var(--danger)' : pct >= 80 ? 'var(--warn)' : 'var(--muted)' }}>
                      {me.isOwner ? `${r.used} (без лимита)` : `${r.used} / ${r.limit}`}
                    </span>
                  </div>
                  <div className="bar-wrap"><div className="bar" style={{ width: `${pct}%`, background: pct >= 100 ? 'var(--danger)' : pct >= 80 ? 'var(--warn)' : 'var(--ok)' }} /></div>
                </div>
              );
            })}
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
              Обновление в 00:00 UTC{me.resetAt ? ` · следующее: ${me.resetAt}` : ''}. Повторная проверка того же адреса в течение 15 минут не списывает лимит (кэш отчёта).
            </div>
          </>
        ) : (
          <div style={{ fontSize: 12, lineHeight: 1.7 }}>
            Быстрых отчётов: {quota.quick}<br />
            Расследований: {quota.deep}<br />
            AML-проверок: {quota.aml}<br />
            Адресов мониторинга: {quota.watches}
          </div>
        )}
        <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6 }}>Квоты — защита лимитов бесплатных провайдеров, не жадность.</div>
      </div>
      <button className="btn" style={{ width: '100%', marginTop: 10, fontSize: 13 }} onClick={() => { haptic(); onNav('glossary'); }}>📚 Глоссарий · что значат термины отчёта</button>
      <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 12 }}>
        Публичные блокчейн-данные. Вероятностные оценки. Не является финансовым советом или юридическим доказательством.
      </div>
    </div>
  );
}
