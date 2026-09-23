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
	wallRoughness: 0.78,
	/** flames: emissive over 1 so the bloom pass picks them up */
	flameIntensity: 3.2,
	/** point lights per floor — CAPPED (the frame budget). P4: four, and in play they follow the
	 * player to the nearest torches, so four light the torches around you (paired fps runs: 5 fell under 90%) */
	lightBudget: 4,
	lightIntensity: 18,
	lightDistance: 10,
	/** P4: the ceiling (play only — a single-sided plane facing DOWN: invisible from above, a dark
	 * vault from inside) and the torch props */
	ceilingY: 2.32,
	vaultMargin: 30,
	ceilingTint: 0x2a2622,
	textureSize: 128,
	/** seconds between re-assigning the capped lights to the torches nearest the player */
	lightReassign: 0.25,
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

/** a small deterministic PRNG (mulberry32) @param {number} seed */
function rng(seed) {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/**
 * P4: the stone LAYOUT a texture is painted from — pure: courses of uneven height, each with its
 * own joints (uneven stone lengths, a random offset, wrapping at the tile edge) and a shade per
 * stone. Returned with the generator state so the painter continues the same sequence.
 * @param {'brick' | 'flag'} kind @param {number} size @param {number} seed
 */
export function stoneLayout(kind, size, seed) {
	const r = rng(seed ^ (kind === 'brick' ? 0xb1 : 0xf1));
	const rows = kind === 'brick' ? 4 : 3;
	const cuts = (/** @type {number} */ n, /** @type {number} */ jitter) => {
		const c = [0];
		for (let i = 1; i < n; i++) c.push(Math.round((i / n + ((r() - 0.5) * jitter) / n) * size));
		c.push(size);
		return c;
	};
	const rowCut = cuts(rows, kind === 'brick' ? 0.3 : 0.5);
	/** per course: its joint positions (wrapping) and a shade per stone */
	const course = Array.from({ length: rows }, () => {
		const n = kind === 'brick' ? 2 + (r() < 0.5 ? 1 : 0) : 3;
		const joints = cuts(n, 0.6).slice(0, -1);
		const offset = Math.floor(r() * size);
		return { joints: joints.map((j) => (j + offset) % size).sort((a, b) => a - b), shade: joints.map(() => 0.62 + r() * 0.38) };
	});
	return { r, rowCut, course };
}

/**
 * P4: a procedural STONE texture, pure (RGBA bytes, grey — the instance colour carries the hue):
 * 'brick' = coursed blocks of UNEVEN length with each course's joints at its own offset (walls),
 * 'flag' = irregular flagstones (floors, the vault). Each stone its own shade, speckle, a
 * large-scale grime blotch, thin recessed mortar — the same bytes serve as the map and the bump
 * map. Deterministic: every peer paints the same stone.
 * @param {'brick' | 'flag'} kind @param {number} [size] @param {number} [seed]
 * @returns {Uint8Array} size * size * 4
 */
export function stoneTexture(kind, size = LOOK.textureSize, seed = 0x57013) {
	const { r, rowCut, course } = stoneLayout(kind, size, seed);
	const out = new Uint8Array(size * size * 4);
	// a coarse value-noise field for grime (8 x 8 cells, wrapping, bilinear)
	const G = 8;
	const grime = Array.from({ length: G * G }, () => r());
	const blotch = (/** @type {number} */ x, /** @type {number} */ y) => {
		const gx = (x / size) * G, gy = (y / size) * G;
		const x0 = Math.floor(gx), y0 = Math.floor(gy), fx = gx - x0, fy = gy - y0;
		const at = (/** @type {number} */ i, /** @type {number} */ j) => grime[((j % G) + G) % G * G + (((i % G) + G) % G)];
		return (at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx) * (1 - fy) + (at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx) * fy;
	};
	const mortar = Math.max(1, Math.round(size / 64));
	for (let y = 0; y < size; y++) {
		let row = 0;
		while (y >= rowCut[row + 1]) row++;
		const c = course[row];
		const dy = Math.min(y - rowCut[row], rowCut[row + 1] - 1 - y);
		for (let x = 0; x < size; x++) {
			// which stone of this course (joints wrap around the tile edge)
			let k = c.joints.length - 1;
			for (let j = 0; j < c.joints.length; j++) if (x >= c.joints[j]) k = j;
			let dx = size;
			for (const j of c.joints) dx = Math.min(dx, Math.abs(x - j), size - Math.abs(x - j));
			const edge = Math.min(dx, dy);
			let v;
			if (edge < mortar) v = 0.5 + r() * 0.08;
			else {
				v = c.shade[k];
				v *= 1 - Math.max(0, 2 - (edge - mortar)) * 0.06; // a worn arris
				v *= 0.9 + r() * 0.16; // speckle
			}
			v *= 0.82 + blotch(x, y) * 0.3; // grime
			const b = Math.max(0, Math.min(255, Math.round(v * 255)));
			const i = (y * size + x) * 4;
			out[i] = out[i + 1] = out[i + 2] = b;
			out[i + 3] = 255;
		}
	}
	return out;
}
