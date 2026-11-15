// Дизайн-варианты PDF (jsPDF + DejaVuSans, кириллица):
//   V1 «Дашборд»   — тёмные панели как на карточке №1, цветные KPI, таблицы
//   V2 «Премиум»   — тёмная обложка со свечением + светлые страницы с красным акцентом
// Демо-данные: scripts/design-data.ts. Экспорт: makePdfV1() / makePdfV2() → Uint8Array.

import { jsPDF } from 'jspdf';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEMO } from './design-data.ts';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const FONT = path.join(ROOT, 'miniapp', 'public', 'fonts', 'DejaVuSans.ttf');

const NAVY = { bg: [11, 18, 32] as const, panel: [16, 26, 46] as const, panel2: [13, 21, 36] as const, border: [29, 42, 69] as const };
const INK = { text: [232, 238, 249] as const, muted: [147, 161, 192] as const, dim: [90, 106, 140] as const };
const ACC = { red: [255, 40, 0] as const, green: [52, 211, 153] as const, bad: [251, 113, 133] as const, blue: [96, 165, 250] as const, cyan: [34, 211, 238] as const, amber: [251, 191, 36] as const };
const LIGHT = { text: [24, 26, 34] as const, muted: [110, 116, 134] as const, panel: [246, 247, 251] as const, border: [226, 229, 240] as const };

function loadFont(doc: jsPDF): void {
  const b64 = fs.readFileSync(FONT).toString('base64');
  doc.addFileToVFS('DejaVuSans.ttf', b64);
  doc.addFont('DejaVuSans.ttf', 'DejaVu', 'normal');
  doc.addFont('DejaVuSans.ttf', 'DejaVu', 'bold');
  doc.setFont('DejaVu', 'normal');
}

function tone(acc: typeof ACC, t?: string): number[] {
  if (t === 'ok') return [...acc.green];
  if (t === 'bad') return [...acc.bad];
  if (t === 'info') return [...acc.blue];
  if (t === 'warn') return [...acc.amber];
  return [...INK.muted];
}

// ── PDF №1 «Дашборд» ─────────────────────────────────────────────────────
export function makePdfV1(): Uint8Array {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  loadFont(doc);
  const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight();
  let y = 0;

  const ensure = (need: number): void => { if (y + need > H - 50) { doc.addPage(); y = 52; } };
  const panel = (x: number, yy: number, w: number, h: number, fill: number[]): void => {
    doc.setFillColor(fill[0], fill[1], fill[2]);
    doc.roundedRect(x, yy, w, h, 8, 8, 'F');
    doc.setDrawColor(NAVY.border[0], NAVY.border[1], NAVY.border[2]);
    doc.roundedRect(x, yy, w, h, 8, 8, 'S');
  };
  const t = (txt: string, x: number, yy: number, size: number, col: number[], bold = false): void => {
    doc.setFontSize(size);
    doc.setTextColor(col[0], col[1], col[2]);
    doc.setFont('DejaVu', bold ? 'bold' : 'normal');
    doc.text(txt, x, yy);
    doc.setFont('DejaVu', 'normal');
  };

  // шапка-полоса на каждой странице
  const band = (): void => {
    doc.setFillColor(...NAVY.bg); doc.rect(0, 0, W, 74, 'F');
    doc.setFillColor(...ACC.red); doc.rect(0, 0, 6, 74, 'F');
    t('ARES CRYPTO-ANALYTICS', 40, 34, 16, [...ACC.red], true);
    t('ДЕМО-ПРИМЕР ОФОРМЛЕНИЯ №1 · условные данные', 40, 52, 9, [...INK.muted]);
    t(new Date().toLocaleDateString('ru-RU'), W - 60, 34, 10, [...INK.muted]);
    y = 100;
  };

  band();
  t('КОШЕЛЁК TRON · ' + DEMO.address, 40, y, 10, [...INK.text], true); y += 22;
  t(`Вердикт риска: 46/100 — СРЕДНИЙ · признаков риска: ${DEMO.riskScore}/100`, 40, y, 11, [...ACC.amber], true); y += 30;

  // KPI-сетка 4×2
  const kw = (W - 80 - 3 * 12) / 4, kh = 58;
  DEMO.kpi.forEach((k, i) => {
    const x = 40 + (i % 4) * (kw + 12), yy = y + Math.floor(i / 4) * (kh + 10);
    panel(x, yy, kw, kh, [...NAVY.panel]);
    t(k.label, x + 10, yy + 16, 6.5, [...INK.muted]);
    t(k.value, x + 10, yy + 34, 11, tone(ACC, k.tone), true);
    t(k.sub, x + 10, yy + 48, 6.5, [...INK.dim]);
  });
  y += 2 * (kh + 10) + 22;

  // Признаки риска
  panel(40, y, W - 80, 250, [...NAVY.panel]);
  t('ПРИЗНАКИ РИСКА', 56, y + 22, 10, [...INK.muted], true);
  t(`${DEMO.riskScore}/100`, W - 108, y + 22, 10, [...ACC.bad], true);
  let ry = y + 44;
  for (const it of DEMO.findings) {
    const col = it.severity === 'red' ? ACC.bad : it.severity === 'yellow' ? ACC.amber : it.severity === 'blue' ? ACC.blue : INK.dim;
    doc.setFillColor(col[0], col[1], col[2]); doc.circle(64, ry - 3, 2.6, 'F');
    t(it.title, 76, ry, 9.5, [...INK.text], true);
    t(it.detail, 76, ry + 13, 8, [...INK.muted]);
    ry += 30;
    for (const r of it.rows) {
      t(r.addr, 92, ry + 8, 8, [...ACC.blue]);
      t((r.tag ?? ''), 200, ry + 8, 8, [...ACC.blue]);
      t(`${r.dir === 'out' ? '' : '+'}${r.amount}  ×${r.n}`, W - 130, ry + 8, 8, [...ACC.bad], true);
      ry += 18;
    }
    ry += 8;
  }
  y += 264;

  // Профиль поведения (бары)
  panel(40, y, W - 80, 176, [...NAVY.panel]);
  t('ПРОФИЛЬ ПОВЕДЕНИЯ · ' + DEMO.profile.title.toUpperCase(), 56, y + 22, 10, [...ACC.cyan], true);
  t(`достоверность: ${DEMO.profile.confidence}`, 56, y + 36, 8, [...INK.dim]);
  let by = y + 56;
  for (const b of DEMO.profile.bars) {
    t(b.name, 56, by + 9, 8.5, [...INK.muted]);
    const bx = 170, bw = W - 270;
    doc.setFillColor(...NAVY.panel2); doc.roundedRect(bx, by, bw, 9, 4, 4, 'F');
    doc.setFillColor(...ACC.blue); doc.roundedRect(bx, by, Math.max(4, bw * b.v / 100), 9, 4, 4, 'F');
    t(String(b.v), W - 92, by + 9, 8.5, [...INK.text], true);
    by += 23;
  }
  y += 192;

  // Транзитность — таблица
  panel(40, y, W - 80, 168, [...NAVY.panel]);
  t('ТРАНЗИТНОСТЬ · сопоставлено пар 53% (16 из 30) · медиана удержания 150 мин', 56, y + 22, 10, [...INK.muted], true);
  let ty = y + 46;
  t('ЗАДЕРЖКА', 56, ty, 8, [...INK.dim], true);
  t('ПРИШЛО', 220, ty, 8, [...INK.dim], true);
  t('УШЛО', 330, ty, 8, [...INK.dim], true);
  t('КОМУ', 440, ty, 8, [...INK.dim], true);
  ty += 6;
  doc.setDrawColor(...NAVY.border); doc.line(56, ty, W - 56, ty);
  ty += 16;
  for (const r of DEMO.transit.rows) {
    t(r.delay, 56, ty, 8.5, [...INK.text], true);
    t(r.in, 220, ty, 8.5, [...INK.text]);
    t(r.out, 330, ty, 8.5, [...INK.text]);
    t(r.to, 440, ty, 8.5, [...ACC.blue]);
    ty += 19;
  }
  y = ty + 12;

  // AML
  ensure(110);
  panel(40, y, W - 80, 96, [...NAVY.panel]);
  t('AML-ОЦЕНКА: 46/100 — СРЕДНИЙ', 56, y + 24, 11, [...ACC.amber], true);
  let ax = 56;
  for (const h of DEMO.aml.hits) {
    const col = h.tone === 'ok' ? ACC.green : ACC.amber;
    doc.setFillColor(col[0], col[1], col[2]); doc.circle(ax + 4, y + 46, 2.6, 'F');
    t(`${h.name} · ${h.state}`, ax + 12, y + 50, 8.5, [...INK.text], true);
    t(h.note, ax + 12, y + 64, 7.5, [...INK.dim]);
    ax += 122;
  }
  t('Каждый источник помечен: хопы, доля объёма, возраст контакта.', 56, y + 84, 7.5, [...INK.dim]);

  // футер
  const pages = doc.getNumberOfPages();
  for (let pg = 1; pg <= pages; pg++) {
    doc.setPage(pg);
    t('Ares Crypto-Analytics · ДЕМО · стр. ' + pg + '/' + pages + ' · условные данные для выбора оформления', 40, H - 22, 7.5, [...INK.dim]);
  }
  return new Uint8Array(doc.output('arraybuffer'));
}

// ── PDF №2 «Премиум» ─────────────────────────────────────────────────────
export function makePdfV2(): Uint8Array {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  loadFont(doc);
  const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight();

  const t = (txt: string, x: number, yy: number, size: number, col: number[], bold = false): void => {
    doc.setFontSize(size);
    doc.setTextColor(col[0], col[1], col[2]);
    doc.setFont('DejaVu', bold ? 'bold' : 'normal');
    doc.text(txt, x, yy);
    doc.setFont('DejaVu', 'normal');
  };

  // обложка (тёмная, со «свечением»)
  doc.setFillColor(11, 11, 14); doc.rect(0, 0, W, H, 'F');
  doc.setGState(doc.GState({ opacity: 0.16 }));
  doc.setFillColor(...ACC.red); doc.circle(W / 2, 210, 190, 'F');
  doc.setGState(doc.GState({ opacity: 1 }));
  t('A', W / 2 - 14, 90, 40, [...ACC.red], true);
  t('ARES CRYPTO-ANALYTICS', W / 2 - 110, 130, 15, [242, 243, 248], true);
  t('СТАТУС-КАРТА КОШЕЛЬКА · ДЕМО-ПРИМЕР ОФОРМЛЕНИЯ №2', W / 2 - 140, 150, 9, [155, 160, 180]);

  // кольцо вердикта на обложке
  doc.setDrawColor(255, 255, 255); doc.setLineWidth(1);
  doc.setDrawColor(60, 62, 78); doc.setLineWidth(16); doc.circle(W / 2, 230, 64, 'S');
  doc.setDrawColor(...ACC.red); doc.setLineWidth(16); doc.circle(W / 2, 230, 64, 'S');
  t('46', W / 2 - 18, 240, 34, [242, 243, 248], true);
  t('ИЗ 100 · СРЕДНИЙ', W / 2 - 52, 320, 10, [251, 191, 36], true);

  t(DEMO.address, W / 2 - 118, 370, 9.5, [155, 160, 180]);
  t('TRON · TronGrid · период 14 дней · условные данные', W / 2 - 120, 388, 8.5, [106, 111, 133]);

  let sy = 460;
  const sec = (title: string, yy: number): number => yy + 24;
  const sub = (k: string, v: string, x: number, yy: number, col: number[]): number => yy + 0;
  t('ОБОРОТ', 90, sy, 8.5, [155, 160, 180]); t('1,62 млн $', 90, sy + 18, 13, [242, 243, 248], true);
  t('КОНТРАГЕНТОВ', W / 2, sy, 8.5, [155, 160, 180]); t('431', W / 2, sy + 18, 13, [242, 243, 248], true);
  sy += 52;
  t('ТРАНЗИТНОСТЬ', 90, sy, 8.5, [155, 160, 180]); t('53%', 90, sy + 18, 13, [34, 211, 238], true);
  t('МЕДИАНА УДЕРЖАНИЯ', W / 2, sy, 8.5, [155, 160, 180]); t('150 мин', W / 2, sy + 18, 13, [34, 211, 238], true);
  sy += 60;
  t('AML 46/100 · СРЕДНИЙ', 90, sy, 12, [251, 191, 36], true);
  sy += 22;
  t('OFAC чисто · ScamDB 1 хоп (12%) · миксеры чисто · даркнет чисто', 90, sy, 8.5, [155, 160, 180]);
  sy += 40;
  t('КУДА УТЕКЛО', 90, sy, 9, [155, 160, 180], true);
  sy += 20;
  DEMO.leaks.forEach((l) => {
    t(l.addr, 90, sy, 9, [125, 162, 255]);
    t(`${l.amount} · ${l.share}%`, W - 200, sy, 9, [242, 243, 248], true);
    doc.setFillColor(255, 255, 255); doc.setGState(doc.GState({ opacity: 0.08 }));
    doc.roundedRect(90, sy + 6, W - 180, 6, 3, 3, 'F');
    doc.setGState(doc.GState({ opacity: 1 }));
    doc.setFillColor(...(l.share > 50 ? ACC.red : ACC.blue)); doc.roundedRect(90, sy + 6, Math.max(4, (W - 180) * l.share / 100), 6, 3, 3, 'F');
    sy += 22;
  });
  t('Ares Crypto-Analytics · ДЕМО · условные данные', W / 2 - 105, H - 40, 7.5, [106, 111, 133]);

  // страница 2: светлые детали
  doc.addPage();
  doc.setFillColor(255, 255, 255); doc.rect(0, 0, W, H, 'F');
  doc.setFillColor(...ACC.red); doc.rect(0, 0, 6, H, 'F');
  let y2 = 70;
  t('ДЕТАЛИЗАЦИЯ · ДЕМО №2', 40, y2, 14, [...LIGHT.text], true);
  t('данные условные — для согласования оформления', 40, y2 + 16, 8.5, [...LIGHT.muted]);
  y2 += 44;

  const sectionLight = (title: string): void => {
    y2 += 8;
    t(title.toUpperCase(), 40, y2, 10, [...ACC.red], true);
    doc.setDrawColor(...LIGHT.border); doc.line(40, y2 + 6, W - 40, y2 + 6);
    y2 += 20;
  };

  sectionLight('Признаки риска 60/100');
  for (const it of DEMO.findings) {
    const col = it.severity === 'red' ? ACC.bad : it.severity === 'yellow' ? ACC.amber : it.severity === 'blue' ? ACC.blue : LIGHT.muted;
    doc.setFillColor(col[0], col[1], col[2]); doc.circle(46, y2 - 3, 2.6, 'F');
    t(it.title, 58, y2, 9.5, [...LIGHT.text], true);
    t(it.detail, 58, y2 + 12, 8, [...LIGHT.muted]);
    y2 += 26;
    for (const r of it.rows) {
      t('· ' + r.addr + (r.tag ? ` [${r.tag}]` : '') + ` — ${r.amount} ×${r.n}`, 74, y2, 8.5, [...LIGHT.muted]);
      y2 += 14;
    }
    y2 += 6;
  }

  sectionLight('Профиль поведения · ' + DEMO.profile.title);
  for (const b of DEMO.profile.bars) {
    t(b.name, 40, y2 + 9, 8.5, [...LIGHT.muted]);
    doc.setFillColor(...LIGHT.panel); doc.roundedRect(150, y2, W - 250, 9, 4, 4, 'F');
    doc.setFillColor(...ACC.red); doc.roundedRect(150, y2, Math.max(4, (W - 250) * b.v / 100), 9, 4, 4, 'F');
    t(String(b.v), W - 92, y2 + 9, 8.5, [...LIGHT.text], true);
    y2 += 21;
  }

  sectionLight('Транзитность · самые быстрые пересылки');
  t('ЗАДЕРЖКА', 40, y2, 8, [...LIGHT.muted], true);
  t('ПРИШЛО', 190, y2, 8, [...LIGHT.muted], true);
  t('УШЛО', 290, y2, 8, [...LIGHT.muted], true);
  t('КОМУ', 390, y2, 8, [...LIGHT.muted], true);
  y2 += 6;
  doc.setDrawColor(...LIGHT.border); doc.line(40, y2, W - 40, y2);
  y2 += 15;
  for (const r of DEMO.transit.rows) {
    t(r.delay, 40, y2, 8.5, [...LIGHT.text], true);
    t(r.in, 190, y2, 8.5, [...LIGHT.text]);
    t(r.out, 290, y2, 8.5, [...LIGHT.text]);
    t(r.to, 390, y2, 8.5, [...ACC.blue]);
    y2 += 17;
  }

  sectionLight('Балансы и активность');
  t('USDT: 6 512,18 · TRX: 0 · всего движений 559 за 14 дней · крупнейший перевод 85 000 $ (09.11.2026)', 40, y2, 8.5, [...LIGHT.muted]);

  t('Ares Crypto-Analytics · ДЕМО №2 · стр. 2/2', 40, H - 22, 7.5, [...LIGHT.muted]);
  return new Uint8Array(doc.output('arraybuffer'));
}
