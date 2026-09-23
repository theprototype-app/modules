// Pure puzzle tests — run WITHOUT the app:
//   node modules/untangle/test/run.mjs   (npm run test:untangle)
import { run as puzzleTests } from './puzzle.test.mjs';
import { run as progressTests } from './progress.test.mjs';
import { run as sphereTests } from './sphere.test.mjs';
import { run as defTests } from './def.test.mjs';

let failures = 0;
function check(ok, label) {
	console.log((ok ? 'PASS ' : 'FAIL ') + label);
	if (!ok) failures++;
}
console.log('=== puzzle.test.mjs ===');
puzzleTests(check);
console.log('\n=== progress.test.mjs ===');
progressTests(check);
console.log('\n=== sphere.test.mjs ===');
sphereTests(check);
console.log('\n=== def.test.mjs ===');
await defTests(check);
console.log('\n' + (failures === 0 ? 'ALL PASS' : failures + ' FAILURES'));
process.exit(failures === 0 ? 0 : 1);
