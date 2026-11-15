// Bot-layer smoke test: synthetic updates through the real router with a mock
// Telegram transport. Data comes from live APIs. No messages leave the sandbox.
// Run: node scripts/test-bot.ts

import { makeSandbox, line } from './sandbox.ts';
import { BotApi } from '../worker/src/tg/bot.ts';
import { handleUpdate } from '../worker/src/tg/router.ts';
import type { RouterDeps } from '../worker/src/tg/router.ts';
import type { TgUpdate, InlineKeyboardMarkup } from '../worker/src/tg/bot-types.ts';

const { ctx, registry } = makeSandbox();

class MockApi extends BotApi {
  sent: { chat: number; text: string; kb?: InlineKeyboardMarkup }[] = [];
  async sendMessage(chatId: number, html: string, kb?: InlineKeyboardMarkup): Promise<number | undefined> {
    this.sent.push({ chat: chatId, text: html, kb: kb });
    return 1;
  }
  async sendPhoto(chatId: number, jpeg: Uint8Array | string): Promise<number | undefined> { void jpeg; void chatId; return 1; }
  async sendDocument(chatId: number, bytes: Uint8Array, filename: string): Promise<number | undefined> {
    void bytes;
    this.sent.push({ chat: chatId, text: `[DOCUMENT ${filename}: ${new TextDecoder().decode(bytes).slice(0, 120)}…]` });
    return 1;
  }
  async answerCallback(): Promise<void> { /* noop */ }
}

const ADMIN = 5188446459;
const mock = new MockApi(ctx);
const deps: RouterDeps = { ctx, registry, api: mock, botUsername: 'test_bot' };

function upd(text: string, id = 1): TgUpdate {
  return {
    update_id: id,
    message: { message_id: id, from: { id: ADMIN, username: 'ares_tester', first_name: 'Ares' }, chat: { id: ADMIN, type: 'private' }, date: Math.floor(Date.now() / 1000), text },
  };
}

function show(tag: string, max = 1200, back = 1): void {
  const items = mock.sent.slice(-back);
  console.log(`\n----- ${tag} -> ${mock.sent.length} total -----`);
  for (const last of items) {
    console.log('--- msg ---');
    console.log(last ? last.text.slice(0, max) : '(nothing sent)');
    if (last?.kb) console.log('KB:', JSON.stringify(last.kb).slice(0, 300));
  }
}

async function main() {
  console.log('ARES CRYPTO — BOT LAYER SMOKE TEST (mock transport, live data)');

  // seed one label for exchange_exit demo
  await ctx.db.upsertLabel({ chain: 'eth', addr: '0x28c6c06298d514db089934071355e5743bf42d78', category: 'cex', name: 'Binance 14', source: 'kb:seed', confidence: 'mid' });

  await handleUpdate(deps, upd('/start', 1));
  show('CMD /start');

  await handleUpdate(deps, upd('/help', 2));
  show('CMD /help', 500);

  // real TRON USDT contract vector
  await handleUpdate(deps, upd('TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t', 3));
  show('FREE TEXT tron USDT contract', 2600, 2);

  // vitalik evm
  await handleUpdate(deps, upd('0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045', 4));
  show('FREE TEXT vitalik (eth+chains)', 1500);

  await handleUpdate(deps, upd('/history', 5));
  show('CMD /history', 400);

  await handleUpdate(deps, upd('/settings min=20', 6));
  show('CMD /settings min=20', 400);

  await handleUpdate(deps, upd('/watch TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t', 7));
  show('CMD /watch', 400);

  await handleUpdate(deps, upd('/watchlist', 8));
  show('CMD /watchlist', 400);

  await handleUpdate(deps, upd('/unwatch TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t', 9));
  show('CMD /unwatch', 300);

  await handleUpdate(deps, upd('это не адрес вообще', 10));
  show('FREE TEXT garbage -> hints', 500);

  await handleUpdate(deps, upd('/admin addlabel TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t contract USDT Tether', 11));
  show('ADMIN addlabel', 300);

  await handleUpdate(deps, upd('/admin stats', 12));
  show('ADMIN stats', 500);

  // /trace through the router (BFS + budget) on the TRON USDT contract
  await handleUpdate(deps, upd('/trace TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t', 13));
  const last = mock.sent[mock.sent.length - 1];
  console.log('\n----- CMD /trace (router -> runTrace) -----');
  console.log(last?.text.slice(0, 900) ?? '(nothing)');

  console.log(`\nerrors logged: ${(await ctx.db.listErrorLogs(5)).length}`);
  console.log('quota state:', JSON.stringify(await ctx.db.getUser(ADMIN)));
  console.log('PASS: bot layer processed all inputs without crashes');
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
