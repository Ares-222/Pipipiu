#!/usr/bin/env python3
# v7 (№1): сборка SQL-импорта открытых датасетов меток в прод-D1.
# Источники (клонировать в /tmp/ds):
#   eth-labels   https://github.com/dawsbot/eth-labels        (144k, словарь меток etherscan)
#   forta        https://github.com/forta-network/labelled-datasets (фишинг/эксплойтеры)
#   etherscan    https://github.com/brianleect/etherscan-labels (дамп тегов etherscan)
# Правила:
#   - бюджет D1 free = 100k rows_written/сутки: импортируем только осмысленное
#     (mixer/scam/exploit/phish/bridge/exchange/DEX), «other» (~99k) пропускаем;
#   - грязные адреса (scam/mixer) идут И в labels, И в aml_sources (severity
#     high/critical) — тогда они работают в AML-скоринге, а не только в графе;
#   - адреса только 0x…40 hex (chainId 1, Ethereum), lowercase;
#   - дедуп: приоритет forta > eth-labels(bad) > etherscan(risk) > eth-labels(cex/bridge) > etherscan(rest).
# Запуск: python3 scripts/build-datasets-import.py /tmp/ds scripts/labels-v7.sql

import csv
import json
import os
import re
import sys
import time

SRC = sys.argv[1] if len(sys.argv) > 1 else '/tmp/ds'
OUT = sys.argv[2] if len(sys.argv) > 2 else 'scripts/labels-v7.sql'
NOW = int(time.time())

EVM = re.compile(r'^0x[0-9a-fA-F]{40}$')

# Категоризация по меткам словаря eth-labels (подстрочный матч, lowercase).
MIXER_KW = ['tornado', 'mixer', 'cypher', 'blender']
BAD_KW = ['exploit', 'heist', 'phish', 'scam', 'fraud', 'hijack', 'steal', 'lazarus', 'badger', 'ronin-hack', 'kucoin-hack']
BRIDGE_KW = ['bridge']
CEX_KW = ['exchange', 'binance', 'coinbase', 'okx', 'okex', 'bybit', 'kucoin', 'bitget', 'deribit', 'kraken',
          'gemini', 'bitfinex', 'huobi', 'htx', 'bithumb', 'upbit', 'coinone', 'gate-io', 'gateio', 'mexc',
          'cryptocom', 'crypto.com', 'bitstamp', 'bitmex', 'poloniex', 'bitflyer', 'luno', 'krak', 'whitebit',
          'bitvavo', 'indodax', 'coincheck', 'zaif', 'bitbank', 'ascendex', 'hotbit', 'digifinex', 'lbank',
          'xt-com', 'bingx', 'bitmart', 'bitrue', 'coinex', 'p2pb2b', 'nomad', 'hydradx']
DEFI_KW = ['uniswap', 'sushiswap', 'pancakeswap', 'curve-fi', 'curvefi', 'curve-dao', 'aave', 'compound',
           'lido', 'makerdao', 'maker-dao', 'yearn', 'balancer', '1inch', '0x-protocol', 'dydx', 'gmegn',
           'pendle', 'convex', 'frax', 'rocket-pool', 'rocketpool', 'ethena', 'ether.fi', 'morpho', 'spark']
SERVICE_KW = ['deposit', 'wallet', 'pay', 'swap', 'staking', 'bridge-operator']

def cat_of(label: str):
    l = label.lower()
    if any(k in l for k in MIXER_KW): return 'mixer'
    if any(k in l for k in BAD_KW): return 'scam'
    if any(k in l for k in BRIDGE_KW) and 'bridged-token' not in l: return 'bridge'
    if any(k in l for k in CEX_KW): return 'cex'
    if any(k in l for k in DEFI_KW): return 'service'
    return None

def sql(v: str) -> str:
    return "'" + v.replace("'", "''") + "'"

# addr -> (priority, category, name, source)
best = {}
prio = {'forta': 0, 'eth-bad': 1, 'el-risk': 2, 'eth-rest': 3, 'el-rest': 4}
def put(addr, cat, name, source, p):
    a = addr.lower()
    if not EVM.match(addr): return
    cur = best.get(a)
    if cur is None or p < cur[0]:
        best[a] = (p, cat, name[:120], source)

# 1) eth-labels accounts.json (словарь etherscan/метаданных)
with open(f'{SRC}/eth-labels/data/json/accounts.json') as f:
    accounts = json.load(f)
print(f'eth-labels accounts: {len(accounts)}')
for x in accounts:
    lbl = x.get('label', '')
    name = x.get('nameTag') or lbl
    cat = cat_of(lbl)
    if not cat: continue
    p = 'eth-bad' if cat in ('scam', 'mixer') else 'eth-rest'
    put(x['address'], cat, name, 'ds:eth-labels', prio[p])

# 2) forta: фишинг + вредоносные контракты + эксплойтеры etherscan
forta_files = [
    ('forta/labels/1/phishing_scams.csv', 'address', 'etherscan_tag'),
    ('forta/labels/1/malicious_smart_contracts.csv', 'contract_address', 'contract_tag'),
    ('forta/labels/1/etherscan_malicious_labels.csv', 'banned_address', 'wallet_tag'),
]
for rel, col_addr, col_tag in forta_files:
    path = f'{SRC}/{rel}'
    if not os.path.exists(path): continue
    n = 0
    with open(path, newline='') as f:
        for row in csv.DictReader(f):
            a, tag = (row.get(col_addr) or '').strip(), (row.get(col_tag) or '').strip()
            if a and tag:
                put(a, 'scam', tag, 'ds:forta', prio['forta'])
                n += 1
    print(f'forta {rel.split("/")[-1]}: {n}')

# 3) etherscan-labels (дамп тегов): risk-метки целиком, остальные — только осмысленные имена
el_path = f'{SRC}/el/data/etherscan/combined/combinedAllLabels.json'
if os.path.exists(el_path):
    with open(el_path) as f:
        el = json.load(f)
    print(f'etherscan combined: {len(el)}')
    for a, v in el.items():
        labels = [l.lower() for l in (v.get('labels') or [])]
        name = v.get('name') or ''
        risk = any(any(k in l for k in BAD_KW + MIXER_KW) for l in labels)
        cat = None
        if risk: cat = 'mixer' if any(any(k in l for k in MIXER_KW) for l in labels) else 'scam'
        else:
            cat = cat_of(name) or cat_of(' '.join(labels))
        if not cat: continue
        p = 'el-risk' if risk else 'el-rest'
        put(a, cat, name or (';'.join(labels) or 'etherscan tag'), 'ds:etherscan', prio[p])

# 4) строки для labels и aml_sources
label_rows, aml_rows = [], []
for a, (p, cat, name, source) in best.items():
    label_rows.append(('eth', a, cat, name, source))
    if cat in ('scam', 'mixer'):
        aml_rows.append(('eth', a, f'dirty:{source}', 'critical' if cat == 'mixer' else 'high', name))

print(f'unique addrs: {len(best)} · labels: {len(label_rows)} · aml_sources: {len(aml_rows)}')
by_cat = {}
for _, _, c, _, _ in label_rows: by_cat[c] = by_cat.get(c, 0) + 1
print('by category:', by_cat)

# 5) SQL: multi-row INSERT OR IGNORE (500 строк на стейтмент — под лимиты D1)
def batches(rows, size=500):
    for i in range(0, len(rows), size):
        yield rows[i:i + size]

out = ['-- v7 (№1) импорт открытых датасетов меток · сгенерировано scripts/build-datasets-import.py',
       f'-- строк labels: {len(label_rows)}, aml_sources: {len(aml_rows)} · {time.strftime("%Y-%m-%d %H:%M UTC", time.gmtime())}', '']
for b in batches(label_rows):
    vals = ','.join(f"('eth',{sql(a)},{sql(c)},{sql(nm)},{sql(src)},'high','ds-import',{NOW})" for _, a, c, nm, src in b)
    out.append(f'INSERT OR IGNORE INTO labels (chain, addr, category, name, source, confidence, added_by, updated_at) VALUES {vals};')
for b in batches(aml_rows):
    vals = ','.join(f"('eth',{sql(a)},{sql(src)},{sql(sev)},{sql(ref)},{NOW})" for _, a, src, sev, ref in b)
    out.append(f'INSERT OR IGNORE INTO aml_sources (chain, addr, source, severity, ref, updated_at) VALUES {vals};')

os.makedirs(os.path.dirname(OUT) or '.', exist_ok=True)
with open(OUT, 'w') as f:
    f.write('\n'.join(out))
size_mb = os.path.getsize(OUT) / 1e6
print(f'SQL -> {OUT} ({size_mb:.1f} MB, {len(out)-3} стейтментов)')
