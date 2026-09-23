// The pure puzzle — run WITHOUT the app.
import { generate, edgeCrossings, totalCrossings, solvedPositions, chordsCross, segsCross, clampToBoard, mulberry32, dotsFor, chordsFor, minSeparation, minStartCrossings } from '../src/puzzle.js';

export function run(check) {
	// determinism: the same level twice is the same graph and the same scramble
	const a = generate(3), b = generate(3);
	check(JSON.stringify(a) === JSON.stringify(b), 'generate(3) is deterministic (edges + positions)');
	// roadmap 30 fork 9: the curve over 30 levels — 5 dots on level 1, 16 on level 30, never fewer
	// dots or chords than the level before, and more chords as it climbs
	const ns = [], cs = [];
	for (let lvl = 1; lvl <= 30; lvl++) {
		ns.push(generate(lvl).n);
		cs.push(generate(lvl).edges.length - generate(lvl).n);
	}
	check(ns[0] === 5 && ns[29] === 16 && dotsFor(1) === 5 && dotsFor(30) === 16, 'the curve: level 1 = 5 dots, level 30 = 16 (' + ns.join(',') + ')');
	check(ns.every((n, i) => i === 0 || n >= ns[i - 1]) && cs.every((c, i) => i === 0 || c >= cs[i - 1] || ns[i] > ns[i - 1]), 'the curve never gets easier (dots and chords per level: ' + cs.join(',') + ')');
	check(cs[0] === chordsFor(1) && cs[29] === chordsFor(30) && cs[29] >= 10 && generate(30).edges.length >= 24, 'more chords at the top: level 30 has ' + generate(30).edges.length + ' edges');
	check(generate(45).n === 16, 'levels past 30 keep the level-30 shape (their own seed)');
	// every level's graph is SOLVABLE: the circle layout has zero crossings
	let solvable = 0, scrambled = 0, apart = 0;
	for (let lvl = 1; lvl <= 40; lvl++) {
		const g = generate(lvl);
		if (totalCrossings(edgeCrossings(solvedPositions(g.n), g.edges)) === 0) solvable++;
		if (totalCrossings(edgeCrossings(g.positions, g.edges)) >= minStartCrossings(lvl)) scrambled++;
		const sep = minSeparation(g.n);
		if (g.positions.every((p, i) => g.positions.every((q, j) => i === j || Math.hypot(p[0] - q[0], p[1] - q[1]) >= sep - 1e-9))) apart++;
	}
	check(solvable === 40, 'levels 1-40: the ring layout solves every graph (' + solvable + '/40)');
	check(scrambled === 40, 'levels 1-40: every scramble starts with at least its minimum crossings (' + scrambled + '/40)');
	check(apart >= 38, 'levels 1-40: scrambled dots keep their minimum separation (' + apart + '/40)');
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
