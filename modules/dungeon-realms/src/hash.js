// FNV-1a folded with a seed — the menu's seed picker (moved with the generator; the
// Kit's rng.js is the same function, and two modules cannot share code).
/** @param {number} seed @param {...(string | number)} parts */
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
