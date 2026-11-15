# README-DEPLOY.md — пошаговый деплой Ares Crypto (§22)

Всё — на бесплатных тарифах. Секреты НЕ в git: `wrangler secret put` / `.env` (локально).

## 1. Бот у @BotFather

1. `/newbot` → имя `Ares Crypto-Analytics`, юзернейм на выбор заказчика
   (текущий тестовый токен из ТЗ привязан к `@Snwbdoiwhcryptoares_bot` — заказчик
   может оставить его или пересоздать бота и вписать новый токен).
2. Токен → `wrangler secret put BOT_TOKEN` (шаг 4) и в локальный `.env` для песочницы.
3. ADMIN_ID (Telegram ID заказчика) → secret/vars.

## 2. Cloudflare: ресурсы

```bash
cd worker
npm i -g wrangler          # или npx wrangler
wrangler login
wrangler d1 create ares                          # -> database_id в wrangler.toml
wrangler kv namespace create CACHE               # -> id в wrangler.toml
wrangler d1 execute ares --file src/schema.sql --remote
```

В `worker/wrangler.toml` подставить `__D1_DATABASE_ID__` и `__KV_CACHE_ID__`.

## 3. Секреты

```bash
wrangler secret put BOT_TOKEN
wrangler secret put ADMIN_ID
wrangler secret put ETHERSCAN_KEY     # etherscan.io (free, 1 ключ на v2-API)
wrangler secret put TRONGRID_KEY      # trongrid.io (free)
wrangler secret put TG_WEBHOOK_SECRET # случайная строка для проверки вебхука
# опционально: TONCENTER_KEY (повышенные лимиты toncenter), GITHUB_TOKEN (K1)
```

## 4. Деплой воркера

```bash
wrangler deploy          # cron: */5 (мониторинг) + 0 6 * * * (суточный синк OFAC/ScamSniffer)
```

## 5. Webhook

```bash
curl "https://api.telegram.org/bot$BOT_TOKEN/setWebhook?url=https://<worker>.workers.dev/tg-webhook?secret=$TG_WEBHOOK_SECRET&secret_token=$TG_WEBHOOK_SECRET&allowed_updates=%5B%22message%22%2C%22callback_query%22%2C%22my_chat_member%22%5D"
curl "https://api.telegram.org/bot$BOT_TOKEN/getWebhookInfo"   # проверить pending_update_count и last_error
```
Worker проверяет `X-Telegram-Bot-Api-Secret-Token` / `?secret=` (см. `src/index.ts`).

## 6. Первичный импорт фидов

Автоматически — суточный cron `0 6 * * *` внутри воркера делает синк OFAC + ScamSniffer.
Ручной (песочница): `ARES_DB_DUMP=/tmp/ares-db.json node scripts/sync-ofac.ts`.

Индексация миксера (для unmix, §11.4): разовая — исторические диапазоны
```bash
ARES_DB_DUMP=/tmp/ares-db.json node scripts/index-tornado.ts 14980000 60   # ~июнь-авг 2022
```
В проде — расширять по кускам через cron; депозиты после 20.08.2022 почти отсутствуют
(санкции), индекс нужен для вероятностного распутывания старых связок.

## 7. Mini App

```bash
cd miniapp
# в index.html: window.ARES_CONFIG.apiBase = "https://<worker>.workers.dev"
npm install && npm run build    # dist/
# Cloudflare Pages: загрузка dist (Direct Upload или Git-интеграция), free, HTTPS из коробки.
# Fallback: GitHub Pages (Settings → Pages → ветка gh-pages).
```
В BotFather: Bot Settings → Menu Button → URL Pages-приложения. Фотокарточка/PDF/отчёт
в приложении работают через REST воркера (`/api/report`, `/api/graph`, `/api/render`,
`/api/pdf`, `/api/watch*`, `/api/history`, `/api/settings`) с заголовком `x-init-data`.

## 8. Приёмка после деплоя

1. `/start` в боте → онбординг + кнопка Mini App.
2. Прислать `TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t` → быстрый отчёт + клавиатура.
3. Кнопка 📸 Фотокарточка → JPEG 1080×1350 в чат.
4. `/watch <адрес>` → перевести на адрес ≥ $10 → алерт ≤ 5,5 мин (cron */5).
5. `/admin stats` → счётчики, состояние circuit-breaker'ов.
6. `/api/...` без initData → 401 (проверить curl'ом).

## 9. Ограничения free-тарифов (учтены в архитектуре)

- Workers: ~100k req/день, **50 fetch на вызов** — все движки считают бюджет
  (`fetchCount()`), трассировка/мониторинг дробятся через DO alarms.
- Cron ≤ 3 на воркер — используется 2.
- Etherscan V2 free: подтверждено только chainid 1/137/42161 (остальные — «not supported
  for this chain»); BSC/OP/Base — баланс через публичные RPC без истории (честный partial).
- Tronscan анонимно: 3 rps с блокировкой 82 c — не hammer'ить, кэш обязателен.
- Solana public RPC — базовый режим (10 tx), помечено partial.
- KV free: только кэш с TTL; D1: данные (метки/индексы/история) — ~5 ГБ хватает.

## 10. Fallback хостинга бота (опция, не реализовано по умолчанию)

Тот же Worker-код не переносим напрямую; альтернатива — GitHub Actions cron (*/5) +
Node-режим `dev-polling.ts` на runner'е как временный polling-режим. Активировать
только по явному запросу заказчика (ТЗ §22.7).
