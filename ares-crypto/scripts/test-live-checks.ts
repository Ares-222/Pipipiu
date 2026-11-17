// Smoke-тесты новых модулей (GitHub-ресёрч 2026-11-16): freeze / goplus / ai.
// Запуск: node scripts/test-live-checks.ts
// Проверяет: живой TRON+ETH freeze-чтение контрактов, честную деградацию GoPlus
// (в песочнице TLS-блок), деградацию AI без ключа, сборку AI-дайджеста,
// интеграцию freeze/goplus в scoreAml (plumbing, без падений).

import { makeSandbox, line } from './sandbox.ts';
import { checkIssuerFreeze } from '../worker/src/engine/freeze.ts';
import { goplusAddressRisk } from '../worker/src/engine/goplus.ts';
import { aiComment, buildAiDigest } from '../worker/src/engine/ai.ts';
import { scoreAml } from '../worker/src/engine/aml.ts';
import type { WalletReport, Tx } from '../worker/src/core/types.ts';

async function main(): Promise<void> {
  const { ctx, registry } = makeSandbox();

  line('1) freeze: TRON (USDT TRC-20 isBlackListed)');
  const tronFz = await checkIssuerFreeze(ctx, 'tron', 'TNiq9AXBp9EjUqhDhrwrfvAA8U3GUQZH81').catch((e) => `ERR ${e}`);
  console.log('  ', JSON.stringify(tronFz));

  line('2) freeze: ETH (USDT + USDC)');
  const ethFz = await checkIssuerFreeze(ctx, 'eth', '0xd8dA6BF26964aF10D37Ee885305fB5cfdEcD3c69').catch((e) => `ERR ${e}`);
  console.log('  ', JSON.stringify(ethFz));

  line('3) goplus: ETH — в песочнице TLS-блок, ждём честный null (не throw)');
  const gp = await goplusAddressRisk(ctx, 'eth', '0xd8dA6BF26964aF10D37Ee885305fB5cfdEcD3c69').catch((e) => `ERR ${e}`);
  console.log('  ', JSON.stringify(gp));

  line('4) ai: без ключа — честная причина, не текст');
  const fakeRep: WalletReport = {
    input: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
    verdict: { score: 35, level: 'low' },
    chains: [],
    warnings: [],
    createdAt: Math.floor(Date.now() / 1000),
  } as unknown as WalletReport;
  const ai = await aiComment(ctx, fakeRep, 'tron', 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t');
  console.log('  ', JSON.stringify(ai).slice(0, 220));

  line('5) buildAiDigest: дайджест собирается из отчёта');
  const rep2: WalletReport = {
    input: '0xabc',
    verdict: { score: 55, level: 'medium' },
    warnings: ['частичные данные'],
    createdAt: Math.floor(Date.now() / 1000),
    chains: [{
      chain: 'eth',
      account: { chain: 'eth', addr: '0xabc', balanceNative: 1, tokens: [], provider: 'test', providers: ['test'] },
      txs: [],
      kpi: { received: 120000, receivedCount: 34, sent: 40000, sentCount: 12, settledPct: 0.66, counterpartiesIn: 21, counterpartiesOut: 9, turnover: 160000, avgTx: 3500, medianTx: 900, maxTx: 52000, activeDays: 40, ageDays: 300 },
      findings: [{ id: 'f1', severity: 'red', title: 'Тест-находка', detail: 'контакт с OFAC-адресом' }],
      classification: { title: 'Биржевой сервис', confidence: 'mid', scores: { fanout: 1, fanin: 2, auto: 0, cexService: 5, transit: 1, personal: 0 } },
      aml: {
        score: 55, level: 'medium', hits: [{ source: 'ofac', severity: 'critical', hops: 1, volumeShare: 0.3, score: 21, ref: 'SDN 4632' }],
        exchangeExit: [{ addr: '0xcde', label: 'Binance (cex)' }],
        exposure: [{ key: 'sanctioned', ru: 'Санкции', pct: 30, tone: 'bad' }],
        topOut: [{ addr: '0xcde', label: 'Binance', category: 'cex', amount: 2, asset: 'ETH', share: 0.8 }],
        disclaimer: 'd',
      },
    }],
  } as unknown as WalletReport;
  const digest = buildAiDigest(rep2);
  console.log('   длина:', digest.length, '| содержит вердикт:', /55\/100/.test(digest), '| AML:', /AML-скоринг/.test(digest));
  console.log('---\n' + digest.slice(0, 500));

  line('6) scoreAml: интеграция freeze+goplus в скоринг (eth, контрагент OFAC)');
  // сидим aml-источник прямо в тестовой БД (fresh MemoryDB без дампа)
  await ctx.db.upsertAmlSources([{ chain: 'eth', addr: '0xd90e2f925da726b50c4ed8d0fb90ad053324f31b', source: 'ofac', severity: 'critical', ref: 'SDN 4632', updatedTs: ctx.now() }]);
  const txs: Tx[] = [
    { hash: '0x1', chain: 'eth', ts: Math.floor(Date.now() / 1000) - 86400, from: '0xd90e2f925da726b50c4ed8d0fb90ad053324f31b', to: '0xtest1', amount: 5, asset: 'ETH', fee: 0, direction: 'in', kind: 'tx' },
  ];
  const aml = await scoreAml(ctx, {
    chain: 'eth', addr: '0xtest1', txs, now: Math.floor(Date.now() / 1000),
    priceOf: () => 3000,
  });
  console.log('   score:', aml.score, aml.level, '| hits:', aml.hits.map((h) => `${h.source}:${h.hops}:${Math.round(h.score)}`).join(', '));
  if (aml.score > 0 && aml.hits.some((h) => h.source === 'ofac')) console.log('   OFAC-контакт найден, freeze/goplus не уронили скоринг: OK');
  else { console.log('   ❌ OFAC-контакт не найден — plumbing сломан'); process.exit(1); }

  line('7) registry + конфиг');
  console.log('   registry есть:', !!registry, '| ctx.cfg.openrouterKey:', ctx.cfg.openrouterKey ?? '(не задан — деградация честная)');

  console.log('\n✅ test-live-checks завершён');
  process.exit(0);
}

main();
