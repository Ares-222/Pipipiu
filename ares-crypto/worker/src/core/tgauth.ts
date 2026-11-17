// Telegram Mini App InitData validation (official scheme):
//   secret_key = HMAC_SHA256(key="WebAppData", message=bot_token)
//   hash = hex(HMAC_SHA256(key=secret_key, message=data_check_string))
// data_check_string = sorted "k=v" lines joined by \n (excluding hash).
// Transport form is URL-encoded (Telegram sends it in the WebApp boot URL);
// the data_check_string itself uses RAW decoded values joined by real newlines.

export interface InitData {
  user?: { id: number; first_name?: string; username?: string };
  auth_date?: number;
  raw: string;
}

export async function validateInitData(initData: string, botToken: string): Promise<InitData | null> {
  if (!initData || !botToken) return null;
  // 1) parse transport form (URLSearchParams handles percent-encoding)
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return null;
  params.delete('hash');
  // 2) build data_check_string: sorted k=v lines, RAW decoded values, \n join
  const lines: string[] = [];
  for (const [k, v] of [...params.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    lines.push(`${k}=${v}`);
  }
  const dataCheckString = lines.join('\n');
  // 3) verify HMAC
  try {
    const enc = new TextEncoder();
    const secretKey = await crypto.subtle.importKey('raw', enc.encode('WebAppData') as BufferSource, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const secret = await crypto.subtle.sign('HMAC', secretKey, enc.encode(botToken) as BufferSource);
    const hmacKey = await crypto.subtle.importKey('raw', secret, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const sig = await crypto.subtle.sign('HMAC', hmacKey, enc.encode(dataCheckString) as BufferSource);
    const hex = [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
    if (hex !== hash) return null;
  } catch {
    return null;
  }
  // 4) extract fields from the DECODED entries
  let user: InitData['user'];
  try { user = JSON.parse(params.get('user') ?? 'undefined'); } catch { user = undefined; }
  return { user, auth_date: parseInt(params.get('auth_date') ?? '0', 10), raw: dataCheckString };
}

// kept for compatibility/tests: verifies an already-decoded data_check_string
export async function validateRaw(dataCheckString: string, hash: string, botToken: string): Promise<InitData | null> {
  try {
    const enc = new TextEncoder();
    const secretKey = await crypto.subtle.importKey('raw', enc.encode('WebAppData') as BufferSource, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const secret = await crypto.subtle.sign('HMAC', secretKey, enc.encode(botToken) as BufferSource);
    const hmacKey = await crypto.subtle.importKey('raw', secret, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const sig = await crypto.subtle.sign('HMAC', hmacKey, enc.encode(dataCheckString) as BufferSource);
    const hex = [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
    if (hex !== hash) return null;
    // data_check_string lines: k=v with real \n separators
    const map = new Map<string, string>();
    for (const line of dataCheckString.split('\n')) {
      const i = line.indexOf('=');
      if (i > 0) map.set(line.slice(0, i), line.slice(i + 1));
    }
    let user: InitData['user'];
    try { user = JSON.parse(map.get('user') ?? 'undefined'); } catch { user = undefined; }
    return { user, auth_date: parseInt(map.get('auth_date') ?? '0', 10), raw: dataCheckString };
  } catch {
    return null;
  }
}
