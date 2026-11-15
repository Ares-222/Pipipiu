// Inline keyboards (spec §14): every report ends with a navigation keyboard.

import type { InlineKeyboardMarkup } from './bot-types.ts';
import { shortAddr } from '../core/util.ts';

export function reportKb(opts: {
  addr: string;
  chain: string;
  miniappUrl?: string;
  watching?: boolean;
}): InlineKeyboardMarkup {
  const rows: InlineKeyboardMarkup['inline_keyboard'] = [];
  rows.push([
    { text: '🔍 Расследование', callback_data: `trace:${opts.chain}:${opts.addr}` },
    { text: '🛡 AML-детали', callback_data: `aml:${opts.chain}:${opts.addr}` },
  ]);
  const appRow: InlineKeyboardMarkup['inline_keyboard'][number] = [];
  if (opts.miniappUrl) {
    appRow.push({ text: '📸 Фотокарточка', web_app: { url: `${opts.miniappUrl}${opts.miniappUrl.includes('?') ? '&' : '?'}startapp=${encodeURIComponent(opts.addr)}` } });
  }
  if (appRow.length) rows.push(appRow);
  rows.push([
    { text: opts.watching ? '⏸ Пауза мониторинга' : '🔔 Мониторинг', callback_data: opts.watching ? `pause:${opts.chain}:${opts.addr}` : `watch:${opts.chain}:${opts.addr}` },
  ]);
  if (opts.miniappUrl) {
    rows.push([{ text: '🌐 Открыть в Mini App', web_app: { url: opts.miniappUrl } }]);
  }
  return { inline_keyboard: rows };
}

export function txKb(card: { chain: string; hash: string; from: string; to: string; explorerUrl: string }): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        { text: '↩️ К отправителю', callback_data: `cp:${card.chain}:${card.from}` },
        { text: '↪️ К получателю', callback_data: `cp:${card.chain}:${card.to}` },
      ],
      [{ text: '🌐 Эксплорер', url: card.explorerUrl }],
    ],
  };
}

export function watchAlertKb(chain: string, addr: string): InlineKeyboardMarkup {
  return {
    inline_keyboard: [[
      { text: '📊 Отчёт', callback_data: `cp:${chain}:${addr}` },
      { text: '⏸ Пауза', callback_data: `pause:${chain}:${addr}` },
      { text: '❌ Отписать', callback_data: `unwatch:${chain}:${addr}` },
    ]],
  };
}

export function traceProgressKb(chain: string, addr: string): InlineKeyboardMarkup {
  return { inline_keyboard: [[
    { text: '🛑 Отменить', callback_data: `canceltrace` },
    { text: '➕ Продолжить глубже', callback_data: `tracedeep:${chain}:${addr}` },
  ]] };
}

export function startKb(miniappUrl?: string): InlineKeyboardMarkup {
  const rows: InlineKeyboardMarkup['inline_keyboard'] = [
    [{ text: '✨ Пример: проверить USDT-кошелёк TRON', callback_data: `cp:tron:TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t` }],
  ];
  if (miniappUrl) rows.push([{ text: '🌐 Открыть Mini App', web_app: { url: miniappUrl } }]);
  return { inline_keyboard: rows };
}

export function p2pKb(chain: string, addr: string, miniappUrl?: string): InlineKeyboardMarkup {
  const rows: InlineKeyboardMarkup['inline_keyboard'] = [[
    { text: '🔍 Глубже', callback_data: `trace:${chain}:${addr}` },
    { text: '🛡 AML', callback_data: `aml:${chain}:${addr}` },
  ]];
  if (miniappUrl) rows.push([{ text: '🌐 Mini App', web_app: { url: `${miniappUrl}${miniappUrl.includes('?') ? '&' : '?'}startapp=${encodeURIComponent(addr)}` } }]);
  return { inline_keyboard: rows };
}

export function historyKb(items: { input: string; chain?: string; verdict?: string }[]): InlineKeyboardMarkup {
  return {
    inline_keyboard: items.slice(0, 8).map((it) => [
      { text: `${(it.verdict ?? '?').slice(0, 24)} · ${shortAddr(it.input, 8, 6)}`, callback_data: `cp:${it.chain ?? 'tron'}:${it.input}` },
    ]),
  };
}
