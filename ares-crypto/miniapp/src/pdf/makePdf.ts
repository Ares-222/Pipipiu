// PDF generation (K7): jsPDF + embedded DejaVu Sans (Cyrillic, font file in repo:
// public/fonts/DejaVuSans.ttf — подключается через addFont, не системный).
// Состав: шапка (объект, дата), таблица балансов, таблица транзакций, метки,
// скам/санкции, находки, AML, граф-снимок, дисклеймер. -> base64 -> POST /api/pdf.

import { jsPDF } from 'jspdf';
import { fmt, fmtUsd, short, levelRu, type WalletReport } from '../api';

const FONT_URL = './fonts/DejaVuSans.ttf';
const FONT_NAME = 'DejaVuSans';

let fontLoaded = false;

async function loadFont(doc: jsPDF): Promise<void> {
  if (fontLoaded) return;
  const res = await fetch(FONT_URL);
  if (!res.ok) throw new Error('шрифт DejaVuSans.ttf не найден (положи файл в public/fonts/)');
  const buf = await res.arrayBuffer();
  const b64 = arrayBufferToBase64(buf);
  doc.addFileToVFS(`${FONT_NAME}.ttf`, b64);
  doc.addFont(`${FONT_NAME}.ttf`, FONT_NAME, 'normal');
  fontLoaded = true;
}

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

export async function makePdf(report: WalletReport): Promise<string> {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  await loadFont(doc);
  doc.setFont(FONT_NAME);
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  let y = 0;

  const line = (txt: string, size = 10, bold = false, color: [number, number, number] = [20, 20, 24]): void => {
    if (y > H - 60) { doc.addPage(); y = 50; }
    doc.setFontSize(size);
    doc.setTextColor(...color);
    doc.text(txt, 40, y);
    y += size + 6;
  };
  const section = (t: string): void => {
    y += 8;
    line(t.toUpperCase(), 11, true, [194, 24, 7]);
  };

  // header
  doc.setFillColor(10, 10, 11);
  doc.rect(0, 0, W, 90, 'F');
  doc.setTextColor(255, 40, 0);
  doc.setFontSize(18);
  doc.text('ARES CRYPTO-ANALYTICS', 40, 40);
  doc.setTextColor(240, 240, 243);
  doc.setFontSize(10);
  doc.text('Полный отчёт · публичные блокчейн-данные', 40, 58);
  doc.setTextColor(138, 138, 144);
  doc.text(`Сформирован: ${new Date(report.createdAt * 1000).toLocaleString('ru-RU')}`, 40, 74);
  y = 120;

  for (const cr of report.chains) {
    section(`Кошелёк ${cr.chain.toUpperCase()}`);
    line(`Адрес: ${cr.account.addr}`, 9);
    line(`Баланс: ${fmt(cr.account.balanceNative)} нативной монеты · провайдеры: ${(cr.providers ?? []).join(', ')}`, 9);
    line(`Вердикт риска: ${report.verdict.score}/100 — ${levelRu(report.verdict.level)}`, 10, true);

    // balances table
    section('Балансы');
    for (const t of cr.account.tokens.slice(0, 15)) {
      line(`  ${t.symbol}: ${fmt(t.amount)}`, 9);
    }
    if (cr.account.tokens.length === 0) line('  токены не найдены / не поддерживаются free-источником', 9);

    // transactions table (last 30)
    section('Транзакции (последние 30)');
    for (const t of cr.txs.slice(0, 30)) {
      const dir = t.direction === 'in' ? '← вход' : t.direction === 'out' ? '→ выход' : '·self';
      const cp = t.direction === 'in' ? t.from : t.to;
      const lbl = (t.direction === 'in' ? t.labelFrom : t.labelTo)?.name;
      line(`${new Date(t.ts * 1000).toLocaleDateString('ru-RU')}  ${dir}  ${fmt(t.amount)} ${t.asset}  ${short(cp, 8, 6)}${lbl ? ` [${lbl}]` : ''}`, 8);
      line(`     tx: ${t.hash.slice(0, 40)}…`, 7, false, [110, 110, 118]);
    }

    // labels / findings
    if (cr.findings.length) {
      section('Признаки риска');
      for (const f of cr.findings) line(`  • ${f.title} — ${f.detail}`, 9);
    }
    if (cr.classification) {
      section('Профиль поведения');
      line(`  ${cr.classification.title} (достоверность: ${cr.classification.confidence})`, 9);
      line(`  Раздача ${cr.classification.scores.fanout} · Сбор ${cr.classification.scores.fanin} · Автомат ${cr.classification.scores.auto} · Биржа/сервис ${cr.classification.scores.cexService} · Транзит ${cr.classification.scores.transit} · Личный ${cr.classification.scores.personal}`, 8);
    }
    if (cr.transit && cr.transit.matched > 0) {
      section('Транзитность');
      line(`  Сопоставлено пар: ${cr.transit.matched} из ${cr.transit.ofIn} (${Math.round(cr.transit.pct)}%), медиана удержания ${cr.transit.medianHoldMin ?? '—'} мин`, 9);
      for (const p of cr.transit.top.slice(0, 8)) {
        line(`    ${p.delayMin} мин: ${fmt(p.inAmount)} → ${fmt(p.outAmount)} → ${short(p.to, 8, 4)}`, 8);
      }
    }
    if (cr.aml) {
      section('AML');
      line(`  Оценка: ${cr.aml.score}/100 — ${levelRu(cr.aml.level)}`, 9);
      for (const h of cr.aml.hits.slice(0, 6)) {
        line(`  • ${h.source} (${h.severity}) — ${h.hops === 0 ? 'прямой контакт' : `${h.hops} хоп`}, доля ${Math.round(h.volumeShare * 100)}%`, 8);
      }
      line(`  ${cr.aml.disclaimer}`, 8, false, [110, 110, 118]);
    }
    if (cr.telegram && (cr.telegram.usernames.length || cr.telegram.domains.length || cr.telegram.numbers.length)) {
      section('Связи с Telegram (TON) — вероятностные');
      for (const u of cr.telegram.usernames) line(`  • username ${u.username} (${u.confidence}) — t.me/${u.username.replace('@', '')}`, 9);
      for (const n of cr.telegram.numbers) line(`  • номер ${n.number} (${n.confidence})`, 9);
      for (const d of cr.telegram.domains) line(`  • домен ${d.domain} (${d.confidence})`, 9);
    }
    if (cr.partial) line('⚠ Частичные данные: часть free-источников была недоступна.', 9, false, [245, 158, 11]);
  }

  // footer disclaimer on every page
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setFontSize(7);
    doc.setTextColor(138, 138, 144);
    doc.text(`Ares Crypto-Analytics · стр. ${p}/${pages} · Публичные блокчейн-данные. Вероятностные оценки. Не является финансовым советом или юридическим доказательством.`, 40, H - 24);
  }

  return doc.output('datauristring').split(',')[1];
} 
