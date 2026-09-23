// waves — THE FIGURES (30c): a Meshy enemy walks where each enemy object walks, and a Meshy
// crystal glows where the Goal core glows. LOCAL: every peer derives its figures from the poses
// it already has (the engine places the enemies every frame on every peer), so nothing is sent.
//
// The enemy OBJECT is untouched — its name, its capsule body, the hit volume a shot meets, the
// health it carries. While its figure shows, the object's own meshes hop off layer 0 (see
// figures.js STAND_IN_LAYER — a layer, never `visible`/materials, so nothing about it can be
// saved or sent). The figures live under the module's scene-root group, never in objectsGroup.
// The clips: `walk`/`run` (Meshy's rig), `hit` and `death` (the animation library) when the
// file has them — a figure without a clip still slides upright, never breaks.

import { CORE } from './look.js';
import {
	STAND_IN_LAYER,
	HELPER_LAYER,
	figureOf,
	footDrop,
	fitScale,
	yawTo,
	turnToward,
	gait,
	walkRate,
	figureShown,
	sinkDepth,
	deathOver
} from './figures.js';
import { inGame } from './vr.js';

/**
 * @param {any} api
 * @param {ReturnType<import('./engine.js').createWavesEngine>} engine
 * @param {any} root the module's scene-root group
 * @param {ReturnType<import('./assets.js').createAssets>} assets
 */
export function registerAvatars(api, engine, root, assets) {
	const THREE = api.THREE;
	const group = new THREE.Group();
	group.name = 'Waves figures';
	root.add(group);
	const clock = () => performance.now() / 1000;

	/** @typedef {{uuid: string, kind: string, model: any, mixer: any, actions: Record<string, any>, scale: number,
	 *   yaw: number, last: number[] | null, gait: {speed: number, forward: boolean}, dyingAt: number | null, deathPos: number[] | null,
	 *   hitUntil: number, object: any}} Figure */
	/** @type {Map<string, Figure>} enemy uuid -> its figure */
	const figures = new Map();
	/** objects whose meshes hopped, and the layer they sit on @type {Map<any, number>} */
	const hopped = new Map();
	/** @type {{model: any, scale: number, source: any, mats: any[]} | null} */
	let crystal = null;
	let enabled = true;
	const stats = { made: 0, hits: 0, deaths: 0, walking: 0 };

	const _m = new THREE.Matrix4();
	const _p = new THREE.Vector3();
	const _q = new THREE.Quaternion();
	const _s = new THREE.Vector3();
	const _up = new THREE.Vector3(0, 1, 0);

	/** the group's world matrix inverted — once per frame (the group may hang under a moving rig;
	 * updating only its ANCESTORS, never the figures' bone trees under it) */
	const _inv = new THREE.Matrix4();
	function refreshInverse() {
		group.updateWorldMatrix(true, false);
		_inv.copy(group.matrixWorld).invert();
	}

	/** set `object`'s WORLD pose, whatever the group hangs under @param {any} object @param {number[]} pos @param {number} yaw @param {number} scale */
	function placeWorld(object, pos, yaw, scale) {
		_q.setFromAxisAngle(_up, yaw);
		_m.compose(_p.set(pos[0], pos[1], pos[2]), _q, _s.set(scale, scale, scale));
		_m.premultiply(_inv);
		_m.decompose(object.position, object.quaternion, object.scale);
	}

	/**
	 * Hop an object's own meshes to `layer` (or back to 0 with null) — enable/disable, never
	 * `set`: core's outline pass marks a selected object with a layer bit of its own.
	 * @param {any} object @param {number | null} layer
	 */
	function hop(object, layer) {
		const was = hopped.get(object);
		if (was === layer || (was === undefined && layer === null)) return;
		object.traverse((/** @type {any} */ o) => {
			if (!o.isMesh || !o.layers) return;
			if (was !== undefined) o.layers.disable(was);
			if (layer === null) o.layers.enable(0);
			else {
				o.layers.disable(0);
				o.layers.enable(layer);
			}
		});
		if (layer === null) hopped.delete(object);
		else hopped.set(object, layer);
	}

	/** @param {string} uuid @param {string} kind @returns {Figure | null} */
	function make(uuid, kind) {
		const inst = assets.instance(kind);
		if (!inst) return null;
		const model = new THREE.Group();
		model.name = 'Waves figure ' + kind;
		const body = inst.scene;
		model.add(body);
		// the bind pose's height -> the capsule's height; feet on the model's origin
		body.updateMatrixWorld(true);
		const box = new THREE.Box3().setFromObject(body);
		const size = box.getSize(new THREE.Vector3());
		const scale = fitScale(size.y, figureOf(kind).height);
		body.position.set(-(box.min.x + box.max.x) / 2, -box.min.y, -(box.min.z + box.max.z) / 2);
		const mixer = new THREE.AnimationMixer(body);
		/** @type {Record<string, any>} */
		const actions = {};
		for (const clip of inst.animations) {
			const name = String(clip.name).toLowerCase();
			actions[name] = mixer.clipAction(clip);
		}
		for (const a of Object.values(actions)) a.enabled = true;
		const walk = actions[figureOf(kind).walk] ?? actions.walk ?? actions.run ?? null;
		if (walk) {
			walk.play();
			walk.timeScale = 0;
		}
		for (const k of ['hit', 'death']) {
			const a = actions[k];
			if (!a) continue;
			a.setLoop(THREE.LoopOnce, 1);
			a.clampWhenFinished = k === 'death';
		}
		model.visible = false;
		group.add(model);
		stats.made++;
		return { uuid, kind, model, mixer, actions, scale, yaw: 0, last: null, gait: { speed: 0, forward: true }, dyingAt: null, deathPos: null, hitUntil: 0, object: null };
	}

	/** the walking clip of a figure @param {Figure} f */
	const walkOf = (f) => f.actions[figureOf(f.kind).walk] ?? f.actions.walk ?? f.actions.run ?? null;

	// ---- the engine's edges: a hurt plays the flinch, a death plays where it fell ------------
	engine.onEnemy((ev) => {
		const f = figures.get(ev.uuid);
		if (!f) return;
		if (ev.kind === 'death') {
			stats.deaths++;
			f.dyingAt = clock();
			// where it FELL: the figure's own last place (the object is already on its way under)
			f.deathPos = f.last ? [...f.last] : ev.pos;
			const walk = walkOf(f);
			const death = f.actions.death;
			if (death) {
				walk?.fadeOut(0.12);
				f.actions.hit?.stop();
				death.reset().setEffectiveWeight(1).fadeIn(0.08).play();
			} else if (walk) walk.timeScale = 0;
		} else if (f.dyingAt === null) {
			stats.hits++;
			const hit = f.actions.hit;
			if (hit) {
				hit.reset().setEffectiveWeight(1).fadeIn(0.04).play();
				f.hitUntil = clock() + Math.min(0.45, hit.getClip().duration * 0.6);
			}
		}
	});

	/** the next life: a dead figure back on its feet, walking @param {Figure} f */
	function revive(f) {
		f.dyingAt = null;
		f.deathPos = null;
		f.actions.death?.stop();
		f.actions.hit?.stop();
		const walk = walkOf(f);
		if (walk) {
			walk.reset().play();
			walk.setEffectiveWeight(1);
			walk.timeScale = 0;
		}
	}

	let lastT = clock();
	function frame() {
		const t = clock();
		const dt = Math.min(0.1, Math.max(0, t - lastT));
		lastT = t;
		const game = inGame(api);
		const objects = api.objectsGroup();
		refreshInverse();
		/** @type {Map<string, any>} one pass over the scene, not a search per enemy */
		const byUuid = new Map();
		for (const c of objects?.children ?? []) byUuid.set(c.uuid, c);
		/** @type {Set<string>} */
		const seen = new Set();
		let walking = 0;
		for (const s of engine.all()) {
			for (const e of s.enemies) {
				const object = byUuid.get(e.uuid) ?? objects?.getObjectByProperty('uuid', e.uuid);
				if (!object) continue;
				let f = figures.get(e.uuid);
				if (!f || f.kind !== e.kind) {
					if (f) group.remove(f.model);
					f = enabled ? make(e.uuid, e.kind) : null;
					if (!f) {
						hop(object, null);
						continue;
					}
					figures.set(e.uuid, f);
				}
				seen.add(e.uuid);
				f.object = object;
				const wp = object.getWorldPosition(new THREE.Vector3()).toArray();
				const drop = footDrop(f.kind);
				const feet = [wp[0], wp[1] - drop, wp[2]];
				// a dead figure whose enemy stands up again (the next wave uses it): revive
				if (f.dyingAt !== null && deathOver(t - f.dyingAt)) revive(f);
				const dying = f.dyingAt !== null;
				const show = enabled && figureShown({ visible: !!object.visible, y: wp[1], dying });
				hop(object, show ? (game ? STAND_IN_LAYER : HELPER_LAYER) : null);
				f.model.visible = show;
				if (!show) {
					f.last = null;
					f.gait.speed = 0;
					continue;
				}
				if (dying && f.deathPos) {
					const age = t - /** @type {number} */ (f.dyingAt);
					const d = f.deathPos;
					placeWorld(f.model, [d[0], d[1] - sinkDepth(age), d[2]], f.yaw, f.scale);
					f.mixer.update(dt);
					continue;
				}
				// face the goal (the lane is straight: the way it walks); in the editor, where
				// nothing walks, face the goal too — the card shows them coming
				const goal = s.goal;
				const target = goal ? yawTo(feet, goal) : f.yaw;
				f.yaw = f.last ? turnToward(f.yaw, target, dt, 7) : target;
				f.gait = f.last ? gait(f.gait, f.last, feet, dt, f.yaw) : { speed: 0, forward: true };
				f.last = feet;
				placeWorld(f.model, feet, f.yaw, f.scale);
				const walk = walkOf(f);
				if (walk) {
					const rate = f.gait.forward ? walkRate(f.gait.speed, figureOf(f.kind).clipSpeed, 1) : 0;
					walk.timeScale = rate;
					if (rate > 0) walking++;
				}
				if (f.actions.hit && f.hitUntil && t > f.hitUntil) {
					f.actions.hit.fadeOut(0.15);
					f.hitUntil = 0;
				}
				f.mixer.update(dt);
			}
		}
		stats.walking = walking;
		// enemies that left the scene: their figures go, and nothing stays hopped
		for (const [uuid, f] of figures)
			if (!seen.has(uuid)) {
				group.remove(f.model);
				if (f.object) hop(f.object, null);
				figures.delete(uuid);
			}
		crystalFrame(game);
	}

	// ---- the crystal: the Meshy crystal where the Goal core spins, glowing as it glows -------
	/** @param {boolean} game */
	function crystalFrame(game) {
		// the core found once (a search of the arena per frame is waste); again after a clear
		const core = crystal?.source?.parent ? crystal.source : api.objectsGroup()?.getObjectByName?.(CORE);
		if (!core || !enabled) {
			if (crystal) crystal.model.visible = false;
			if (crystal?.source) hop(crystal.source, null);
			return;
		}
		if (!crystal || crystal.source !== core) {
			const inst = assets.instance('crystal');
			if (!inst) return;
			const model = new THREE.Group();
			model.name = 'Waves crystal';
			const body = inst.scene;
			model.add(body);
			body.updateMatrixWorld(true);
			const box = new THREE.Box3().setFromObject(body);
			const size = box.getSize(new THREE.Vector3());
			const c = box.getCenter(new THREE.Vector3());
			body.position.set(-c.x, -c.y, -c.z);
			/** @type {any[]} */
			const mats = [];
			body.traverse((/** @type {any} */ o) => {
				if (!o.isMesh) return;
				o.castShadow = false;
				const m = o.material;
				if (m && !Array.isArray(m) && m.emissive) {
					// it glows with its own colours: Meshy's emission map when it painted one, else
					// the base colour map doubles as the glow
					if (!m.emissiveMap && m.map) m.emissiveMap = m.map;
					m.emissive.setHex(m.emissiveMap ? 0xffffff : 0x39e0ff);
					m.userData.wvGlow = 1;
					mats.push(m);
				}
			});
			if (crystal) group.remove(crystal.model);
			// the core is an icosahedron of radius r: the crystal stands a little taller than it
			const r = core.geometry?.parameters?.radius ?? 0.42;
			crystal = { model, scale: fitScale(size.y, r * 2.6), source: core, mats };
			group.add(model);
		}
		hop(core, game ? STAND_IN_LAYER : HELPER_LAYER);
		core.updateMatrixWorld?.(true);
		core.matrixWorld.decompose(_p, _q, _s);
		const k = crystal.scale;
		_m.compose(_p, _q, _s.set(k, k, k));
		_m.premultiply(_inv);
		_m.decompose(crystal.model.position, crystal.model.quaternion, crystal.model.scale);
		crystal.model.visible = !!core.visible;
		// the Goal Core node dims the core's emissive with the player's health: follow it
		const cm = core.material;
		const full = cm?.userData?.wvCore ?? cm?.emissiveIntensity ?? 1;
		const level = full > 0 ? (cm?.emissiveIntensity ?? full) / full : 1;
		for (const m of crystal.mats) m.emissiveIntensity = 0.25 + 1.6 * level;
	}

	api.registerFrameTask(() => {
		try {
			frame();
		} catch (error) {
			console.warn('[waves] figures failed', error);
		}
	});
	api.onSceneClear(() => {
		for (const f of figures.values()) group.remove(f.model);
		figures.clear();
		hopped.clear();
		if (crystal) group.remove(crystal.model);
		crystal = null;
	});

	return {
		figures,
		stats,
		/** the figure standing in for enemy `uuid` (the hit flash paints it too) @param {string} uuid */
		of: (uuid) => figures.get(uuid)?.model ?? null,
		crystal: () => crystal?.model ?? null,
		/** the stand-in on/off (a flight's before/after; off = the 30b primitive look) @param {boolean} on */
		setEnabled(on) {
			enabled = !!on;
			if (!enabled) {
				for (const f of figures.values()) {
					f.model.visible = false;
					if (f.object) hop(f.object, null);
				}
				if (crystal) {
					crystal.model.visible = false;
					hop(crystal.source, null);
				}
			}
		},
		enabled: () => enabled,
		/** the layer an enemy object's meshes sit on right now (0 = its own look) @param {any} object */
		layerOf: (object) => hopped.get(object) ?? 0
	};
}

