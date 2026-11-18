// Database abstraction: domain-level methods only (no raw SQL in business logic).
// Production impl: Cloudflare D1 (see worker/src/worker-d1.ts).
// Sandbox impl: in-memory (this file) — lets every engine be smoke-tested locally.

import type { Label } from './types.ts';
import { normAddr } from './types.ts';

export interface AmlSourceRow {
  chain: string; addr: string; source: string; severity: string; ref?: string; updatedTs: number;
}
export interface MixerDepositRow {
  chain: string; contract: string; commitment: string; amount: number; ts: number; addr?: string;
}
export interface WatchRow {
  id: number; chatId: number; chain: string; addr: string; active: boolean;
  minUsd: number; lastStateJson?: string; lastCheck?: number; createdAt: number;
}
export interface WatchEventRow {
  id: number; watchId: number; direction: 'in' | 'out'; amount: number; asset: string;
  counterparty: string; label?: string; txHash: string; ts: number; notified: boolean;
}
export interface TraceRow {
  id?: number; root: string; chain: string; depth: number; status: string;
  stateJson?: string; resultJson?: string; chatId: number; createdTs: number;
}
export interface CheckRow {
  id?: number; chatId: number; input: string; chain: string; verdict: string;
  summaryJson?: string; createdTs: number;
}
export interface UserRow {
  chatId: number; tgUsername?: string; createdTs: number;
  quotaDay: string; quickUsed: number; deepUsed: number; amlUsed: number; watchesUsed: number;
  settingsJson?: string;
}
export interface ClusterRow { chain: string; clusterId: string; addr: string; }
export interface ErrorLogRow { ts: number; where: string; message: string; }

export interface DBLike {
  // labels
  getLabels(chain: string, addrs: string[]): Promise<Label[]>;
  getLabel(chain: string, addr: string): Promise<Label | null>;
  upsertLabel(l: Label): Promise<void>;
  listLabels(limit: number): Promise<Label[]>;
  deleteLabel(chain: string, addr: string, category: string): Promise<number>;
  labelCount(): Promise<number>;

  // aml sources (dirty addresses registry)
  getAmlSources(chain: string, addrs: string[]): Promise<AmlSourceRow[]>;
  upsertAmlSources(rows: AmlSourceRow[]): Promise<void>;
  amlSourceCount(): Promise<number>;
  listAmlSources(limit: number): Promise<AmlSourceRow[]>;

  // mixer deposits index
  upsertMixerDeposits(rows: MixerDepositRow[]): Promise<void>;
  getMixerDeposits(chain: string, contract: string, fromTs: number, toTs: number): Promise<MixerDepositRow[]>;
  mixerDepositCount(chain?: string): Promise<number>;

  // clusters (chain, clusterId, addr)
  upsertClusterAddrs(rows: ClusterRow[]): Promise<void>;
  getClusterAddrs(chain: string, clusterId: string): Promise<string[]>;
  getAddrClusters(chain: string, addr: string): Promise<string[]>;

  // watches
  addWatch(w: Omit<WatchRow, 'id' | 'createdAt'>): Promise<WatchRow>;
  getWatch(chatId: number, addr: string): Promise<WatchRow | null>;
  listWatches(chatId?: number): Promise<WatchRow[]>;
  updateWatchState(id: number, lastStateJson: string, lastCheck: number, active?: boolean): Promise<void>;
  addWatchEvents(events: Omit<WatchEventRow, 'id'>[]): Promise<void>;
  listWatchEvents(watchIds: number[], limit: number, sinceTs?: number): Promise<WatchEventRow[]>;
  markEventsNotified(ids: number[]): Promise<void>;
  updateWatchMinUsd(id: number, minUsd: number): Promise<void>;

  // traces (deep investigations)
  saveTrace(t: TraceRow): Promise<number>;
  getTrace(id: number): Promise<TraceRow | null>;
  updateTrace(id: number, patch: Partial<Pick<TraceRow, 'status' | 'stateJson' | 'resultJson'>>): Promise<void>;
  listTraces(chatId: number, limit: number): Promise<TraceRow[]>;

  // users & quotas
  getUser(chatId: number): Promise<UserRow | null>;
  upsertUser(u: UserRow): Promise<void>;
  listUsers(): Promise<UserRow[]>;

  // checks history
  addCheck(c: Omit<CheckRow, 'id'>): Promise<void>;
  listChecks(chatId: number, limit: number): Promise<CheckRow[]>;
  lastCheckForInput(chatId: number, input: string): Promise<CheckRow | null>;

  // error log
  addErrorLog(where: string, message: string): Promise<void>;
  listErrorLogs(limit: number): Promise<ErrorLogRow[]>;
}

// ---------- in-memory implementation ----------

export class MemoryDB implements DBLike {
  labels: Label[] = [];
  aml: AmlSourceRow[] = [];
  deposits: MixerDepositRow[] = [];
  clusters: ClusterRow[] = [];
  watches: WatchRow[] = [];
  watchEvents: WatchEventRow[] = [];
  traces: TraceRow[] = [];
  users: UserRow[] = [];
  checks: CheckRow[] = [];
  errors: ErrorLogRow[] = [];
  private nextId = { watch: 1, trace: 1 };

  async getLabels(chain: string, addrs: string[]): Promise<Label[]> {
    const set = new Set(addrs.map((a) => normAddr(chain, a)));
    return this.labels.filter((l) => (l.chain === chain || l.chain === '*') && set.has(normAddr(chain, l.addr)));
  }
  async getLabel(chain: string, addr: string): Promise<Label | null> {
    const a = normAddr(chain, addr);
    return this.labels.find((l) => (l.chain === chain || l.chain === '*') && normAddr(chain, l.addr) === a) ?? null;
  }
  async upsertLabel(l: Label): Promise<void> {
    const a = normAddr(l.chain, l.addr);
    const i = this.labels.findIndex((x) => x.chain === l.chain && normAddr(l.chain, x.addr) === a && x.category === l.category && x.name === l.name);
    l.updatedTs = Date.now();
    if (i >= 0) this.labels[i] = { ...this.labels[i], ...l, addr: a };
    else this.labels.push({ ...l, addr: a });
  }
  async listLabels(limit: number): Promise<Label[]> { return this.labels.slice(0, limit); }
  async deleteLabel(chain: string, addr: string, category: string): Promise<number> {
    const a = normAddr(chain, addr);
    const before = this.labels.length;
    this.labels = this.labels.filter((l) => !(l.chain === chain && normAddr(chain, l.addr) === a && l.category === category));
    return before - this.labels.length;
  }
  async labelCount(): Promise<number> { return this.labels.length; }

  async getAmlSources(chain: string, addrs: string[]): Promise<AmlSourceRow[]> {
    const set = new Set(addrs.map((a) => normAddr(chain, a)));
    return this.aml.filter((r) => (r.chain === chain || r.chain === '*') && set.has(normAddr(chain, r.addr)));
  }
  async upsertAmlSources(rows: AmlSourceRow[]): Promise<void> {
    for (const r of rows) {
      const i = this.aml.findIndex((x) => x.chain === r.chain && normAddr(r.chain, x.addr) === normAddr(r.chain, r.addr) && x.source === r.source);
      if (i >= 0) this.aml[i] = { ...this.aml[i], ...r };
      else this.aml.push(r);
    }
  }
  async amlSourceCount(): Promise<number> { return this.aml.length; }
  async listAmlSources(limit: number): Promise<AmlSourceRow[]> { return this.aml.slice(0, limit); }

  async upsertMixerDeposits(rows: MixerDepositRow[]): Promise<void> {
    for (const r of rows) {
      const key = (x: MixerDepositRow) => `${x.chain}|${x.contract}|${x.commitment}`;
      const i = this.deposits.findIndex((x) => key(x) === key(r));
      if (i >= 0) this.deposits[i] = r; // refresh (e.g. ts fixed after re-index)
      else this.deposits.push(r);
    }
  }
  async getMixerDeposits(chain: string, contract: string, fromTs: number, toTs: number): Promise<MixerDepositRow[]> {
    return this.deposits.filter((d) => d.chain === chain && d.contract.toLowerCase() === contract.toLowerCase() && d.ts >= fromTs && d.ts <= toTs);
  }
  async mixerDepositCount(chain?: string): Promise<number> {
    return chain ? this.deposits.filter((d) => d.chain === chain).length : this.deposits.length;
  }

  async upsertClusterAddrs(rows: ClusterRow[]): Promise<void> {
    for (const r of rows) {
      const i = this.clusters.findIndex((x) => x.chain === r.chain && x.clusterId === r.clusterId && x.addr.toLowerCase() === r.addr.toLowerCase());
      if (i < 0) this.clusters.push({ ...r, addr: r.addr.toLowerCase() });
    }
  }
  async getClusterAddrs(chain: string, clusterId: string): Promise<string[]> {
    return this.clusters.filter((c) => c.chain === chain && c.clusterId === clusterId).map((c) => c.addr);
  }
  async getAddrClusters(chain: string, addr: string): Promise<string[]> {
    const a = normAddr(chain, addr);
    return this.clusters.filter((c) => c.chain === chain && c.addr === a).map((c) => c.clusterId);
  }

  async addWatch(w: Omit<WatchRow, 'id' | 'createdAt'>): Promise<WatchRow> {
    const row: WatchRow = { ...w, id: this.nextId.watch++, createdAt: Math.floor(Date.now() / 1000) };
    this.watches.push(row);
    return row;
  }
  async getWatch(chatId: number, addr: string): Promise<WatchRow | null> {
    return this.watches.find((w) => w.chatId === chatId && w.addr === addr) ?? null;
  }
  async listWatches(chatId?: number): Promise<WatchRow[]> {
    return chatId ? this.watches.filter((w) => w.chatId === chatId) : this.watches;
  }
  async updateWatchState(id: number, lastStateJson: string, lastCheck: number, active?: boolean): Promise<void> {
    const w = this.watches.find((x) => x.id === id);
    if (!w) return;
    w.lastStateJson = lastStateJson;
    w.lastCheck = lastCheck;
    if (active !== undefined) w.active = active;
  }
  async addWatchEvents(events: Omit<WatchEventRow, 'id'>[]): Promise<void> {
    for (const e of events) this.watchEvents.push({ ...e, id: this.watchEvents.length + 1 });
  }
  async listWatchEvents(watchIds: number[], limit: number, sinceTs?: number): Promise<WatchEventRow[]> {
    return this.watchEvents
      .filter((e) => watchIds.includes(e.watchId) && (sinceTs === undefined || e.ts >= sinceTs))
      .sort((a, b) => b.ts - a.ts).slice(0, limit);
  }
  async markEventsNotified(ids: number[]): Promise<void> {
    for (const e of this.watchEvents) if (ids.includes(e.id)) e.notified = true;
  }
  async updateWatchMinUsd(id: number, minUsd: number): Promise<void> {
    const w = this.watches.find((x) => x.id === id);
    if (w) w.minUsd = minUsd;
  }

  async saveTrace(t: TraceRow): Promise<number> {
    const row = { ...t, id: this.nextId.trace++ };
    this.traces.push(row);
    return row.id!;
  }
  async getTrace(id: number): Promise<TraceRow | null> {
    return this.traces.find((t) => t.id === id) ?? null;
  }
  async updateTrace(id: number, patch: Partial<Pick<TraceRow, 'status' | 'stateJson' | 'resultJson'>>): Promise<void> {
    const t = this.traces.find((x) => x.id === id);
    if (t) Object.assign(t, patch);
  }
  async listTraces(chatId: number, limit: number): Promise<TraceRow[]> {
    return this.traces
      .filter((t) => t.chatId === chatId && t.status === 'done' && !!t.resultJson)
      .sort((a, b) => b.createdTs - a.createdTs)
      .slice(0, limit)
      .map((t) => ({ ...t, resultJson: undefined }));
  }

  async getUser(chatId: number): Promise<UserRow | null> {
    return this.users.find((u) => u.chatId === chatId) ?? null;
  }
  async upsertUser(u: UserRow): Promise<void> {
    const i = this.users.findIndex((x) => x.chatId === u.chatId);
    if (i >= 0) this.users[i] = u;
    else this.users.push(u);
  }
  async listUsers(): Promise<UserRow[]> { return this.users; }

  async addCheck(c: Omit<CheckRow, 'id'>): Promise<void> {
    this.checks.push({ ...c, id: this.checks.length + 1 });
  }
  async listChecks(chatId: number, limit: number): Promise<CheckRow[]> {
    return this.checks.filter((c) => c.chatId === chatId).sort((a, b) => b.createdTs - a.createdTs).slice(0, limit);
  }
  async lastCheckForInput(chatId: number, input: string): Promise<CheckRow | null> {
    return this.checks
      .filter((c) => c.chatId === chatId && c.input === input)
      .sort((a, b) => b.createdTs - a.createdTs)[0] ?? null;
  }

  async addErrorLog(where: string, message: string): Promise<void> {
    this.errors.push({ ts: Math.floor(Date.now() / 1000), where, message: message.slice(0, 500) });
  }
  async listErrorLogs(limit: number): Promise<ErrorLogRow[]> {
    return this.errors.sort((a, b) => b.ts - a.ts).slice(0, limit);
  }
}
