// football — THE KICK, pure (30b). A VR controller's TIP is a small sphere a little in front
// of the controller; swung through the ball it imparts the swing: the ball gains the tip's
// closing speed along the contact normal (times a gain), capped. No api, no THREE, no
// clock — plain arrays, so `test/kick.test.mjs` proves every rule in node.
//
// Why the module kicks at all when core's knock already probes the hands (24-A): core's
// probe goes quiet while the grip is SQUEEZED ("a gripped hand is carrying"), and a Quest
// player swinging at a ball squeezes the grip; the tip kick also gives the swing its own
// `kick` sound and a haptic scaled by the impulse. The two never double up: a kick within
// DEDUPE_MS of the same peer's core hit on the ball is dropped (game.js).

/** the tip sphere */
export const TIP_RADIUS = 0.07;
/** how far in front of the controller's ray origin the tip sits (along its -Z) */
export const TIP_OFFSET = 0.05;
/** a swing slower than this is a nudge, not a kick */
export const MIN_KICK_SPEED = 0.35;
/** the swing lands a little harder than the hand moved — a casual game's kick feels strong */
export const KICK_GAIN = 1.3;
/** the scene's own cap applies on top (knock.maxSpeed); this is the module's */
export const MAX_KICK_SPEED = 10;
/** the samples a tip velocity is taken over */
export const VELOCITY_WINDOW_MS = 90;
/** a core hit and a tip kick by one peer within this window are one touch */
export const DEDUPE_MS = 250;
/** a desktop / laser click kicks the ball only this close to the player */
export const CLICK_REACH = 2.5;
/** a click kick's speed */
export const CLICK_KICK_SPEED = 4;

/** rotate v by the unit quaternion q = [x, y, z, w] @param {number[]} v @param {number[]} q */
export function rotate(v, q) {
	const [x, y, z] = v;
	const [qx, qy, qz, qw] = q;
	// t = 2 * cross(q.xyz, v); v' = v + w * t + cross(q.xyz, t)
	const tx = 2 * (qy * z - qz * y);
	const ty = 2 * (qz * x - qx * z);
	const tz = 2 * (qx * y - qy * x);
	return [x + qw * tx + (qy * tz - qz * ty), y + qw * ty + (qz * tx - qx * tz), z + qw * tz + (qx * ty - qy * tx)];
}

/** the tip of a controller at `pos` facing `quat` (its -Z) @param {number[]} pos @param {number[] | null} quat */
export function tipPoint(pos, quat, offset = TIP_OFFSET) {
	if (!quat) return [pos[0], pos[1], pos[2]];
	const f = rotate([0, 0, -offset], quat);
	return [pos[0] + f[0], pos[1] + f[1], pos[2] + f[2]];
}

/** push a sample, drop what fell out of the window @param {{t: number, p: number[]}[]} ring
 * @param {number[]} p @param {number} t ms */
export function pushSample(ring, p, t, windowMs = VELOCITY_WINDOW_MS) {
	// a clock that went BACKWARDS (a new feeder) restarts the ring rather than read a
	// negative dt as a 20 m/s swing
	if (ring.length && t < ring[ring.length - 1].t) ring.length = 0;
	ring.push({ t, p: [p[0], p[1], p[2]] });
	while (ring.length > 2 && t - ring[0].t > windowMs) ring.shift();
	return ring;
}

/** m/s over the ring (first to last sample) @param {{t: number, p: number[]}[]} ring @returns {number[]} */
export function ringVelocity(ring) {
	if (ring.length < 2) return [0, 0, 0];
	const a = ring[0];
	const b = ring[ring.length - 1];
	const dt = (b.t - a.t) / 1000;
	if (!(dt > 1e-4)) return [0, 0, 0];
	return [(b.p[0] - a.p[0]) / dt, (b.p[1] - a.p[1]) / dt, (b.p[2] - a.p[2]) / dt];
}

/**
 * Sphere (the tip) against sphere (the ball). `n` is the unit normal from the tip toward
 * the ball's centre; `approach` the closing speed along it (tip velocity minus ball
 * velocity) — positive = the tip is driving into the ball.
 * @param {number[]} tip @param {number[]} tipVel @param {number} tipR
 * @param {number[]} ball @param {number[]} ballVel @param {number} ballR
 */
export function kickContact(tip, tipVel, tipR, ball, ballVel, ballR) {
	const dx = ball[0] - tip[0];
	const dy = ball[1] - tip[1];
	const dz = ball[2] - tip[2];
	const d = Math.hypot(dx, dy, dz);
	const overlap = d < tipR + ballR;
	// dead centre: push along the swing
	let n = d > 1e-6 ? [dx / d, dy / d, dz / d] : null;
	if (!n) {
		const s = Math.hypot(tipVel[0], tipVel[1], tipVel[2]);
		n = s > 1e-6 ? [tipVel[0] / s, tipVel[1] / s, tipVel[2] / s] : [0, 0, -1];
	}
	const rel = [tipVel[0] - ballVel[0], tipVel[1] - ballVel[1], tipVel[2] - ballVel[2]];
	const approach = rel[0] * n[0] + rel[1] * n[1] + rel[2] * n[2];
	return { overlap, n, approach, distance: d };
}

/**
 * The impulse (N·s) that gives a ball of `mass` the kick: Δv = n * approach * gain, the
 * RESULTING speed capped at `maxSpeed` (the ball's own velocity counts toward the cap).
 * @param {number[]} n @param {number} approach @param {number} mass @param {number[]} ballVel
 */
export function kickImpulse(n, approach, mass, ballVel, gain = KICK_GAIN, maxSpeed = MAX_KICK_SPEED) {
	let dv = Math.max(0, approach) * gain;
	const m = Math.max(0.01, mass || 1);
	// solve |ballVel + n dv| <= maxSpeed for dv (shrink only)
	const after = [ballVel[0] + n[0] * dv, ballVel[1] + n[1] * dv, ballVel[2] + n[2] * dv];
	const speed = Math.hypot(after[0], after[1], after[2]);
	if (speed > maxSpeed && dv > 0) {
		const b = ballVel[0] * n[0] + ballVel[1] * n[1] + ballVel[2] * n[2];
		const c = ballVel[0] ** 2 + ballVel[1] ** 2 + ballVel[2] ** 2 - maxSpeed * maxSpeed;
		const disc = b * b - c;
		dv = disc >= 0 ? Math.max(0, Math.min(dv, -b + Math.sqrt(disc))) : 0;
	}
	return [n[0] * dv * m, n[1] * dv * m, n[2] * dv * m];
}

/** the kicker's buzz: stronger for a harder kick, 0.25 .. 1 @param {number} speed m/s */
export function kickHaptic(speed) {
	return Math.min(1, 0.25 + Math.max(0, speed) / 8);
}

/**
 * Did the ball BOUNCE between two velocity readings — a wall, a post, the glass? Both
 * readings fast enough and the direction turned by more than ~70 degrees.
 * @param {number[]} before @param {number[]} after @param {number} [minSpeed]
 */
export function bounced(before, after, minSpeed = 0.6) {
	const a = Math.hypot(before[0], before[1], before[2]);
	const b = Math.hypot(after[0], after[1], after[2]);
	if (a < minSpeed || b < minSpeed * 0.5) return false;
	const cos = (before[0] * after[0] + before[1] * after[1] + before[2] * after[2]) / (a * b);
	return cos < 0.35;
}

/**
 * The per-hand arming: a tip that kicked stays SPENT until it leaves the ball (its surface
 * gap opens past `release`) — one swing, one kick, however many frames it spends inside.
 * @param {{spent: boolean}} state @param {number} distance centre to centre
 * @param {number} reach tipR + ballR @returns {boolean} may this contact kick
 */
export function armStep(state, distance, reach, release = 0.03) {
	if (distance > reach + release) state.spent = false;
	return !state.spent && distance < reach;
}
