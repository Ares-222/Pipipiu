// M1 smoke test: detector + adapters on real public data (spec §21 vectors).
// Run: node scripts/test-adapters.ts

import { makeSandbox, line } from './sandbox.ts';
import { detectFormat } from '../worker/src/core/detect.ts';
import { resolveInput } from '../worker/src/core/detect.ts';
import { suggestFixes } from '../worker/src/core/detect.ts';

const { ctx, registry } = makeSandbox();
const ok = (b: boolean) => (b ? 'OK' : 'FAIL');

async function main() {
  console.log('ARES CRYPTO — M1 ADAPTER SMOKE TEST');
  console.log('date:', new Date().toISOString());

  // ---- detector format matrix (§6) ----
  line('DETECTOR: format matrix');
  const vectors: [string, string][] = [
    ['0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045', 'evm-addr'],
    ['TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t', 'tron-addr'],
    ['UQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs', 'ton-addr'],
    ['0:9fe330f52e6cd28e4b9e8adf4524a4f6c344c4b8b9dc4b12c3cc7d8d9d6f7a1b', 'ton-addr'],
    ['1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa', 'btc-addr'],
    ['bc1qgdjqv0av3q56jvd82tkdjpy7gdp9ut8tlqmgrpmv24sq90ecnvqqjwvw97', 'btc-addr'],
    ['d8dA6BF26964aF9D7eEd9e03E53415D37aA96045aaaaaaaaaaaaaaaaaaaaaaaa', 'tx-hash'],
    ['9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM', 'sol-b58'],
    ['@durov', 'telegram'],
    ['durov.ton', 'ton-dns'],
    ['https://t.me/durov', 'telegram'],
  ];
  let detOk = 0;
  for (const [inp, expected] of vectors) {
    const r = detectFormat(inp);
    const kind = r[0]?.kind ?? 'none';
    const pass = kind === expected;
    if (pass) detOk++;
    console.log(`${ok(pass)}  ${inp.slice(0, 46).padEnd(46)} -> ${kind}`);
  }
  console.log(`detector: ${detOk}/${vectors.length} format vectors pass`);

  // ---- probe resolution (real network) ----
  line('DETECTOR: probe resolution (live)');
  const probeTargets = [
    'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t', // USDT contract (TRON)
    '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045', // vitalik (EVM)
    '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa', // genesis BTC
    '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM', // solana hot wallet
  ];
  for (const t of probeTargets) {
    const r = await resolveInput(t, registry, 4000);
    console.log(`${ok(!!r.kind)}  ${t.slice(0, 42).padEnd(42)} -> kind=${r.kind} chains=[${(r.candidates[0]?.chains ?? []).join(',')}] probed=[${r.probed.join(',')}]`);
  }

  // ---- TRON adapter ----
  line('TRON adapter (TronGrid + Tronscan fallback)');
  try {
    const acc = await registry.account('tron', 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t');
    console.log(`account: bal=${acc.balanceNative} TRX txCount=${acc.txCount ?? '?'} isContract=${acc.isContract} provider=${acc.provider}`);
    const p = await registry.transactions('tron', 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t', { limit: 30 });
    console.log(`txs: ${p.txs.length} (partial=${p.partial}, providers=${p.providers.join(',')})`);
    const t0 = p.txs[0];
    if (t0) console.log(`latest: ${t0.ts} ${t0.direction} ${t0.amount} ${t0.asset} ${t0.hash.slice(0, 14)}… from=${t0.from.slice(0, 10)}… to=${t0.to.slice(0, 10)}…`);
    const toks = await registry.tokens('tron', 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t');
    console.log(`tokens: ${toks.slice(0, 3).map((t) => `${t.symbol}=${t.amount}`).join(', ')}`);
  } catch (e) { console.log('TRON FAIL:', (e as Error).message); }

  // ---- TON adapter ----
  line('TON adapter (tonapi.io)');
  try {
    const acc = await registry.account('ton', 'EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs');
    console.log(`account: bal=${acc.balanceNative} TON isContract=${acc.isContract} provider=${acc.provider}`);
    const p = await registry.transactions('ton', 'EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs', { limit: 30 });
    console.log(`events parsed: ${p.txs.length} (partial=${p.partial})`);
    const t0 = p.txs[0];
    if (t0) console.log(`latest: ${t0.ts} ${t0.direction} ${t0.amount} ${t0.asset} from=${t0.from.slice(0, 12)}… to=${t0.to.slice(0, 12)}…`);
    const toks = await registry.tokens('ton', 'EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs');
    console.log(`jettons on this master: ${toks.length}`);
  } catch (e) { console.log('TON FAIL:', (e as Error).message); }

  // ---- EVM adapter (eth, polygon, arb) ----
  line('EVM adapters (Etherscan V2 free: eth/polygon/arb)');
  for (const c of ['eth', 'polygon', 'arb'] as const) {
    try {
      const acc = await registry.account(c, '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045');
      console.log(`${c}: bal=${acc.balanceNative.toFixed(6)} provider=${acc.provider}`);
      const p = await registry.transactions(c, '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045', { limit: 40 });
      const inTx = p.txs.filter((t) => t.direction === 'in').length;
      const outTx = p.txs.filter((t) => t.direction === 'out').length;
      console.log(`${c} txs: ${p.txs.length} (in=${inTx} out=${outTx} partial=${p.partial})`);
      const t0 = p.txs[0];
      if (t0) console.log(`${c} latest: ${t0.ts} ${t0.direction} ${t0.amount} ${t0.asset} kind=${t0.kind}`);
    } catch (e) { console.log(`${c} FAIL:`, (e as Error).message); }
  }
  // rpc-only chain (honest degradation)
  try {
    const acc = await registry.account('bsc', '0x28C6c06298d514Db089934071355E5743bf42d78');
    console.log(`bsc (rpc-only): bal=${acc.balanceNative.toFixed(4)} BNB partial=${acc.partial}`);
    const p = await registry.transactions('bsc', '0x28C6c06298d514Db089934071355E5743bf42d78');
    console.log(`bsc txs: ${p.txs.length} partial=${p.partial} (expected: free tier has no history)`);
  } catch (e) { console.log('bsc FAIL:', (e as Error).message); }

  // ---- BTC adapter ----
  line('BTC adapter (blockstream primary)');
  try {
    const acc = await registry.account('btc', '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa');
    console.log(`genesis: bal=${acc.balanceNative} BTC txCount=${acc.txCount}`);
    const p = await registry.transactions('btc', '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa', { limit: 5 });
    console.log(`txs: ${p.txs.length} providers=${p.providers.join(',')}`);
    const t0 = p.txs[0];
    if (t0) console.log(`latest: ts=${t0.ts} ${t0.direction} ${t0.amount} BTC fee=${t0.fee}`);
    const tx = await registry.tx('btc', 'b3c5584c6b31c7d4e5c1a1e1e0e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0');
    console.log(`fake tx lookup -> ${tx === null ? 'null (correct)' : 'WRONG'}`);
  } catch (e) { console.log('BTC FAIL:', (e as Error).message); }

  // ---- Solana adapter ----
  line('Solana adapter (public RPC, basic mode)');
  try {
    const acc = await registry.account('sol', '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM');
    console.log(`sol: bal=${acc.balanceNative} SOL partial=${acc.partial}`);
    const p = await registry.transactions('sol', '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM', { limit: 5 });
    console.log(`txs: ${p.txs.length} partial=${p.partial}`);
    const t0 = p.txs[0];
    if (t0) console.log(`latest: ts=${t0.ts} ${t0.direction} ${t0.amount} SOL`);
  } catch (e) { console.log('SOL FAIL:', (e as Error).message); }

  // ---- prices ----
  line('Prices (CoinGecko + DeFiLlama fallback)');
  const px = await ctx.prices.pricesByCgIds(['tron', 'the-open-network', 'ethereum', 'bitcoin', 'tether']);
  console.log('prices:', Object.entries(px).map(([k, v]) => `${k}=${v}`).join(' '));

  // ---- tx-hash probe (§6 ambiguity) ----
  line('TX probe by hash');
  console.log('suggestFixes("0xZZZ"):', suggestFixes('0xZZZ').join(' | '));

  const stats = ctx.breaker.status();
  console.log('\nbreaker state:', JSON.stringify(stats));
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
