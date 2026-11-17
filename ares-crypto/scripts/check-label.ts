// Проверка поиска метки в песочнице: DB → bestLabel.
import { makeSandbox } from './sandbox.ts';
import { LabelEngine } from '../worker/src/engine/labels.ts';

const addr = process.argv[2] ?? 'EQCEKfb5Bl0iKDni-bIzFQT2KkfQgMItRX05X8kAJgieGBa5';

async function main(): Promise<void> {
  const { ctx } = makeSandbox();
  const direct = await ctx.db.getLabel('ton', addr);
  console.log('db.getLabel:', direct);
  const le = new LabelEngine(ctx);
  const best = await le.bestLabel('ton', addr);
  console.log('bestLabel:', best);
  const all = await ctx.db.listLabels(10);
  console.log('первые метки в базе:', all.map((l) => `${l.chain}:${l.addr.slice(0, 10)}… → ${l.name}`).join(' | '));
}

main();
