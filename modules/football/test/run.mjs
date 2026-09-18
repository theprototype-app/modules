// Pure rules + pitch tests — run WITHOUT the app:
//   node modules/football/test/run.mjs        (also `npm run test:football`)
import { run as rulesTests } from './rules.test.mjs';
import { run as pitchTests } from './pitch.test.mjs';

let failures = 0;
function check(ok, label) {
	console.log((ok ? 'PASS ' : 'FAIL ') + label);
	if (!ok) failures++;
}
console.log('=== rules.test.mjs ===');
rulesTests(check);
console.log('\n=== pitch.test.mjs ===');
pitchTests(check);
console.log('\n' + (failures === 0 ? 'ALL PASS' : failures + ' FAILURES'));
process.exit(failures === 0 ? 0 : 1);
