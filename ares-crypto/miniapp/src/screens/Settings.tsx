import { useEffect, useState } from 'react';
import { api } from '../api';
import { haptic } from '../tg';

export default function Settings({ notify }: { notify: (m: string) => void }) {
  const [settings, setSettings] = useState<{ minAlertUsd: number; traceDepth: number }>({ minAlertUsd: 10, traceDepth: 2 });
  const [quota, setQuota] = useState<{ quick: number; deep: number; aml: number; watches: number }>({ quick: 40, deep: 5, aml: 40, watches: 5 });
  const [user, setUser] = useState<{ quickUsed?: number; deepUsed?: number; amlUsed?: number }>({});

  useEffect(() => {
    api<{ settings: typeof settings; quota: typeof quota }>('/settings')
      .then((r) => { setSettings(r.settings); setQuota(r.quota); })
      .catch(() => { /* offline ok */ });
    api<{ user: typeof user }>('/me').then((r) => setUser(r.user)).catch(() => { /* endpoint optional */ });
  }, []);

  async function save(patch: Record<string, number>) {
    haptic();
    try {
      const r = await api<{ settings: typeof settings }>('/settings', { method: 'POST', body: JSON.stringify(patch) });
      setSettings(r.settings);
      notify('✅ Сохранено');
    } catch (e) { notify('⚠️ ' + (e as Error).message); }
  }

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
        <div className="microlabel" style={{ marginBottom: 6 }}>Квоты (сутки, free-тарифы)</div>
        <div style={{ fontSize: 12, lineHeight: 1.7 }}>
          Быстрых отчётов: {quota.quick} (использовано {user.quickUsed ?? 0})<br />
          Расследований: {quota.deep} (использовано {user.deepUsed ?? 0})<br />
          AML-проверок: {quota.aml} (использовано {user.amlUsed ?? 0})<br />
          Адресов мониторинга: {quota.watches}
        </div>
        <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6 }}>Квоты — защита лимитов бесплатных провайдеров, не жадность. Обновление в 00:00 UTC.</div>
      </div>
      <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 12 }}>
        Публичные блокчейн-данные. Вероятностные оценки. Не является финансовым советом или юридическим доказательством.
      </div>
    </div>
  );
}
