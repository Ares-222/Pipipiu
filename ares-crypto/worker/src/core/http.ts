// HTTP layer: timeout, 1 retry with jitter, per-provider circuit breaker,
// fetch accounting (50 subrequests limit on Workers free plan).

export interface FetchStat {
  provider: string;
  ms: number;
  ok: boolean;
  status?: number;
  err?: string;
}

export class CircuitBreaker {
  private fails = new Map<string, number>();
  private disabledUntil = new Map<string, number>();
  readonly threshold = 3;
  readonly coolDownMs = 5 * 60 * 1000;

  isOpen(provider: string, now = Date.now()): boolean {
    const until = this.disabledUntil.get(provider) ?? 0;
    return now < until;
  }
  recordFail(provider: string, now = Date.now()): void {
    const n = (this.fails.get(provider) ?? 0) + 1;
    this.fails.set(provider, n);
    if (n >= this.threshold) this.disabledUntil.set(provider, now + this.coolDownMs);
  }
  recordOk(provider: string): void {
    this.fails.set(provider, 0);
    this.disabledUntil.delete(provider);
  }
  status(): { provider: string; fails: number; disabledUntil: number }[] {
    const out: { provider: string; fails: number; disabledUntil: number }[] = [];
    for (const [p, f] of this.fails) out.push({ provider: p, fails: f, disabledUntil: this.disabledUntil.get(p) ?? 0 });
    return out;
  }
}

export interface FetchOpts {
  provider: string;
  timeoutMs?: number;      // default 8000 per spec §7
  retries?: number;        // default 1
  headers?: Record<string, string>;
  method?: string;
  body?: string;
  breaker?: CircuitBreaker;
  stats?: FetchStat[];
  allow404?: boolean;      // 404 = "not found" result (null), no breaker penalty
}

const globalStats: FetchStat[] = [];

export function fetchCount(): number {
  return globalStats.length;
}
export function resetFetchCount(): void {
  globalStats.length = 0;
}
export function getStats(): FetchStat[] {
  return globalStats;
}

export async function fetchJson<T = unknown>(url: string, opts: FetchOpts): Promise<T> {
  const timeoutMs = opts.timeoutMs ?? 8000;
  const retries = opts.retries ?? 1;
  const breaker = opts.breaker;

  if (breaker?.isOpen(opts.provider)) {
    throw new Error(`provider ${opts.provider} is circuit-open (degraded)`);
  }

  let lastErr: unknown = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const t0 = Date.now();
    try {
      const res = await fetch(url, {
        method: opts.method ?? 'GET',
        headers: opts.headers,
        body: opts.body,
        signal: ctrl.signal,
      });
      const ms = Date.now() - t0;
      clearTimeout(timer);
      if (res.status === 404 && opts.allow404) {
        const nf: FetchStat = { provider: opts.provider, ms, ok: true, status: 404 };
        opts.stats?.push(nf); globalStats.push(nf);
        breaker?.recordOk(opts.provider);
        return null as T;
      }
      if (!res.ok) {
        const stat: FetchStat = { provider: opts.provider, ms, ok: false, status: res.status };
        opts.stats?.push(stat); globalStats.push(stat);
        breaker?.recordFail(opts.provider);
        // 4xx (except 429) — do not retry: client error.
        if (res.status === 429) throw new Error(`HTTP 429 rate-limited by ${opts.provider}`);
        throw new Error(`HTTP ${res.status} from ${opts.provider}`);
      }
      const json = (await res.json()) as T;
      const okStat: FetchStat = { provider: opts.provider, ms, ok: true };
      opts.stats?.push(okStat); globalStats.push(okStat);
      breaker?.recordOk(opts.provider);
      return json;
    } catch (e: unknown) {
      clearTimeout(timer);
      lastErr = e;
      const ms = Date.now() - t0;
      if (!(e instanceof Error && /HTTP \d+/.test(e.message) && !/429/.test(e.message))) {
        const stat: FetchStat = { provider: opts.provider, ms, ok: false, err: String((e as Error)?.message ?? e) };
        opts.stats?.push(stat); globalStats.push(stat);
        breaker?.recordFail(opts.provider);
      }
      if (attempt < retries) {
        // jittered backoff 300-800ms
        await new Promise((r) => setTimeout(r, 300 + Math.floor(Math.random() * 500)));
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

export async function fetchAny<T>(providers: { name: string; run: () => Promise<T> }[]): Promise<{ value: T; providers: string[]; partial: boolean }> {
  const used: string[] = [];
  for (const p of providers) {
    try {
      const value = await p.run();
      used.push(p.name);
      return { value, providers: used, partial: used.length > 1 };
    } catch {
      // try next provider
    }
  }
  throw new Error(`all providers failed: ${providers.map((p) => p.name).join(', ')}`);
}
