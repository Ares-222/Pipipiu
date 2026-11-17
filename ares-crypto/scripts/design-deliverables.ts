// Дизайн-пакет: рендер 2 карточек (Playwright) + 2 PDF (jsPDF) и доставка в чат
// с подписями «1»/«2». Файлы также кладутся в download/.
// Run: node scripts/design-deliverables.ts

import { chromium } from 'playwright';
import { build } from 'esbuild';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeSandbox } from './sandbox.ts';
import { BotApi } from '../worker/src/tg/bot.ts';
import { makePdfV1, makePdfV2 } from './design-pdf.ts';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const RENDER = path.join(ROOT, '.render');
const DL = path.join(path.dirname(ROOT), 'download');
const PORT = 8792;

const MIME: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript' };

function serve(dir: string): Promise<void> {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      const f = path.join(dir, decodeURIComponent((req.url ?? '/').split('?')[0]).replace(/^\//, '') || 'harness.html');
      if (!f.startsWith(dir) || !fs.existsSync(f)) { res.writeHead(404); res.end('nf'); return; }
      res.writeHead(200, { 'content-type': MIME[path.extname(f)] ?? 'application/octet-stream' });
      res.end(fs.readFileSync(f));
    });
    srv.listen(PORT, '127.0.0.1', () => resolve());
  });
}

async function main(): Promise<void> {
  fs.mkdirSync(RENDER, { recursive: true });
  fs.mkdirSync(DL, { recursive: true });
  const { ctx } = makeSandbox();
  const api = new BotApi(ctx);

  // 1) карточки через headless-браузер
  await build({
    entryPoints: [path.join(ROOT, 'scripts', 'design-harness.ts')],
    bundle: true, format: 'iife', target: 'chrome120', logLevel: 'silent',
    outfile: path.join(RENDER, 'design-bundle.js'),
  });
  fs.writeFileSync(path.join(RENDER, 'harness.html'),
    `<!doctype html><html><head><meta charset="utf-8"><style>
     @font-face { font-family:'DejaVu Sans'; src: local('DejaVu Sans'); }
     body { font-family:'Inter','DejaVu Sans',sans-serif; }
     </style></head><body style="margin:0"><script src="/design-bundle.js"></script></body></html>`);
  await serve(RENDER);
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1200, height: 1600 } });
  page.on('pageerror', (e) => console.error('PAGE ERROR:', e.message));
  page.on('console', (m) => { if (m.type() === 'error') console.error('CONSOLE:', m.text()); });
  await page.goto(`http://127.0.0.1:${PORT}/harness.html`);
  const probe = await page.evaluate('typeof window.__renderV1');
  console.log('probe __renderV1:', probe);
  for (const v of ['V1', 'V2']) {
    const url = await page.evaluate(`window.__render${v}()`) as string;
    const bytes = Buffer.from(url.split(',')[1], 'base64');
    const f = path.join(DL, `ares-design-${v}-card.jpg`);
    fs.writeFileSync(f, bytes);
    console.log(`${v}: ${f} (${Math.round(bytes.length / 1024)} КБ)`);
  }
  await browser.close();

  // 2) PDF в двух стилях
  for (const [name, gen] of [['V1', makePdfV1], ['V2', makePdfV2]] as const) {
    const bytes = gen();
    const f = path.join(DL, `ares-design-${name}-report.pdf`);
    fs.writeFileSync(f, bytes);
    console.log(`PDF ${name}: ${f} (${Math.round(bytes.length / 1024)} КБ)`);
  }

  // 3) доставка: подписи 1 и 2
  const captions: Record<string, string> = {
    V1: `<b>1️⃣ «Дашборд-панель»</b> — плотная компоновка по твоему референсу: 8 KPI, риски с точками и суммами, профиль-бары. Тёмно-синяя база + фирменный красный. Данные условные (DEMO).`,
    V2: `<b>2️⃣ «Статус-карта»</b> — премиум: кольцо вердикта, спарклайн активности, AML-чипы источников, «куда утекло» с долями. Градиент + свечение. Данные условные (DEMO).`,
  };
  await api.sendPhoto(ctx.cfg.adminId, new Uint8Array(fs.readFileSync(path.join(DL, 'ares-design-V1-card.jpg'))), captions.V1);
  await api.sendPhoto(ctx.cfg.adminId, new Uint8Array(fs.readFileSync(path.join(DL, 'ares-design-V2-card.jpg'))), captions.V2);
  await api.sendDocument(ctx.cfg.adminId, new Uint8Array(fs.readFileSync(path.join(DL, 'ares-design-V1-report.pdf'))), 'ares-design-1-dashboard.pdf', '📄 <b>PDF №1 «Дашборд»</b> — тёмные панели, цветные KPI, таблицы рисков/транзитности/AML (2 стр. A4, DEMO).');
  await api.sendDocument(ctx.cfg.adminId, new Uint8Array(fs.readFileSync(path.join(DL, 'ares-design-V2-report.pdf'))), 'ares-design-2-premium.pdf', '📄 <b>PDF №2 «Премиум»</b> — тёмная обложка с кольцом вердикта + светлая детализация с красным акцентом (2 стр. A4, DEMO).');
  console.log('-- 4 файла отправлены в чат (sendPhoto ×2, sendDocument ×2)');
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
