// Профессиональное AML/KYT-досье (заказчик: «как в платных ботах»).
// Отдельный документ — не общий PDF отчёта: только скоринг загрязнения,
// происхождение средств, источники, рекомендации. Собирается клиент-side
// (jsPDF + DejaVuSans) и POST-ится на /api/pdf → бот отправляет документом в чат.
// Палитра (17.11, заказчик): глубокий чёрный + красный Феррари (Rosso Corsa).
// Вёрстка v2: весь поток через переменную y (проверенный паттерн makePdf) —
// фиксированные doc.text на обложке давали наезд строк.

import { jsPDF } from 'jspdf';
import { fmt, fmtUsd, levelRu, categoryRu, short, type WalletReport, type AmlHit } from '../api';

type RGB = [number, number, number];

const C = {
  bg: [7, 7, 8] as RGB,          // глубокий чёрный (17.11)
  panel: [16, 16, 18] as RGB,
  border: [41, 41, 47] as RGB,
  ferrari: [212, 0, 0] as RGB,   // Rosso Corsa #D40000 — брендовый акцент
  red: [212, 0, 0] as RGB,
  white: [242, 242, 243] as RGB,
  muted: [138, 138, 144] as RGB,
  warning: [245, 158, 11] as RGB,
  ok: [0, 230, 118] as RGB,
  bad: [255, 68, 56] as RGB,
  info: [95, 176, 255] as RGB,
  orange: [249, 115, 22] as RGB,
};

const FONT_NAME = 'DejaVuSans';
const FONT_URL = new URL('fonts/DejaVuSans.ttf', document.baseURI).href;
let fontBase64: string | null = null;

async function loadFont(doc: jsPDF): Promise<void> {
  if (!fontBase64) {
    const res = await fetch(FONT_URL);
    if (!res.ok) throw new Error('Не удалось загрузить кириллический шрифт отчёта');
    const buf = await res.arrayBuffer();
    const bytes = new Uint8Array(buf);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    fontBase64 = btoa(bin);
  }
  doc.addFileToVFS(`${FONT_NAME}.ttf`, fontBase64);
  doc.addFont(`${FONT_NAME}.ttf`, FONT_NAME, 'normal');
  doc.setFont(FONT_NAME, 'normal');
}

function sevColor(s: string): RGB {
  return s === 'critical' || s === 'red' ? C.bad : s === 'yellow' || s === 'medium' ? C.warning : s === 'blue' ? C.info : C.muted;
}

function hitPath(h: AmlHit): string {
  return h.path?.length ? h.path.map((p) => short(p, 8, 6)).join(' → ') : '';
}

export async function makeAmlPdf(report: WalletReport): Promise<string> {
  const cr = report.chains[0];
  const aml = cr?.aml;
  if (!cr || !aml) throw new Error('AML-оценка недоступна для этого адреса');

  const doc = new jsPDF({ unit: 'pt', format: 'a4', compress: true });
  await loadFont(doc);
  doc.setProperties({
    title: 'Ares Crypto — AML/KYT досье',
    subject: `AML-скоринг ${cr.account.addr}`,
    author: 'Ares Crypto-Analytics',
    creator: 'Ares Crypto Mini App',
  });

  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const margin = 40;
  const contentW = W - margin * 2;
  let y = 78;

  const levelColor: RGB = aml.level === 'critical' || aml.level === 'high' ? C.bad : aml.level === 'medium' ? C.warning : aml.level === 'low' ? C.info : C.ok;

  // Шапка/фон каждой страницы. Акценты — Феррари; вердикт остаётся семантическим.
  function paintPage(): void {
    doc.setFillColor(...C.bg);
    doc.rect(0, 0, W, H, 'F');
    doc.setFillColor(...C.ferrari);
    doc.rect(0, 0, W, 7, 'F');
    doc.setFont(FONT_NAME, 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...C.ferrari);
    doc.text('ARES CRYPTO · AML/KYT ДОСЬЕ', margin, 30);
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
    doc.setFillColor(...C.ferrari);
    doc.roundedRect(margin, y - 12, 3, 17, 1.5, 1.5, 'F');
    doc.setFont(FONT_NAME, 'normal');
    doc.setFontSize(11);
    doc.setTextColor(...C.ferrari);
    doc.text(title.toLocaleUpperCase('ru-RU'), margin + 12, y);
    y += 18;
  }

  // Риск-шкала 0–100 с зонами и маркером текущей оценки; продолжает поток y.
  function riskScale(score: number): void {
    const sx = margin, sw = contentW, sh = 10;
    const zones: [number, number, RGB][] = [
      [0, 20, [0, 170, 90]], [20, 40, [120, 190, 60]], [40, 60, C.warning], [60, 80, C.orange], [80, 100, C.bad],
    ];
    y += 8;
    for (const [a, b, col] of zones) {
      doc.setFillColor(...col);
      doc.rect(sx + (sw * a) / 100, y, (sw * (b - a)) / 100, sh, 'F');
    }
    const mx = sx + (sw * Math.max(0, Math.min(100, score))) / 100;
    doc.setFillColor(...C.white);
    doc.rect(mx - 1.5, y - 4, 3, sh + 8, 'F');
    doc.setFontSize(7);
    doc.setTextColor(...C.muted);
    doc.text('0', sx, y + sh + 12);
    doc.text('20', sx + sw * 0.2, y + sh + 12, { align: 'center' });
    doc.text('40', sx + sw * 0.4, y + sh + 12, { align: 'center' });
    doc.text('60', sx + sw * 0.6, y + sh + 12, { align: 'center' });
    doc.text('80', sx + sw * 0.8, y + sh + 12, { align: 'center' });
    doc.text('100', sx + sw, y + sh + 12, { align: 'right' });
    doc.text('чистый', sx + sw * 0.1, y - 4, { align: 'center' });
    doc.text('критический', sx + sw * 0.9, y - 4, { align: 'center' });
    y += sh + 22;
  }

  function barRow(label: string, v: number, color: RGB, suffix = '%'): void {
    ensureSpace(17);
    doc.setFont(FONT_NAME, 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...C.muted);
    doc.text(label.slice(0, 30), margin, y + 8);
    const bx = margin + 128, bw = contentW - 128 - 46;
    doc.setFillColor(23, 23, 28);
    doc.roundedRect(bx, y + 2, bw, 6, 3, 3, 'F');
    const fill = Math.max(3, bw * Math.min(100, Math.max(0, v)) / 100);
    doc.setFillColor(...color);
    doc.roundedRect(bx, y + 2, fill, 6, 3, 3, 'F');
    doc.setTextColor(...C.white);
    doc.text(`${v.toFixed(v < 10 ? 2 : 0).replace('.', ',')}${suffix}`, W - margin, y + 8, { align: 'right' });
    y += 17;
  }

  function tableRow(cols: string[], widths: number[], colors?: RGB[], size = 7.5): void {
    doc.setFont(FONT_NAME, 'normal');
    doc.setFontSize(size);
    const wrappedCols = cols.map((c, i) => doc.splitTextToSize(c, contentW * widths[i]) as string[]);
    const rowLines = Math.max(1, ...wrappedCols.map((w) => w.length));
    ensureSpace(rowLines * size * 1.35 + 4);
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
    y = rowStartY + rowLines * size * 1.35 + 4;
  }

  // ---------- ОБЛОЖКА (весь поток через y — без фиксированных наездов) ----------
  paintPage();
  doc.setFontSize(21);
  doc.setTextColor(...C.white);
  doc.text('AML / KYT досье', margin, y);
  y += 20;
  doc.setFontSize(9);
  doc.setTextColor(...C.muted);
  doc.text(`Сформировано: ${new Date(report.createdAt * 1000).toLocaleString('ru-RU')}`, margin, y);
  y += 16;
  doc.setFontSize(13);
  doc.setTextColor(...levelColor);
  doc.text(`Оценка риска: ${aml.score}/100 — ${levelRu(aml.level).toUpperCase()}`, margin, y);
  riskScale(aml.score);
  textBlock(`Адрес: ${cr.account.addr}`, 10, C.white, 2);
  textBlock(`Сеть: ${cr.chain.toUpperCase()} · входной запрос: ${report.input}`, 8.5, C.muted, 2);
  textBlock(`Статус в выборке: транзакций ${cr.txs.length}${cr.partial ? ' · ЧАСТИЧНЫЕ ДАННЫЕ ИСТОЧНИКА' : ''}`, 8.5, cr.partial ? C.warning : C.muted, 4);

  // ---------- РЕЗЮМЕ ----------
  section('Резюме для принятия решения');
  const k = cr.kpi;
  const dirtyCnt = aml.hits.length;
  const directCnt = aml.hits.filter((h) => h.hops === 0).length;
  const frozen = aml.hits.some((h) => /freeze/.test(h.source));
  const topExp = aml.exposure[0];
  const summaryLines = [
    `Кошелёк обработал входящих ${k ? fmtUsd(k.received) : '—'} от ${k ? k.counterpartiesIn : '—'} адресов, исходящих ${k ? fmtUsd(k.sent) : '—'} к ${k ? k.counterpartiesOut : '—'} получателям.`,
    `Совпадений с источниками загрязнения: ${dirtyCnt}${dirtyCnt && directCnt ? `, из них ПРЯМЫХ контактов: ${directCnt}` : ''}.`,
  ];
  if (topExp) summaryLines.push(`Основная категория происхождения средств: ${topExp.ru} — ${topExp.pct.toString().replace('.', ',')}% входящего объёма.`);
  if (frozen) summaryLines.push('⚠️ ОБНАРУЖЕН FREEZE-СТАТУС: адрес или его контрагент заблокирован эмитентом стейблкоина — переводы с таких адресов эмитент может заморозить.');
  if (aml.exchangeExit.length) summaryLines.push(`Выход на сервисы с KYC: ${aml.exchangeExit.length} — при выводе на биржу возможна деанонимизация владельца.`);
  for (const l of summaryLines) textBlock(l, 8.5, C.white, 2);
  y += 3;
  const verdictLine = aml.level === 'critical' || aml.level === 'high'
    ? 'Вывод: операции с этим адресом сопряжены с повышенным риском по подключённым источникам. Рекомендации — в соответствующем разделе ниже.'
    : aml.level === 'medium'
      ? 'Вывод: умеренный риск. При крупных суммах запросите подтверждение происхождения средств.'
      : 'Вывод: признаков загрязнения по подключённым источникам не обнаружено. Это не гарантия: закрытые базы и приватные данные недоступны.';
  textBlock(verdictLine, 8.5, levelColor, 3);

  // ---------- СТРАНИЦА 2 · EXPOSURE + ИСТОЧНИКИ ----------
  addPage();
  section('Происхождение средств · exposure');
  if (aml.exposure.length) {
    textBlock('Распределение входящего объёма по типам источников (вероятностно, по публичным меткам контрагентов):', 7.5, C.muted, 4);
    for (const e of aml.exposure) {
      const col: RGB = e.tone === 'bad' ? C.bad : e.tone === 'warn' ? C.warning : e.tone === 'blue' ? C.info : C.muted;
      barRow(e.ru, e.pct, col);
    }
  } else {
    textBlock('Разбивка exposure недоступна: в выборке нет размеченных контрагентов.', 8, C.muted, 2);
  }

  // ---------- ИСТОЧНИКИ ЗАГРЯЗНЕНИЯ ----------
  section(`Источники загрязнения · ${aml.hits.length}`);
  if (!aml.hits.length) {
    textBlock('Совпадений в подключённых источниках (OFAC SDN, скам-базы, freeze-листы эмитентов, GoPlus, индекс миксеров) в этой выборке НЕТ. Это не равно полной проверке всех санкционных и риск-баз.', 8, C.muted, 2);
  } else {
    textBlock('Совпадения с базами «грязи». Путь показывает цепочку до цели: чем меньше хопов — тем надёжнее сигнал.', 7.5, C.muted, 3);
    const widths = [0.22, 0.1, 0.09, 0.12, 0.13, 0.34];
    tableRow(['ИСТОЧНИК', 'СТАТУС', 'ХОПЫ', 'ДОЛЯ ОБЪЁМА', 'ВКЛАД', 'ПУТЬ / ПОЯСНЕНИЕ'], widths, [C.muted, C.muted, C.muted, C.muted, C.muted, C.muted], 7);
    for (const h of aml.hits.slice(0, 20)) {
      tableRow(
        [h.source, h.severity, h.hops === 0 ? 'прямой' : `${h.hops} хоп`, `${Math.round(h.volumeShare * 100)}%`, `${Math.round(h.score)}/100`, [hitPath(h), h.ref].filter(Boolean).join(' · ') || '—'],
        widths,
        [sevColor(h.severity), sevColor(h.severity), C.white, C.white, C.warning, C.muted],
      );
    }
    y += 4;
  }

  // ---------- СТРАНИЦА 3 · КУДА УХОДЯТ + KYC + ПРОФИЛЬ ----------
  addPage();
  if (aml.topOut.length) {
    section('Куда уходят средства · крупнейшие исходящие');
    const widths = [0.32, 0.16, 0.12, 0.4];
    tableRow(['АДРЕС', 'СУММА', 'ДОЛЯ', 'ТИП ПОЛУЧАТЕЛЯ'], widths, [C.muted, C.muted, C.muted, C.muted], 7);
    for (const o of aml.topOut) {
      const sum = o.usd !== undefined ? fmtUsd(o.usd) : `${fmt(o.amount, 4)} ${o.asset}`;
      tableRow(
        [short(o.addr, 12, 10) + (o.label ? ` · ${o.label}` : ''), sum, `${Math.round(o.share * 100)}%`, categoryRu(o.category)],
        widths,
        [C.white, C.white, C.info, C.muted],
      );
    }
    y += 4;
  }
  if (aml.exchangeExit.length) {
    section('Выход на сервисы с KYC');
    for (const e of aml.exchangeExit) textBlock(`${e.addr} · ${e.label}`, 7.5, C.info, 1);
    textBlock('Вывод на биржу/сервис с KYC означает: владелец может быть деанонимизирован через данные сервиса (при комплаенс-запросе или расследовании).', 7.5, C.muted, 3);
  }

  // ---------- ПРОФИЛЬ ----------
  if (k) {
    section('Профиль кошелька');
    const lines = [
      `Получено: ${fmtUsd(k.received)} (${k.receivedCount} оп.) · отправлено: ${fmtUsd(k.sent)} (${k.sentCount} оп.)`,
      `Осело на адресе: ${fmt(k.settledPct, 2)}% входящего · оборот: ${fmtUsd(k.turnover)}`,
      `Средний перевод: ${fmtUsd(k.avgTx)} · медиана: ${fmtUsd(k.medianTx)} · крупнейший: ${fmtUsd(k.maxTx)}`,
      `Активных дней: ${k.activeDays}${k.ageDays !== null ? ` · возраст адреса: ${k.ageDays} дн.` : ''}`,
      `Баланс: ${fmt(cr.account.balanceNative, 6)} ${cr.chain.toUpperCase()}${cr.account.tokens.length ? ` · токенов: ${cr.account.tokens.length}` : ''}`,
    ];
    for (const l of lines) textBlock(l, 8, C.white, 2);
    y += 2;
  }

  // ---------- СТРАНИЦА 4 · МЕТОДОЛОГИЯ + РЕКОМЕНДАЦИИ ----------
  addPage();
  section('Методология и ограничения');
  textBlock('Каждый источник «грязи» оценивается: base × доля входящего объёма × затухание по времени контакта. Base: прямой контакт 100, 1 хоп 70, 2 хопа 45, 3 хопа 20. Затухание 0,5^лет. Итог объединяет источники вероятностно: 100 × (1 − Π(1 − score/100)).', 7.5, C.white, 3);
  textBlock('Источники: санкционный список OFAC SDN; скам/фишинг-базы (ScamSniffer, модерация жалоб); freeze-листы эмитентов USDT/USDC (ончейн isBlackListed); GoPlus Security (EVM); индекс депозитов миксеров; публичные реестры меток бирж и сервисов; курсы CoinGecko.', 7.5, C.muted, 3);
  textBlock('Ограничения: анализируется выборка последних транзакций, не вся история; exposure — вероятностное разнесение по меткам; отсутствие совпадений не является гарантией чистоты. Документ — вероятностная интерпретация публичных данных, не юридическое заключение и не финансовый совет.', 7.5, C.warning, 3);

  // ---------- РЕКОМЕНДАЦИИ ----------
  section('Рекомендации');
  const recs: Record<string, string[]> = {
    clean: ['Рутинные меры: тестовый перевод; повторная проверка перед крупной суммой; мониторинг профиля при новых переводах.'],
    low: ['Риск низкий: стандартные меры (тестовый перевод, повторная проверка). При росте объёмов — повторить AML-проверку.'],
    medium: ['Запросить источник средств при суммах выше ~$1 000; тестовый перевод и частичная оплата; избегать платежей без подтверждения контрагента.'],
    high: ['Воздержаться от перевода до подтверждения происхождения средств; запросить KYC; рассмотреть альтернативного контрагента; при обязательности — разбить платежи с проверкой после каждого.'],
    critical: ['НЕ совершать перевод. Зафиксировать доказательства (досье, хэши). Средства от такого адреса могут быть заморожены эмитентом. Эскалация: комплаенс/безопасность платформы, правоохранительные органы.'],
  };
  for (const r of recs[aml.level] ?? recs.low) textBlock(r, 7.5, C.white, 1);

  // ---------- ФУТЕР НА ВСЕХ СТРАНИЦАХ ----------
  const pages = doc.getNumberOfPages();
  for (let page = 1; page <= pages; page++) {
    doc.setPage(page);
    doc.setFont(FONT_NAME, 'normal');
    doc.setFontSize(6.5);
    doc.setTextColor(...C.muted);
    doc.text('AML/KYT-скоринг по публичным данным · вероятностная оценка · не заменяет регулируемый комплаенс', margin, H - 22);
    doc.text(`${page}/${pages}`, W - margin, H - 22, { align: 'right' });
  }

  return doc.output('datauristring').split(',')[1];
}
