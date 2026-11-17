#!/usr/bin/env python3
# Собирает единый файл меток из четырёх открытых датасетов:
#   1) ton-labels (github.com/ton-studio/ton-labels)       — TON, категории в metadata.category
#   2) etherscan-labels (github.com/brianleect/...)       — EVM, combinedAllLabels.json (name + tags)
#   3) eth-labels (github.com/dawsbot/eth-labels)         — EVM, src/mainnet/<категория>/*.json
#   4) GraphSense TagPacks (github.com/graphsense-tagpacks, MIT) — BTC/ETH, packs/**/*.yaml
# Выход:
#   data/labels/merged-labels.json  — [{chain, addr, name, category, source, confidence}]
#   data/labels/labels-d1.sql       — INSERT OR REPLACE для D1 (wrangler d1 execute ares --remote --file=...)
# Честность: не выдумываем ни адресов, ни имён; только то, что реально есть в датасетах.
import json, glob, os, re, sys
import yaml

BASE = os.path.join(os.path.dirname(__file__), '..', 'data', 'labels')
ORIGIN = os.path.join(BASE, 'origin')
OUT_JSON = os.path.join(BASE, 'merged-labels.json')
OUT_SQL = os.path.join(BASE, 'labels-d1.sql')

entries = {}  # key: (chain, addr_lower) -> entry (приоритет категорий при дубликатах)
CAT_PRIORITY = {'mixer': 100, 'sanctioned': 95, 'scam': 90, 'cex': 80, 'tgbots': 70, 'bridge': 60, 'payment': 55, 'service': 40, 'token': 20, 'personal': 10}

def add(chain, addr, name, category, source, confidence):
    addr = addr.strip()
    if not addr or not name:
        return
    key = (chain, addr.lower())
    cur = entries.get(key)
    if cur is None or CAT_PRIORITY.get(category, 0) > CAT_PRIORITY.get(cur['category'], 0):
        entries[key] = {'chain': chain, 'addr': addr, 'name': name[:60], 'category': category, 'source': source, 'confidence': confidence}

def pretty(name):
    n = re.sub(r'\.(ton|org|io|com|me|xyz|app|finance|tg)$', '', name.strip())
    n = re.sub(r'[-_.]+', ' ', n).strip()
    return n[:1].upper() + n[1:] if n else name

def is_telegram(meta):
    blob = ' '.join(str(meta.get(k, '')) for k in ('label', 'subcategory', 'website', 'description', 'organization')).lower()
    return 't.me' in blob or 'telegram' in blob

# ---------- 1) ton-labels ----------
TON_MAP = {
    'cex': 'cex', 'CEX': 'cex', 'dex': 'service', 'bridge': 'bridge', 'scammer': 'scam',
    'tradingbot': 'service', 'fund': 'service', 'lending': 'service', 'liquid_staking': 'service',
    'yield_aggregator': 'service', 'cdp': 'service', 'validator': 'service', 'infrastructure': 'service',
    'merchant': 'service', 'wallet': 'service', 'ads': 'tgbots', 'gaming': 'service', 'other': 'service',
}
ton_count = 0
for path in glob.glob(os.path.join(ORIGIN, 'ton-labels', 'assets', '**', '*.json'), recursive=True):
    try:
        d = json.load(open(path, encoding='utf-8'))
    except Exception:
        continue
    meta = d.get('metadata') or {}
    raw_cat = str(meta.get('category') or '')
    label = str(meta.get('label') or os.path.basename(path).replace('.json', ''))
    tg = is_telegram(meta)
    cat = TON_MAP.get(raw_cat, 'service')
    # Telegram-экосистема: кошельки/мерчанты/игры/реклама внутри TG — отдельная категория tgbots
    if tg and raw_cat in ('ads', 'merchant', 'wallet', 'gaming', 'cex', 'tradingbot'):
        cat = 'tgbots'
    name = pretty(label)
    for a in d.get('addresses', []):
        addr = str(a.get('address') or '').strip()
        if not addr:
            continue
        add('ton', addr, name, cat, 'ton-labels (github.com/ton-studio/ton-labels)', 'mid')
        ton_count += 1

# ---------- 2) etherscan-labels (только etherscan = цепочка eth) ----------
# combinedAllLabels.json: { "0x..": {"name": ..., "labels": ["exchange", "dex", ...]} }
KW = [
    (('exchange', 'cex', 'binance', 'hot wallet', 'cold wallet'), 'cex'),
    (('mixer', 'tornado'), 'mixer'),
    (('bridge',), 'bridge'),
    (('phishing', 'hack', 'scam', 'steal', 'exploit', 'heist', 'fraud'), 'scam'),
    (('dex', 'defi', 'lending', 'gambling', 'wallet', 'nft', 'marketplace', 'staking', 'dao', 'swap'), 'service'),
]
def map_labels(labels):
    low = [str(l).lower() for l in (labels or [])]
    for kws, cat in KW:
        for k in kws:
            if any(k in l for l in low):
                return cat
    return None

eth_count = 0
p = os.path.join(ORIGIN, 'etherscan-labels', 'data', 'etherscan', 'combined', 'combinedAllLabels.json')
if os.path.exists(p):
    d = json.load(open(p, encoding='utf-8'))
    for addr, v in d.items():
        if not isinstance(v, dict):
            continue
        cat = map_labels(v.get('labels'))
        if not cat:
            continue
        name = str(v.get('name') or '').strip()
        if not name:
            continue
        add('eth', addr, name, cat, 'etherscan-labels (github.com/brianleect/etherscan-labels)', 'high')
        eth_count += 1

# ---------- 3) eth-labels (dawsbot) — только exchange и phish-hack ----------
daws_count = 0
for sub, cat in (('exchange', 'cex'), ('phish-hack', 'scam')):
    for path in glob.glob(os.path.join(ORIGIN, 'eth-labels', 'src', 'mainnet', sub, '*.json')):
        try:
            arr = json.load(open(path, encoding='utf-8'))
        except Exception:
            continue
        for it in arr if isinstance(arr, list) else []:
            addr = str(it.get('address') or '').strip()
            if not addr:
                continue
            name = str(it.get('nameTag') or sub.replace('-', ' ')).strip() or pretty(sub)
            add('eth', addr, name, cat, 'eth-labels (github.com/dawsbot/eth-labels)', 'high')
            daws_count += 1

# ---------- 4) GraphSense TagPacks (BTC/ETH) ----------
# YAML-паки: header (title/category/currency/confidence/...) + tags: [{address, label?, source?, currency?, abuse?}].
# abuse-теги (phishing, investment_fraud, ransomware...) → категория scam, confidence high.
# Фильтр объёма: паков с >4000 тегов — дампы (BitMEX 6×50k, miners, coinjoin) — пропускаем,
# НО скам/миксер-паки (по abuse или имени файла) берём с капом 1500: это самая ценная для AML часть.
GP_ABUSE = {'scam', 'phishing', 'investment_fraud', 'ransomware', 'blackmail', 'sextortion',
            'dark_market', 'hacking', 'theft', 'ponzi', 'fraud'}
GP_CAT = {'exchange': 'cex', 'gambling': 'gambling', 'mixing': 'mixer', 'scam': 'scam',
          'dark_market': 'scam', 'ransomware': 'scam', 'hacking': 'scam', 'marketplace': 'service',
          'mining_pool': 'service', 'defi': 'service', 'service': 'service', 'wallet': 'service',
          'miner': 'service', 'coinjoin': 'mixer'}

def gp_category(fname: str, hdr_cat: str) -> str:
    """Категория: сначала abuse-имя пака, затем header category."""
    base = fname.lower()
    if re.search(r'scam|phish|etherscamdb|ransom|sextortion|fraud|ponzi', base): return 'scam'
    if re.search(r'blender|wasabi|coinjoin|mixer|samourai|tornado|helix', base): return 'mixer'
    if re.search(r'gambling|casino', base): return 'gambling'
    return GP_CAT.get(hdr_cat, 'service')

gp_count = 0
gp_skipped_bulk = 0
for path in glob.glob(os.path.join(ORIGIN, 'graphsense-tagpacks', 'packs', '**', '*.yaml'), recursive=True):
    try:
        pack = yaml.safe_load(open(path, encoding='utf-8'))
    except Exception:
        continue
    if not isinstance(pack, dict):
        continue
    tags = [t for t in (pack.get('tags') or []) if isinstance(t, dict) and t.get('address')]
    hdr_cat = str(pack.get('category') or '').lower()
    hdr_ccy = str(pack.get('currency') or '').upper()
    title = str(pack.get('title') or os.path.basename(path))
    fname = os.path.basename(path)
    cat = gp_category(fname, hdr_cat)
    # объёмный фильтр: только кураторские паки; скам/миксеры — с капом 1500
    if len(tags) > 4000:
        if cat in ('scam', 'mixer'):
            tags = tags[:1500]
        else:
            gp_skipped_bulk += len(tags)
            continue
    for t in tags:
        addr = str(t.get('address') or '').strip()
        if not addr:
            continue
        ccy = str(t.get('currency') or hdr_ccy).upper()
        if ccy == 'BTC': chain = 'btc'
        elif ccy == 'ETH': chain = 'eth'
        else: continue  # BCH/LTC/BSC и прочие вне наших цепочек
        abuse = str(t.get('abuse') or '').lower()
        if abuse in GP_ABUSE:
            cat_t, conf = 'scam', 'high'
        else:
            cat_t, conf = cat, 'mid'
        name = str(t.get('label') or title).strip()[:60]
        add(chain, addr, name, cat_t,
            'GraphSense TagPacks (github.com/graphsense/graphsense-tagpacks)', conf)
        gp_count += 1

# ---------- статистика и запись ----------
out = sorted(entries.values(), key=lambda e: (e['chain'], e['category'], e['addr']))
stats = {}
for e in out:
    stats[(e['chain'], e['category'])] = stats.get((e['chain'], e['category']), 0) + 1

with open(OUT_JSON, 'w', encoding='utf-8') as f:
    json.dump(out, f, ensure_ascii=False, indent=1)

def sqlq(s):
    return "'" + str(s).replace("'", "''") + "'"

with open(OUT_SQL, 'w', encoding='utf-8') as f:
    f.write('-- Автосгенерировано scripts/build-labels-import.py из открытых датасетов меток.\n')
    f.write('-- Применение на проде: npx wrangler d1 execute ares --remote --file=data/labels/labels-d1.sql\n')
    f.write('-- Без BEGIN/COMMIT: D1 выполняет файл атомарно сам.\n')
    buf = []
    for e in out:
        buf.append(f"INSERT OR REPLACE INTO labels (chain, addr, category, name, source, confidence, added_by, updated_at) "
                   f"VALUES ({sqlq(e['chain'])}, {sqlq(e['addr'] if not e['addr'].startswith('0x') else e['addr'].lower())}, {sqlq(e['category'])}, {sqlq(e['name'])}, {sqlq(e['source'])}, {sqlq(e['confidence'])}, 'dataset-import', 0);")
        if len(buf) >= 200:
            f.write('\n'.join(buf) + '\n')
            buf = []
    if buf:
        f.write('\n'.join(buf) + '\n')

print(f"ton-labels сырых адресов: {ton_count}; etherscan: {eth_count}; dawsbot: {daws_count}; graphsense: {gp_count} (bulk-дампы пропущены: {gp_skipped_bulk})")
print(f"ИТОГО уникальных (chain,addr): {len(out)}")
for (ch, cat), n in sorted(stats.items()):
    print(f"  {ch:4s} {cat:8s} {n}")
print(f"файлы: {OUT_JSON} ({os.path.getsize(OUT_JSON)//1024} KB), {OUT_SQL} ({os.path.getsize(OUT_SQL)//1024} KB)")
