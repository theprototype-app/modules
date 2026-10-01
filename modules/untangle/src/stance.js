// STANCE — where a VR player stands to play the board, and whether a head sees it. PURE (no
// THREE, no api), so the numbers are unit-tested (test/stance.test.mjs).
//
// Roadmap 31 U2, the user on a Quest: "I spawn in the middle of untangle dots, i want them to
// be in front of me when i start game". The board stood at the scene origin, where a headset
// with no spawn lands — inside the dots. Now the module publishes a VR spawn with the board
// (`userData.play.spawn`, the play contract's publisher field, 30b C1): the feet stand
// SPAWN_DIST in front of the board's face, centred, facing it, so the board (or the globe's
// centre) is ~1.2-1.5 m ahead at chest height. `vrOnly`: desktop Play and Interact keep the
// template's own camera (a 1.7 m eye 1.35 m from a 1.7 m board would see only its middle).

/** the distance from the board's centre to the feet, metres: 1.35 for the template's 0.85 m
 * board, growing with a bigger board, never outside 1.2-1.5 m (the brief's comfort band) */
export const SPAWN_DIST = { base: 1.35, perRadius: 1.35 / 0.85, min: 1.2, max: 1.5 };

/** @param {number} radius the board radius (metres) */
export function spawnDistance(radius) {
	const r = Number(radius);
	const d = Number.isFinite(r) && r > 0 ? r * SPAWN_DIST.perRadius : SPAWN_DIST.base;
	return Math.min(SPAWN_DIST.max, Math.max(SPAWN_DIST.min, d));
}

/**
 * The VR spawn for a board pose: in front of its face (the board's local +Z, turned by its
 * yaw), facing it. `floorY` is the feet height there (the stage top, found by the caller).
 * @param {{x: number, z: number, yaw: number, radius: number}} board
 * @param {number} [floorY]
 * @returns {{position: [number, number, number], yaw: number, vrOnly: true}}
 */
export function spawnFor(board, floorY = 0) {
	const yaw = Number(board?.yaw) || 0;
	const d = spawnDistance(board?.radius);
	const x = (Number(board?.x) || 0) + Math.sin(yaw) * d;
	const z = (Number(board?.z) || 0) + Math.cos(yaw) * d;
	const y = Number.isFinite(Number(floorY)) ? Number(floorY) : 0;
	return { position: [round(x), round(y), round(z)], yaw: round(yaw), vrOnly: true };
}

/**
 * Is `target` ahead of a head, inside a cone? The flights' measure of "in front of me".
 * The head faces its yaw (three's rotation.y: 0 faces -Z). Returns the horizontal angle off
 * the facing (degrees), the horizontal distance and the height of the target over the head.
 * @param {{x: number, y: number, z: number, yaw: number}} head
 * @param {number[]} target [x, y, z]
 * @param {{maxDeg?: number, minDist?: number, maxDist?: number, minDy?: number, maxDy?: number}} [cone]
 */
export function aheadOf(head, target, cone = {}) {
	const { maxDeg = 15, minDist = 1.1, maxDist = 1.6, minDy = -0.6, maxDy = 0.1 } = cone;
	const dx = target[0] - head.x;
	const dz = target[2] - head.z;
	const dist = Math.hypot(dx, dz);
	const fx = -Math.sin(head.yaw);
	const fz = -Math.cos(head.yaw);
	const cos = dist > 1e-9 ? (dx * fx + dz * fz) / dist : 1;
	const deg = (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI;
	const dy = target[1] - head.y;
	return { ok: deg <= maxDeg && dist >= minDist && dist <= maxDist && dy >= minDy && dy <= maxDy, deg, dist, dy };
}

const round = (/** @type {number} */ v) => Math.round(v * 1000) / 1000;
