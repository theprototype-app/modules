// pack — build the installable .zip for a module folder.
//
//   npm run pack -- <id>      one module   -> <id>.zip at the repo root
//   npm run pack -- --all     every module under modules/ (skips _template)
//   npm run pack -- <id> --force   pack even if src/ looks newer than the bundle
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
	const entryPath = path.join(dir, entry);
	if (!fs.existsSync(entryPath))
		throw new Error(id + ': entry file "' + entry + '" missing');

	// C5.1: a BUNDLED module (esbuild src/ -> a committed module.js) ships whatever is
	// in that committed file. Editing src/ and packing without rebuilding produces a
	// zip of the OLD code, silently — the version number, the manifest and the zip all
	// look right. Refuse instead, and name the build script.
	//
	// mtime, not content, because there is nothing to compare a bundle against. That
	// makes this advisory in a fresh clone (checkout stamps every file at once), which
	// is why --force exists: the check is for the author who just edited src/.
	const srcDir = path.join(dir, 'src');
	if (fs.existsSync(srcDir) && !FORCE) {
		const entryTime = fs.statSync(entryPath).mtimeMs;
		let newest = 0;
		let newestFile = '';
		const walk = (d) => {
			for (const it of fs.readdirSync(d, { withFileTypes: true })) {
				const full = path.join(d, it.name);
				if (it.isDirectory()) walk(full);
				else {
					const t = fs.statSync(full).mtimeMs;
					if (t > newest) {
						newest = t;
						newestFile = path.relative(dir, full).split(path.sep).join('/');
					}
				}
			}
		};
		walk(srcDir);
		if (newest > entryTime)
			throw new Error(
				id + ': ' + newestFile + ' is newer than the committed ' + entry + ' — the bundle is ' +
					'STALE and packing it would ship the old code. Run "npm run build:' + id + '" first ' +
					'(or pass --force if you know the bundle is current).'
			);
	}

	// the entry must be SELF-CONTAINED: the app imports it as a blob URL, where a
	// bare specifier ("three") or a relative path has nothing to resolve against.
	const source = fs.readFileSync(path.join(dir, entry), 'utf8');
	const badImport = source.match(/^\s*import[\s{*'"]/m);
	if (badImport)
		throw new Error(
			id + ': ' + entry + ' has a top-level `import` — entry files must be self-contained ' +
				'(use api.THREE / api.assetUrl, or bundle with esbuild; see AUTHORING.md)'
		);

	// README.md is documentation for the repo, not payload for the app.
	// A manifest with a `files` allowlist packs ONLY those files (+ the
	// manifest) — that is already its meaning for URL installs, and it keeps
	// bundled-module sources (src/, test/) out of the zip.
	let files = collect(dir);
	delete files['README.md'];
	if (Array.isArray(manifest.files) && manifest.files.length) {
		const keep = new Set(['manifest.json', ...manifest.files]);
		files = Object.fromEntries(Object.entries(files).filter(([name]) => keep.has(name)));
		for (const name of manifest.files)
			if (!files[name]) throw new Error(id + ': manifest lists missing file "' + name + '"');
	}

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
// C5.1: --force skips the stale-bundle refusal above. A fresh clone stamps every file
// at checkout time, so the mtime comparison is only meaningful for the author who just
// edited src/ — CI and one-off packs pass --force.
const FORCE = args.includes('--force');
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
