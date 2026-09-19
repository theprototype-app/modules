// The pure puzzle — run WITHOUT the app.
import { generate, edgeCrossings, totalCrossings, solvedPositions, chordsCross, segsCross, clampToBoard, mulberry32 } from '../src/puzzle.js';

export function run(check) {
	// determinism: the same level twice is the same graph and the same scramble
	const a = generate(3), b = generate(3);
	check(JSON.stringify(a) === JSON.stringify(b), 'generate(3) is deterministic (edges + positions)');
	check(generate(4).n === 9 && generate(20).n === 16, 'n = 5 + level, capped at 16');
	// every level's graph is SOLVABLE: the circle layout has zero crossings
	let solvable = 0, scrambled = 0;
	for (let lvl = 1; lvl <= 40; lvl++) {
		const g = generate(lvl);
		if (totalCrossings(edgeCrossings(solvedPositions(g.n), g.edges)) === 0) solvable++;
		if (totalCrossings(edgeCrossings(g.positions, g.edges)) > 0) scrambled++;
	}
	check(solvable === 40, 'levels 1-40: the ring layout solves every graph (' + solvable + '/40)');
	check(scrambled >= 38, 'levels 1-40: the scramble tangles almost every start (' + scrambled + '/40 start with crossings)');
	// the ring is always there (connectivity) and chords never share an endpoint pair twice
	const g = generate(7);
	const ring = g.edges.slice(0, g.n).every(([u, v], i) => u === i && v === (i + 1) % g.n);
	const keys = new Set(g.edges.map(([u, v]) => (u < v ? u + ':' + v : v + ':' + u)));
	check(ring && keys.size === g.edges.length, 'level 7: ring first, no duplicate edges (' + g.edges.length + ' edges)');
	// chord + segment crossing primitives
	check(chordsCross(0, 2, 1, 3, 6) === true && chordsCross(0, 2, 3, 5, 6) === false && chordsCross(0, 2, 2, 4, 6) === false, 'chordsCross: crossing, disjoint, shared endpoint');
	check(segsCross([0, 0], [1, 1], [0, 1], [1, 0]) === true && segsCross([0, 0], [1, 0], [0, 1], [1, 1]) === false, 'segsCross: an X crosses, parallels do not');
	// positions live in board units: the scramble stays inside the disc
	check(g.positions.every(([x, y]) => Math.hypot(x, y) <= 0.9 + 1e-9), 'scrambled positions stay within 0.9 of the unit disc');
	check(JSON.stringify(clampToBoard([3, -2])) === '[1,-1]' && JSON.stringify(clampToBoard([0.2, 0.3])) === '[0.2,0.3]', 'clampToBoard clamps to the unit square');
	// the RNG is the same mulberry32 the old module used (no Math.random anywhere)
	const r = mulberry32(42);
	check(Math.abs(r() - mulberry32(42)()) < 1e-12, 'mulberry32 is seed-deterministic');
}
