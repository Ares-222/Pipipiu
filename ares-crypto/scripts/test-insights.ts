// Смок v7-эвристик (insights.ts): пил-чейн, общий источник, пыль, активность.
// Запуск: node scripts/test-insights.ts (Node 24 type-stripping, без сборки).
// Всё на синтетике — проверяем ЛОГИКУ, не провайдеров.

import { detectPeelChains, detectCommonFunders, dustFinding, activityFingerprint, bridgeFinding, structureFindings } from '../worker/src/engine/insights.ts';
import type { GraphNode, GraphEdge, Tx } from '../worker/src/core/types.ts';

let fails = 0;
function check(name: string, cond: boolean, extra?: string): void {
  console.log(`${cond ? 'PASS' : 'FAIL'} · ${name}${extra ? ` — ${extra}` : ''}`);
  if (!cond) fails++;
}

const n = (id: string, vol: number, cat?: string, isRoot = false): GraphNode =>
  ({ id, chain: 'tron', addr: id.split(':')[1] ?? id, volume: vol, in: vol, out: vol * 0.8, txCount: 3, isRoot, category: cat });

const e = (from: string, to: string, amount: number): GraphEdge =>
  ({ from, to, amount, asset: 'USDT', txCount: 1, firstTs: 1, lastTs: 2 });

// --- граф 1: классический пил-чейн root → m1 → m2 → биржа ---
const nodes1 = [
  n('tron:root', 100, undefined, true),
  n('tron:m1', 100),
  n('tron:m2', 70),
  n('tron:bin', 45, 'cex'),
];
const edges1 = [
  e('tron:root', 'tron:m1', 100),
  e('tron:m1', 'tron:m2', 75),
  e('tron:m2', 'tron:bin', 45),
  e('tron:m1', 'tron:dustx', 5), // небольшой боковой выход — не должен ломать «доминирование»
];
const peel = detectPeelChains(nodes1, edges1, 'tron:root');
check('пил-чейн найден (3 узла + конечная биржа)', peel.length === 1 && peel[0].path.length === 4, JSON.stringify(peel[0]?.path ?? []));
check('доля дошедшего ~45%', peel[0] && Math.abs(peel[0].shareKept - 0.45) < 0.02, String(peel[0]?.shareKept));

// --- граф 2: веер (не пил-чейн) ---
const edges2 = [e('tron:root', 'tron:a', 50), e('tron:root', 'tron:b', 30), e('tron:root', 'tron:c', 20)];
const peel2 = detectPeelChains([n('tron:root', 100, undefined, true), n('tron:a', 50), n('tron:b', 30), n('tron:c', 20)], edges2, 'tron:root');
check('веер раздач НЕ считается пил-чейном', peel2.length === 0);

// --- общий источник ---
const nodes3 = [n('tron:root', 10, undefined, true), n('tron:x', 5), n('tron:y', 5), n('tron:f', 9)];
const edges3 = [e('tron:f', 'tron:x', 4), e('tron:f', 'tron:y', 4), e('tron:root', 'tron:x', 1)];
const funders = detectCommonFunders(nodes3, edges3, 'tron:root');
check('общий источник найден (f → x,y)', funders.length === 1 && funders[0].targets.length === 2, JSON.stringify(funders[0]));

// --- пыль ---
const dustTxs: Tx[] = [];
for (let i = 0; i < 12; i++) {
  dustTxs.push({ hash: `h${i}`, chain: 'eth', ts: 1700000000 + i, from: `0xdust${i}`, to: '0xme', amount: 0.5, asset: 'USDT', fee: 0, direction: 'in', kind: 'tx' });
}
const dust = dustFinding(dustTxs, () => 1);
check('пыль детектится (12 входов по $0.5)', dust !== null, dust?.title);
check('чистая история без пыли', dustFinding([{ hash: 'a', chain: 'eth', ts: 1, from: '0xa', to: '0xme', amount: 5000, asset: 'USDT', fee: 0, direction: 'in', kind: 'tx' }], () => 1) === null);

// --- активность (база выровнена на полночь UTC, чтобы часы были честными) ---
const DAY0 = 1700000000 - (1700000000 % 86400);
const actTxs: Tx[] = [];
for (let d = 0; d < 5; d++) {
  for (let h = 7; h < 11; h++) actTxs.push({ hash: `t${d}-${h}`, chain: 'tron', ts: DAY0 + d * 86400 + h * 3600, from: 'a', to: 'me', amount: 1, asset: 'USDT', fee: 0, direction: 'in', kind: 'tx' });
}
const act = activityFingerprint(actTxs);
check('активность: пик утром UTC (4-10)', act !== null && act.peakFrom >= 4 && act.peakFrom <= 9, act ? `peak ${act.peakFrom}:00, ${act.note.slice(0, 60)}` : '');
check('активность: малая выборка → честный null', activityFingerprint(actTxs.slice(0, 5)) === null);

// --- мосты + findings-строки ---
const bridgeF = bridgeFinding([n('tron:br', 5, 'bridge')]);
check('мост-файндинг есть', bridgeF !== null, bridgeF?.title);
const s = structureFindings(peel, funders, bridgeF);
check('structureFindings: 3 строки', s.length === 3, `${s.length}`);

console.log(fails === 0 ? '\nSMOK OK · все проверки пройдены' : `\nSMOK FAILED · упало проверок: ${fails}`);
process.exit(fails === 0 ? 0 : 1);
