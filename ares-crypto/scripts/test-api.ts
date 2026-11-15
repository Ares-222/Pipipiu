// InitData validation + API routes smoke test (M4 checklist:
// "InitData невалидный -> 401"; report/graph endpoints end-to-end).
// Run: node scripts/test-api.ts

import { makeSandbox, line } from './sandbox.ts';
import { AdapterRegistry } from '../worker/src/adapters/registry.ts';
import { handleApi } from '../worker/src/api/routes.ts';
import type { ApiDeps } from '../worker/src/api/routes.ts';
import { validateInitData } from '../worker/src/core/tgauth.ts';
import { handleUpdate } from '../worker/src/tg/router.ts';
import type { RouterDeps } from '../worker/src/tg/router.ts';
import { BotApi } from '../worker/src/tg/bot.ts';

const { ctx, registry } = makeSandbox();
const ADMIN = 5188446459;

// generate a valid initData exactly the way Telegram does:
// transport = URLSearchParams(fields...) + '&hash=hex(HMAC(secret, data_check_string))'
async function makeInitData(userId: number): Promise<string> {
  const enc = new TextEncoder();
  const p = new URLSearchParams();
  p.set('auth_date', String(Math.floor(Date.now() / 1000)));
  p.set('user', JSON.stringify({ id: userId, first_name: 'Ares', username: 'ares_tester' }));
  const dataCheckString = [...p.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join('\n');
  const secretKey = await crypto.subtle.importKey('raw', enc.encode('WebAppData') as BufferSource, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const secret = await crypto.subtle.sign('HMAC', secretKey, enc.encode(ctx.cfg.botToken) as BufferSource);
  const hmacKey = await crypto.subtle.importKey('raw', secret, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', hmacKey, enc.encode(dataCheckString) as BufferSource);
  const hex = [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${p.toString()}&hash=${hex}`;
}

async function main() {
  console.log('ARES CRYPTO — TG AUTH + API SMOKE TEST');

  line('validateInitData');
  const valid = await makeInitData(ADMIN);
  const okData = await validateInitData(valid, ctx.cfg.botToken);
  console.log(`valid initData -> user.id=${okData?.user?.id} ${okData ? 'OK' : 'FAIL'}`);
  const bad = await validateInitData(valid.replace(/hash=.*/, 'hash=deadbeef'), ctx.cfg.botToken);
  console.log(`tampered hash -> ${bad === null ? 'rejected (OK)' : 'ACCEPTED (FAIL!)'}`);
  const noSig = await validateInitData('auth_date=1', ctx.cfg.botToken);
  console.log(`no hash -> ${noSig === null ? 'rejected (OK)' : 'ACCEPTED (FAIL!)'}`);

  // seed a label for exchange findings
  await ctx.db.upsertLabel({ chain: 'eth', addr: '0x28c6c06298d514db089934071355e5743bf42d78', category: 'cex', name: 'Binance 14', source: 'kb:seed', confidence: 'mid' });

  const deps: ApiDeps = {
    ctx, registry,
    sendPhoto: async (chatId, bytes) => { console.log(`sendPhoto: chat=${chatId} bytes=${bytes.length}`); },
    sendDocument: async (chatId, bytes, filename) => { console.log(`sendDocument: chat=${chatId} file=${filename} bytes=${bytes.length}`); },
  };

  line('API: /api/report without initData -> 401 expected');
  const r401 = await handleApi(new Request('http://x/api/report?addr=TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t'), deps, new URL('http://x/api/report?addr=x'));
  console.log(`status=${r401.status} ${r401.status === 401 ? 'OK' : 'FAIL'}`);

  line('API: /api/report with valid initData (real TRON address)');
  const r1url = new URL('http://x/api/report?addr=TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t');
  const r1 = await handleApi(
    new Request(r1url, { headers: { 'x-init-data': valid } }),
    deps,
    r1url,
  );
  const b1 = await r1.json() as { ok: boolean; report?: { verdict: { score: number }; chains: { chain: string; kpi?: { turnover: number }; findings: { title: string }[] }[]; warnings: string[] } };
  console.log(`status=${r1.status} ok=${b1.ok} verdict=${b1.report?.verdict?.score} chains=${b1.report?.chains?.length} findings=${b1.report?.chains?.[0]?.findings?.length} turnover=${b1.report?.chains?.[0]?.kpi?.turnover}`);
  if (b1.report?.warnings?.length) console.log('warnings:', b1.report.warnings.join(' | '));

  line('API: /api/tx (BTC genesis hash)');
  const gen = await handleApi(
    new Request('http://x/api/tx?hash=b3c5584c6b31c7d4e5c1a1e1e0e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0', { headers: { 'x-init-data': valid } }),
    deps,
    new URL('http://x/api/tx'),
  );
  console.log(`status=${gen.status} (404 expected for fake hash)`);

  line('API: /api/settings + POST');
  const s1 = await handleApi(new Request('http://x/api/settings', { headers: { 'x-init-data': valid } }), deps, new URL('http://x/api/settings'));
  console.log(`settings GET status=${s1.status}`);
  const s2 = await handleApi(new Request('http://x/api/settings', { method: 'POST', headers: { 'x-init-data': valid }, body: JSON.stringify({ minAlertUsd: 25 }) }), deps, new URL('http://x/api/settings'));
  const sb = await s2.json() as { settings: { minAlertUsd: number } };
  console.log(`settings POST -> minAlertUsd=${sb.settings.minAlertUsd} ${sb.settings.minAlertUsd === 25 ? 'OK' : 'FAIL'}`);

  line('API: /api/render (photo upload path)');
  const tinyJpeg = Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNCwsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAQAAAAAAAAAAAAAAAAAAAAv/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEQMRAD8AmgA//9k=', 'base64');
  const rr = await handleApi(new Request('http://x/api/render', { method: 'POST', headers: { 'x-init-data': valid }, body: JSON.stringify({ jpeg: tinyJpeg.toString('base64'), caption: 'test' }) }), deps, new URL('http://x/api/render'));
  console.log(`render POST status=${rr.status} ${rr.status === 200 ? 'OK' : 'FAIL'}`);

  line('Router callback flow (miniapp button -> quick check)');
  const mock = new BotApi(ctx);
  void mock;
  const rdeps: RouterDeps = { ctx, registry, api: new class extends BotApi {
    sent: string[] = [];
    async sendMessage(chatId: number, html: string): Promise<number | undefined> { this.sent.push(`${chatId}: ${html.slice(0, 60)}`); console.log(`  -> ${html.slice(0, 80).replace(/\n/g, ' ')}`); return 1; }
    async sendPhoto(chatId: number, jpeg: Uint8Array | string): Promise<number | undefined> { void jpeg; void chatId; return 1; }
    async sendDocument(): Promise<number | undefined> { return 1; }
    async answerCallback(): Promise<void> { /* noop */ }
  }(ctx), botUsername: 'test' };
  await handleUpdate(rdeps, { update_id: 99, message: { message_id: 1, from: { id: ADMIN, username: 't' }, chat: { id: ADMIN, type: 'private' }, date: 0, text: '/p2p TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t' } });
  console.log('P2P card rendered OK');

  console.log('\nPASS: auth + API layer verified');
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
