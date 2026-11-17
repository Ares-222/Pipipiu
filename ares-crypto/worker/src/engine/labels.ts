// Label engine (spec §8): "где личный, где биржа, где бот".
// Sources (priority): 1) OFAC sync  2) open datasets (scam-db, seeds)  3) provider tags
//   4) admin KB (/admin addlabel)  5) cluster inheritance.
// Honesty rule: every label carries confidence + source; UI never presents
// a label without source as fact.

import type { Label, Confidence } from '../core/types.ts';
import { normAddr } from '../core/types.ts';
import type { AppCtx } from '../core/ctx.ts';
import { cachedJson, KV_TTL } from '../core/kv.ts';

export class LabelEngine {
  private ctx: AppCtx;

  constructor(ctx: AppCtx) {
    this.ctx = ctx;
  }

  // Best label for one address (chain-aware, cluster-inherited).
  async bestLabel(chain: string, addr: string): Promise<Label | null> {
    const key = `lbl:${chain}:${normAddr(chain, addr)}`;
    const { value } = await cachedJson<Label | null>(this.ctx.kv, key, KV_TTL.labels, async () => {
      const direct = await this.ctx.db.getLabel(chain, addr);
      if (direct) return direct;
      // cluster inheritance (spec §8.5)
      const clusters = await this.ctx.db.getAddrClusters(chain, addr);
      for (const cid of clusters) {
        const members = await this.ctx.db.getClusterAddrs(chain, cid);
        for (const m of members) {
          const l = await this.ctx.db.getLabel(chain, m);
          if (l && (l.category === 'cex' || l.category === 'mixer' || l.category === 'bridge')) {
            return {
              ...l,
              addr,
              name: l.name,
              confidence: demote(l.confidence), // inherited -> demote by one step
              source: `${l.source} (кластер ${cid.slice(0, 8)})`,
            };
          }
        }
      }
      return null;
    });
    return value;
  }

  // Batch: decorate addresses with best labels (max ~40 per call to keep fetch budget).
  async bestLabels(chain: string, addrs: string[]): Promise<Map<string, Label>> {
    const out = new Map<string, Label>();
    const uniq = [...new Set(addrs)].slice(0, 40);
    const rows = await this.ctx.db.getLabels(chain, uniq);
    const byAddr = new Map<string, Label>();
    for (const l of rows) {
      const a = normAddr(chain, l.addr);
      const prev = byAddr.get(a);
      if (!prev || rank(l) > rank(prev)) byAddr.set(a, l);
    }
    // cluster inheritance for addresses without direct label
    const missing = uniq.filter((a) => !byAddr.has(normAddr(chain, a)));
    for (const a of missing) {
      const l = await this.bestLabel(chain, a);
      if (l) byAddr.set(normAddr(chain, a), l);
    }
    for (const a of uniq) {
      const l = byAddr.get(normAddr(chain, a));
      if (l) out.set(normAddr(chain, a), l);
    }
    return out;
  }

  // Check if an address is "dirty" for AML (sanctioned / mixer / scam sources).
  async dirtySources(chain: string, addrs: string[]): Promise<{ addr: string; source: string; severity: string; ref?: string }[]> {
    const uniq = [...new Set(addrs.map((a) => normAddr(chain, a)))];
    const rows = await this.ctx.db.getAmlSources(chain, uniq);
    return rows.map((r) => ({ addr: r.addr, source: r.source, severity: r.severity, ref: r.ref }));
  }

  async addLabel(l: Label): Promise<void> {
    await this.ctx.db.upsertLabel(l);
    await this.ctx.kv.delete(`lbl:${l.chain}:${normAddr(l.chain, l.addr)}`);
  }
}

function rank(l: Label): number {
  const catRank: Record<string, number> = {
    sanctioned: 100, scam: 90, mixer: 80, cex: 70, payment: 65, tgbots: 62, bridge: 60, service: 55, contract: 40, token: 40, personal: 10,
  };
  const confRank: Record<Confidence, number> = { high: 30, mid: 20, low: 10 };
  return (catRank[l.category] ?? 0) + confRank[l.confidence];
}

function demote(c: Confidence): Confidence {
  return c === 'high' ? 'mid' : 'low';
}
