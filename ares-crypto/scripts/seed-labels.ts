// Посев проверенных сервисных меток в песочницу (персистится через ARES_DB_DUMP).
// Только адреса, чья принадлежность общеизвестна или подтверждена кодом репо
// (Tornado 0.1 ETH — из index-tornado.ts); никаких выдуманных «горячих кошельков бирж».
// Run: ARES_DB_DUMP=/home/z/my-project/ares-crypto/.sandbox-db.json node scripts/seed-labels.ts

import { makeSandbox } from './sandbox.ts';

const SEEDS = [
  { chain: 'tron', addr: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t', name: 'Tether USDT (TRC20 contract)', category: 'token' },
  { chain: 'eth', addr: '0xdac17f958d2ee523a2206206994597c13d831ec7', name: 'Tether USDT (ERC20 contract)', category: 'token' },
  { chain: 'eth', addr: '0x47ce0c6ed5b0ce3d3a51fdb1c52dc66a7c3c2936', name: 'Tornado Cash 0.1 ETH', category: 'mixer' },
];

async function main(): Promise<void> {
  const { ctx } = makeSandbox();
  for (const s of SEEDS) {
    await ctx.db.upsertLabel({
      chain: s.chain,
      addr: s.addr.toLowerCase(),
      category: s.category,
      name: s.name,
      source: 'seed (проверенный контракт/репо)',
      confidence: 'high',
      addedBy: 'seed-script',
      updatedTs: ctx.now(),
    });
    console.log(`+ ${s.chain}:${s.addr} → ${s.name} (${s.category})`);
  }
  const all = await ctx.db.listLabels(500);
  console.log(`всего меток в базе: ${all.length}`);
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
