// AI-комментарий к отчёту через OpenRouter (OpenAI-совместимый endpoint).
// Решение из GitHub-ресёрча (2026-11-16): вместо тяжёлых SDK — прямой fetch на
// https://openrouter.ai/api/v1/chat/completions. Бесплатные модели ('...:free')
// ротируются — поэтому модель резолвим на лету: OPENROUTER_MODEL (если задан),
// иначе первый доступный ':free' из /models (кэш 6 ч).
//
// Деградация честная: нет ключа / нет моделей / HTTP-ошибка — пользователь видит
// причину, а не «выдуманный» текст. Кэш комментария: 12 ч на (chain, addr, verdict).

import type { AppCtx } from '../core/ctx.ts';
import type { WalletReport } from '../core/types.ts';
import { fetchJson } from '../core/http.ts';
import { cachedJson, KV_TTL } from '../core/kv.ts';

const OR = 'https://openrouter.ai/api/v1';

export type AiResult = { ok: true; text: string; model: string } | { ok: false; reason: string };

const SYSTEM = 'Ты — криптоаналитик OSINT-бота Ares. Пользователю прислали структурированный дайджест отчёта по блокчейн-адресу. Напиши краткий комментарий для пользователя: главный вывод об уровне риска (со ссылкой на число), что именно настораживает, что выглядит нейтрально, один практический совет. 120–180 слов, по-русски, обычный текст без markdown-заголовков и таблиц. Используй ТОЛЬКО факты из дайджеста — ничего не выдумывай и не добавляй данных, которых там нет. Формулировки вероятностные, без обвинений: «выглядит как», «признаки».';

// Компактный дайджест отчёта (≤ ~2000 символов) — то, что реально уходит в модель.
export function buildAiDigest(rep: WalletReport): string {
  const L: string[] = [];
  L.push(`Ввод: ${rep.input}. Вердикт: ${rep.verdict.score}/100 (${rep.verdict.level}).`);
  const cr = rep.chains[0];
  if (!cr) { L.push('Деталей нет: адрес не найден в источниках.'); return L.join('\n').slice(0, 2000); }
  const k = cr.kpi;
  if (k) {
    L.push(`КПЭ: оборот ${Math.round(k.turnover)}$, получено ${Math.round(k.received)}$ (${k.receivedCount} вход.), отправлено ${Math.round(k.sent)}$ (${k.sentCount} исход.), контрагенты ${k.counterpartiesIn}/${k.counterpartiesOut}, возраст ${k.ageDays ?? '?'} дн., активных дней ${k.activeDays}.`);
  }
  if (cr.classification) L.push(`Классификация: ${cr.classification.title} (уверенность ${cr.classification.confidence}).`);
  if (cr.findings.length) {
    L.push('Находки:');
    for (const f of cr.findings.slice(0, 6)) L.push(`- [${f.severity}] ${f.title}: ${f.detail.slice(0, 140)}`);
  } else L.push('Находок не обнаружено.');
  if (cr.aml) {
    L.push(`AML-скоринг: ${cr.aml.score}/100 (${cr.aml.level}).`);
    for (const h of cr.aml.hits.slice(0, 5)) {
      L.push(`- источник ${h.source}, хопов ${h.hops}, вклад ${Math.round(h.score)}${h.ref ? ` (${h.ref.slice(0, 80)})` : ''}`);
    }
    const ex = cr.aml.exposure.filter((e) => e.pct >= 5).slice(0, 5);
    if (ex.length) L.push(`Происхождение входящего объёма: ${ex.map((e) => `${e.ru} ${e.pct}%`).join(', ')}.`);
    if (cr.aml.topOut.length) {
      const t = cr.aml.topOut.slice(0, 3).map((t) => `${t.label ?? t.addr.slice(0, 10)} (${Math.round(t.share * 100)}%)`).join(', ');
      L.push(`Куда ушло (топ): ${t}.`);
    }
  }
  if (rep.warnings?.length) L.push(`Предупреждения: ${rep.warnings.slice(0, 3).join('; ').slice(0, 200)}`);
  return L.join('\n').slice(0, 2000);
}

async function resolveModel(ctx: AppCtx): Promise<string | null> {
  if (ctx.cfg.openrouterModel) return ctx.cfg.openrouterModel;
  const { value } = await cachedJson<string | null>(ctx.kv, 'ai:model', KV_TTL.aiModel, async () => {
    const d = await fetchJson<{ data: { id: string; created?: number }[] }>(`${OR}/models`, {
      provider: 'openrouter', breaker: ctx.breaker, timeoutMs: 12000,
    });
    const free = (d?.data ?? []).filter((m) => m.id.endsWith(':free'));
    if (!free.length) return null;
    // свежие с большим контекстом приоритетнее
    free.sort((a, b) => (b.created ?? 0) - (a.created ?? 0));
    const pref = free.find((m) => /nemotron|deepseek|llama|qwen|gemini|flash/.test(m.id));
    return (pref ?? free[0]).id;
  });
  return value;
}

export async function aiComment(ctx: AppCtx, rep: WalletReport, chain: string, addr: string): Promise<AiResult> {
  if (!ctx.cfg.openrouterKey) {
    return { ok: false, reason: 'Ключ OpenRouter не настроен. Добавь секрет OPENROUTER_API_KEY (wrangler secret put OPENROUTER_API_KEY) — модель бесплатная.' };
  }
  const digest = buildAiDigest(rep);
  const cacheKey = `ai:c:${chain}:${addr.toLowerCase()}:${rep.verdict.score}`;
  const { value } = await cachedJson<AiResult>(ctx.kv, cacheKey, 43200, async (): Promise<AiResult> => {
    const model = await resolveModel(ctx);
    if (!model) return { ok: false, reason: 'Сейчас нет доступных бесплатных моделей OpenRouter. Повтори позже или задай OPENROUTER_MODEL.' };
    try {
      const r = await fetchJson<{ choices?: { message?: { content?: string } }[]; error?: { message?: string } }>(
        `${OR}/chat/completions`,
        {
          provider: 'openrouter', breaker: ctx.breaker, timeoutMs: 30000, retries: 0,
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${ctx.cfg.openrouterKey}`,
          },
          body: JSON.stringify({
            model,
            messages: [
              { role: 'system', content: SYSTEM },
              { role: 'user', content: `Дайджест отчёта:\n${digest}` },
            ],
            max_tokens: 700,
            temperature: 0.4,
          }),
        },
      );
      const text = r?.choices?.[0]?.message?.content?.trim();
      if (!text) return { ok: false, reason: `Модель ${model} вернула пустой ответ.` };
      return { ok: true, text, model };
    } catch (e) {
      return { ok: false, reason: `AI недоступен: ${String((e as Error).message).slice(0, 140)}` };
    }
  });
  return value;
}
