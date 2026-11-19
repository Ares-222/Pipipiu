// Telegram Bot API client: long-polling (sandbox/dev) + all send helpers.
// Works on Workers (webhook mode calls processUpdate) and Node (dev-polling).

import { fetchJson } from '../core/http.ts';
import type { AppCtx } from '../core/ctx.ts';
import type { TgUpdate, InlineKeyboardMarkup } from './bot-types.ts';

const API = 'https://api.telegram.org';

export class BotApi {
  private ctx: AppCtx;

  constructor(ctx: AppCtx) {
    this.ctx = ctx;
  }

  private url(method: string): string {
    return `${API}/bot${this.ctx.cfg.botToken}/${method}`;
  }

  async call<T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    // Telegram envelope: {ok, result, description} — unwrap and fail loudly on ok:false.
    const body = await fetchJson<{ ok: boolean; result?: T; error_code?: number; description?: string }>(this.url(method), {
      provider: 'telegram',
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(params),
      timeoutMs: 35000, // long polling
      retries: 1,
      breaker: this.ctx.breaker,
    });
    if (!body || body.ok !== true) {
      throw new Error(`Telegram API ${method} failed: ${body?.description ?? 'unknown'}`);
    }
    return body.result as T;
  }

  async getUpdates(offset: number, timeoutSec = 25): Promise<TgUpdate[]> {
    const r = await this.call<TgUpdate[]>('getUpdates', {
      offset,
      timeout: timeoutSec,
      allowed_updates: ['message', 'callback_query', 'my_chat_member'],
    });
    return r ?? [];
  }

  async sendMessage(chatId: number, html: string, keyboard?: InlineKeyboardMarkup): Promise<number | undefined> {
    // Split into 4096-char parts (spec §14)
    const parts = splitMessage(html);
    let lastId: number | undefined;
    for (let i = 0; i < parts.length; i++) {
      const r = await this.call<{ message_id: number }>('sendMessage', {
        chat_id: chatId,
        text: parts[i],
        parse_mode: 'HTML',
        link_preview_options: { is_disabled: true },
        reply_markup: i === parts.length - 1 && keyboard ? keyboard : undefined,
        disable_web_page_preview: true,
      });
      lastId = r?.message_id;
    }
    return lastId;
  }

  async sendPhoto(chatId: number, jpeg: Uint8Array | string, caption?: string, keyboard?: InlineKeyboardMarkup): Promise<number | undefined> {
    // jpeg: bytes or base64 (data URL supported by Telegram when base64 posted as form).
    // Workers FormData supports Blob; Node 24 supports too.
    const bytes = typeof jpeg === 'string' ? base64ToBytes(jpeg) : jpeg;
    const form = new FormData();
    form.append('chat_id', String(chatId));
    form.append('photo', new Blob([bytes as BlobPart], { type: 'image/jpeg' }), 'ares-card.jpg');
    if (caption) form.append('caption', caption.slice(0, 1024));
    if (keyboard) form.append('reply_markup', JSON.stringify(keyboard));
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 30000);
    try {
      const res = await fetch(this.url('sendPhoto'), { method: 'POST', body: form, signal: ctrl.signal });
      const json = (await res.json()) as { ok: boolean; result?: { message_id: number }; description?: string };
      if (!json.ok) throw new Error(`sendPhoto failed: ${json.description}`);
      return json.result?.message_id;
    } finally {
      clearTimeout(timer);
    }
  }

  async sendDocument(chatId: number, bytes: Uint8Array, filename: string, caption?: string, mime = 'application/pdf'): Promise<number | undefined> {
    const form = new FormData();
    form.append('chat_id', String(chatId));
    form.append('document', new Blob([bytes as BlobPart], { type: mime }), filename);
    if (caption) form.append('caption', caption.slice(0, 1024));
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 60000);
    try {
      const res = await fetch(this.url('sendDocument'), { method: 'POST', body: form, signal: ctrl.signal });
      const json = (await res.json()) as { ok: boolean; result?: { message_id: number }; description?: string };
      if (!json.ok) throw new Error(`sendDocument failed: ${json.description}`);
      return json.result?.message_id;
    } finally {
      clearTimeout(timer);
    }
  }

  async answerCallback(callbackId: string, text?: string): Promise<void> {
    await this.call('answerCallbackQuery', { callback_query_id: callbackId, text }).catch(() => { /* ignore */ });
  }
}

export function splitMessage(html: string, limit = 4000): string[] {
  if (html.length <= limit) return [html];
  const parts: string[] = [];
  let rest = html;
  while (rest.length > limit) {
    // split on last safe boundary
    let cut = rest.lastIndexOf('\n', limit);
    if (cut < limit * 0.5) cut = limit;
    parts.push(rest.slice(0, cut) + '\n(продолжение →)');
    rest = '(…)\n' + rest.slice(cut);
  }
  parts.push(rest);
  return parts;
}

function base64ToBytes(b64: string): Uint8Array {
  const clean = b64.includes(',') ? b64.slice(b64.indexOf(',') + 1) : b64;
  const bin = atob(clean);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function getMe(ctx: AppCtx): Promise<{ id: number; username?: string }> {
  const body = await fetchJson<{ ok: boolean; result?: { id: number; username?: string }; description?: string }>(
    `${API}/bot${ctx.cfg.botToken}/getMe`,
    { provider: 'telegram', timeoutMs: 10000 },
  );
  if (!body.ok) throw new Error(`getMe failed: ${body.description}`);
  return body.result ?? { id: 0 };
}
