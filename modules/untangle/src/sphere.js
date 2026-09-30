// THE GLOBE — the 3D mode's pure geometry (no THREE, no DOM; test/sphere.test.mjs).
//
// Fork 8 (roadmap 30): the same deterministic graph as the 2D level, on a SPHERE. Dots are
// unit vectors, edges are the MINOR great-circle arcs between them, and a crossing is a
// spherical segment intersection — well defined, unlike free 3D where two segments almost
// never meet.
//
// Solvable by construction: the 2D level is generated from a planar straight-line
// embedding (the ring layout). The inverse GNOMONIC projection (the tangent plane at +Z
// seen from the sphere's centre) maps straight lines to great circles, so that embedding
// lands on the front hemisphere with zero arc crossings. The level's START is then a
// scramble over the whole sphere (some dots begin on the far side — rotate the globe).
//
// An arc between (near-)antipodal dots has no unique minor arc. The generator REFUSES such a
// scramble; on the board a player can still drag two ends apart that far, and such an edge
// counts as crossing (a board is never "solved" with an undefined edge).

import { generate, mulberry32, solvedPositions, minStartCrossings } from './puzzle.js';

export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const len = (a) => Math.hypot(a[0], a[1], a[2]);
/** @param {number[]} a @returns {number[]} */
export function normalize(a) {
	const l = len(a);
	return l > 1e-12 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 1];
}

/** cos of the widest arc the generator accepts (~168°); an edge wider than this is "antipodal" */
export const ANTIPODAL_GEN = -0.978;
/** cos below which an edge on the board is degenerate (~176°): it counts as a crossing */
export const ANTIPODAL_PLAY = -0.998;

/** a board-disc point [x, y] -> the front hemisphere (inverse gnomonic around +Z) */
export function fromDisc(p, k = 1.15) {
	return normalize([p[0] * k, p[1] * k, 1]);
}

/** the solved layout of an n-dot level on the sphere (zero arc crossings) */
export function solvedSphere(n) {
	return solvedPositions(n).map((p) => fromDisc(p));
}

/** points along the minor arc a->b (both ends included), `segments` pieces */
export function arcPoints(a, b, segments) {
	const out = [];
	const cosT = Math.max(-1, Math.min(1, dot(a, b)));
	const theta = Math.acos(cosT);
	const s = Math.sin(theta);
	for (let k = 0; k <= segments; k++) {
		const t = k / segments;
		if (s < 1e-6) {
			out.push(normalize([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]));
			continue;
		}
		const wa = Math.sin((1 - t) * theta) / s;
		const wb = Math.sin(t * theta) / s;
		out.push([a[0] * wa + b[0] * wb, a[1] * wa + b[1] * wb, a[2] * wa + b[2] * wb]);
	}
	return out;
}

/** how many straight pieces draw the arc a->b smoothly (about one per 7°) */
export function arcSegments(a, b) {
	return Math.max(2, Math.ceil(Math.acos(Math.max(-1, Math.min(1, dot(a, b)))) / 0.12));
}

/** q strictly inside the minor arc a->b whose (unnormalized) pole is n = a x b */
function strictlyOn(q, a, b, n) {
	const eps = 1e-12 * dot(n, n);
	return dot(cross(a, q), n) > eps && dot(cross(q, b), n) > eps;
}

/**
 * Where the minor arcs a-b and c-d meet: [] (none), [point] (a proper crossing), or
 * 'overlap' when both lie on ONE great circle and share a stretch (that is a collision on
 * the board, so it counts as crossing). Endpoints touching do not count (the caller skips
 * edges that share a dot, as the 2D test does).
 * @returns {number[][] | 'overlap'}
 */
export function arcIntersections(a, b, c, d) {
	const n1 = cross(a, b);
	const n2 = cross(c, d);
	const l1 = len(n1);
	const l2 = len(n2);
	if (l1 < 1e-12 || l2 < 1e-12) return [];
	const L = cross(n1, n2);
	const ll = len(L);
	if (ll < 1e-9 * l1 * l2) return sameCircleOverlap(a, b, c, d, n1) ? 'overlap' : [];
	const p = [L[0] / ll, L[1] / ll, L[2] / ll];
	const out = [];
	for (const q of [p, [-p[0], -p[1], -p[2]]]) if (strictlyOn(q, a, b, n1) && strictlyOn(q, c, d, n2)) out.push(q);
	return out;
}

/** two arcs on ONE great circle: do they share a stretch of positive length? */
function sameCircleOverlap(a, b, c, d, n1) {
	const u = a;
	const w = normalize(cross(normalize(n1), a));
	const angle = (x) => Math.atan2(dot(x, w), dot(x, u));
	const tb = angle(b); // in (0, pi) for a minor arc
	const tc = angle(c);
	let delta = angle(d) - tc;
	while (delta > Math.PI) delta -= 2 * Math.PI;
	while (delta <= -Math.PI) delta += 2 * Math.PI;
	const lo = Math.min(tc, tc + delta);
	const hi = Math.max(tc, tc + delta);
	for (const k of [-2 * Math.PI, 0, 2 * Math.PI]) {
		if (Math.min(hi + k, tb) - Math.max(lo + k, 0) > 1e-9) return true;
	}
	return false;
}

/** do the minor arcs a-b and c-d cross (or overlap)? */
export function arcsCross(a, b, c, d) {
	const hit = arcIntersections(a, b, c, d);
	return hit === 'overlap' || hit.length > 0;
}

/** per-edge crossing counts on the sphere (a degenerate, near-antipodal edge counts as crossing) */
export function edgeCrossings3(positions, edges) {
	const counts = edges.map(() => 0);
	const degenerate = edges.map(([a, b]) => dot(positions[a], positions[b]) < ANTIPODAL_PLAY);
	degenerate.forEach((bad, i) => {
		if (bad) counts[i] += 2; // one "crossing" with itself: totalCrossings halves the sum
	});
	for (let i = 0; i < edges.length; i++) {
		if (degenerate[i]) continue;
		for (let j = i + 1; j < edges.length; j++) {
			if (degenerate[j]) continue;
			const [a, b] = edges[i];
			const [c, d] = edges[j];
			if (a === c || a === d || b === c || b === d) continue;
			if (arcsCross(positions[a], positions[b], positions[c], positions[d])) {
				counts[i]++;
				counts[j]++;
			}
		}
	}
	return counts;
}

/** the minimum angle between two scrambled dots (radians) */
export const MIN_ANGLE = 0.36;

/**
 * Level `lvl` on the globe: the 2D level's graph (the same edges — fork 8), dots scrambled
 * over the whole sphere from their own seeded stream, kept MIN_ANGLE apart, no edge wider
 * than ANTIPODAL_GEN, and at least the level's minimum crossings to start.
 * @param {number} lvl
 * @returns {{n: number, edges: number[][], positions: number[][]}}
 */
export function generate3(lvl) {
	const g = generate(lvl);
	const rand = mulberry32((0x51ed270b ^ (lvl * 2246822519)) >>> 0);
	const need = minStartCrossings(lvl);
	const minCos = Math.cos(MIN_ANGLE);
	let best = null;
	let bestCount = -1;
	for (let attempt = 0; attempt < 40; attempt++) {
		const positions = [];
		for (let i = 0; i < g.n; i++) {
			let p = null;
			for (let tries = 0; tries < 80; tries++) {
				const z = rand() * 2 - 1;
				const phi = rand() * Math.PI * 2;
				const r = Math.sqrt(Math.max(0, 1 - z * z));
				p = [Math.cos(phi) * r, Math.sin(phi) * r, z];
				const q = p;
				if (positions.every((o) => dot(o, q) <= minCos)) break;
			}
			positions.push(/** @type {number[]} */ (p));
		}
		// REFUSED: an edge whose ends are (near-)antipodal has no unique arc
		if (g.edges.some(([a, b]) => dot(positions[a], positions[b]) < ANTIPODAL_GEN)) continue;
		const count = edgeCrossings3(positions, g.edges).reduce((s, c) => s + c, 0) / 2;
		if (count >= need) return { n: g.n, edges: g.edges, positions };
		if (count > bestCount) {
			bestCount = count;
			best = positions;
		}
	}
	return { n: g.n, edges: g.edges, positions: /** @type {number[][]} */ (best ?? solvedSphere(g.n)) };
}
