// waves — THE MESHY MODELS (30c): the three guns, the three enemies and the crystal as GLBs
// inside the module's own zip (`assets/…`, listed in manifest `files` for a URL install).
//
// The api hands a module THREE but no GLTFLoader (DEVX #30). Three's own loader is bundled at
// build time against a shim of the RUNTIME three (build-gltf.mjs → src/gltf/loader.chunk, text
// embedded in module.js): set `globalThis.__wavesTHREE`, import the chunk from a blob, and its
// classes ARE the scene's. A core that grows `api.loadModel(url)` is used first.
//
// Everything here is LOCAL and lazy: the first ask starts the load, a frame task asks `get` and
// gets null until the model is in (the primitive look stands in meanwhile, and for good when a
// file is missing or fails to parse — the game never waits on a model).

import LOADER_SOURCE from './gltf/loader.chunk';

/** the packaged files, by key — the manifest's `files` lists every one (a test holds it) */
export const ASSET_FILES = Object.freeze({
	blaster: 'assets/gun-blaster.glb',
	scatter: 'assets/gun-scatter.glb',
	beam: 'assets/gun-beam.glb',
	grunt: 'assets/enemy-grunt.glb',
	runner: 'assets/enemy-runner.glb',
	tank: 'assets/enemy-tank.glb',
	crystal: 'assets/crystal.glb'
});

/** @param {any} api */
export function createAssets(api) {
	const THREE = api.THREE;
	/** @type {Map<string, {status: 'loading' | 'ready' | 'failed', gltf: any, error?: string}>} */
	const entries = new Map();
	/** @type {Promise<any> | null} */
	let chunk = null;
	/** the chunk's exports once imported @type {any} */
	let loaded = null;

	/** three's GLTFLoader + SkeletonUtils.clone, bound to the runtime three */
	function loaderModule() {
		if (!chunk)
			chunk = (async () => {
				/** @type {any} */ (globalThis).__wavesTHREE = THREE;
				const url = URL.createObjectURL(new Blob([LOADER_SOURCE], { type: 'text/javascript' }));
				try {
					loaded = await import(/* @vite-ignore */ url);
					return loaded;
				} finally {
					URL.revokeObjectURL(url);
				}
			})();
		return chunk;
	}

	/** @param {string} url */
	async function parse(url) {
		if (typeof api.loadModel === 'function') {
			const r = await api.loadModel(url);
			return r?.scene ? r : { scene: r, animations: r?.animations ?? [] };
		}
		const m = await loaderModule();
		return new m.GLTFLoader().loadAsync(url);
	}

	/** start loading `key` (idempotent) @param {string} key */
	function request(key) {
		if (entries.has(key)) return entries.get(key);
		const file = /** @type {any} */ (ASSET_FILES)[key];
		const url = file ? api.assetUrl?.(file) : null;
		/** @type {any} */
		const entry = { status: 'loading', gltf: null };
		entries.set(key, entry);
		if (!url) {
			entry.status = 'failed';
			entry.error = file ? file + ' is not in the installed module' : 'no asset ' + key;
			return entry;
		}
		parse(url).then(
			(gltf) => {
				gltf.scene.traverse((/** @type {any} */ o) => {
					if (!o.isMesh) return;
					o.castShadow = true;
					o.receiveShadow = true;
					// a skinned mesh's bind-pose bounds cut it off mid-stride: never cull it
					if (o.isSkinnedMesh) o.frustumCulled = false;
				});
				entry.gltf = gltf;
				entry.status = 'ready';
			},
			(error) => {
				entry.status = 'failed';
				entry.error = String(error?.message ?? error);
				console.warn('[waves] model ' + key + ' failed — the primitive look stays', error);
			}
		);
		return entry;
	}

	/** the loaded gltf of `key`, or null (asks for it) @param {string} key */
	function get(key) {
		const e = request(key);
		return e?.status === 'ready' ? e.gltf : null;
	}

	/**
	 * A fresh instance of `key`'s scene with its OWN materials (a hit flash paints one enemy,
	 * not the kind) — skinned models cloned with SkeletonUtils so each has its own bones.
	 * null until loaded. @param {string} key
	 */
	function instance(key) {
		const gltf = get(key);
		if (!gltf) return null;
		let skinned = false;
		gltf.scene.traverse((/** @type {any} */ o) => (skinned ||= !!o.isSkinnedMesh));
		// the chunk is loaded whenever this file parsed the gltf; a core loadModel gltf still
		// needs SkeletonUtils for a skinned clone, so ask for the chunk (it is in the bundle)
		if (skinned && !loaded) {
			loaderModule();
			return null;
		}
		const clone = skinned ? loaded.cloneSkinned(gltf.scene) : gltf.scene.clone(true);
		/** @type {Map<any, any>} */
		const own = new Map();
		clone.traverse((/** @type {any} */ o) => {
			if (!o.isMesh || !o.material) return;
			const one = (/** @type {any} */ m) => {
				if (!own.has(m)) own.set(m, m.clone());
				return own.get(m);
			};
			o.material = Array.isArray(o.material) ? o.material.map(one) : one(o.material);
		});
		return { scene: clone, animations: gltf.animations ?? [] };
	}
	return {
		request,
		/** start every model at once (a Waves arena is in the scene: all of them will be asked for) */
		preload: () => Object.keys(ASSET_FILES).forEach((k) => request(k)),
		get,
		instance,
		/** every key's status, for a flight / the debug line */
		status: () => Object.fromEntries(Object.keys(ASSET_FILES).map((k) => [k, entries.get(k)?.status ?? 'idle'])),
		errors: () => Object.fromEntries([...entries].filter(([, e]) => e.error).map(([k, e]) => [k, e.error]))
	};
}
