// pack — build the installable .zip for a module folder.
//
//   npm run pack -- <id>      one module   -> <id>.zip at the repo root
//   npm run pack -- --all     every module under modules/ (skips _template)
//
// The manager (Modules ▸ User ▸ install from zip) reads `manifest.json` at the
// ZIP ROOT — a zip with the module folder nested inside fails with "zip has no
// manifest.json at its root". PowerShell's Compress-Archive nests exactly like
// that when handed a directory, which is why this script exists.

const { zipSync } = require('fflate');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const MODULES = path.join(ROOT, 'modules');

/** every file in `dir`, as zip-root-relative posix paths */
function collect(dir, prefix = '') {
	/** @type {Record<string, Uint8Array>} */
	const files = {};
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		const rel = prefix + entry.name;
		if (entry.isDirectory()) Object.assign(files, collect(full, rel + '/'));
		else files[rel] = new Uint8Array(fs.readFileSync(full));
	}
	return files;
}

function pack(id) {
	const dir = path.join(MODULES, id);
	if (!fs.existsSync(dir)) throw new Error('no such module: modules/' + id);

	const manifestPath = path.join(dir, 'manifest.json');
	if (!fs.existsSync(manifestPath)) throw new Error(id + ': manifest.json missing');
	const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

	// the same three fields the app's validateManifest() insists on
	for (const field of ['id', 'name', 'version'])
		if (!manifest[field]) throw new Error(id + ': manifest.json needs ' + field);
	// _template is the one folder whose name is deliberately not its id
	if (manifest.id !== id && id !== '_template')
		throw new Error(id + ': manifest id "' + manifest.id + '" must match the folder name');

	const entry = manifest.entry ?? 'module.js';
	if (!fs.existsSync(path.join(dir, entry)))
		throw new Error(id + ': entry file "' + entry + '" missing');

	// the entry must be SELF-CONTAINED: the app imports it as a blob URL, where a
	// bare specifier ("three") or a relative path has nothing to resolve against.
	const source = fs.readFileSync(path.join(dir, entry), 'utf8');
	const badImport = source.match(/^\s*import[\s{*'"]/m);
	if (badImport)
		throw new Error(
			id + ': ' + entry + ' has a top-level `import` — entry files must be self-contained ' +
				'(use api.THREE / api.assetUrl, or bundle with esbuild; see AUTHORING.md)'
		);

	// README.md is documentation for the repo, not payload for the app
	const files = collect(dir);
	delete files['README.md'];

	const out = path.join(ROOT, id + '.zip');
	fs.writeFileSync(out, Buffer.from(zipSync(files, { level: 9 })));
	const kb = (fs.statSync(out).size / 1024).toFixed(1);
	console.log(
		'packed ' + id + ' v' + manifest.version + ' -> ' + path.basename(out) +
			' (' + Object.keys(files).length + ' files, ' + kb + ' kB)'
	);
	return out;
}

const args = process.argv.slice(2);
const ids = args.includes('--all')
	? fs.readdirSync(MODULES).filter((name) => !name.startsWith('_') && !name.startsWith('.'))
	: args.filter((a) => !a.startsWith('-'));

if (ids.length === 0) {
	console.error('usage: npm run pack -- <module-id> | --all');
	process.exit(1);
}

let failed = 0;
for (const id of ids) {
	try {
		pack(id);
	} catch (error) {
		console.error('FAILED ' + error.message);
		failed++;
	}
}
process.exit(failed ? 1 : 0);
