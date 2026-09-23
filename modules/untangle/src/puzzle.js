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

/** the difficulty curve is defined over levels 1..30 (roadmap 30, fork 9); higher levels
 * keep the level-30 shape with their own seed */
export const CURVE_LEVELS = 30;
const curveLevel = (/** @type {number} */ lvl) => Math.min(Math.max(1, Math.round(Number(lvl) || 1)), CURVE_LEVELS);

/** dots on level `lvl`: 5 on level 1, 16 on level 30 @param {number} lvl */
export function dotsFor(lvl) {
	return 5 + Math.round(((curveLevel(lvl) - 1) * 11) / (CURVE_LEVELS - 1));
}

/** chords (edges beyond the ring) on level `lvl`: a rising share of the n-3 a triangulation
 * allows — 35% on level 1, 80% on level 30 (16 dots: 10 chords, 26 edges) */
export function chordsFor(lvl, n = dotsFor(lvl)) {
	const t = (curveLevel(lvl) - 1) / (CURVE_LEVELS - 1);
	return Math.max(1, Math.min(n - 3, Math.round((n - 3) * (0.35 + 0.45 * t))));
}

/** the least crossings a fresh scramble must start with (an already-solved start is no level) */
export function minStartCrossings(lvl) {
	const l = curveLevel(lvl);
	return l <= 2 ? 1 : l <= 8 ? 2 : 3;
}

/**
 * Generate level `lvl`: a guaranteed-solvable graph (the ring plus greedily added
 * non-crossing chords — the circle layout IS a planar embedding) with SCRAMBLED
 * positions in the unit disc: dots kept apart (a scramble that stacks two dots hides an
 * edge) and at least `minStartCrossings` crossings, all from the one seeded stream.
 * @param {number} lvl
 * @returns {{n: number, edges: number[][], positions: number[][]}}
 */
export function generate(lvl) {
	const rand = mulberry32(0x9e3779b9 ^ (lvl * 2654435761));
	const n = dotsFor(lvl);
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
	const wanted = chordsFor(lvl, n);
	let added = 0;
	for (const [a, b] of chords) {
		if (added >= wanted) break;
		if (edges.some(([c, d]) => chordsCross(a, b, c, d, n))) continue;
		edges.push([a, b]);
		added++;
	}
	return { n, edges, positions: scramble(rand, n, edges, minStartCrossings(lvl)) };
}

/** the minimum distance between two scrambled dots, in board units */
export function minSeparation(n) {
	return Math.max(0.2, 0.42 - n * 0.014);
}

/**
 * Scramble n dots in the disc (0.9 keeps them clear of the rim), `minSeparation` apart,
 * until the start has at least `need` crossings (the best attempt otherwise).
 * @param {() => number} rand @param {number} n @param {number[][]} edges @param {number} need
 */
function scramble(rand, n, edges, need) {
	const sep = minSeparation(n);
	let best = null;
	let bestCount = -1;
	for (let attempt = 0; attempt < 24; attempt++) {
		const positions = [];
		for (let i = 0; i < n; i++) {
			let p = null;
			for (let tries = 0; tries < 60; tries++) {
				const angle = rand() * Math.PI * 2;
				const radius = Math.sqrt(rand()) * 0.9;
				p = [Math.cos(angle) * radius, Math.sin(angle) * radius];
				const q = p;
				if (positions.every((o) => Math.hypot(o[0] - q[0], o[1] - q[1]) >= sep)) break;
			}
			positions.push(/** @type {number[]} */ (p));
		}
		const count = totalCrossings(edgeCrossings(positions, edges));
		if (count >= need) return positions;
		if (count > bestCount) {
			bestCount = count;
			best = positions;
		}
	}
	return /** @type {number[][]} */ (best);
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
