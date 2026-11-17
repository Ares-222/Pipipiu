// Рендер и доставка «продуктовых» артефактов в чат заказчика:
//  1) WalletReport по адресу (тот же buildWalletReport, что в боте)
//  2) фото-карточка 1080×1350 (miniapp/src/card/card.ts) через Playwright chromium
//  3) полный PDF A4 (miniapp/src/pdf/makePdf.ts, jsPDF + DejaVuSans)
//  4) sendPhoto + sendDocument в чат админа; файлы также кладутся в download/
//  5) демо меток 🏷 на адресе из фидов (OFAC/ScamSniffer)
// Run: node scripts/render-deliverables.ts [ADDR]

import { chromium } from 'playwright';
import { build } from 'esbuild';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeSandbox } from './sandbox.ts';
import { BotApi } from '../worker/src/tg/bot.ts';
import { buildWalletReport } from '../worker/src/service/report.ts';
import { renderReport } from '../worker/src/tg/formatter.ts';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const RENDER = path.join(ROOT, '.render');
const DL = path.join(path.dirname(ROOT), 'download');
const ADDR = process.argv[2] ?? 'TRKhSYVuCmNLn8a6ghuqCJ4X83usLpffF8';
const PORT = 8791;

const MIME: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.ttf': 'font/ttf', '.json': 'application/json' };

function serve(dir: string): Promise<void> {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      const p = path.join(dir, decodeURIComponent((req.url ?? '/').split('?')[0]));
      const f = p.endsWith('/') ? path.join(p, 'harness.html') : p;
      if (!f.startsWith(dir) || !fs.existsSync(f)) { res.writeHead(404); res.end('nf'); return; }
      res.writeHead(200, { 'content-type': MIME[path.extname(f)] ?? 'application/octet-stream' });
      res.end(fs.readFileSync(f));
    });
    srv.listen(PORT, '127.0.0.1', () => { resolve(); (srv as unknown as { _srv: true })._srv = true; });
  });
}

async function main(): Promise<void> {
  fs.mkdirSync(RENDER, { recursive: true });
  fs.mkdirSync(DL, { recursive: true });
  const short = ADDR.slice(0, 10);
  const { ctx, registry } = makeSandbox();
  const api = new BotApi(ctx);

  console.log(`== отчёт ${ADDR} ==`);
  const report = await buildWalletReport(ctx, registry, ADDR);
  console.log(`verdict ${report.verdict.score}/100 · chains: ${report.chains.map((c) => c.chain).join(',')} · txs: ${report.chains[0]?.txs.length ?? 0}`);

  // bundle harness (card + pdf) for the browser
  await build({
    entryPoints: [path.join(ROOT, 'scripts', 'render-harness.ts')],
    bundle: true, format: 'iife', target: 'chrome120', minify: false, logLevel: 'silent',
    outfile: path.join(RENDER, 'bundle.js'),
  });
  fs.copyFileSync(path.join(ROOT, 'miniapp', 'public', 'fonts', 'DejaVuSans.ttf'), path.join(RENDER, 'DejaVuSans.ttf'));
  fs.writeFileSync(path.join(RENDER, 'harness.html'),
    `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0">
     <script>window.Telegram={WebApp:{initData:'',initDataUnsafe:{},ready(){},expand(){},setHeaderColor(){},setBackgroundColor(){},BackButton:{show(){},hide(){},onClick(){}},HapticFeedback:{impactOccurred(){}}},ARES_CONFIG:{apiBase:''}};</script>
     <script src="/bundle.js"></script></body></html>`);
  // makePdf fetches ./fonts/DejaVuSans.ttf relative to the page
  fs.mkdirSync(path.join(RENDER, 'fonts'), { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'miniapp', 'public', 'fonts', 'DejaVuSans.ttf'), path.join(RENDER, 'fonts', 'DejaVuSans.ttf'));

  await serve(RENDER);
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1200, height: 1600 } });
  await page.goto(`http://127.0.0.1:${PORT}/harness.html`);
  await page.evaluate((rep) => { (window as { __REPORT?: unknown }).__REPORT = rep; }, JSON.parse(JSON.stringify(report)));
  const out = await page.evaluate('window.__renderAll()') as { jpeg: string; pdf: string; err?: string };
  await browser.close();
  if (out.err) throw new Error(`harness error: ${out.err}`);
  if (!out.jpeg || !out.pdf) throw new Error('пустой вывод рендера');

  const jpegBytes = Buffer.from(out.jpeg.split(',')[1] ?? out.jpeg, 'base64');
  const pdfBytes = Buffer.from(out.pdf, 'base64');
  const jpgPath = path.join(DL, `ares-photo-card-${short}.jpg`);
  const pdfPath = path.join(DL, `ares-report-${short}.pdf`);
  fs.writeFileSync(jpgPath, jpegBytes);
  fs.writeFileSync(pdfPath, pdfBytes);
  console.log(`card: ${jpgPath} (${Math.round(jpegBytes.length / 1024)} КБ)`);
  console.log(`pdf : ${pdfPath} (${Math.round(pdfBytes.length / 1024)} КБ)`);

  // deliver to the customer's chat
  await api.sendPhoto(ctx.cfg.adminId, new Uint8Array(jpegBytes), `🖼 <b>Фото-карточка</b> · ${short}… — визуальная выжимка: вердикт ${report.verdict.score}/100, KPI, признаки риска, профиль поведения.`);
  await api.sendDocument(ctx.cfg.adminId, new Uint8Array(pdfBytes), `ares-report-${short}.pdf`, `📄 <b>Полный PDF-отчёт</b> · ${short}… — балансы, транзакции, метки, находки, AML, профиль. Готов к правкам.`);
  console.log('-- sendPhoto/sendDocument ок');

  // labels demo: show 🏷 on an address that actually carries a label (feeds)
  const labels = await ctx.db.listLabels(40);
  const demo = labels.find((l) => l.chain === 'eth' && l.category !== 'token') ?? labels[0];
  if (demo) {
    console.log(`== демо меток: ${demo.chain}:${demo.addr} → ${demo.name} (${demo.category}/${demo.confidence}) ==`);
    try {
      const rep2 = await buildWalletReport(ctx, registry, demo.addr);
      const parts = renderReport(rep2);
      await api.sendMessage(ctx.cfg.adminId, `🏷 <b>Демонстрация меток «биржа/сервис»</b> — вот как выглядит отчёт адреса, который есть в базах меток (OFAC/ScamSniffer). У твоего адреса контрагенты — безымянные личные кошельки, поэтому меток не было.\n\n${parts.join('\n')}`, undefined);
      console.log('-- демо-отчёт с метками отправлен');
    } catch (e) { console.log(`демо-отчёт пропущен: ${(e as Error).message}`); }
  } else console.log('меток в базе нет');

  console.log('DONE');
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
