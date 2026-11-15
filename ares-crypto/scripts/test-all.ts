// Runs all module smoke tests sequentially (live network). ~5-8 min total.
// Run: node scripts/test-all.ts
import { spawnSync } from 'node:child_process';

const tests = [
  'test-adapters.ts',   // M1: детектор + адаптеры
  'test-profile.ts',    // M2: профиль
  'test-aml.ts',        // M3: AML + фиды
  'test-api.ts',        // M4: InitData + REST API
  'test-monitor.ts',    // M7: мониторинг
  'test-tonosint.ts',   // M8: TON OSINT
  'test-references.ts', // K1/K2
  'test-quota.ts',      // §19 квоты
];

let failed = 0;
for (const t of tests) {
  console.log(`\n########## ${t} ##########`);
  const r = spawnSync('node', [`scripts/${t}`], { stdio: 'inherit', timeout: 300000 });
  if (r.status !== 0) { failed++; console.log(`>>> ${t} EXITED ${r.status}`); }
}
console.log(failed === 0 ? '\nALL TESTS PASSED' : `\n${failed} test(s) FAILED`);
process.exit(failed === 0 ? 0 : 1);
