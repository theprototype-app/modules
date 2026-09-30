// 30b integrate: the props-kit WallTorch as the Kit's torch (the orchestrator's review of the
// 30b shots: "the torch props are crude yellow cones"). An iron bracket, an oak shaft and a
// cloth wrap — three textured parts, 652 triangles — drawn as ONE InstancedMesh per part per
// floor, plus the model's own Flame, which keeps the Kit's emissive glow and per-torch flicker.
// The geometry and maps are baked from the GLB at build time (build-torch.mjs); nothing loads
// at runtime and nothing here is replicated: the Kit's group is scene-root content, rebuilt
// from the same seed on every peer.
import { TORCH_PARTS } from './torch/torch.gen.js';

/** metres: the kit piece is 0.69 m tall; a dungeon torch reads better a size up */
export const TORCH_SCALE = 1.25;
/** the torch's base (the bottom of its wall bracket) above the floor */
export const TORCH_BASE_Y = 1.3;
/** the Flame node, where it sits on the unscaled model (x 0, y up, z out from the wall) */
export const FLAME_AT = TORCH_PARTS.find((p) => p.name === 'Flame')?.translation ?? [0, 0.4665, 0.2713];
/** the model's flame is a candle's; a torch's reads bigger (relative to TORCH_SCALE) */
export const FLAME_GROW = 1.5;

/** @param {string} b64 @param {any} T */
function decode(b64, T) {
	const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
	return new T(bytes.buffer);
}

/** built once per page: {name -> {geometry, material}} @type {any} */
let cache = null;

/**
 * The three solid parts + the flame geometry. Solid parts carry their JPEG maps (glTF's
 * convention: flipY false, sRGB); the flame is returned bare — the Kit gives it the theme's
 * emissive flame material.
 * @param {any} THREE
 */
export function torchParts(THREE) {
	if (cache) return cache;
	cache = {};
	for (const part of TORCH_PARTS) {
		const geometry = new THREE.BufferGeometry();
		geometry.setAttribute('position', new THREE.BufferAttribute(decode(part.positions, Float32Array), 3));
		geometry.setAttribute('normal', new THREE.BufferAttribute(decode(part.normals, Float32Array), 3));
		if (part.uvs) geometry.setAttribute('uv', new THREE.BufferAttribute(decode(part.uvs, Float32Array), 2));
		geometry.setIndex(new THREE.BufferAttribute(decode(part.index, Uint16Array), 1));
		geometry.computeBoundingSphere();
		let material = null;
		if (part.name !== 'Flame') {
			const m = part.material;
			material = new THREE.MeshStandardMaterial({ roughness: m.roughness, metalness: m.metalness });
			if (m.map) {
				const tex = new THREE.TextureLoader().load(m.map);
				tex.flipY = false;
				tex.colorSpace = THREE.SRGBColorSpace;
				material.map = tex;
			}
		}
		cache[part.name] = { geometry, material };
	}
	return cache;
}

/** the solid part names, in draw order */
export const SOLID_PARTS = TORCH_PARTS.filter((p) => p.name !== 'Flame').map((p) => p.name);
