// flowPhoto (№17, v7): «куда уходят деньги» одним фото — схема корень → конечные
// точки. Тот же язык, что в PDF, но крупно и в чат: толщина стрелки = доля,
// красные стрелки = рисковые получатели, % и суммы на каждой стрелке.
// Рендер в клиенте (ноль CPU воркера), доставка через /api/render.

import { categoryIcon, categoryRuFull, fmt, short, type TraceResult, type TraceResultLeak } from './api';

const W = 1200, H = 1120;
const BG = '#0b0d12', PANEL = '#12141c', TEXT = '#eceef2', MUTED = '#8a8f9c', AMBER = '#f5a623', RED = '#d40000', GREEN = '#22c55e';
const DANGER = new Set(['mixer', 'scam', 'sanctioned']);

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function shorten(s: string, n: number): string {
  return s && s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

export async function renderFlowPhoto(trace: TraceResult): Promise<string> {
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d')!;

  const grad = ctx.createRadialGradient(W / 2, 200, 60, W / 2, 500, 1000);
  grad.addColorStop(0, '#141826');
  grad.addColorStop(1, BG);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = RED;
  ctx.fillRect(0, 0, W, 8);

  // ---------- шапка ----------
  ctx.fillStyle = RED;
  ctx.font = '800 26px system-ui, sans-serif';
  ctx.fillText('ПОТОК СРЕДСТВ · КОРЕНЬ → КОНЕЧНЫЕ ТОЧКИ', 48, 62);
  ctx.fillStyle = MUTED;
  ctx.font = '500 17px system-ui, sans-serif';
  const dt = new Date().toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  ctx.fillText(`${trace.chain.toUpperCase()} · ${dt} UTC`, 48, 92);
  ctx.fillStyle = TEXT;
  ctx.font = '600 19px ui-monospace, monospace';
  ctx.fillText(short(trace.root, 14, 10), 48, 120);

  const leaks: TraceResultLeak[] = (trace.leaks ?? []).slice(0, 8);
  const totalOut = leaks.reduce((s, l) => s + l.amount, 0) || 1;

  // ---------- корень ----------
  const boxW = 300, boxH = 96;
  const rootX = 64, rootY = H / 2 - boxH / 2 - 20;
  ctx.save();
  ctx.shadowColor = RED;
  ctx.shadowBlur = 26;
  ctx.fillStyle = '#1a1c24';
  roundRect(ctx, rootX, rootY, boxW, boxH, 18);
  ctx.fill();
  ctx.restore();
  ctx.strokeStyle = RED;
  ctx.lineWidth = 3;
  roundRect(ctx, rootX, rootY, boxW, boxH, 18);
  ctx.stroke();
  ctx.fillStyle = TEXT;
  ctx.font = '800 22px system-ui, sans-serif';
  ctx.fillText('🎯 ЦЕЛЬ', rootX + 20, rootY + 40);
  ctx.fillStyle = MUTED;
  ctx.font = '500 14px ui-monospace, monospace';
  ctx.fillText(short(trace.root, 12, 8), rootX + 20, rootY + 66);
  ctx.fillStyle = GREEN;
  ctx.font = '600 14px system-ui, sans-serif';
  ctx.fillText(`исходящий объём: ${fmt(totalOut, 0)} ${leaks[0]?.asset ?? ''}`, rootX + 20, rootY + 86);

  // ---------- конечные точки ----------
  const leakX = W - 64 - 380;
  const boxLW = 380, boxLH = 74;
  const top = 210;
  const gap = (H - top - 120 - leaks.length * boxLH) / Math.max(1, leaks.length - 1);
  const rootCx = rootX + boxW, rootCy = rootY + boxH / 2;

  leaks.forEach((l, i) => {
    const ly = top + i * (boxLH + Math.max(14, gap));
    const danger = DANGER.has(l.category ?? '');
    const col = danger ? RED : AMBER;
    const shareW = Math.max(10, (l.share / (leaks[0]?.share || 1)) * 260);

    // стрелка: толщина = доля
    const fromY = rootCy + (i - (leaks.length - 1) / 2) * 18;
    ctx.strokeStyle = danger ? RED : col;
    ctx.globalAlpha = danger ? 0.95 : 0.8;
    ctx.lineWidth = Math.max(3, l.share * 34);
    ctx.beginPath();
    ctx.moveTo(rootCx + 8, fromY);
    ctx.quadraticCurveTo(rootCx + (leakX - rootCx) / 2, fromY, leakX - 20, ly + boxLH / 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
    // наконечник
    const ang = Math.atan2(ly + boxLH / 2 - fromY, leakX - 20 - (rootCx + (leakX - rootCx) / 2));
    const hx = leakX - 16, hy = ly + boxLH / 2;
    ctx.beginPath();
    ctx.moveTo(hx, hy);
    ctx.lineTo(hx - Math.cos(ang - 0.45) * 14, hy - Math.sin(ang - 0.45) * 14);
    ctx.lineTo(hx - Math.cos(ang + 0.45) * 14, hy - Math.sin(ang + 0.45) * 14);
    ctx.closePath();
    ctx.fillStyle = danger ? RED : col;
    ctx.fill();

    // % на стрелке
    ctx.fillStyle = danger ? '#ff9090' : '#ffd166';
    ctx.font = '700 16px ui-monospace, monospace';
    ctx.fillText(`${Math.round(l.share * 100)}%`, rootCx + 90, (fromY + ly + boxLH / 2) / 2 - 8);

    // бокс получателя
    ctx.fillStyle = '#14161d';
    roundRect(ctx, leakX, ly, boxLW, boxLH, 14);
    ctx.fill();
    ctx.strokeStyle = danger ? RED : '#2a2f3c';
    ctx.lineWidth = danger ? 2.4 : 1.4;
    roundRect(ctx, leakX, ly, boxLW, boxLH, 14);
    ctx.stroke();
    ctx.fillStyle = TEXT;
    ctx.font = '700 16px system-ui, sans-serif';
    ctx.fillText(`${categoryIcon(l.category)} ${shorten(categoryRuFull(l.category, l.probable), 24)}`, leakX + 16, ly + 28);
    ctx.fillStyle = MUTED;
    ctx.font = '500 12.5px ui-monospace, monospace';
    ctx.fillText(`${short(l.addr, 8, 6)}${l.label && !l.label.endsWith('?') ? ` · ${shorten(l.label, 16)}` : ''}`, leakX + 16, ly + 50);
    // сумма + бар
    ctx.fillStyle = TEXT;
    ctx.font = '700 14px ui-monospace, monospace';
    const sumTxt = `${fmt(l.amount, 1)} ${l.asset}`;
    ctx.fillText(sumTxt, leakX + 16, ly + boxLH - 10);
    ctx.fillStyle = '#1f2430';
    roundRect(ctx, leakX + 110, ly + boxLH - 20, 200, 9, 4);
    ctx.fill();
    ctx.fillStyle = danger ? RED : col;
    roundRect(ctx, leakX + 110, ly + boxLH - 20, Math.max(8, shareW * (200 / 260)), 9, 4);
    ctx.fill();
    ctx.fillStyle = MUTED;
    ctx.font = '600 13px system-ui, sans-serif';
    ctx.fillText(`№${i + 1}`, leakX + boxLW - 34, ly + boxLH - 10);
  });

  if (!leaks.length) {
    ctx.fillStyle = MUTED;
    ctx.font = '500 18px system-ui, sans-serif';
    ctx.fillText('Исходящих переводов в выборке нет — адрес не отправлял средства за наблюдаемое окно.', 64, H / 2);
  }

  // ---------- легенда + футер ----------
  ctx.fillStyle = MUTED;
  ctx.font = '500 14px system-ui, sans-serif';
  ctx.fillText('➜ толщина стрелки = доля исходящего объёма · красные = рисковые получатели (миксер/скам/санкции) · № = ранг по объёму', 48, H - 96);
  ctx.fillStyle = '#565c68';
  ctx.font = '500 13px system-ui, sans-serif';
  ctx.fillText('Ares Crypto-Analytics · публичные блокчейн-данные · вероятностные оценки, не доказательство', 48, H - 60);

  return canvas.toDataURL('image/jpeg', 0.92);
}
