// waves — THE GUNS, pure (30b). Three weapons and the rules that say when each may fire:
//   Blaster  semi-automatic — one bolt per trigger pull, a short refire floor
//   Scatter  a spread of pellets, a slow pump between shots
//   Beam     continuous while held, damage in ticks; it HEATS, and an overheated beam locks
//            until it has cooled back down
// Everything here is plain numbers so the node tests can hold it; weapon.js turns it into
// models, rays, tracers and damage.

export const GUNS = Object.freeze({
	blaster: Object.freeze({ id: 'blaster', name: 'Blaster', mode: 'semi', refire: 0.16, damage: 1, pellets: 1, spread: 0, range: 60, color: 0x39e0ff, sound: 'shoot', blurb: 'Semi-auto. One precise bolt per pull.' }),
	scatter: Object.freeze({ id: 'scatter', name: 'Scatter', mode: 'spread', refire: 0.85, damage: 1, pellets: 7, spread: 0.075, range: 28, color: 0xffa040, sound: 'shoot', blurb: 'Seven pellets in a cone. Slow, brutal up close.' }),
	beam: Object.freeze({ id: 'beam', name: 'Beam', mode: 'beam', refire: 0.12, damage: 1, pellets: 1, spread: 0, range: 40, color: 0xff4fd8, sound: 'laser', heatPerSecond: 0.42, coolPerSecond: 0.55, lockUntil: 0.35, blurb: 'Hold to burn. Overheats — let it cool.' })
});
export const GUN_IDS = Object.freeze(Object.keys(GUNS));

/** @param {any} id @returns {typeof GUNS.blaster} */
export function gunOf(id) {
	return /** @type {any} */ (GUNS)[String(id)] ?? GUNS.blaster;
}

/**
 * One hand's trigger state for one frame -> does it fire, and the next state.
 * `pressed` is the trigger's edge this frame, `held` its level; `t` seconds.
 * The Beam heats while it fires and cools otherwise; reaching 1 LOCKS it until the heat
 * falls back under `lockUntil` (the overheat — you must let go and wait).
 * @param {ReturnType<typeof gunOf>} gun
 * @param {{last: number, heat: number, locked: boolean, at: number}} s the hand's state (last shot time, heat 0..1, locked, when heat was last stepped)
 * @param {{pressed: boolean, held: boolean, t: number}} input
 * @returns {{fire: boolean, state: {last: number, heat: number, locked: boolean, at: number}}}
 */
export function trigger(gun, s, input) {
	const dt = Math.max(0, Math.min(0.25, input.t - (Number.isFinite(s.at) ? s.at : input.t)));
	let { last, heat, locked } = s;
	let fire = false;
	if (gun.mode === 'beam') {
		const want = input.held && !locked;
		if (want) {
			heat = Math.min(1, heat + (gun.heatPerSecond ?? 0.4) * dt);
			if (heat >= 1) locked = true;
			if (!locked && input.t - last >= gun.refire) fire = true;
		} else heat = Math.max(0, heat - (gun.coolPerSecond ?? 0.5) * dt);
		if (locked && heat <= (gun.lockUntil ?? 0.35)) locked = false;
	} else {
		heat = 0;
		locked = false;
		if (input.pressed && input.t - last >= gun.refire) fire = true;
	}
	if (fire) last = input.t;
	return { fire, state: { last, heat, locked, at: input.t } };
}

/** a fresh hand state */
export const idleHand = () => ({ last: -Infinity, heat: 0, locked: false, at: NaN });

/**
 * The pellet directions of one shot: the aim itself for a single bolt; for a spread, a
 * fixed pattern (a centre pellet and a ring) turned by `twist` so two shots do not stack
 * pellets in the same holes. Unit vectors, plain arrays.
 * @param {number[]} dir unit aim @param {number} pellets @param {number} spread radians of the cone's half-angle
 * @param {number} twist radians
 * @returns {number[][]}
 */
export function pelletDirs(dir, pellets, spread, twist = 0) {
	if (pellets <= 1 || !(spread > 0)) return [dir.slice(0, 3)];
	// an orthonormal pair around the aim
	const up = Math.abs(dir[1]) < 0.95 ? [0, 1, 0] : [1, 0, 0];
	const a = norm(cross(dir, up));
	const b = cross(a, dir);
	const out = [dir.slice(0, 3)];
	const ring = pellets - 1;
	for (let i = 0; i < ring; i++) {
		const ang = twist + (i / ring) * Math.PI * 2;
		const r = Math.tan(spread) * (i % 2 ? 0.6 : 1);
		out.push(norm([dir[0] + (a[0] * Math.cos(ang) + b[0] * Math.sin(ang)) * r, dir[1] + (a[1] * Math.cos(ang) + b[1] * Math.sin(ang)) * r, dir[2] + (a[2] * Math.cos(ang) + b[2] * Math.sin(ang)) * r]));
	}
	return out;
}

/** @param {number[]} a @param {number[]} b */
function cross(a, b) {
	return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
/** @param {number[]} v */
function norm(v) {
	const l = Math.hypot(v[0], v[1], v[2]) || 1;
	return [v[0] / l, v[1] / l, v[2] / l];
}

/** Which hands carry a gun for the handedness option. @param {any} hand 'right' | 'left' | 'both' */
export function gunHands(hand) {
	if (hand === 'left') return ['left'];
	if (hand === 'both') return ['right', 'left'];
	return ['right'];
}

/** The hand whose GRIP fires the ability: the free hand; the left one when both hold guns.
 * @param {any} hand */
export function abilityHand(hand) {
	return hand === 'left' ? 'right' : 'left';
}
