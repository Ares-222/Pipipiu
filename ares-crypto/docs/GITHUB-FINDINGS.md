# GitHub-ресёрч (2026-11-16): что искали, что взяли, что отвергли и почему

Задача: найти на GitHub ещё полезные/нужные для проекта источники и подходы поверх уже
внедрённых (OFAC SDN, ScamSniffer, ton-labels, etherscan-labels, eth-labels).
Метод: 17 поисковых запросов к GitHub Search API + чтение README кандидатов +
живые замеры всех источников из песочницы перед вживлением (правило §0.1).

## Взятые находки (внедрены)

### 1. Freeze-проверка Tether/USDC — чтение контрактов вместо синка списков
- Откуда: **0xBreak/SpiderAml** («~11 600 addresses frozen by Tether or Circle,
  read from the contract events») и **Niphridium/wallet-checker** («USDT freeze check —
  isBlackListed() is read directly from the USDT-TRC20 contract at the moment of the check»).
- Что сделано: `worker/src/engine/freeze.ts` — живые проверки `isBlackListed()`
  прямо из контрактов: USDT TRON (TronGrid `triggerconstantcontract`), USDT ETH
  (`eth_call`, селектор `0xe47d6060`), USDC ETH (`0xfe575a87` — у Circle геттер
  `isBlacklisted` с маленькой 'l', найдено подбором селекторов). KV-кэш 6 ч.
- Интеграция: `aml.ts` — сам адрес (hops 0, score 100, severity critical) и
  топ-8 контрагентов по входящему объёму (hops 1, score по формуле §9).
  Найденные замороженные адреса оседают в `aml_sources` (база растёт сама).
- Почему не «список замороженных»: полные списки (≈11.6k) строятся только из
  событий BlackList за всю историю контракта — это часы getLogs-чанков, не годится
  для Workers free. Точечное чтение состояния дешевле и всегда свежее.

### 2. GoPlus Security — keyless AML-подсказки для EVM
- Откуда: **Soniavasseur/Wallet-Risk-Scanner** («GoPlus Security (keyless)»,
  агрегатор SlowMist/BlockSec) и SpiderAml («live lookup per request»).
- Что сделано: `worker/src/engine/goplus.ts` — `GET /api/v1/address_security/{addr}?chain_id=N`
  без ключа (eth/bsc/polygon/op/arb/base), 8 адресных флагов → находки AML +
  самонакопление в `aml_sources`, KV-кэш 6 ч, никогда не бросает исключений.
- Замер: из песочницы `api.gopluslabs.com` недоступен (TLS SNI «unrecognized name»
  в egress-прокси песочницы) — из Cloudflare Workers это обычный GET; модуль
  деградирует честно (null + запись в error-log), прод-поведение проверится на живом боте.

### 3. GraphSense TagPacks — BTC/ETH-метки (MIT)
- Откуда: SpiderAml data-таблица («GraphSense TagPacks (MIT, Iknaio) — ~75 800
  addresses, almost all Bitcoin»); репозиторий **graphsense/graphsense-tagpacks**.
- Что сделано: клон в `data/labels/origin/graphsense-tagpacks`, новый источник №4
  в `scripts/build-labels-import.py`: парсинг packs/**/*.yaml (PyYAML), категория
  из header/имени пака, abuse-теги → scam (confidence high), фильтр объёма
  (паки >4000 тегов — дампы BitMEX 6×50k, miners, coinjoin — пропущены; скам/миксер-паки
  с капом 1500 тегов взяты). Итог: **+22 336 меток**, база 15 979 → **31 442**;
  BTC впервые получил метки: scam 4 939, mixer 1 548, cex/service ~2 900.
- Импорт в прод-D1: `wrangler d1 execute ares --remote --file=data/labels/labels-d1.sql`
  — 31 442 changes, 94 326 rows_written (лимит free 100k/день — учтено при фильтрации).

### 4. AI-комментарий через OpenRouter (/ai)
- Откуда: идея «LLM-обёртки над отчётом» из анализа MistTrackMCP/misttrack-skills
  (SlowMist продаёт AI-доступ через платный API) — реализовали дешевле и честнее:
  прямой вызов OpenAI-совместимого `openrouter.ai/api/v1/chat/completions`,
  модели только бесплатные (`:free`, на момент замера — 14 шт.).
- Что сделано: `worker/src/engine/ai.ts` — авто-выбор модели из `/models` (кэш 6 ч,
  `OPENROUTER_MODEL` фиксирует вручную), компактный дайджест отчёта ≤2000 символов
  (только факты отчёта — анти-галлюцинация в системном промпте), кэш ответа 12 ч,
  квота как у расследований (deep 5/день). Команда `/ai` + кнопка «🤖 AI» под отчётом.
- Без ключа — честное сообщение с инструкцией `wrangler secret put OPENROUTER_API_KEY`.

## Рассмотрено и отвергнуто (честно, с причинами)

| Кандидат | Причина отказа |
|---|---|
| CryptoScamDB | мёртв с 2021–2022 (последний push 2020/2021); ScamSniffer свежее |
| MetaMask/eth-phishing-detect, paradigm/phishing-list | списки доменов, не адресов — бот работает с адресами; домены вне скоупа §6 |
| MyEtherWallet darklist | репозиторий не существует (404 на master/main и в поиске) |
| slowmist/MistTrackMCP, misttrack-skills | MistTrack API платный (x402); бесплатные данные SlowMist уже приходят через GoPlus |
| ChainAbuse API-клиенты | API требует авторизацию; анонимный доступ 403 — замерено ранее, скрейпить не скрейпим (ToS) |
| max9159/blockchain-blacklist-sync-service | свой постоянный сервис + БД — мы получили то же из контрактов дёшево |
| gl0bal01/chainmap | клиентский граф-эксплорер на Etherscan — наш Mini App уже делает граф на Cytoscape; «load older»-курсор — в roadmap |
| Soniavasseur/Wallet-Risk-Scanner целиком | Python-CLI с сетью провайдеров; взяли только идею GoPlus (остальное у нас уже есть или платно) |
| ImMike/crypto-wallet-address-labels | SEO-агрегатор со ссылками на внешние датасеты; primaries уже есть, новое не дал |
| OFAC-парсеры (bitnob/ofac-address-feed и пр.) | свой OFAC-парсер работает (527 адресов из SDN remarks) |
| UK FCDO / EU consolidated sanctions | адреса спрятаны в огромных XML/CSV remarks; из песочницы дампы не скачались; открытая задача в roadmap |

## Побочные находки для roadmap
- **life-after-sanctions (DicksonWu654)** — датасет «что становится с адресом после
  санкций» — интересно для аналитики «просроченных» OFAC-меток.
- **chainmap: dashed border + load-older курсор графа** — UX-идея для Mini App.
- **Nighty3098/SkyFall** — OSINT-тулкит (не крипто-специфичный) — вне скоупа бота.
