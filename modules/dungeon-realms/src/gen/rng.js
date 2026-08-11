// Stage 1 — deterministic RNG. mulberry32 threaded explicitly through every
// stage; forks derive an independent stream per stage label so inserting a
// draw in one stage never reshuffles another (spec: GENERATOR PIPELINE 1,
// NON-NEGOTIABLE 1). No Math.random, no Date.now, and no transcendentals
// (sin/cos/log are NOT pinned by IEEE-754 across JS engines — the scatter
// stage samples the unit disc by rejection instead of by angle).

/** FNV-1a over a string, folded with a seed — the fork/floor-seed derivation.
 * @param {number} seed @param {...(string | number)} parts */
export function hash32(seed, ...parts) {
	let h = 0x811c9dc5 ^ (seed >>> 0);
	for (const part of parts) {
		const s = String(part);
		for (let i = 0; i < s.length; i++) {
			h ^= s.charCodeAt(i);
			h = Math.imul(h, 0x01000193);
		}
		h ^= 0x9e3779b9;
		h = Math.imul(h, 0x01000193);
	}
	return h >>> 0;
}

/** @param {number} seed @returns {import('./types').Rng} */
export function makeRng(seed) {
	let a = seed >>> 0;
	const next = () => {
		a += 0x6d2b79f5;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
	const rng = {
		seed: seed >>> 0,
		/** uniform [0,1) */
		next,
		/** uniform [a,b) @param {number} a @param {number} b */
		float: (a2, b2) => a2 + next() * (b2 - a2),
		/** integer [a,b] inclusive @param {number} a @param {number} b */
		int: (a2, b2) => a2 + Math.floor(next() * (b2 - a2 + 1)),
		/** @template T @param {T[]} arr @returns {T} */
		pick: (arr) => arr[Math.floor(next() * arr.length)],
		/** @param {number} p */
		chance: (p) => next() < p,
		/** independent child stream — same label, same stream, always @param {string} label */
		fork: (label) => makeRng(hash32(seed, label))
	};
	return rng;
}

/** FNV-1a checksum over a byte array (grid checksums). @param {Uint8Array | Int16Array} arr */
export function checksum32(arr, h = 0x811c9dc5) {
	for (let i = 0; i < arr.length; i++) {
		h ^= arr[i] & 0xff;
		h = Math.imul(h, 0x01000193);
		h ^= (arr[i] >> 8) & 0xff;
		h = Math.imul(h, 0x01000193);
	}
	return h >>> 0;
}
