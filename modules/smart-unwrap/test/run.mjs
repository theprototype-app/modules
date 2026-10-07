// Pure-node tests for smart-unwrap — run WITHOUT the app:
//   node modules/smart-unwrap/test/run.mjs      (npm run test:smart-unwrap)
//
// Loads the REAL module.js and the REAL packaged assets/xatlas.wasm through a fake api
// whose assetUrl hands out blob URLs — exactly what the app's userModules does with a
// zip's files — then drives the registered backend the way uvEditor.unwrapObject does:
// unindexed triangles in object space, `{corners: [Vector3 x3], tri}` per face.
//
// It asserts PROPERTIES, not floats (xatlas's packer is allowed to change its mind):
// every uv in 0..1, three corners per face, no degenerate uv triangle, islands partition
// the faces, and no two islands overlap in uv space (rasterised on a grid). The overlap,
// area and range checks are each shown to FAIL on a deliberately broken result, so a
// green run means they can see what they claim to.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as THREE from 'three';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MODULE_DIR = path.join(HERE, '..');

let failures = 0;
let passes = 0;
/** @param {boolean} ok @param {string} label */
function check(ok, label) {
	console.log((ok ? 'PASS ' : 'FAIL ') + label);
	if (ok) passes++;
	else failures++;
}

// ---- the fake api ----------------------------------------------------------
const manifest = JSON.parse(fs.readFileSync(path.join(MODULE_DIR, 'manifest.json'), 'utf8'));
/** @type {Record<string, string>} */
const assets = {};
for (const file of manifest.files) {
	if (file === manifest.entry) continue;
	assets[file] = URL.createObjectURL(new Blob([fs.readFileSync(path.join(MODULE_DIR, file))]));
}
let assetReads = 0;
/** @type {{key: string, label: string, run: Function}[]} */
const backends = [];
/** @type {Function[]} */
const unloads = [];
/** @type {string[]} */
const toasts = [];
const api = {
	THREE,
	/** @param {string} p */
	assetUrl: (p) => {
		if (p.endsWith('.wasm')) assetReads++;
		return assets[p] ?? null;
	},
	/** @param {string} key @param {string} label @param {Function} run */
	registerUnwrapBackend: (key, label, run) => {
		backends.push({ key, label, run });
		return Promise.resolve();
	},
	/** @param {Function} fn */
	onUnload: (fn) => unloads.push(fn),
	/** @param {string} text */
	toast: (text) => toasts.push(text)
};

const mod = (await import(pathToFileURL(path.join(MODULE_DIR, 'module.js')).href)).default;
check(mod.id === manifest.id && mod.version === manifest.version, `module.js id/version match the manifest (${mod.id} ${mod.version})`);
await mod.register(api);
check(backends.length === 1 && backends[0].key === 'xatlas', 'register() adds ONE unwrap backend under key "xatlas"');
check(backends[0].label === 'Smart (xatlas)', 'labelled "Smart (xatlas)" for the Unwrap menu');
check(unloads.length === 1, 'it registers an onUnload hook (drops the cached runtime)');
const run = backends[0].run;

// ---- meshes -> the faces uvEditor.unwrapObject passes ------------------------
/** @param {any} geometry */
function facesOf(geometry) {
	const g = geometry.index ? geometry.toNonIndexed() : geometry;
	const pos = g.attributes.position;
	const faces = [];
	for (let i = 0; i < pos.count; i += 3)
		faces.push({
			corners: [0, 1, 2].map((c) => new THREE.Vector3().fromBufferAttribute(pos, i + c)),
			tri: i / 3
		});
	return faces;
}

// ---- the property checks (each returns {ok, detail}) ------------------------
/** @param {number[][]} t */
const areaOf = (t) => ((t[1][0] - t[0][0]) * (t[2][1] - t[0][1]) - (t[2][0] - t[0][0]) * (t[1][1] - t[0][1])) / 2;

/** @param {any} result @param {number} n */
function checkShape(result, n) {
	const corners = result?.uvs?.reduce((sum, /** @type {any} */ f) => sum + f.length, 0) ?? 0;
	return { ok: result?.uvs?.length === n && corners === n * 3, detail: `${corners} corners for ${n} tris` };
}
/** @param {any} result */
function checkRange(result) {
	let bad = 0;
	for (const face of result.uvs)
		for (const [u, v] of face) if (!(u >= 0 && u <= 1 && v >= 0 && v <= 1)) bad++;
	return { ok: bad === 0, detail: `${bad} uvs outside 0..1` };
}
/** @param {any} result */
function checkArea(result) {
	let degenerate = 0;
	let total = 0;
	for (const face of result.uvs) {
		const a = Math.abs(areaOf(face));
		total += a;
		if (!(a > 1e-12)) degenerate++;
	}
	return { ok: degenerate === 0 && total <= 1 + 1e-9, detail: `${degenerate} zero-area uv tris, total uv area ${total.toFixed(3)}` };
}
/** every face in exactly one island @param {any} result @param {number} n */
function checkPartition(result, n) {
	const seen = new Uint8Array(n);
	let dup = 0;
	let outOfRange = 0;
	for (const island of result.islands)
		for (const fi of island) {
			if (!(fi >= 0 && fi < n)) outOfRange++;
			else if (seen[fi]++) dup++;
		}
	const missing = seen.reduce((m, s) => m + (s ? 0 : 1), 0);
	return { ok: !dup && !outOfRange && !missing, detail: `${result.islands.length} islands, ${missing} faces missing, ${dup} doubled` };
}
/**
 * Rasterise every uv triangle onto a GRID x GRID raster (sample = cell centre, strictly
 * inside the triangle) and record which island owns each cell. A cell claimed by two
 * different islands is an overlap — texture painted there would land on both.
 * @param {any} result @param {number} [grid]
 */
function checkNoOverlap(result, grid = 512) {
	const owner = new Int32Array(grid * grid).fill(-1);
	let overlaps = 0;
	const islandOf = new Int32Array(result.uvs.length).fill(-1);
	result.islands.forEach((/** @type {number[]} */ island, /** @type {number} */ i) => {
		for (const fi of island) islandOf[fi] = i;
	});
	result.uvs.forEach((/** @type {number[][]} */ t, /** @type {number} */ fi) => {
		const area2 = areaOf(t) * 2;
		if (Math.abs(area2) < 1e-15) return;
		const uMin = Math.max(0, Math.floor(Math.min(t[0][0], t[1][0], t[2][0]) * grid));
		const uMax = Math.min(grid - 1, Math.ceil(Math.max(t[0][0], t[1][0], t[2][0]) * grid));
		const vMin = Math.max(0, Math.floor(Math.min(t[0][1], t[1][1], t[2][1]) * grid));
		const vMax = Math.min(grid - 1, Math.ceil(Math.max(t[0][1], t[1][1], t[2][1]) * grid));
		for (let y = vMin; y <= vMax; y++)
			for (let x = uMin; x <= uMax; x++) {
				const pu = (x + 0.5) / grid;
				const pv = (y + 0.5) / grid;
				// barycentric, same sign as the triangle's winding = strictly inside
				const w0 = ((t[1][0] - pu) * (t[2][1] - pv) - (t[2][0] - pu) * (t[1][1] - pv)) / area2;
				const w1 = ((t[2][0] - pu) * (t[0][1] - pv) - (t[0][0] - pu) * (t[2][1] - pv)) / area2;
				const w2 = 1 - w0 - w1;
				if (w0 <= 1e-9 || w1 <= 1e-9 || w2 <= 1e-9) continue;
				const cell = y * grid + x;
				const island = islandOf[fi];
				if (owner[cell] === -1) owner[cell] = island;
				else if (owner[cell] !== island) overlaps++;
			}
	});
	return { ok: overlaps === 0, detail: `${overlaps} cells claimed by two islands (${grid}x${grid})` };
}
/** positive uv winding = charts read unmirrored with three's v-up uvs @param {any} result */
function windingCounts(result) {
	let ccw = 0;
	let cw = 0;
	for (const face of result.uvs) (areaOf(face) > 0 ? ccw++ : cw++);
	return { ccw, cw };
}

/** @param {string} name @param {any} geometry @param {any} [options] */
async function suite(name, geometry, options = { margin: 0.02 }) {
	console.log(`\n=== ${name} ===`);
	const faces = facesOf(geometry);
	const started = performance.now();
	const result = await run(faces, options);
	const ms = performance.now() - started;
	check(!!result && Array.isArray(result.uvs) && Array.isArray(result.islands), `${name}: returns {uvs, islands} (${faces.length} tris, ${ms.toFixed(0)} ms)`);
	if (!result) return null;
	for (const [label, outcome] of [
		['corner count = 3 x tris', checkShape(result, faces.length)],
		['every uv in [0,1]', checkRange(result)],
		['every uv triangle has area > 0, total <= 1', checkArea(result)],
		['islands partition the faces', checkPartition(result, faces.length)],
		['no two islands overlap in uv space', checkNoOverlap(result)]
	])
		check(/** @type {any} */ (outcome).ok, `${name}: ${label} — ${/** @type {any} */ (outcome).detail}`);
	const w = windingCounts(result);
	check(w.cw === 0, `${name}: every uv triangle winds counter-clockwise (unmirrored) — ${w.ccw} ccw / ${w.cw} cw`);
	return { faces, result };
}

// ---- (a) unit cube, (b) uv sphere, (c) cylinder ------------------------------
const cube = await suite('unit cube', new THREE.BoxGeometry(1, 1, 1));
if (cube) {
	check(cube.faces.length === 12, 'the cube is 12 triangles (premise)');
	check(cube.result.islands.length <= 6, `cube: at most 6 islands (${cube.result.islands.length})`);
	check(assetReads === 1, `the wasm was read once, on the first unwrap (${assetReads})`);
}
const sphere = await suite('uv sphere', new THREE.SphereGeometry(1, 12, 10));
if (sphere) check(sphere.faces.length >= 180 && sphere.faces.length <= 240, `the sphere is ~200 triangles (${sphere.faces.length})`);
const cylinder = await suite('cylinder', new THREE.CylinderGeometry(0.5, 0.5, 2, 24, 4));
check(assetReads === 1, `...and cached: three meshes, still one wasm read (${assetReads})`);

// a SCOPED unwrap (Edit Mesh face pick) hands over a subset — the top half of the sphere
await suite('sphere, upper half only (scoped unwrap)', (() => {
	const g = new THREE.SphereGeometry(1, 12, 10).toNonIndexed();
	const pos = g.attributes.position;
	const keep = [];
	for (let i = 0; i < pos.count; i += 3) if (pos.getY(i) + pos.getY(i + 1) + pos.getY(i + 2) > 0) for (let c = 0; c < 3; c++) keep.push(pos.getX(i + c), pos.getY(i + c), pos.getZ(i + c));
	const half = new THREE.BufferGeometry();
	half.setAttribute('position', new THREE.Float32BufferAttribute(keep, 3));
	return half;
})());

// a heavier mesh: the main-thread cost the README quotes
await suite('dense sphere', new THREE.SphereGeometry(1, 96, 64), {});

// ---- the weld matters: without it every triangle is its own chart -------------
if (cube) {
	const loose = cube.faces.map((/** @type {any} */ f) => ({ ...f, corners: f.corners.map((/** @type {any} */ p) => p.clone().addScalar((f.tri + 1) * 1e-3)) }));
	const r = await run(loose, { margin: 0.02 });
	check(!!r && r.islands.length > 6, `counterfactual: unwelded triangles fall apart into ${r?.islands.length} islands, so the weld is what gives the cube <= 6`);
}

// ---- COUNTERFACTUALS: the checks catch broken results --------------------------
console.log('\n=== counterfactuals (each check must FAIL on a broken result) ===');
if (sphere) {
	const clone = (/** @type {any} */ r) => ({ uvs: r.uvs.map((/** @type {number[][]} */ f) => f.map((c) => [...c])), islands: r.islands.map((/** @type {number[]} */ i) => [...i]) });
	// stacked: every island moved to the same corner — the classic "unwrap" that overlaps
	const stacked = clone(sphere.result);
	for (const island of stacked.islands) {
		let uMin = Infinity;
		let vMin = Infinity;
		for (const fi of island) for (const [u, v] of stacked.uvs[fi]) { uMin = Math.min(uMin, u); vMin = Math.min(vMin, v); }
		for (const fi of island) stacked.uvs[fi] = stacked.uvs[fi].map(([u, v]) => [u - uMin, v - vMin]);
	}
	const overlapStacked = checkNoOverlap(stacked);
	check(!overlapStacked.ok, `overlap check FAILS on islands stacked at the origin — ${overlapStacked.detail}`);
	// duplicated island: island 1 is a copy of island 0's placement
	const dup = clone(sphere.result);
	const [first, second] = [dup.islands[0], dup.islands[1]];
	for (let k = 0; k < second.length; k++) dup.uvs[second[k]] = dup.uvs[first[k % first.length]].map((c) => [...c]);
	const overlapDup = checkNoOverlap(dup);
	check(!overlapDup.ok, `overlap check FAILS when one island duplicates another's uvs — ${overlapDup.detail}`);
	// collapsed: every corner at one point
	const collapsed = { uvs: sphere.result.uvs.map(() => [[0.5, 0.5], [0.5, 0.5], [0.5, 0.5]]), islands: sphere.result.islands };
	const areaCollapsed = checkArea(collapsed);
	check(!areaCollapsed.ok, `area check FAILS on all uvs collapsed to one point — ${areaCollapsed.detail}`);
	// out of range: shifted past the edge
	const shifted = clone(sphere.result);
	for (const f of shifted.uvs) for (const c of f) c[0] += 0.5;
	const rangeShifted = checkRange(shifted);
	check(!rangeShifted.ok, `range check FAILS on uvs shifted by +0.5 — ${rangeShifted.detail}`);
	// mirrored charts: xatlas's own rotateCharts transposes charts — the reason it is off
	const mirrored = await run(sphere.faces, { margin: 0.02, packOptions: { rotateCharts: true } });
	const mw = windingCounts(mirrored);
	check(mw.cw > 0 && checkNoOverlap(mirrored).ok, `winding check FAILS with xatlas's rotateCharts on (${mw.cw} clockwise = mirrored triangles, though still overlap-free)`);
	// and the island partition notices a lost face
	const lost = clone(sphere.result);
	lost.islands[0] = lost.islands[0].slice(1);
	check(!checkPartition(lost, sphere.faces.length).ok, 'partition check FAILS when an island drops a face');
}

// ---- lifecycle: unload drops the runtime, the next run re-instantiates ----------
unloads.forEach((fn) => fn());
const again = await run(facesOf(new THREE.BoxGeometry(2, 1, 0.5)), { margin: 0.02 });
check(!!again && checkNoOverlap(again).ok, 'after onUnload the backend still runs (fresh runtime)');
check(assetReads === 2, `...and it re-read the wasm instead of keeping the old instance (${assetReads})`);

// ---- failure path: a missing wasm toasts and returns null (core commits nothing) -----
const realUrl = assets['assets/xatlas.wasm'];
unloads.forEach((fn) => fn());
delete assets['assets/xatlas.wasm'];
const failed = await run(facesOf(new THREE.BoxGeometry()), {});
check(failed === null && toasts.some((t) => t.includes('Smart unwrap failed')), `a missing wasm returns null and toasts (${toasts.at(-1)})`);
assets['assets/xatlas.wasm'] = realUrl;
const recovered = await run(facesOf(new THREE.BoxGeometry()), {});
check(!!recovered && checkPartition(recovered, 12).ok, '...and the next run recovers once the asset is back');

console.log(`\n${passes} passed, ${failures} failed`);
console.log(failures === 0 ? 'ALL PASS' : failures + ' FAILURES');
process.exit(failures === 0 ? 0 : 1);
