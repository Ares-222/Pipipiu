# ARES CRYPTO — ПАСПОРТ ПРОЕКТА (для переноса в новый чат)

> Документ самодостаточен: новый агент читает его целиком и продолжает работу без контекста старого чата.
> Состояние на **2026-11-19 (ночь, UTC+3)**. Эталонное дерево: `ares-crypto-transfer-2026-11-17-full-v3.zip`,
> отпечаток бандла Mini App: **`index-DlGtl8QY.js`** (с деплоя 18.11 не менялся).
> **Деплой 19.11 ночь** (Version `c7ae288f-3bc2-4c32-bdde-2ef3032ad091`, только воркер): mixerLabel в
> unmix-историях = настоящая метка узла («Tornado.Cash: 1 ETH»), раньше — generic «Миксер».
> **Деплой 18.11** (Version `55bd7f3f-d975-4991-9745-6336f3ce9776`): бандл DlGtl8QY на живой
> странице, healthz ok, `_headers` применяются; добавлена прямая ссылка Mini App через BotFather
> /newapp → **`https://t.me/Snwbdoiwhcryptoares_bot/AresCryptoAi`** + fallback `tgWebAppStartParam`
> в App.tsx. Предыдущий задеплоенный бандл 17.11: `index-CFhRGGcD.js` (пакет №5–14).
> **Menu Button / Main Mini App** переключены заказчиком в BotFather на этот апп 19.11 (подтверждено).
>
> **Unmix «человеческим языком» — ПРОВЕРЕН ЖИВЫМ ТРЕЙСОМ 19.11 И РАБОТАЕТ**: демо-кошелёк с историей
> Tornado → находки «🌀 Tornado.Cash: 1 ETH», связи с уверенностью p≈0.35, метод H3·FIFO, ↻-циклы,
> балансовая сходимость ~100% (SlowMist-приём). **Покрытие индекса миксеров: eth/bsc/polygon (Tornado
> Cash Classic). TRON и TON НЕ индексируются** — для TRON/TON-кошельков unmix всегда «честный ноль»
> (так задумано, не поломка; TRON-миксеры заморожены с 2023, TON-миксеров с публичным индексом нет).
> Кошелёк заказчика TRKhSYVuCmNLn8a6ghuqCJ4X83usLpffF8: 0/100 clean, AML-хитов 0 — распутывать нечего.
> Demo-адреса с депозитами в D1-индексе (для показа блока): `0x9c514fc441d70d828198050c100948376aa7d91d`,
> `0x185d7b65bd417fd72579be9e0c3b4d69888f2e70` (eth, depth 1; PDF с unmix: прогнать граф → кнопка PDF на том же адресе).
>
> **ПРАВИЛО ДОСТАВКИ РЕЗУЛЬТАТОВ: файлы в чат НЕ отправлять. Все результаты (фотокарточка, PDF,
> экспорты) клиент получает через Telegram-бота — sendPhoto/sendDocument из мини-аппа или бота.**
>
> **Тестовый клиент в песочнице: `scripts/tg_client.py`** — подписывает валидный initData админа
> (id 5188446459) и дергает прод-API: `python3 -I scripts/tg_client.py history|report|demo <addr> [depth]`.
> **Прод восстановлен 17.11 ~18:35 UTC** деплоем из песочницы (Version ID `a096f439-23ab-4496-9ac8-abc923256af2`),
> верифицирован: бандл CsE7YMCk на живой странице, healthz ok, _headers применяются, гвард свежести в бандле,
> в воркере aiComment/freeze/goplus/tgbots. **Приёмка заказчиком подтверждена 17.11 вечером**:
> бот выдаёт свежие карточку и PDF по TRKhSYVu… (заказчик команд не выполнял — фикс уже был на проде).
> **GitHub-репо восстановлено** коммитом `4a90f3e «restore: full v3 tree…»` (после опустошившего
> `892a32f`): 118 файлов = v3-дерево минус `data/labels` (16 МБ, gitignored — живут в архиве,
> метки уже в прод-D1). Верифицировано свежим клоном: fingerprint dist = CsE7YMCk, _headers
> и гвард свежести на месте. Деплой из Codespace снова безопасен.

## 1. Что за проект

Telegram-бот + Mini App для крипто-аналитики/OSINT: отчёты по адресам (TRON/EVM/TON/BTC/SOL),
AML-скоринг (OFAC, ScamSniffer, Tornado, freeze-листы эмитентов, GoPlus), трассировка с unmix,
мониторинг, метки (31 442), фото-карточка, PDF, AI-комментарий `/ai`.
Стек: **Cloudflare Workers (free) + D1 + KV + Durable Objects**, Mini App — Vite + React + TS +
Tailwind + Cytoscape. Ноль бюджета: только free-тиры; тяжёлая работа — не через Workers AI,
а через GitHub + OpenRouter (бесплатные модели `:free`). Всё на русском.

## 2. Идентификаторы и ссылки

| Что | Значение |
|---|---|
| GitHub-репо | https://github.com/Ares-222/Pipipiu (branch `main`) |
| Прод (Workers) | https://ares-crypto.maks222berg.workers.dev |
| Health | https://ares-crypto.maks222berg.workers.dev/healthz → `{"ok":true,...}` |
| CF аккаунт | `Maks222berg@mail.ru's Account` |
| CF Account ID | `5056771695e953ca49fa8203a83a4b6f` |
| Воркер | `ares-crypto` |
| TG бот | `@Snwbdoiwhcryptoares_bot`, bot id `9058426452` |
| Mini App — прямая ссылка | https://t.me/Snwbdoiwhcryptoares_bot/AresCryptoAi (BotFather `/newapp`, создана 18.11; fullscreen, Bot API 7.6+; Menu Button переведён на неё 19.11) |
| Demo-адрес unmix (eth) | `0x9c514fc441d70d828198050c100948376aa7d91d`, `0x185d7b65bd417fd72579be9e0c3b4d69888f2e70` — депозиты Tornado в D1-индексе; граф depth 1 → блок «Unmix» под графом |
| Чат админа (ADMIN_ID, var в wrangler.toml) | `5188446459` |
| D1 | binding `DB`, имя `ares`, id `12bfcbd3-a7ed-4d9c-865f-c2358b39c0ba` |
| KV | binding `CACHE`, id `adb397a8acf7491d8d54614c0236d224` |
| Durable Objects | `TRACER_DO` (TracerDO), `MONITOR_DO` (MonitorDO), миграция v1 (sqlite) |
| Cron-триггеры | `*/5 * * * *` (мониторинг), `0 6 * * *` (ежедневный sync OFAC/ScamSniffer), `0 7 * * *` (ежедневный дайджест) |
| Mini App | раздаётся тем же воркером из `miniapp/dist` (assets, SPA, `run_worker_first` для /api/*, /tg-webhook, /healthz) |

## 3. Токены и секреты (все из чата — по требованию заказчика)

| Секрет | Значение |
|---|---|
| **TG Bot Token** | `9058426452:(токен — в переносном паспорте, в git не хранится)` |
| **CF API Token** | `cfut_(токен — в переносном паспорте, в git не хранится)` (проверен 17.11 через `/user/tokens/verify` → active) |
| **CF Account ID** | `5056771695e953ca49fa8203a83a4b6f` |
| **GitHub PAT** | `ghp_(PAT — в переносном паспорте, в git не хранится)` (login `Ares-222`, scopes: repo, workflow и др.; проверен 17.11; git push/clone и API) |
| OPENROUTER_API_KEY | **НЕ задан** → `/ai` отвечает честной инструкцией, пока не выполнить `wrangler secret put OPENROUTER_API_KEY` |
| OPENROUTER_MODEL | **задан как var** = `baidu/ernie-5.5-flash-preview:free` (виден в выводе deploy 18.11) |
| TRONGRID_KEY / ETHERSCAN_KEY | ЗАДАНЫ как секреты воркера (проверено через API settings 17.11); значения через CF API не читаются — при переносе переустановить `wrangler secret put` |

**Решение заказчика (19.11):** ключи выше сознательно хранятся в паспорте для переноса в новый чат;
после завершения проекта заказчик перевыпускает их вручную. Секреты воркера (TRONGRID_KEY,
ETHERSCAN_KEY) через Cloudflare API не возвращаются — их достаточно переустановить `wrangler secret put`.

Правила безопасности: токены НЕ коммитить в git (`.env` в `.gitignore`); секреты воркера — только
через `wrangler secret put`; передавать в чате можно (это переносной паспорт), в публичные места — нет.

## 4. Деплой — единственно правильная цепочка

```bash
# 1) эталонное дерево распаковывается НА ЧИСТЫЙ КОРЕНЬ (не поверх старого!):
cd /workspaces/Pipipiu            # или локальный клон
rm -rf ares-crypto ares-crypto-transfer*.zip
unzip -o /путь/ares-crypto-transfer-2026-11-17-full-v3.zip -d .

# 2) коммит и пуш (dist и _headers ТРЕКАЮТСЯ: строка miniapp/dist/ удалена из .gitignore)
git add -A && git commit -m "sync: merged tree v3, bundle index-CsE7YMCk" && git push

# 3) деплой с токеном (не OAuth: из телефона OAuth не завершить — redirect на localhost:8976)
cd ares-crypto/worker
export CLOUDFLARE_API_TOKEN=cfut_(токен — в переносном паспорте, в git не хранится)
export CLOUDFLARE_ACCOUNT_ID=5056771695e953ca49fa8203a83a4b6f
npx wrangler deploy
```

**Верификация прода после КАЖДОГО деплоя (обязательно — без неё деплой не считается выполненным):**

```bash
curl -s https://ares-crypto.maks222berg.workers.dev/ | grep -o "index-[A-Za-z0-9_-]*\.js"
# → index-CsE7YMCk.js (или новее из свежей сборки)
curl -s https://ares-crypto.maks222berg.workers.dev/healthz          # → {"ok":true,...}
curl -sI https://ares-crypto.maks222berg.workers.dev/ | grep -i cache-control
# → no-cache, no-store, must-revalidate (прилетает из miniapp/public/_headers)
```

**Урок 17.11 (три отката прода за сутки):** деплоить только из дерева, сверенного с эталонным
архивом. Прод трижды оказывался на старом бандле (`index-DpgD_PwB.js` / `index-BvuQbFcN.js`,
~1 009 627 B), потому что Codespace-репо содержало старое содержимое `ares-crypto/`.
Признаки старого прода: в бандле нет строк «данные не обновились» и «Telegram-бот»;
cache-control = дефолтный `max-age=0, must-revalidate` вместо наших `_headers`.

## 5. Карта файлов

```
ares-crypto/
├── worker/
#   engine/unmix.ts (v6: H1/H2/H3/1n/loop скоринг, arXiv 2510.09433) + engine/mixindex.ts (крон-индекс миксеров eth/bsc/polygon)
│   ├── wrangler.toml            # биндинги, assets = ../miniapp/dist, run_worker_first: /api/*, /tg-webhook, /healthz
│   └── src/
│       ├── index.ts             # роутинг /api/* (report, graph, tx, settings, render, pdf, watchlist…), /tg-webhook, /healthz
│       ├── core/                # ctx.ts (конфиг+env, OPENROUTER_*), db.ts (D1), kv.ts (CACHE + TTL), types.ts (normAddr, категории, tgbots)
│       ├── adapters/            # tron/evm/ton/btc/sol/prices (ton.ts — нормализация friendly↔raw, tonapi v2 sender/recipient)
│       ├── engine/              # report, profile (tgbot_invoices), aml (интеграция freeze+goplus, фикс buildExposure), labels,
│       │                        #   tracer (эвристика «Биржа/сервис (вероятно)»), monitor, tonosint, references, quota,
│       │                        #   freeze.ts (USDT TRON/ETH + USDC ETH on-chain isBlackListed), goplus.ts (keyless), ai.ts (/ai)
│       └── tg/                  # router.ts (команды, /ai), bot.ts, formatter.ts, keyboards.ts (уникальные &t= URL)
├── miniapp/
│   ├── src/App.tsx              # deep-link start_param + location.search, pageshow/visibilitychange, refreshReport
│   ├── src/screens/Report.tsx   # ГВАРД СВЕЖЕСТИ: карточка/PDF только из свежего /api/report (freshReport)
│   ├── src/screens/Graph.tsx    # легенда, probable («?» + пунктир), палитра tgbots
│   ├── src/card/, src/pdf/      # renderCardJpeg, makePdf (jspdf)
│   ├── src/api.ts               # api(), categoryRu/categoryIcon
│   ├── public/_headers          # no-cache, no-store, must-revalidate (vite копирует в dist)
│   └── dist/                    # собранный бандл index-CsE7YMCk.js + _headers (трекается git)
├── data/labels/                 # merged-labels.json + labels-d1.sql (31 442 метки: OFAC, ScamSniffer, GraphSense, tgbots…)
├── scripts/                     # test-*.ts (смоки на живых данных), test-live-checks.ts (freeze/goplus/ai), import-labels.ts,
│                                #   build-labels-import.py, sync-ofac.ts, index-tornado.ts, dev-polling.ts,
#   test-unmix.ts / test-mixindex-mock.ts / test-mixindex-live.ts (v6 unmix)
└── docs/                        # TESTLOG.md (полная история + инциденты), API-VERIFICATION.md, GITHUB-FINDINGS.md
```

## 6. Статус модулей (детали и живые замеры — docs/TESTLOG.md)

- **M0–M8 готовы и проверены живыми смоками**: бот/роутер, адаптеры (детектор 11/11 векторов),
  профиль (fan-out/CV/транзит), OFAC+ScamSniffer+AML-скоринг, Mini App+API, карточка/PDF,
  трассировка+unmix, мониторинг, TON OSINT+квоты+K1/K2.
- **Приращение 16.11 (GitHub-ресёрч)**: freeze-листы эмитентов on-chain, GoPlus, `/ai` через
  OpenRouter, GraphSense-метки (BTC впервые: scam 4 939 / mixer 1 548), импорт 31 442 меток в
  прод-D1, эвристика tgbot_invoices (платёжные боты TON: CryptoBot, xRocket и аналоги),
  «Биржа/сервис (вероятно)» в графе, normAddr (EVM lowercase; TON/TRON/BTC — как есть).
- **Хотфиксы 16–17.11 (старая карточка/PDF из webview)**: три линии обороны — уникальные
  `&t=<Date.now()>` в web_app-кнопках; deep-link/pageshow в App.tsx; гвард свежести в
  Report.tsx (+ `_headers` no-cache). Симптом старого прода: на штампе карточки старая дата.
- **18.11 — прямая ссылка Mini App**: BotFather `/newapp` → `t.me/Snwbdoiwhcryptoares_bot/AresCryptoAi`
  (чистая t.me-ссылка для шеринга, открывается fullscreen; подпись домена воркера в шапке Telegram
  рисует сама — убирается только кастомным доменом на воркере). `startapp` у прямой ссылки приходит
  в `initDataUnsafe.start_param` **и** GET `tgWebAppStartParam` — App.tsx читает оба + query
  `startapp`/`addr` (диплинки `?startapp=AML:<addr>` работают со всеми тремя путями). Бандл
  `index-DlGtl8QY.js`, Version `55bd7f3f-d975-4991-9745-6336f3ce9776`.
- **19.11 — диагностика «unmix не применился» (заказчик)**: код был на проде (строки историй в бандле
  DlGtl8QY, PDF-секция в makePdf.ts:589 `if (unmixList.length)`); причина пустого блока — у
  **TRON/TON-кошельков unmix структурно всегда 0**: коллектор mixindex.ts собирает депозиты только
  eth/bsc/polygon (Tornado Classic, крон */5 round-robin, чекпоинты в KV), в D1 `tx_deposits` на 19.11 —
  424 eth + 2 polygon строк, tron/ton — нет. Кошелёк TRKhSYVu… — чистый (0/100, AML hits 0) → «честный
  ноль» корректен. Живое доказательство работоспособности: `/api/graph` на `0x9c514fc4…` → 2 находки
  (Tornado.Cash: 1 ETH — 3 депозита/3 связи, p≈0.35, H3·FIFO, сходимость ~100%). Polish: `mixerLabel`
  из метки узла (tracer.ts, Version `c7ae288f…`). TRON/TON-покрытие — потенциальный бэклог (TRON
  Tornado заморожен 2023, бэкфилл истории через TRONGrid требует per-event tx-lookup, месяцы квот).

## 7. Квоты и лимиты (free-tier)

- Бот: 40 быстрых / 5 расследований / 40 AML / 5 мониторингов в сутки на чат; `/ai` = 5/день (как расследование).
- Трассировка: fetch-бюджет 30 на запрос. KV TTL: lbl 24ч, px 5мин, fz/gp 6ч, ai 6/12ч.
- D1 free: 100k rows_written/день (импорт меток съел 94 326 — в день импорта больше не грузить).
- GoPlus ~30 rpm free. OpenRouter: timeout 30 с, retries 0, только `:free`-модели.

## 8. Известные ограничения (честно)

- OPENROUTER_API_KEY не задан → `/ai` даёт инструкцию (не выдумывает).
- Из песочницы агента GoPlus блокируется TLS (SNI egress) → честный null; из Workers должен работать — проверить на проде.
- TronGrid без ключа → 429 на интенсивных проверках.
- Форки Telegram (AyuGram/Android) восстанавливают webview из bfcache — защита 3-слойная (§6).
- Смоки: test-live-checks 7/7 OK; test-bot PASS (errors logged = GoPlus TLS-блок + TronGrid 429 — средовые, не баги).
- Адрес для живых проверок карточки/PDF: `TRKhSYVuCmNLn8a6ghuqCJ4X83usLpffF8` (TRON, эталон сэмплов дизайна).

## 9. Правила работы агента (установлены заказчиком)

1. Язык всего — русский. Финал выполненной задачи — слово **«Готово»**.
2. Не расходовать Workers AI: тяжёлое — через GitHub-исследование и OpenRouter `:free`.
3. Каждый модуль перед переходом — живой смок (`node scripts/test-<модуль>.ts`), результат — в docs/TESTLOG.md.
4. Честная деградация вместо выдумок: нет ключа/провайдера → честная причина; дисклеймер в каждом ответе бота.
5. Расчёты — только кодом; факты не выдумывать; ограничения и допущения называть прямо.
6. После любого деплоя — сверка отпечатка бандла на живой странице (§4).
7. Архивы-переносы: `ares-crypto-transfer-<дата>-full[-vN].zip`; распаковка только на чистый корень.
8. **Файлы — ТОЛЬКО в бот** (sendPhoto/sendDocument через скрипты из §5); **в чат агенту ссылки на
   файлы и вложения НЕ добавлять** (заказчик не может их убрать из интерфейса чата). Отчёт в чате — текстом.

## 10. Открытые задачи (на момент переноса)

- ~~Восстановить GitHub-репо~~ — **ВЫПОЛНЕНО 17.11**: коммит `4a90f3e` на main = полное
  v3-дерево (118 файлов, верифицировано свежим клоном). Через GitHub PAT из §3.
  Репо и прод теперь совпадают; деплой из Codespace снова безопасен (но только из
  дерева, сверенного с эталоном — урок §4).
- Урок в цепочку деплоя (обязательная проверка между unzip и push):
  `ls ares-crypto/worker/wrangler.toml || { echo "unzip не сработал — НЕ КОММИТИТЬ"; exit 1; }`
- ~~Приёмка заказчиком~~ — **ВЫПОЛНЕНА 17.11 вечером**: свежая карточка/PDF на TRKhSYVu…
  подтверждены заказчиком (бот «наконец выдал нужное», команд он не выполнял).
  Категории tgbots в графе и кнопка «🤖 AI» входят в v3-бандл — проверить при случае.
- Проверить на проде GoPlus (из Workers) и `/ai` после добавления OPENROUTER_API_KEY
  (`wrangler secret put OPENROUTER_API_KEY`).
- ~~Секреты / AI / лимиты~~ — **ВЫПОЛНЕНО 18.11**: ETHERSCAN_KEY, TRONGRID_KEY, TONCENTER_KEY,
  OPENROUTER_API_KEY установлены через `wrangler secret put` (деплой из песочницы — токен CF
  лежит в этом паспорте, см. export ниже). OPENROUTER_MODEL=`baidu/ernie-5.5-flash-preview:free`
  в [vars] (старые `:free`-модели OpenRouter мертвы; список free запрашивается по API —
  при 429 ai.ts деградирует честно). GoPlus из песочницы не проверить (TLS-блок) —
  живая проверка: /check по ETH-адресу в боте.
- **Пакет «Делай все» (14 улучшений) — 18.11, прод**: unmix-визуал «человеческим языком»
  (бандл index-SX56_Ki7 → затем index-CFhRGGcD.js с пакетом); версии воркера
  `5746297a…` → `6651bf78…`. Внедрено: AML-разбор «из чего сложился» (вклады hits в
  noisy-OR), глоссарий (11 терминов, вход из Настроек), история расследований
  (/graph пишет trace в D1 ≤900KB; /trace-history, /trace?id=с проверкой chatId; экран
  «История» → «Открыть»), дайджест 07:00 UTC (cron №3; watch_events за 24ч, тишина при
  пустоте), пороги per-address (/watch {minUsd}, /watch-min; ✎ в Мониторинге), share
  (POST /api/share → KV TTL 7 дней; GET /r/:token БЕЗ initData —
  run_worker_first=["…","/r/*"], иначе SPA перехватывает; экранирование обязательно),
  QR через qrcode-generator (npm, MIT; SVG в отчёте + блок в PDF; адрес НЕ уходит во
  внешние QR-сервисы), схема потока root→leaks в PDF, diff повторных проверок
  (/report → prev из checks.lastCheckForInput ДО записи новой). Мульти-хоп unmix уже
  был в v6 (mixerNodes ≤3). Смок: scripts/test-share-digest.ts SMOK OK.
  Коммиты: cb27043 (unmix-визуал) → c141487 (пакет) → 750dc4e (run_worker_first /r/*).
  Песочница: ключи в /home/z/my-project/.env (в git НЕ попадает); CF-токен:
  export CLOUDFLARE_API_TOKEN=cfut_(токен — в переносном паспорте, в git не хранится)
- Опционально: TRONGRID_KEY / ETHERSCAN_KEY (бесплатные) для снятия 429/лимитов.
