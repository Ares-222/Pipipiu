// PDF v3 «Финальный формат»: стр.1 — карточка №4 (визуал), стр.2 — детализация,
// стр.3 — AML·происхождение средств (формат Quppy в нашем стиле) + уровни риска.
// Чёрный фон, красный акцент. Демо-данные: scripts/design-data.ts.
// Run: node scripts/design-pdf3.ts

import { jsPDF } from 'jspdf';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEMO } from './design-data.ts';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const FONT = path.join(ROOT, 'miniapp', 'public', 'fonts', 'DejaVuSans.ttf');
const CARD = path.join(path.dirname(ROOT), 'download', 'ares-design-V4-card.jpg');
const OUT = path.join(path.dirname(ROOT), 'download', 'ares-report-final.pdf');

const BG = [10, 10, 11], PANEL = [14, 14, 16], BORDER = [30, 30, 36];
const TXT = [245, 245, 247], MUT = [158, 160, 172], DIM = [85, 85, 92];
const RED = [232, 0, 28], REDH = [255, 59, 46], AMB = [255, 210, 74], BLU = [95, 176, 255], GRN = [0, 230, 118], BAD = [255, 68, 56], GRAY = [106, 111, 133];

function toneCol(t: string): number[] {
  if (t === 'bad') return BAD;
  if (t === 'blue') return BLU;
  if (t === 'ok') return GRN;
  if (t === 'info') return BLU;
  if (t === 'gray') return GRAY;
  return MUT;
}
function kpiCol(t?: string): number[] {
  if (t === 'ok') return GRN;
  if (t === 'bad') return BAD;
  if (t === 'info') return BLU;
  return TXT;
}

const doc = new jsPDF({ unit: 'pt', format: 'a4' });
const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight();

const b64 = fs.readFileSync(FONT).toString('base64');
doc.addFileToVFS('DejaVuSans.ttf', b64);
doc.addFont('DejaVuSans.ttf', 'DejaVu', 'normal');
doc.addFont('DejaVuSans.ttf', 'DejaVu', 'bold');
doc.setFont('DejaVu', 'normal');

const t = (s: string, x: number, y: number, size: number, col: number[], bold = false, align?: 'right'): number => {
  doc.setFontSize(size);
  doc.setTextColor(col[0], col[1], col[2]);
  doc.setFont('DejaVu', bold ? 'bold' : 'normal');
  if (align === 'right') doc.text(s, x, y, { align: 'right' });
  else doc.text(s, x, y);
  doc.setFont('DejaVu', 'normal');
  return doc.getTextWidth(s);
};

const panel = (x: number, y: number, w: number, h: number): void => {
  doc.setFillColor(PANEL[0], PANEL[1], PANEL[2]);
  doc.roundedRect(x, y, w, h, 8, 8, 'F');
  doc.setDrawColor(BORDER[0], BORDER[1], BORDER[2]);
  doc.setLineWidth(0.8);
  doc.roundedRect(x, y, w, h, 8, 8, 'S');
};

const band = (pg: number, total: number, title: string): void => {
  doc.setFillColor(BG[0], BG[1], BG[2]); doc.rect(0, 0, W, H, 'F');
  doc.setFillColor(RED[0], RED[1], RED[2]); doc.rect(0, 0, 5, 56, 'F');
  t('ARES', 32, 30, 14, RED, true);
  t('CRYPTO', 32 + doc.getTextWidth('ARES') + 4, 30, 14, TXT, true);
  t(title, 32, 46, 8.5, MUT);
  t(new Date().toLocaleDateString('ru-RU'), W - 32, 30, 9, MUT, false, 'right');
  t('ДЕМО · стр. ' + pg + '/' + total, W - 32, 46, 8, DIM, false, 'right');
};

// ── Страница 1: обложка = карточка №4 ────────────────────────────────────
doc.setFillColor(0, 0, 0); doc.rect(0, 0, W, H, 'F');
const img = fs.readFileSync(CARD);
const cw = W, chh = (cw * 1350) / 1080;
doc.addImage(new Uint8Array(img), 'JPEG', 0, (H - chh) / 2, cw, chh);

// ── Страница 2: детализация ─────────────────────────────────────────────
doc.addPage();
band(2, 3, 'ДЕТАЛИЗАЦИЯ ОТЧЁТА · УСЛОВНЫЕ ДАННЫЕ');
t('КОШЕЛЁК TRON · ' + DEMO.address, 32, 76, 9, TXT, true);
t(`Вердикт риска: 46/100 · СРЕДНИЙ · признаков риска: ${DEMO.riskScore}/100`, 32, 92, 9.5, AMB, true);

// KPI 4×2
const kw = (W - 64 - 3 * 10) / 4, kh = 52;
DEMO.kpi.forEach((k, i) => {
  const x = 32 + (i % 4) * (kw + 10), y = 104 + Math.floor(i / 4) * (kh + 8);
  panel(x, y, kw, kh);
  t(k.label, x + 8, y + 14, 6.3, MUT, true);
  t(k.value, x + 8, y + 30, 10.5, kpiCol(k.tone), true);
  t(k.sub, x + 8, y + 43, 6.3, DIM);
});

// Признаки риска — все 5
const ry = 232, rh = 344;
panel(32, ry, W - 64, rh);
t('// ПРИЗНАКИ РИСКА', 46, ry + 22, 10, RED, true);
t(`${DEMO.riskScore}/100`, W - 46, ry + 22, 10, BAD, true, 'right');
let fy = ry + 42;
for (const it of DEMO.findings) {
  const col = it.severity === 'red' ? BAD : it.severity === 'yellow' ? AMB : it.severity === 'blue' ? BLU : GRAY;
  doc.setFillColor(col[0], col[1], col[2]); doc.circle(54, fy - 3, 2.4, 'F');
  t(it.title, 64, fy, 9, TXT, true);
  t(it.detail, 64, fy + 11, 7.5, MUT);
  fy += 26;
  for (const r of it.rows) {
    t('· ' + r.addr + (r.tag ? `  [${r.tag}]` : ''), 80, fy + 8, 7.5, TXT);
    t(`${r.amount}  ×${r.n}`, W - 60, fy + 8, 7.5, BAD, true, 'right');
    fy += 16;
  }
  fy += 7;
}

// Профиль
const py = ry + rh + 14, ph = 148;
panel(32, py, W - 64, ph);
t('// ПРОФИЛЬ ПОВЕДЕНИЯ · ' + DEMO.profile.title.toUpperCase(), 46, py + 20, 10, RED, true);
t(`достоверность: ${DEMO.profile.confidence}`, W - 46, py + 20, 7.5, DIM, false, 'right');
DEMO.profile.bars.forEach((b, i) => {
  const y = py + 36 + i * 21;
  t(b.name, 46, y + 8, 8.5, MUT);
  doc.setFillColor(23, 23, 28); doc.roundedRect(150, y, W - 240, 8, 4, 4, 'F');
  doc.setFillColor(REDH[0], REDH[1], REDH[2]); doc.roundedRect(150, y, Math.max(4, (W - 240) * b.v / 100), 8, 4, 4, 'F');
  t(String(b.v), W - 46, y + 8, 8.5, TXT, true, 'right');
});

// Транзитность (сжатая таблица)
const ty = py + ph + 14, th = 118;
panel(32, ty, W - 64, th);
t('// ТРАНЗИТНОСТЬ · сопоставлено 53% (16 из 30 пар) · медиана удержания 150 мин', 46, ty + 20, 9, RED, true);
let ty2 = ty + 38;
t('ЗАДЕРЖКА', 46, ty2, 7, DIM, true); t('ПРИШЛО', 170, ty2, 7, DIM, true);
t('УШЛО', 270, ty2, 7, DIM, true); t('КОМУ', 370, ty2, 7, DIM, true);
ty2 += 6;
for (const r of DEMO.transit.rows) {
  t(r.delay, 46, ty2 + 10, 8, TXT, true); t(r.in, 170, ty2 + 10, 8, TXT);
  t(r.out, 270, ty2 + 10, 8, TXT); t(r.to, 370, ty2 + 10, 8, BLU);
  ty2 += 16;
}

// ── Страница 3: AML ──────────────────────────────────────────────────────
doc.addPage();
band(3, 3, 'AML · ПРОИСХОЖДЕНИЕ СРЕДСТВ · ФОРМАТ QUPPY В НАШЕМ СТИЛЕ');
t('// AML · ПРОИСХОЖДЕНИЕ СРЕДСТВ', 32, 78, 12, RED, true);
t('EXPOSURE: ' + DEMO.aml.exposureRu, W - 32, 78, 11, AMB, true, 'right');
t(DEMO.aml.source + ' · адрес ' + DEMO.address.slice(0, 10) + '…', 32, 94, 7.5, DIM);

const cats = DEMO.aml.categories;
const rowH = 17, tabY = 108, tabH = cats.length * rowH + 16;
panel(32, tabY, W - 64, tabH);
cats.forEach((c, i) => {
  const y = tabY + 16 + i * rowH;
  const col = toneCol(c.tone);
  t(c.ru, 46, y + 9, 8, TXT, c.tone === 'bad');
  const bx = 250, bw = 210;
  doc.setFillColor(23, 23, 28); doc.roundedRect(bx, y + 2, bw, 7, 3.5, 3.5, 'F');
  doc.setFillColor(col[0], col[1], col[2]); doc.roundedRect(bx, y + 2, Math.max(3, bw * Math.sqrt(c.pct / 100)), 7, 3.5, 3.5, 'F');
  t(c.pct.toFixed(2).replace('.', ',') + '%', 470, y + 9, 8.5, col, true, 'right');
});

const redCats = cats.filter((c) => c.tone === 'bad');
const fmt = (c: { ru: string; pct: number }): string => `${c.ru} ${c.pct.toFixed(2).replace('.', ',')}%`;
const sumY = tabY + tabH + 16;
panel(32, sumY, W - 64, 66);
t('КРАСНЫЕ КАТЕГОРИИ (требуют внимания)', 46, sumY + 16, 8.5, BAD, true);
t('· ' + fmt(redCats[0]) + ' · ' + fmt(redCats[1]), 46, sumY + 32, 7.5, TXT);
t('· ' + fmt(redCats[2]) + ' · ' + fmt(redCats[3]) + ' · ' + fmt(redCats[4]), 46, sumY + 44, 7.5, TXT);
t('Вердикт Exposure: ' + DEMO.aml.exposureRu + ' — с 50% возможен повышенный контроль и блокировки на биржах.', 46, sumY + 58, 7.5, MUT);

// Куда утекло
const ly = sumY + 80;
panel(32, ly, W - 64, 84);
t('КУДА УТЕКЛО', 46, ly + 20, 8.5, RED, true);
DEMO.leaks.forEach((l, i) => {
  const y = ly + 36 + i * 22;
  t(l.addr, 46, y + 8, 8.5, BLU);
  t(`${l.amount} · ${l.share}%`, W - 46, y + 8, 8.5, TXT, true, 'right');
  doc.setFillColor(23, 23, 28); doc.roundedRect(250, y + 2, 210, 7, 3.5, 3.5, 'F');
  doc.setFillColor(RED[0], RED[1], RED[2]); doc.roundedRect(250, y + 2, Math.max(4, 210 * l.share / 100), 7, 3.5, 3.5, 'F');
});

// Уровни риска (легенда как в Quppy, наши цвета)
const gl = ly + 98;
panel(32, gl, W - 64, 128);
t('УРОВНИ РИСКА (шкала Risk Score 0–100%)', 46, gl + 20, 8.5, RED, true);
const lvCol = [GRN, GRN, AMB, BAD, [225, 32, 38]];
DEMO.riskLevels.forEach((l, i) => {
  const y = gl + 38 + i * 17;
  t(`${l.ru} (${l.name})`, 46, y + 8, 8, lvCol[i], true);
  t(l.note, 190, y + 8, 7.5, MUT);
});

t('Отчёт носит информационный характер, вероятностные оценки на публичных данных; решения принимает получатель. ' +
  'Данные условные (DEMO), оформление согласуется с заказчиком. Ares Crypto-Analytics.', 32, H - 60, 7, DIM);

fs.writeFileSync(OUT, new Uint8Array(doc.output('arraybuffer')));
console.log('PDF v3:', OUT, Math.round(fs.statSync(OUT).size / 1024) + ' КБ');
