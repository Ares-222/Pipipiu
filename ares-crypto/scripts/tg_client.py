#!/usr/bin/env python3
# Тестовый клиент прод-API из песочницы (паспорт §5): подписывает валидный
# initData админа (id 5188446459, официальная схема Telegram) и дергает живой
# воркер. Запуск: python3 -I scripts/tg_client.py <endpoint> [query]
# Примеры:
#   python3 -I scripts/tg_client.py /report "addr=TRKhSYVuCmNLn8a6ghuqCJ4X83usLpffF8"
#   python3 -I scripts/tg_client.py /graph "addr=0x9c514fc441d70d828198050c100948376aa7d91d&chain=eth&depth=1"

import hashlib
import hmac
import json
import sys
import time
import urllib.parse
import urllib.request

BASE = 'https://ares-crypto.maks222berg.workers.dev'
BOT_TOKEN = '9058426452:AAF0hlQIjj-h2iF2tI9aIbyqUcOiviHtoIw'
ADMIN_ID = 5188446459


def make_init_data(bot_token: str, user_id: int) -> str:
    auth_date = str(int(time.time()))
    user = json.dumps({'id': user_id, 'first_name': 'Ares', 'username': 'ares_admin'}, separators=(',', ':'))
    params = {'auth_date': auth_date, 'user': user}
    dcs = '\n'.join(f'{k}={params[k]}' for k in sorted(params))
    secret = hmac.new(b'WebAppData', bot_token.encode(), hashlib.sha256).digest()
    sig = hmac.new(secret, dcs.encode(), hashlib.sha256).hexdigest()
    return urllib.parse.urlencode({**params, 'hash': sig})


def call(path: str, query: str = '') -> dict:
    init = make_init_data(BOT_TOKEN, ADMIN_ID)
    url = f'{BASE}/api{path}' + (f'?{query}' if query else '')
    # CF WAF режет дефолтный python-urllib UA (error 1010) — притворимся браузером.
    req = urllib.request.Request(url, headers={
        'x-init-data': init,
        'content-type': 'application/json',
        'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36',
    })
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.loads(r.read().decode())


if __name__ == '__main__':
    path = sys.argv[1] if len(sys.argv) > 1 else '/me'
    query = sys.argv[2] if len(sys.argv) > 2 else ''
    out = call(path, query)
    js = json.dumps(out, ensure_ascii=False)
    print(js[:2200] + ('…' if len(js) > 2200 else ''))
