// Дизайн-варианты фото-карточки 1080×1350 (canvas, headless-браузер):
//   V1 «Дашборд-панель» — плотная панельная компоновка по референсу заказчика
//   V2 «Статус-карта»   — премиум: градиент, кольцо вердикта, спарклайн, AML-чипы
// Общие демо-данные: scripts/design-data.ts. Экспорт: window.__renderV1/V2 → dataURL JPEG.

import { DEMO } from './design-data.ts';

const W = 1080, H = 1350;

// ── палитры ──────────────────────────────────────────────────────────────
const P1 = {
  bg: '#0B1220', panel: '#101A2E', panel2: '#0D1524', border: '#1D2A45',
  text: '#E8EEF9', muted: '#93A1C0', dim: '#5A6A8C',
  red: '#FF2800', green: '#34D399', bad: '#FB7185', blue: '#60A5FA', cyan: '#22D3EE', amber: '#FBBF24',
};
const P2 = {
  bg0: '#0B0B0E', bg1: '#171A26', glass: 'rgba(255,255,255,0.045)', glassB: 'rgba(255,255,255,0.10)',
  text: '#F2F3F8', muted: '#9BA0B4', dim: '#6A6F85',
  red: '#FF2800', redGlow: 'rgba(255,40,0,0.28)', amber: '#FBBF24', cyan: '#22D3EE', green: '#34D399', blue: '#7DA2FF',
};

const SANS = "font-family-sans";
const MONO = "font-family-mono";

function f(px: number, weight: number, mono = false): string {
  return `${weight} ${px}px ${mono ? "'JetBrains Mono','DejaVu Sans Mono',monospace" : "'Inter','DejaVu Sans',sans-serif"}`;
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

function toneColor(p: typeof P1, t?: string): string {
  return t === 'ok' ? p.green : t === 'bad' ? p.bad : t === 'info' ? p.blue : t === 'warn' ? p.amber : p.muted;
}

function sevColor(p: typeof P1, s: string): string {
  return s === 'red' ? p.bad : s === 'yellow' ? p.amber : s === 'blue' ? p.blue : s === 'cyan' ? p.cyan : '#8A94AD';
}

function truncate(ctx: CanvasRenderingContext2D, s: string, maxW: number): string {
  if (ctx.measureText(s).width <= maxW) return s;
  let out = s;
  while (out.length > 4 && ctx.measureText(out + '…').width > maxW) out = out.slice(0, -1);
  return out + '…';
}

function header(ctx: CanvasRenderingContext2D, x: number, y: number, dark: boolean, demoChipColor: string): void {
  const p = dark ? P2 : P1;
  ctx.fillStyle = dark ? 'rgba(255,255,255,0.06)' : P1.panel;
  roundRect(ctx, x, y, 72, 72, 18); ctx.fill();
  ctx.strokeStyle = dark ? P2.glassB : P1.border; ctx.lineWidth = 2;
  roundRect(ctx, x, y, 72, 72, 18); ctx.stroke();
  ctx.fillStyle = P1.red; ctx.font = f(46, 800);
  ctx.fillText('A', x + 25, y + 53);
  ctx.fillStyle = dark ? P2.text : P1.text; ctx.font = f(28, 800);
  ctx.fillText('ARES CRYPTO', x + 92, y + 30);
  ctx.fillStyle = dark ? P2.muted : P1.muted; ctx.font = f(14, 500);
  ctx.fillText('CRYPTO-ANALYTICS · ОТЧЁТ ПО КОШЕЛЬКУ', x + 92, y + 54);
  // DEMO badge
  ctx.fillStyle = demoChipColor + '22';
  roundRect(ctx, W - x - 128, y + 8, 128, 34, 10); ctx.fill();
  ctx.strokeStyle = demoChipColor; ctx.lineWidth = 1.5;
  roundRect(ctx, W - x - 128, y + 8, 128, 34, 10); ctx.stroke();
  ctx.fillStyle = demoChipColor; ctx.font = f(15, 800);
  ctx.fillText('DEMO', W - x - 106, y + 31);
}

function footer(ctx: CanvasRenderingContext2D, text: string, y: number, dark: boolean): void {
  const p = dark ? P2 : P1;
  ctx.fillStyle = dark ? P2.dim : P1.dim; ctx.font = f(13, 400);
  ctx.fillText(text, 60, y);
  ctx.fillStyle = P1.red; ctx.fillRect(60, y + 16, W - 120, 3);
}

// ── V1 «Дашборд-панель» ─────────────────────────────────────────────────
function renderV1(ctx: CanvasRenderingContext2D): void {
  const p = P1;
  ctx.fillStyle = p.bg; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = p.red; ctx.fillRect(0, 0, 10, H);
  const X = 60, Wc = W - 120;

  header(ctx, X, 52, false, p.amber);

  // вердикт-строка
  ctx.fillStyle = p.amber; ctx.font = f(56, 800);
  ctx.fillText('46', X, 205);
  ctx.fillStyle = p.text; ctx.font = f(22, 700);
  ctx.fillText('/100 · СРЕДНИЙ', X + ctx.measureText('46').width + 66, 202);
  // чип сети
  ctx.fillStyle = p.panel; roundRect(ctx, X + 300, 172, 120, 32, 9); ctx.fill();
  ctx.strokeStyle = p.border; roundRect(ctx, X + 300, 172, 120, 32, 9); ctx.stroke();
  ctx.fillStyle = p.cyan; ctx.font = f(14, 700); ctx.fillText('TRON · GRID', X + 316, 193);
  ctx.fillStyle = p.muted; ctx.font = f(16, 400, true);
  const addr = truncate(ctx, DEMO.address, 360);
  ctx.fillText(addr, W - 60 - ctx.measureText(addr).width, 194);

  // KPI 4×2
  const gy = 236, cw = (Wc - 3 * 18) / 4, ch = 108;
  DEMO.kpi.forEach((k, i) => {
    const x = X + (i % 4) * (cw + 18), y = gy + Math.floor(i / 4) * (ch + 16);
    ctx.fillStyle = p.panel; roundRect(ctx, x, y, cw, ch, 14); ctx.fill();
    ctx.strokeStyle = p.border; ctx.lineWidth = 1.5; roundRect(ctx, x, y, cw, ch, 14); ctx.stroke();
    ctx.fillStyle = p.muted; ctx.font = f(12, 600);
    ctx.fillText(truncate(ctx, k.label, cw - 28), x + 14, y + 26);
    ctx.fillStyle = toneColor(p, k.tone); ctx.font = f(23, 700, true);
    ctx.fillText(truncate(ctx, k.value, cw - 24), x + 14, y + 60);
    ctx.fillStyle = p.dim; ctx.font = f(11, 400);
    ctx.fillText(truncate(ctx, k.sub, cw - 24), x + 14, y + 86);
  });

  // ПРИЗНАКИ РИСКА
  const ry = 496;
  ctx.fillStyle = p.panel; roundRect(ctx, X, ry, Wc, 470, 16); ctx.fill();
  ctx.strokeStyle = p.border; roundRect(ctx, X, ry, Wc, 470, 16); ctx.stroke();
  ctx.fillStyle = p.muted; ctx.font = f(14, 700);
  ctx.fillText('ПРИЗНАКИ РИСКА', X + 22, ry + 32);
  ctx.fillStyle = p.bad + '22'; roundRect(ctx, X + 176, ry + 12, 74, 26, 8); ctx.fill();
  ctx.fillStyle = p.bad; ctx.font = f(14, 800);
  ctx.fillText(`${DEMO.riskScore}/100`, X + 188, ry + 30);

  let fy = ry + 62;
  for (const it of DEMO.findings) {
    ctx.fillStyle = sevColor(p, it.severity);
    ctx.beginPath(); ctx.arc(X + 34, fy - 6, 6, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = p.text; ctx.font = f(17, 700);
    ctx.fillText(truncate(ctx, it.title, Wc - 120), X + 52, fy);
    ctx.fillStyle = p.muted; ctx.font = f(13, 400);
    ctx.fillText(truncate(ctx, it.detail, Wc - 90), X + 52, fy + 21);
    fy += 46;
    for (const r of it.rows) {
      ctx.fillStyle = p.panel2; roundRect(ctx, X + 52, fy - 12, Wc - 84, 26, 7); ctx.fill();
      ctx.fillStyle = p.blue; ctx.font = f(13, 400, true);
      ctx.fillText(r.addr, X + 64, fy + 6);
      if (r.tag) {
        ctx.fillStyle = p.blue + '20'; roundRect(ctx, X + 190, fy - 8, 150, 20, 6); ctx.fill();
        ctx.fillStyle = p.blue; ctx.font = f(11, 600);
        ctx.fillText(truncate(ctx, r.tag, 140), X + 198, fy + 6);
      }
      const amt = (r.dir === 'out' ? '' : '+') + r.amount;
      ctx.fillStyle = p.bad; ctx.font = f(13, 600, true);
      ctx.fillText(amt, W - 60 - 30 - ctx.measureText(amt).width - ctx.measureText(`×${r.n}`).width - 14, fy + 6);
      ctx.fillStyle = p.dim; ctx.font = f(12, 400);
      ctx.fillText(`×${r.n}`, W - 90 - ctx.measureText(`×${r.n}`).width, fy + 6);
      fy += 30;
    }
    fy += 12;
  }

  // ПРОФИЛЬ ПОВЕДЕНИЯ
  const py = 996;
  ctx.fillStyle = p.panel; roundRect(ctx, X, py, Wc, 268, 16); ctx.fill();
  ctx.strokeStyle = p.border; roundRect(ctx, X, py, Wc, 268, 16); ctx.stroke();
  ctx.fillStyle = p.cyan; ctx.font = f(19, 700);
  ctx.fillText(DEMO.profile.title.toUpperCase(), X + 22, py + 34);
  ctx.fillStyle = p.dim; ctx.font = f(13, 400);
  ctx.fillText(`достоверность: ${DEMO.profile.confidence}`, X + 22, py + 56);
  const by = py + 76;
  DEMO.profile.bars.forEach((b, i) => {
    const y = by + i * 34;
    ctx.fillStyle = p.muted; ctx.font = f(13, 500);
    ctx.fillText(b.name, X + 22, y + 14);
    const bx = X + 150, bw = Wc - 220;
    ctx.fillStyle = p.panel2; roundRect(ctx, bx, y + 4, bw, 10, 5); ctx.fill();
    const grad = ctx.createLinearGradient(bx, 0, bx + bw, 0);
    grad.addColorStop(0, p.blue); grad.addColorStop(1, p.cyan);
    ctx.fillStyle = grad; roundRect(ctx, bx, y + 4, Math.max(6, bw * b.v / 100), 10, 5); ctx.fill();
    ctx.fillStyle = p.text; ctx.font = f(14, 700, true);
    ctx.fillText(String(b.v), W - 82, y + 14);
  });
  footer(ctx, DEMO.disclaimer, H - 46, false);
}

// ── V2 «Статус-карта» ───────────────────────────────────────────────────
function renderV2(ctx: CanvasRenderingContext2D): void {
  const p = P2;
  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, p.bg0); grad.addColorStop(1, p.bg1);
  ctx.fillStyle = grad; ctx.fillRect(0, 0, W, H);
  const glow = ctx.createRadialGradient(180, 120, 10, 180, 120, 460);
  glow.addColorStop(0, p.redGlow); glow.addColorStop(1, 'rgba(255,40,0,0)');
  ctx.fillStyle = glow; ctx.fillRect(0, 0, 720, 560);

  header(ctx, 60, 52, true, p.amber);
  const X = 60, Wc = W - 120;

  // Hero: кольцо вердикта
  const cx = 230, cy = 330, r = 108;
  ctx.strokeStyle = 'rgba(255,255,255,0.08)'; ctx.lineWidth = 24;
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
  const ring = ctx.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
  ring.addColorStop(0, p.red); ring.addColorStop(1, p.amber);
  ctx.strokeStyle = ring; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (DEMO.verdict.score / 100)); ctx.stroke();
  ctx.lineCap = 'butt';
  ctx.fillStyle = p.text; ctx.font = f(64, 800);
  const sc = String(DEMO.verdict.score);
  ctx.fillText(sc, cx - ctx.measureText(sc).width / 2, cy + 10);
  ctx.fillStyle = p.dim; ctx.font = f(16, 500);
  ctx.fillText('ИЗ 100', cx - 24, cy + 40);

  ctx.fillStyle = p.amber; ctx.font = f(40, 800);
  ctx.fillText(DEMO.verdict.levelRu, 430, 262);
  ctx.fillStyle = p.muted; ctx.font = f(16, 500);
  ctx.fillText('Вердикт риска · профиль пересчитан на каждой проверке', 430, 292);
  // чипы
  const chips: [string, string][] = [[DEMO.chain, p.cyan], [DEMO.provider, p.blue], ['DEMO 14 ДНЕЙ', p.amber]];
  let chx = 430;
  for (const [t, col] of chips) {
    ctx.font = f(14, 700);
    const wch = ctx.measureText(t).width + 30;
    ctx.fillStyle = 'rgba(255,255,255,0.05)'; roundRect(ctx, chx, 318, wch, 34, 10); ctx.fill();
    ctx.strokeStyle = p.glassB; roundRect(ctx, chx, 318, wch, 34, 10); ctx.stroke();
    ctx.fillStyle = col; ctx.fillText(t, chx + 15, 340);
    chx += wch + 12;
  }
  ctx.fillStyle = p.muted; ctx.font = f(15, 400, true);
  ctx.fillText(truncate(ctx, DEMO.address, Wc - 380), 430, 390);

  // Спарклайн
  const sy = 470;
  ctx.fillStyle = 'rgba(255,255,255,0.05)'; roundRect(ctx, X, sy, Wc, 150, 16); ctx.fill();
  ctx.strokeStyle = p.glassB; roundRect(ctx, X, sy, Wc, 150, 16); ctx.stroke();
  ctx.fillStyle = p.muted; ctx.font = f(13, 600);
  ctx.fillText('ОПЕРАЦИЙ В ДЕНЬ · 14 ДНЕЙ', X + 20, sy + 28);
  ctx.fillStyle = p.cyan; ctx.font = f(15, 700, true);
  ctx.fillText('пик 66', W - 140, sy + 28);
  const max = Math.max(...DEMO.spark), bw2 = (Wc - 60) / DEMO.spark.length;
  DEMO.spark.forEach((v, i) => {
    const bh = Math.max(3, (v / max) * 84);
    const bx = X + 24 + i * bw2, byy = sy + 126 - bh;
    const g2 = ctx.createLinearGradient(0, byy, 0, sy + 126);
    g2.addColorStop(0, p.cyan); g2.addColorStop(1, p.blue + '55');
    ctx.fillStyle = g2;
    roundRect(ctx, bx, byy, bw2 - 8, bh, 3); ctx.fill();
  });

  // KPI 2×2
  const ky = 646, kw = (Wc - 20) / 2, kh = 92;
  const kpi2 = [
    ['ОБОРОТ', '1,62 млн $', 'сумма всех движений'],
    ['КОНТРАГЕНТОВ', '431', '18 отпр. / 413 получ.'],
    ['МЕДИАНА УДЕРЖАНИЯ', '150 мин', 'транзитные пересылки'],
    ['ТРАНЗИТНОСТЬ', '53%', '16 из 30 пар вход→выход'],
  ];
  kpi2.forEach((k, i) => {
    const x = X + (i % 2) * (kw + 20), y = ky + Math.floor(i / 2) * (kh + 16);
    ctx.fillStyle = p.glass; roundRect(ctx, x, y, kw, kh, 14); ctx.fill();
    ctx.strokeStyle = p.glassB; roundRect(ctx, x, y, kw, kh, 14); ctx.stroke();
    ctx.fillStyle = p.muted; ctx.font = f(12, 600);
    ctx.fillText(k[0], x + 18, y + 26);
    ctx.fillStyle = p.text; ctx.font = f(26, 800, true);
    ctx.fillText(k[1], x + 18, y + 58);
    ctx.fillStyle = p.dim; ctx.font = f(12, 400);
    ctx.fillText(k[2], x + 18, y + 80);
  });

  // AML strip
  const ay = 868;
  ctx.fillStyle = p.glass; roundRect(ctx, X, ay, Wc, 130, 16); ctx.fill();
  ctx.strokeStyle = p.glassB; roundRect(ctx, X, ay, Wc, 130, 16); ctx.stroke();
  ctx.fillStyle = p.amber; ctx.font = f(22, 800);
  ctx.fillText('AML 46/100 · СРЕДНИЙ', X + 20, ay + 34);
  ctx.fillStyle = p.dim; ctx.font = f(12, 400);
  ctx.fillText('эвристика на публичных данных · источники помечены', X + 20, ay + 56);
  DEMO.aml.hits.forEach((h, i) => {
    const x = X + 20 + i * ((Wc - 40) / 4), y = ay + 72, wch = (Wc - 40) / 4 - 12;
    ctx.fillStyle = 'rgba(255,255,255,0.04)'; roundRect(ctx, x, y, wch, 44, 10); ctx.fill();
    const col = h.tone === 'ok' ? p.green : p.amber;
    ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x + 16, y + 15, 4.5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = p.text; ctx.font = f(13, 700);
    ctx.fillText(`${h.name} · ${h.state}`, x + 28, y + 20);
    ctx.fillStyle = p.dim; ctx.font = f(11, 400);
    ctx.fillText(truncate(ctx, h.note, wch - 30), x + 12, y + 37);
  });

  // Куда утекло
  const ly = 1024;
  ctx.fillStyle = p.muted; ctx.font = f(14, 700);
  ctx.fillText('КУДА УТЕКЛО', X, ly);
  DEMO.leaks.forEach((l, i) => {
    const y = ly + 18 + i * 58;
    ctx.fillStyle = 'rgba(255,255,255,0.04)'; roundRect(ctx, X, y, Wc, 48, 12); ctx.fill();
    ctx.fillStyle = p.blue; ctx.font = f(15, 600, true);
    ctx.fillText(l.addr, X + 18, y + 22);
    ctx.fillStyle = p.dim; ctx.font = f(12, 400);
    ctx.fillText(l.label, X + 18, y + 40);
    ctx.fillStyle = p.text; ctx.font = f(16, 700, true);
    ctx.fillText(l.amount, W - 220 - ctx.measureText(l.amount).width, y + 30);
    const bx = W - 200, bw3 = 130;
    ctx.fillStyle = 'rgba(255,255,255,0.07)'; roundRect(ctx, bx, y + 19, bw3, 10, 5); ctx.fill();
    ctx.fillStyle = i === 0 ? p.red : p.blue;
    roundRect(ctx, bx, y + 19, Math.max(6, bw3 * l.share / 100), 10, 5); ctx.fill();
    ctx.fillStyle = p.muted; ctx.font = f(13, 700);
    ctx.fillText(`${l.share}%`, W - 58, y + 30);
  });

  footer(ctx, DEMO.disclaimer, H - 40, true);
}

declare const window: Record<string, unknown>;
window.__renderV1 = (): string => {
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  renderV1(ctx);
  return canvas.toDataURL('image/jpeg', 0.93);
};
window.__renderV2 = (): string => {
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  renderV2(ctx);
  return canvas.toDataURL('image/jpeg', 0.93);
};
