// 30b integrate: the props-kit WallTorch as the Kit's torch (the orchestrator's review of the
// 30b shots: "the torch props are crude yellow cones"). An iron bracket, an oak shaft and a
// cloth wrap — three textured parts, 652 triangles — drawn as ONE InstancedMesh per part per
// floor, plus the model's own Flame, which keeps the Kit's emissive glow and per-torch flicker.
// Nothing here is replicated: the Kit's group is scene-root content, rebuilt from the same seed
// on every peer.
//
// 34 R7: the GLB (assets/wall-torch.glb, packaged) loads through core's `api.loadModel` — the
// app's own loader and cache — instead of being baked into module.js as base64 (188 KB of the
// bundle). A floor built before the model has landed (a few ms after install, the first floor
// only) gets its torch meshes when it does (render.js torchesArrived). On a core without
// loadModel (1.19 and older) the same packaged GLB is read by a small reader below — the
// build-time bake (build-torch.mjs) is gone, so the zip carries the model once.

/** the torch model, packaged in the zip (manifest `files`) */
export const TORCH_FILE = 'assets/wall-torch.glb';

/** metres: the kit piece is 0.69 m tall; a dungeon torch reads better a size up */
export const TORCH_SCALE = 1.25;
/** the torch's base (the bottom of its wall bracket) above the floor */
export const TORCH_BASE_Y = 1.3;
/** the Flame node, where it sits on the unscaled model (x 0, y up, z out from the wall) — the
 * GLB's own translation (a test holds the two equal), a constant so a floor can place its
 * lights and halos before the model has loaded */
export const FLAME_AT = [0, 0.4665071278216737, 0.2713281572999747];
/** the model's flame is a candle's; a torch's reads bigger (relative to TORCH_SCALE) */
export const FLAME_GROW = 1.5;
/** the solid part names, in draw order (the GLB's node names; a test holds them) */
export const SOLID_PARTS = ['WallTorch_iron', 'WallTorch_oak', 'WallTorch_cloth'];

/** built once per page: {name -> {geometry, material}}, null until the model is in @type {any} */
let cache = null;
/** @type {Promise<any> | null} */
let loading = null;

/**
 * The three solid parts + the flame geometry, or null while the model is loading. Solid parts
 * carry their maps (glTF's convention: flipY false, sRGB); the flame is returned bare — the Kit
 * gives it the theme's emissive flame material.
 * @param {any} [_THREE] unused (kept for the call sites' shape)
 */
export function torchParts(_THREE) {
	return cache;
}

/** @param {any} scene the loaded model (core's handle scene) */
function partsFromScene(scene) {
	/** @type {any} */
	const out = {};
	scene.traverse((/** @type {any} */ o) => {
		if (!o.isMesh) return;
		out[o.name] = { geometry: o.geometry, material: o.name === 'Flame' ? null : o.material };
	});
	return out.Flame && SOLID_PARTS.every((n) => out[n]) ? out : null;
}

/**
 * An OLD core's path (no api.loadModel): read the GLB's plain accessors and images straight
 * from its JSON + BIN chunks — the parts the Kit draws, nothing else (no Draco/Meshopt/KTX2:
 * the torch carries none, a test holds that).
 * @param {any} THREE @param {ArrayBuffer} buf
 */
function partsFromGlb(THREE, buf) {
	const dv = new DataView(buf);
	if (dv.getUint32(0, true) !== 0x46546c67) throw new Error(TORCH_FILE + ' is not a GLB');
	const jsonLen = dv.getUint32(12, true);
	const gltf = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 20, jsonLen)));
	const bin = 20 + jsonLen + 8;
	const SIZE = /** @type {Record<string, number>} */ ({ SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 });
	/** a tightly packed typed array of accessor `i` @param {number} i */
	const accessor = (i) => {
		const a = gltf.accessors[i];
		const v = gltf.bufferViews[a.bufferView];
		const per = SIZE[a.type];
		const T = a.componentType === 5126 ? Float32Array : a.componentType === 5125 ? Uint32Array : a.componentType === 5123 ? Uint16Array : null;
		if (!T) throw new Error('unsupported component type ' + a.componentType);
		const comp = T.BYTES_PER_ELEMENT;
		const stride = v.byteStride ?? per * comp;
		const d = new DataView(buf, bin + (v.byteOffset ?? 0) + (a.byteOffset ?? 0));
		const out = new T(a.count * per);
		for (let e = 0; e < a.count; e++)
			for (let c = 0; c < per; c++) {
				const off = e * stride + c * comp;
				out[e * per + c] = T === Float32Array ? d.getFloat32(off, true) : T === Uint32Array ? d.getUint32(off, true) : d.getUint16(off, true);
			}
		return out;
	};
	/** @type {Map<number, any>} one texture per glTF texture index */
	const textures = new Map();
	/** @param {number} i */
	const texture = (i) => {
		if (textures.has(i)) return textures.get(i);
		const img = gltf.images[gltf.textures[i].source];
		const v = gltf.bufferViews[img.bufferView];
		const url = URL.createObjectURL(new Blob([new Uint8Array(buf, bin + (v.byteOffset ?? 0), v.byteLength)], { type: img.mimeType }));
		const tex = new THREE.TextureLoader().load(url, () => URL.revokeObjectURL(url));
		tex.flipY = false;
		tex.colorSpace = THREE.SRGBColorSpace;
		textures.set(i, tex);
		return tex;
	};
	/** @type {any} */
	const out = {};
	for (const node of gltf.nodes) {
		const prim = gltf.meshes[node.mesh]?.primitives?.[0];
		if (!prim) continue;
		const geometry = new THREE.BufferGeometry();
		geometry.setAttribute('position', new THREE.BufferAttribute(accessor(prim.attributes.POSITION), 3));
		geometry.setAttribute('normal', new THREE.BufferAttribute(accessor(prim.attributes.NORMAL), 3));
		if (prim.attributes.TEXCOORD_0 != null) geometry.setAttribute('uv', new THREE.BufferAttribute(accessor(prim.attributes.TEXCOORD_0), 2));
		geometry.setIndex(new THREE.BufferAttribute(accessor(prim.indices), 1));
		geometry.computeBoundingSphere();
		let material = null;
		if (node.name !== 'Flame') {
			const pbr = gltf.materials[prim.material]?.pbrMetallicRoughness ?? {};
			material = new THREE.MeshStandardMaterial({ roughness: pbr.roughnessFactor ?? 1, metalness: pbr.metallicFactor ?? 1 });
			if (pbr.baseColorTexture) material.map = texture(pbr.baseColorTexture.index);
		}
		out[node.name] = { geometry, material };
	}
	return out.Flame && SOLID_PARTS.every((n) => out[n]) ? out : null;
}

/**
 * Load the torch once per page (idempotent; resolves to the parts, or null when no path could
 * load it — the Kit then draws its floors without torch bodies, flames and lights still on).
 * @param {any} api
 * @returns {Promise<any>}
 */
export function loadTorch(api) {
	if (cache) return Promise.resolve(cache);
	if (loading) return loading;
	const THREE = api.THREE;
	loading = (async () => {
		try {
			if (typeof api.loadModel === 'function') {
				// lod off: one InstancedMesh per part draws every torch of a floor (a LOD has no
				// single centre to measure from there); the Kit culls by distance itself
				const handle = await api.loadModel(TORCH_FILE, { lod: false });
				cache = partsFromScene(handle.scene);
			} else {
				const url = api.assetUrl?.(TORCH_FILE);
				if (!url) throw new Error(TORCH_FILE + ' is not in the installed module');
				cache = partsFromGlb(THREE, await (await fetch(url)).arrayBuffer());
			}
		} catch (error) {
			console.warn('[dungeon] the wall torch did not load — floors draw without torch bodies', error);
			cache = null;
		}
		loading = null;
		return cache;
	})();
	return loading;
}

/** TEST-ONLY: what a flight sees */
export function torchState() {
	return { ready: !!cache, loading: !!loading };
}
