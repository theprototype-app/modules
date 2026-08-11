// Pure-data generator tests — run WITHOUT the app:
//   node modules/dungeon-realms/test/run.mjs
// (also wired as `npm run test:dungeon-realms` at the repo root)
import { run as genTests } from './gen.test.mjs';
import { run as campaignTests } from './campaign.test.mjs';

let failures = 0;
function check(ok, label) {
	console.log((ok ? 'PASS ' : 'FAIL ') + label);
	if (!ok) failures++;
}

console.log('=== gen.test.mjs ===');
genTests(check);
console.log('\n=== campaign.test.mjs ===');
campaignTests(check);

console.log('\n' + (failures === 0 ? 'ALL PASS' : failures + ' FAILURES'));
process.exit(failures === 0 ? 0 : 1);
