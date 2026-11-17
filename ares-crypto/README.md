# Ares Crypto-Analytics

Telegram-бот + Mini App для OSINT-аналитики криптокошельков: быстрый отчёт, расследование
по графу, AML-скоринг на публичных данных, мониторинг каждые 5 минут, TON-OSINT.
Стек — только бесплатное: **Cloudflare Workers (free) + D1 + KV + Durable Objects + Pages**, боты
без long-lived сервера (webhook), для песочницы — long-polling.

> **Дисклеймер (везде в продукте):** публичные блокчейн-данные. Вероятностные оценки.
> Не является финансовым советом или юридическим доказательством.

## Что внутри (монорепо)

```
/worker                 Cloudflare Worker (TypeScript, без runtime-зависимостей)
  src/index.ts            /tg-webhook + /api/* (Mini App) + scheduled (cron */5, суточный синк)
  src/core/               типы, детектор ввода, цены, KV/D1-абстракции, InitData-валидация, http c circuit-breaker
  src/adapters/           TRON (TronGrid+Tronscan), TON (tonapi+toncenter), EVM (Etherscan V2 + публичные RPC),
                          BTC (blockstream+mempool.space), Solana (public RPC), registry с probe-стратегией
  src/engine/             profile (KPI/находки/транзитность/классификация), aml (§9), labels,
                          tracer (BFS+unmix), monitor, tonosint, references (K1/K2), quota,
                          feeds (OFAC/ScamSniffer), freeze (Tether/USDC on-chain), goplus (keyless), ai (/ai)
  src/tg/                 router (все команды §14), formatter (русские отчёты), keyboards, bot api client
  src/api/routes.ts       REST для Mini App (auth: Telegram initData HMAC, без паролей)
  src/do/                 TracerDO, MonitorDO (пошаговые задачи через alarms)
  src/schema.sql          D1-миграции (§18 + расширение addr для unmix)
  wrangler.toml           биндинги D1/KV/DO, cron: */5 и 0 6 * * *
/miniapp                Vite + React 18 + TypeScript + Tailwind 4 + Cytoscape.js + jsPDF
  src/screens/            Главная, Отчёт (KPI/находки/профиль/транзитность/AML/Telegram), Граф, Мониторинг, История, Настройки
  src/card/card.ts        фотокарточка canvas 1080×1350 (§17, pipeline A)
  src/pdf/makePdf.ts      PDF (K7): jsPDF + DejaVuSans.ttf (кириллица), отправка через /api/pdf
  public/fonts/           DejaVuSans.ttf (шрифт в репозитории, как требует K7)
/scripts                песочница и утилиты (Node 24+, без сборки — нативный TS)
  dev-polling.ts          long-polling бот для песочницы/теста заказчиком в реальном Telegram
  test-*.ts               smoke-тесты каждого модуля на живых данных (см. docs/TESTLOG.md)
  index-tornado.ts        индексация депозитов/выводов Tornado (Etherscan logs, чанки)
  sync-ofac.ts            синк OFAC SDN + ScamSniffer
  build-labels-import.py  сборка merged-labels.json + labels-d1.sql из 4 датасетов (PyYAML)
  test-live-checks.ts     smoke новых модулей: freeze / goplus / ai / интеграция в scoreAml
```

## Быстрый старт в песочнице (без деплоя)

```bash
# Node 24+ (нативный запуск .ts)
cp .env.example .env                # вписать BOT_TOKEN, ADMIN_ID, ключи провайдеров
node scripts/dev-polling.ts         # бот жив: long polling + фиды + мониторинг каждые 60с
npm run test:all                    # все smoke-тесты (см. docs/TESTLOG.md)
```

`.env` в git не попадает. Ключи: BOT_TOKEN (@BotFather), ADMIN_ID, ETHERSCAN_KEY,
TRONGRID_KEY, TONCENTER_KEY (опция), GITHUB_TOKEN (опция, для K1 Code Search).

## Мини-приложение

```bash
cd miniapp && npm install && npm run build   # dist/ → Cloudflare Pages (или GitHub Pages fallback)
```
В `miniapp/index.html` пропишите `window.ARES_CONFIG.apiBase` — URL Worker'а.
Авторизация — только Telegram initData (HMAC по токену бота, `worker/src/core/tgauth.ts`),
невалидная подпись → 401. Своих паролей нет.

## Ключевые продуктовые решения (сверено с ТЗ §0–§24)

- **Детектор ввода §6**: форматная матрица + probe 3 с (TRON → TON → ETH → BTC → SOL);
  TRON-probe через `walletsolidity/getaccount` (лёгкий ответ даже для контрактов — замерено).
- **Профиль §10**: KPI как в эталоне, именованные находки с числами и severity-точками,
  транзитность (жадный матчинг in→out ±5%, окно 7 дней), классификация с достоверностью.
- **AML §9**: score = base × volumeShare × 0.5^лет; OFAC (527 крипто-адресов в дампе),
  ScamSniffer (2530), freeze-листы эмитентов в реальном времени (USDT TRON/ETH, USDC ETH —
  `isBlackListed()` читается прямо из контрактов, подход SpiderAml/wallet-checker),
  GoPlus Security keyless для EVM, индекс депозитов Tornado. Все находки оседают в
  aml_sources (база растёт сама). Вердикт-полосы 20/40/60/80.
- **AI-комментарий `/ai`** (кнопка «🤖 AI» под отчётом): компактный дайджест отчёта →
  OpenRouter (только бесплатные модели `:free`, авто-выбор из /models, кэш 6 ч/12 ч),
  квота как у расследований. Без ключа — честное сообщение, без выдумок.
- **Трассировка §11**: BFS top-K по объёму, fetch-бюджет 25–30 на вызов, unmix по индексу
  депозитов (p = 1/n выводов того же номинала в окне 24 ч) — вероятностная пометка обязательна.
- **Мониторинг §12**: cron */5, диф по снапшоту хэшей, фильтр min_usd, метки контрагентов,
  деградация после 3 неудач с честным сообщением юзеру.
- **Фотокарточка §17**: client-canvas 1080×1350 → POST /api/render → sendPhoto; текстовый
  отчёт в чате — всегда, карточка — усиливающий слой.
- **PDF K7**: генерация в Mini App (jsPDF + DejaVuSans.ttf из репозитория), отправка через
  Worker sendDocument; графика и таблицы не выходят за поля, дисклеймер на каждой странице.
- **K1/K2/K3**: ScamSniffer и OFAC — синк; ChainAbuse (403 анонимно — замер) и поисковики
  (ToS) не скрейпятся; GitHub Code Search — опциональный токен. Раздел «Открытые
  упоминания» показывает только реально проверенные источники. Правило фокуса K6 соблюдено.
- **Метки: 31 442** из 4 открытых датасетов (ton-labels, etherscan-labels, eth-labels,
  **GraphSense TagPacks** — BTC впервые получил scam 4 939 / mixer 1 548 / cex+service).
  Гигантские дампы-паки отфильтрованы, скам-паки с капом 1500 — см. `docs/GITHUB-FINDINGS.md`.
- **Квоты §19**: quick 40 / trace 5 / aml 40 / watch 5 (админ — без лимитов), кэш KV:
  профиль 10 мин, tx-страница 10 мин, метки 24 ч, цены 5 мин.

## Документация

- `README-DEPLOY.md` — пошаговый деплой (§22).
- `docs/API-VERIFICATION.md` — все внешние API с реальными замерами лимитов и форматов.
- `docs/TESTLOG.md` — результаты smoke-тестов и чек-лист §21 с реальными ответами.
