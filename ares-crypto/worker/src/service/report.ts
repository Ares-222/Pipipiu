// Report service — THE single source of truth (bot, Mini App, photo card, PDF all
// render from WalletReport). Budget-aware: ≤ ~30 fetches per report (Workers 50 limit).

import type { WalletReport, ChainReport, ChainId, Tx, Label, TokenBalance } from '../core/types.ts';
import { CHAINS } from '../core/types.ts';
import type { AppCtx } from '../core/ctx.ts';
import type { AdapterRegistry } from '../adapters/registry.ts';
import { resolveInput } from '../core/detect.ts';
import { cachedJson, KV_TTL } from '../core/kv.ts';
import { buildProfile } from '../engine/profile.ts';
import { LabelEngine } from '../engine/labels.ts';
import { scoreAml, combineVerdict } from '../engine/aml.ts';
import { telegramLinks, resolveTelegram, resolveTonDomain } from '../engine/tonosint.ts';
import { activityFingerprint, dustFinding } from '../engine/insights.ts';

export interface ReportOpts {
  txLimit?: number;       // default 200 moves per chain
  withAml?: boolean;      // default true
  deep?: boolean;         // trace-depth mode budget marker
}

const MAX_CHAINS = 4;

export async function buildWalletReport(
  ctx: AppCtx,
  registry: AdapterRegistry,
  rawInput: string,
  opts: ReportOpts = {},
): Promise<WalletReport> {
  const now = ctx.now();
  const warnings: string[] = [];
  const labelsEngine = new LabelEngine(ctx);

  // --- input resolution (spec §6) ---
  const resolved = await resolveInput(rawInput, registry, 3000);
  let addr: string;
  let chains: ChainId[];
  let telegramHint: WalletReport['chains'][number]['telegram'] | undefined;

  if (resolved.kind === 'telegram' || resolved.kind === 'ton-dns') {
    const q = resolved.clean!;
    let found: { addr?: string; confidence?: string; note?: string } | null = null;
    if (resolved.kind === 'telegram') found = await resolveTelegram(ctx, q);
    else found = await resolveTonDomain(ctx, q);
    if (!found?.addr) {
      const note = resolved.kind === 'telegram'
        ? `Юзернейм ${q} не привязан к TON-кошельку через TON DNS (или привязки нет). Проверь NFT-username у конкретного адреса напрямую.`
        : `Домен ${q} не найден или не резолвится.`;
      return {
        input: rawInput, createdAt: now, chains: [], warnings: [note],
        verdict: { score: 0, level: 'clean', reasons: [] },
      };
    }
    addr = found.addr;
    chains = ['ton'];
    telegramHint = resolved.kind === 'ton-dns'
      ? {
        usernames: [], numbers: [],
        domains: [{ domain: resolved.clean!.endsWith('.ton') ? resolved.clean! : resolved.clean! + '.ton', confidence: 'high' as const }],
        otherNft: [], note: found.note,
      }
      : {
        usernames: [{ username: '@' + q.replace(/^@/, ''), confidence: 'mid' as const }],
        numbers: [], domains: [], otherNft: [], note: found.note,
      };
  } else {
    const cand = resolved.candidates[0];
    addr = resolved.clean ?? cand?.clean ?? '';
    chains = cand?.chains ?? [];
    if (resolved.kind === null || !addr) {
      return {
        input: rawInput, createdAt: now, chains: [], warnings: [
          'Не распознал формат ввода. Пришли адрес кошелька (TRON/TON/ETH/BTC/Solana), хэш транзакции, @username или .ton-домен.',
        ],
        verdict: { score: 0, level: 'clean', reasons: [] },
      };
    }
  }

  // EVM chains found empty -> still keep eth as candidate with honest warning
  const evmFound = chains.filter((c) => c !== 'eth' && c !== 'bsc' && c !== 'polygon' && c !== 'op' && c !== 'arb' && c !== 'base');
  if (resolved.kind === 'evm-addr' && evmFound.length === 0 && chains.includes('eth')) {
    warnings.push('В free-источниках активность адреса в EVM-сетях не найдена (это нормально для нового адреса).');
  }
  chains = chains.slice(0, MAX_CHAINS);

  // --- per-chain data collection ---
  const chainReports: ChainReport[] = [];
  const priceSymbols = new Set<string>();

  for (const chain of chains) {
    const adapter = registry.get(chain);
    if (!adapter) continue;
    try {
      const { value: account } = await cachedJson(ctx.kv, `prof:${chain}:${addr}`, KV_TTL.profile, () => adapter.account(addr!));
      const { value: txPage } = await cachedJson(ctx.kv, `tx:${chain}:${addr}:0`, KV_TTL.txPage, () =>
        adapter.transactions(addr!, { limit: opts.txLimit ?? 200 }));
      const tokens: TokenBalance[] = await registry.tokens(chain, addr).catch(() => []);

      for (const t of txPage.txs) priceSymbols.add(t.asset);
      for (const t of tokens) priceSymbols.add(t.symbol);

      const cr: ChainReport = {
        chain,
        account: { ...account, tokens },
        txs: txPage.txs,
        findings: [],
        partial: txPage.partial || account.partial,
        providers: txPage.providers,
      };
      if (chain === 'ton') {
        const osint = await telegramLinks(ctx, addr).catch(() => undefined);
        if (osint) cr.telegram = telegramHint ? mergeTelegram(osint, telegramHint) : osint;
      }
      chainReports.push(cr);
    } catch (e) {
      warnings.push(`${CHAINS[chain].name}: источник недоступен (${(e as Error).message.slice(0, 80)}) — показаны данные других сетей.`);
    }
  }

  // --- prices (single batch call) ---
  const priceIds: string[] = [];
  const symbolToCg: Record<string, string> = {
    TRX: 'tron', TON: 'the-open-network', ETH: 'ethereum', BNB: 'binancecoin',
    POL: 'matic-network', OP: 'optimism', ARB: 'arbitrum', BTC: 'bitcoin', SOL: 'solana',
    USDT: 'tether', USDC: 'usd-coin',
  };
  for (const s of priceSymbols) if (symbolToCg[s]) priceIds.push(symbolToCg[s]);
  const pricesMap = await ctx.prices.pricesByCgIds([...new Set(priceIds)]);
  const priceOf = (sym: string): number | undefined => {
    if (sym === 'USDT' || sym === 'USDC') return pricesMap[symbolToCg[sym]] ?? 1;
    const id = symbolToCg[sym];
    return id ? pricesMap[id] : undefined;
  };

  // --- labels for all counterparties ---
  const allCp: string[] = [];
  for (const cr of chainReports) {
    for (const t of cr.txs) allCp.push(t.from, t.to);
  }
  const labelMap = new Map<string, Label>();
  for (const cr of chainReports) {
    const cps = [...new Set(allCp.filter((a) => a && a !== addr))].slice(0, 40);
    const got = await labelsEngine.bestLabels(cr.chain, cps);
    for (const [k, v] of got) labelMap.set(`${cr.chain}:${k}`, v);
    // attach to txs
    for (const t of cr.txs) {
      t.labelFrom = got.get(t.from.toLowerCase()) ?? null;
      t.labelTo = got.get(t.to.toLowerCase()) ?? null;
    }
  }

  // --- profile + aml per chain ---
  let maxProfileRisk = 0;
  const verdictReasons: string[] = [];
  for (const cr of chainReports) {
    const prof = buildProfile({
      addr: addr!,
      txs: cr.txs,
      now,
      account: cr.account,
      labels: new Map([...labelMap.entries()].filter(([k]) => k.startsWith(`${cr.chain}:`)).map(([k, v]) => [k.split(':')[1], v])),
      priceOf: (sym) => (cr.chain === 'tron' || cr.chain === 'eth' || cr.chain === 'bsc' || cr.chain === 'polygon' || cr.chain === 'op' || cr.chain === 'arb' || cr.chain === 'base' || cr.chain === 'sol' || cr.chain === 'ton' || cr.chain === 'btc' ? priceOf(sym) : undefined),
    });
    cr.kpi = prof.kpi;
    cr.findings = prof.findings;
    cr.classification = prof.classification;
    cr.transit = prof.transit;
    maxProfileRisk = Math.max(maxProfileRisk, prof.riskScore);
    for (const f of prof.findings.slice(0, 2)) verdictReasons.push(f.title);

    if (opts.withAml !== false) {
      const aml = await scoreAml(ctx, { chain: cr.chain, addr: addr!, txs: cr.txs, now, priceOf });
      cr.aml = aml;
      for (const h of aml.hits.slice(0, 2)) verdictReasons.push(`${h.source} (${h.hops === 0 ? 'прямой' : `${h.hops} хоп`})`);
    }

    // v7 (№9, №12): отпечаток активности и детект пылевых атак — считаются из
    // уже собранных txs, ноль дополнительных fetch. Попадают в карточку и PDF.
    cr.activity = activityFingerprint(cr.txs) ?? undefined;
    const dust = dustFinding(cr.txs, priceOf);
    if (dust) {
      cr.findings.push(dust);
      verdictReasons.push(dust.title);
    }
  }

  const amlScore = Math.max(0, ...chainReports.map((c) => c.aml?.score ?? 0));
  const verdict = combineVerdict(maxProfileRisk, amlScore);

  return {
    input: rawInput,
    createdAt: now,
    chains: chainReports,
    verdict: { ...verdict, reasons: verdictReasons.slice(0, 6) },
    warnings,
  };
}

// --- transaction card (spec §7: navigation core) ---
export interface TxCard {
  chain: ChainId;
  hash: string;
  status: 'success' | 'failed' | 'pending' | 'unknown';
  ts: number;
  from: string;
  to: string;
  amount: number;
  asset: string;
  contract?: string;
  fee: number;
  feeAsset: string;
  memo?: string;
  nonce?: number;
  labelFrom?: Label | null;
  labelTo?: Label | null;
  explorerUrl: string;
}

export async function buildTxCard(
  ctx: AppCtx,
  registry: AdapterRegistry,
  chain: ChainId,
  hash: string,
): Promise<TxCard | null> {
  const adapter = registry.get(chain);
  if (!adapter) return null;
  const tx = await adapter.tx(hash);
  if (!tx) return null;
  const labelsEngine = new LabelEngine(ctx);
  const l1 = await labelsEngine.bestLabel(chain, tx.from).catch(() => null);
  const l2 = await labelsEngine.bestLabel(chain, tx.to).catch(() => null);
  tx.labelFrom = l1;
  tx.labelTo = l2;
  return {
    chain, hash,
    status: tx.amount > 0 ? 'success' : 'unknown',
    ts: tx.ts,
    from: tx.from, to: tx.to,
    amount: tx.amount, asset: tx.asset,
    contract: tx.contract,
    fee: tx.fee, feeAsset: CHAINS[chain].native,
    memo: tx.memo,
    explorerUrl: CHAINS[chain].explorerTx(hash),
    labelFrom: l1, labelTo: l2,
  };
}

function mergeTelegram(a: NonNullable<ChainReport['telegram']>, b: NonNullable<ChainReport['telegram']>): NonNullable<ChainReport['telegram']> {
  return {
    usernames: [...a.usernames, ...b.usernames],
    numbers: [...a.numbers, ...b.numbers],
    domains: [...a.domains, ...b.domains],
    otherNft: [...a.otherNft, ...b.otherNft],
    note: a.note ?? b.note,
  };
}
