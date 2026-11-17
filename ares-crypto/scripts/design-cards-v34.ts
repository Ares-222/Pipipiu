// Рендер карточек №3/№4 → download/ (без отправки; отправка отдельно curl'ом,
// чтобы не повторять зависания BotApi и не дублировать сообщения).
// Run: node scripts/design-cards-v34.ts

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

function serve(dir: string): Promise<void> {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      const f = path.join(dir, decodeURIComponent((req.url ?? '/').split('?')[0]).replace(/^\//, ''));
      if (!f.startsWith(dir) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end('nf'); return; }
      res.writeHead(200, { 'content-type': 'text/javascript' });
      res.end(fs.readFileSync(f));
    });
    srv.listen(PORT, '127.0.0.1', () => resolve());
  });
}

async function main(): Promise<void> {
  await build({
    entryPoints: [path.join(ROOT, 'scripts', 'design-harness2.ts')],
    bundle: true, format: 'iife', target: 'chrome120', logLevel: 'silent',
    outfile: path.join(RENDER, 'design2-bundle.js'),
  });
  await serve(RENDER);
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1200, height: 1600 } });
  page.on('pageerror', (e) => console.error('PAGE ERROR:', e.message));
  await page.setContent(`<html><body style="margin:0"><script src="http://127.0.0.1:${PORT}/design2-bundle.js"></script></body></html>`);
  await page.waitForFunction('typeof window.__renderV3 === "function"', undefined, { timeout: 15000 });
  for (const v of ['V3', 'V4']) {
    const url = await page.evaluate(`window.__render${v}()`) as string;
    const bytes = Buffer.from(url.split(',')[1], 'base64');
    const f = path.join(DL, `ares-design-${v}-card.jpg`);
    fs.writeFileSync(f, bytes);
    console.log(`${v}: ${f} (${Math.round(bytes.length / 1024)} КБ)`);
  }
  await browser.close();
  console.log('RENDER DONE');
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
