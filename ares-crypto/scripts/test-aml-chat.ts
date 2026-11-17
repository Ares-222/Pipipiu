// Контрольный прогон AML-оценки: тот же buildWalletReport, что в боте,
// рендер AML-блока и доставка в чат админа.
// Run: node scripts/test-aml-chat.ts [ADDR]

import { makeSandbox } from './sandbox.ts';
import { BotApi } from '../worker/src/tg/bot.ts';
import { buildWalletReport } from '../worker/src/service/report.ts';
import { renderAml } from '../worker/src/tg/formatter.ts';

const addr = process.argv[2] ?? 'TRKhSYVuCmNLn8a6ghuqCJ4X83usLpffF8';

async function main(): Promise<void> {
  const { ctx, registry } = makeSandbox();
  const api = new BotApi(ctx);
  console.log(`== AML ${addr} ==`);
  const rep = await buildWalletReport(ctx, registry, addr);
  const aml = rep.chains[0]?.aml;
  if (!aml) { console.log('AML недоступен'); return; }
  const text = renderAml(aml);
  console.log(text);
  await api.sendMessage(ctx.cfg.adminId, text, undefined);
  console.log('-- отправлено в чат (sendMessage ok)');
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
