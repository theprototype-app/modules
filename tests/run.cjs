// Sequential test-flight runner: `npm test` (all) or `npm test -- keypad door`.
// Flights share one app instance and the signaling server, so they never run in
// parallel. Point them at an app with APP_URL (default https://localhost:5188/).

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const all = fs
	.readdirSync(__dirname)
	.filter((file) => file.endsWith('.test.cjs'))
	.sort();
const args = process.argv.slice(2).filter((a) => a !== 'all');
const chosen = args.length === 0 ? all : all.filter((f) => args.some((a) => f.includes(a)));

if (chosen.length === 0) {
	console.log('No flights match. Available: ' + all.join(', '));
	process.exit(1);
}

console.log('app: ' + (process.env.APP_URL || 'https://localhost:5188/'));
const failed = [];
const started = Date.now();
for (const file of chosen) {
	console.log('\n=== ' + file + ' ===');
	const result = spawnSync('node', [path.join(__dirname, file)], {
		stdio: 'inherit',
		timeout: 8 * 60 * 1000
	});
	if (result.status !== 0) failed.push(file);
}
console.log('\n' + chosen.length + ' flights in ' + Math.round((Date.now() - started) / 1000) + 's');
console.log(failed.length ? 'FAILED: ' + failed.join(', ') : 'ALL FLIGHTS PASS');
process.exit(failed.length ? 1 : 0);
