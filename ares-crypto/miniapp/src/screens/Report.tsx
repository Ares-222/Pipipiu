import { useMemo, useState } from 'react';
import { api, fmt, fmtUsd, fmtPct, short, levelRu, levelColor, categoryRu, categoryIcon, type WalletReport, type ChainReport, type Finding, type TraceResult } from '../api';
import { haptic } from '../tg';
import { renderCardJpeg } from '../card/card';
import { makePdf } from '../pdf/makePdf';
import { makeAmlPdf } from '../pdf/makeAmlPdf';

export default function Report({ report, trace, onGraph, notify, onOpenAddr, onRefresh }: {
  report: WalletReport;
  trace?: TraceResult | null;
  onGraph: () => void;
  notify: (m: string) => void;
  onOpenAddr: (addr: string) => void;
  onRefresh: () => Promise<WalletReport | null>;
}) {
  const cr = report.chains[0];
  const [openFinding, setOpenFinding] = useState<string | null>(null);
  const [busy, setBusy] = useState('');

  if (!cr) {
    return <div style={{ padding: 16 }}><div className="card">{report.warnings.join(' ') || 'Отчёт пуст'}</div></div>;
  }

  const addr = cr.account.addr;
  const k = cr.kpi;
  const findingsScore = Math.min(100, cr.findings.reduce((n, f) => n + (f.severity === 'red' ? 22 : f.severity === 'yellow' ? 12 : f.severity === 'blue' ? 6 : 3), 0));

  // Жёсткий гвард свежести (баг 00:40 17.11): карточка/PDF рендерятся только из
  // отчёта, только что полученного с сервера. Если обновить не удалось — старую
  // карточку молча отправлять НЕЛЬЗЯ: прерываем с понятной ошибкой.
  async function freshReport(): Promise<WalletReport> {
    try {
      const fresh = await onRefresh();
      if (fresh) return fresh;
    } catch (e) {
      throw new Error(`данные не обновились (${(e as Error).message}) — карточка не отправлена, попробуйте ещё раз`);
    }
    return report;
  }

  async function photoCard() {
    haptic(); setBusy('photo');
    try {
      const rep = await freshReport();
      const a = rep.chains[0]?.account.addr ?? rep.input;
      const jpeg = await renderCardJpeg(rep);
      await api('/render', { method: 'POST', body: JSON.stringify({ jpeg, caption: `Ares Crypto · ${short(a, 10, 8)}` }) });
      notify('📸 Фотокарточка отправлена в чат');
    } catch (e) { notify('⚠️ ' + (e as Error).message); } finally { setBusy(''); }
  }

  async function pdf() {
    haptic(); setBusy('pdf');
    try {
      const rep = await freshReport();
      const a = rep.chains[0]?.account.addr ?? rep.input;
      // Результат расследования попадает в PDF только если он для ЭТОГО адреса
      // и адрес совпадает со свежим отчётом (гвард устаревших данных).
      const freshAddr = rep.chains[0]?.account.addr ?? rep.input;
      const t = trace && trace.root === freshAddr ? trace : null;
      const b64 = await makePdf(rep, t);
      await api('/pdf', { method: 'POST', body: JSON.stringify({ pdf: b64, filename: `ares-${short(a, 6, 4)}.pdf`, caption: 'Полный отчёт PDF' }) });
      notify('📄 PDF отправлен в чат');
    } catch (e) { notify('⚠️ ' + (e as Error).message); } finally { setBusy(''); }
  }

  async function watch() {
    haptic(); setBusy('watch');
    try {
      await api('/watch', { method: 'POST', body: JSON.stringify({ addr, chain: cr.chain }) });
      notify('🔔 Мониторинг включён (проверка каждые 5 минут)');
    } catch (e) { notify('⚠️ ' + (e as Error).message); } finally { setBusy(''); }
  }

  // Отдельное профессиональное AML/KYT-досье документом в чат (17.11, заказчик).
  async function amlPdf() {
    haptic(); setBusy('amlpdf');
    try {
      const rep = await freshReport();
      const a = rep.chains[0]?.account.addr ?? rep.input;
      const b64 = await makeAmlPdf(rep);
      await api('/pdf', {
        method: 'POST',
        body: JSON.stringify({ pdf: b64, filename: `aml-${short(a, 6, 4)}.pdf`, caption: '🛡 AML/KYT-досье · профессиональный скоринг по публичным источникам' }),
      });
      notify('🛡 AML-досье отправлено в чат');
    } catch (e) { notify('⚠️ ' + (e as Error).message); } finally { setBusy(''); }
  }

  function exportJson() {
    haptic();
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `ares-${short(addr, 6, 4)}.json`;
    a.click();
    notify('⬇ JSON сохранён');
  }

  return (
    <div className="fade-in" style={{ padding: '14px' }}>
      {/* header */}
      <div className="card" style={{ marginBottom: 10 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
          <div>
            <div className="microlabel">{cr.chain.toUpperCase()} · {cr.account.isContract ? 'смарт-контракт' : 'кошелёк'}</div>
            <div className="mono" style={{ fontSize: 12, marginTop: 4, wordBreak: 'break-all' }}>{addr}</div>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
              данные на {new Date(report.createdAt * 1000).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })} · источники кэшируются до 10 мин
            </div>
          </div>
          {cr.classification && (
            <span className="badge" style={{ flex: 'none' }}>{cr.classification.title.split('(')[0].trim()}</span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 10 }}>
          <span className="head" style={{ fontSize: 26, fontWeight: 800, color: levelColor(report.verdict.level) }}>{report.verdict.score}</span>
          <span style={{ fontSize: 13, color: 'var(--muted)' }}>/100 · <b style={{ color: levelColor(report.verdict.level) }}>{levelRu(report.verdict.level)}</b></span>
        </div>
        {report.verdict.reasons.length > 0 && (
          <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>{report.verdict.reasons.slice(0, 4).join(' · ')}</div>
        )}
        <div className="mono" style={{ fontSize: 13, marginTop: 8 }}>
          Баланс: <b>{fmt(cr.account.balanceNative)}</b> {cr.chain === 'tron' ? 'TRX' : cr.chain === 'ton' ? 'TON' : cr.chain === 'btc' ? 'BTC' : cr.chain === 'sol' ? 'SOL' : cr.chain === 'bsc' ? 'BNB' : cr.chain === 'polygon' ? 'POL' : 'ETH'}
        </div>
      </div>

      {/* KPI row */}
      {k && (
        <>
          <div className="microlabel" style={{ margin: '12px 4px 6px' }}>KPI · {cr.txs.length} последних движений</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <Kpi label="Получено" v={fmtUsd(k.received)} s={`${k.receivedCount} операций`} />
            <Kpi label="Отправлено" v={fmtUsd(k.sent)} s={`${k.sentCount} операций`} />
            <Kpi label="Осело на адресе" v={fmtPct(k.settledPct)} s="от всего входящего" />
            <Kpi label="Контрагентов" v={String(k.counterpartiesIn + k.counterpartiesOut)} s={`${k.counterpartiesIn} отправ. / ${k.counterpartiesOut} получ.`} />
            <Kpi label="Оборот" v={fmtUsd(k.turnover)} s="сумма всех движений" />
            <Kpi label="Средний перевод" v={fmtUsd(k.avgTx)} s={`медиана ${fmtUsd(k.medianTx)}`} />
            <Kpi label="Крупнейший перевод" v={fmtUsd(k.maxTx)} />
            <Kpi label="Активных дней" v={String(k.activeDays)} s={k.ageDays !== null ? `за ${k.ageDays} дн. жизни` : 'возраст неизвестен'} />
          </div>
        </>
      )}

      {/* findings */}
      <div className="microlabel" style={{ margin: '14px 4px 6px' }}>Признаки риска · {findingsScore}/100</div>
      <div className="card">
        {cr.findings.length === 0 && <div style={{ color: 'var(--muted)', fontSize: 13 }}>Явных признаков риска не найдено (эвристика).</div>}
        {cr.findings.map((f) => (
          <FindingRow key={f.id} f={f} open={openFinding === f.id} onToggle={() => { haptic(); setOpenFinding(openFinding === f.id ? null : f.id); }} onGraph={onGraph} onOpenAddr={onOpenAddr} />
        ))}
      </div>

      {/* classification */}
      {cr.classification && (
        <>
          <div className="microlabel" style={{ margin: '14px 4px 6px' }}>Профиль поведения</div>
          <div className="card">
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--info)' }}>{cr.classification.title}</div>
            <div style={{ fontSize: 12, color: 'var(--muted)', margin: '2px 0 10px' }}>достоверность: {ruConf(cr.classification.confidence)}</div>
            {ROLE_LIST.map((r) => (
              <div key={r.key} style={{ marginBottom: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                  <span>{r.label}</span>
                  <span className="mono">{cr.classification!.scores[r.key] ?? 0}</span>
                </div>
                <div className="bar-wrap"><div className="bar" style={{ width: `${Math.min(100, cr.classification!.scores[r.key] ?? 0)}%` }} /></div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* transit */}
      {cr.transit && cr.transit.matched > 0 && (
        <>
          <div className="microlabel" style={{ margin: '14px 4px 6px' }}>Транзитность · сколько входящего сразу уходит дальше</div>
          <div className="card">
            <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
              <div className="card2" style={{ flex: 1 }}>
                <div className="microlabel">Сопоставлено пар</div>
                <div className="mono" style={{ fontSize: 20, fontWeight: 700 }}>{fmtPct(cr.transit.pct)}</div>
                <div style={{ fontSize: 11, color: 'var(--muted)' }}>{cr.transit.matched} из {cr.transit.ofIn}</div>
              </div>
              <div className="card2" style={{ flex: 1 }}>
                <div className="microlabel">Медиана удержания</div>
                <div className="mono" style={{ fontSize: 20, fontWeight: 700 }}>{cr.transit.medianHoldMin ?? '—'}<span style={{ fontSize: 13 }}> мин</span></div>
                <div style={{ fontSize: 11, color: 'var(--muted)' }}>{fmtPct(cr.transit.under60Pct)} быстрее часа</div>
              </div>
            </div>
            <div className="microlabel" style={{ marginBottom: 4 }}>Самые быстрые пересылки</div>
            <div className="table-row" style={{ color: 'var(--muted)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              <span>Задержка ↓</span><span>Пришло</span><span>Ушло</span><span>Кому</span>
            </div>
            {cr.transit.top.slice(0, 8).map((p, i) => (
              <div key={i} className="table-row mono">
                <span style={{ color: 'var(--info)' }}>{p.delayMin} мин</span>
                <span>{fmt(p.inAmount)}</span>
                <span>{fmt(p.outAmount)}</span>
                <span style={{ color: 'var(--info)', cursor: 'pointer' }} onClick={() => onOpenAddr(p.to)}>{short(p.to, 6, 4)}{p.toLabel ? ` · ${p.toLabel}` : ''}</span>
              </div>
            ))}
          </div>
        </>
      )}

      {/* AML */}
      {cr.aml && (
        <>
          <div className="microlabel" style={{ margin: '14px 4px 6px' }}>AML · источники грязи</div>
          <div className="card">
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <span className="head" style={{ fontSize: 24, fontWeight: 800, color: levelColor(cr.aml.level) }}>{cr.aml.score}</span>
              <span style={{ color: 'var(--muted)', fontSize: 13 }}>/100 · <b style={{ color: levelColor(cr.aml.level) }}>{levelRu(cr.aml.level)}</b></span>
            </div>
            {cr.aml.hits.length === 0 && <div style={{ color: 'var(--muted)', fontSize: 12, marginTop: 6 }}>Грязных источников в графе не найдено.</div>}
            {cr.aml.hits.slice(0, 6).map((h, i) => (
              <div key={i} style={{ fontSize: 12, padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
                <b>{h.source}</b> <span className="badge">{h.severity}</span> · {h.hops === 0 ? 'прямой контакт' : `${h.hops} хоп`} · доля {fmtPct(h.volumeShare * 100)}
                {h.path && <div className="mono" style={{ color: 'var(--muted)', fontSize: 11, marginTop: 2 }}>{h.path.map((p) => short(p, 6, 4)).join(' → ')}</div>}
              </div>
            ))}
            {cr.aml.exchangeExit.length > 0 && (
              <div style={{ fontSize: 12, marginTop: 6 }}>
                🏦 KYC-деанонимизация: {cr.aml.exchangeExit.slice(0, 3).map((e) => e.label).join(', ')}
              </div>
            )}
            {(cr.aml.exposure ?? []).length > 0 && (
              <div style={{ marginTop: 10 }}>
                <div className="microlabel" style={{ marginBottom: 6 }}>Происхождение входящих средств</div>
                {cr.aml.exposure.slice(0, 8).map((e, i) => (
                  <div key={i} style={{ marginBottom: 6 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                      <span>{e.ru}</span>
                      <span className="mono">{fmtPct(e.pct)}</span>
                    </div>
                    <div className="bar-wrap"><div className="bar" style={{ width: `${Math.min(100, e.pct)}%`, background: toneColor(e.tone) }} /></div>
                  </div>
                ))}
              </div>
            )}
            {(cr.aml.topOut ?? []).length > 0 && (
              <div style={{ marginTop: 10 }}>
                <div className="microlabel" style={{ marginBottom: 4 }}>Куда ушло · крупнейшие исходящие</div>
                {cr.aml.topOut.slice(0, 5).map((o, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 12 }}>
                    <span className="mono" style={{ color: 'var(--info)', cursor: 'pointer' }} onClick={() => onOpenAddr(o.addr)}>
                      {categoryIcon(o.category)} {short(o.addr)}{o.label ? ` · ${o.label}` : ''} · <span style={{ color: 'var(--warn)' }}>{categoryRu(o.category)}</span>
                    </span>
                    <span className="mono">{o.usd !== undefined ? fmtUsd(o.usd) : `${fmt(o.amount)} ${o.asset}`} · {Math.round(o.share * 100)}%</span>
                  </div>
                ))}
              </div>
            )}
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 8 }}>{cr.aml.disclaimer}</div>
          </div>
        </>
      )}

      {/* telegram */}
      {cr.telegram && (cr.telegram.usernames.length > 0 || cr.telegram.numbers.length > 0 || cr.telegram.domains.length > 0) && (
        <>
          <div className="microlabel" style={{ margin: '14px 4px 6px' }}>Связи с Telegram (TON)</div>
          <div className="card">
            {cr.telegram.usernames.map((u, i) => (
              <div key={i} style={{ padding: '5px 0', fontSize: 13 }}>
                ✈️ <b>{u.username}</b> <span className="badge">{ruConf(u.confidence)}</span> · <a style={{ color: 'var(--info)' }} href={`https://t.me/${u.username.replace('@', '')}`} target="_blank" rel="noreferrer">t.me/{u.username.replace('@', '')}</a>
              </div>
            ))}
            {cr.telegram.numbers.map((n, i) => (
              <div key={i} style={{ padding: '5px 0', fontSize: 13 }}>📱 Анонимный номер {n.number} <span className="badge">{ruConf(n.confidence)}</span></div>
            ))}
            {cr.telegram.domains.map((d, i) => (
              <div key={i} style={{ padding: '5px 0', fontSize: 13 }}>🌐 {d.domain} <span className="badge">{ruConf(d.confidence)}</span></div>
            ))}
            {cr.telegram.note && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6 }}>{cr.telegram.note}</div>}
          </div>
        </>
      )}

      {/* tokens */}
      {cr.account.tokens.length > 0 && (
        <>
          <div className="microlabel" style={{ margin: '14px 4px 6px' }}>Токены</div>
          <div className="card">
            {cr.account.tokens.slice(0, 10).map((t, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 13 }}>
                <span className="mono">{t.symbol}</span>
                <span className="mono" style={{ color: 'var(--muted)' }}>{fmt(t.amount)}</span>
              </div>
            ))}
          </div>
        </>
      )}

      {cr.partial && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 8 }}>⚠️ Частичные данные ({(cr.providers ?? []).join(', ')}) — часть источников недоступна на free-тарифах.</div>}

      {/* actions */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 14, marginBottom: 8 }}>
        <button className="btn btn-red" onClick={onGraph}>🔍 Расследование</button>
        <button className="btn" onClick={photoCard} disabled={busy === 'photo'}>{busy === 'photo' ? '…' : '📸 Фотокарточка'}</button>
        <button className="btn" onClick={watch} disabled={busy === 'watch'}>{busy === 'watch' ? '…' : '🔔 Следить'}</button>
        <button className="btn" onClick={pdf} disabled={busy === 'pdf'}>{busy === 'pdf' ? '…' : '📄 PDF'}</button>
        <button className="btn" style={{ gridColumn: '1 / -1' }} onClick={amlPdf} disabled={busy === 'amlpdf'}>{busy === 'amlpdf' ? '⏳ Собираю досье…' : '🛡 AML-отчёт (PDF в чат)'}</button>
        <button className="btn btn-ghost" style={{ gridColumn: '1 / -1' }} onClick={exportJson}>⬇ Экспорт JSON</button>
      </div>

      <div style={{ color: 'var(--muted)', fontSize: 11, textAlign: 'center', marginTop: 8 }}>
        Ares Crypto-Analytics · данные: публичные блокчейны · вероятностные оценки
      </div>
    </div>
  );
}

function Kpi({ label, v, s }: { label: string; v: string; s?: string }) {
  return (
    <div className="kpi">
      <div className="microlabel">{label}</div>
      <div className="v">{v}</div>
      {s && <div className="s">{s}</div>}
    </div>
  );
}

const ROLE_LIST = [
  { key: 'fanout', label: 'Раздача' },
  { key: 'fanin', label: 'Сбор' },
  { key: 'auto', label: 'Автомат' },
  { key: 'cexService', label: 'Биржа/сервис' },
  { key: 'transit', label: 'Транзит' },
  { key: 'personal', label: 'Личный' },
];

function ruConf(c: string): string {
  return c === 'high' ? 'достоверность: high' : c === 'mid' ? 'достоверность: mid' : 'достоверность: low';
}

function toneColor(t: string): string {
  return t === 'bad' ? 'var(--danger)' : t === 'warn' ? 'var(--warn)' : t === 'blue' ? 'var(--info)' : t === 'ok' ? 'var(--ok)' : 'var(--muted)';
}

function FindingRow({ f, open, onToggle, onGraph, onOpenAddr }: {
  f: Finding; open: boolean; onToggle: () => void; onGraph: () => void; onOpenAddr: (a: string) => void;
}) {
  return (
    <div style={{ padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
      <div style={{ display: 'flex', gap: 8, cursor: 'pointer' }} onClick={onToggle}>
        <span className={`dot dot-${f.severity}`} style={{ marginTop: 5 }} />
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 600, fontSize: 13 }}>{f.title}</div>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>{f.detail}</div>
        </div>
        <span style={{ color: 'var(--muted)', fontSize: 12 }}>{open ? '▲' : '▼'}</span>
      </div>
      {open && f.addresses && (
        <div style={{ marginTop: 8, paddingLeft: 16 }}>
          {f.addresses.map((a, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 12 }}>
              <span className="mono" style={{ color: 'var(--info)', cursor: 'pointer' }} onClick={() => onOpenAddr(a.addr)}>{a.addr}</span>
              <span style={{ color: 'var(--muted)' }}>{a.label ? `🏷 ${a.label}` : ''} {a.amounts ?? ''}</span>
            </div>
          ))}
        </div>
      )}
      {open && f.graphRef && (
        <button className="btn btn-ghost" style={{ marginTop: 8, marginLeft: 16, fontSize: 12 }} onClick={onGraph}>❋ показать в графе</button>
      )}
    </div>
  );
}
