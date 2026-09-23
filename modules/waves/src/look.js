// waves — THE ARENA'S LOOK, pure (30-visuals-mod). The rule objects (Ground, Goal, the three
// Spawn pads, the four enemies, Home) keep their names and bodies; this file dresses them and
// adds ONE top-level group, `Arena`, of decoration: the goal tower's crystal core (the Goal
// Core node dims it with the player's hp), a portal ring over each spawn pad throwing the
// kit's sparkles, glowing lanes from each spawn to the goal, a border, lights and the card
// camera. Nothing in it moves or is a body of its own (the group's one collider is a floor slab
// under the ground — see floorSlab); nothing in it is named `Spawn…` (the Waves node
// reads every TOP-LEVEL object with that prefix as a spawn point — the group's children are
// not top-level, and none of them start with it anyway).

export const ARENA = 'Arena';
export const CORE = 'Goal core';
export const CARD_CAMERA = 'Card camera';

/** 30: the decoration group's OWN collider. Core's physics makes every top-level object a fixed
 * body, and a group's default collider is the box around ALL its children — for an arena that
 * box would swallow the play volume (the ball sat inside it and never moved). So the group
 * carries an explicit custom collider: a thin floor slab under the ground, nothing else.
 * @param {number} halfW @param {number} halfD @param {number} top */
export function floorSlab(halfW, halfD, top) {
	const verts = [];
	for (const y of [top - 0.06, top]) for (const x of [-halfW, halfW]) for (const z of [-halfD, halfD]) verts.push(x, y, z);
	return { mode: 'static', collider: 'custom', colliderVerts: verts };
}

/** how long a hit flash lasts, seconds, and how bright it peaks (emissive intensity) */
export const FLASH = { seconds: 0.18, peak: 3.5 };

/** The flash level `age` seconds after a hit: 1 at the hit, 0 once it is over — pure, so the
 * frame task only asks "how long ago". @param {number} age */
export function flashLevel(age) {
	if (!(age >= 0) || age >= FLASH.seconds) return 0;
	return 1 - age / FLASH.seconds;
}

/** The core's glow for a health fraction: never fully dark (a dead player still sees where to
 * run back to), full at full health. @param {number} fraction @param {number} [floor] */
export function coreGlow(fraction, floor = 0.15) {
	const f = Number.isFinite(fraction) ? Math.min(1, Math.max(0, fraction)) : 1;
	return floor + (1 - floor) * f;
}

const ENEMY_BODY = 0xff8a5c;
const VISOR = 0x7df9ff;

/** An enemy: a capsule body with an emissive visor band — ONE group, ONE dynamic body (the
 * group carries the physics; its collider is the capsule fitted to the group's box). The
 * health/knock contract reads the group's uuid, which is the object the def names.
 * @param {string} name @param {number[]} pos */
export function enemyObject(name, pos) {
	return {
		type: 'group',
		name,
		pos,
		// upright: a capsule on its round end tips over at rest — tilt locked, a knock still slides
		// and spins it (the health/knock contract only reads the hit)
		physics: { mode: 'dynamic', mass: 1, friction: 0.6, collider: 'capsule', freeze: { rx: true, rz: true } },
		children: [
			{ type: 'capsule', name: name + ' body', r: 0.32, h: 0.5, pos: [0, 0, 0], color: ENEMY_BODY, roughness: 0.45, clearcoat: 0.5 },
			{ type: 'box', name: name + ' visor', size: [0.44, 0.11, 0.2], bevel: 0.04, pos: [0, 0.2, 0.2], color: VISOR, emissive: VISOR, emissiveIntensity: 2.2, roughness: 0.2, shadow: false },
			{ type: 'box', name: name + ' belt', size: [0.66, 0.06, 0.66], bevel: 0.03, pos: [0, -0.12, 0], color: 0x3a2230, roughness: 0.6 }
		]
	};
}

/** The decoration group. @param {{spawns: number[][], goal: number[], home: number[], ground: {size: number[], pos: number[]}}} a */
export function arenaObjects(a) {
	/** @type {any[]} */
	const kids = [];
	const [gw, , gd] = a.ground.size;
	const [cx, , cz] = a.ground.pos;
	const FLAT = [-Math.PI / 2, 0, 0];
	const y = 0.02;

	// ---- the goal: a crystal core floating over the tower, its light, a ring on the floor ---
	const [gx, gy, gz] = a.goal;
	kids.push({ type: 'icosahedron', name: CORE, r: 0.42, detail: 0, pos: [gx, gy + 1.25, gz], color: 0x6ff3ff, emissive: 0x39e0ff, emissiveIntensity: 3, roughness: 0.15, metalness: 0.1, flatShading: true, shadow: false });
	kids.push({ type: 'light', name: 'Core light', color: 0x39e0ff, intensity: 6, distance: 9, pos: [gx, gy + 1.3, gz] });
	kids.push({ type: 'ring', name: 'Defend ring', r: 3.2, inner: 3.05, pos: [gx, y, gz], rot: FLAT, color: 0x39e0ff, emissive: 0x39e0ff, emissiveIntensity: 1.4, shadow: false, pick: 'through' });
	kids.push({ type: 'ring', name: 'Defend ring inner', r: 1.6, inner: 1.52, pos: [gx, y, gz], rot: FLAT, color: 0x39e0ff, emissive: 0x39e0ff, emissiveIntensity: 1.1, shadow: false, pick: 'through' });
	// four pylons around the tower
	for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]])
		kids.push({ type: 'box', name: 'Pylon ' + (sx < 0 ? 'W' : 'E') + (sz < 0 ? 'N' : 'S'), size: [0.22, 1.6, 0.22], bevel: 0.05, pos: [gx + sx * 1.35, 0.8, gz + sz * 1.35], color: 0x2b3240, roughness: 0.5, metalness: 0.3 });

	// ---- the spawn portals: an upright ring over each pad, facing the goal, sparkling red ----
	a.spawns.forEach((p, i) => {
		const [sx, , sz] = p;
		const yaw = Math.atan2(gx - sx, gz - sz);
		kids.push({
			type: 'torus',
			name: 'Portal ' + (i + 1),
			r: 0.85,
			tube: 0.07,
			pos: [sx, 1.05, sz],
			rot: [0, yaw, 0],
			color: 0xff5a4a,
			emissive: 0xff3b2e,
			emissiveIntensity: 2.4,
			roughness: 0.3,
			shadow: false,
			particles: { preset: 'sparkles', colorStart: '#ffd0c0', colorEnd: '#ff3b2e', radius: 0.6, count: 60 }
		});
		kids.push({ type: 'ring', name: 'Portal floor ' + (i + 1), r: 0.9, inner: 0.72, pos: [sx, y, sz], rot: FLAT, color: 0xff5a4a, emissive: 0xff3b2e, emissiveIntensity: 1.2, shadow: false, pick: 'through' });
		// the lane the enemies walk: a faint glowing strip from the portal to the goal ring
		const dx = gx - sx;
		const dz = gz - sz;
		const len = Math.hypot(dx, dz) - 3.2 - 0.9;
		const mid = 0.9 + len / 2;
		kids.push({
			type: 'plane',
			name: 'Lane ' + (i + 1),
			size: [0.32, Math.max(0.5, len)],
			pos: [sx + (dx / Math.hypot(dx, dz)) * mid, y - 0.004, sz + (dz / Math.hypot(dx, dz)) * mid],
			rot: [-Math.PI / 2, 0, Math.atan2(dx, dz) + Math.PI],
			color: 0xff6a4a,
			emissive: 0xff4a2e,
			emissiveIntensity: 0.2,
			opacity: 0.3,
			shadow: false,
			pick: 'through'
		});
	});

	// ---- home: a green ring around the home pad ----------------------------------------
	kids.push({ type: 'ring', name: 'Home ring', r: 0.8, inner: 0.68, pos: [a.home[0], y, a.home[2]], rot: FLAT, color: 0x6fcf7a, emissive: 0x6fcf7a, emissiveIntensity: 1.2, shadow: false, pick: 'through' });

	// ---- the land beyond the border: a floor to the horizon over the editor grid ------------
	kids.push({ type: 'plane', name: 'Outer floor', size: [300, 300], pos: [cx, 0.008, cz], rot: FLAT, color: 0x5a4c44, roughness: 0.95, pick: 'through' });

	// ---- mesas on the horizon: silhouettes against the sunset, softened by the fog ----------
	const MESAS = [[0.3, 78, 14, 22], [1.1, 92, 20, 30], [1.9, 70, 10, 18], [2.6, 86, 17, 26], [3.4, 74, 12, 20], [4.1, 95, 22, 34], [4.9, 80, 15, 24], [5.6, 72, 11, 16]];
	MESAS.forEach(([a, r, h, w], i) => {
		kids.push({ type: 'cylinder', name: 'Mesa ' + (i + 1), r: w * 0.42, r2: w * 0.5, h, pos: [cx + Math.sin(a) * r, h / 2, cz + Math.cos(a) * r], color: 0x6a4a44, roughness: 0.95, pick: 'through' });
	});

	// ---- the border: four low walls with an ember trim, just inside the ground's edge -----
	const t = 0.3;
	const h = 0.5;
	const walls = [
		['Border north', [gw, h, t], [cx, h / 2, cz - gd / 2 + t / 2]],
		['Border south', [gw, h, t], [cx, h / 2, cz + gd / 2 - t / 2]],
		['Border west', [t, h, gd - 2 * t], [cx - gw / 2 + t / 2, h / 2, cz]],
		['Border east', [t, h, gd - 2 * t], [cx + gw / 2 - t / 2, h / 2, cz]]
	];
	for (const [name, size, pos] of walls) {
		kids.push({ type: 'box', name: /** @type {string} */ (name), size, pos, color: 0x2a2f38, roughness: 0.7 });
		kids.push({ type: 'box', name: name + ' trim', size: [/** @type {number[]} */ (size)[0] + 0.01, 0.04, /** @type {number[]} */ (size)[2] + 0.01], pos: [/** @type {number[]} */ (pos)[0], h + 0.02, /** @type {number[]} */ (pos)[2]], color: 0xff7a3a, emissive: 0xff6a2a, emissiveIntensity: 1.6, shadow: false });
	}

	// ---- a warm key light over the arena (the sunset sun does the rest), the card camera ---
	kids.push({ type: 'light', name: 'Arena fill', kind: 'hemisphere', color: 0xffd9b8, groundColor: 0x40302a, intensity: 0.6, pos: [cx, 8, cz] });
	kids.push({ type: 'camera', name: CARD_CAMERA, pos: [cx + 11, 9, gz + 9], lookAt: [cx - 1, 0, cz - 3], fov: 50 });

	// under the Ground box's top (y 0.015): the slab never touches an enemy or a player
	return [{ type: 'group', name: ARENA, physics: floorSlab(gw / 2, gd / 2, 0.01), children: kids }];
}
