// Live PDF dossier: renders only data returned by WalletReport; no demo case data.
// The PDF is assembled client-side, then POSTed to /api/pdf for Telegram delivery.

import { jsPDF } from 'jspdf';
import { fmt, fmtUsd, levelRu, categoryRu, categoryRuFull, short, type ChainReport, type Tx, type WalletReport, type TraceResult, type UnmixFinding } from '../api';
import { renderCardJpeg } from '../card/card';
import { renderDirectFlowGraph } from './flowGraph';

type RGB = [number, number, number];

const C = {
  bg: [7, 7, 8] as RGB,            // глубокий чёрный (17.11, заказчик)
  panel: [16, 16, 18] as RGB,
  border: [41, 41, 47] as RGB,
  red: [212, 0, 0] as RGB,         // красный Феррари · Rosso Corsa #D40000
  white: [242, 242, 243] as RGB,
  muted: [138, 138, 144] as RGB,
  incoming: [85, 214, 190] as RGB,
  outgoing: [255, 158, 66] as RGB,
  warning: [245, 158, 11] as RGB,
};

const FONT_NAME = 'DejaVuSans';
const FONT_URL = new URL('fonts/DejaVuSans.ttf', document.baseURI).href;
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

function optionalStringField(value: unknown, key: string): string | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const field = (value as Record<string, unknown>)[key];
  return typeof field === 'string' && field.trim() ? field.trim() : undefined;
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

export async function makePdf(report: WalletReport, trace?: TraceResult | null): Promise<string> {
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

  function metricCard(label: string, value: string, note: string, x: number, top: number, width: number, valueColor: RGB = C.white): void {
    doc.setFillColor(...C.panel);
    doc.setDrawColor(...C.border);
    doc.roundedRect(x, top, width, 58, 8, 8, 'FD');
    doc.setFont(FONT_NAME, 'normal');
    doc.setFontSize(7);
    doc.setTextColor(...C.muted);
    doc.text(label.toLocaleUpperCase('ru-RU'), x + 11, top + 15);
    doc.setFontSize(15);
    doc.setTextColor(...valueColor);
    doc.text(doc.splitTextToSize(value, width - 22)[0] ?? value, x + 11, top + 35);
    doc.setFontSize(7);
    doc.setTextColor(...C.muted);
    doc.text(doc.splitTextToSize(note, width - 22)[0] ?? note, x + 11, top + 49);
  }

  // сетка KPI 4×2 (как в утверждённом образце отчёта)
  function metricGrid(tiles: { label: string; value: string; sub?: string; color?: RGB }[]): void {
    const gap = 8;
    const cw = (contentW - gap * 3) / 4;
    const ch = 58;
    tiles.forEach((t, i) => {
      const col = i % 4;
      if (col === 0 && i > 0) y += ch + gap;
      ensureSpace(ch + gap);
      metricCard(t.label, t.value, t.sub ?? '', margin + col * (cw + gap), y, cw, t.color ?? C.white);
    });
    y += ch + 10;
  }

  // горизонтальный бар (профиль поведения, exposure)
  function barRow(label: string, v: number, color: RGB = C.red, suffix = ''): void {
    ensureSpace(16);
    doc.setFont(FONT_NAME, 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...C.muted);
    doc.text(label, margin, y + 8);
    const bx = margin + 118, bw = contentW - 118 - 46;
    doc.setFillColor(23, 23, 28);
    doc.roundedRect(bx, y + 2, bw, 6, 3, 3, 'F');
    const fill = Math.max(4, bw * Math.min(100, Math.max(0, v)) / 100);
    doc.setFillColor(...color);
    doc.roundedRect(bx, y + 2, fill, 6, 3, 3, 'F');
    doc.setTextColor(...C.white);
    const numTxt = suffix === '%' ? v.toFixed(2).replace('.', ',') : String(Math.round(v));
    doc.text(`${numTxt}${suffix}`, W - margin, y + 8, { align: 'right' });
    y += 16;
  }

  // строка простой таблицы (все колонки от одной базовой линии)
  function tableRow(cols: string[], widths: number[], colors?: RGB[], size = 7.5): void {
    doc.setFont(FONT_NAME, 'normal');
    doc.setFontSize(size);
    const wrappedCols = cols.map((c, i) => doc.splitTextToSize(c, contentW * widths[i]) as string[]);
    const rowLines = Math.max(1, ...wrappedCols.map((w) => w.length));
    ensureSpace(rowLines * size * 1.35 + 3);
    const rowStartY = y;
    let x = margin;
    wrappedCols.forEach((lines, i) => {
      let ly = rowStartY;
      doc.setTextColor(...(colors?.[i] ?? C.white));
      for (const line of lines) {
        doc.text(line, x, ly + 8);
        ly += size * 1.35;
      }
      x += contentW * widths[i];
    });
    y = rowStartY + rowLines * size * 1.35 + 3;
  }

  const OKC: RGB = [0, 230, 118];
  const BADC: RGB = [255, 68, 56];
  const INFOC: RGB = [95, 176, 255];
  const sevRgb = (s: string): RGB => (s === 'red' ? BADC : s === 'yellow' ? [245, 158, 11] : s === 'blue' ? INFOC : C.muted);
  const toneRgb = (t: string): RGB => (t === 'bad' ? BADC : t === 'warn' ? [245, 158, 11] : t === 'blue' ? INFOC : t === 'ok' ? OKC : [138, 138, 144]);

  function smallRow(label: string, value: string, color: RGB = C.white): void {
    textBlock(`${label}: ${value}`, 8, color, 2);
  }

  function addLedgerEntry(tx: Tx, index: number, chain: ChainReport): void {
    const rowHeight = 78;
    ensureSpace(rowHeight);
    const top = y - 10;
    doc.setFillColor(...C.panel);
    doc.setDrawColor(...C.border);
    doc.roundedRect(margin, top, contentW, rowHeight, 7, 7, 'FD');
    y = top + 12;
    const direction = tx.direction === 'in' ? 'ВХОДЯЩИЙ' : tx.direction === 'out' ? 'ИСХОДЯЩИЙ' : 'ВНУТРЕННИЙ';
    const directionColor = tx.direction === 'in' ? C.incoming : tx.direction === 'out' ? C.outgoing : C.muted;
    const date = tx.ts ? new Date(tx.ts * 1000).toLocaleString('ru-RU') : 'время не указано';
    textBlock(`${index + 1}. ${date} · ${direction} · ${fmt(tx.amount, 6)} ${tx.asset}`, 8, directionColor, 0);
    textBlock(`Отправитель: ${tx.from} · ${labelText(tx.labelFrom)}`, 7, C.white, 0);
    textBlock(`Получатель: ${tx.to} · ${labelText(tx.labelTo)}`, 7, C.white, 0);
    textBlock(`Хэш: ${tx.hash} · комиссия: ${fmt(tx.fee, 8)} ${chain.chain.toUpperCase()}`, 6.5, C.muted, 0);
    y = Math.max(y, top + rowHeight + 5);
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
      const k = cr.kpi;
      section('Ключевые показатели');
      metricGrid([
        { label: 'ПОЛУЧЕНО', value: fmtUsd(k.received), sub: `${k.receivedCount} операций`, color: OKC },
        { label: 'ОТПРАВЛЕНО', value: fmtUsd(k.sent), sub: `${k.sentCount} операций`, color: BADC },
        { label: 'ОСЕЛО НА АДРЕСЕ', value: `${fmt(k.settledPct, 2)}%`, sub: 'от всего входящего' },
        { label: 'КОНТРАГЕНТОВ', value: String(k.counterpartiesIn + k.counterpartiesOut), sub: `${k.counterpartiesIn} отпр. / ${k.counterpartiesOut} получ.` },
        { label: 'ОБОРОТ', value: fmtUsd(k.turnover), sub: 'сумма всех движений' },
        { label: 'СРЕДНИЙ ПЕРЕВОД', value: fmtUsd(k.avgTx), sub: `медиана ${fmtUsd(k.medianTx)}` },
        { label: 'КРУПНЕЙШИЙ', value: fmtUsd(k.maxTx), sub: 'в выборке', color: INFOC },
        { label: 'АКТИВНЫХ ДНЕЙ', value: String(k.activeDays), sub: k.ageDays === null ? 'в выборке' : `возраст ${k.ageDays} дн.` },
      ]);
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
      for (const finding of cr.findings) {
        ensureSpace(64);
        textBlock(`${finding.severity.toUpperCase()} · ${finding.title}`, 8.5, sevRgb(finding.severity), 1);
        textBlock(finding.detail, 7.5, C.muted, 1);
        for (const a of (finding.addresses ?? []).slice(0, 3)) {
          textBlock(`     · ${a.addr}${a.label ? ` · ${a.label}` : ''}${a.amounts ? ` — ${a.amounts}` : ''}`, 7.5, C.white, 1);
        }
        y += 4;
      }
    } else {
      section('Признаки и интерпретации');
      textBlock('В возвращённой выборке дополнительных признаков не сформировано. Это не является подтверждением отсутствия риска.', 8, C.muted);
    }

    if (cr.classification) {
      section('Профиль поведения');
      textBlock(`${cr.classification.title} · уверенность: ${cr.classification.confidence}`, 9);
      const s = cr.classification.scores as Record<string, number>;
      barRow('Раздача (fan-out)', s.fanout ?? 0);
      barRow('Автомат (скрипт)', s.auto ?? 0);
      barRow('Биржа/сервис', s.cexService ?? 0, INFOC);
      barRow('Транзит', s.transit ?? 0, [245, 158, 11]);
      barRow('Личный', s.personal ?? 0, C.muted);
    }

    if (cr.transit && cr.transit.matched > 0) {
      section('Транзитность · вход сразу уходит дальше');
      textBlock(`Сопоставлено пар: ${cr.transit.matched} из ${cr.transit.ofIn} · ${fmt(cr.transit.pct, 2)}% · медиана удержания ${cr.transit.medianHoldMin ?? '—'} мин · быстрее часа ${fmt(cr.transit.under60Pct, 2)}%`, 8);
      y += 4;
      const widths = [0.16, 0.22, 0.22, 0.4];
      tableRow(['ЗАДЕРЖКА', 'ПРИШЛО', 'УШЛО', 'КОМУ'], widths, [C.muted, C.muted, C.muted, C.muted], 7);
      for (const pair of cr.transit.top.slice(0, 8)) {
        tableRow(
          [`${pair.delayMin} мин`, fmt(pair.inAmount, 4), fmt(pair.outAmount, 4), short(pair.to, 10, 8) + (pair.toLabel ? ` · ${pair.toLabel}` : '')],
          widths,
          [INFOC, C.white, C.white, C.muted],
        );
      }
    }

    if (cr.aml) {
      section('AML · происхождение средств (exposure)');
      textBlock(`Оценка: ${cr.aml.score}/100 · ${levelRu(cr.aml.level)} · доля входящего объёма по типам источников (публичные метки контрагентов, вероятностно)`, 8, C.white, 3);
      if ((cr.aml.exposure ?? []).length) {
        for (const e of cr.aml.exposure) barRow(e.ru, e.pct, toneRgb(e.tone), '%');
        y += 6;
      } else {
        textBlock('Разбивка exposure недоступна: нет размеченных контрагентов в выборке.', 8, C.muted, 3);
      }
      if ((cr.aml.topOut ?? []).length) {
        section('Куда ушло · крупнейшие исходящие');
        const widths = [0.3, 0.18, 0.14, 0.38];
        tableRow(['АДРЕС', 'СУММА', 'ДОЛЯ', 'ТИП ПОЛУЧАТЕЛЯ'], widths, [C.muted, C.muted, C.muted, C.muted], 7);
        for (const o of cr.aml.topOut) {
          const sum = o.usd !== undefined ? fmtUsd(o.usd) : `${fmt(o.amount, 4)} ${o.asset}`;
          tableRow(
            [short(o.addr, 12, 10) + (o.label ? ` · ${o.label}` : ''), sum, `${Math.round(o.share * 100)}%`, categoryRu(o.category)],
            widths,
            [C.white, C.white, INFOC, C.muted],
          );
        }
        y += 4;
      }
      section('AML / санкционные совпадения');
      if (!cr.aml.hits.length) textBlock('Совпадений в подключённых источниках в этой выборке нет. Это не равно полной проверке всех санкционных и риск-баз.', 8, C.muted);
      for (const hit of cr.aml.hits) {
        const label = optionalStringField(hit, 'label');
        textBlock(`${hit.source}${label ? ` · ${label}` : ''} · ${hit.severity} · ${hit.hops === 0 ? 'прямой контакт' : `${hit.hops} хоп`} · доля объёма ${fmt(hit.volumeShare * 100, 2)}%${hit.ref ? ` · ${hit.ref}` : ''}`, 7.5);
      }
      for (const exit of cr.aml.exchangeExit) textBlock(`Выход в сервис (KYC-деанонимизация): ${exit.addr} · ${exit.label}`, 7.5, C.muted, 1);
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

  }

  // ---------- МЕТОДОЛОГИЯ / ГЛОССАРИЙ · лист «публичные блокчейн-данные» ----------
  // Заказчик 17.11: методология и источники должны читаться ПЕРЕД списком
  // всех транзакций, а не после него.
  addPage();
  section('Методология и источники данных');
  textBlock('Данные собираются в реальном времени из публичных источников и не хранят персональных данных пользователей:', 8, C.white, 2);
  const sources = [
    'RPC-узлы TRON / Ethereum / TON / Bitcoin / Solana — балансы и история транзакций адреса;',
    'публичные реестры меток: биржи, платёжные сервисы, миксеры, мосты, контракты;',
    'санкционный список OFAC SDN (США) и санкционные реестры — прямое и непрямое совпадение;',
    'база скам/фишинг-адресов ScamSniffer и собственная база жалоб с модерацией;',
    'ончейн-проверка freeze-листов эмитентов стейблкоинов (USDT Tether, USDC Circle, isBlackListed);',
    'GoPlus Security — флаги EVM-адресов (фишинг, ханипот, взломы);',
    'индекс депозитов миксеров (Tornado Cash и др.) для unmix-матчинга;',
    'TON DNS и NFT-связи для OSINT-привязки адресов к Telegram-аккаунтам;',
    'курсы активов CoinGecko для пересчёта объёмов в USD.',
  ];
  for (const s of sources) textBlock(`• ${s}`, 7.5, C.white, 1);
  y += 3;
  textBlock('AML-скоринг: каждый источник «грязи» оценивается как base × доля входящего объёма × затухание по времени контакта (base: прямой контакт 100, 1 хоп 70, 2 хопа 45, 3 хопа 20; затухание 0,5^лет). Итоговая оценка объединяет источники вероятностно: 100 × (1 − Π(1 − score/100)). Уровни: 0–20 чистый, 21–40 низкий, 41–60 средний, 61–80 высокий, 81–100 критический.', 7.5, C.muted, 3);
  textBlock('Ограничения честно: анализируется выборка последних транзакций (не вся история адреса); граф может быть недостроен по бюджету запросов; метки контрагентов вероятностные; отсутствие совпадений не равно гарантии чистоты (закрытые базы и приватные данные не видны). Досье — вероятностная интерпретация публичных данных блокчейна, не юридическое заключение и не финансовый совет.', 7.5, C.warning, 3);

  section('Глоссарий');
  const glossary: [string, string][] = [
    ['Хоп', 'расстояние в графе переводов: 1 хоп — прямой контрагент, 2 хопа — контрагент контрагента.'],
    ['Exposure', 'происхождение входящих средств: распределение входящего объёма по типам источников (биржи, миксеры, санкционные и т.д.).'],
    ['Миксер', 'сервис, смешивающий чужие переводы, чтобы разорвать связь отправитель→получатель (Tornado Cash и др.).'],
    ['Unmix', 'статистический подбор: какой вывод из миксера, вероятно, соответствует какому депозиту (вероятность 1/n).'],
    ['Транзитность', 'доля входящих средств, ушедших дальше сразу или почти сразу (кошелёк-«проводник»).'],
    ['Fan-out', 'раздача: сколько разных получателей получило деньги от адреса (признак раздачи/выплаты).'],
    ['Dust', 'пыль — входы на копейки, шум для скоринга, учитываются отдельно.'],
    ['Вероятностная метка', 'тип адреса угадан по структуре потоков (помечен «?»), а не взят из публичного реестра.'],
    ['Freeze-лист', 'список замороженных адресов внутри контракта стейблкоина: такие адреса не могут перевести свои USDT/USDC.'],
  ];
  for (const [term, def] of glossary) textBlock(`${term} — ${def}`, 7.5, C.white, 1);

  // ---------- ПОЛНЫЙ РЕЕСТР · публичные блокчейн-данные ----------
  // Список всех транзакций идёт ПОСЛЕ методологии и глоссария (заказчик 17.11).
  for (const cr of report.chains) {
    addPage();
    section(`Полный реестр · публичные блокчейн-данные · ${cr.txs.length} записей`);
    textBlock('Список всех транзакций, возвращённых анализатором: направление, сумма, обе стороны, доступные подписи и transaction hash. Дубли событийных строк не следует автоматически трактовать как отдельные независимые транзакции.', 7.5, C.muted);
    cr.txs.forEach((tx, i) => addLedgerEntry(tx, i, cr));
  }

  // ---------- РАССЛЕДОВАНИЕ (граф потоков, unmix, куда уходят деньги) ----------
  // Раздел включается, когда в Mini App уже прогоняли расследование по этому адресу.
  if (trace) {
    addPage();
    section('Расследование · граф потоков');
    const tNodes = trace.nodes ?? [];
    const tEdges = trace.edges ?? [];
    const turnover = tEdges.reduce((s, e) => s + e.amount, 0);
    textBlock(`Сеть: ${trace.chain.toUpperCase()} · глубина: ${trace.depth} хоп(а) · узлов в графе: ${tNodes.length} · связей: ${tEdges.length} · оборот в выборке: ${fmt(turnover, 0)} ${tEdges[0]?.asset ?? ''} · запросов к источникам: ${trace.fetchesUsed}/30${trace.truncated ? ' · ГРАФ НЕДОСТРОЕН (бюджет запросов free-тарифов)' : ''}`, 8, C.white, 3);

    const dangerCats = new Set(['mixer', 'scam', 'sanctioned']);
    const dangerLeaks = (trace.leaks ?? []).filter((l) => dangerCats.has(l.category ?? ''));
    const dangerShare = dangerLeaks.reduce((s, l) => s + l.share, 0);
    if (dangerShare > 0.02) {
      textBlock(`Вердикт расследования: ВЫСОКИЙ РИСК — ~${Math.round(dangerShare * 100)}% исходящих переводов цели уходит в рисковые точки (${[...new Set(dangerLeaks.map((l) => categoryRuFull(l.category, l.probable)))].join(', ')}).`, 9, BADC, 3);
    } else if (dangerLeaks.length || tNodes.some((n) => !n.isRoot && dangerCats.has(n.category ?? ''))) {
      textBlock('Вердикт расследования: рисковые узлы присутствуют в окружении цели, но прямые исходящие переводы идут на нейтральные адреса.', 9, C.warning, 3);
    } else {
      textBlock('Вердикт расследования: рисковых конечных точек не найдено — прямые исходящие идут на нейтральные адреса. Не гарантия чистоты: см. AML-раздел.', 9, OKC, 3);
    }
    if (trace.findings?.length) for (const f of trace.findings) textBlock(`• ${f}`, 7.5, C.muted, 1);

    if ((trace.leaks ?? []).length) {
      section('Куда уходят деньги · итог расследования');
      textBlock('Крупнейшие направления исходящих переводов целевого кошелька с типом контрагента и долей от исходящего объёма.', 7.5, C.muted, 4);
      const widthsL = [0.05, 0.36, 0.2, 0.22, 0.17];
      tableRow(['№', 'АДРЕС', 'ТИП ПОЛУЧАТЕЛЯ', 'СУММА', 'ДОЛЯ'], widthsL, [C.muted, C.muted, C.muted, C.muted, C.muted], 7);
      for (const [i, l] of (trace.leaks ?? []).slice(0, 10).entries()) {
        const danger = dangerCats.has(l.category ?? '');
        tableRow(
          [String(i + 1), short(l.addr, 12, 10) + (l.label ? ` · ${l.label}` : ''), categoryRuFull(l.category, l.probable), `${fmt(l.amount, 2)} ${l.asset}`, `${Math.round(l.share * 100)}%`],
          widthsL,
          [C.muted, danger ? BADC : C.white, danger ? BADC : C.muted, C.white, danger ? BADC : INFOC],
        );
      }
      y += 4;
    }

    const unmixList = (trace.unmix ?? []) as UnmixFinding[];
    if (unmixList.length) {
      section('Распутывание миксеров · unmix-матчинг');
      textBlock('Статистическое сопоставление депозитов и выводов через миксер: вероятность пары = 1/n совпадающих выводов в временном окне. Оценка вероятностная, не доказательство.', 7.5, C.muted, 4);
      for (const u of unmixList) {
        textBlock(`🌀 ${u.mixerLabel ?? 'Миксер'} · ${short(u.mixer, 8, 6)}`, 8.5, BADC, 1);
        if (u.note) textBlock(u.note, 7, C.muted, 2);
        const widthsU = [0.34, 0.34, 0.17, 0.15];
        tableRow(['ДЕПОЗИТ', 'ВЫВОД', 'СУММА', 'СВЯЗЬ'], widthsU, [C.muted, C.muted, C.muted, C.muted], 7);
        for (const l of u.links.slice(0, 6)) {
          tableRow([short(l.from, 10, 8), short(l.to, 10, 8), fmt(l.amount, 2), `~${Math.round(l.p * 100)}%`], widthsU, [C.white, C.white, C.white, C.warning]);
        }
        y += 4;
      }
    }
  }

  // ---------- РЕКОМЕНДАЦИИ ----------
  const amlMax = Math.max(0, ...report.chains.map((c) => c.aml?.score ?? 0));
  const effLevel = amlMax > report.verdict.score ? (amlMax > 80 ? 'critical' : amlMax > 60 ? 'high' : amlMax > 40 ? 'medium' : 'low') : report.verdict.level;
  const recs: Record<string, string[]> = {
    clean: ['Признаков риска не обнаружено. Рутинные меры предосторожности:', '• не отправляй крупную сумму одним переводом — сделай тестовый;', '• перепроверь адрес перед отправкой (скам-подмена буфера обмена);', '• повтори проверку перед крупной сделкой — данные меняются.'],
    low: ['Риск низкий. Рекомендуется:', '• стандартные меры: тестовый перевод, проверка адреса, повторная проверка перед крупной суммой;', '• при новых переводах следи за изменением профиля (мониторинг в боте).'],
    medium: ['Умеренный риск. Рекомендуется:', '• при суммах выше ~$1 000 запроси у контрагента источник средств (другой биржевой кошелёк, документ);', '• предпочтителен тестовый перевод и частичная оплата;', '• избегай прямых платежей без подтверждения личности контрагента.'],
    high: ['Высокий риск. Рекомендуется:', '• воздержаться от перевода, пока контрагент не подтвердит происхождение средств;', '• запросить KYC/видеоподтверждение, проверку через регулируемый сервис;', '• рассмотреть альтернативного контрагента; при обязательности сделки — разбить платежи с проверкой после каждого.'],
    critical: ['Критический риск. Рекомендуется:', '• НЕ совершать перевод: прямые связи со санкционной/скам-инфраструктурой или freeze-листом;', '• зафиксируй доказательства (это досье, хэши транзакций) до любых действий;', '• при получении средств от такого адреса — не переводи дальше: freeze может коснуться и тебя;', '• эскалация: комплаенс/безопасность платформы, правоохранительные органы.'],
  };
  textBlock(`Итоговая оценка: ${report.verdict.score}/100 (${levelRu(report.verdict.level)})${amlMax > report.verdict.score ? ` · с учётом AML: ${Math.round(amlMax)}/100 (${levelRu(effLevel)})` : ''}`, 9, effLevel === 'critical' || effLevel === 'high' ? BADC : effLevel === 'medium' ? C.warning : OKC, 3);
  for (const r of recs[effLevel] ?? recs.low) textBlock(r, 7.5, C.white, 1);

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
