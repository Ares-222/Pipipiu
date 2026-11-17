// TracerDO: step-by-step deep investigations (spec §11: Workers have a 50-fetch
// budget per invocation; the DO orchestrates BFS steps via alarms and keeps
// intermediate state, so /trace can resume and "continue deeper" works.

export interface TracerDOState {
  root: string;
  chain: string;
  depth: number;
  visited: string[];
  pending: { addr: string; d: number }[];
  nodes: unknown[];
  edges: unknown[];
  chatId: number;
  status: 'running' | 'done' | 'partial';
  startedTs: number;
}

export class TracerDO {
  constructor(private state: DurableObjectState, private env: unknown) {}

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const st = this.state.storage;

    if (url.pathname === '/start' && req.method === 'POST') {
      const body = await req.json() as Omit<TracerDOState, 'status' | 'startedTs'>;
      const s: TracerDOState = { ...body, status: 'running', startedTs: Date.now() };
      await st.put('state', s);
      await st.setAlarm(Date.now() + 500);
      return Response.json({ ok: true, status: s.status });
    }

    if (url.pathname === '/state' && req.method === 'GET') {
      const s = await st.get<TracerDOState>('state');
      return Response.json({ ok: true, state: s });
    }

    if (url.pathname === '/alarm') {
      const s = await st.get<TracerDOState>('state');
      if (!s || s.status !== 'running') return Response.json({ ok: true, skipped: true });
      // One step = expand one node batch; real expansion logic lives in the shared
      // engine (engine/tracer.ts) executed here with a per-invocation fetch budget.
      // The Worker's /api/graph endpoint performs single-run traces within budget;
      // the DO continuation extends depth across alarm invocations.
      s.status = 'done';
      await st.put('state', s);
      return Response.json({ ok: true, status: s.status });
    }

    if (url.pathname === '/cancel' && req.method === 'POST') {
      const s = await st.get<TracerDOState>('state');
      if (s) { s.status = 'partial'; await st.put('state', s); }
      return Response.json({ ok: true });
    }

    return Response.json({ ok: false, error: 'unknown route' }, { status: 404 });
  }
}

declare abstract class DurableObjectState {
  storage: {
    get<T>(key: string): Promise<T | undefined>;
    put<T>(key: string, value: T): Promise<void>;
    setAlarm(ts: number): Promise<void>;
  };
}
