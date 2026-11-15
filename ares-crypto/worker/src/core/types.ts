// Ares Crypto — shared domain types.
// Pure TS with erasable syntax only (runs natively on Node 24 via type-stripping
// and bundles cleanly with esbuild/wrangler for Cloudflare Workers).

// ---------- chains ----------

export type ChainId = 'tron' | 'ton' | 'eth' | 'bsc' | 'polygon' | 'op' | 'arb' | 'base' | 'btc' | 'sol';

export interface ChainInfo {
  id: ChainId;
  name: string;           // human ru name
  native: string;         // native coin symbol
  decimals: number;       // native coin decimals
  coingecko: string;      // coingecko id for native coin
  explorerAddr: (a: string) => string;
  explorerTx: (h: string) => string;
}

const ex = (base: string) => ({
  explorerAddr: (a: string) => `${base}/address/${a}`,
  explorerTx: (h: string) => `${base}/tx/${h}`,
});

const tronscan = {
  explorerAddr: (a: string) => `https://tronscan.org/#/address/${a}`,
  explorerTx: (h: string) => `https://tronscan.org/#/transaction/${h}`,
};

export const CHAINS: Record<ChainId, ChainInfo> = {
  tron: { id: 'tron', name: 'TRON', native: 'TRX', decimals: 6, coingecko: 'tron', ...tronscan },
  ton: {
    id: 'ton', name: 'TON', native: 'TON', decimals: 9, coingecko: 'the-open-network',
    explorerAddr: (a: string) => `https://tonviewer.com/${a}`,
    explorerTx: (h: string) => `https://tonviewer.com/transaction/${h}`,
  },
  eth: { id: 'eth', name: 'Ethereum', native: 'ETH', decimals: 18, coingecko: 'ethereum', ...ex('https://etherscan.io') },
  bsc: { id: 'bsc', name: 'BNB Chain', native: 'BNB', decimals: 18, coingecko: 'binancecoin', ...ex('https://bscscan.com') },
  polygon: { id: 'polygon', name: 'Polygon', native: 'POL', decimals: 18, coingecko: 'matic-network', ...ex('https://polygonscan.com') },
  op: { id: 'op', name: 'Optimism', native: 'ETH', decimals: 18, coingecko: 'ethereum', ...ex('https://optimistic.etherscan.io') },
  arb: { id: 'arb', name: 'Arbitrum', native: 'ETH', decimals: 18, coingecko: 'ethereum', ...ex('https://arbiscan.io') },
  base: { id: 'base', name: 'Base', native: 'ETH', decimals: 18, coingecko: 'ethereum', ...ex('https://basescan.org') },
  btc: { id: 'btc', name: 'Bitcoin', native: 'BTC', decimals: 8, coingecko: 'bitcoin', ...ex('https://mempool.space') },
  sol: {
    id: 'sol', name: 'Solana', native: 'SOL', decimals: 9, coingecko: 'solana',
    explorerAddr: (a: string) => `https://solscan.io/account/${a}`,
    explorerTx: (h: string) => `https://solscan.io/tx/${h}`,
  },
};

export const EVM_CHAINS: ChainId[] = ['eth', 'bsc', 'polygon', 'op', 'arb', 'base'];
export const EVM_CHAINID: Record<string, number> = { eth: 1, bsc: 56, polygon: 137, op: 10, arb: 42161, base: 8453 };

// ---------- transactions / accounts ----------

export type TxKind = 'tx' | 'internal' | 'token' | 'jetton';
export type Direction = 'in' | 'out' | 'self';

export interface Label {
  chain: string;              // ChainId or '*' for cross-chain (OFAC etc.)
  addr: string;               // lowercase
  category: string;           // LabelCategory
  name: string;
  source: string;
  confidence: Confidence;
  addedBy?: string;
  updatedTs?: number;
}

export interface Tx {
  hash: string;
  chain: ChainId;
  ts: number;                 // unix seconds
  from: string;
  to: string;
  amount: number;             // human units
  asset: string;              // 'TRX' | 'USDT' | 'ETH' | 'BTC' | ...
  contract?: string;
  fee: number;                // native units
  direction: Direction;       // relative to the queried address
  kind: TxKind;
  memo?: string;
  labelFrom?: Label | null;
  labelTo?: Label | null;
}

export interface TokenBalance {
  symbol: string;
  contract?: string;
  amount: number;
  decimals: number;
  priceUsd?: number;
}

export interface Nft {
  name: string;
  collectionName?: string;
  kind?: 'username' | 'number' | 'dns' | 'other';
  address?: string;
  saleTs?: number;
}

export interface Account {
  chain: ChainId;
  addr: string;
  balanceNative: number;
  balanceUsd?: number;
  tokens: TokenBalance[];
  txCount?: number;
  firstTxTs?: number;
  lastTxTs?: number;
  createdAt?: number;
  isContract?: boolean;
  provider: string;
  partial?: boolean;
  providers?: string[];
}

export interface Page { limit?: number; cursor?: string; }

export interface TxPage {
  txs: Tx[];
  next?: string;
  partial?: boolean;
  providers: string[];
}

// ---------- adapter ----------

export interface ChainAdapter {
  chain: ChainId;
  detect(addr: string): boolean;
  account(addr: string): Promise<Account>;
  transactions(addr: string, page?: Page): Promise<TxPage>;
  tx(hash: string): Promise<Tx | null>;
  tokens(addr: string): Promise<TokenBalance[]>;
  nfts?(addr: string): Promise<Nft[]>;
  priceUsd(): Promise<number | undefined>;
  // light existence probe for input detection (spec §6: 3s budget); falls back to account()
  probe?(addr: string): Promise<boolean>;
}

// ---------- profile ----------

export interface Kpi {
  received: number; receivedCount: number;
  sent: number; sentCount: number;
  settledPct: number;                     // (received - sent) / received
  counterpartiesIn: number;
  counterpartiesOut: number;
  turnover: number;
  avgTx: number;
  medianTx: number;
  maxTx: number;
  activeDays: number;
  ageDays: number | null;
}

export type Severity = 'red' | 'yellow' | 'blue' | 'gray';

export interface FindingAddress {
  addr: string;
  label?: string;
  amounts?: string;   // human-readable "↓190 000 ↑15 000 ×3"
}

export interface Finding {
  id: string;
  severity: Severity;
  title: string;
  detail: string;
  addresses?: FindingAddress[];
  graphRef?: boolean;
}

export interface RoleScores {
  fanout: number;      // раздача
  fanin: number;       // сбор
  auto: number;        // автомат/скрипт
  cexService: number;  // биржа/сервис
  transit: number;     // транзит
  personal: number;    // личный
}

export interface Classification {
  title: string;
  confidence: 'high' | 'mid' | 'low';
  scores: RoleScores;
}

export interface TransitPair {
  delayMin: number;
  inAmount: number;
  outAmount: number;
  to: string;
  toLabel?: string;
}

export interface TransitInfo {
  matched: number;
  ofIn: number;
  pct: number;
  medianHoldMin: number | null;
  under60Pct: number;   // % пар быстрее 60 мин
  top: TransitPair[];
}

export interface AmlHit {
  source: string;          // e.g. 'ofac', 'mixer:tornado:eth', 'scam-db'
  label?: string;
  severity: string;
  hops: number;
  path?: string[];         // addr chain from target to dirty source
  volumeShare: number;
  contactTs?: number;
  score: number;           // 0..100 contribution
  ref?: string;
}

export interface AmlResult {
  score: number;           // 0..100
  level: 'clean' | 'low' | 'medium' | 'high' | 'critical';
  hits: AmlHit[];
  exchangeExit: { addr: string; label: string }[];
  disclaimer: string;
}

export interface ChainReport {
  chain: ChainId;
  account: Account;
  txs: Tx[];
  kpi?: Kpi;
  findings: Finding[];
  classification?: Classification;
  transit?: TransitInfo;
  aml?: AmlResult;
  telegram?: TelegramOsint;   // TON only
  partial?: boolean;
  providers?: string[];
}

export interface TelegramOsint {
  usernames: { username: string; confidence: Confidence; acquiredTs?: number }[];
  numbers: { number: string; confidence: Confidence; acquiredTs?: number }[];
  domains: { domain: string; confidence: Confidence; expiringTs?: number }[];
  otherNft: { name: string; collection: string }[];
  note?: string;
}

export interface WalletReport {
  input: string;
  createdAt: number;
  chains: ChainReport[];
  verdict: { score: number; level: 'clean' | 'low' | 'medium' | 'high' | 'critical'; reasons: string[] };
  warnings: string[];
}

// ---------- graph / tracer ----------

export interface GraphNode {
  id: string;               // chain:addr
  chain: string;
  addr: string;
  label?: string;
  category?: string;
  volume: number;
  in: number;
  out: number;
  txCount: number;
  isRoot?: boolean;
  role?: string;            // cex/mixer/personal/...
}

export interface GraphEdge {
  from: string;
  to: string;
  amount: number;
  asset: string;
  txCount: number;
  firstTs: number;
  lastTs: number;
  probable?: boolean;       // unmix link
  p?: number;
  via?: string;             // bridge/mixer contract addr
}

export interface UnmixFinding {
  mixer: string;
  mixerLabel?: string;
  deposits: { addr: string; amount: number; ts: number }[];
  outputs: { addr: string; amount: number; ts: number }[];
  links: { from: string; to: string; amount: number; p: number }[];
  note: string;
}

export interface TraceResult {
  root: string;
  chain: string;
  depth: number;
  nodes: GraphNode[];
  edges: GraphEdge[];
  leaks: { addr: string; label?: string; amount: number; asset: string; share: number }[];
  findings: string[];
  unmix?: UnmixFinding[];
  truncated?: boolean;
  providersUsed: string[];
  fetchesUsed: number;
}

// ---------- input detection ----------

export type InputKind = 'evm-addr' | 'tron-addr' | 'ton-addr' | 'btc-addr' | 'sol-b58' | 'tx-hash' | 'telegram' | 'ton-dns';

export interface DetectCandidate {
  kind: InputKind;
  chains: ChainId[];        // possible chains to probe
  clean: string;            // normalized input
}

// ---------- misc ----------

export type Confidence = 'high' | 'mid' | 'low';

export interface LabelCategoryInfo { key: string; ru: string; color: string; icon: string; }
export const LABEL_CATEGORIES: Record<string, LabelCategoryInfo> = {
  cex: { key: 'cex', ru: 'Биржа', color: '#FF2800', icon: '🏦' },
  payment: { key: 'payment', ru: 'Платёжный сервис', color: '#F59E0B', icon: '💳' },
  mixer: { key: 'mixer', ru: 'Миксер', color: '#A855F7', icon: '🌀' },
  bridge: { key: 'bridge', ru: 'Мост', color: '#3B82F6', icon: '🌉' },
  scam: { key: 'scam', ru: 'Скам/фишинг', color: '#FF2800', icon: '⚠️' },
  sanctioned: { key: 'sanctioned', ru: 'Санкционный', color: '#000000', icon: '⛔' },
  contract: { key: 'contract', ru: 'Смарт-контракт', color: '#6B7280', icon: '📜' },
  service: { key: 'service', ru: 'Telegram-сервис/бот', color: '#38BDF8', icon: '🤖' },
  personal: { key: 'personal', ru: 'Личный', color: '#9CA3AF', icon: '👤' },
};

export const DISCLAIMER =
  'Публичные блокчейн-данные. Вероятностные оценки. Не является финансовым советом или юридическим доказательством.';
