// Pure rule tests — run WITHOUT the app:
//   node modules/dungeon-realms/test/run.mjs   (npm run test:dungeon-realms)
// The generator suites live with the generator in modules/dungeon/test (21-C C6).
import { run as rulesTests } from './rules.test.mjs';

let failures = 0;
function check(ok, label) {
	console.log((ok ? 'PASS ' : 'FAIL ') + label);
	if (!ok) failures++;
}

console.log('=== rules.test.mjs ===');
rulesTests(check);

console.log('\n' + (failures === 0 ? 'ALL PASS' : failures + ' FAILURES'));
process.exit(failures === 0 ? 0 : 1);
