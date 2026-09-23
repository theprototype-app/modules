// The Kit's LOOK, as numbers — pure (no THREE), node-tested (test/look.test.mjs). 30-visuals-
// mod: the generator's themes stay the data they are (a theme is part of the published play
// contract and of every saved campaign); the RENDERER lifts them into a torch-lit dungeon that
// reads on a real display instead of black walls.

export const LOOK = {
	/** the floor tiles' TOP, a hair above the editor grid (which draws at y = 0) */
	floorTop: 0.015,
	/** lifts applied to the theme tints (the themes were authored for a black void) */
	floorLift: 1.5,
	wallLift: 1.9,
	/** every theme tint is pulled this far toward a warm stone grey before the lift, so a crypt
	 * reads as stone lit by torches rather than a flat green-teal */
	stone: 0x8c8274,
	stoneMix: 0.45,
	floorRoughness: 0.82,
	wallRoughness: 0.78,
	/** flames: emissive over 1 so the bloom pass picks them up */
	flameIntensity: 3.2,
	/** point lights per floor — CAPPED (the frame budget); raised brightness, same count */
	lightBudget: 8,
	lightIntensity: 14,
	lightDistance: 14,
	/** minimum Rec.709 luma (0..1, sRGB) a lifted wall tint must reach */
	minWallLuma: 0.35
};

/** Rec.709 luma of an sRGB hex colour, 0..1 @param {number} hex */
export function luma(hex) {
	const r = ((hex >> 16) & 255) / 255;
	const g = ((hex >> 8) & 255) / 255;
	const b = (hex & 255) / 255;
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** `hex` pulled toward `to` by `t` (0..1), per sRGB channel @param {number} hex @param {number} to @param {number} t */
export function mix(hex, to, t) {
	const c = (/** @type {number} */ shift) => Math.round(((hex >> shift) & 255) * (1 - t) + ((to >> shift) & 255) * t);
	return (c(16) << 16) | (c(8) << 8) | c(0);
}

/** a theme tint as the renderer paints it: warmed toward stone, then lifted @param {number} hex @param {number} k */
export function stoneTint(hex, k) {
	return lift(mix(hex, LOOK.stone, LOOK.stoneMix), k);
}

/** A tint lifted by `k` in sRGB, each channel clamped to 255. @param {number} hex @param {number} k */
export function lift(hex, k) {
	const c = (/** @type {number} */ shift) => Math.min(255, Math.round(((hex >> shift) & 255) * k));
	return (c(16) << 16) | (c(8) << 8) | c(0);
}

/**
 * Which flames get one of the CAPPED point lights: the `near` closest to `focus` (the entrance
 * hall, where every player spawns — the first thing anyone sees is torch-lit), then an even
 * spread over the rest. Pure, deterministic: indices into `spots`, exactly min(budget, spots).
 * @param {{x: number, z: number}[]} spots @param {{x: number, z: number} | null} focus
 * @param {number} budget @param {number} [near]
 */
export function pickLights(spots, focus, budget, near = 3) {
	if (budget <= 0 || !spots.length) return [];
	const order = spots.map((_, i) => i);
	const first = focus
		? [...order].sort((a, b) => Math.hypot(spots[a].x - focus.x, spots[a].z - focus.z) - Math.hypot(spots[b].x - focus.x, spots[b].z - focus.z) || a - b).slice(0, Math.min(near, budget))
		: [];
	const rest = order.filter((i) => !first.includes(i));
	// EXACTLY min(budget, spots) lights: a floor that changed the point-light count would make
	// every lit material in the scene recompile on travel (a visible hitch; seconds in software GL)
	const left = Math.min(budget - first.length, rest.length);
	const spread = [];
	for (let k = 0; k < left; k++) spread.push(rest[Math.floor((k * rest.length) / left)]);
	return [...first, ...spread];
}

/** How far a flame instance stretches at `time` — a flicker per torch, deterministic (the
 * same on every peer, derived from time and the torch's own position). @param {number} time
 * @param {number} x @param {number} z @returns {number} a y-scale around 1 */
export function flameFlicker(time, x, z) {
	return 1 + Math.sin(time * 11 + x * 2.3) * 0.12 + Math.sin(time * 27 + z * 3.1) * 0.07;
}
