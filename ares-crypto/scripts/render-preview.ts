// Визуальный предпросмотр новой карточки + PDF (утверждённый макет №4, живой код).
// Данные — синтетика с числами утверждённого образца (design-data), чтобы сверить
// макет 1:1. Telegram-доставка НЕ выполняется — только файлы в download/.
// Run: node scripts/render-preview.ts

import { chromium } from 'playwright';
import { build } from 'esbuild';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const RENDER = path.join(ROOT, '.render');
const DL = path.join(path.dirname(ROOT), 'download');
const PORT = 8793;

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

// Синтетические транзакции для спарклайна (56 операций за 14 дней, пик на последнем дне)
const PREVIEW_TXS = (() => {
  const base = Math.floor(new Date('2026-11-15T12:00:00Z').getTime() / 1000);
  const out: { hash: string; chain: string; ts: number; from: string; to: string; amount: number; asset: string; fee: number; direction: 'in' | 'out'; kind: string }[] = [];
  const perDay = [1, 2, 3, 2, 4, 3, 5, 4, 6, 5, 7, 6, 8, 66];
  let n = 0;
  perDay.forEach((cnt, d) => {
    for (let i = 0; i < Math.min(cnt, 8); i++) {
      n++;
      out.push({
        hash: `demo${n}`, chain: 'tron', ts: base - (13 - d) * 86400 + i * 900,
        from: d % 2 ? 'TFriend9999999999999999999999999999999' : 'TBinanceHot11111111111111111111111111',
        to: d % 2 ? 'TK2xgkMBsUp6Hk1R5PjLQUb7mZaASw3AiB' : 'TUeapnPqW7bZkYQ7aSiwE1234567890abcd',
        amount: 100 + n, asset: 'USDT', fee: 1, direction: d % 2 ? 'in' : 'out', kind: 'token',
      });
    }
  });
  return out;
})();

// Синтетический WalletReport — числа утверждённого образца карточки №4.
const REPORT = {
  input: 'TK2xgkMBsUp6Hk1R5PjLQUb7mZaASw3AiB',
  createdAt: Math.floor(new Date('2026-11-15T12:00:00Z').getTime() / 1000),
  chains: [{
    chain: 'tron',
    account: { chain: 'tron', addr: 'TK2xgkMBsUp6Hk1R5PjLQUb7mZaASw3AiB', balanceNative: 640.5, tokens: [], provider: 'trongrid', createdAt: Math.floor(new Date('2026-11-01T00:00:00Z').getTime() / 1000) },
    txs: PREVIEW_TXS,
    kpi: {
      received: 812400, receivedCount: 42, sent: 806100, sentCount: 517,
      settledPct: 0.8, counterpartiesIn: 18, counterpartiesOut: 413,
      turnover: 1620000, avgTx: 3108, medianTx: 120, maxTx: 85000,
      activeDays: 14, ageDays: 14,
    },
    findings: [
      { id: 'f1', severity: 'red', title: 'Свежий адрес с большим оборотом', detail: 'Адрес создан 14 дн. назад, оборот уже 1,62 млн $ — типично для транзитных кошельков' },
      { id: 'f2', severity: 'yellow', title: 'Веерная рассылка (fan-out)', detail: '413 получателей против 18 отправителей — массовые выплаты', addresses: [
        { addr: 'TUeapnPqW7bZkYQ7aSiwE1234567890abcd', label: '', amounts: '190 000 $ ×3' },
        { addr: 'TXeLzi1ABcDeFgHiZJewAU1234567890ab', amounts: '191 416 $ ×7' },
      ] },
      { id: 'f3', severity: 'gray', title: 'Прямой выход на биржи', detail: '1 биржевой контрагент — точка KYC-деанонимизации', addresses: [
        { addr: 'TLgjqHKEuPqRsTuVwDyxkPP1234567890ab', label: 'Heleket Hot Wallet 3', amounts: '33,9 $ ×1' },
      ] },
    ],
    classification: {
      title: 'Раздающий кошелёк (fan-out)', confidence: 'high',
      scores: { fanout: 60, fanin: 8, auto: 50, cexService: 47, transit: 46, personal: 15 },
    },
    transit: {
      matched: 16, ofIn: 30, pct: 53, medianHoldMin: 150, under60Pct: 12,
      top: [
        { delayMin: 1209, inAmount: 34640, outAmount: 32562, to: 'TL5aEjykMn1X4000000000000000000000000' },
        { delayMin: 932, inAmount: 20.46, outAmount: 20.31, to: 'TT1YT6dmerWkhm000000000000000000000000' },
        { delayMin: 229, inAmount: 355.6, outAmount: 316.78, to: 'TNuJfWZTrCSNoi000000000000000000000000' },
      ],
    },
    aml: {
      score: 41, level: 'medium',
      hits: [{ source: 'mixer:tornado', severity: 'critical', hops: 1, volumeShare: 0.021, score: 18, path: ['TK2x…', 'TTornado…'] }],
      exchangeExit: [{ addr: 'TLgjqHKE…', label: 'Heleket Hot Wallet 3 (cex)' }],
      exposure: [
        { key: 'cex', ru: 'Биржи', pct: 85.78, tone: 'blue' },
        { key: 'dust', ru: 'Пыль (dust)', pct: 3.86, tone: 'dim' },
        { key: 'cex_risk', ru: 'Биржи повыш. риска', pct: 2.34, tone: 'warn' },
        { key: 'enforcement', ru: 'Принудит. изъятия', pct: 2.02, tone: 'bad' },
        { key: 'service', ru: 'Неименов. сервисы', pct: 0.62, tone: 'warn' },
        { key: 'custodial', ru: 'Кастодиальные кошельки', pct: 0.59, tone: 'blue' },
        { key: 'sanctioned', ru: 'Санкции', pct: 0.56, tone: 'bad' },
        { key: 'bridge', ru: 'Мосты', pct: 0.39, tone: 'blue' },
        { key: 'scam', ru: 'Скамы/фишинг', pct: 0.31, tone: 'bad' },
        { key: 'personal', ru: 'Личные/неименованные', pct: 3.53, tone: 'dim' },
      ],
      topOut: [
        { addr: 'TUeapnPqW7bZkYQ7aSiwE1234567890abcd', category: 'personal', amount: 665920, asset: 'USDT', usd: 665920, share: 0.73 },
        { addr: 'TXeLzi1ABcDeFgHiZJewAU1234567890ab', category: 'cex', label: 'Heleket Hot Wallet 3', amount: 245110, asset: 'USDT', usd: 245110, share: 0.27 },
      ],
      disclaimer: 'Эвристическая оценка на публичных данных; не заменяет коммерческий AML.',
    },
    providers: ['trongrid'],
  }],
  verdict: { score: 46, level: 'medium', reasons: ['Свежий адрес с большим оборотом', 'Веерная рассылка'] },
  warnings: [],
};

async function main(): Promise<void> {
  fs.mkdirSync(RENDER, { recursive: true });
  fs.mkdirSync(DL, { recursive: true });

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
  await page.evaluate((rep) => { (window as { __REPORT?: unknown }).__REPORT = rep; }, REPORT);
  const out = await page.evaluate('window.__renderAll()') as { jpeg: string; pdf: string; err?: string };
  await browser.close();
  if (out.err) throw new Error(`harness error: ${out.err}`);

  const jpegBytes = Buffer.from(out.jpeg.split(',')[1] ?? out.jpeg, 'base64');
  const pdfBytes = Buffer.from(out.pdf, 'base64');
  const jpg = path.join(DL, 'preview-card-v4.jpg');
  const pdf = path.join(DL, 'preview-report-v4.pdf');
  fs.writeFileSync(jpg, jpegBytes);
  fs.writeFileSync(pdf, pdfBytes);
  console.log(`card: ${jpg} (${Math.round(jpegBytes.length / 1024)} КБ)`);
  console.log(`pdf : ${pdf} (${Math.round(pdfBytes.length / 1024)} КБ)`);
  console.log('DONE');
  process.exit(0);
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
