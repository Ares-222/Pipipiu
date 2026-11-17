import { fmt, short, type ChainReport, type Tx } from '../api';

const C = {
  bg: '#0A0A0B', panel: '#131315', border: '#29292F', red: '#D40000',
  text: '#F2F2F3', muted: '#8A8A90', incoming: '#55D6BE', outgoing: '#FF9E42',
};

const CATEGORY_RU: Record<string, string> = {
  cex: 'Биржа', payment: 'Платёжный сервис', mixer: 'Миксер', bridge: 'Мост',
  scam: 'Скам/фишинг', sanctioned: 'Санкционный адрес', contract: 'Смарт-контракт',
  service: 'Сервис', personal: 'Личный адрес',
};

interface AssetFlow {
  amount: number;
  symbol: string;
}

interface PeerFlow {
  address: string;
  direction: 'in' | 'out';
  txHashes: Set<string>;
  assets: Map<string, AssetFlow>;
  label?: Tx['labelFrom'];
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

function fitText(ctx: CanvasRenderingContext2D, value: string, maxWidth: number): string {
  if (ctx.measureText(value).width <= maxWidth) return value;
  let text = value;
  while (text.length > 2 && ctx.measureText(`${text}…`).width > maxWidth) text = text.slice(0, -1);
  return `${text}…`;
}

function addArrow(ctx: CanvasRenderingContext2D, sx: number, sy: number, ex: number, ey: number, color: string, width: number): void {
  const cx = (sx + ex) / 2;
  const cy = (sy + ey) / 2 + Math.sign(ey - sy || 1) * 16;
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.globalAlpha = 0.82;
  ctx.beginPath();
  ctx.moveTo(sx, sy);
  ctx.quadraticCurveTo(cx, cy, ex, ey);
  ctx.stroke();
  const angle = Math.atan2(ey - cy, ex - cx);
  const head = 13 + width;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(ex, ey);
  ctx.lineTo(ex - head * Math.cos(angle - Math.PI / 6), ey - head * Math.sin(angle - Math.PI / 6));
  ctx.lineTo(ex - head * Math.cos(angle + Math.PI / 6), ey - head * Math.sin(angle + Math.PI / 6));
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = 1;
}

function peerFlows(cr: ChainReport): { incoming: PeerFlow[]; outgoing: PeerFlow[] } {
  const root = cr.account.addr.toLowerCase();
  const peers = new Map<string, PeerFlow>();
  for (const tx of cr.txs) {
    if (tx.direction !== 'in' && tx.direction !== 'out') continue;
    const address = tx.direction === 'in' ? tx.from : tx.to;
    if (!address || address.toLowerCase() === root) continue;
    const key = `${tx.direction}:${address.toLowerCase()}`;
    let peer = peers.get(key);
    if (!peer) {
      peer = { address, direction: tx.direction, txHashes: new Set(), assets: new Map() };
      peers.set(key, peer);
    }
    if (tx.hash) peer.txHashes.add(tx.hash);
    const asset = tx.asset || 'неизвестный актив';
    const flow = peer.assets.get(asset) ?? { amount: 0, symbol: asset };
    flow.amount += tx.amount;
    peer.assets.set(asset, flow);
    const label = tx.direction === 'in' ? tx.labelFrom : tx.labelTo;
    if (!peer.label && label?.name) peer.label = label;
  }
  const sort = (a: PeerFlow, b: PeerFlow) => b.txHashes.size - a.txHashes.size;
  return {
    incoming: [...peers.values()].filter((p) => p.direction === 'in').sort(sort),
    outgoing: [...peers.values()].filter((p) => p.direction === 'out').sort(sort),
  };
}

function drawPeer(ctx: CanvasRenderingContext2D, peer: PeerFlow, x: number, y: number, maxWidth: number): void {
  if (peer.label?.name) {
    const category = CATEGORY_RU[peer.label.category] ?? peer.label.category;
    ctx.fillStyle = C.red;
    ctx.font = '700 20px Inter, Arial, sans-serif';
    ctx.fillText(fitText(ctx, `${peer.label.name} · ${category} · ${peer.label.confidence}`, maxWidth), x, y - 23);
  } else {
    ctx.fillStyle = C.muted;
    ctx.font = '600 16px Inter, Arial, sans-serif';
    ctx.fillText('Публичная метка не найдена', x, y - 23);
  }

  ctx.fillStyle = C.text;
  ctx.font = '600 21px "JetBrains Mono", monospace';
  ctx.fillText(fitText(ctx, short(peer.address, 13, 8), maxWidth), x, y + 2);

  const assets = [...peer.assets.values()].sort((a, b) => a.symbol.localeCompare(b.symbol));
  const assetText = assets.slice(0, 2).map((a) => `${a.symbol} ${fmt(a.amount, 6)}`).join(' · ');
  const rest = assets.length > 2 ? ` · +${assets.length - 2} актив.` : '';
  ctx.fillStyle = C.muted;
  ctx.font = '16px Inter, Arial, sans-serif';
  ctx.fillText(fitText(ctx, `${assetText}${rest}`, maxWidth), x, y + 27);
  ctx.fillText(`${peer.txHashes.size} уник. транзакц.`, x, y + 50);
}

export function renderDirectFlowGraph(cr: ChainReport): string {
  const canvas = document.createElement('canvas');
  canvas.width = 1800;
  canvas.height = 1200;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Не удалось подготовить граф потоков');

  const W = canvas.width;
  const H = canvas.height;
  const { incoming, outgoing } = peerFlows(cr);
  const shownIn = incoming.slice(0, 6);
  const shownOut = outgoing.slice(0, 6);
  const maxCount = Math.max(1, ...shownIn.map((p) => p.txHashes.size), ...shownOut.map((p) => p.txHashes.size));

  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = C.red;
  ctx.fillRect(0, 0, 14, H);
  ctx.fillStyle = C.red;
  ctx.font = '700 20px Inter, Arial, sans-serif';
  ctx.fillText('ARES CRYPTO  /  ПРЯМЫЕ ПОТОКИ', 64, 72);
  ctx.fillStyle = C.text;
  ctx.font = '700 38px Inter, Arial, sans-serif';
  ctx.fillText(`Вариант A · ${cr.chain.toUpperCase()}`, 64, 126);
  ctx.fillStyle = C.muted;
  ctx.font = '18px "JetBrains Mono", monospace';
  ctx.fillText(fitText(ctx, `${cr.account.addr} · ${cr.txs.length} записей в отчёте`, W - 128), 64, 164);

  roundRect(ctx, 42, 205, 710, 885, 24);
  ctx.fillStyle = C.panel;
  ctx.fill();
  ctx.strokeStyle = C.border;
  ctx.lineWidth = 2;
  ctx.stroke();
  roundRect(ctx, 1048, 205, 710, 885, 24);
  ctx.fillStyle = C.panel;
  ctx.fill();
  ctx.strokeStyle = C.border;
  ctx.stroke();

  ctx.fillStyle = C.incoming;
  ctx.font = '700 22px Inter, Arial, sans-serif';
  ctx.fillText('ВХОДЯЩИЕ  /  КОНТРАГЕНТЫ', 82, 258);
  ctx.fillStyle = C.outgoing;
  ctx.fillText('ИСХОДЯЩИЕ  /  КОНТРАГЕНТЫ', 1088, 258);

  const rowY = (i: number, count: number) => count <= 1 ? 580 : 320 + i * (500 / (count - 1));
  shownIn.forEach((peer, i) => {
    const y = rowY(i, shownIn.length);
    addArrow(ctx, 694, y, 770, 600, C.incoming, 2 + 4 * Math.sqrt(peer.txHashes.size / maxCount));
    drawPeer(ctx, peer, 82, y, 570);
  });
  shownOut.forEach((peer, i) => {
    const y = rowY(i, shownOut.length);
    addArrow(ctx, 1030, 600, 1100, y, C.outgoing, 2 + 4 * Math.sqrt(peer.txHashes.size / maxCount));
    drawPeer(ctx, peer, 1088, y, 600);
  });

  roundRect(ctx, 770, 520, 260, 160, 22);
  ctx.fillStyle = '#1B1B1F';
  ctx.fill();
  ctx.strokeStyle = C.red;
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.fillStyle = C.red;
  ctx.font = '700 18px Inter, Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('ЦЕЛЕВОЙ КОШЕЛЁК', 900, 565);
  ctx.fillStyle = C.text;
  ctx.font = '600 16px "JetBrains Mono", monospace';
  ctx.fillText(fitText(ctx, short(cr.account.addr, 11, 8), 230), 900, 605);
  ctx.fillStyle = C.muted;
  ctx.font = '15px Inter, Arial, sans-serif';
  ctx.fillText(cr.chain.toUpperCase(), 900, 642);
  ctx.textAlign = 'left';

  if (!shownIn.length) {
    ctx.fillStyle = C.muted;
    ctx.font = '18px Inter, Arial, sans-serif';
    ctx.fillText('Нет входящих транзакций в выборке.', 82, 315);
  }
  if (!shownOut.length) {
    ctx.fillStyle = C.muted;
    ctx.font = '18px Inter, Arial, sans-serif';
    ctx.fillText('Нет исходящих транзакций в выборке.', 1088, 315);
  }

  ctx.fillStyle = C.muted;
  ctx.font = '15px Inter, Arial, sans-serif';
  const omitted = `Показаны до 6 контрагентов на направление; стрелки отражают число уникальных transaction hash. В графе — только операции, возвращённые отчётом.`;
  ctx.fillText(fitText(ctx, omitted, W - 128), 64, 1144);
  const labelsNote = `Если подпись отсутствует, указано «Публичная метка не найдена»; это не является оценкой риска.`;
  ctx.fillText(fitText(ctx, labelsNote, W - 128), 64, 1172);

  return canvas.toDataURL('image/jpeg', 0.94);
}
