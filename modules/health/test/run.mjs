// Pure ledger + graph tests — run WITHOUT the app:
//   node modules/health/test/run.mjs        (also `npm run test:health`)
import { run as ledgerTests } from './ledger.test.mjs';
import { run as graphTests } from './graph.test.mjs';
import { run as engineTests } from './engine.test.mjs';

let failures = 0;
function check(ok, label) {
	console.log((ok ? 'PASS ' : 'FAIL ') + label);
	if (!ok) failures++;
}
console.log('=== ledger.test.mjs ===');
ledgerTests(check);
console.log('\n=== graph.test.mjs ===');
graphTests(check);
console.log('\n=== engine.test.mjs ===');
engineTests(check);
console.log('\n' + (failures === 0 ? 'ALL PASS' : failures + ' FAILURES'));
process.exit(failures === 0 ? 0 : 1);
