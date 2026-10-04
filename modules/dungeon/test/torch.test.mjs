// 34 R7: the wall torch loads through core's api.loadModel — pure checks of what the Kit
// relies on: the constants it places lights with BEFORE the model lands match the GLB, the
// model and the old-core bake both ship in the zip, and module.js no longer carries the bake.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TORCH_FILE, FLAME_AT, SOLID_PARTS } from '../src/torch.js';

const mod = join(dirname(fileURLToPath(import.meta.url)), '..');

/** @param {(ok: boolean, label: string) => void} check */
export function run(check) {
	const glb = readFileSync(join(mod, TORCH_FILE));
	const json = JSON.parse(glb.subarray(20, 20 + glb.readUInt32LE(12)).toString('utf8'));
	const nodes = json.nodes.map((/** @type {any} */ n) => n.name);
	const flame = json.nodes.find((/** @type {any} */ n) => n.name === 'Flame');
	check(!!flame && JSON.stringify(flame.translation) === JSON.stringify(FLAME_AT), 'FLAME_AT is the GLB\'s own Flame translation (lights and halos are placed before the model lands)');
	check(JSON.stringify(nodes.filter((/** @type {string} */ n) => n !== 'Flame')) === JSON.stringify(SOLID_PARTS), 'SOLID_PARTS are the GLB\'s solid nodes, in its order (' + SOLID_PARTS.join(', ') + ')');
	const exts = [...(json.extensionsRequired ?? [])];
	check(exts.length === 0, 'the torch needs no decoder (the old-core reader has none): extensionsRequired ' + JSON.stringify(exts));
	const prims = json.meshes.flatMap((/** @type {any} */ m) => m.primitives);
	const types = new Set(prims.flatMap((/** @type {any} */ p) => [p.attributes.POSITION, p.attributes.NORMAL, p.attributes.TEXCOORD_0, p.indices].filter((i) => i != null).map((/** @type {number} */ i) => json.accessors[i].componentType)));
	check(prims.length === 4 && [...types].every((t) => [5126, 5125, 5123].includes(t)) && (json.images ?? []).every((/** @type {any} */ im) => im.bufferView != null && im.mimeType), 'its accessors and images are ones the old-core reader handles (float / uint32 / uint16, embedded images)');
	const manifest = JSON.parse(readFileSync(join(mod, 'manifest.json'), 'utf8'));
	check(JSON.stringify(manifest.files) === JSON.stringify(['module.js', TORCH_FILE]), 'the manifest packages module.js and the model, once (' + manifest.files.join(', ') + ')');
	const bundle = readFileSync(join(mod, 'module.js'), 'utf8');
	check(!bundle.includes('data:image/jpeg;base64') && !bundle.includes('TORCH_PARTS'), 'module.js no longer embeds the baked torch (' + bundle.length + ' bytes)');
	const src = readFileSync(join(mod, 'src/torch.js'), 'utf8');
	check(/typeof api\.loadModel === 'function'[\s\S]*api\.loadModel\(TORCH_FILE, \{ lod: false \}\)/.test(src), 'src/torch.js loads the GLB through core\'s api.loadModel when the core has it (lod off: one InstancedMesh per part)');
}
