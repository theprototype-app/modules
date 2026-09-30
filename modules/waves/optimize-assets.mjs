// waves — THE QUEST BUDGET for the Meshy models (31 W2). 0 credits: the 30c GLBs, optimised.
//
//   node modules/waves/optimize-assets.mjs [--from-git 09c9ffe] [--tools <packs>/tools/meshy]
//
// Reads the ORIGINAL 30c files out of git (never the already-optimised ones in assets/, so a
// re-run is idempotent) and writes assets/:
//   enemies  LOD0 simplified to ENEMY_TRIS; a second skinned mesh `<name>_lod1` (LOD1_TRIS) on
//            the SAME skin, so one skeleton and one mixer drive both and avatars.js shows one or
//            the other by distance; every texture 512² (a 1.2 m robot seen from metres away)
//   guns     geometry as is (2.7k, in the hand); the base colour stays 1024² (it is at the eye),
//            the normal / metal-rough / emissive maps go to 512²
//   crystal  every texture 512²
// Tools: gltf-transform + meshoptimizer + sharp from the packs repo's tools/meshy (the pipeline
// every Meshy asset already goes through — `npm ci` there once). Nothing here spends credits.
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { statSync, writeFileSync } from 'node:fs';

const here = dirname(fileURLToPath(import.meta.url));
const arg = (name, fallback) => {
	const i = process.argv.indexOf(name);
	return i > 0 ? process.argv[i + 1] : fallback;
};
const REV = arg('--from-git', '09c9ffe');
const TOOLS = arg('--tools', process.env.MESHY_TOOLS || '/home/deck/.code/theprototype-app/packs-lane-30c-tools/tools/meshy');
const req = createRequire(join(TOOLS, 'package.json'));
const load = async (id) => import(pathToFileURL(req.resolve(id)).href);
const { NodeIO } = await load('@gltf-transform/core');
const { ALL_EXTENSIONS } = await load('@gltf-transform/extensions');
const { compactPrimitive, weld, textureCompress, prune, dedup } = await load('@gltf-transform/functions');
const { MeshoptSimplifier } = await load('meshoptimizer');
const sharp = (await load('sharp')).default;
await MeshoptSimplifier.ready;

export const ENEMY_TRIS = 4000;
export const LOD1_TRIS = 1200;

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const trisOf = (prim) => (prim.getIndices() ? prim.getIndices().getCount() : prim.getAttribute('POSITION').getCount()) / 3;

/** simplify one primitive to about `target` triangles. Meshy's texture atlas cuts the mesh into
 * many UV islands, and meshoptimizer keeps every seam by default (the robots stalled at ~5k), so
 * the seams may collapse (`Permissive`) — bounded by the error, which grows until the target is
 * met; the unused vertices are compacted away */
function simplifyTo(prim, target) {
	const pos = prim.getAttribute('POSITION');
	const positions = new Float32Array(pos.getArray());
	for (const error of [0.002, 0.005, 0.01, 0.02, 0.04, 0.08]) {
		const now = trisOf(prim);
		if (now <= target * 1.05) break;
		const indices = new Uint32Array(prim.getIndices().getArray());
		const [out] = MeshoptSimplifier.simplify(indices, positions, 3, target * 3, error, ['Permissive']);
		prim.getIndices().setArray(new Uint32Array(out));
	}
	compactPrimitive(prim);
	return trisOf(prim);
}

/** @param {string} file @param {'enemy' | 'gun' | 'crystal'} kind */
async function optimise(file, kind) {
	const bytes = execFileSync('git', ['show', `${REV}:modules/waves/assets/${file}`], { cwd: here, maxBuffer: 64 << 20 });
	const doc = await io.readBinary(new Uint8Array(bytes));
	const root = doc.getRoot();
	const report = { file, trisIn: 0, trisOut: 0, lod1: 0 };
	for (const m of root.listMeshes()) for (const p of m.listPrimitives()) report.trisIn += trisOf(p);
	if (kind === 'enemy') {
		await doc.transform(dedup(), weld());
		const node = root.listNodes().find((n) => n.getMesh() && n.getSkin());
		if (!node) throw new Error(file + ': no skinned mesh');
		const mesh = node.getMesh();
		// LOD1 first, from the full mesh (a simplification of a simplification loses more)
		const lodMesh = doc.createMesh(mesh.getName() + '_lod1');
		for (const p of mesh.listPrimitives()) {
			// a primitive's clone SHARES its accessors: give the LOD its own before simplifying
			const c = p.clone();
			c.setIndices(p.getIndices().clone());
			for (const sem of p.listSemantics()) c.setAttribute(sem, p.getAttribute(sem).clone());
			report.lod1 += simplifyTo(c, LOD1_TRIS);
			lodMesh.addPrimitive(c);
		}
		for (const p of mesh.listPrimitives()) report.trisOut += simplifyTo(p, ENEMY_TRIS);
		const lodNode = doc
			.createNode((node.getName() || 'body') + '_lod1')
			.setMesh(lodMesh)
			.setSkin(node.getSkin())
			.setTranslation(node.getTranslation())
			.setRotation(node.getRotation())
			.setScale(node.getScale());
		const parent = node.getParentNode();
		if (parent) parent.addChild(lodNode);
		else for (const s of root.listScenes()) if (s.listChildren().includes(node)) s.addChild(lodNode);
	} else for (const m of root.listMeshes()) for (const p of m.listPrimitives()) report.trisOut += trisOf(p);

	const small = kind === 'gun' ? /^(normalTexture|metallicRoughnessTexture|emissiveTexture|occlusionTexture)$/ : null;
	await doc.transform(textureCompress({ encoder: sharp, targetFormat: 'jpeg', resize: [512, 512], quality: 85, ...(small ? { slots: small } : {}) }), prune(), dedup());
	const asset = root.getAsset();
	asset.extras = { ...(asset.extras ?? {}), wavesOpt: { from: REV, enemyTris: kind === 'enemy' ? ENEMY_TRIS : null, lod1Tris: kind === 'enemy' ? LOD1_TRIS : null, textures: kind === 'gun' ? 'base 1024, rest 512' : '512' } };
	const out = join(here, 'assets', file);
	writeFileSync(out, await io.writeBinary(doc));
	return { ...report, bytesIn: bytes.length, bytesOut: statSync(out).size };
}

const JOBS = [
	['enemy-grunt.glb', 'enemy'],
	['enemy-runner.glb', 'enemy'],
	['enemy-tank.glb', 'enemy'],
	['gun-blaster.glb', 'gun'],
	['gun-scatter.glb', 'gun'],
	['gun-beam.glb', 'gun'],
	['crystal.glb', 'crystal']
];
for (const [file, kind] of JOBS) {
	const r = await optimise(file, /** @type {any} */ (kind));
	console.log(`${file}: tris ${r.trisIn} -> ${r.trisOut}${r.lod1 ? ' (+ lod1 ' + r.lod1 + ')' : ''}, ${(r.bytesIn / 1024) | 0} kB -> ${(r.bytesOut / 1024) | 0} kB`);
}
