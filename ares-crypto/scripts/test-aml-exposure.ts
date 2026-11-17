// Smoke test: AML exposure (происхождение средств, Quppy-формат) + topOut (куда ушло).
// Run: node scripts/test-aml-exposure.ts   (offline: только локальная MemoryDB)

import { makeSandbox, line } from './sandbox.ts';
import { scoreAml } from '../worker/src/engine/aml.ts';
import { LabelEngine } from '../worker/src/engine/labels.ts';
import { renderAml } from '../worker/src/tg/formatter.ts';
import type { Tx } from '../worker/src/core/types.ts';

const { ctx } = makeSandbox();
const now = Math.floor(Date.now() / 1000);
const TARGET = 'TTARGETAddr1111111111111111111111';

let failures = 0;
function check(name: string, cond: boolean, extra = ''): void {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ` — ${extra}` : ''}`);
  if (!cond) failures++;
}

function tx(dir: 'in' | 'out', other: string, amount: number, asset = 'USDT', tsDelta = 3600): Tx {
  return {
    hash: `t-${Math.random().toString(36).slice(2, 10)}`,
    chain: 'tron',
    ts: now - tsDelta,
    from: dir === 'in' ? other : TARGET,
    to: dir === 'out' ? other : TARGET,
    amount, asset, fee: 0,
    direction: dir,
    kind: 'token',
  };
}

async function main() {
  line('Seed: метки контрагентов (все 9 категорий)');
  const l = new LabelEngine(ctx);
  const CP = {
    binance: 'TBinanceHot11111111111111111111111111',
    nokyc: 'TNoKycExch222222222222222222222222222',
    hotwallet: 'THotWallet3333333333333333333333333333',
    exchanger: 'TPaySvc4444444444444444444444444444444',
    tornado: 'TTornado555555555555555555555555555555',
    bridge: 'TBridge6666666666666666666666666666666',
    scammer: 'TScam777777777777777777777777777777777',
    dex: 'TDex8888888888888888888888888888888888',
    friend: 'TFriend9999999999999999999999999999999',
    dustsrc: 'TDust000000000000000000000000000000000',
  };
  await l.addLabel({ chain: 'tron', addr: CP.binance.toLowerCase(), category: 'cex', name: 'Binance', source: 'seed', confidence: 'high', addedBy: 'test' });
  await l.addLabel({ chain: 'tron', addr: CP.nokyc.toLowerCase(), category: 'cex', name: 'ExchangeX (без KYC, высокий риск)', source: 'seed', confidence: 'mid', addedBy: 'test' });
  await l.addLabel({ chain: 'tron', addr: CP.hotwallet.toLowerCase(), category: 'cex', name: 'Bybit Hot Wallet 12', source: 'seed', confidence: 'high', addedBy: 'test' });
  await l.addLabel({ chain: 'tron', addr: CP.exchanger.toLowerCase(), category: 'payment', name: 'Мгновенный обменник P2P', source: 'seed', confidence: 'mid', addedBy: 'test' });
  await l.addLabel({ chain: 'tron', addr: CP.tornado.toLowerCase(), category: 'mixer', name: 'Tornado Cash (TRON)', source: 'seed', confidence: 'high', addedBy: 'test' });
  await l.addLabel({ chain: 'tron', addr: CP.bridge.toLowerCase(), category: 'bridge', name: 'Bridge Router', source: 'seed', confidence: 'high', addedBy: 'test' });
  await l.addLabel({ chain: 'tron', addr: CP.scammer.toLowerCase(), category: 'scam', name: 'Фишинговый сайт', source: 'seed', confidence: 'high', addedBy: 'test' });
  await l.addLabel({ chain: 'tron', addr: CP.dex.toLowerCase(), category: 'service', name: 'SunSwap DEX роутер', source: 'seed', confidence: 'high', addedBy: 'test' });
  await l.addLabel({ chain: 'tron', addr: CP.friend.toLowerCase(), category: 'personal', name: '', source: 'seed', confidence: 'low', addedBy: 'test' });

  line('Seed: aml_sources (OFAC на одном контрагенте)');
  await ctx.db.upsertAmlSources([
    { chain: 'tron', addr: CP.scammer.toLowerCase(), source: 'scam-db', severity: 'high', ref: 'test-scam', updatedTs: now },
    { chain: 'tron', addr: CP.tornado.toLowerCase(), source: 'mixer:tornado', severity: 'critical', ref: 'test-mixer', updatedTs: now },
  ]);

  line('Транзакции: вход из всех типов источников + пыль + выходы');
  const txs: Tx[] = [
    tx('in', CP.binance, 400_000),           // 40% → Биржи
    tx('in', CP.hotwallet, 150_000),         // 15% → Кастодиальные
    tx('in', CP.nokyc, 100_000),             // 10% → Биржи повыш. риска
    tx('in', CP.exchanger, 80_000),          // 8%  → Платёж. сервисы
    tx('in', CP.tornado, 60_000),            // 6%  → Миксеры (+dirty hit)
    tx('in', CP.bridge, 50_000),             // 5%  → Мосты
    tx('in', CP.dex, 40_000),                // 4%  → DEX
    tx('in', CP.scammer, 20_000),            // 2%  → Скамы (+dirty hit)
    tx('in', CP.friend, 99_000),             // ~9.9% → Личные/неименованные
    tx('in', CP.dustsrc, 5),                 // пыль $5
    // выходы: куда ушло
    tx('out', CP.binance, 250_000, 'USDT', 7200),
    tx('out', CP.friend, 120_000, 'USDT', 7300),
    tx('out', CP.exchanger, 60_000, 'USDT', 7400),
    tx('out', CP.binance, 50_000, 'TRX', 7500), // второй актив
  ];

  line('scoreAml с priceOf (USDT=1, TRX=0.25)');
  const aml = await scoreAml(ctx, {
    chain: 'tron', addr: TARGET, txs, now,
    priceOf: (sym) => (sym === 'USDT' ? 1 : sym === 'TRX' ? 0.25 : undefined),
  });

  console.log(`AML score: ${aml.score}/100 (${aml.level})`);
  console.log(`hits: ${aml.hits.length} → ${aml.hits.map((h) => `${h.source}@h${h.hops}`).join(', ')}`);

  line('Exposure (происхождение средств)');
  const sumPct = aml.exposure.reduce((s, e) => s + e.pct, 0);
  for (const e of aml.exposure) console.log(`  ${e.ru}: ${e.pct.toFixed(2)}% [${e.tone}]`);
  const byRu = Object.fromEntries(aml.exposure.map((e) => [e.ru, e.pct]));
  check('Сумма долей ≈ 100%', Math.abs(sumPct - 100) < 0.5, `${sumPct.toFixed(2)}%`);
  check('Биржи ≈ 40%', Math.abs((byRu['Биржи'] ?? 0) - 40) < 0.5);
  check('Кастодиальные ≈ 15%', Math.abs((byRu['Кастодиальные кошельки'] ?? 0) - 15) < 0.5);
  check('Биржи повыш. риска ≈ 10%', Math.abs((byRu['Биржи повыш. риска'] ?? 0) - 10) < 0.5);
  check('Платёж. сервисы ≈ 8%', Math.abs((byRu['Платёж. сервисы'] ?? 0) - 8) < 0.5);
  check('Миксеры ≈ 6%', Math.abs((byRu['Миксеры'] ?? 0) - 6) < 0.5);
  check('Скамы ≈ 2%', Math.abs((byRu['Скамы/фишинг'] ?? 0) - 2) < 0.5);
  check('Пыль ≈ 0.001%', (byRu['Пыль (dust)'] ?? 0) >= 0.001 && (byRu['Пыль (dust)'] ?? 0) < 0.02);
  check('Личные/неименованные ≈ 9.9%', Math.abs((byRu['Личные/неименованные'] ?? 0) - 9.9) < 0.5);
  check('Биржи первая (сорт.)', aml.exposure[0]?.ru === 'Биржи');

  line('TopOut (куда ушло)');
  for (const o of aml.topOut) console.log(`  ${o.usd !== undefined ? `${o.usd} usd` : `${o.amount} ${o.asset}`} (${(o.share * 100).toFixed(1)}%) → ${o.addr.slice(0, 12)}… [${o.category ?? '-'}] ${o.label ?? ''}`);
  check('Топ-1 = Binance (250k USDT + 50k TRX = 262.5k usd)', aml.topOut[0]?.category === 'cex' && Math.abs((aml.topOut[0]?.usd ?? 0) - 262_500) < 1);
  check('Доминирующий актив топ-1 = USDT', aml.topOut[0]?.asset === 'USDT' && Math.abs((aml.topOut[0]?.amount ?? 0) - 250_000) < 1);
  check('Адреса в топ-3 не смешивают активы (3 строки)', aml.topOut.length === 3);
  check('Доли 0..1', aml.topOut.every((o) => o.share > 0 && o.share <= 1));

  line('renderAml (текст для Telegram)');
  const txt = renderAml(aml);
  console.log(txt.split('\n').slice(0, 16).join('\n'));
  check('В тексте есть «Происхождение»', txt.includes('Происхождение входящих средств'));
  check('В тексте есть «Куда ушло»', txt.includes('Куда ушло'));
  check('В тексте тип получателя (Биржа)', txt.includes('Биржа'));

  console.log(failures === 0 ? '\n🎉 ВСЕ ПРОВЕРКИ ПРОЙДЕНЫ' : `\n💥 ПРОВАЛЕНО: ${failures}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
