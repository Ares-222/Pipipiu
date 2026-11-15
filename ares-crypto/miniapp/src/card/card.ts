// Photo card renderer (spec §17, pipeline A): client-canvas 1080×1350 (4:5),
// design system §16 — black bg, red accents, branding, KPI grid, top findings,
// mini "куда утекло". Output: base64 JPEG -> POST /api/render -> worker sendPhoto.

import { fmt, fmtUsd, fmtPct, short, levelRu, type WalletReport } from '../api';

const C = {
  bg: '#0A0A0B', surface: '#131315', surface2: '#1A1A1D', border: '#232328',
  red: '#FF2800', redDeep: '#C21807', text: '#F2F2F3', muted: '#8A8A90',
  info: '#3B82F6', ok: '#22C55E', warn: '#F59E0B',
};

const W = 1080, H = 1350;

function font(size: number, weight: 400 | 600 | 700 | 800, mono = false): string {
  const fam = mono ? 'JetBrains Mono' : weight >= 600 ? 'Unbounded' : 'Inter';
  return `${weight} ${size}px "${fam}", sans-serif`;
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

export async function renderCardJpeg(report: WalletReport): Promise<string> {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;

  const cr = report.chains[0];
  const k = cr?.kpi;
  const addr = cr?.account.addr ?? report.input;
  const chain = cr?.chain.toUpperCase() ?? '';

  // background
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, W, H);

  // header
  ctx.fillStyle = C.red;
  ctx.fillRect(0, 0, 14, H);
  // monogram
  ctx.fillStyle = C.surface;
  roundRect(ctx, 60, 56, 84, 84, 20);
  ctx.fill();
  ctx.strokeStyle = C.border;
  ctx.lineWidth = 2;
  roundRect(ctx, 60, 56, 84, 84, 20);
  ctx.stroke();
  ctx.fillStyle = C.red;
  ctx.font = font(56, 800);
  ctx.fillText('A', 88, 118);
  ctx.fillStyle = C.text;
  ctx.font = font(30, 700);
  ctx.fillText('ARES CRYPTO', 168, 100);
  ctx.fillStyle = C.muted;
  ctx.font = font(15, 400);
  ctx.fillText('CRYPTO-ANALYTICS · ОТЧЁТ', 168, 126);

  // verdict
  const lvl = report.verdict.level;
  ctx.fillStyle = lvl === 'clean' || lvl === 'low' ? C.ok : lvl === 'medium' ? C.warn : C.red;
  ctx.font = font(64, 800);
  ctx.fillText(String(report.verdict.score), 60, 260);
  ctx.fillStyle = C.text;
  ctx.font = font(26, 600);
  ctx.fillText(`/100 · ${levelRu(lvl)}`, 60 + ctx.measureText(String(report.verdict.score)).width + 26, 258);
  ctx.fillStyle = C.muted;
  ctx.font = font(16, 400);
  ctx.fillText((chain ? chain + ' · ' : '') + short(addr, 18, 10), 60, 292);

  // KPI grid 2x3
  if (k) {
    const cells: [string, string, string][] = [
      ['ПОЛУЧЕНО', fmtUsd(k.received), `${k.receivedCount} операций`],
      ['ОТПРАВЛЕНО', fmtUsd(k.sent), `${k.sentCount} операций`],
      ['ОСЕЛО НА АДРЕСЕ', fmtPct(k.settledPct), 'от всего входящего'],
      ['КОНТРАГЕНТОВ', String(k.counterpartiesIn + k.counterpartiesOut), `${k.counterpartiesIn} отпр. / ${k.counterpartiesOut} получ.`],
      ['ОБОРОТ', fmtUsd(k.turnover), 'сумма всех движений'],
      ['СРЕДНИЙ ПЕРЕВОД', fmtUsd(k.avgTx), `медиана ${fmtUsd(k.medianTx)}`],
    ];
    const gx = 60, gy = 340, gw = (W - 120 - 24) / 2, gh = 120, gap = 24;
    cells.forEach((c, i) => {
      const x = gx + (i % 2) * (gw + gap);
      const y = gy + Math.floor(i / 2) * (gh + 18);
      ctx.fillStyle = C.surface;
      roundRect(ctx, x, y, gw, gh, 16);
      ctx.fill();
      ctx.strokeStyle = C.border;
      roundRect(ctx, x, y, gw, gh, 16);
      ctx.stroke();
      ctx.fillStyle = C.muted;
      ctx.font = font(13, 600);
      ctx.fillText(c[0], x + 20, y + 34);
      ctx.fillStyle = C.text;
      ctx.font = font(26, 700, true);
      ctx.fillText(c[1], x + 20, y + 74);
      ctx.fillStyle = C.muted;
      ctx.font = font(13, 400);
      ctx.fillText(c[2], x + 20, y + 100);
    });
  }

  // findings
  const fy = 800;
  ctx.fillStyle = C.muted;
  ctx.font = font(14, 600);
  ctx.fillText('ПРИЗНАКИ РИСКА', 60, fy);
  const sevColor = (s: string) => (s === 'red' ? C.red : s === 'yellow' ? C.warn : s === 'blue' ? C.info : '#6B7280');
  (cr?.findings ?? []).slice(0, 3).forEach((f, i) => {
    const y = fy + 40 + i * 96;
    ctx.fillStyle = C.surface;
    roundRect(ctx, 60, y, W - 120, 84, 14);
    ctx.fill();
    ctx.fillStyle = sevColor(f.severity);
    ctx.beginPath();
    ctx.arc(90, y + 30, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = C.text;
    ctx.font = font(18, 600);
    ctx.fillText(truncate(ctx, f.title, W - 200), 112, y + 36);
    ctx.fillStyle = C.muted;
    ctx.font = font(14, 400);
    ctx.fillText(truncate(ctx, f.detail, W - 200), 112, y + 62);
  });

  // profile bars
  if (cr?.classification) {
    const py = 1140;
    ctx.fillStyle = C.muted;
    ctx.font = font(14, 600);
    ctx.fillText('ПРОФИЛЬ ПОВЕДЕНИЯ', 60, py);
    ctx.fillStyle = C.text;
    ctx.font = font(20, 700);
    ctx.fillText(truncate(ctx, cr.classification.title, W - 300), 60, py + 34);
    ctx.fillStyle = C.muted;
    ctx.font = font(14, 400);
    ctx.fillText(`достоверность: ${cr.classification.confidence}`, 60, py + 60);
    const roles = [['Раздача', cr.classification.scores.fanout], ['Автомат', cr.classification.scores.auto], ['Транзит', cr.classification.scores.transit]] as [string, number][];
    let bx = 60;
    roles.forEach(([name, v]) => {
      ctx.fillStyle = C.surface2;
      roundRect(ctx, bx, py + 78, 300, 10, 5);
      ctx.fill();
      ctx.fillStyle = C.info;
      roundRect(ctx, bx, py + 78, Math.max(6, 300 * Math.min(1, v / 100)), 10, 5);
      ctx.fill();
      ctx.fillStyle = C.muted;
      ctx.font = font(12, 400);
      ctx.fillText(`${name} ${v}`, bx, py + 110);
      bx += 330;
    });
  }

  // footer
  ctx.fillStyle = C.muted;
  ctx.font = font(15, 400);
  ctx.fillText('Ares Crypto-Analytics · данные: публичные блокчейны · вероятностные оценки', 60, H - 56);
  ctx.fillStyle = C.red;
  ctx.fillRect(60, H - 40, W - 120, 4);

  return canvas.toDataURL('image/jpeg', 0.92);
}

function truncate(ctx: CanvasRenderingContext2D, s: string, maxW: number): string {
  if (ctx.measureText(s).width <= maxW) return s;
  let out = s;
  while (out.length > 4 && ctx.measureText(out + '…').width > maxW) out = out.slice(0, -1);
  return out + '…';
}
