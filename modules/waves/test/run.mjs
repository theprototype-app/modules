// Pure curve tests — run WITHOUT the app:
//   node modules/waves/test/run.mjs        (also `npm run test:waves`)
import { run as curveTests } from './curve.test.mjs';
import { run as recipeTests } from './recipe.test.mjs';
import { run as lookTests } from './look.test.mjs';

let failures = 0;
function check(ok, label) {
	console.log((ok ? 'PASS ' : 'FAIL ') + label);
	if (!ok) failures++;
}
console.log('=== curve.test.mjs ===');
curveTests(check);
console.log('\n=== recipe.test.mjs ===');
recipeTests(check);
console.log('\n=== look.test.mjs ===');
lookTests(check);
console.log('\n' + (failures === 0 ? 'ALL PASS' : failures + ' FAILURES'));
process.exit(failures === 0 ? 0 : 1);
