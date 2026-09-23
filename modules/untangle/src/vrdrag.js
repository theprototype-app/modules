// THE VR DRAG — grab a dot with a controller's TRIGGER, carry it while held, release drops.
// Pure (no THREE, no api): index.js feeds it each hand's WORLD pose once per frame
// (`api.vrHand(hand)`: {position, quaternion, trigger}) and answers the board questions
// through hooks; this file decides WHEN and with WHICH hand, and owns the ray/tip math.
//
// Why not core's click path (the old VR route): core dispatches a module click on the
// trigger's `select`, which fires on RELEASE — so the old board picked on one full pull and
// dropped on the next, the dot followed the POINTER hand's ray whichever hand pulled, and
// only an exact mesh hit on the small sphere counted. On a Quest that read as "cannot move
// the dots". Here:
// - a trigger PRESS picks: the TIP (a ~6 cm sphere at the controller's front) touching a
//   dot wins, else the hand's LASER passing within a generous reach of one;
// - while that trigger is held the dot follows THAT hand: a tip grab rides the tip
//   (projected onto the board plane / the globe), a laser grab rides the ray's hit;
// - the RELEASE drops it (an untracked hand drops too). The other hand is ignored.
// Core's trailing `select` still reaches the click handler; index.js consumes it (a board
// hit, or one within CONSUME_MS of a VR pick/drop) and never acts on it. A press that grabs
// no dot is offered to `onPress` (the VR level bar, vrbar.js).

export const TIP_AHEAD = 0.02; // the tip sphere's centre, metres ahead of the ray origin
export const TIP_RADIUS = 0.03; // ~6 cm sphere (contract C3's tip)
export const REACH = 1.3; // a laser counts within REACH x the dot radius of its centre
export const CONSUME_MS = 450; // core's trailing select after a VR pick/drop is ours
export const HANDS = /** @type {const} */ (['right', 'left']);

/** @typedef {[number, number, number]} V3 */
/** @typedef {{position: number[], quaternion: number[], trigger: boolean}} Pose */

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a) => Math.hypot(a[0], a[1], a[2]);

/** rotate v by the unit quaternion q = [x, y, z, w] @returns {V3} */
export function quatRotate(q, v) {
	const [x, y, z, w] = q;
	// t = 2 q.xyz x v ; v' = v + w t + q.xyz x t
	const tx = 2 * (y * v[2] - z * v[1]);
	const ty = 2 * (z * v[0] - x * v[2]);
	const tz = 2 * (x * v[1] - y * v[0]);
	return [v[0] + w * tx + (y * tz - z * ty), v[1] + w * ty + (z * tx - x * tz), v[2] + w * tz + (x * ty - y * tx)];
}

/** a hand's world ray: from the controller along its -Z @param {Pose} pose */
export function handRay(pose) {
	const d = quatRotate(pose.quaternion, [0, 0, -1]);
	const l = len(d) || 1;
	return { origin: /** @type {V3} */ ([...pose.position]), dir: /** @type {V3} */ (mul(d, 1 / l)) };
}
/** the tip sphere's centre @param {Pose} pose @returns {V3} */
export function tipOf(pose) {
	const r = handRay(pose);
	return /** @type {V3} */ (add(r.origin, mul(r.dir, TIP_AHEAD)));
}

/** where a ray meets a plane (world), or null when parallel or behind */
export function rayPlane(origin, dir, point, normal) {
	const denom = dot(dir, normal);
	if (Math.abs(denom) < 1e-6) return null;
	const t = dot(sub(point, origin), normal) / denom;
	return t < 0 ? null : /** @type {V3} */ (add(origin, mul(dir, t)));
}
/** the point of a plane nearest to p */
export function closestOnPlane(p, point, normal) {
	const n = mul(normal, 1 / (len(normal) || 1));
	return /** @type {V3} */ (sub(p, mul(n, dot(sub(p, point), n))));
}
/** the NEAR hit of a ray on a sphere (t >= 0), or null */
export function raySphere(origin, dir, centre, r) {
	const oc = sub(origin, centre);
	const b = dot(oc, dir);
	const c = dot(oc, oc) - r * r;
	const disc = b * b - c;
	if (disc < 0) return null;
	const s = Math.sqrt(disc);
	const t = -b - s >= 0 ? -b - s : -b + s;
	return t < 0 ? null : /** @type {V3} */ (add(origin, mul(dir, t)));
}
/** a ray that misses the sphere lands on the rim point nearest to it (a drag past the edge) */
export function sphereRim(origin, dir, centre, r) {
	const along = dot(sub(centre, origin), dir);
	const nearest = add(origin, mul(dir, Math.max(0, along)));
	const out = sub(nearest, centre);
	const l = len(out);
	return /** @type {V3} */ (l < 1e-9 ? add(centre, [0, r, 0]) : add(centre, mul(out, r / l)));
}

/**
 * Which dot a hand grabs, if any: a TIP touch (nearest dot whose sphere the tip sphere
 * touches) wins over the LASER (nearest perpendicular miss within REACH x radius, ahead
 * of the hand and not past `frontLimit` along the ray — the globe's front face).
 * @param {{pose: Pose, dots: number[][], radius: number, frontLimit?: number}} q
 * @returns {{i: number, how: 'tip' | 'laser'} | null}
 */
export function pickDot({ pose, dots, radius, frontLimit = Infinity }) {
	const tip = tipOf(pose);
	let best = -1;
	let bestD = radius + TIP_RADIUS;
	dots.forEach((d, i) => {
		const dist = len(sub(d, tip));
		if (dist <= bestD) {
			bestD = dist;
			best = i;
		}
	});
	if (best >= 0) return { i: best, how: 'tip' };
	const { origin, dir } = handRay(pose);
	const reach = radius * REACH;
	let bestMiss = reach * reach;
	dots.forEach((d, i) => {
		const rel = sub(d, origin);
		const along = dot(rel, dir);
		if (along <= 0 || along > frontLimit + reach * 1.5) return;
		const miss = dot(rel, rel) - along * along;
		if (miss <= bestMiss) {
			bestMiss = miss;
			best = i;
		}
	});
	return best >= 0 ? { i: best, how: 'laser' } : null;
}

/**
 * Where a carried dot goes this frame (world), or null to leave it.
 * surface: {kind: 'plane', point, normal} (the 2D board) | {kind: 'sphere', centre, r} (the globe)
 * @param {'tip' | 'laser'} how @param {Pose} pose @param {any} surface @returns {V3 | null}
 */
export function followPoint(how, pose, surface) {
	if (how === 'tip') {
		const tip = tipOf(pose);
		if (surface.kind === 'plane') return closestOnPlane(tip, surface.point, surface.normal);
		const out = sub(tip, surface.centre);
		const l = len(out);
		return l < 1e-9 ? null : /** @type {V3} */ (add(surface.centre, mul(out, surface.r / l)));
	}
	const { origin, dir } = handRay(pose);
	if (surface.kind === 'plane') return rayPlane(origin, dir, surface.point, surface.normal);
	return raySphere(origin, dir, surface.centre, surface.r) ?? sphereRim(origin, dir, surface.centre, surface.r);
}

/**
 * The per-frame trigger state machine.
 * @param {{
 *   canPick: () => boolean,
 *   pickAt: (pose: Pose, hand: string) => ({i: number, how: 'tip' | 'laser'} | null),
 *   pick: (i: number, hand: string, how: string) => void,
 *   follow: (pose: Pose, hand: string, how: string) => void,
 *   drop: (hand: string, why: string) => void,
 *   carrying: () => boolean,
 *   onPress?: (pose: Pose, hand: string) => boolean,
 *   now?: () => number
 * }} hooks
 */
export function createVRDrag(hooks) {
	const now = hooks.now ?? (() => performance.now());
	/** trigger state last frame, per hand */
	const was = { left: false, right: false };
	/** @type {{hand: string, how: string} | null} */
	let carrier = null;
	let lastEventAt = -Infinity;
	/** @type {{hand: string, i: number, how: string} | null} what a press would grab now */
	let candidate = null;

	return {
		/** one frame: `hands` maps 'left'/'right' to a pose (or null when untracked) @param {Record<string, Pose | null>} hands */
		update(hands) {
			// a carry that ended elsewhere (a drop by another path, a level change) is forgotten
			if (carrier && !hooks.carrying()) carrier = null;
			if (carrier) {
				const pose = hands[carrier.hand];
				if (!pose) {
					const hand = carrier.hand;
					carrier = null;
					lastEventAt = now();
					hooks.drop(hand, 'lost');
				} else if (!pose.trigger) {
					const hand = carrier.hand;
					carrier = null;
					lastEventAt = now();
					hooks.drop(hand, 'release');
				} else hooks.follow(pose, carrier.hand, carrier.how);
			}
			candidate = null;
			for (const hand of HANDS) {
				const pose = hands[hand];
				const down = !!pose?.trigger;
				const pressed = down && !was[hand];
				was[hand] = down;
				if (!pose || carrier || !hooks.canPick()) continue;
				const hit = hooks.pickAt(pose, hand);
				if (hit && !candidate) candidate = { hand, ...hit };
				if (pressed && hit) {
					carrier = { hand, how: hit.how };
					lastEventAt = now();
					hooks.pick(hit.i, hand, hit.how);
				} else if (pressed && hooks.onPress?.(pose, hand)) lastEventAt = now(); // a press on something else of ours (the level bar)
			}
		},
		/** the hand carrying, or null */
		carrier: () => (carrier ? { ...carrier } : null),
		/** the dot a press would grab right now (the VR hover) */
		candidate: () => (candidate ? { ...candidate } : null),
		/** did a VR pick/drop happen within CONSUME_MS? (core's trailing select is ours) */
		recent: () => now() - lastEventAt < CONSUME_MS,
		reset() {
			carrier = null;
			candidate = null;
		}
	};
}
