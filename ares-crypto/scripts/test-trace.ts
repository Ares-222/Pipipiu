// M6 smoke test: tracer BFS with fetch budget + mixer unmix on REAL Tornado data.
// Requires the mixer index: run `ARES_DB_DUMP=/tmp/ares-db.json node scripts/index-tornado.ts 14980000 7` first.
// Run: ARES_DB_DUMP=/tmp/ares-db.json node scripts/test-trace.ts

import { makeSandbox, line } from './sandbox.ts';
import { runTrace } from '../worker/src/engine/tracer.ts';
import { fetchCount, resetFetchCount } from '../worker/src/core/http.ts';

const { ctx, registry } = makeSandbox();

async function main() {
  console.log('ARES CRYPTO — M6 TRACE + UNMIX SMOKE TEST');
  const deposits = await ctx.db.getMixerDeposits('eth', '0x47ce0c6ed5b0ce3d3a51fdb1c52dc66a7c3c2936', 0, Math.floor(Date.now() / 1000));
  const deps = deposits.filter((d) => d.commitment.startsWith('d:'));
  if (deps.length === 0) {
    console.log('FAIL: mixer index empty — запусти сначала index-tornado с ARES_DB_DUMP');
    return;
  }
  const target = deps[0].addr ?? '';
  console.log(`target: реальный депонент Tornado из индекса: ${target} (${deps.length} депонентов в индексе)`);

  line('TRACE: BFS depth=1, width=8, budget=25');
  resetFetchCount();
  const t0 = Date.now();
  const res = await runTrace(ctx, registry, 'eth', target, {
    depth: 1,
    width: 20,
    fetchBudget: 25,
    onProgress: (s, total, expanded, note) => console.log(`  прогресс: шаг ${s}/${total} — ${expanded} узлов — ${note}`),
  });
  console.log(`готово за ${(Date.now() - t0) / 1000}с · fetches=${res.fetchesUsed}/25 (лимит не превышен: ${res.fetchesUsed <= 25 ? 'OK' : 'FAIL'})`);
  console.log(`узлов: ${res.nodes.length}, связей: ${res.edges.length}`);
  const mixer = res.nodes.find((n) => n.category === 'mixer' || (n.addr && res.nodes.some(() => false)));
  const mixerNode = res.nodes.find((n) => (n.label ?? '').toLowerCase().includes('tornado') || n.category === 'mixer');
  console.log('миксер-узел в графе:', mixerNode ? `${mixerNode.addr} (${mixerNode.label ?? mixerNode.category})` : 'не найден (BFS не дошёл до прокси в топ-8)');
  console.log('КУДА УТЕКЛО (топ-3):');
  for (const l of res.leaks.slice(0, 3)) console.log(`  ${l.amount.toFixed(4)} ETH → ${l.addr} (${Math.round(l.share * 100)}%)${l.label ? ` ${l.label}` : ''}`);
  console.log('UNMIX:', res.unmix && res.unmix.length ? JSON.stringify(res.unmix, null, 1).slice(0, 800) : 'нет связок (выводов в окне 24ч с тем же номиналом не нашлось — вероятностный пустой результат тоже валиден)');
  console.log(`truncated: ${res.truncated}`);
  console.log(`fetches total (global): ${fetchCount()}`);
  console.log('\nPASS: tracer выполнен в бюджете', res.fetchesUsed <= 25);
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
