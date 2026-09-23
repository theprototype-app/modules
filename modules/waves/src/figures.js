// waves — THE FIGURES' RULES, pure (30c). A Meshy figure STANDS IN for an enemy's primitive
// look: the enemy object (its name, its capsule body, its hit volume, its replicated health)
// is untouched and still what a shot hits; the figure is a local skinned model that follows
// it, faces its goal and walks at the speed the object actually moves. Everything here is a
// pure function of numbers so the frame task (figure.js) only feeds it poses and clocks.

import { ENEMY_LOOKS } from './look.js';

/** the render layer a stood-in primitive hops to while its figure shows (in a game). Core's
 * cameras render layer 0 (the editor adds 1, its helper layer); 31 is core's overload guard.
 * A layer, not `visible`: GLTFExporter (autosave, the late-join snapshot) never writes layers,
 * so a saved scene always keeps its primitives, and a peer without the models still sees them */
export const STAND_IN_LAYER = 30;
/** core's helper layer: in EDIT the stand-in rides here — the editor still sees and picks the
 * capsule (it is the hit volume), a card camera or thumbnail (layer 0 only) sees the figure */
export const HELPER_LAYER = 1;

/**
 * Per kind: which clip walks it, how fast that clip walks at scale 1 (metres per second of
 * ground covered by one cycle at the figure's height), and how tall the figure stands —
 * the capsule's own height, so the hit volume and the figure agree.
 */
export const FIGURES = Object.freeze({
	grunt: Object.freeze({ walk: 'walk', clipSpeed: 1.1, height: 1.2 }),
	runner: Object.freeze({ walk: 'run', clipSpeed: 2.6, height: 1.05 }),
	tank: Object.freeze({ walk: 'walk', clipSpeed: 0.8, height: 1.6 })
});

/** @param {string} kind */
export const figureOf = (kind) => /** @type {any} */ (FIGURES)[kind] ?? FIGURES.grunt;

/** the capsule's bottom below the enemy object's origin (the group sits at the capsule's
 * centre) — where a figure's feet go @param {string} kind */
export function footDrop(kind) {
	const l = /** @type {any} */ (ENEMY_LOOKS)[kind] ?? ENEMY_LOOKS.grunt;
	return Math.round((l.r + l.h / 2) * 1000) / 1000;
}

/**
 * The uniform scale that stands a model of bind-pose height `modelHeight` at `height`.
 * @param {number} modelHeight @param {number} height
 */
export function fitScale(modelHeight, height) {
	if (!(modelHeight > 1e-6) || !(height > 0)) return 1;
	return height / modelHeight;
}

/** the yaw (about +Y) that turns a figure's +Z face from `from` toward `to` @param {number[]} from @param {number[]} to */
export function yawTo(from, to) {
	const dx = to[0] - from[0];
	const dz = to[2] - from[2];
	if (Math.hypot(dx, dz) < 1e-6) return 0;
	return Math.atan2(dx, dz);
}

/** turn `current` toward `target` by at most `rate × dt` radians, the short way round
 * @param {number} current @param {number} target @param {number} dt @param {number} rate */
export function turnToward(current, target, dt, rate = 6) {
	let d = target - current;
	d = Math.atan2(Math.sin(d), Math.cos(d));
	const step = Math.max(0, rate * dt);
	if (Math.abs(d) <= step) return target;
	return current + Math.sign(d) * step;
}

/**
 * The GAIT from two samples of the object's position: its ground speed and whether it moved
 * toward the way it faces (a knockback shoves it backwards — the walk then does not play
 * forwards over a slide). Speeds are smoothed so a frame hitch never flicks the clip.
 * @param {{speed: number}} prev @param {number[]} a @param {number[]} b @param {number} dt @param {number} yaw
 * @returns {{speed: number, forward: boolean}}
 */
export function gait(prev, a, b, dt, yaw) {
	if (!(dt > 0)) return { speed: prev.speed, forward: true };
	const dx = b[0] - a[0];
	const dz = b[2] - a[2];
	const raw = Math.hypot(dx, dz) / dt;
	// a teleport (a respawn at the portal, a stash) is not a walk
	const speed = raw > 12 ? 0 : raw;
	const forward = dx * Math.sin(yaw) + dz * Math.cos(yaw) >= -1e-4;
	const k = Math.min(1, dt * 10);
	return { speed: prev.speed + (speed - prev.speed) * k, forward };
}

/** how fast the walk clip plays for a ground speed: 0 standing, the clip's own pace at its
 * own speed, clamped so a slow-mo crawl or a shove never runs it absurdly
 * @param {number} speed @param {number} clipSpeed @param {number} scale the figure's size vs the clip's */
export function walkRate(speed, clipSpeed, scale = 1) {
	if (!(speed > 0.03) || !(clipSpeed > 0)) return 0;
	return Math.min(2.5, Math.max(0.2, speed / (clipSpeed * (scale > 0 ? scale : 1))));
}

/** where a stashed or unused enemy is: under the arena (the engine parks them at -30) */
export const UNDERGROUND = -10;

/**
 * Should the figure show? Only while its enemy object is shown and above the ground — or while
 * it plays its death where it fell.
 * @param {{visible: boolean, y: number, dying: boolean}} s
 */
export function figureShown(s) {
	if (s.dying) return true;
	return !!s.visible && s.y > UNDERGROUND;
}

/** seconds a death plays before the figure sinks away (the clip may be longer) */
export const DEATH_SECONDS = 1.4;
/** the sink after the death: a figure slides under the floor, then hides */
export const SINK = Object.freeze({ seconds: 0.5, depth: 0.9 });

/** how far under the floor a dying figure is `age` seconds after its death @param {number} age */
export function sinkDepth(age) {
	const t = age - DEATH_SECONDS;
	if (!(t > 0)) return 0;
	return Math.min(1, t / SINK.seconds) * SINK.depth;
}

/** is a death over (the figure gone, the enemy's next life free to take it)? @param {number} age */
export const deathOver = (age) => !(age < DEATH_SECONDS + SINK.seconds);

// ---- the guns ------------------------------------------------------------------------------

/**
 * How each GLB gun sits in the hand, in its OWN post-processed frame (barrel down -Z, metres):
 * `grip` is the point the hand holds (the top of the grip, under the slide) — it goes to the
 * origin the weapon places at the controller; `muzzle` is the barrel's tip; `cell` is where the
 * accent glow (the Beam's heat, the charge) sits.
 */
export const GUN_FITS = Object.freeze({
	// measured on the post-processed GLBs (30 cm long, centred): side renders + the vertex profile
	blaster: Object.freeze({ grip: [0, -0.012, 0.065], muzzle: [0, 0.03, -0.152], cell: [0, 0.018, -0.068], cellSize: [0.069, 0.008, 0.07], cellShape: 'box' }),
	// the Scatter's cell is its orange energy cell under the barrels, at the pump
	scatter: Object.freeze({ grip: [0, 0, 0.095], muzzle: [0, 0.023, -0.152], cell: [0, 0.004, 0], cellSize: [0.031, 0.017, 0.024], cellShape: 'box' }),
	// the Beam's glow IS its emitter orb: a glowing ball over the painted one
	beam: Object.freeze({ grip: [0, -0.008, 0.115], muzzle: [0, 0.03, -0.158], cell: [0, 0.03, -0.142], cellSize: [0.032, 0.032, 0.032], cellShape: 'ball' })
});

/** a gun's fit, the Blaster's for an unknown id @param {string} id */
export const gunFit = (id) => /** @type {any} */ (GUN_FITS)[id] ?? GUN_FITS.blaster;

/** the grip-relative position of a point of the gun (the model is shifted so the grip is the
 * origin) @param {number[]} point @param {number[]} grip */
export const fromGrip = (point, grip) => [point[0] - grip[0], point[1] - grip[1], point[2] - grip[2]];
