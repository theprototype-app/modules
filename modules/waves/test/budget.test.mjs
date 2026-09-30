// 31 W2: THE QUEST BUDGET of the shipped models, pure — reads the GLBs' own JSON + image headers
// (no three, no gltf-transform). Run WITHOUT the app (npm run test:waves).
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { budgetOf, fromCoreLevel, lodFar, stepGovernor } from '../src/quality.js';

const here = dirname(fileURLToPath(import.meta.url));
// the files assets.js loads (it imports the loader chunk, which node cannot, so its list is
// mirrored here; figures.test.mjs holds the manifest to that list)
const ASSET_FILES = {
	blaster: 'assets/gun-blaster.glb',
	scatter: 'assets/gun-scatter.glb',
	beam: 'assets/gun-beam.glb',
	grunt: 'assets/enemy-grunt.glb',
	runner: 'assets/enemy-runner.glb',
	tank: 'assets/enemy-tank.glb',
	crystal: 'assets/crystal.glb'
};

/** the JSON chunk and the BIN chunk of a .glb @param {string} file */
function readGlb(file) {
	const b = readFileSync(join(here, '..', file));
	const len = b.readUInt32LE(12);
	const json = JSON.parse(b.subarray(20, 20 + len).toString('utf8'));
	const binAt = 20 + len;
	const bin = b.subarray(binAt + 8, binAt + 8 + b.readUInt32LE(binAt));
	return { json, bin, bytes: b.length };
}
/** a JPEG's / PNG's pixel size from its header @param {Uint8Array} img */
function imageSize(img) {
	const b = Buffer.from(img);
	if (b[0] === 0x89 && b[1] === 0x50) return [b.readUInt32BE(16), b.readUInt32BE(20)];
	let i = 2;
	while (i < b.length) {
		if (b[i] !== 0xff) return null;
		const marker = b[i + 1];
		const size = b.readUInt16BE(i + 2);
		if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return [b.readUInt16BE(i + 7), b.readUInt16BE(i + 5)];
		i += 2 + size;
	}
	return null;
}
/** @param {any} json @param {number} meshIndex */
const trisOf = (json, meshIndex) => json.meshes[meshIndex].primitives.reduce((n, p) => n + (p.indices !== undefined ? json.accessors[p.indices].count : json.accessors[p.attributes.POSITION].count) / 3, 0);
/** every image's size by the material slot that uses it @param {any} g */
function textures(g) {
	/** @type {{slot: string, size: number[] | null}[]} */
	const out = [];
	for (const m of g.json.materials ?? []) {
		const slots = { baseColorTexture: m.pbrMetallicRoughness?.baseColorTexture, metallicRoughnessTexture: m.pbrMetallicRoughness?.metallicRoughnessTexture, normalTexture: m.normalTexture, emissiveTexture: m.emissiveTexture, occlusionTexture: m.occlusionTexture };
		for (const [slot, info] of Object.entries(slots)) {
			if (!info) continue;
			const img = g.json.images[g.json.textures[info.index].source];
			const view = g.json.bufferViews[img.bufferView];
			out.push({ slot, size: imageSize(g.bin.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength)) });
		}
	}
	return out;
}

/** @param {(ok: boolean, label: string) => void} check */
export function run(check) {
	let total = 0;
	for (const kind of ['grunt', 'runner', 'tank']) {
		const g = readGlb(/** @type {any} */ (ASSET_FILES)[kind]);
		total += g.bytes;
		const skinned = g.json.nodes.filter((/** @type {any} */ n) => n.mesh !== undefined && n.skin !== undefined);
		const lod0 = skinned.find((/** @type {any} */ n) => !/_lod1$/.test(n.name ?? ''));
		const lod1 = skinned.find((/** @type {any} */ n) => /_lod1$/.test(n.name ?? ''));
		const t0 = lod0 ? trisOf(g.json, lod0.mesh) : Infinity;
		const t1 = lod1 ? trisOf(g.json, lod1.mesh) : Infinity;
		check(t0 <= 4200, `${kind}: LOD0 within the Quest budget (${t0} tris <= 4200; 30c shipped ~7.2k)`);
		check(!!lod1 && t1 <= 1300 && t1 < t0 / 2, `${kind}: a LOD1 mesh ships beside it (${t1} tris)`);
		check(!!lod0 && !!lod1 && lod0.skin === lod1.skin, `${kind}: LOD1 rides the SAME skin (one skeleton, one mixer)`);
		const tex = textures(g);
		check(tex.length > 0 && tex.every((t) => t.size && t.size[0] <= 512 && t.size[1] <= 512), `${kind}: every texture <= 512² (${tex.map((t) => t.slot.replace('Texture', '') + ' ' + (t.size ?? []).join('x')).join(', ')})`);
		check((g.json.animations ?? []).map((/** @type {any} */ a) => a.name).join() === 'walk,run,hit,death', `${kind}: the four clips survive (walk, run, hit, death)`);
	}
	for (const gun of ['blaster', 'scatter', 'beam']) {
		const g = readGlb(/** @type {any} */ (ASSET_FILES)[gun]);
		total += g.bytes;
		const tex = textures(g);
		const base = tex.find((t) => t.slot === 'baseColorTexture');
		check(!!base?.size && base.size[0] <= 1024 && tex.filter((t) => t !== base).every((t) => t.size && t.size[0] <= 512), `${gun}: base colour <= 1024² (at the eye), every other map <= 512²`);
	}
	const c = readGlb(ASSET_FILES.crystal);
	total += c.bytes;
	check(textures(c).every((t) => t.size && t.size[0] <= 512), 'crystal: every texture <= 512²');
	check(total < 3.8 * 1048576, `the models weigh < 3.8 MB in the zip (${(total / 1048576).toFixed(2)} MB; 30c shipped 6.6 MB)`);

	// the level's budget and its rules
	check(budgetOf(0).shadows && !budgetOf(1).shadows && !budgetOf(2).shadows, 'quality: only HIGH lets the figures cast shadows');
	check(budgetOf(2).lodFar < budgetOf(1).lodFar && budgetOf(1).lodFar < budgetOf(0).lodFar, 'quality: LOD1 comes nearer as the level drops');
	check(budgetOf(2).burst === 0 && budgetOf(2).shards < budgetOf(0).shards, 'quality: LOW throws no burst and fewer shards');
	check(fromCoreLevel(0) === 0 && fromCoreLevel(1) === 1 && fromCoreLevel(2) === 1 && fromCoreLevel(3) === 2 && fromCoreLevel(9) === 2 && fromCoreLevel('x') === 0, "quality: core's level 0 / 1-2 / 3+ -> high / medium / low (a headset starts at core 1: medium)");
	check(lodFar(7, false, 6) && lodFar(5.5, false, 6) === false && lodFar(5.5, true, 6) === true && lodFar(4.9, true, 6) === false, 'lod: LOD1 past the distance; back to LOD0 only 1 m inside it (no flicker at the line)');
	// the governor: 2.5 s of 25 ms frames at a 13.9 ms budget -> one step down; 9 s of 10 ms -> one up
	const slow = Array(100).fill(25);
	const s1 = stepGovernor({ level: 0, since: 0 }, slow, 1000 / 72, 10);
	check(s1.level === 1 && s1.since === 10, 'governor: frames too slow for 2 s -> one level down');
	check(stepGovernor(s1, slow, 1000 / 72, 11).level === 1, '  not again within 2 s of the last step');
	check(stepGovernor({ level: 2, since: 0 }, Array(900).fill(10), 1000 / 72, 20).level === 1, '  fast for 8 s -> one level up');
	check(stepGovernor({ level: 0, since: 0 }, Array(30).fill(40), 1000 / 72, 10).level === 0, '  too few frames to judge (1.2 s): no step');
	check(stepGovernor({ level: 1, since: 0 }, Array(700).fill(15.5), 1000 / 72, 20).level === 1, '  a frame time inside the band: stays');
}
