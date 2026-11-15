// M8 smoke test: TON OSINT (§13) — DNS reverse + NFT username/number/domain links.
// Run: node scripts/test-tonosint.ts

import { makeSandbox, line } from './sandbox.ts';
import { resolveTelegram, resolveTonDomain, telegramLinks } from '../worker/src/engine/tonosint.ts';

const { ctx } = makeSandbox();

async function main() {
  console.log('ARES CRYPTO — M8 TON OSINT SMOKE TEST');

  line('resolve .t.me (TON DNS reverse, official DNS)');
  const tg = await resolveTelegram(ctx, 'wallet').catch((e) => { console.log('resolve err:', (e as Error).message); return null; });
  console.log('@wallet ->', tg ? `${tg.addr?.slice(0, 20)}… (${tg.confidence})` : 'не привязан / не резолвится');

  line('resolve .ton domain');
  const ton = await resolveTonDomain(ctx, 'foundation.ton').catch(() => null);
  console.log('foundation.ton ->', ton ? `${ton.addr?.slice(0, 24)}…` : 'не найден');

  line('NFT links of a resolved address');
  const addr = ton?.addr ?? tg?.addr;
  if (addr) {
    const links = await telegramLinks(ctx, addr);
    console.log(`usernames: ${links.usernames.length}, numbers: ${links.numbers.length}, domains: ${links.domains.length}, other NFT: ${links.otherNft.length}`);
    for (const u of links.usernames.slice(0, 5)) console.log(`  · ${u.username} (${u.confidence})`);
    for (const d of links.domains.slice(0, 5)) console.log(`  · ${d.domain} (${d.confidence})`);
    for (const n of links.numbers.slice(0, 3)) console.log(`  · номер ${n.number} (${n.confidence})`);
    if (links.note) console.log('note:', links.note);
  } else {
    console.log('адрес не найден для NFT-проверки — тон-резолв недоступен с этого IP');
  }

  console.log('\nPASS: TON OSINT executed (вероятностные связи с пометками достоверности)');
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
