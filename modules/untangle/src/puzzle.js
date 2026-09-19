// The PURE puzzle — no THREE, no DOM, no api (node-tested in test/puzzle.test.mjs).
//
// The puzzle is a pure function of the level number (seeded RNG), so every peer
// generates the identical graph: determinism IS the netcode. Positions are in BOARD
// units, the unit disc [-1, 1]² — the renderer scales them by the board radius, so a
// radius change (the utboard node) re-renders without touching the replicated model.

/** @param {number} seed */
export function mulberry32(seed) {
	let t = seed >>> 0;
	return function () {
		t = (t + 0x6d2b79f5) >>> 0;
		let r = Math.imul(t ^ (t >>> 15), t | 1);
		r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
		return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
	};
}

/**
 * Two chords of a circle cross iff exactly one endpoint of one lies strictly between
 * the endpoints of the other, walking the circle. @param {number} n ring size
 */
export function chordsCross(a, b, c, d, n) {
	const between = (x, lo, hi) => {
		const span = (hi - lo + n) % n;
		const off = (x - lo + n) % n;
		return off > 0 && off < span;
	};
	if (a === c || a === d || b === c || b === d) return false; // shared endpoint
	return between(c, a, b) !== between(d, a, b);
}

/**
 * Generate level `lvl`: a guaranteed-solvable graph (the ring plus greedily added
 * non-crossing chords — the circle layout IS a planar embedding) with SCRAMBLED
 * positions in the unit disc. @param {number} lvl
 * @returns {{n: number, edges: number[][], positions: number[][]}}
 */
export function generate(lvl) {
	const rand = mulberry32(0x9e3779b9 ^ (lvl * 2654435761));
	const n = Math.min(5 + lvl, 16); // difficulty scales, capped
	const edges = [];
	for (let i = 0; i < n; i++) edges.push([i, (i + 1) % n]);
	const chords = [];
	for (let i = 0; i < n; i++) for (let j = i + 2; j < n; j++) if (!(i === 0 && j === n - 1)) chords.push([i, j]);
	for (let i = chords.length - 1; i > 0; i--) {
		const k = Math.floor(rand() * (i + 1));
		const swap = chords[i];
		chords[i] = chords[k];
		chords[k] = swap;
	}
	const wanted = Math.floor(n * 0.8);
	let added = 0;
	for (const [a, b] of chords) {
		if (added >= wanted) break;
		if (edges.some(([c, d]) => chordsCross(a, b, c, d, n))) continue;
		edges.push([a, b]);
		added++;
	}
	// scramble positions in the disc (0.9 keeps the dots clear of the rim)
	const positions = [];
	for (let i = 0; i < n; i++) {
		const angle = rand() * Math.PI * 2;
		const radius = Math.sqrt(rand()) * 0.9;
		positions.push([Math.cos(angle) * radius, Math.sin(angle) * radius]);
	}
	return { n, edges, positions };
}

/** proper segment intersection (shared endpoints excluded by the caller) */
export function segsCross(p1, p2, p3, p4) {
	const d = (a, b, c) => (c[0] - a[0]) * (b[1] - a[1]) - (b[0] - a[0]) * (c[1] - a[1]);
	const d1 = d(p3, p4, p1);
	const d2 = d(p3, p4, p2);
	const d3 = d(p1, p2, p3);
	const d4 = d(p1, p2, p4);
	return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

/** per-edge crossing counts on CURRENT positions @param {number[][]} positions @param {number[][]} edges */
export function edgeCrossings(positions, edges) {
	const counts = edges.map(() => 0);
	for (let i = 0; i < edges.length; i++) {
		for (let j = i + 1; j < edges.length; j++) {
			const [a, b] = edges[i];
			const [c, d] = edges[j];
			if (a === c || a === d || b === c || b === d) continue;
			if (segsCross(positions[a], positions[b], positions[c], positions[d])) {
				counts[i]++;
				counts[j]++;
			}
		}
	}
	return counts;
}

/** total crossings (each pair once) @param {number[]} counts */
export function totalCrossings(counts) {
	return counts.reduce((sum, c) => sum + c, 0) / 2;
}

/** the solution layout: n dots on the unit circle (the planar embedding generate() built from) */
export function solvedPositions(n, scale = 0.85) {
	const out = [];
	for (let i = 0; i < n; i++) {
		const angle = (i / n) * Math.PI * 2;
		out.push([Math.cos(angle) * scale, Math.sin(angle) * scale]);
	}
	return out;
}

/** clamp a board-unit position into the disc's bounding square @param {number[]} p */
export function clampToBoard(p) {
	return [Math.max(-1, Math.min(1, p[0])), Math.max(-1, Math.min(1, p[1]))];
}

export const DEFAULT_BOARD = { level: 1, radius: 1.1, boardY: 1.6, x: 0, z: 0, yaw: 0, autoAdvance: true };
