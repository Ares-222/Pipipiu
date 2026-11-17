// Живой e2e: реальный адрес через бесплатные API → карточка + PDF (превью файлов).
// Telegram-доставка не выполняется (токен не нужен для этого теста).
// Run: ARES_DB_DUMP=/home/z/my-project/ares-crypto/.sandbox-db.json node scripts/render-live.ts [ADDR]

import { chromium } from 'playwright';
import { build } from 'esbuild';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeSandbox } from './sandbox.ts';
import { buildWalletReport } from '../worker/src/service/report.ts';
import { renderTraceResult } from '../worker/src/tg/formatter.ts';
import { runTrace } from '../worker/src/engine/tracer.ts';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const RENDER = path.join(ROOT, '.render');
const DL = path.join(path.dirname(ROOT), 'download');
const ADDR = process.argv[2] ?? 'TRKhSYVuCmNLn8a6ghuqCJ4X83usLpffF8';
const PORT = 8795;

const MIME: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.ttf': 'font/ttf' };

function serve(dir: string): Promise<void> {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      const p = path.join(dir, decodeURIComponent((req.url ?? '/').split('?')[0]));
      const f = p.endsWith('/') ? path.join(p, 'harness.html') : p;
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
  const short = ADDR.slice(0, 8);
  const { ctx, registry } = makeSandbox();

  console.log(`== живой отчёт ${ADDR} (бесплатные API) ==`);
  const report = await buildWalletReport(ctx, registry, ADDR, { withAml: true });
  const cr = report.chains[0];
  console.log(`verdict: ${report.verdict.score}/100 ${report.verdict.level} · chain: ${cr?.chain} · txs: ${cr?.txs.length ?? 0} · providers: ${(cr?.providers ?? []).join(',')}`);
  console.log(`exposure: ${(cr?.aml?.exposure ?? []).map((e) => `${e.ru} ${e.pct}%`).join(' · ') || '—'}`);
  console.log(`topOut: ${(cr?.aml?.topOut ?? []).map((o) => `${o.addr.slice(0, 10)}… ${o.usd ?? o.amount} ${o.asset} (${Math.round(o.share * 100)}%) [${o.category ?? '-'}]`).join(' · ') || '—'}`);
  console.log(`findings: ${cr?.findings.length ?? 0} · классификация: ${cr?.classification?.title ?? '—'} (${cr?.classification?.confidence ?? '-'})`);

  // расследование: живой прогон трейсера + новый формат текста
  if (cr) {
    console.log('\n== расследование (trace) ==');
    try {
      const trace = await runTrace(ctx, registry, cr.chain, cr.account.addr, { depth: 1, fetchBudget: 12 });
      console.log(`узлов: ${trace.nodes.length} · связей: ${trace.edges.length} · утечек: ${trace.leaks.length} · fetches: ${trace.fetchesUsed}`);
      const txt = renderTraceResult(trace).join('\n').replace(/<[^>]+>/g, '');
      console.log(txt.split('\n').slice(0, 14).join('\n'));
    } catch (e) { console.log(`trace пропущен: ${(e as Error).message}`); }
  }

  await build({
    entryPoints: [path.join(ROOT, 'scripts', 'render-harness.ts')],
    bundle: true, format: 'iife', target: 'chrome120', minify: false, logLevel: 'silent',
    outfile: path.join(RENDER, 'bundle.js'),
  });
  fs.mkdirSync(path.join(RENDER, 'fonts'), { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'miniapp', 'public', 'fonts', 'DejaVuSans.ttf'), path.join(RENDER, 'fonts', 'DejaVuSans.ttf'));
  fs.writeFileSync(path.join(RENDER, 'harness.html'),
    `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0">
     <script>window.Telegram={WebApp:{initData:'',initDataUnsafe:{},ready(){},expand(){},setHeaderColor(){},setBackgroundColor(){},BackButton:{show(){},hide(){},onClick(){}},HapticFeedback:{impactOccurred(){}}},ARES_CONFIG:{apiBase:''}};</script>
     <script src="/bundle.js"></script></body></html>`);

  await serve(RENDER);
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1200, height: 1600 } });
  await page.goto(`http://127.0.0.1:${PORT}/harness.html`);
  await page.evaluate((rep) => { (window as { __REPORT?: unknown }).__REPORT = rep; }, JSON.parse(JSON.stringify(report)));
  const out = await page.evaluate('window.__renderAll()') as { jpeg: string; pdf: string; err?: string };
  await browser.close();
  if (out.err) throw new Error(`harness error: ${out.err}`);

  const jpegBytes = Buffer.from(out.jpeg.split(',')[1] ?? out.jpeg, 'base64');
  const pdfBytes = Buffer.from(out.pdf, 'base64');
  fs.writeFileSync(path.join(DL, `live-card-${short}.jpg`), jpegBytes);
  fs.writeFileSync(path.join(DL, `live-report-${short}.pdf`), pdfBytes);
  console.log(`\ncard: download/live-card-${short}.jpg (${Math.round(jpegBytes.length / 1024)} КБ)`);
  console.log(`pdf : download/live-report-${short}.pdf (${Math.round(pdfBytes.length / 1024)} КБ)`);
  console.log('DONE');
  process.exit(0);
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
