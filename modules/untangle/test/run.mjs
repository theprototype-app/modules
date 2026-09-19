// Pure puzzle tests — run WITHOUT the app:
//   node modules/untangle/test/run.mjs   (npm run test:untangle)
import { run as puzzleTests } from './puzzle.test.mjs';

let failures = 0;
function check(ok, label) {
	console.log((ok ? 'PASS ' : 'FAIL ') + label);
	if (!ok) failures++;
}
console.log('=== puzzle.test.mjs ===');
puzzleTests(check);
console.log('\n' + (failures === 0 ? 'ALL PASS' : failures + ' FAILURES'));
process.exit(failures === 0 ? 0 : 1);
