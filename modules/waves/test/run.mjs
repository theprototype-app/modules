// Pure curve tests — run WITHOUT the app:
//   node modules/waves/test/run.mjs        (also `npm run test:waves`)
import { run as curveTests } from './curve.test.mjs';
import { run as recipeTests } from './recipe.test.mjs';
import { run as lookTests } from './look.test.mjs';
import { run as vrTests } from './vr.test.mjs';
import { run as gunTests } from './guns.test.mjs';
import { run as abilityTests } from './abilities.test.mjs';
import { run as levelTests } from './levels.test.mjs';
import { run as menuTests } from './menu.test.mjs';
import { run as figureTests } from './figures.test.mjs';

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
console.log('\n=== vr.test.mjs ===');
vrTests(check);
console.log('\n=== guns.test.mjs ===');
gunTests(check);
console.log('\n=== abilities.test.mjs ===');
abilityTests(check);
console.log('\n=== levels.test.mjs ===');
levelTests(check);
console.log('\n=== menu.test.mjs ===');
menuTests(check);
console.log('\n=== figures.test.mjs ===');
figureTests(check);
console.log('\n' + (failures === 0 ? 'ALL PASS' : failures + ' FAILURES'));
process.exit(failures === 0 ? 0 : 1);
