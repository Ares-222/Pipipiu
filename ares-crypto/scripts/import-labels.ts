// Импорт объединённых меток из открытых датасетов в БД (sandbox или ARES_DB_DUMP).
// Источник: data/labels/merged-labels.json (собирается scripts/build-labels-import.py).
// Run: ARES_DB_DUMP=/home/z/my-project/ares-crypto/.sandbox-db.json node scripts/import-labels.ts

import { makeSandbox } from './sandbox.ts';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const file = join(here, '..', 'data', 'labels', 'merged-labels.json');

interface Row { chain: string; addr: string; name: string; category: string; source: string; confidence: string; }

async function main(): Promise<void> {
  const rows: Row[] = JSON.parse(readFileSync(file, 'utf-8'));
  console.log(`меток в файле: ${rows.length}`);
  const { ctx } = makeSandbox();
  let i = 0;
  for (const r of rows) {
    await ctx.db.upsertLabel({
      chain: r.chain,
      // EVM-адреса case-insensitive → lowercase; TON/TRON (base64/base58) — case-sensitive, не трогаем
      addr: r.addr.startsWith('0x') ? r.addr.toLowerCase() : r.addr,
      category: r.category,
      name: r.name,
      source: r.source,
      confidence: r.confidence === 'high' ? 'high' : 'mid',
      addedBy: 'dataset-import',
      updatedTs: ctx.now(),
    });
    if (++i % 2000 === 0) console.log(`  ...${i}`);
  }
  const all = await ctx.db.listLabels(30000);
  const byCat: Record<string, number> = {};
  for (const l of all) byCat[l.category] = (byCat[l.category] ?? 0) + 1;
  console.log(`в базе: ${all.length} меток`, byCat);
}

main();
