// The globe's pure geometry — run WITHOUT the app.
import {
	arcIntersections,
	arcsCross,
	arcPoints,
	arcSegments,
	edgeCrossings3,
	generate3,
	solvedSphere,
	fromDisc,
	dot,
	len,
	normalize,
	ANTIPODAL_GEN,
	MIN_ANGLE
} from '../src/sphere.js';
import { generate, minStartCrossings } from '../src/puzzle.js';

const rad = (d) => (d * Math.PI) / 180;
/** latitude / longitude in degrees -> a unit vector (north pole = +Y) */
const ll = (lat, lon) => [Math.cos(rad(lat)) * Math.cos(rad(lon)), Math.sin(rad(lat)), Math.cos(rad(lat)) * Math.sin(rad(lon))];
const total = (counts) => counts.reduce((s, c) => s + c, 0) / 2;

export function run(check) {
	// ---- the crossing test ----
	// two meridian arcs that both pass OVER THE POLE (60N at opposite longitudes) cross exactly
	// once, at the pole — the antipodal candidate (the south pole) is on neither arc
	const m = arcIntersections(ll(60, 0), ll(60, 180), ll(60, 90), ll(60, 270));
	check(Array.isArray(m) && m.length === 1 && Math.abs(m[0][1] - 1) < 1e-9, 'two meridians over the pole cross ONCE, at the pole (' + JSON.stringify(m) + ')');
	check(arcsCross(ll(-30, 10), ll(30, 10), ll(0, -20), ll(0, 40)) === true, 'a meridian arc and an equator arc cross');
	check(arcsCross(ll(-30, 10), ll(30, 10), ll(0, 20), ll(0, 40)) === false, '...but not when the equator arc stops short of it');
	check(arcsCross(ll(0, 0), ll(0, 60), ll(10, 90), ll(40, 170)) === false, 'two arcs on different parts of the globe do not cross');
	// ONE great circle (the equator): overlapping stretches collide, disjoint ones do not
	check(arcIntersections(ll(0, 0), ll(0, 60), ll(0, 30), ll(0, 90)) === 'overlap', 'arcs on one great circle that OVERLAP count as crossing');
	check(arcsCross(ll(0, 0), ll(0, 30), ll(0, 40), ll(0, 80)) === false, 'arcs on one great circle that do not overlap do not cross');
	check(arcIntersections(ll(0, 60), ll(0, 0), ll(0, 90), ll(0, 30)) === 'overlap', 'overlap is found whichever way each arc runs');
	check(arcsCross(ll(0, 0), ll(0, 60), ll(0, 60), ll(0, 100)) === false, 'arcs touching end to end on one circle do not cross');
	// shared endpoints are the caller's to skip; the per-edge counter does
	const tri = [ll(0, 0), ll(0, 60), ll(40, 30)];
	check(total(edgeCrossings3(tri, [[0, 1], [1, 2], [2, 0]])) === 0, 'a triangle (edges sharing dots) has no crossings');
	const x = [ll(-20, 0), ll(20, 40), ll(20, 0), ll(-20, 40)];
	check(total(edgeCrossings3(x, [[0, 1], [2, 3]])) === 1, 'an X of two arcs counts one crossing');
	// a (near-)antipodal edge is degenerate on the board: it counts, so it can never be "solved"
	const anti = [[1, 0, 0], [-1, 0, 1e-4].map((v, i, a) => v / len(a)), [0, 1, 0]];
	check(total(edgeCrossings3(anti, [[0, 1]])) === 1, 'an antipodal edge counts as crossing (no unique minor arc)');

	// ---- tessellation ----
	const pts = arcPoints(ll(10, 0), ll(50, 120), 24);
	check(pts.length === 25 && pts.every((p) => Math.abs(len(p) - 1) < 1e-9), 'a tessellated arc stays on the unit sphere (25 points)');
	check(dot(pts[0], ll(10, 0)) > 1 - 1e-12 && dot(pts[24], ll(50, 120)) > 1 - 1e-12, '...and starts and ends on its dots');
	check(arcSegments(ll(0, 0), ll(0, 90)) >= 13 && arcSegments(ll(0, 0), ll(0, 1)) === 2, 'segments scale with the arc length (~7 degrees each, at least 2)');

	// ---- the levels ----
	let solvable = 0, tangled = 0, refused = 0, apart = 0, sameGraph = 0, onSphere = 0;
	for (let lvl = 1; lvl <= 30; lvl++) {
		const g3 = generate3(lvl);
		const g2 = generate(lvl);
		if (JSON.stringify(g3.edges) === JSON.stringify(g2.edges) && g3.n === g2.n) sameGraph++;
		if (total(edgeCrossings3(solvedSphere(g3.n), g3.edges)) === 0) solvable++;
		if (total(edgeCrossings3(g3.positions, g3.edges)) >= minStartCrossings(lvl)) tangled++;
		if (g3.edges.every(([a, b]) => dot(g3.positions[a], g3.positions[b]) >= ANTIPODAL_GEN)) refused++;
		if (g3.positions.every((p, i) => g3.positions.every((q, j) => i === j || dot(p, q) <= Math.cos(MIN_ANGLE) + 1e-9))) apart++;
		if (g3.positions.every((p) => Math.abs(len(p) - 1) < 1e-9)) onSphere++;
	}
	check(sameGraph === 30, 'levels 1-30: the globe plays the SAME graph as the 2D level (' + sameGraph + '/30)');
	check(solvable === 30, 'levels 1-30: the gnomonic image of the ring layout has zero arc crossings (' + solvable + '/30)');
	check(tangled === 30, 'levels 1-30: every globe scramble starts tangled (' + tangled + '/30)');
	check(refused === 30, 'levels 1-30: the generator refuses (near-)antipodal edge ends (' + refused + '/30)');
	check(apart >= 29, 'levels 1-30: scrambled dots keep their minimum angle (' + apart + '/30)');
	check(onSphere === 30, 'levels 1-30: every dot is a unit vector');
	check(JSON.stringify(generate3(7)) === JSON.stringify(generate3(7)), 'generate3 is deterministic');
	const front = fromDisc([0.85, 0]);
	check(front[2] > 0.6 && Math.abs(len(front) - 1) < 1e-12 && JSON.stringify(normalize([0, 0, 0])) === '[0,0,1]', 'the disc maps onto the FRONT hemisphere (+Z faces the player)');
}
