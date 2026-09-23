// waves — THE GUN IN YOUR HAND (30b P1). In the game (Play / Interact) a gun rides the chosen
// controller(s) in a headset — the trigger fires it — and sits at the bottom right of the view
// on a desktop, where a click fires along the crosshair. A shot is HITSCAN: a ray from the
// controller (or the crosshair) against the scene; the first thing it meets stops it. An enemy
// it meets takes the gun's damage through the engine (replicated pulses on its health chain),
// flashes, is shoved back along its lane, and dies in a pop. Everything drawn here is LOCAL.

import { gunOf, trigger, idleHand, pelletDirs, gunHands } from './guns.js';
import { buildGun, gunFromAsset } from './models.js';
import { aimRay, createEdges, inGame } from './vr.js';

/** where the gun sits in the controller's frame: the grip a little behind and under the aim */
const GRIP_OFFSET = [0, -0.035, 0.05];

/**
 * @param {any} api
 * @param {ReturnType<import('./engine.js').createWavesEngine>} engine
 * @param {any} root the module's scene-root group
 * @param {ReturnType<import('./juice.js').createJuice>} juice
 * @param {ReturnType<import('./prefs.js').createPrefs>} prefs
 * @param {{sound: (name: string, at?: number[]) => void, haptic: (pattern: string, hand?: string) => void}} feel
 * @param {ReturnType<import('./assets.js').createAssets> | null} [assets] 30c: the Meshy guns
 */
export function registerWeapon(api, engine, root, juice, prefs, feel, assets = null) {
	const THREE = api.THREE;
	const edges = createEdges();
	/** hand ('right' | 'left' | 'desk') -> its model + trigger state */
	/** @type {Map<string, {model: any, gun: string, glb: boolean, state: ReturnType<typeof idleHand>, kick: number, holding: boolean, lastSound: number}>} */
	const hands = new Map();
	const clock = () => performance.now() / 1000;
	const stats = { shots: 0, hits: 0, kills: 0, lastShot: /** @type {any} */ (null) };

	/** @param {string} hand */
	function handOf(hand) {
		const id = prefs.get().gun;
		let h = hands.get(hand);
		const gun = gunOf(id);
		// 30c: the Meshy gun once its file is in (the primitive one holds the hand meanwhile) —
		// an instance is made only when the hand is (re)built, never every frame
		const ready = !!assets?.get(gun.id);
		if (!h || h.gun !== gun.id || (ready && !h.glb)) {
			const glb = ready ? assets?.instance(gun.id) : null;
			if (h) {
				h.model.parent?.remove(h.model);
				// a Meshy gun's materials are its own clones (the textures stay shared): let them go
				if (h.glb) h.model.traverse((/** @type {any} */ o) => o.isMesh && o.material?.dispose?.());
				if (h.gun !== gun.id) juice.beam(hand, null, null, 0);
			}
			const model = glb ? gunFromAsset(THREE, glb.scene, /** @type {any} */ (gun.id), gun.color) : buildGun(THREE, /** @type {any} */ (gun.id), gun.color);
			model.visible = false;
			root.add(model);
			const keep = h && h.gun === gun.id ? h : null;
			h = { model, gun: gun.id, glb: !!glb, state: keep?.state ?? idleHand(), kick: keep?.kick ?? 0, holding: keep?.holding ?? false, lastSound: keep?.lastSound ?? -Infinity };
			hands.set(hand, h);
		}
		return h;
	}

	// ---- the desktop mouse: a press on the viewport (or anywhere under the pointer lock) ------
	const mouse = { down: false, pressed: false };
	if (typeof window !== 'undefined') {
		const onDown = (/** @type {PointerEvent} */ e) => {
			if (e.button !== 0) return;
			const target = /** @type {any} */ (e.target);
			if (!document.pointerLockElement && target?.tagName !== 'CANVAS') return;
			mouse.down = true;
			mouse.pressed = true;
		};
		const onUp = (/** @type {PointerEvent} */ e) => {
			if (e.button === 0) mouse.down = false;
		};
		window.addEventListener('pointerdown', onDown, true);
		window.addEventListener('pointerup', onUp, true);
		window.addEventListener('blur', () => (mouse.down = false));
	}

	/** is a round RUNNING (a finite round stamp, playing or paused) */
	const running = () => {
		const cutoff = api.game.roundCutoff();
		return typeof cutoff === 'number' && Number.isFinite(cutoff) && api.game.roundUnderway();
	};

	// ---- the pose ------------------------------------------------------------------------------
	const _m = new THREE.Matrix4();
	const _p = new THREE.Vector3();
	const _q = new THREE.Quaternion();
	const _s = new THREE.Vector3();
	/** put `object` at a WORLD pose, whatever its parent is @param {any} object @param {any} world Matrix4 */
	function setWorld(object, world) {
		const parent = object.parent;
		if (parent) {
			parent.updateMatrixWorld?.(true);
			_m.copy(parent.matrixWorld).invert().multiply(world);
		} else _m.copy(world);
		_m.decompose(_p, _q, _s);
		object.position.copy(_p);
		object.quaternion.copy(_q);
		object.scale.copy(_s);
		object.updateMatrixWorld(true);
	}

	/** the controller pose -> the gun's world matrix (with the recoil kick along +Z)
	 * @param {{position: number[], quaternion: number[]}} snap @param {number} kick */
	function handMatrix(snap, kick) {
		const q = new THREE.Quaternion().fromArray(snap.quaternion);
		const offset = new THREE.Vector3(GRIP_OFFSET[0], GRIP_OFFSET[1], GRIP_OFFSET[2] + kick).applyQuaternion(q);
		const p = new THREE.Vector3().fromArray(snap.position).add(offset);
		return new THREE.Matrix4().compose(p, q, new THREE.Vector3(1, 1, 1));
	}

	/** the desktop view-model: bottom right of the view, down the crosshair @param {any} ray @param {number} kick */
	function deskMatrix(ray, kick) {
		const d = ray.direction.clone().normalize();
		const right = new THREE.Vector3().crossVectors(d, new THREE.Vector3(0, 1, 0));
		if (right.lengthSq() < 1e-6) right.set(1, 0, 0);
		right.normalize();
		const up = new THREE.Vector3().crossVectors(right, d).normalize();
		const p = ray.origin.clone().addScaledVector(d, 0.46 - kick).addScaledVector(right, 0.17).addScaledVector(up, -0.15);
		const basis = new THREE.Matrix4().makeBasis(right, up, d.clone().negate());
		return new THREE.Matrix4().compose(p, new THREE.Quaternion().setFromRotationMatrix(basis), new THREE.Vector3(1, 1, 1));
	}

	// ---- the shot ------------------------------------------------------------------------------
	// 30c: an enemy's own meshes stay its hit volume under a Meshy figure — they leave layer 0
	// only inside a render, so this ray (cast from a frame task) meets them as always
	const raycaster = new THREE.Raycaster();
	/** every ancestor visible? (a hidden enemy, a hidden group's child: not there) @param {any} o */
	const shown = (o) => {
		for (let c = o; c; c = c.parent) if (c.visible === false) return false;
		return true;
	};

	/**
	 * One ray against the scene: the first visible mesh it meets, and whether that mesh belongs
	 * to an enemy a shot may hit now.
	 * @param {number[]} origin @param {number[]} dir @param {number} range @param {Map<string, any>} targets
	 * @returns {{point: number[], uuid: string | null, distance: number}}
	 */
	function cast(origin, dir, range, targets) {
		const group = api.objectsGroup();
		const o = new THREE.Vector3().fromArray(origin);
		const d = new THREE.Vector3().fromArray(dir).normalize();
		raycaster.set(o, d);
		raycaster.near = 0.05;
		raycaster.far = range;
		const found = group ? raycaster.intersectObjects(group.children, true) : [];
		for (const x of found) {
			if (!x.object?.isMesh || !shown(x.object)) continue;
			let top = x.object;
			while (top.parent && top.parent !== group) top = top.parent;
			const uuid = targets.has(top.uuid) ? top.uuid : null;
			return { point: x.point.toArray(), uuid, distance: x.distance };
		}
		return { point: o.addScaledVector(d, range).toArray(), uuid: null, distance: range };
	}

	/**
	 * FIRE: every pellet cast, every enemy it met damaged once per pellet, the tracer(s), the
	 * flash, the sound and the buzz. Exported for the flight and the desktop path alike.
	 * @param {string} hand @param {number[]} origin @param {number[]} dir @param {number[]} muzzle
	 */
	function fire(hand, origin, dir, muzzle) {
		const gun = gunOf(prefs.get().gun);
		const targets = new Map(engine.targets().map((t) => [t.uuid, t]));
		const dirs = pelletDirs(dir, gun.pellets, gun.spread, Math.random() * Math.PI);
		/** @type {Map<string, number>} */
		const perEnemy = new Map();
		let end = null;
		for (const d of dirs) {
			const hit = cast(origin, d, gun.range, targets);
			if (!end) end = hit.point;
			if (gun.mode !== 'beam') juice.tracer(muzzle, hit.point, gun.color, gun.pellets > 1 ? 0.012 : 0.02);
			if (hit.uuid) {
				perEnemy.set(hit.uuid, (perEnemy.get(hit.uuid) ?? 0) + gun.damage);
				juice.spark(hit.point, gun.color);
			} else if (hit.distance < gun.range) juice.spark(hit.point, 0xffe0c0);
		}
		stats.shots++;
		/** @type {{uuid: string, landed: number, killed: boolean}[]} */
		const results = [];
		for (const [uuid, n] of perEnemy) {
			const r = engine.hit(uuid, n);
			if (!r) continue;
			stats.hits += r.landed;
			if (r.killed) stats.kills++;
			results.push({ uuid, landed: r.landed, killed: r.killed });
		}
		stats.lastShot = { hand, gun: gun.id, pellets: dirs.length, results, end, at: clock() };
		if (gun.mode !== 'beam') {
			juice.flash(muzzle, gun.color);
			feel.sound(gun.sound, muzzle);
		}
		if (results.some((r) => r.killed)) feel.haptic('hit', hand);
		else feel.haptic(gun.mode === 'beam' ? 'tap' : 'bump', hand);
		return { end, results };
	}

	// ---- every frame ---------------------------------------------------------------------------
	function frame() {
		const game = inGame(api);
		const vr = !!api.isVR?.();
		const t = clock();
		const gun = gunOf(prefs.get().gun);
		const armed = gunHands(prefs.get().hand);
		const live = running();
		/** @type {Set<string>} */
		const shownHands = new Set();

		if (game && vr) {
			for (const hand of armed) {
				const snap = api.vrHand?.(hand);
				if (!snap?.position || !snap?.quaternion) continue;
				const h = handOf(hand);
				shownHands.add(hand);
				h.kick *= Math.exp(-(1 / 60) * 18);
				setWorld(h.model, handMatrix(snap, h.kick));
				h.model.visible = true;
				const held = !!snap.trigger;
				const pressed = edges.edge('trigger-' + hand, held);
				step(hand, h, gun, { pressed, held, t }, () => {
					const ray = aimRay(snap);
					const muzzle = h.model.userData.muzzle.getWorldPosition(new THREE.Vector3()).toArray();
					return { origin: ray.origin, dir: ray.dir, muzzle };
				});
			}
		} else if (game && !vr && live) {
			const ray = api.pointerRay?.();
			if (ray) {
				const h = handOf('desk');
				shownHands.add('desk');
				h.kick *= Math.exp(-(1 / 60) * 16);
				setWorld(h.model, deskMatrix(ray.ray ?? ray, h.kick));
				h.model.visible = true;
				const pressed = mouse.pressed;
				mouse.pressed = false;
				step('desk', h, gun, { pressed, held: mouse.down, t }, () => {
					const r = ray.ray ?? ray;
					const muzzle = h.model.userData.muzzle.getWorldPosition(new THREE.Vector3()).toArray();
					return { origin: r.origin.toArray(), dir: r.direction.clone().normalize().toArray(), muzzle };
				});
			}
		}
		if (!shownHands.has('desk')) mouse.pressed = false;
		for (const [hand, h] of hands)
			if (!shownHands.has(hand)) {
				h.model.visible = false;
				h.holding = false;
				juice.beam(hand, null, null, 0);
			}
	}

	/**
	 * One hand's trigger through the gun's rules, then the shot (and for the Beam, the streak
	 * that follows the aim while it burns, and the heat on the gun's glow).
	 * @param {string} hand @param {any} h @param {ReturnType<typeof gunOf>} gun
	 * @param {{pressed: boolean, held: boolean, t: number}} input @param {() => {origin: number[], dir: number[], muzzle: number[]}} aim
	 */
	function step(hand, h, gun, input, aim) {
		const wasLocked = h.state.locked;
		const r = trigger(gun, h.state, input);
		h.state = r.state;
		if (r.fire) {
			const a = aim();
			fire(hand, a.origin, a.dir, a.muzzle);
			h.kick = gun.mode === 'spread' ? 0.06 : gun.mode === 'beam' ? 0.008 : 0.03;
		}
		if (gun.mode === 'beam') {
			const burning = input.held && !h.state.locked;
			if (burning) {
				const a = aim();
				const hit = cast(a.origin, a.dir, gun.range, new Map());
				juice.beam(hand, a.muzzle, hit.point, gun.color, h.state.heat);
				if (!h.holding || input.t - h.lastSound > 0.45) {
					feel.sound(gun.sound, a.muzzle);
					h.lastSound = input.t;
				}
			} else juice.beam(hand, null, null, 0);
			h.holding = burning;
			if (h.state.locked && !wasLocked) {
				feel.sound('fail');
				feel.haptic('fail', hand);
			}
			const glow = h.model.userData.glow;
			if (glow) {
				glow.emissiveIntensity = 1.2 + 3 * h.state.heat;
				glow.emissive.setHex(h.state.locked ? 0xff2a10 : gun.color);
			}
		}
	}

	api.registerFrameTask(() => {
		try {
			frame();
		} catch (error) {
			console.warn('[waves] gun failed', error);
		}
	});

	return {
		fire,
		cast,
		stats,
		hands,
		/** the hand's heat 0..1 and whether it is locked (the Beam), for a HUD @param {string} hand */
		heatOf: (hand) => {
			const h = hands.get(hand);
			return h ? { heat: h.state.heat, locked: h.state.locked } : { heat: 0, locked: false };
		}
	};
}
