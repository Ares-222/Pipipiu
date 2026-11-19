// graphPhoto (№16, v7): «наглядная картина» расследования одним фото.
// Рисуем на canvas радар-композицию: красное ядро ЦЕЛИ, первое кольцо прямых
// контактов, внешний круг дальних связей; толщина/цвет стрелок = объём; подписи
// сумм на крупнейших потоках; легенда, структурные находки (пил-чейны, общие
// источники, мосты) и водяной знак. Рендер полностью в клиенте — воркер только
// пересылает JPEG в чат через /api/render (ноль CPU на free-тарифе).

import { CAT_COLORS, computeGraphVerdict, categoryIcon, fmt, type TraceResult, type GraphNode, type TraceResultLeak } from './api';

const W = 1200, H = 1560;
const BG = '#0b0d12', PANEL = '#12141c', TEXT = '#eceef2', MUTED = '#8a8f9c', AMBER = '#f5a623', RED = '#d40000';

function kf(n: number): string {
  const a = Math.abs(n);
  if (a >= 1e6) return `${(n / 1e6).toFixed(a >= 1e7 ? 0 : 1).replace('.', ',')}M`;
  if (a >= 1e3) return `${(n / 1e3).toFixed(a >= 1e4 ? 0 : 1).replace('.', ',')}k`;
  return fmt(n, 0);
}
function shortA(a: string, h = 6, t = 4): string {
  return a && a.length > h + t + 2 ? `${a.slice(0, h)}…${a.slice(-t)}` : a;
}
function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const t = cur ? `${cur} ${w}` : w;
    if (ctx.measureText(t).width > maxWidth && cur) { lines.push(cur); cur = w; } else cur = t;
    if (lines.length >= maxLines) break;
  }
  if (cur && lines.length < maxLines) lines.push(cur);
  if (lines.length === maxLines && words.length && !lines[maxLines - 1].endsWith('…')) lines[maxLines - 1] += '…';
  return lines.slice(0, maxLines);
}

export async function renderGraphPhoto(trace: TraceResult): Promise<string> {
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  const nodes = trace.nodes ?? [];
  const edges = trace.edges ?? [];

  // ---------- фон + шапка ----------
  const grad = ctx.createRadialGradient(W / 2, 300, 80, W / 2, 700, 1100);
  grad.addColorStop(0, '#141826');
  grad.addColorStop(1, BG);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = RED;
  ctx.fillRect(0, 0, W, 8);

  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = RED;
  ctx.font = '800 26px system-ui, sans-serif';
  ctx.fillText('ARES CRYPTO · РАССЛЕДОВАНИЕ', 48, 64);
  ctx.fillStyle = MUTED;
  ctx.font = '500 18px system-ui, sans-serif';
  const dt = new Date().toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  ctx.fillText(`${trace.chain.toUpperCase()} · глубина ${trace.depth} хопа · ${dt} UTC`, 48, 94);
  ctx.fillStyle = TEXT;
  ctx.font = '600 20px ui-monospace, monospace';
  ctx.fillText(shortA(trace.root, 12, 8), 48, 124);
  ctx.fillStyle = MUTED;
  ctx.font = '500 16px system-ui, sans-serif';
  ctx.fillText(`узлов ${nodes.length} · связей ${edges.length} · запросов ${trace.fetchesUsed}/30`, 48, 150);

  // ---------- вердикт ----------
  const verdict = computeGraphVerdict(nodes, trace.leaks ?? []);
  const vCol = verdict.tone === 'bad' ? RED : verdict.tone === 'warn' ? AMBER : '#22c55e';
  ctx.fillStyle = PANEL;
  ctx.strokeStyle = vCol;
  ctx.lineWidth = 2;
  roundRect(ctx, 48, 172, W - 96, 86, 16);
  ctx.fill(); ctx.stroke();
  ctx.font = '400 30px system-ui, sans-serif';
  ctx.fillStyle = TEXT;
  ctx.fillText(verdict.icon, 70, 228);
  ctx.font = '700 21px system-ui, sans-serif';
  ctx.fillStyle = vCol;
  ctx.fillText(verdict.title, 118, 216);
  ctx.font = '500 15px system-ui, sans-serif';
  ctx.fillStyle = MUTED;
  const vLines = wrapText(ctx, verdict.detail, W - 200, 1);
  ctx.fillText(vLines[0] ?? '', 118, 242);

  // ---------- раскладка: радар ----------
  const cx = W / 2, cy = 700;
  const R1 = 300, R2 = 470;
  const rootId = nodes.find((n) => n.isRoot)?.id;
  const hop1 = new Set<string>();
  for (const e of edges) {
    if (e.from === rootId && e.to !== rootId) hop1.add(e.to);
    if (e.to === rootId && e.from !== rootId) hop1.add(e.from);
  }
  const direct = nodes.filter((n) => !n.isRoot && hop1.has(n.id)).slice(0, 12);
  const far = nodes.filter((n) => !n.isRoot && !hop1.has(n.id)).slice(0, 18);
  const pos = new Map<string, { x: number; y: number; r: number; n: GraphNode }>();
  const ringAngles = (count: number) => Array.from({ length: count }, (_, i) => (Math.PI * 2 * i) / Math.max(1, count) - Math.PI / 2);
  direct.forEach((n, i) => {
    const a = ringAngles(direct.length)[i];
    pos.set(n.id, { x: cx + R1 * Math.cos(a), y: cy + R1 * Math.sin(a), r: nodeR(n, false), n });
  });
  far.forEach((n, i) => {
    const a = ringAngles(far.length)[i];
    pos.set(n.id, { x: cx + R2 * Math.cos(a), y: cy + R2 * Math.sin(a), r: nodeR(n, true), n });
  });
  if (rootId) pos.set(rootId, { x: cx, y: cy, r: 46, n: nodes.find((n) => n.isRoot)! });

  // ---------- рёбра ----------
  const topIdx = new Set(edges.map((e, i) => [e.amount, i] as const).sort((a, b) => b[0] - a[0]).slice(0, 10).map((x) => x[1]));
  edges.forEach((e, i) => {
    const a = pos.get(e.from), b = pos.get(e.to);
    if (!a || !b) return;
    const top = topIdx.has(i);
    const danger = (a.n.category && ['mixer', 'scam', 'sanctioned'].includes(a.n.category)) || (b.n.category && ['mixer', 'scam', 'sanctioned'].includes(b.n.category));
    ctx.strokeStyle = danger ? RED : top ? AMBER : '#3a4050';
    ctx.lineWidth = Math.min(7, 1.6 + Math.log10(Math.max(1, e.amount)) / 1.35);
    if (e.probable) ctx.setLineDash([7, 7]);
    ctx.globalAlpha = top || danger ? 0.95 : 0.55;
    const mx = (a.x + b.x) / 2 + (b.y - a.y) * 0.12;
    const my = (a.y + b.y) / 2 - (b.x - a.x) * 0.12;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.quadraticCurveTo(mx, my, b.x, b.y);
    ctx.stroke();
    ctx.setLineDash([]);
    // стрелка
    const ang = Math.atan2(b.y - my, b.x - mx);
    const ax = b.x - Math.cos(ang) * (b.r + 6), ay = b.y - Math.sin(ang) * (b.r + 6);
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(ax - Math.cos(ang - 0.42) * 12, ay - Math.sin(ang - 0.42) * 12);
    ctx.lineTo(ax - Math.cos(ang + 0.42) * 12, ay - Math.sin(ang + 0.42) * 12);
    ctx.closePath();
    ctx.fillStyle = ctx.strokeStyle;
    ctx.fill();
    // сумма на топ-рёбрах
    if (top && !danger) {
      ctx.font = '700 15px ui-monospace, monospace';
      ctx.fillStyle = '#ffd166';
      ctx.strokeStyle = BG;
      ctx.lineWidth = 4;
      const tx = mx, ty = my;
      ctx.strokeText(`${fmt(e.amount, 0)} ${e.asset}`, tx, ty);
      ctx.fillText(`${fmt(e.amount, 0)} ${e.asset}`, tx, ty);
    }
    ctx.globalAlpha = 1;
  });

  // ---------- узлы ----------
  ctx.font = '500 14px system-ui, sans-serif';
  for (const [, p] of pos) drawNode(ctx, p, rootId, hop1);

  // ---------- подписи колец ----------
  ctx.fillStyle = MUTED;
  ctx.font = '600 15px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('внешний круг — дальние связи (через посредников)', cx, cy + R2 + 74);
  ctx.fillText('первое кольцо — прямые контакты ЦЕЛИ', cx, cy + R1 + 70);
  ctx.textAlign = 'left';

  // ---------- структура: пил-чейны, общие источники, мосты ----------
  let sy = cy + R2 + 118;
  const findings = (trace.findings ?? []).slice(0, 3);
  if (findings.length) {
    ctx.fillStyle = PANEL;
    roundRect(ctx, 48, sy - 26, W - 96, 26 + findings.length * 30 + 14, 14);
    ctx.fill();
    ctx.strokeStyle = '#2a2f3c';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.font = '700 16px system-ui, sans-serif';
    ctx.fillStyle = AMBER;
    ctx.fillText('⛓ Структура графа', 70, sy);
    sy += 34;
    ctx.font = '500 15px system-ui, sans-serif';
    ctx.fillStyle = TEXT;
    for (const f of findings) {
      for (const line of wrapText(ctx, f, W - 150, 2)) {
        ctx.fillText(line, 70, sy);
        sy += 24;
      }
      sy += 6;
    }
  }

  // ---------- легенда ----------
  const legendCats = [...new Set(nodes.map((n) => n.category ?? 'personal'))];
  let ly = H - 210;
  ctx.font = '700 16px system-ui, sans-serif';
  ctx.fillStyle = MUTED;
  ctx.fillText('ЛЕГЕНДА', 48, ly - 16);
  let lx = 48;
  ctx.font = '500 14px system-ui, sans-serif';
  for (const cat of legendCats.slice(0, 8)) {
    const label = `${categoryIcon(cat)} ${ruCat(cat)} ×${nodes.filter((n) => (n.category ?? 'personal') === cat).length}`;
    const wpx = ctx.measureText(label).width + 40;
    if (lx + wpx > W - 48) { lx = 48; ly += 40; }
    ctx.fillStyle = PANEL;
    roundRect(ctx, lx, ly - 20, wpx, 30, 15);
    ctx.fill();
    ctx.fillStyle = CAT_COLORS[cat] ?? '#9CA3AF';
    ctx.beginPath();
    ctx.arc(lx + 16, ly - 5, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = TEXT;
    ctx.fillText(label, lx + 30, ly);
    lx += wpx + 12;
  }

  // ---------- глиф-подсказки + футер ----------
  ctx.font = '500 14px system-ui, sans-serif';
  ctx.fillStyle = MUTED;
  ctx.fillText('⭕ размер = оборот · ➜ толщина = сумма · янтарные стрелки = крупнейшие потоки · пунктир = вероятная связь (unmix)', 48, H - 96);
  ctx.fillStyle = '#565c68';
  ctx.font = '500 13px system-ui, sans-serif';
  ctx.fillText('Ares Crypto-Analytics · публичные блокчейн-данные · вероятностные оценки, не доказательство', 48, H - 60);

  return canvas.toDataURL('image/jpeg', 0.92);
}

function nodeR(n: GraphNode, far: boolean): number {
  const base = 14 + Math.sqrt(Math.max(1, n.volume)) * 0.16;
  return Math.max(far ? 12 : 20, Math.min(far ? 26 : 40, base));
}

function drawNode(ctx: CanvasRenderingContext2D, p: { x: number; y: number; r: number; n: GraphNode }, rootId?: string, hop1?: Set<string>): void {
  const { x, y, r, n } = p;
  const isRoot = !!n.isRoot || n.id === rootId;
  const color = isRoot ? RED : (CAT_COLORS[n.category ?? 'personal'] ?? '#9CA3AF');
  if (isRoot) {
    ctx.save();
    ctx.shadowColor = RED;
    ctx.shadowBlur = 34;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    ctx.font = '700 26px system-ui, sans-serif';
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.fillText('🎯', x, y + 9);
    ctx.textAlign = 'left';
    ctx.font = '800 17px system-ui, sans-serif';
    ctx.fillStyle = '#ff8080';
    ctx.textAlign = 'center';
    ctx.fillText('ЦЕЛЬ', x, y + r + 26);
    ctx.textAlign = 'left';
    return;
  }
  const dim = !hop1?.has(n.id);
  ctx.globalAlpha = dim ? 0.85 : 1;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = hop1?.has(n.id) ? 3 : 1.4;
  ctx.strokeStyle = hop1?.has(n.id) ? color : '#3a4050';
  ctx.stroke();
  ctx.globalAlpha = 1;
  // тег пил-чейна / общего источника — маленькое кольцо-«звёздочка» сверху
  if (n.peel || n.assoc) {
    ctx.fillStyle = n.peel ? AMBER : '#38bdf8';
    ctx.beginPath();
    ctx.arc(x + r * 0.7, y - r * 0.7, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.font = '700 11px system-ui, sans-serif';
    ctx.fillStyle = BG;
    ctx.textAlign = 'center';
    ctx.fillText(n.peel ? '⛓' : '🔗', x + r * 0.7, y - r * 0.7 + 4);
    ctx.textAlign = 'left';
  }
  // подпись
  const icon = categoryIcon(n.category);
  const name = n.label ? (n.label.length > 16 ? `${n.label.slice(0, 15)}…` : n.label) : shortA(n.addr, 6, 4);
  const q = n.probable && !n.label?.endsWith('?') ? ' ?' : '';
  ctx.font = '600 15px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.strokeStyle = BG;
  ctx.lineWidth = 4;
  ctx.fillStyle = TEXT;
  ctx.strokeText(`${icon} ${name}${q}`, x, y + r + 22);
  ctx.fillText(`${icon} ${name}${q}`, x, y + r + 22);
  if (hop1?.has(n.id)) {
    ctx.font = '500 12.5px ui-monospace, monospace';
    ctx.fillStyle = MUTED;
    ctx.strokeText(`вх ${kf(n.in)} · вых ${kf(n.out)}`, x, y + r + 40);
    ctx.fillText(`вх ${kf(n.in)} · вых ${kf(n.out)}`, x, y + r + 40);
  }
  ctx.textAlign = 'left';
}

function ruCat(cat: string): string {
  return ({
    cex: 'Биржа', tgbots: 'TG-бот', service: 'Сервис/биржа?', payment: 'Платёжный', bridge: 'Мост',
    mixer: 'Миксер', scam: 'Скам', sanctioned: 'Санкц.', contract: 'Контракт', token: 'Токен', personal: 'Без метки',
  } as Record<string, string>)[cat] ?? cat;
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

// Заглушка-экспорт для типизации leak-коллекции (фото потока вынесено в flowPhoto).
export type LeakLike = TraceResultLeak;
