// Pure-data tests for the Dungeon Kit — run WITHOUT the app:
//   node modules/dungeon/test/run.mjs      (npm run test:dungeon)
// The generator suites moved here from dungeon-realms with the generator (21-C C6);
// contract.test.mjs covers the userData.play record both core and Realms read.
import { run as genTests } from './gen.test.mjs';
import { run as campaignTests } from './campaign.test.mjs';
import { run as contractTests } from './contract.test.mjs';
import { run as lookTests } from './look.test.mjs';

let failures = 0;
function check(ok, label) {
	console.log((ok ? 'PASS ' : 'FAIL ') + label);
	if (!ok) failures++;
}

console.log('=== gen.test.mjs ===');
genTests(check);
console.log('\n=== campaign.test.mjs ===');
campaignTests(check);
console.log('\n=== contract.test.mjs ===');
contractTests(check);
console.log('\n=== look.test.mjs ===');
lookTests(check);

console.log('\n' + (failures === 0 ? 'ALL PASS' : failures + ' FAILURES'));
process.exit(failures === 0 ? 0 : 1);
