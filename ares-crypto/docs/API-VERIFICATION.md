# Верификация внешних API — реальные замеры из песочницы (2026-11-14)

Каждый провайдер проверен живым curl/запросом до вживления (правило §0.1). Форматы
ответов и лимиты ниже — из проверенных ответов, не из фантазий.

## Работающие (основа архитектуры)

| Провайдер | Роль | Замер |
|---|---|---|
| **Telegram Bot API** | бот | `getMe` ok: true; токен из ТЗ живой (`@Snwbdoiwhcryptoares_bot`). Ответы завёрнуты в `{ok,result,description}` — client разворачивает и бросает ошибку по `ok:false`. |
| **TronGrid** (key) | TRON primary | `/v1/accounts/{a}` (для контрактов ответ очень большой — probe через `walletsolidity/getaccount` с `visible:true`: лёгкий, отдаёт `type:"Contract"`); `/transactions/trc20` отдаёт `token_info` с decimals; timestamp в мс. |
| **Tronscan** (без ключа) | TRON fallback | `/api/account?address=` — балансы TRC-20, `totalTransactionCount`; контракты: `accountType===2` (числовой!), `is_contract` у контрактов отсутствует. **Лимит: 3 rps, при превышении — HTTP 200 с телом `{"Error":"… suspended for 82 s"}`** — лечится троттлингом; теги/имена адресов анонимно НЕ отдаются (name='' для известных биржевых кошельков — проверено). |
| **tonapi.io v2** | TON primary | `/accounts/{a}`: `balance` в нанотонах, `interfaces` (`jetton_master`), `is_wallet`, `is_scam`; `/accounts/{a}/jettons` — балансы; `/accounts/{a}/events` — группированные действия (`TonTransfer`, `JettonTransfer`); `/accounts/{a}/nfts` — имя NFT в `metadata.name` (top-level name часто null); `/dns/{name}/resolve` — ответ `{wallet:{address:…}}` (не `address.address` — было исправлено по факту). Без ключа. |
| **toncenter v2** (key) | TON fallback | `getAddressInformation` с `X-API-Key` — ok. |
| **Etherscan V2** (key) | ETH/Polygon/Arbitrum | Free подтверждён ТОЛЬКО для chainid **1, 137, 42161**. chainid 56 (BSC), 10 (OP), 8453 (Base), 43114 — `Free API access is not supported for this chain`. chainid 250 — не поддержан вовсе. `module=logs` отдаёт полный архив (использован для индексации Tornado); `timeStamp` в логах — HEX (`parseInt(…,16)`). `getabi` — работает. |
| **Публичные RPC** | BSC/OP/Base/ETH | `bsc-dataseed.binance.org`, `mainnet.optimism.io`, `mainnet.base.org`, `ethereum-rpc.publicnode.com` — баланс/getCode/tx-by-hash без ключа. Истории переводов по адресу на free — нет: честный `partial:true`. |
| **blockstream.info Esplora** | BTC primary | `/api/address/{a}` + `/txs` + `/tx/{h}` —genesis: 5 771 212 729 сат, 67 505 tx (сверено). **mempool.space из песочницы недоступен (timeout)** — оставлен fallback-хостом. |
| **CoinGecko** | цены primary | `simple/price` без ключа — работает. |
| **DeFiLlama coins** | цены fallback | `coins.llama.fi/prices/current/…` — работает, без ключа. |
| **OFAC SDN** | санкции | `treasury.gov/ofac/downloads/sdn.csv` — 5,8 МБ; парсер извлёк **527 крипто-адресов** (XBT 260, TRX 141, ETH 90, иные 32+). Адреса в поле remarks: `Digital Currency Address - <CODE> <addr>`. |
| **ScamSniffer** | скам-базы | `raw.githubusercontent.com/scamsniffer/scam-database/main/blacklist/address.json` — **2530 адресов** (массив 0x…). |
| **Blockchair** | универсальный fallback | Free покрывает только bitcoin (+ethereum частично): `bsc|polygon|…` — 404; для «не-фри» EVM-сетей бесполезен → публичные RPC. |
| **Solana public RPC** | Solana (базово) | `getBalance` — ответ `{context,value}`; `getSignaturesForAddress` + `getTransaction(encoding:jsonParsed)` — `accountKeys` объекты `{pubkey}` (в `json`-encoding строки, обрабатываются оба). |
| **TON DNS** | TON OSINT | `foundation.ton`, `fragment.ton` резолвятся; форма ответа `{wallet:{address}}`; `.t.me`-сабдомены — для юзернеймов, привязанных к кошельку в Telegram (нет привязки → `entity not found` — обрабатывается). |

## Найденные on-chain факты (для unmix)

- Адреса инстансов Tornado Cash ETH — **проверены `eth_getCode`** (мои первые варианты
  были ошибочны и имели пустой код; правильные найдены веб-поиском etherscan-страниц):
  `0x12D66f87A04A9E220743712CE6D9bB1B5616B8Fc` (0.1), `0x47CE0C6eD5B0Ce3d3A51fdb1C52DC66a7c3c2936` (1),
  `0x910cbd523d972eb0a6f4cae4618ad62622b39dbf` (10), `0xA160cdAB225685dA1d56aa342Ad8841c3b53f291` (100).
- ABI (Etherscan getabi): `Deposit(bytes32,uint32,uint256)` — топик
  `0xa945e51e…` (keccak сверен), депонента в событии НЕТ (депонент = `tx.from`, нужен
  отдельный fetch транзакции); `Withdrawal(address,bytes32,address,uint256)` — топик
  `0xe9e508ba…`, выводящий = **первое слово data** (в topics — relayer и fee).
- Депозиты фактически прекращены после августа 2022 (санкции) — исторические диапазоны
  до блока ~15.4M; publicnode обрезает историю (pruned, earliest 15 500 000), drpc —
  лимит 10 000 блоков на range (free), llamarpc/ankr/cloudflare — 403/401 → **Etherscan
  logs API выбран как транспорт индексации**.

## Недоступные анонимно (честная деградация, не скрейп)

| Источник | Причина | Замена |
|---|---|---|
| ChainAbuse | 403 (bot-protection), свободного API нет | пользовательский флаг `/report` → очередь модерации админа (KB) |
| MrLuit/EtherScamDB | raw-файл 404 (репо архивирован) | ScamSniffer + собственная KB |
| OpenSanctions data-дамп | 404 на опробованных путях | OFAC напрямую (авторитетный источник) |
| WalletExplorer | connection reset из песочницы | метки из KB админа + Tronscan/tonapi поля |
| Google/Bing/DDG/Yandex (K1) | скриптовый доступ нарушает ToS — не делаем | GitHub Code Search с опц. токеном; раздел показывает только реально проверенное |
| GitHub Code Search | нужен токен (K1: «бесплатный токен в .env») | работает при наличии `GITHUB_TOKEN` |

## Дополнения GitHub-ресёрча (замеры 2026-11-16, см. docs/GITHUB-FINDINGS.md)

| Провайдер | Роль | Замер |
|---|---|---|
| **Tether USDT TRON (TR7NHqje…)** | freeze-проверка | `wallet/triggerconstantcontract` `isBlackListed(address)`, `visible:true`, owner = сам адрес. **`constant_result` — 64 hex-символа БЕЗ `0x`** (в отличие от eth_call). Ответ-bool: `00…00` = false, `00…01` = true. Замер: OFAC-адреса Bank Markazti → false (не заморожены Tether), механизм возвращает корректный ABI-bool. |
| **Tether USDT ETH (0xdAC17…)** | freeze-проверка | `eth_call`, селектор `0xe47d6060` = keccak("isBlackListed(address)")[:4]. publicnode/1rpc отвечают корректным word. |
| **USDC ETH (0xA0b869…)** | freeze-проверка | Селектор отличается: геттер **`isBlacklisted`** (маленькая 'l') → `0xfe575a87`. Варианты `isBlackListed`/`blackListed`/`isFrozen` — revert на 3 RPC (drpc/publicnode/blastapi). Итог: USDC-фризы читаются тем же паттерном с другим селектором. |
| **USDT BSC (0x55d3…)** | freeze — НЕ годится | `isBlackListed` → пустой revert `0x` на bsc-dataseed: у Binance-Pegged USDT нет рабочей функции → из freeze-движка исключён (честно, не эмулируем). |
| **GoPlus Security** | AML-флаги EVM (keyless) | `GET api.gopluslabs.com/api/v1/address_security/{addr}?chain_id=1`. **Из песочницы TLS «unrecognized name»** (SNI egress-прокси) — замерить тело не удалось; из Workers — обычный GET (docs.gopluslabs.io, ~30 rpm free). Реализация с breaker + никогда-не-бросает + error-log; прод-поведение подтвердить на живом боте. |
| **OpenRouter** | AI-комментарий | `GET /api/v1/models` без ключа: 469 моделей, **14 с суффиксом `:free`** (список ротируется — авто-выбор в рантайме). `POST /chat/completions` — OpenAI-совместимый; timeout 30 c, retries 0. |
| **GraphSense TagPacks** | BTC/ETH-метки | `github.com/graphsense-tagpacks` (MIT, ветка master): 87 YAML-паков. Формат: header `category`/`currency` + `tags[]` c per-tag `address`/`label`/`currency`/`abuse`. Крупнейшие паки — дампы (BitMEX 6×50k, miners 37k, sextortion 58k) — отфильтрованы; кураторские 72 пака ≈ 14k тегов + скам-паки по 1500. Импорт в D1: 31 442 changes / 94 326 rows_written (лимит free 100k/день). |
