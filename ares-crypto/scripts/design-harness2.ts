// Дизайн-варианты №3 и №4 (canvas 1080×1350):
//   V3 «Ferrari-black» — глубокий чёрный + гоночный красный, плотность №1,
//                        полностью своя подача: красные рейки, «//»-заголовки,
//                        racing-score, KPI с красными тиками.
//   V4 «Гибрид»        — кольцо вердикта + спарклайн + KPI + риски + профиль
//                        + AML-чипы + утечки на чёрном с красным.
// Демо-данные: scripts/design-data.ts. Экспорт: window.__renderV3/V4 → dataURL JPEG.

import { DEMO } from './design-data.ts';

const W = 1080, H = 1350;

const C = {
  bg: '#060607', panel: '#0B0B0E', cell: '#0E0E12', cellB: '#1A1A1F', row: '#101014',
  text: '#F5F5F7', muted: '#9EA0AC', dim: '#55555C',
  red: '#E8001C', redHot: '#FF3B2E', redDeep: '#7A0009', redDark: '#4A050C',
  amber: '#FFD24A', blue: '#5FB0FF', gray: '#8A94AD',
};

function f(px: number, weight: number, mono = false, italic = false): string {
  const fam = mono ? "'JetBrains Mono','DejaVu Sans Mono',monospace" : "'Inter','DejaVu Sans',sans-serif";
  return `${italic ? 'italic ' : ''}${weight} ${px}px ${fam}`;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function truncate(ctx: CanvasRenderingContext2D, s: string, maxW: number): string {
  if (ctx.measureText(s).width <= maxW) return s;
  let out = s;
  while (out.length > 4 && ctx.measureText(out + '…').width > maxW) out = out.slice(0, -1);
  return out + '…';
}

function sevColor(s: string): string {
  return s === 'red' ? C.redHot : s === 'yellow' ? C.amber : s === 'blue' ? C.blue : C.gray;
}

function brandHeader(ctx: CanvasRenderingContext2D, y: number): void {
  const g = ctx.createLinearGradient(60, 0, 220, 0);
  g.addColorStop(0, C.redHot); g.addColorStop(1, C.redDeep);
  ctx.fillStyle = g; ctx.font = f(30, 800);
  ctx.fillText('ARES', 60, y + 36);
  const wA = ctx.measureText('ARES').width;
  ctx.fillStyle = C.text;
  ctx.fillText('CRYPTO', 60 + wA + 12, y + 36);
  ctx.fillStyle = C.muted; ctx.font = f(13, 500);
  ctx.fillText('CRYPTO-ANALYTICS · ОТЧЁТ ПО КОШЕЛЬКУ', 60, y + 60);
  ctx.fillStyle = '#0B0B0E'; roundRect(ctx, W - 188, y + 8, 128, 34, 8); ctx.fill();
  ctx.strokeStyle = '#26262C'; ctx.lineWidth = 1.5; roundRect(ctx, W - 188, y + 8, 128, 34, 8); ctx.stroke();
  ctx.fillStyle = C.red; ctx.font = f(15, 800); ctx.fillText('DEMO', W - 166, y + 31);
}

function redGrad(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const g = ctx.createLinearGradient(x, 0, x + w, 0);
  g.addColorStop(0, C.redHot); g.addColorStop(1, C.redDeep);
  ctx.fillStyle = g; roundRect(ctx, x, y, w, h, r); ctx.fill();
}

function racingFooter(ctx: CanvasRenderingContext2D, text: string): void {
  ctx.fillStyle = C.dim; ctx.font = f(12.5, 400);
  ctx.fillText(text, 60, H - 44);
  ctx.fillStyle = C.red; ctx.fillRect(60, H - 30, W - 120, 3);
  ctx.fillStyle = C.redDark; ctx.fillRect(60, H - 24, W - 120, 1);
}

// ── V3 «Ferrari-black» ───────────────────────────────────────────────────
function renderV3(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = C.red; ctx.fillRect(0, 0, 6, H);
  const X = 60, Wc = W - 120;

  brandHeader(ctx, 52);

  // racing score
  ctx.font = f(74, 800, false, true);
  const sw = ctx.measureText('46').width;
  ctx.fillStyle = C.red;
  ctx.fillText('46', X, 212);
  ctx.fillStyle = C.text; ctx.font = f(22, 800);
  ctx.fillText('/100 · СРЕДНИЙ', X + sw + 22, 206);
  ctx.fillStyle = C.red;
  const chipX = X + sw + 22 + ctx.measureText('/100 · СРЕДНИЙ').width + 24;
  roundRect(ctx, chipX, 178, 82, 32, 8); ctx.fill();
  ctx.fillStyle = '#FFFFFF'; ctx.font = f(14, 800); ctx.fillText('TRON', chipX + 18, 200);
  ctx.fillStyle = C.muted; ctx.font = f(15, 400, true);
  ctx.fillText(DEMO.address, W - 60 - ctx.measureText(DEMO.address).width, 198);

  // KPI 4×2 с красными тиками
  const gy = 240, cw = (Wc - 3 * 18) / 4, ch = 106;
  DEMO.kpi.forEach((k, i) => {
    const x = X + (i % 4) * (cw + 18), y = gy + Math.floor(i / 4) * (ch + 16);
    ctx.fillStyle = C.cell; roundRect(ctx, x, y, cw, ch, 10); ctx.fill();
    ctx.strokeStyle = C.cellB; ctx.lineWidth = 1.5; roundRect(ctx, x, y, cw, ch, 10); ctx.stroke();
    ctx.fillStyle = C.red; ctx.fillRect(x, y + 14, 3, ch - 28);
    ctx.fillStyle = C.muted; ctx.font = f(11.5, 600);
    ctx.fillText(truncate(ctx, k.label, cw - 30), x + 16, y + 26);
    ctx.fillStyle = k.tone === 'ok' ? '#00E676' : k.tone === 'bad' ? '#FF4438' : k.tone === 'info' ? C.blue : C.text;
    ctx.font = f(22, 700, true);
    ctx.fillText(truncate(ctx, k.value, cw - 26), x + 16, y + 60);
    ctx.fillStyle = C.dim; ctx.font = f(11, 400);
    ctx.fillText(truncate(ctx, k.sub, cw - 26), x + 16, y + 86);
  });

  // «//» ПРИЗНАКИ РИСКА
  const ry = 498, rh = 464;
  ctx.fillStyle = C.panel; roundRect(ctx, X, ry, Wc, rh, 12); ctx.fill();
  ctx.strokeStyle = '#1B1B20'; roundRect(ctx, X, ry, Wc, rh, 12); ctx.stroke();
  ctx.fillStyle = C.red; ctx.font = f(15, 800);
  ctx.fillText('// ПРИЗНАКИ РИСКА', X + 22, ry + 34);
  const riskChipX = X + 22 + ctx.measureText('// ПРИЗНАКИ РИСКА').width + 16;
  ctx.fillStyle = C.red; roundRect(ctx, riskChipX, ry + 14, 76, 26, 7); ctx.fill();
  ctx.fillStyle = '#FFFFFF'; ctx.font = f(14, 800);
  ctx.fillText(`${DEMO.riskScore}/100`, riskChipX + 12, ry + 32);

  let fy = ry + 66;
  for (const it of DEMO.findings) {
    ctx.fillStyle = sevColor(it.severity);
    ctx.beginPath(); ctx.arc(X + 32, fy - 6, 5.5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = C.text; ctx.font = f(16.5, 700);
    ctx.fillText(truncate(ctx, it.title, Wc - 110), X + 50, fy);
    ctx.fillStyle = C.muted; ctx.font = f(12.5, 400);
    ctx.fillText(truncate(ctx, it.detail, Wc - 80), X + 50, fy + 20);
    fy += 44;
    for (const r of it.rows) {
      ctx.fillStyle = C.row; roundRect(ctx, X + 50, fy - 12, Wc - 82, 25, 6); ctx.fill();
      ctx.fillStyle = '#C9C9D2'; ctx.font = f(12.5, 400, true);
      ctx.fillText(r.addr, X + 62, fy + 5);
      if (r.tag) {
        ctx.strokeStyle = C.red; ctx.lineWidth = 1; roundRect(ctx, X + 186, fy - 8, 148, 19, 6); ctx.stroke();
        ctx.fillStyle = C.redHot; ctx.font = f(10.5, 700);
        ctx.fillText(truncate(ctx, r.tag, 140), X + 194, fy + 5);
      }
      ctx.fillStyle = '#FF4438'; ctx.font = f(12.5, 700, true);
      const amt = r.amount;
      ctx.fillText(amt, W - 92 - ctx.measureText(amt).width - ctx.measureText(`×${r.n}`).width - 12, fy + 5);
      ctx.fillStyle = C.dim; ctx.font = f(11.5, 400);
      ctx.fillText(`×${r.n}`, W - 90 - ctx.measureText(`×${r.n}`).width, fy + 5);
      fy += 28;
    }
    fy += 10;
  }

  // ПРОФИЛЬ — красные бары
  const py = 992;
  ctx.fillStyle = C.panel; roundRect(ctx, X, py, Wc, 272, 12); ctx.fill();
  ctx.strokeStyle = '#1B1B20'; roundRect(ctx, X, py, Wc, 272, 12); ctx.stroke();
  ctx.fillStyle = C.red; ctx.font = f(15, 800);
  ctx.fillText(`// ${DEMO.profile.title.toUpperCase()}`, X + 22, py + 34);
  ctx.fillStyle = C.dim; ctx.font = f(12.5, 400);
  ctx.fillText(`достоверность: ${DEMO.profile.confidence}`, X + 22, py + 56);
  const by = py + 76;
  DEMO.profile.bars.forEach((b, i) => {
    const y = by + i * 34;
    ctx.fillStyle = C.muted; ctx.font = f(13, 500);
    ctx.fillText(b.name, X + 22, y + 14);
    const bx = X + 150, bw = Wc - 220;
    ctx.fillStyle = '#17171C'; roundRect(ctx, bx, y + 4, bw, 10, 5); ctx.fill();
    redGrad(ctx, bx, y + 4, Math.max(6, bw * b.v / 100), 10, 5);
    ctx.fillStyle = C.text; ctx.font = f(14, 700, true);
    ctx.fillText(String(b.v), W - 82, y + 14);
  });
  racingFooter(ctx, DEMO.disclaimer);
}

// ── V4 «Гибрид» ──────────────────────────────────────────────────────────
function renderV4(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, H);
  const X = 60, Wc = W - 120;

  brandHeader(ctx, 44);

  // hero: кольцо + уровень + чипы
  const cx = 208, cy = 268, r = 92;
  ctx.strokeStyle = '#1A1A1E'; ctx.lineWidth = 22;
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
  const ring = ctx.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
  ring.addColorStop(0, C.redHot); ring.addColorStop(1, C.redDeep);
  ctx.strokeStyle = ring; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (DEMO.verdict.score / 100)); ctx.stroke();
  ctx.lineCap = 'butt';
  ctx.fillStyle = C.text; ctx.font = f(56, 800);
  const sc = String(DEMO.verdict.score);
  ctx.fillText(sc, cx - ctx.measureText(sc).width / 2, cy + 8);
  ctx.fillStyle = C.dim; ctx.font = f(14, 500);
  ctx.fillText('ИЗ 100', cx - 22, cy + 38);

  ctx.fillStyle = C.amber; ctx.font = f(36, 800);
  ctx.fillText(DEMO.verdict.levelRu, 368, 240);
  const chips: [string, string][] = [['TRON', C.red], ['TronGrid', C.blue], ['DEMO 14 ДНЕЙ', C.amber]];
  let chx = 368;
  for (const [t, col] of chips) {
    ctx.font = f(13, 700);
    const wch = ctx.measureText(t).width + 28;
    ctx.strokeStyle = '#242429'; ctx.lineWidth = 1.5; roundRect(ctx, chx, 262, wch, 32, 9); ctx.stroke();
    ctx.fillStyle = col; ctx.fillText(t, chx + 14, 283);
    chx += wch + 10;
  }
  ctx.fillStyle = C.muted; ctx.font = f(14, 400, true);
  ctx.fillText(DEMO.address, 368, 330);

  // спарклайн
  const sy = 384;
  ctx.fillStyle = C.panel; roundRect(ctx, X, sy, Wc, 112, 12); ctx.fill();
  ctx.strokeStyle = '#1B1B20'; roundRect(ctx, X, sy, Wc, 112, 12); ctx.stroke();
  ctx.fillStyle = C.muted; ctx.font = f(12.5, 600);
  ctx.fillText('ОПЕРАЦИЙ В ДЕНЬ · 14 ДНЕЙ', X + 20, sy + 26);
  ctx.fillStyle = C.redHot; ctx.font = f(14, 800, true);
  ctx.fillText('пик 66', W - 128, sy + 26);
  const max = Math.max(...DEMO.spark), bw2 = (Wc - 56) / DEMO.spark.length;
  DEMO.spark.forEach((v, i) => {
    const bh = Math.max(3, (v / max) * 58);
    const bx = X + 22 + i * bw2, byy = sy + 94 - bh;
    redGrad(ctx, bx, byy, bw2 - 8, bh, 3);
  });

  // KPI 4×2 компакт
  const gy = 506, cw = (Wc - 3 * 14) / 4, ch = 88;
  DEMO.kpi.forEach((k, i) => {
    const x = X + (i % 4) * (cw + 14), y = gy + Math.floor(i / 4) * (ch + 12);
    ctx.fillStyle = C.cell; roundRect(ctx, x, y, cw, ch, 10); ctx.fill();
    ctx.strokeStyle = C.cellB; ctx.lineWidth = 1.5; roundRect(ctx, x, y, cw, ch, 10); ctx.stroke();
    ctx.fillStyle = C.muted; ctx.font = f(11, 600);
    ctx.fillText(truncate(ctx, k.label, cw - 26), x + 14, y + 22);
    ctx.fillStyle = k.tone === 'ok' ? '#00E676' : k.tone === 'bad' ? '#FF4438' : k.tone === 'info' ? C.blue : C.text;
    ctx.font = f(20, 700, true);
    ctx.fillText(truncate(ctx, k.value, cw - 24), x + 14, y + 50);
    ctx.fillStyle = C.dim; ctx.font = f(10.5, 400);
    ctx.fillText(truncate(ctx, k.sub, cw - 24), x + 14, y + 72);
  });

  // риски (3 ключевых, компактно)
  const ry = 726, rh = 288;
  ctx.fillStyle = C.panel; roundRect(ctx, X, ry, Wc, rh, 12); ctx.fill();
  ctx.strokeStyle = '#1B1B20'; roundRect(ctx, X, ry, Wc, rh, 12); ctx.stroke();
  ctx.fillStyle = C.red; ctx.font = f(15, 800);
  ctx.fillText('// ПРИЗНАКИ РИСКА', X + 22, ry + 32);
  const riskChipX4 = X + 22 + ctx.measureText('// ПРИЗНАКИ РИСКА').width + 16;
  ctx.fillStyle = C.red; roundRect(ctx, riskChipX4, ry + 12, 76, 26, 7); ctx.fill();
  ctx.fillStyle = '#FFFFFF'; ctx.font = f(14, 800);
  ctx.fillText(`${DEMO.riskScore}/100`, riskChipX4 + 12, ry + 30);
  const top = [DEMO.findings[0], DEMO.findings[1], DEMO.findings[4]];
  let fy = ry + 62;
  for (const it of top) {
    ctx.fillStyle = sevColor(it.severity);
    ctx.beginPath(); ctx.arc(X + 32, fy - 5, 5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = C.text; ctx.font = f(15.5, 700);
    ctx.fillText(truncate(ctx, it.title, Wc - 110), X + 48, fy);
    ctx.fillStyle = C.muted; ctx.font = f(12, 400);
    ctx.fillText(truncate(ctx, it.detail, Wc - 80), X + 48, fy + 18);
    fy += 40;
    for (const r of it.rows) {
      ctx.fillStyle = C.row; roundRect(ctx, X + 48, fy - 10, Wc - 78, 23, 6); ctx.fill();
      ctx.fillStyle = '#C9C9D2'; ctx.font = f(12, 400, true);
      ctx.fillText(r.addr, X + 58, fy + 5);
      if (r.tag) {
        ctx.strokeStyle = C.red; ctx.lineWidth = 1; roundRect(ctx, X + 182, fy - 6, 142, 18, 6); ctx.stroke();
        ctx.fillStyle = C.redHot; ctx.font = f(10, 700);
        ctx.fillText(truncate(ctx, r.tag, 134), X + 190, fy + 5);
      }
      ctx.fillStyle = '#FF4438'; ctx.font = f(12, 700, true);
      ctx.fillText(r.amount, W - 88 - ctx.measureText(r.amount).width - 24, fy + 5);
      ctx.fillStyle = C.dim; ctx.font = f(11, 400);
      ctx.fillText(`×${r.n}`, W - 86 - ctx.measureText(`×${r.n}`).width, fy + 5);
      fy += 26;
    }
    fy += 8;
  }

  // профиль компакт
  const py = 1030;
  ctx.fillStyle = C.panel; roundRect(ctx, X, py, Wc, 124, 12); ctx.fill();
  ctx.strokeStyle = '#1B1B20'; roundRect(ctx, X, py, Wc, 124, 12); ctx.stroke();
  ctx.fillStyle = C.red; ctx.font = f(13.5, 800);
  ctx.fillText(`// ${DEMO.profile.title.toUpperCase()}`, X + 20, py + 26);
  ctx.fillStyle = C.dim; ctx.font = f(11.5, 400);
  ctx.fillText(`достоверность: ${DEMO.profile.confidence}`, W - 60 - ctx.measureText(`достоверность: ${DEMO.profile.confidence}`).width, py + 26);
  DEMO.profile.bars.forEach((b, i) => {
    const y = py + 42 + i * 17;
    ctx.fillStyle = C.muted; ctx.font = f(11, 500);
    ctx.fillText(b.name, X + 20, y + 9);
    const bx = X + 140, bw = Wc - 210;
    ctx.fillStyle = '#17171C'; roundRect(ctx, bx, y + 2, bw, 7, 3.5); ctx.fill();
    redGrad(ctx, bx, y + 2, Math.max(5, bw * b.v / 100), 7, 3.5);
    ctx.fillStyle = C.text; ctx.font = f(12, 700, true);
    ctx.fillText(String(b.v), W - 78, y + 9);
  });

  // AML · происхождение средств (формат Quppy: Exposure + категории с долями)
  const ay = 1170;
  ctx.fillStyle = C.panel; roundRect(ctx, X, ay, Wc, 128, 12); ctx.fill();
  ctx.strokeStyle = '#1B1B20'; roundRect(ctx, X, ay, Wc, 128, 12); ctx.stroke();
  ctx.fillStyle = C.red; ctx.font = f(13.5, 800);
  ctx.fillText('// AML · ПРОИСХОЖДЕНИЕ СРЕДСТВ', X + 20, ay + 26);
  const expTxt = `EXPOSURE: ${DEMO.aml.exposureRu}`;
  ctx.font = f(12, 800);
  const expW = ctx.measureText(expTxt).width + 24;
  ctx.strokeStyle = C.amber; ctx.lineWidth = 1.2;
  roundRect(ctx, W - 80 - expW, ay + 12, expW, 22, 7); ctx.stroke();
  ctx.fillStyle = C.amber; ctx.fillText(expTxt, W - 68 - expW, ay + 27);
  const colW = (Wc - 60) / 2;
  const tone = (t: string): string => (t === 'bad' ? '#FF4438' : t === 'blue' ? C.blue : '#6A6F85');
  DEMO.aml.categories.slice(0, 8).forEach((c, i) => {
    const cxx = X + 20 + (i % 2) * (colW + 20), cyy = ay + 46 + Math.floor(i / 2) * 16;
    ctx.fillStyle = C.muted; ctx.font = f(10.5, 500);
    ctx.fillText(truncate(ctx, c.ru.split(' (')[0], 130), cxx, cyy + 9);
    const barX = cxx + 138, barW = colW - 190;
    ctx.fillStyle = '#17171C'; roundRect(ctx, barX, cyy + 2, barW, 6, 3); ctx.fill();
    const fill = Math.max(3, barW * Math.sqrt(c.pct / 100));
    ctx.fillStyle = tone(c.tone); roundRect(ctx, barX, cyy + 2, fill, 6, 3); ctx.fill();
    ctx.fillStyle = tone(c.tone); ctx.font = f(10.5, 700, true);
    const pctTxt = `${c.pct.toFixed(2).replace('.', ',')}%`;
    ctx.fillText(pctTxt, cxx + colW - ctx.measureText(pctTxt).width, cyy + 9);
  });
  ctx.fillStyle = C.dim; ctx.font = f(11, 400);
  const leakTxt = `Куда утекло: ${DEMO.leaks[0].addr} ${DEMO.leaks[0].amount} (${DEMO.leaks[0].share}%) · ${DEMO.leaks[1].addr} ${DEMO.leaks[1].amount} (${DEMO.leaks[1].share}%)`;
  ctx.fillText(truncate(ctx, leakTxt, Wc - 40), X + 20, ay + 120);
  racingFooter(ctx, DEMO.disclaimer);
}

declare const window: Record<string, unknown>;
window.__renderV3 = (): string => {
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  renderV3(ctx);
  return canvas.toDataURL('image/jpeg', 0.93);
};
window.__renderV4 = (): string => {
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  renderV4(ctx);
  return canvas.toDataURL('image/jpeg', 0.93);
};
