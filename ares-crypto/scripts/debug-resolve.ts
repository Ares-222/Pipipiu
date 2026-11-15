// Debug: input resolution for the TRON USDT contract vector.
import { makeSandbox } from './sandbox.ts';
import { detectFormat, resolveInput } from '../worker/src/core/detect.ts';
import { fetchCount } from '../worker/src/core/http.ts';

const { registry } = makeSandbox();
const addr = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';

const fmt = detectFormat(addr);
console.log('format:', JSON.stringify(fmt));

const probe = await registry.probe('tron', addr, 3000);
console.log('probe(tron):', probe, 'fetches:', fetchCount());

const resolved = await resolveInput(addr, registry, 3000);
console.log('resolved:', JSON.stringify({ kind: resolved.kind, clean: resolved.clean, probed: resolved.probed }, null, 2));
