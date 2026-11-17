// Отладка TON-адаптера: сколько txs возвращает transactions() и почему.
import { makeSandbox } from './sandbox.ts';
import { fetchJson } from '../worker/src/core/http.ts';
import { tonFriendlyToRaw, tonRawToFriendly } from '../worker/src/adapters/ton.ts';

const addr = process.argv[2] ?? 'EQCEKfb5Bl0iKDni-bIzFQT2KkfQgMItRX05X8kAJgieGBa5';

async function main(): Promise<void> {
  const { ctx, registry } = makeSandbox();
  // 0) круговая конвертация: known pair из ответа tonapi
  const raw = tonFriendlyToRaw(addr);
  const back = raw ? tonRawToFriendly(raw) : null;
  console.log('raw:', raw);
  console.log('обратно:', back, '| совпало с исходным:', back === addr);
  // 1) сырой tonapi
  try {
    const r = await fetchJson<{ events?: unknown[]; next_from?: string }>(
      `https://tonapi.io/v2/accounts/${addr}/events?limit=10`,
      { provider: 'tonapi', breaker: ctx.breaker },
    );
    console.log('tonapi events:', (r.events ?? []).length);
  } catch (e) {
    console.log('tonapi ОШИБКА:', String((e as Error).message).slice(0, 120));
  }
  // 2) адаптер
  const page = await registry.transactions('ton', addr, { limit: 50 });
  console.log('адаптер: txs =', page.txs.length, 'partial =', page.partial, 'providers =', page.providers?.join(','));
  for (const t of page.txs.slice(0, 6)) {
    console.log(`  ${t.direction} ${t.amount} ${t.asset} memo=${(t.memo ?? '').slice(0, 20)} from=${t.from.slice(0, 12)}… to=${t.to.slice(0, 12)}…`);
  }
}

main();
