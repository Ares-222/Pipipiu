# ARES CRYPTO — ПАСПОРТ ПРОЕКТА
> Рабочая папка: `/home/z/my-project/ares-crypto` · Telegram-бот `@AresCryptoBot` · обновлено: 2026-11-15

## 1. Что это
OSINT-бот + Mini App для анализа крипто-кошельков. 5 функций: быстрая фотокарточка, глубокое расследование (PDF), мониторинг адресов, бесплатный AML-скоринг, TON OSINT. Стек: Cloudflare Workers (бесплатный тариф) + D1 + KV + Durable Objects + React Mini App. Всё на русском. Только бесплатные API (Etherscan V2, TRONGrid, tonapi.io, mempool.space, Blockchair fallback). Никаких платных API, никакого скрейпинга против ToS.

## 2. Структура репозитория
```
ares-crypto/
├── worker/src/            # Cloudflare Worker (бот + API + DO)
│   ├── adapters/          # btc, evm, sol, ton, tron + registry (ChainAdapter)
│   ├── api/routes.ts      # HTTP API (Mini App) + Telegram webhook
│   ├── core/              # ctx, db(D1), kv, http, prices, detect, tgauth, util, types
│   ├── do/                # TracerDO (пошаговый трейс, alarms) + MonitorDO
│   ├── engine/            # aml, labels, profile, tracer, monitor, feeds, quota, tonosint, references
│   ├── service/report.ts  # генерация отчётов
│   ├── tg/                # bot, router, formatter, keyboards
│   └── worker-d1.ts / worker-kv.ts / index.ts / schema.sql
├── miniapp/               # React + Vite (Home, Report, Graph, History, Monitor, Settings + card/, pdf/)
├── scripts/               # тесты и утилиты (test-*.ts, design-*.ts, dev-polling.ts, sync-ofac.ts)
├── docs/                  # API-VERIFICATION.md (curl-проверки источников), TESTLOG.md
├── .env.example           # шаблон секретов (реальных ключей в репо НЕТ)
├── README.md / README-DEPLOY.md
└── wrangler.toml          # конфиг воркера (ADMIN_ID = 5188446459 — твой TG ID, не секрет)
```

## 3. Статус по функциям (что сделано / что осталось)
| Функция | Статус |
|---|---|
| Фотокарточка (быстрый отчёт) | ✅ ФИНАЛ — дизайн №4 (чёрный + красный Ares), demo-зона чёрная, правки контраста внесены. НЕ трогать |
| PDF-отчёт v3 | ✅ Отправлен на ревью (обложка = фотокарточка + детализация + AML по категориям + легенда). **Ждём 3 правки от заказчика** |
| AML-скоринг | ✅ Логика готова (engine/aml.ts), формат по Quppy-примерам (Exposure-категории, уровни риска). Интеграция в живой пайплайн — в работе |
| Глубокое расследование | ✅ TracerDO пошаговый, alarms; раньше не возвращал результат — проверить при живом тесте |
| Мониторинг | ✅ MonitorDO + cron `*/5` (транзакции) и `0 6` (OFAC/scam sync) |
| TON OSINT | ✅ tonosint.ts (tonapi.io) |
| Mini App | ⚙️ Каркас готов (6 экранов, card/, pdf/), к финализации после PDF-правок |
| README-DEPLOY.md | ✅ Черновик есть, финализировать под «без песочницы» |
| Квоты/лимиты | ✅ quota.ts (5 бесплатных проверок/день, функционал не урезается) |
| LabelEngine | ✅ 9 категорий (cex/payment/mixer/bridge/scam/sanctioned/contract/service/token), «биржа или сервис» выводится в caption и отчёте |

## 4. Текущая задача (на чём остановились)
1. **Три правки PDF** — ждём конкретику от заказчика (сохранены у него вместе с PDF).
2. После правок: перенос формата карточки №4 + PDF v3 в живой пайплайн бота (реальный адрес → реальная карточка + реальный PDF).
3. Затем: README-DEPLOY (самостоятельный запуск), финал Mini App.

## 5. Секреты — где что лежит
- **В репозитории реальных ключей НЕТ.** Проверено grep-ом: только плейсхолдеры `__от_BotFather__` в `.env.example` и `__D1_DATABASE_ID__` / `__KV_CACHE_ID__` в `wrangler.toml`.
- Реальный BOT_TOKEN живёт в secrets песочницы и передаётся через `.env` / `wrangler secret put` — в git не попадает (`.gitignore` содержит `.env`).
- `ADMIN_ID = 5188446459` в `wrangler.toml` — твой Telegram ID, это не секрет, но при желании можно перенести в vars при деплое.
- `.sandbox-db.json` — локальная БД песочницы (лейблы, AML, депозиты) — без токенов, но в GitHub её выкладывать не нужно (мусорный вес 684K); в `.gitignore` при переносе.

## 6. Как перенести проект в новый чат (процедура)
1. Поднять репозиторий на GitHub (см. README-DEPLOY раздел «Перенос»).
2. В новом чате дать ссылку вида `https://github.com/<user>/ares-crypto` — ассистент прочитает код через `git clone` / raw-URL.
3. Первым сообщением кинуть ссылку на этот файл: `PROJECT-PASSPORT.md` — он снимает контекст (структура, статусы, что в работе).
4. Дальше дополнять паспорт по мере работы (раздел 7 — журнал изменений).

## 7. Журнал изменений
- **2026-11-15** — Паспорт создан. Фотокарточка финализирована (дизайн №4), PDF v3 на ревью, ждём 3 правки по PDF.
