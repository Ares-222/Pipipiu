// Photo card renderer (spec §17, pipeline A): client-canvas 1080×1350 (4:5).
// Layout = утверждённый вариант №4 (design-harness2 renderV4): чёрный + красный,
// кольцо вердикта, спарклайн, KPI 4×2, признаки риска с адресами, профиль-бары,
// AML-происхождение средств (exposure) + «куда утекло». Данные — только живые
// из WalletReport (demo-данных нет). Output: JPEG dataURL -> POST /api/render.

import { fmt, fmtUsd, fmtPct, short, levelRu, categoryRu, type WalletReport } from '../api';

const W = 1080, H = 1350;
const X = 60, Wc = W - 120;

const C = {
  bg: '#060607', panel: '#0B0B0E', cell: '#0E0E12', cellB: '#1A1A1F', row: '#101014',
  text: '#F5F5F7', muted: '#9EA0AC', dim: '#55555C',
  red: '#E8001C', redHot: '#FF3B2E', redDeep: '#7A0009', redDark: '#4A050C',
  amber: '#FFD24A', blue: '#5FB0FF', gray: '#8A94AD',
  ok: '#00E676',
};

function font(px: number, weight: number, mono = false): string {
  const fam = mono ? "'JetBrains Mono','DejaVu Sans Mono',monospace" : "'Inter','Roboto','DejaVu Sans',sans-serif";
  return `${weight} ${px}px ${fam}`;
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

function redGrad(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const g = ctx.createLinearGradient(x, 0, x + w, 0);
  g.addColorStop(0, C.redHot); g.addColorStop(1, C.redDeep);
  ctx.fillStyle = g;
  roundRect(ctx, x, y, w, h, r);
  ctx.fill();
}

function levelColorRu(level: string): string {
  return level === 'clean' || level === 'low' ? C.ok : level === 'medium' ? C.amber : C.redHot;
}

function brandHeader(ctx: CanvasRenderingContext2D, y: number, dateText: string): void {
  const g = ctx.createLinearGradient(60, 0, 220, 0);
  g.addColorStop(0, C.redHot); g.addColorStop(1, C.redDeep);
  ctx.fillStyle = g; ctx.font = font(30, 800);
  ctx.fillText('ARES', 60, y + 36);
  const wA = ctx.measureText('ARES').width;
  ctx.fillStyle = C.text;
  ctx.fillText('CRYPTO', 60 + wA + 12, y + 36);
  ctx.fillStyle = C.muted; ctx.font = font(13, 500);
  ctx.fillText('CRYPTO-ANALYTICS · ОТЧЁТ ПО КОШЕЛЬКУ', 60, y + 60);
  // дата отчёта справа (в утверждённом макете на этом месте был DEMO-бейдж)
  ctx.font = font(15, 800);
  const dw = ctx.measureText(dateText).width + 32;
  ctx.fillStyle = '#0B0B0E';
  roundRect(ctx, W - 60 - dw, y + 8, dw, 34, 8); ctx.fill();
  ctx.strokeStyle = '#26262C'; ctx.lineWidth = 1.5;
  roundRect(ctx, W - 60 - dw, y + 8, dw, 34, 8); ctx.stroke();
  ctx.fillStyle = C.red;
  ctx.fillText(dateText, W - 60 - dw + 16, y + 31);
}

function racingFooter(ctx: CanvasRenderingContext2D, text: string): void {
  ctx.fillStyle = C.dim; ctx.font = font(12.5, 400);
  ctx.fillText(truncate(ctx, text, W - 120), 60, H - 44);
  ctx.fillStyle = C.red; ctx.fillRect(60, H - 30, W - 120, 3);
  ctx.fillStyle = C.redDark; ctx.fillRect(60, H - 24, W - 120, 1);
}

const DISCLAIMER = 'Ares Crypto-Analytics · публичные блокчейны · вероятностные оценки · не финансовый совет';

export async function renderCardJpeg(report: WalletReport): Promise<string> {
  try { await (document as unknown as { fonts?: { ready: Promise<unknown> } }).fonts?.ready; } catch { /* шрифты не критичны */ }

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;

  const cr = report.chains[0];
  const k = cr?.kpi;
  const addr = cr?.account.addr ?? report.input;
  const chain = cr?.chain.toUpperCase() ?? '';

  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, W, H);

  const dateText = new Date(report.createdAt * 1000).toLocaleDateString('ru-RU');
  brandHeader(ctx, 44, dateText);

  // ── hero: кольцо вердикта + уровень + чипы ──────────────────────────────
  const score = report.verdict.score;
  const cx = 208, cy = 268, r = 92;
  ctx.strokeStyle = '#1A1A1E'; ctx.lineWidth = 22;
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
  const ring = ctx.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
  ring.addColorStop(0, C.redHot); ring.addColorStop(1, C.redDeep);
  ctx.strokeStyle = ring; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.max(0.01, score / 100)); ctx.stroke();
  ctx.lineCap = 'butt';
  ctx.fillStyle = C.text; ctx.font = font(56, 800);
  const sc = String(score);
  ctx.fillText(sc, cx - ctx.measureText(sc).width / 2, cy + 8);
  ctx.fillStyle = C.dim; ctx.font = font(14, 500);
  ctx.fillText('ИЗ 100', cx - 22, cy + 38);

  const lvl = report.verdict.level;
  ctx.fillStyle = levelColorRu(lvl); ctx.font = font(36, 800);
  ctx.fillText(levelRu(lvl), 368, 240);
  const provider = (cr?.providers ?? [])[0] ?? cr?.account.provider ?? '';
  const chips: [string, string][] = [];
  if (chain) chips.push([chain, C.red]);
  if (provider) chips.push([truncate(ctx, provider, 160), C.blue]);
  if (k) chips.push([`${k.activeDays} АКТ. ДН`, C.amber]);
  let chx = 368;
  for (const [t, col] of chips.slice(0, 3)) {
    ctx.font = font(13, 700);
    const wch = Math.min(W - 80 - chx, ctx.measureText(t).width + 28);
    if (wch < 50) break;
    ctx.strokeStyle = '#242429'; ctx.lineWidth = 1.5;
    roundRect(ctx, chx, 262, wch, 32, 9); ctx.stroke();
    ctx.fillStyle = col;
    ctx.fillText(truncate(ctx, t, wch - 24), chx + 14, 283);
    chx += wch + 10;
  }
  ctx.fillStyle = C.muted; ctx.font = font(14, 400, true);
  ctx.fillText(short(addr, 20, 12), 368, 330);

  // ── спарклайн: операций в день, последние 14 дней (окно от последней операции) ──
  const days = 14;
  const txsAll = cr?.txs ?? [];
  const latestTs = txsAll.reduce((m, t) => Math.max(m, t.ts), 0);
  const anchor = Math.max(report.createdAt, latestTs);
  const dayStart = Math.floor(anchor / 86400) * 86400;
  const buckets = new Array(days).fill(0) as number[];
  for (const t of txsAll) {
    const idx = days - 1 - Math.floor((dayStart - t.ts) / 86400);
    if (idx >= 0 && idx < days) buckets[idx] += 1;
  }
  const sy = 384;
  ctx.fillStyle = C.panel; roundRect(ctx, X, sy, Wc, 112, 12); ctx.fill();
  ctx.strokeStyle = '#1B1B20'; roundRect(ctx, X, sy, Wc, 112, 12); ctx.stroke();
  ctx.fillStyle = C.muted; ctx.font = font(12.5, 600);
  ctx.fillText('ОПЕРАЦИЙ В ДЕНЬ · 14 ДНЕЙ', X + 20, sy + 26);
  const peak = Math.max(...buckets);
  ctx.fillStyle = C.redHot; ctx.font = font(14, 800, true);
  const peakTxt = `пик ${peak}`;
  ctx.fillText(peakTxt, W - 88 - ctx.measureText(peakTxt).width, sy + 26);
  if (peak === 0) {
    ctx.fillStyle = C.dim; ctx.font = font(13, 400);
    ctx.fillText('операций в окне 14 дней нет — активность старше выборки', X + 22, sy + 66);
  } else {
    const maxB = Math.max(1, peak);
    const bw2 = (Wc - 56) / days;
    buckets.forEach((v, i) => {
      const bh = Math.max(3, (v / maxB) * 58);
      redGrad(ctx, X + 22 + i * bw2, sy + 94 - bh, Math.max(4, bw2 - 8), bh, 3);
    });
  }

  // ── KPI 4×2 ──────────────────────────────────────────────────────────────
  if (k) {
    type Tile = { label: string; value: string; sub: string; tone?: 'ok' | 'bad' | 'info' };
    const tiles: Tile[] = [
      { label: 'ПОЛУЧЕНО', value: fmtUsd(k.received), sub: `${k.receivedCount} операций`, tone: 'ok' },
      { label: 'ОТПРАВЛЕНО', value: fmtUsd(k.sent), sub: `${k.sentCount} операций`, tone: 'bad' },
      { label: 'ОСЕЛО НА АДРЕСЕ', value: fmtPct(k.settledPct), sub: 'от всего входящего' },
      { label: 'КОНТРАГЕНТОВ', value: String(k.counterpartiesIn + k.counterpartiesOut), sub: `${k.counterpartiesIn} отпр. / ${k.counterpartiesOut} получ.` },
      { label: 'ОБОРОТ', value: fmtUsd(k.turnover), sub: 'сумма всех движений' },
      { label: 'СРЕДНИЙ ПЕРЕВОД', value: fmtUsd(k.avgTx), sub: `медиана ${fmtUsd(k.medianTx)}` },
      { label: 'КРУПНЕЙШИЙ ПЕРЕВОД', value: fmtUsd(k.maxTx), sub: 'в выборке', tone: 'info' },
      { label: 'АКТИВНЫХ ДНЕЙ', value: String(k.activeDays), sub: k.ageDays !== null ? `возраст ${k.ageDays} дн.` : 'в выборке' },
    ];
    const gy = 506, cw = (Wc - 3 * 14) / 4, ch = 88;
    tiles.forEach((t, i) => {
      const x = X + (i % 4) * (cw + 14), y = gy + Math.floor(i / 4) * (ch + 12);
      ctx.fillStyle = C.cell; roundRect(ctx, x, y, cw, ch, 10); ctx.fill();
      ctx.strokeStyle = C.cellB; ctx.lineWidth = 1.5; roundRect(ctx, x, y, cw, ch, 10); ctx.stroke();
      ctx.fillStyle = C.muted; ctx.font = font(11, 600);
      ctx.fillText(truncate(ctx, t.label, cw - 26), x + 14, y + 22);
      ctx.fillStyle = t.tone === 'ok' ? C.ok : t.tone === 'bad' ? '#FF4438' : t.tone === 'info' ? C.blue : C.text;
      ctx.font = font(20, 700, true);
      ctx.fillText(truncate(ctx, t.value, cw - 24), x + 14, y + 50);
      ctx.fillStyle = C.dim; ctx.font = font(10.5, 400);
      ctx.fillText(truncate(ctx, t.sub, cw - 24), x + 14, y + 72);
    });
  }

  // ── признаки риска (с адресами контрагентов) ─────────────────────────────
  const ry = 726, rh = 288;
  ctx.fillStyle = C.panel; roundRect(ctx, X, ry, Wc, rh, 12); ctx.fill();
  ctx.strokeStyle = '#1B1B20'; roundRect(ctx, X, ry, Wc, rh, 12); ctx.stroke();
  ctx.fillStyle = C.red; ctx.font = font(15, 800);
  ctx.fillText('// ПРИЗНАКИ РИСКА', X + 22, ry + 32);
  const riskScore = Math.min(100, (cr?.findings ?? []).reduce((n, f) => n + (f.severity === 'red' ? 22 : f.severity === 'yellow' ? 12 : f.severity === 'blue' ? 6 : 3), 0));
  const riskTxt = `${riskScore}/100`;
  ctx.font = font(14, 800);
  const riskChipX = X + 22 + ctx.measureText('// ПРИЗНАКИ РИСКА').width + 16;
  ctx.fillStyle = C.red; roundRect(ctx, riskChipX, ry + 12, 76, 26, 7); ctx.fill();
  ctx.fillStyle = '#FFFFFF';
  ctx.fillText(riskTxt, riskChipX + 38 - ctx.measureText(riskTxt).width / 2, ry + 30);

  let fy = ry + 62;
  const fyBottom = ry + rh - 14;
  for (const f of (cr?.findings ?? []).slice(0, 3)) {
    if (fy > fyBottom - 30) break;
    ctx.fillStyle = sevColor(f.severity);
    ctx.beginPath(); ctx.arc(X + 32, fy - 5, 5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = C.text; ctx.font = font(15.5, 700);
    ctx.fillText(truncate(ctx, f.title, Wc - 110), X + 48, fy);
    ctx.fillStyle = C.muted; ctx.font = font(12, 400);
    ctx.fillText(truncate(ctx, f.detail, Wc - 80), X + 48, fy + 18);
    fy += 40;
    for (const row of (f.addresses ?? []).slice(0, 2)) {
      if (fy > fyBottom - 20) { fy = fyBottom + 1; break; }
      ctx.fillStyle = C.row; roundRect(ctx, X + 48, fy - 10, Wc - 78, 23, 6); ctx.fill();
      ctx.font = font(12, 400, true);
      const addrTxt = short(row.addr, 10, 6);
      ctx.fillStyle = '#C9C9D2';
      ctx.fillText(addrTxt, X + 58, fy + 5);
      const addrW = ctx.measureText(addrTxt).width;
      if (row.label) {
        ctx.font = font(10, 700);
        const tag = truncate(ctx, row.label, 180);
        const tw = Math.min(200, ctx.measureText(tag).width + 16);
        const tagX = Math.min(X + 58 + addrW + 10, W - 88 - ctx.measureText(row.amounts ?? '').width - tw - 14);
        ctx.strokeStyle = C.red; ctx.lineWidth = 1;
        roundRect(ctx, tagX, fy - 6, tw, 18, 6); ctx.stroke();
        ctx.fillStyle = C.redHot;
        ctx.fillText(tag, tagX + 8, fy + 5);
      }
      if (row.amounts) {
        ctx.fillStyle = '#FF4438'; ctx.font = font(12, 700, true);
        ctx.fillText(row.amounts, W - 88 - ctx.measureText(row.amounts).width, fy + 5);
      }
      fy += 26;
    }
    fy += 8;
  }
  if (!(cr?.findings ?? []).length) {
    ctx.fillStyle = C.muted; ctx.font = font(13, 400);
    ctx.fillText('Явных признаков риска в выборке не найдено (эвристика).', X + 22, ry + 64);
  }

  // ── профиль поведения (5 баров, как в утверждённом макете) ───────────────
  if (cr?.classification) {
    const py = 1030;
    ctx.fillStyle = C.panel; roundRect(ctx, X, py, Wc, 124, 12); ctx.fill();
    ctx.strokeStyle = '#1B1B20'; roundRect(ctx, X, py, Wc, 124, 12); ctx.stroke();
    ctx.fillStyle = C.red; ctx.font = font(13.5, 800);
    ctx.fillText(`// ${truncate(ctx, cr.classification.title.toUpperCase(), Wc - 260)}`, X + 20, py + 26);
    const conf = `достоверность: ${cr.classification.confidence}`;
    ctx.fillStyle = C.dim; ctx.font = font(11.5, 400);
    ctx.fillText(conf, W - 60 - ctx.measureText(conf).width, py + 26);
    const s = cr.classification.scores as Record<string, number>;
    const bars: [string, number][] = [
      ['Раздача', s.fanout ?? 0],
      ['Автомат', s.auto ?? 0],
      ['Биржа/сервис', s.cexService ?? 0],
      ['Транзит', s.transit ?? 0],
      ['Личный', s.personal ?? 0],
    ];
    bars.forEach(([name, v], i) => {
      const y = py + 42 + i * 17;
      ctx.fillStyle = C.muted; ctx.font = font(11, 500);
      ctx.fillText(name, X + 20, y + 9);
      const bx = X + 140, bw = Wc - 210;
      ctx.fillStyle = '#17171C'; roundRect(ctx, bx, y + 2, bw, 7, 3.5); ctx.fill();
      redGrad(ctx, bx, y + 2, Math.max(5, bw * Math.min(100, v) / 100), 7, 3.5);
      ctx.fillStyle = C.text; ctx.font = font(12, 700, true);
      ctx.fillText(String(v), W - 78, y + 9);
    });
  }

  // ── AML · происхождение средств (exposure) + куда утекло ─────────────────
  const ay = 1170;
  ctx.fillStyle = C.panel; roundRect(ctx, X, ay, Wc, 128, 12); ctx.fill();
  ctx.strokeStyle = '#1B1B20'; roundRect(ctx, X, ay, Wc, 128, 12); ctx.stroke();
  ctx.fillStyle = C.red; ctx.font = font(13.5, 800);
  ctx.fillText('// AML · ПРОИСХОЖДЕНИЕ СРЕДСТВ', X + 20, ay + 26);
  const aml = cr?.aml;
  if (aml) {
    const expTxt = `EXPOSURE: ${levelRu(aml.level)}`;
    ctx.font = font(12, 800);
    const expW = ctx.measureText(expTxt).width + 24;
    ctx.strokeStyle = aml.level === 'clean' || aml.level === 'low' ? C.ok : aml.level === 'medium' ? C.amber : C.redHot;
    ctx.lineWidth = 1.2;
    roundRect(ctx, W - 80 - expW, ay + 12, expW, 22, 7); ctx.stroke();
    ctx.fillStyle = levelColorRu(aml.level);
    ctx.fillText(expTxt, W - 68 - expW, ay + 27);

    const cats = (aml.exposure ?? []).slice(0, 8);
    const colW = (Wc - 60) / 2;
    const tone = (t: string): string => (t === 'bad' ? '#FF4438' : t === 'blue' ? C.blue : t === 'warn' ? C.amber : '#6A6F85');
    cats.forEach((c, i) => {
      const cxx = X + 20 + (i % 2) * (colW + 20), cyy = ay + 46 + Math.floor(i / 2) * 16;
      ctx.fillStyle = C.muted; ctx.font = font(10.5, 500);
      ctx.fillText(truncate(ctx, c.ru.split(' (')[0], 130), cxx, cyy + 9);
      const barX = cxx + 138, barW = colW - 190;
      ctx.fillStyle = '#17171C'; roundRect(ctx, barX, cyy + 2, barW, 6, 3); ctx.fill();
      const fill = Math.max(3, barW * Math.sqrt(Math.min(100, c.pct) / 100));
      ctx.fillStyle = tone(c.tone); roundRect(ctx, barX, cyy + 2, fill, 6, 3); ctx.fill();
      ctx.fillStyle = tone(c.tone); ctx.font = font(10.5, 700, true);
      const pctTxt = `${c.pct.toFixed(2).replace('.', ',')}%`;
      ctx.fillText(pctTxt, cxx + colW - ctx.measureText(pctTxt).width, cyy + 9);
    });

    const outs = (aml.topOut ?? []).slice(0, 2);
    ctx.fillStyle = C.dim; ctx.font = font(11, 400);
    const leakTxt = outs.length
      ? `Куда ушло: ${outs.map((o) => `${short(o.addr, 8, 6)} ${o.usd !== undefined ? fmtUsd(o.usd) : `${fmt(o.amount)} ${o.asset}`} (${Math.round(o.share * 100)}%)${o.category && o.category !== 'personal' ? ` · ${categoryRu(o.category)}` : ''}`).join('  ·  ')}`
      : 'Куда ушло: крупных исходящих в выборке нет';
    ctx.fillText(truncate(ctx, leakTxt, Wc - 40), X + 20, ay + 120);
  } else {
    ctx.fillStyle = C.muted; ctx.font = font(12, 400);
    ctx.fillText('AML-оценка в этом отчёте не запрашивалась.', X + 20, ay + 60);
  }

  racingFooter(ctx, DISCLAIMER);

  return canvas.toDataURL('image/jpeg', 0.92);
}
