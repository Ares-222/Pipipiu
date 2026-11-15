// Контрольный прогон расследования (trace) для адреса из чата: тот же runTrace,
// что вызывает бот на колбэк «🔍 Отследить по входящим». Печатает отчёт и
// дублирует его в чат админа, чтобы результат был гарантированно доставлен.
// Run: node scripts/test-trace-chat.ts [ADDR] [CHAIN]

import { makeSandbox } from './sandbox.ts';
import { BotApi } from '../worker/src/tg/bot.ts';
import { runTrace } from '../worker/src/engine/tracer.ts';
import { renderTraceResult } from '../worker/src/tg/formatter.ts';

const addr = process.argv[2] ?? 'TRKhSYVuCmNLn8a6ghuqCJ4X83usLpffF8';
const chain = (process.argv[3] ?? 'tron') as 'eth' | 'tron' | 'ton';

async function main(): Promise<void> {
  const { ctx, registry } = makeSandbox();
  const api = new BotApi(ctx);
  const adminId = ctx.cfg.adminId;

  console.log(`== trace ${chain}:${addr} ==`);
  const started = Date.now();
  const res = await runTrace(ctx, registry, chain, addr, { depth: 2 });
  const parts = renderTraceResult(res);
  const text = parts.join('\n');
  console.log(text);
  console.log(`-- fetches: ${res.fetchesUsed}, nodes: ${res.nodes.length}, edges: ${res.edges.length}, время: ${((Date.now() - started) / 1000).toFixed(1)}с`);

  await api.sendMessage(adminId, text, undefined);
  console.log(`-- отправлено в чат ${adminId} (sendMessage ok)`);
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
