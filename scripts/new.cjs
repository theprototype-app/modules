// new — scaffold modules/<id>/ from modules/_template/.
//
//   npm run new -- my-module "My Module"
//
// Copies the template, rewrites the id/name in manifest.json + module.js, and
// leaves everything else for you to fill in. Never overwrites an existing folder.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const TEMPLATE = path.join(ROOT, 'modules', '_template');

const [id, ...nameParts] = process.argv.slice(2);
if (!id) {
	console.error('usage: npm run new -- <module-id> ["Display Name"]');
	process.exit(1);
}
if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) {
	console.error('module id must be lowercase letters, digits and dashes (it routes your messages)');
	process.exit(1);
}

const dir = path.join(ROOT, 'modules', id);
if (fs.existsSync(dir)) {
	console.error('modules/' + id + ' already exists');
	process.exit(1);
}
const name = nameParts.join(' ') || id;

fs.mkdirSync(dir, { recursive: true });
for (const file of fs.readdirSync(TEMPLATE)) {
	const source = fs.readFileSync(path.join(TEMPLATE, file), 'utf8');
	const rewritten = source
		.replaceAll('my-module', id)
		.replaceAll('My Module', name)
		.replaceAll('mymodule', id.replace(/-/g, ''));
	fs.writeFileSync(path.join(dir, file), rewritten);
}

console.log('scaffolded modules/' + id + ' — next:');
console.log('  1. edit modules/' + id + '/module.js');
console.log('  2. npm run pack -- ' + id);
console.log('  3. install ' + id + '.zip via Modules ▸ User ▸ Install from zip');
console.log('  4. read AUTHORING.md before you replicate anything');
