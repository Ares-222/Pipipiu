// Live PDF dossier: renders only data returned by WalletReport; no demo case data.
// The PDF is assembled client-side, then POSTed to /api/pdf for Telegram delivery.

import { jsPDF } from 'jspdf';
import { fmt, fmtUsd, levelRu, type ChainReport, type Tx, type WalletReport } from '../api';
import { renderCardJpeg } from '../card/card';
import { renderDirectFlowGraph } from './flowGraph';

type RGB = [number, number, number];

const C = {
  bg: [10, 10, 11] as RGB,
  panel: [19, 19, 21] as RGB,
  border: [41, 41, 47] as RGB,
  red: [255, 40, 0] as RGB,
  white: [242, 242, 243] as RGB,
  muted: [138, 138, 144] as RGB,
  incoming: [85, 214, 190] as RGB,
  outgoing: [255, 158, 66] as RGB,
  warning: [245, 158, 11] as RGB,
};

const FONT_NAME = 'DejaVuSans';
const FONT_URL = new URL(`${import.meta.env.BASE_URL}fonts/DejaVuSans.ttf`, window.location.href).href;
let fontBase64: string | null = null;

async function loadFont(doc: jsPDF): Promise<void> {
  if (!fontBase64) {
    const res = await fetch(FONT_URL);
    if (!res.ok) throw new Error('Не удалось загрузить кириллический шрифт отчёта');
    fontBase64 = arrayBufferToBase64(await res.arrayBuffer());
  }
  // Register the font on every jsPDF instance; instances do not share the VFS.
  doc.addFileToVFS(`${FONT_NAME}.ttf`, fontBase64);
  doc.addFont(`${FONT_NAME}.ttf`, FONT_NAME, 'normal');
  doc.setFont(FONT_NAME, 'normal');
}

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(bin);
}

function labelText(label: Tx['labelFrom']): string {
  if (!label?.name) return 'публичная метка не найдена';
  const category = label.category ? ` · ${label.category}` : '';
  const confidence = label.confidence ? ` · ${label.confidence}` : '';
  return `${label.name}${category}${confidence}`;
}

function recipientSummaries(cr: ChainReport): { addr: string; label: string; hashes: Set<string>; assets: Map<string, number> }[] {
  const recipients = new Map<string, { addr: string; label: string; hashes: Set<string>; assets: Map<string, number> }>();
  for (const tx of cr.txs) {
    if (tx.direction !== 'out' || !tx.to) continue;
    const key = tx.to.toLowerCase();
    const row = recipients.get(key) ?? {
      addr: tx.to,
      label: labelText(tx.labelTo),
      hashes: new Set<string>(),
      assets: new Map<string, number>(),
    };
    if (tx.hash) row.hashes.add(tx.hash);
    row.assets.set(tx.asset || 'актив', (row.assets.get(tx.asset || 'актив') ?? 0) + tx.amount);
    if (row.label === 'публичная метка не найдена' && tx.labelTo?.name) row.label = labelText(tx.labelTo);
    recipients.set(key, row);
  }
  return [...recipients.values()].sort((a, b) => b.hashes.size - a.hashes.size);
}

export async function makePdf(report: WalletReport): Promise<string> {
  const doc = new jsPDF({ unit: 'pt', format: 'a4', compress: true });
  await loadFont(doc);
  doc.setProperties({
    title: 'Ares Crypto — аналитическое досье',
    subject: 'Публичные данные блокчейна',
    author: 'Ares Crypto-Analytics',
    creator: 'Ares Crypto Mini App',
  });

  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const margin = 40;
  const contentW = W - margin * 2;
  let y = 78;

  function paintPage(): void {
    doc.setFillColor(...C.bg);
    doc.rect(0, 0, W, H, 'F');
    doc.setFillColor(...C.red);
    doc.rect(0, 0, W, 7, 'F');
    doc.setFont(FONT_NAME, 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...C.red);
    doc.text('ARES CRYPTO-ANALYTICS', margin, 30);
    doc.setTextColor(...C.muted);
    doc.text('ПУБЛИЧНЫЕ БЛОКЧЕЙН-ДАННЫЕ', W - margin, 30, { align: 'right' });
    doc.setDrawColor(...C.border);
    doc.setLineWidth(0.6);
    doc.line(margin, 40, W - margin, 40);
  }

  function addPage(): void {
    doc.addPage();
    paintPage();
    y = 68;
  }

  function ensureSpace(height: number): void {
    if (y + height > H - 45) addPage();
  }

  function textBlock(text: string, size = 9, color: RGB = C.white, gap = 4): void {
    if (!text) return;
    doc.setFont(FONT_NAME, 'normal');
    doc.setFontSize(size);
    doc.setTextColor(...color);
    const wrapped = doc.splitTextToSize(text, contentW) as string[];
    const leading = size * 1.45;
    for (const row of wrapped) {
      ensureSpace(leading + gap);
      doc.text(row, margin, y);
      y += leading;
    }
    y += gap;
  }

  function section(title: string): void {
    ensureSpace(30);
    y += 8;
    doc.setFillColor(...C.red);
    doc.roundedRect(margin, y - 12, 3, 17, 1.5, 1.5, 'F');
    doc.setFont(FONT_NAME, 'normal');
    doc.setFontSize(11);
    doc.setTextColor(...C.red);
    doc.text(title.toLocaleUpperCase('ru-RU'), margin + 12, y);
    y += 18;
  }

  function metricCard(label: string, value: string, note: string, x: number, top: number, width: number): void {
    doc.setFillColor(...C.panel);
    doc.setDrawColor(...C.border);
    doc.roundedRect(x, top, width, 58, 8, 8, 'FD');
    doc.setFont(FONT_NAME, 'normal');
    doc.setFontSize(7);
    doc.setTextColor(...C.muted);
    doc.text(label.toLocaleUpperCase('ru-RU'), x + 11, top + 15);
    doc.setFontSize(15);
    doc.setTextColor(...C.white);
    doc.text(doc.splitTextToSize(value, width - 22)[0] ?? value, x + 11, top + 35);
    doc.setFontSize(7);
    doc.setTextColor(...C.muted);
    doc.text(doc.splitTextToSize(note, width - 22)[0] ?? note, x + 11, top + 49);
  }

  function smallRow(label: string, value: string, color: RGB = C.white): void {
    textBlock(`${label}: ${value}`, 8, color, 2);
  }

  function addLedgerEntry(tx: Tx, index: number, chain: ChainReport): void {
    const rowHeight = 96;
    ensureSpace(rowHeight);
    const top = y - 10;
    doc.setFillColor(...C.panel);
    doc.setDrawColor(...C.border);
    doc.roundedRect(margin, top, contentW, rowHeight, 7, 7, 'FD');
    y = top + 14;
    const direction = tx.direction === 'in' ? 'ВХОДЯЩИЙ' : tx.direction === 'out' ? 'ИСХОДЯЩИЙ' : 'ВНУТРЕННИЙ';
    const directionColor = tx.direction === 'in' ? C.incoming : tx.direction === 'out' ? C.outgoing : C.muted;
    const date = tx.ts ? new Date(tx.ts * 1000).toLocaleString('ru-RU') : 'время не указано';
    textBlock(`${index + 1}. ${date} · ${direction} · ${fmt(tx.amount, 6)} ${tx.asset}`, 8, directionColor, 0);
    textBlock(`Отправитель: ${tx.from} · ${labelText(tx.labelFrom)}`, 7, C.white, 0);
    textBlock(`Получатель: ${tx.to} · ${labelText(tx.labelTo)}`, 7, C.white, 0);
    textBlock(`Хэш: ${tx.hash} · комиссия: ${fmt(tx.fee, 8)} ${chain.chain.toUpperCase()}`, 6.5, C.muted, 0);
    y = Math.max(y, top + rowHeight + 6);
  }

  // Cover page: actual app card, not a mock/demo image.
  paintPage();
  doc.setFont(FONT_NAME, 'normal');
  doc.setFontSize(23);
  doc.setTextColor(...C.white);
  doc.text('Аналитическое досье', margin, 78);
  doc.setFontSize(9);
  doc.setTextColor(...C.muted);
  doc.text(`Сформировано: ${new Date(report.createdAt * 1000).toLocaleString('ru-RU')}`, margin, 96);
  try {
    const card = await renderCardJpeg(report);
    const cardW = Math.min(497, contentW - 18);
    const cardH = cardW * 1.25;
    const cardX = (W - cardW) / 2;
    doc.addImage(card, 'JPEG', cardX, 118, cardW, cardH, undefined, 'FAST');
    doc.setFontSize(7);
    doc.setTextColor(...C.muted);
    doc.text('Карточка сформирована из данных этого отчёта.', margin, 118 + cardH + 18);
  } catch {
    doc.setFontSize(9);
    doc.setTextColor(...C.warning);
    doc.text('Карточка не включена; остальные разделы отчёта доступны.', margin, 130);
  }

  addPage();
  section('Краткое резюме');
  textBlock(`Входной запрос: ${report.input}`, 9);
  textBlock(`Общий вердикт: ${report.verdict.score}/100 · ${levelRu(report.verdict.level)}`, 10, C.red);
  const operationCount = report.chains.reduce((n, cr) => n + cr.txs.length, 0);
  const warningCount = report.warnings.length + report.chains.filter((cr) => cr.partial).length;
  const gap = 10;
  const cardWidth = (contentW - gap) / 2;
  metricCard('Оценка Ares', `${report.verdict.score}/100`, levelRu(report.verdict.level), margin, y, cardWidth);
  metricCard('Цепочки', String(report.chains.length), 'в этом снимке отчёта', margin + cardWidth + gap, y, cardWidth);
  y += 68;
  metricCard('Записи транзакций', String(operationCount), 'все записи, возвращённые анализатором', margin, y, cardWidth);
  metricCard('Ограничения данных', String(warningCount), 'предупреждения и частичные источники', margin + cardWidth + gap, y, cardWidth);
  y += 72;

  if (report.verdict.reasons.length) {
    section('Основания вердикта');
    for (const reason of report.verdict.reasons) textBlock(`• ${reason}`, 8, C.white, 1);
  }
  if (report.warnings.length) {
    section('Предупреждения источников');
    for (const warning of report.warnings) textBlock(`• ${warning}`, 8, C.warning, 1);
  }

  for (const cr of report.chains) {
    section(`Профиль кошелька · ${cr.chain.toUpperCase()}`);
    textBlock(`Полный адрес: ${cr.account.addr}`, 8);
    textBlock(`Баланс: ${fmt(cr.account.balanceNative, 8)} ${cr.chain.toUpperCase()} · транзакций в выборке: ${cr.txs.length}`, 9);
    textBlock(`Источник(и): ${(cr.providers ?? []).join(', ') || cr.account.provider || 'не указаны'}${cr.partial || cr.account.partial ? ' · частичные данные' : ''}`, 8, cr.partial || cr.account.partial ? C.warning : C.muted);
    if (cr.kpi) {
      section('Ключевые показатели');
      textBlock(`Получено: ${fmtUsd(cr.kpi.received)} (${cr.kpi.receivedCount}) · отправлено: ${fmtUsd(cr.kpi.sent)} (${cr.kpi.sentCount}) · оборот: ${fmtUsd(cr.kpi.turnover)}`, 8);
      textBlock(`Контрагенты: ${cr.kpi.counterpartiesIn} входящих / ${cr.kpi.counterpartiesOut} исходящих · средний перевод: ${fmtUsd(cr.kpi.avgTx)} · крупнейший: ${fmtUsd(cr.kpi.maxTx)}`, 8);
      textBlock(`Активных дней: ${cr.kpi.activeDays}${cr.kpi.ageDays === null ? '' : ` · возраст: ${cr.kpi.ageDays} дней`} · доля оставшихся средств: ${fmt(cr.kpi.settledPct, 2)}%`, 8);
    }

    if (cr.account.tokens.length) {
      section(`Токены · ${cr.account.tokens.length}`);
      for (const token of cr.account.tokens) {
        const usd = token.priceUsd === undefined ? '' : ` · ${fmtUsd(token.amount * token.priceUsd)}`;
        textBlock(`${token.symbol}: ${fmt(token.amount, 8)}${usd}${token.contract ? ` · ${token.contract}` : ''}`, 7.5, C.white, 1);
      }
    } else {
      section('Токены');
      textBlock('В ответе источника токены не перечислены.', 8, C.muted);
    }

    ensureSpace(420);
    section('Граф A · прямые входящие и исходящие потоки');
    textBlock('Граф построен только по транзакциям, возвращённым этим отчётом. Направление и суммы не расширяют выборку до полной истории блокчейна.', 7.5, C.muted, 5);
    try {
      const graph = renderDirectFlowGraph(cr);
      ensureSpace(355);
      const graphW = contentW;
      const graphH = graphW * (1200 / 1800);
      doc.addImage(graph, 'JPEG', margin, y, graphW, graphH, undefined, 'FAST');
      y += graphH + 12;
    } catch (e) {
      textBlock(`Не удалось отрисовать граф: ${(e as Error).message}`, 8, C.warning);
    }

    const recipients = recipientSummaries(cr);
    if (recipients.length) {
      section(`Исходящие адреса · ${recipients.length}`);
      textBlock('Подпись берётся из метаданных отчёта. Если она отсутствует, это не подтверждает ни принадлежность сервису, ни отсутствие риска.', 7.5, C.muted);
      for (const [i, recipient] of recipients.entries()) {
        const assets = [...recipient.assets.entries()].map(([asset, amount]) => `${asset} ${fmt(amount, 8)}`).join(' · ');
        textBlock(`${i + 1}. ${recipient.addr} · ${recipient.label}`, 7.5, recipient.label === 'публичная метка не найдена' ? C.warning : C.white, 1);
        textBlock(`${recipient.hashes.size} уник. транзакций · ${assets}`, 7, C.muted, 3);
      }
    }

    if (cr.findings.length) {
      section(`Признаки и интерпретации · ${cr.findings.length}`);
      for (const finding of cr.findings) textBlock(`${finding.severity.toUpperCase()} · ${finding.title}: ${finding.detail}`, 8, finding.severity === 'red' ? C.red : C.white);
    } else {
      section('Признаки и интерпретации');
      textBlock('В возвращённой выборке дополнительных признаков не сформировано. Это не является подтверждением отсутствия риска.', 8, C.muted);
    }

    if (cr.classification) {
      section('Профиль поведения');
      textBlock(`${cr.classification.title} · уверенность: ${cr.classification.confidence}`, 9);
      textBlock(`Раздача ${cr.classification.scores.fanout} · сбор ${cr.classification.scores.fanin} · автоматизация ${cr.classification.scores.auto} · биржа/сервис ${cr.classification.scores.cexService} · транзит ${cr.classification.scores.transit} · личное использование ${cr.classification.scores.personal}`, 8);
    }

    if (cr.transit) {
      section('Транзитность');
      textBlock(`Сопоставлено пар: ${cr.transit.matched} из ${cr.transit.ofIn} · ${fmt(cr.transit.pct, 2)}% · медиана удержания ${cr.transit.medianHoldMin ?? '—'} мин · быстрее часа ${fmt(cr.transit.under60Pct, 2)}%`, 8);
      for (const pair of cr.transit.top) {
        textBlock(`${pair.delayMin} мин · ${fmt(pair.inAmount, 8)} → ${fmt(pair.outAmount, 8)} · ${pair.to}${pair.toLabel ? ` · ${pair.toLabel}` : ' · публичная метка не найдена'}`, 7.5, C.muted, 1);
      }
    }

    if (cr.aml) {
      section('AML / санкционные совпадения');
      textBlock(`Оценка: ${cr.aml.score}/100 · ${levelRu(cr.aml.level)}`, 9, C.red);
      if (!cr.aml.hits.length) textBlock('Совпадений в подключённых источниках в этой выборке нет. Это не равно полной проверке всех санкционных и риск-баз.', 8, C.muted);
      for (const hit of cr.aml.hits) {
        textBlock(`${hit.source}${hit.label ? ` · ${hit.label}` : ''} · ${hit.severity} · ${hit.hops === 0 ? 'прямой контакт' : `${hit.hops} хоп`} · доля объёма ${fmt(hit.volumeShare * 100, 2)}%${hit.ref ? ` · ${hit.ref}` : ''}`, 7.5);
      }
      for (const exit of cr.aml.exchangeExit) textBlock(`Выход в сервис: ${exit.addr} · ${exit.label}`, 7.5, C.muted, 1);
      textBlock(cr.aml.disclaimer, 7.5, C.muted);
    }

    if (cr.telegram && (cr.telegram.usernames.length || cr.telegram.numbers.length || cr.telegram.domains.length || cr.telegram.otherNft.length)) {
      section('Связи с Telegram / TON');
      for (const item of cr.telegram.usernames) textBlock(`Username ${item.username} · ${item.confidence}`, 8);
      for (const item of cr.telegram.numbers) textBlock(`Номер ${item.number} · ${item.confidence}`, 8);
      for (const item of cr.telegram.domains) textBlock(`Домен ${item.domain} · ${item.confidence}`, 8);
      for (const item of cr.telegram.otherNft) textBlock(`NFT ${item.name} · коллекция ${item.collection}`, 8);
      if (cr.telegram.note) textBlock(cr.telegram.note, 7.5, C.muted);
    }

    section(`Полный реестр · ${cr.txs.length} записей из ответа анализатора`);
    textBlock('Для каждой записи сохранены направление, сумма, обе стороны, доступные подписи и transaction hash. Дубли событийных строк не следует автоматически трактовать как отдельные независимые транзакции.', 7.5, C.muted);
    cr.txs.forEach((tx, i) => addLedgerEntry(tx, i, cr));
  }

  // Repeat the disclosure and page count on every page.
  const pages = doc.getNumberOfPages();
  for (let page = 1; page <= pages; page++) {
    doc.setPage(page);
    doc.setFont(FONT_NAME, 'normal');
    doc.setFontSize(6.5);
    doc.setTextColor(...C.muted);
    doc.text('Публичные блокчейн-данные · вероятностная интерпретация · не юридическое заключение', margin, H - 22);
    doc.text(`${page}/${pages}`, W - margin, H - 22, { align: 'right' });
  }

  return doc.output('datauristring').split(',')[1];
} 
