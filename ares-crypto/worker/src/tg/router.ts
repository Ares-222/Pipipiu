// Command router (spec §14). Free text -> detect() -> automatic /check.

import type { AppCtx } from '../core/ctx.ts';
import type { AdapterRegistry } from '../adapters/registry.ts';
import type { TgUpdate } from './bot-types.ts';
import { BotApi } from './bot.ts';
import { buildWalletReport, buildTxCard } from '../service/report.ts';
import { renderReport, renderTxCard, renderTraceProgress, renderTraceResult, esc, renderAml } from './formatter.ts';
import type { WalletReport } from '../core/types.ts';
import { reportKb, txKb, startKb, historyKb, p2pKb, watchAlertKb } from './keyboards.ts';
import { resolveInput, suggestFixes } from '../core/detect.ts';
import { runTrace } from '../engine/tracer.ts';
import { monitorCycle, addWatch } from '../engine/monitor.ts';
import { checkQuota, incQuota, getUser, updateSettings, getSettings, quotaText } from '../engine/quota.ts';
import { telegramLinks, resolveTelegram, resolveTonDomain } from '../engine/tonosint.ts';
import { syncOfac, syncScamSniffer, downloadOfac, downloadScamSniffer } from '../engine/feeds.ts';
import { LabelEngine } from '../engine/labels.ts';
import { DISCLAIMER } from '../core/types.ts';
import { CHAINS } from '../core/types.ts';
import { fmtDate } from '../core/util.ts';

export interface RouterDeps {
  ctx: AppCtx;
  registry: AdapterRegistry;
  api: BotApi;
  botUsername?: string;
}

export async function handleUpdate(deps: RouterDeps, update: TgUpdate): Promise<void> {
  const { ctx, api } = deps;
  try {
    if (update.callback_query) {
      await handleCallback(deps, update.callback_query.data ?? '', update.callback_query.from.id, update.callback_query.id);
      return;
    }
    const msg = update.message ?? update.edited_message;
    if (!msg?.text) return;
    const chatId = msg.chat.id;
    const username = msg.from?.username;
    await getUser(ctx, chatId, username); // ensure user row exists (onboarding stats)

    const text = msg.text.trim();
    if (text.startsWith('/')) {
      const [cmdRaw, ...rest] = text.slice(1).split(/\s+/);
      const cmd = cmdRaw.split('@')[0].toLowerCase();
      const args = rest.join(' ');
      await handleCommand(deps, cmd, args, chatId);
    } else {
      await freeText(deps, chatId, text);
    }
  } catch (e) {
    const chatId = update.message?.chat.id ?? update.callback_query?.from.id;
    await ctx.db.addErrorLog('router', String((e as Error).message));
    if (chatId) {
      await api.sendMessage(chatId, friendlyError(e)).catch(() => { /* ignore */ });
    }
  }
}

function friendlyError(e: unknown): string {
  const m = String((e as Error).message ?? e);
  if (/429|rate/i.test(m)) return '⏳ Источники данных перегружены (лимит запросов). Повтори через минуту — обычно помогает.';
  if (/circuit-open/.test(m)) return '🛠 Провайдер временно отключён (авто-предохранитель), идёт работа через резервные источники. Повтори через пару минут.';
  if (/HTTP 5\d\d/.test(m)) return '☁️ Сеть блокчейнов отвечает с ошибками. Повтори через минуту.';
  return '⚠️ Что-то сломалось на нашей стороне, но данные других сетей не затронуты. Повтори запрос или проверь формат ввода.';
}

// ---------- commands ----------

async function handleCommand(deps: RouterDeps, cmd: string, args: string, chatId: number): Promise<void> {
  const { ctx, api } = deps;
  const isAdmin = ctx.isOwner(chatId);

  switch (cmd) {
    case 'start': {
      await api.sendMessage(chatId, [
        `🎯 <b>Ares Crypto-Analytics</b>`,
        ``,
        `Персональный OSINT-инструмент по криптокошелькам.`,
        `1️⃣ Пришли <b>адрес</b> (TRON/TON/ETH/BTC/Solana), хэш транзакции, <b>@username</b> или <b>.ton</b>-домен — сеть определю сам.`,
        `2️⃣ Получишь быстрый отчёт: риски, профиль поведения, куда утекают деньги.`,
        `3️⃣ Кнопки под отчётом: расследование по графу, AML-детали, мониторинг «каждые 5 минут».`,
        ``,
        `<i>${DISCLAIMER}</i>`,
      ].join('\n'), startKb(ctx.cfg.miniappUrl));
      return;
    }
    case 'help': {
      await api.sendMessage(chatId, [
        `<b>Команды Ares Crypto</b>`,
        `/check &lt;адрес&gt; — быстрый отчёт (или просто пришли адрес)`,
        `/trace &lt;адрес&gt; — расследование: граф потоков, «куда утекло», распутывание миксеров`,
        `/tx &lt;hash&gt; — разбор транзакции + переход к кошелькам`,
        `/aml &lt;адрес&gt; — только AML-скоринг с разбивкой`,
        `/profile &lt;адрес&gt; — поведенческий профиль целиком`,
        `/ton &lt;@user|.ton|адрес&gt; — связи с Telegram по публичным NFT/DNS данным`,
        `/watch, /watchlist, /unwatch — мониторинг каждые 5 минут`,
        `/p2p &lt;адрес&gt; — карточка «можно ли отдавать контрагенту»`,
        `/history — последние проверки · /settings — настройки`,
        isAdmin ? `/admin addlabel|labels|syncofac|stats|broadcast|export` : '',
        ``,
        `<i>${DISCLAIMER}</i>`,
      ].filter(Boolean).join('\n'));
      return;
    }
    case 'check': {
      if (!args) { await api.sendMessage(chatId, 'Пришли адрес после команды: <code>/check TR7NHq…</code>'); return; }
      await quickCheck(deps, chatId, args);
      return;
    }
    case 'trace': {
      if (!args) { await api.sendMessage(chatId, 'Пришли адрес: <code>/trace TR7NHq…</code>'); return; }
      await traceCmd(deps, chatId, args);
      return;
    }
    case 'tx': {
      if (!args) { await api.sendMessage(chatId, 'Пришли хэш: <code>/tx 0xabc…</code>'); return; }
      await txCmd(deps, chatId, args);
      return;
    }
    case 'aml': {
      if (!args) { await api.sendMessage(chatId, 'Пришли адрес: <code>/aml …</code>'); return; }
      const q = await checkQuota(ctx, chatId, 'aml');
      if (!q.ok) { await api.sendMessage(chatId, quotaText('aml', q.left, q.resetLocal)); return; }
      const rep = await buildWalletReport(ctx, deps.registry, args, { withAml: true });
      const aml = rep.chains[0]?.aml;
      await incQuota(ctx, chatId, 'aml');
      if (!aml) { await api.sendMessage(chatId, 'AML-оценка недоступна для этого ввода.'); return; }
      await api.sendMessage(chatId, renderAml(aml));
      return;
    }
    case 'profile': {
      if (!args) { await api.sendMessage(chatId, 'Пришли адрес: <code>/profile …</code>'); return; }
      await quickCheck(deps, chatId, args, true);
      return;
    }
    case 'ton': {
      await tonCmd(deps, chatId, args);
      return;
    }
    case 'watch': {
      if (!args) { await api.sendMessage(chatId, 'Пришли адрес: <code>/watch TR7NHq…</code> (проверка каждые 5 минут)'); return; }
      await watchCmd(deps, chatId, args);
      return;
    }
    case 'watchlist': {
      await watchlistCmd(deps, chatId);
      return;
    }
    case 'unwatch': {
      const w = args.trim();
      if (!w) { await api.sendMessage(chatId, '<code>/unwatch &lt;адрес&gt;</code> или <code>/unwatch all</code>'); return; }
      const mine = await ctx.db.listWatches(chatId);
      let removed = 0;
      for (const row of mine) {
        if (w.toLowerCase() === 'all' || row.addr.toLowerCase() === w.toLowerCase()) {
          await ctx.db.updateWatchState(row.id, row.lastStateJson ?? '{}', row.lastCheck ?? 0, false);
          removed++;
        }
      }
      await api.sendMessage(chatId, removed ? `Снял с мониторинга: ${removed}` : 'Не нашёл такой адрес в списке.');
      return;
    }
    case 'p2p': {
      if (!args) { await api.sendMessage(chatId, 'Пришли адрес контрагента: <code>/p2p …</code>'); return; }
      const rep = await buildWalletReport(ctx, deps.registry, args);
      const cr = rep.chains[0];
      if (!cr) { await api.sendMessage(chatId, esc(rep.warnings.join(' ')) || 'Контрагент не найден.'); return; }
      const k = cr.kpi;
      const top = cr.findings.slice(0, 3).map((f) => `${SEV(f.severity)} ${esc(f.title)}`).join('\n');
      const verdictRu = verdictText(rep.verdict.level);
      await api.sendMessage(chatId, [
        `🤝 <b>ПРОВЕРКА КОНТРАГЕНТА</b>`,
        `<code>${esc(args)}</code>`,
        `${verdictRu} риск ${rep.verdict.score}/100`,
        cr.classification ? `Тип: <b>${esc(cr.classification.title)}</b> (${cr.classification.confidence})` : '',
        cr.account.createdAt ? `Возраст: ${Math.floor((ctx.now() - cr.account.createdAt) / 86400)} дн.` : '',
        k ? `Оборот: ${Math.round(k.turnover)}$ · контрагентов ${k.counterpartiesIn + k.counterpartiesOut}` : '',
        top ? `Топ-риски:\n${top}` : 'Явных признаков риска не найдено (эвристика).',
        ``,
        `💬 Вердикт: ${p2pAdvice(rep.verdict.level, cr.classification?.title)}`,
        ``,
        `<i>${DISCLAIMER}</i>`,
      ].filter(Boolean).join('\n'), p2pKb(cr.chain, cr.account.addr, ctx.cfg.miniappUrl));
      return;
    }
    case 'history': {
      const checks = await ctx.db.listChecks(chatId, 10);
      if (!checks.length) { await api.sendMessage(chatId, 'Пока пусто. Пришли адрес — история появится здесь.'); return; }
      await api.sendMessage(chatId, '🕘 Последние проверки (нажми, чтобы повторить):', historyKb(checks.map((c) => ({ input: c.input, chain: c.chain, verdict: c.verdict }))));
      return;
    }
    case 'settings': {
      const s = await getSettings(ctx, chatId);
      const m = args.match(/min\s*=?\s*([\d.]+)/i);
      const d = args.match(/depth\s*=?\s*([1-4])/i);
      if (m) await updateSettings(ctx, chatId, { minAlertUsd: parseFloat(m[1]) });
      if (d) await updateSettings(ctx, chatId, { traceDepth: parseInt(d[1], 10) });
      const s2 = m || d ? await getSettings(ctx, chatId) : s;
      await api.sendMessage(chatId, [
        `⚙️ <b>Настройки</b>`,
        `· Минимальная сумма алертов: ${s2.minAlertUsd}$`,
        `· Глубина трассировки по умолчанию: ${s2.traceDepth}`,
        `· Квоты в сутки: 40 быстрых · 5 расследований · 40 AML · 5 адресов мониторинга`,
        ``,
        `Изменить: <code>/settings min=20</code> · <code>/settings depth=3</code>`,
      ].join('\n'));
      return;
    }
    case 'report': {
      // user scam flag (K2): goes to moderation queue (admin), low confidence
      if (!args) { await api.sendMessage(chatId, 'Пришли адрес: <code>/report 0x…</code> — пометить как скам (пойдёт на модерацию)'); return; }
      const l = new LabelEngine(ctx);
      await l.addLabel({ chain: '*', addr: args.trim(), category: 'scam', name: 'Скам (жалоба юзера, на модерации)', source: 'user-report', confidence: 'low', addedBy: String(chatId) });
      await api.sendMessage(chatId, '✅ Жалоба принята и ушла на модерацию админу. Метка появится в отчётах после проверки.');
      await api.sendMessage(ctx.cfg.adminId, `⚠️ <b>Жалоба на скам</b>\nот ${chatId}\nадрес: <code>${esc(args.trim())}</code>\n\nПодтвердить: /admin addlabel ${args.trim()} scam <имя>\nОтклонить: /admin rmlabel ${args.trim()} scam`).catch(() => { /* admin chat not started */ });
      return;
    }
    case 'pdf': {
      await pdfCmd(deps, chatId, args);
      return;
    }
    case 'admin': {
      if (!isAdmin) { await api.sendMessage(chatId, 'Команда только для админа.'); return; }
      await adminCmd(deps, chatId, args);
      return;
    }
    default:
      await api.sendMessage(chatId, `Не знаю команду /${esc(cmd)}. Пришли адрес или хэш — разберусь сам. /help — список.`);
  }
}

const SEV = (s: string) => (s === 'red' ? '🔴' : s === 'yellow' ? '🟡' : s === 'blue' ? '🔵' : '⚪');
const verdictText = (l: string) => ({ clean: '🟢 ЧИСТЫЙ', low: '🟢 НИЗКИЙ', medium: '🟡 СРЕДНИЙ', high: '🟠 ВЫСОКИЙ', critical: '🔴 КРИТИЧЕСКИЙ' }[l] ?? '⚪');

function p2pAdvice(level: string, classification?: string): string {
  if (level === 'critical') return 'Не отдавай крипту. Есть санкционные/скам-связи — риск блокировки и потери.';
  if (level === 'high') return 'Отдавать опасно. Свежесть профиля и связи с грязными источниками выше нормы.';
  if (level === 'medium') {
    return classification && /биржа|сервис/i.test(classification)
      ? 'Похоже на сервисный/биржевой кошелёк — допустимо с обычными предосторожностями (проверь сумму и memo).'
      : 'Осторожно: есть подозрительные признаки. Предпочитай короткие сделки и проверку после первого перевода.';
  }
  return 'Признаков риска мало. Как всегда: не отправляй всё сразу одним переводом.';
}

// ---------- flows ----------

async function quickCheck(deps: RouterDeps, chatId: number, input: string, fullProfile = false): Promise<void> {
  const { ctx, api } = deps;
  const q = await checkQuota(ctx, chatId, 'quick');
  if (!q.ok) { await api.sendMessage(chatId, quotaText('quick', q.left, q.resetLocal)); return; }
  const started = Date.now();
  const rep = await buildWalletReport(ctx, deps.registry, input);
  await incQuota(ctx, chatId, 'quick');
  const parts = renderReport(rep);
  const cr = rep.chains[0];
  if (cr) {
    await ctx.db.addCheck({ chatId, input, chain: cr.chain, verdict: `${rep.verdict.score}/100 ${rep.verdict.level}`, summaryJson: JSON.stringify({ chains: rep.chains.map((c) => c.chain) }), createdTs: ctx.now() });
  }
  await api.sendMessage(chatId, parts.join('\n'), reportKb({
    addr: cr?.account.addr ?? input,
    chain: cr?.chain ?? 'tron',
    miniappUrl: ctx.cfg.miniappUrl,
  }));
  await api.sendMessage(chatId, `⏱ Готово за ${(Date.now() - started) / 1000} сек. Что дальше: 🔍 расследование · 📸 фотокарточка · 🔔 мониторинг.`, undefined).catch(() => { /* optional */ });
  void fullProfile;
}

async function traceCmd(deps: RouterDeps, chatId: number, input: string): Promise<void> {
  const { ctx, api } = deps;
  const q = await checkQuota(ctx, chatId, 'deep');
  if (!q.ok) { await api.sendMessage(chatId, quotaText('deep', q.left, q.resetLocal)); return; }
  const resolved = await resolveInput(input, deps.registry, 3000);
  const chain = resolved.candidates[0]?.chains[0];
  const addr = resolved.clean ?? '';
  if (!chain || !addr) { await api.sendMessage(chatId, 'Не распознал адрес.'); return; }
  await incQuota(ctx, chatId, 'deep');
  const s = await getSettings(ctx, chatId);
  const traceId = await ctx.db.saveTrace({ root: addr, chain, depth: s.traceDepth, status: 'running', chatId, createdTs: ctx.now(), stateJson: '{}' });

  const started = Date.now();
  const res = await runTrace(ctx, deps.registry, chain, addr, {
    depth: s.traceDepth,
    onProgress: (step, total, expanded, note) => {
      api.sendMessage(chatId, renderTraceProgress(step, total, expanded, `${note} · ${(Date.now() - started) / 1000}с`)).catch(() => { /* ignore */ });
    },
  });
  await ctx.db.updateTrace(traceId, { status: res.truncated ? 'partial' : 'done', resultJson: JSON.stringify(res) });
  const parts = renderTraceResult(res);
  await api.sendMessage(chatId, parts.join('\n'), reportKb({ addr, chain, miniappUrl: ctx.cfg.miniappUrl }));
  await api.sendMessage(chatId, `📤 Экспорт графа: /history → JSON-дамп доступен в Mini App (кнопка ⬇ JSON). Fetch-бюджет: ${res.fetchesUsed}/30.`, undefined).catch(() => { /* ignore */ });
}

async function txCmd(deps: RouterDeps, chatId: number, hash: string): Promise<void> {
  const { api, registry } = deps;
  // probe chains for the hash (§6: eth -> tron -> ton)
  for (const chain of ['eth', 'tron', 'ton'] as const) {
    const card = await buildTxCard(deps.ctx, registry, chain, hash).catch(() => null);
    if (card && card.from) {
      await api.sendMessage(chatId, renderTxCard(card), txKb(card));
      return;
    }
  }
  await api.sendMessage(chatId, 'Транзакция не найдена ни в одном источнике (ETH/TRON/TON). Проверь хэш или укажи сеть вручную позже.');
}

async function tonCmd(deps: RouterDeps, chatId: number, arg: string): Promise<void> {
  const { ctx, api } = deps;
  if (!arg) { await api.sendMessage(chatId, 'Пришли @username, .ton-домен или TON-адрес.'); return; }
  const a = arg.trim();
  if (a.startsWith('@') || a.includes('.ton')) {
    const found = a.includes('.ton') ? await resolveTonDomain(ctx, a) : await resolveTelegram(ctx, a);
    if (!found?.addr) {
      await api.sendMessage(chatId, a.includes('.ton')
        ? `Домен ${esc(a)} не найден в TON DNS.`
        : `@${a.replace('@', '')} не привязан к TON-кошельку через TON DNS.`);
      return;
    }
    const links = await telegramLinks(ctx, found.addr).catch(() => undefined);
    await api.sendMessage(chatId, [
      `📨 <b>TON OSINT</b>`,
      `${a} → <code>${esc(found.addr)}</code>`,
      links ? '' : '(публичных NFT/доменных связей не найдено)',
      links?.usernames.length ? `Usernames: ${links.usernames.map((u) => `${u.username} (${u.confidence})`).join(', ')}` : '',
      links?.numbers.length ? `Номера: ${links.numbers.map((n) => `${n.number} (${n.confidence})`).join(', ')}` : '',
      links?.domains.length ? `Домены: ${links.domains.map((d) => `${d.domain} (${d.confidence})`).join(', ')}` : '',
      links?.note ? `<i>${esc(links.note)}</i>` : '',
      ``,
      `Полный отчёт по кошельку: пришли адрес <code>${esc(found.addr)}</code>`,
      `<i>${DISCLAIMER}</i>`,
    ].filter(Boolean).join('\n'));
    return;
  }
  const links = await telegramLinks(ctx, a).catch(() => undefined);
  await api.sendMessage(chatId, links && (links.usernames.length || links.numbers.length || links.domains.length)
    ? [
      `📨 <b>Связи с Telegram для</b> <code>${esc(a)}</code>`,
      ...links.usernames.map((u) => `· ${esc(u.username)} (${u.confidence}) → t.me/${u.username.replace('@', '')}`),
      ...links.numbers.map((n) => `· номер ${esc(n.number)} (${n.confidence})`),
      ...links.domains.map((d) => `· ${esc(d.domain)} (${d.confidence})`),
      links.note ? `<i>${esc(links.note)}</i>` : '',
    ].filter(Boolean).join('\n')
    : 'Публичных связей с Telegram не найдено (NFT usernames/номера/домены).');
}

async function watchCmd(deps: RouterDeps, chatId: number, arg: string): Promise<void> {
  const { ctx, api } = deps;
  const resolved = await resolveInput(arg, deps.registry, 3000);
  const chain = resolved.candidates[0]?.chains[0] ?? 'tron';
  const addr = resolved.clean ?? arg.trim();
  try {
    const w = await addWatch(ctx, chatId, chain, addr, (await getSettings(ctx, chatId)).minAlertUsd);
    await api.sendMessage(chatId, [
      `🔔 <b>Мониторинг включён</b>`,
      `<code>${esc(w.addr)}</code> (${esc(CHAINS[chain as keyof typeof CHAINS]?.name ?? chain)})`,
      `Проверка каждые 5 минут · фильтр сумм: от ${w.minUsd}$`,
      `Придёт пуш: «сколько и чего пришло, откуда; куда и сколько ушло» с метками контрагентов.`,
      ``,
      `Список: /watchlist · Отписать: /unwatch`,
    ].join('\n'));
  } catch (e) {
    await api.sendMessage(chatId, esc(String((e as Error).message)));
  }
}

async function watchlistCmd(deps: RouterDeps, chatId: number): Promise<void> {
  const { ctx, api } = deps;
  const mine = (await ctx.db.listWatches(chatId)).filter((w) => w.active);
  if (!mine.length) { await api.sendMessage(chatId, 'Список пуст. Добавь: <code>/watch &lt;адрес&gt;</code>'); return; }
  const ids = mine.map((w) => w.id);
  const events = await ctx.db.listWatchEvents(ids, 10);
  const lines = mine.map((w) => `· <code>${esc(w.addr)}</code> (${esc(w.chain)})${w.lastCheck ? ` · обновлён ${fmtDate(w.lastCheck)}` : ''}`);
  const evLines = events.map((e) => `  ${e.direction === 'in' ? '🔻' : '🔺'} ${e.amount} ${esc(e.asset)} ${e.direction === 'in' ? 'от' : '→'} <code>${esc(e.counterparty.slice(0, 10))}…</code>${e.label ? ` ${esc(e.label)}` : ''}`);
  await api.sendMessage(chatId, [`🔔 <b>Мониторинг (${mine.length})</b>`, ...lines, evLines.length ? `\nПоследние события:` : '', ...evLines].filter(Boolean).join('\n'));
}

async function pdfCmd(deps: RouterDeps, chatId: number, arg: string): Promise<void> {
  const { ctx, api } = deps;
  if (!arg) {
    await api.sendMessage(chatId, 'Пришли адрес: <code>/pdf TR7NHq…</code> — полный отчёт документом.');
    return;
  }
  const rep = await buildWalletReport(ctx, deps.registry, arg);
  const txt = renderPdfText(rep);
  const bytes = new TextEncoder().encode(txt);
  await api.sendDocument(chatId, bytes, `ares-report-${Date.now()}.txt`, 'Полный отчёт (текст). PDF-версия: кнопка PDF в Mini App.');
  await api.sendMessage(chatId, 'Документ отправлен. PDF с таблицами и графом доступен в Mini App — кнопка [PDF] на экране отчёта.');
}

async function adminCmd(deps: RouterDeps, chatId: number, args: string): Promise<void> {
  const { ctx, api } = deps;
  const [sub, ...rest] = args.trim().split(/\s+/);
  const l = new LabelEngine(ctx);
  switch (sub) {
    case 'addlabel': {
      const [addr, category, ...nameParts] = rest;
      if (!addr || !category) { await api.sendMessage(chatId, '/admin addlabel &lt;addr&gt; &lt;category&gt; &lt;name&gt;'); return; }
      await l.addLabel({ chain: chainFor(addr), addr: addr.toLowerCase(), category, name: nameParts.join(' ') || 'unnamed', source: 'admin', confidence: 'high', addedBy: String(chatId) });
      await api.sendMessage(chatId, `✅ Метка добавлена: ${category} «${esc(nameParts.join(' '))}» для <code>${esc(addr)}</code>`);
      return;
    }
    case 'rmlabel': {
      const [addr, category] = rest;
      if (!addr || !category) { await api.sendMessage(chatId, '/admin rmlabel &lt;addr&gt; &lt;category&gt;'); return; }
      const n = await ctx.db.deleteLabel(chainFor(addr), addr.toLowerCase(), category);
      await api.sendMessage(chatId, `Удалено меток: ${n}`);
      return;
    }
    case 'labels': {
      const rows = await ctx.db.listLabels(30);
      await api.sendMessage(chatId, ['🏷 <b>Метки (первые 30)</b>', ...rows.map((r) => `· ${esc(r.category)} ${esc(r.name)} → <code>${esc(r.addr.slice(0, 12))}…</code> (${esc(r.source)})`)].join('\n'));
      return;
    }
    case 'syncofac': {
      const csv = await downloadOfac();
      const r = await syncOfac(ctx.db, csv);
      const scam = await downloadScamSniffer();
      const s = await syncScamSniffer(ctx.db, scam);
      await api.sendMessage(chatId, `✅ Синк: OFAC +${r.inserted}, ScamSniffer +${s}`);
      return;
    }
    case 'stats': {
      const users = await ctx.db.listUsers();
      const watches = await ctx.db.listWatches();
      const errors = await ctx.db.listErrorLogs(5);
      await api.sendMessage(chatId, [
        `📊 <b>Статистика</b>`,
        `Юзеров: ${users.length} · мониторинг: ${watches.filter((w) => w.active).length}/${watches.length}`,
        `Метки: ${await ctx.db.labelCount()} · AML-источники: ${await ctx.db.amlSourceCount()}`,
        `Депозитов миксера в индексе: ${await ctx.db.mixerDepositCount()}`,
        errors.length ? `\nПоследние ошибки:\n${errors.map((e) => `· ${esc(e.where)}: ${esc(e.message.slice(0, 60))}`).join('\n')}` : '',
        `\nПредохранители: ${deps.ctx.breaker.status().filter((b) => b.fails > 0).map((b) => `${b.provider}(${b.fails})`).join(', ') || 'все в норме'}`,
      ].filter(Boolean).join('\n'));
      return;
    }
    case 'broadcast': {
      const msg = rest.join(' ');
      if (!msg) { await api.sendMessage(chatId, '/admin broadcast &lt;текст&gt;'); return; }
      const users = await ctx.db.listUsers();
      let sent = 0;
      for (const u of users) {
        await deps.api.sendMessage(u.chatId, `📢 ${esc(msg)}`).then(() => sent++).catch(() => { /* skip */ });
      }
      await api.sendMessage(chatId, `Отправлено: ${sent}/${users.length}`);
      return;
    }
    case 'export': {
      const rows = await ctx.db.listLabels(10000);
      const bytes = new TextEncoder().encode(JSON.stringify({ labels: rows, exportedAt: new Date().toISOString() }, null, 2));
      await deps.api.sendDocument(chatId, bytes, 'ares-labels-export.json', 'Экспорт меток (JSON)');
      return;
    }
    default:
      await api.sendMessage(chatId, '/admin addlabel|rmlabel|labels|syncofac|stats|broadcast|export');
  }
}

function chainFor(addr: string): string {
  if (/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(addr)) return 'tron';
  if (/^(EQ|UQ)/.test(addr)) return 'ton';
  if (/^0x/.test(addr)) return 'eth';
  if (/^(bc1|[13])/.test(addr)) return 'btc';
  return '*';
}

// ---------- callbacks ----------

async function handleCallback(deps: RouterDeps, data: string, chatId: number, cbId: string): Promise<void> {
  const { ctx, api } = deps;
  await deps.api.answerCallback(cbId).catch(() => { /* ignore */ });
  const [act, chain, arg] = data.split(':');
  switch (act) {
    case 'cp': {
      await quickCheck(deps, chatId, arg ?? '');
      return;
    }
    case 'trace': {
      await traceCmd(deps, chatId, arg ?? '');
      return;
    }
    case 'tracedeep': {
      const s = await getSettings(ctx, chatId);
      await updateSettings(ctx, chatId, { traceDepth: Math.min(4, s.traceDepth + 1) });
      await traceCmd(deps, chatId, arg ?? '');
      return;
    }
    case 'aml': {
      const q = await checkQuota(ctx, chatId, 'aml');
      if (!q.ok) { await api.sendMessage(chatId, quotaText('aml', q.left, q.resetLocal)); return; }
      const rep = await buildWalletReport(ctx, deps.registry, arg ?? '');
      const aml = rep.chains[0]?.aml;
      await incQuota(ctx, chatId, 'aml');
      await api.sendMessage(chatId, aml ? renderAml(aml) : 'AML недоступен.');
      return;
    }
    case 'watch': {
      await watchCmd(deps, chatId, arg ?? '');
      return;
    }
    case 'pause':
    case 'unwatch': {
      const mine = await ctx.db.listWatches(chatId);
      const row = mine.find((w) => w.addr.toLowerCase() === (arg ?? '').toLowerCase());
      if (row) {
        await ctx.db.updateWatchState(row.id, row.lastStateJson ?? '{}', row.lastCheck ?? 0, act === 'pause' ? false : false);
        await api.sendMessage(chatId, act === 'pause' ? '⏸ Мониторинг поставлен на паузу. /watchlist' : '❌ Отписал.');
      } else await api.sendMessage(chatId, 'Адрес не найден в твоём списке.');
      return;
    }
    case 'canceltrace': {
      await api.sendMessage(chatId, '🛑 Расследование отменено (частичный результат выше).');
      return;
    }
    default:
      await api.sendMessage(chatId, 'Неизвестное действие.');
  }
}

// ---------- free text ----------

async function freeText(deps: RouterDeps, chatId: number, text: string): Promise<void> {
  const { ctx } = deps;
  const resolved = await resolveInput(text, deps.registry, 3000);
  if (resolved.kind === 'telegram' || resolved.kind === 'ton-dns') {
    await tonCmd(deps, chatId, resolved.clean!.startsWith('@') ? resolved.clean! : (resolved.kind === 'ton-dns' ? resolved.clean! : '@' + resolved.clean!));
    return;
  }
  if (resolved.kind === 'tx-hash') {
    await txCmd(deps, chatId, resolved.clean!);
    return;
  }
  if (resolved.kind) {
    await quickCheck(deps, chatId, text);
    return;
  }
  const fixes = suggestFixes(text);
  await deps.api.sendMessage(chatId, [
    '🤔 Не понял ввод.',
    `Формат: адрес (TRON/TON/ETH/BTC/SOL), хэш транзакции, @username или .ton-домен.`,
    ``,
    ...fixes.map((f) => `· ${esc(f)}`),
    ``,
    `Пример: <code>TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t</code>`,
  ].join('\n'));
}

// PDF text fallback (K7: full client-side PDF lives in Mini App; here — honest text doc)
function renderPdfText(rep: WalletReport): string {
  const strip = (s: string) => s.replace(/<[^>]+>/g, '');
  const head = [
    'ARES CRYPTO-ANALYTICS — полный отчёт',
    `Объект: ${rep.input}`,
    `Сформирован: ${new Date(rep.createdAt * 1000).toISOString()}`,
    'Данные: публичные блокчейны. Вероятностные оценки. Не финансовый совет.',
    '='.repeat(64),
    '',
  ];
  const body = renderReport(rep).join('\n').split('\n').map(strip).join('\n');
  return head.join('\n') + body + '\n';
}

export { watchAlertKb, monitorCycle };
