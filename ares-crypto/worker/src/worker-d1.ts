// D1 implementation of DBLike (production). Mirror of MemoryDB semantics.

import type { DBLike, AmlSourceRow, MixerDepositRow, WatchRow, WatchEventRow, TraceRow, CheckRow, UserRow, ClusterRow, ErrorLogRow } from './core/db.ts';
import type { Label } from './core/types.ts';
import { normAddr } from './core/types.ts';

export interface D1StmtLike {
  bind(...vals: unknown[]): D1StmtLike;
  first<T>(): Promise<T | null>;
  all<T>(): Promise<{ results: T[] }>;
  run(): Promise<{ meta?: { last_row_id?: number; changes?: number } }>;
}
export interface D1DatabaseLike {
  prepare(sql: string): D1StmtLike;
  batch(stmts: D1StmtLike[]): Promise<unknown>;
}

const norm = (chain: string, a: string) => normAddr(chain, a);

export class D1DB implements DBLike {
  constructor(private d1: D1DatabaseLike) {}

  // ---------- labels ----------
  async getLabels(chain: string, addrs: string[]): Promise<Label[]> {
    const list = addrs.map((a) => norm(chain, a)).filter(Boolean).slice(0, 40);
    if (!list.length) return [];
    const ph = list.map(() => '?').join(',');
    const res = await this.d1.prepare(
      `SELECT chain, addr, category, name, source, confidence, added_by, updated_at FROM labels
       WHERE chain IN (?, '*') AND addr IN (${ph})`,
    ).bind(chain, ...list).all<{ chain: string; addr: string; category: string; name: string; source: string; confidence: string; added_by: string | null; updated_at: number | null }>();
    return (res.results ?? []).map((r) => ({
      chain: r.chain, addr: r.addr, category: r.category, name: r.name,
      source: r.source, confidence: r.confidence as Label['confidence'],
      addedBy: r.added_by ?? undefined, updatedTs: r.updated_at ?? undefined,
    }));
  }

  async getLabel(chain: string, addr: string): Promise<Label | null> {
    const rows = await this.getLabels(chain, [addr]);
    return rows[0] ?? null;
  }

  async upsertLabel(l: Label): Promise<void> {
    await this.d1.prepare(
      `INSERT OR REPLACE INTO labels (chain, addr, category, name, source, confidence, added_by, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(l.chain, norm(l.chain, l.addr), l.category, l.name, l.source, l.confidence, l.addedBy ?? null, Math.floor(Date.now() / 1000)).run();
  }

  async listLabels(limit: number): Promise<Label[]> {
    const res = await this.d1.prepare(
      `SELECT chain, addr, category, name, source, confidence, added_by, updated_at FROM labels LIMIT ?`,
    ).bind(limit).all<{ chain: string; addr: string; category: string; name: string; source: string; confidence: string; added_by: string | null; updated_at: number | null }>();
    return (res.results ?? []).map((r) => ({
      chain: r.chain, addr: r.addr, category: r.category, name: r.name,
      source: r.source, confidence: r.confidence as Label['confidence'],
      addedBy: r.added_by ?? undefined, updatedTs: r.updated_at ?? undefined,
    }));
  }

  async deleteLabel(chain: string, addr: string, category: string): Promise<number> {
    const r = await this.d1.prepare(
      `DELETE FROM labels WHERE chain = ? AND addr = ? AND category = ?`,
    ).bind(chain, norm(chain, addr), category).run();
    return r.meta?.changes ?? 0;
  }

  async labelCount(): Promise<number> {
    const r = await this.d1.prepare(`SELECT COUNT(*) as c FROM labels`).first<{ c: number }>();
    return r?.c ?? 0;
  }

  // ---------- aml ----------
  async getAmlSources(chain: string, addrs: string[]): Promise<AmlSourceRow[]> {
    const list = addrs.map((a) => norm(chain, a)).filter(Boolean).slice(0, 40);
    if (!list.length) return [];
    const ph = list.map(() => '?').join(',');
    const res = await this.d1.prepare(
      `SELECT chain, addr, source, severity, ref, updated_at FROM aml_sources WHERE chain IN (?, '*') AND addr IN (${ph})`,
    ).bind(chain, ...list).all<{ chain: string; addr: string; source: string; severity: string; ref: string | null; updated_at: number }>();
    return (res.results ?? []).map((r) => ({ chain: r.chain, addr: r.addr, source: r.source, severity: r.severity, ref: r.ref ?? undefined, updatedTs: r.updated_at }));
  }

  async upsertAmlSources(rows: AmlSourceRow[]): Promise<void> {
    const stmts = rows.map((r) =>
      this.d1.prepare(
        `INSERT OR REPLACE INTO aml_sources (chain, addr, source, severity, ref, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
      ).bind(r.chain, norm(r.chain, r.addr), r.source, r.severity, r.ref ?? null, r.updatedTs),
    );
    for (let i = 0; i < stmts.length; i += 50) {
      await this.d1.batch(stmts.slice(i, i + 50));
    }
  }

  async amlSourceCount(): Promise<number> {
    const r = await this.d1.prepare(`SELECT COUNT(*) as c FROM aml_sources`).first<{ c: number }>();
    return r?.c ?? 0;
  }

  async listAmlSources(limit: number): Promise<AmlSourceRow[]> {
    const res = await this.d1.prepare(`SELECT chain, addr, source, severity, ref, updated_at FROM aml_sources LIMIT ?`).bind(limit)
      .all<{ chain: string; addr: string; source: string; severity: string; ref: string | null; updated_at: number }>();
    return (res.results ?? []).map((r) => ({ chain: r.chain, addr: r.addr, source: r.source, severity: r.severity, ref: r.ref ?? undefined, updatedTs: r.updated_at }));
  }

  // ---------- mixer deposits ----------
  async upsertMixerDeposits(rows: MixerDepositRow[]): Promise<void> {
    const stmts = rows.map((r) =>
      this.d1.prepare(
        `INSERT OR IGNORE INTO tx_deposits (chain, contract, commitment, amount, ts, addr) VALUES (?, ?, ?, ?, ?, ?)`,
      ).bind(r.chain, r.contract.toLowerCase(), r.commitment, r.amount, r.ts, norm(r.chain, r.addr ?? '')),
    );
    for (let i = 0; i < stmts.length; i += 50) {
      await this.d1.batch(stmts.slice(i, i + 50));
    }
  }

  async getMixerDeposits(chain: string, contract: string, fromTs: number, toTs: number): Promise<MixerDepositRow[]> {
    const res = await this.d1.prepare(
      `SELECT chain, contract, commitment, amount, ts, addr FROM tx_deposits WHERE chain = ? AND contract = ? AND ts >= ? AND ts <= ? LIMIT 5000`,
    ).bind(chain, contract.toLowerCase(), fromTs, toTs)
      .all<{ chain: string; contract: string; commitment: string; amount: number; ts: number; addr: string | null }>();
    return (res.results ?? []).map((r) => ({ chain: r.chain, contract: r.contract, commitment: r.commitment, amount: r.amount, ts: r.ts, addr: r.addr ?? undefined }));
  }

  async mixerDepositCount(chain?: string): Promise<number> {
    const r = chain
      ? await this.d1.prepare(`SELECT COUNT(*) as c FROM tx_deposits WHERE chain = ?`).first<{ c: number }>().then((x) => x?.c ?? 0)
      : await this.d1.prepare(`SELECT COUNT(*) as c FROM tx_deposits`).first<{ c: number }>().then((x) => x?.c ?? 0);
    return r;
  }

  // ---------- clusters ----------
  async upsertClusterAddrs(rows: ClusterRow[]): Promise<void> {
    const stmts = rows.map((r) =>
      this.d1.prepare(`INSERT OR IGNORE INTO clusters (chain, cluster_id, addr) VALUES (?, ?, ?)`).bind(r.chain, r.clusterId, norm(r.chain, r.addr)),
    );
    for (let i = 0; i < stmts.length; i += 50) await this.d1.batch(stmts.slice(i, i + 50));
  }
  async getClusterAddrs(chain: string, clusterId: string): Promise<string[]> {
    const res = await this.d1.prepare(`SELECT addr FROM clusters WHERE chain = ? AND cluster_id = ?`).bind(chain, clusterId).all<{ addr: string }>();
    return (res.results ?? []).map((r) => r.addr);
  }
  async getAddrClusters(chain: string, addr: string): Promise<string[]> {
    const res = await this.d1.prepare(`SELECT cluster_id FROM clusters WHERE chain = ? AND addr = ?`).bind(chain, norm(chain, addr)).all<{ cluster_id: string }>();
    return (res.results ?? []).map((r) => r.cluster_id);
  }

  // ---------- watches ----------
  async addWatch(w: Omit<WatchRow, 'id' | 'createdAt'>): Promise<WatchRow> {
    const r = await this.d1.prepare(
      `INSERT INTO watches (chat_id, chain, addr, active, min_usd, last_state_json, last_check, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(w.chatId, w.chain, w.addr, w.active ? 1 : 0, w.minUsd, w.lastStateJson ?? null, w.lastCheck ?? null, Math.floor(Date.now() / 1000)).run();
    return { ...w, id: r.meta?.last_row_id ?? 0, createdAt: Math.floor(Date.now() / 1000) };
  }
  async getWatch(chatId: number, addr: string): Promise<WatchRow | null> {
    const r = await this.d1.prepare(`SELECT * FROM watches WHERE chat_id = ? AND addr = ?`).bind(chatId, addr).first<DbWatch>();
    return r ? rowToWatch(r) : null;
  }
  async listWatches(chatId?: number): Promise<WatchRow[]> {
    const res = chatId
      ? await this.d1.prepare(`SELECT * FROM watches WHERE chat_id = ?`).bind(chatId).all<DbWatch>()
      : await this.d1.prepare(`SELECT * FROM watches`).all<DbWatch>();
    return (res.results ?? []).map(rowToWatch);
  }
  async updateWatchState(id: number, lastStateJson: string, lastCheck: number, active?: boolean): Promise<void> {
    if (active === undefined) {
      await this.d1.prepare(`UPDATE watches SET last_state_json = ?, last_check = ? WHERE id = ?`).bind(lastStateJson, lastCheck, id).run();
    } else {
      await this.d1.prepare(`UPDATE watches SET last_state_json = ?, last_check = ?, active = ? WHERE id = ?`).bind(lastStateJson, lastCheck, active ? 1 : 0, id).run();
    }
  }
  async addWatchEvents(events: Omit<WatchEventRow, 'id'>[]): Promise<void> {
    const stmts = events.map((e) =>
      this.d1.prepare(
        `INSERT INTO watch_events (watch_id, direction, amount, asset, counterparty, label, tx_hash, ts, notified) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`,
      ).bind(e.watchId, e.direction, e.amount, e.asset, e.counterparty, e.label ?? null, e.txHash, e.ts),
    );
    for (let i = 0; i < stmts.length; i += 50) await this.d1.batch(stmts.slice(i, i + 50));
  }
  async listWatchEvents(watchIds: number[], limit: number): Promise<WatchEventRow[]> {
    if (!watchIds.length) return [];
    const ph = watchIds.map(() => '?').join(',');
    const res = await this.d1.prepare(
      `SELECT * FROM watch_events WHERE watch_id IN (${ph}) ORDER BY ts DESC LIMIT ?`,
    ).bind(...watchIds, limit).all<DbEvent>();
    return (res.results ?? []).map((r) => ({
      id: r.id, watchId: r.watch_id, direction: r.direction as 'in' | 'out', amount: r.amount, asset: r.asset,
      counterparty: r.counterparty ?? '', label: r.label ?? undefined, txHash: r.tx_hash ?? '', ts: r.ts, notified: r.notified === 1,
    }));
  }
  async markEventsNotified(ids: number[]): Promise<void> {
    for (const id of ids) {
      await this.d1.prepare(`UPDATE watch_events SET notified = 1 WHERE id = ?`).bind(id).run();
    }
  }

  // ---------- traces ----------
  async saveTrace(t: TraceRow): Promise<number> {
    const r = await this.d1.prepare(
      `INSERT INTO traces (root, chain, depth, status, state_json, result_json, chat_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(t.root, t.chain, t.depth, t.status, t.stateJson ?? null, t.resultJson ?? null, t.chatId, t.createdTs).run();
    return r.meta?.last_row_id ?? 0;
  }
  async getTrace(id: number): Promise<TraceRow | null> {
    const r = await this.d1.prepare(`SELECT * FROM traces WHERE id = ?`).bind(id).first<DbTrace>();
    return r ? {
      id: r.id, root: r.root, chain: r.chain, depth: r.depth, status: r.status,
      stateJson: r.state_json ?? undefined, resultJson: r.result_json ?? undefined,
      chatId: r.chat_id ?? 0, createdTs: r.created_at,
    } : null;
  }
  async updateTrace(id: number, patch: Partial<Pick<TraceRow, 'status' | 'stateJson' | 'resultJson'>>): Promise<void> {
    if (patch.status !== undefined) await this.d1.prepare(`UPDATE traces SET status = ? WHERE id = ?`).bind(patch.status, id).run();
    if (patch.stateJson !== undefined) await this.d1.prepare(`UPDATE traces SET state_json = ? WHERE id = ?`).bind(patch.stateJson, id).run();
    if (patch.resultJson !== undefined) await this.d1.prepare(`UPDATE traces SET result_json = ? WHERE id = ?`).bind(patch.resultJson, id).run();
  }

  // ---------- users ----------
  async getUser(chatId: number): Promise<UserRow | null> {
    const r = await this.d1.prepare(`SELECT * FROM users WHERE chat_id = ?`).bind(chatId).first<DbUser>();
    return r ? rowToUser(r) : null;
  }
  async upsertUser(u: UserRow): Promise<void> {
    await this.d1.prepare(
      `INSERT OR REPLACE INTO users (chat_id, tg_username, created_at, quota_day, quick_used, deep_used, aml_used, watches_used, settings_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(u.chatId, u.tgUsername ?? null, u.createdTs, u.quotaDay, u.quickUsed, u.deepUsed, u.amlUsed, u.watchesUsed, u.settingsJson ?? null).run();
  }
  async listUsers(): Promise<UserRow[]> {
    const res = await this.d1.prepare(`SELECT * FROM users`).all<DbUser>();
    return (res.results ?? []).map(rowToUser);
  }

  // ---------- checks ----------
  async addCheck(c: Omit<CheckRow, 'id'>): Promise<void> {
    await this.d1.prepare(
      `INSERT INTO checks (chat_id, input, chain, verdict, summary_json, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
    ).bind(c.chatId, c.input, c.chain, c.verdict, c.summaryJson ?? null, c.createdTs).run();
  }
  async listChecks(chatId: number, limit: number): Promise<CheckRow[]> {
    const res = await this.d1.prepare(`SELECT * FROM checks WHERE chat_id = ? ORDER BY created_at DESC LIMIT ?`).bind(chatId, limit).all<DbCheck>();
    return (res.results ?? []).map((r) => ({
      id: r.id, chatId: r.chat_id, input: r.input, chain: r.chain, verdict: r.verdict,
      summaryJson: r.summary_json ?? undefined, createdTs: r.created_at,
    }));
  }

  // ---------- error log ----------
  async addErrorLog(where: string, message: string): Promise<void> {
    await this.d1.prepare(`INSERT INTO error_log (ts, where_txt, message) VALUES (?, ?, ?)`).bind(Math.floor(Date.now() / 1000), where, message.slice(0, 500)).run();
  }
  async listErrorLogs(limit: number): Promise<ErrorLogRow[]> {
    const res = await this.d1.prepare(`SELECT ts, where_txt, message FROM error_log ORDER BY ts DESC LIMIT ?`).bind(limit)
      .all<{ ts: number; where_txt: string; message: string }>();
    return (res.results ?? []).map((r) => ({ ts: r.ts, where: r.where_txt, message: r.message }));
  }
}

interface DbWatch { id: number; chat_id: number; chain: string; addr: string; active: number; min_usd: number; last_state_json: string | null; last_check: number | null; created_at: number; }
interface DbEvent { id: number; watch_id: number; direction: string; amount: number; asset: string; counterparty: string | null; label: string | null; tx_hash: string | null; ts: number; notified: number; }
interface DbTrace { id: number; root: string; chain: string; depth: number; status: string; state_json: string | null; result_json: string | null; chat_id: number | null; created_at: number; }
interface DbUser { chat_id: number; tg_username: string | null; created_at: number; quota_day: string; quick_used: number; deep_used: number; aml_used: number; watches_used: number; settings_json: string | null; }
interface DbCheck { id: number; chat_id: number; input: string; chain: string; verdict: string; summary_json: string | null; created_at: number; }

function rowToWatch(r: DbWatch): WatchRow {
  return { id: r.id, chatId: r.chat_id, chain: r.chain, addr: r.addr, active: r.active === 1, minUsd: r.min_usd, lastStateJson: r.last_state_json ?? undefined, lastCheck: r.last_check === null ? undefined : r.last_check, createdAt: r.created_at };
}
function rowToUser(r: DbUser): UserRow {
  return { chatId: r.chat_id, tgUsername: r.tg_username ?? undefined, createdTs: r.created_at, quotaDay: r.quota_day, quickUsed: r.quick_used, deepUsed: r.deep_used, amlUsed: r.aml_used, watchesUsed: r.watches_used, settingsJson: r.settings_json ?? undefined };
}
