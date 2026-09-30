// Pure puzzle tests — run WITHOUT the app:
//   node modules/untangle/test/run.mjs   (npm run test:untangle)
import { run as puzzleTests } from './puzzle.test.mjs';
import { run as progressTests } from './progress.test.mjs';
import { run as sphereTests } from './sphere.test.mjs';
import { run as defTests } from './def.test.mjs';
import { run as sfxTests } from './sfx.test.mjs';
import { run as vrdragTests } from './vrdrag.test.mjs';
import { run as vrbarTests } from './vrbar.test.mjs';

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
console.log('\n=== sfx.test.mjs ===');
sfxTests(check);
console.log('\n=== vrdrag.test.mjs ===');
vrdragTests(check);
console.log('\n=== vrbar.test.mjs ===');
vrbarTests(check);
console.log('\n=== def.test.mjs ===');
await defTests(check);
console.log('\n' + (failures === 0 ? 'ALL PASS' : failures + ' FAILURES'));
process.exit(failures === 0 ? 0 : 1);
