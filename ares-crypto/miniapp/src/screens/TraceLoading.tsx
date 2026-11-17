import { useEffect, useState } from 'react';
import { short } from '../api';
import { haptic } from '../tg';

// Экран запуска расследования — заменяет прежнее серое «загружаю…» (жалоба заказчика
// от 17.11: «серый и не особо понятный»). Трассировка — один запрос к /api/graph
// (бюджет ~30 fetch на воркере), промежуточного %-прогресса API не отдаёт, поэтому
// этапы идут по таймеру. ВАЖНО: список этапов ЧЕСТНО повторяет фактические шаги
// runTrace() (worker/src/engine/tracer.ts) — это описание реальной работы, а не выдумка.
const STAGES = [
  { at: 0, label: 'Запрашиваю историю переводов кошелька' },
  { at: 3, label: 'Считаю контрагентов и их обороты' },
  { at: 6, label: 'Проверяю метки и риск-списки: OFAC · скам · миксеры' },
  { at: 10, label: 'Строю граф потоков средств' },
  { at: 15, label: 'Распутываю миксеры · unmix-матчинг' },
  { at: 19, label: 'Считаю, куда утекли средства' },
];

export default function TraceLoading({ addr, chain, onCancel }: {
  addr: string;
  chain: string;
  onCancel: () => void;
}) {
  const [t, setT] = useState(0);
  useEffect(() => {
    const iv = setInterval(() => setT((x) => x + 1), 1000);
    return () => clearInterval(iv);
  }, []);
  const stepIdx = STAGES.reduce((acc, _s, i) => (t >= STAGES[i].at ? i : acc), 0);

  return (
    <div className="fade-in" style={{ padding: '24px 18px 32px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <Radar />
      <div className="microlabel" style={{ marginTop: 16, fontSize: 11 }}>Расследование · {chain.toUpperCase()}</div>
      <div className="mono" style={{ fontSize: 13, marginTop: 4, wordBreak: 'break-all', textAlign: 'center' }}>{short(addr, 10, 8)}</div>
      <div className="mono" style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>прошло {t} с · обычно 5–20 с</div>

      <div className="card" style={{ width: '100%', maxWidth: 420, marginTop: 18 }}>
        {STAGES.map((s, i) => (
          <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '7px 0', opacity: i > stepIdx ? 0.4 : 1 }}>
            <span className={`stage-dot ${i < stepIdx ? 'done' : i === stepIdx ? 'active' : 'wait'}`}>
              {i < stepIdx ? '✓' : i === stepIdx ? '' : '·'}
            </span>
            <span style={{ fontSize: 12.5, fontWeight: i === stepIdx ? 600 : 400, color: i === stepIdx ? 'var(--text)' : i < stepIdx ? 'var(--muted)' : 'var(--text)' }}>
              {s.label}
            </span>
          </div>
        ))}
        {t >= 25 && (
          <div style={{ fontSize: 11, color: 'var(--warn)', marginTop: 10, lineHeight: 1.5 }}>
            Free-тарифы провайдеров сейчас отвечают медленнее обычного — продолжаю, данные не теряются.
          </div>
        )}
      </div>

      <button className="btn" style={{ marginTop: 16 }} onClick={() => { haptic(); onCancel(); }}>✕ Отменить</button>

      <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 14, textAlign: 'center', lineHeight: 1.6 }}>
        Расследование разворачивает граф на 2 хопа и проверяет контрагентов<br />
        по меткам бирж, сервисов, TG-ботов и риск-списков.<br />
        Красный узел в центре — кошелёк, который вы проверяете.
      </div>
    </div>
  );
}

// Радар: три расходящихся кольца + вращающийся луч + красное ядро (дизайн-система §16).
function Radar() {
  return (
    <div className="radar" aria-hidden>
      <div className="radar-ring" />
      <div className="radar-ring" />
      <div className="radar-ring" />
      <div className="radar-static" />
      <div className="radar-static2" />
      <div className="radar-sweep" />
      <div className="radar-core" />
    </div>
  );
}
