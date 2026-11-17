// Юнит-проверка скоринга unmix v6 (H1/H2/H3/loop) на синтетических данных.
import { buildUnmix } from '/home/z/my-project/ares-repo/ares-crypto/worker/src/engine/unmix.ts';

const M = '0xm1xer0000000000000000000000000000000999';
const A = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa01';
const B = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb02';
const C = '0xcccccccccccccccccccccccccccccccccccccc03';
const D = '0xdddddddddddddddddddddddddddddddddddddd04';
const E = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee05';
const F = '0xffffffffffffffffffffffffffffffffffffff06';
const row = (kind: 'd' | 'w', addr: string, amount: number, ts: number, i: number) => ({
  chain: 'eth', contract: M, commitment: `${kind}:0xhash${i}`, amount, ts, addr,
});

const deposits = [
  row('d', A, 10, 1000, 1), row('d', B, 10, 1100, 2), row('d', C, 1, 1200, 3), row('d', A, 10, 7200, 4),
];
const withdrawals = [
  row('w', A, 10, 4600, 5),   // H1 для депозита A@1000; позже есть депозит A@7200 → looped
  row('w', D, 10, 2900, 6),   // H2 для B@1100 (ребро B→D)
  row('w', E, 1, 4200, 7),    // FIFO для C@1200 (задержка 3000с)
  row('w', F, 10, 3100, 8),   // лишний вывод того же номинала (влияет на n, остаётся в пуле FIFO)
];
const edges = [{ from: B, to: D, amount: 5, asset: 'ETH' }];
const graphAddrs = new Set([A.toLowerCase(), B.toLowerCase(), C.toLowerCase()]);

const res = buildUnmix({ chain: 'eth', mixer: M, rootAddr: A, graphAddrs, edges, deposits, withdrawals, nowSec: 100000 });
if (!res) { console.error('FAIL: результат null'); process.exit(1); }
console.log('NOTE:', res.note);
for (const l of res.links) console.log(`link ${l.from.slice(2, 6)}→${l.to.slice(2, 6)} p=${l.p.toFixed(3)} method=${l.method} looped=${l.looped}`);

const ok = (cond: boolean, name: string) => { if (!cond) { console.error('FAIL:', name); process.exit(1); } console.log('ok:', name); };
const l1 = res.links.find((l) => l.from === A && l.to === A);
const l2 = res.links.find((l) => l.from === B && l.to === D);
const l3 = res.links.find((l) => l.from === C && l.to === E);
ok(!!l1 && l1.method?.startsWith('H1') && Math.abs(l1.p - 0.95) < 1e-9 && l1.looped === true, 'H1 + loop-bonus = 0.95');
ok(!!l2 && l2.method?.startsWith('H2') && Math.abs(l2.p - 0.75) < 1e-9, 'H2 = 0.75');
ok(!!l3 && l3.method?.startsWith('H3') && l3.p > 0.3 && l3.p < 0.36, 'FIFO ~0.2..0.36 по задержке');
ok(res.links.every((l) => l.method !== undefined), 'все ссылки помечены методом');
// Нулевой сценарий: депозиты цели есть, пар нет
const res2 = buildUnmix({ chain: 'eth', mixer: M, rootAddr: A, graphAddrs, edges: [], deposits: [row('d', A, 10, 1000, 9)], withdrawals: [], nowSec: 100000 });
ok(!!res2 && res2.links.length === 0 && res2.note.includes('не нашлось'), 'честный нулевой результат с покрытием');
console.log('ALL OK');
