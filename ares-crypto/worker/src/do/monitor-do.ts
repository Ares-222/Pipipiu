// MonitorDO: chains 5-minute watch batches via alarms when the watch list exceeds
// the per-invocation budget (spec §12: batches of ~15 wallets per cron pass).

export class MonitorDO {
  constructor(private state: DurableObjectState, private env: unknown) {}

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const st = this.state.storage;

    if (url.pathname === '/continue' && req.method === 'POST') {
      const body = await req.json().catch(() => ({ offset: 0 })) as { offset?: number };
      const offset = body.offset ?? 0;
      await st.put('offset', offset);
      // schedule the next batch in ~55s (cron fires every 5 min; alarm chains batches)
      await st.setAlarm(Date.now() + 55000);
      return Response.json({ ok: true, offset });
    }

    if (url.pathname === '/alarm') {
      const offset = (await st.get<number>('offset')) ?? 0;
      // The actual cycle runs in the Worker scheduled handler via env bindings;
      // this DO only tracks offsets and schedules. The Worker reads the offset
      // via /continue-state at next cron tick.
      await st.delete('offset');
      return Response.json({ ok: true, resumedOffset: offset });
    }

    if (url.pathname === '/continue-state' && req.method === 'GET') {
      const offset = (await st.get<number>('offset')) ?? 0;
      return Response.json({ ok: true, offset });
    }

    return Response.json({ ok: false, error: 'unknown route' }, { status: 404 });
  }
}

declare abstract class DurableObjectState {
  storage: {
    get<T>(key: string): Promise<T | undefined>;
    put<T>(key: string, value: T): Promise<void>;
    delete(key: string): Promise<void>;
    setAlarm(ts: number): Promise<void>;
  };
}
