// Stage-02 acceptance — runs WITHOUT the app: node modules/dungeon-realms/test/run.mjs
import { generateDungeon, validateDungeon, dungeonChecksum, FLOOR, WALL } from '../src/gen/dungeon.js';

export function run(check) {
	// 100-seed sweep: zero validation failures, zero re-roll exhaustion
	let rerolls = 0;
	let ok = 0;
	for (let seed = 1; seed <= 100; seed++) {
		try {
			const d = generateDungeon(seed, { roomCount: 34 });
			const failures = validateDungeon(d);
			if (failures.length === 0) ok++;
			else console.log('  seed ' + seed + ': ' + failures.join('; '));
			if (d.stats.attempts > 1) rerolls++;
		} catch (error) {
			console.log('  seed ' + seed + ' THREW: ' + error.message);
		}
	}
	check(ok === 100, '100-seed sweep: ' + ok + '/100 valid (' + rerolls + ' needed a re-roll)');

	// determinism: same seed => identical checksum across 3 runs
	const sums = [1, 2, 3].map(() => dungeonChecksum(generateDungeon(42, { roomCount: 40 })));
	check(sums[0] === sums[1] && sums[1] === sums[2], 'seed 42 checksum identical across 3 runs (' + sums[0] + ')');

	// different seeds => different checksums (sample 10)
	const distinct = new Set();
	for (let seed = 1; seed <= 10; seed++) distinct.add(dungeonChecksum(generateDungeon(seed)));
	check(distinct.size === 10, '10 seeds -> ' + distinct.size + ' distinct checksums');

	// structural guarantees across a sweep
	let bossDepthOk = 0, entranceOk = 0, notAdjacent = 0, leaves3 = 0, loops1 = 0;
	for (let seed = 1; seed <= 30; seed++) {
		const d = generateDungeon(seed, { roomCount: 40 });
		const boss = d.rooms.find((r) => r.type === 'boss');
		const entrance = d.rooms.find((r) => r.type === 'entrance');
		let maxBfs = 0;
		for (let i = 0; i < d.bfs.length; i++) if (d.bfs[i] > maxBfs) maxBfs = d.bfs[i];
		if (d.bfs[boss.cy * d.W + boss.cx] >= 0.6 * maxBfs) bossDepthOk++;
		if (entrance.degree === 1 || d.stats.entranceFallback) entranceOk++;
		if (!d.edges.some((e) => (e.a === d.entranceId && e.b === d.bossId) || (e.b === d.entranceId && e.a === d.bossId))) notAdjacent++;
		const leafCount = d.rooms.filter((r) => r.degree === 1).length;
		if (leafCount >= 3) leaves3++;
		if (d.edges.filter((e) => e.isLoop).length >= 1) loops1++;
	}
	check(bossDepthOk === 30, 'boss depth >= 60% max BFS on 30/30 seeds (' + bossDepthOk + ')');
	check(entranceOk === 30, 'entrance degree 1 (or flagged fallback) on 30/30 (' + entranceOk + ')');
	check(notAdjacent >= 28, 'entrance not boss-adjacent on ' + notAdjacent + '/30');
	check(leaves3 === 30, '>= 3 leaf rooms at 40 rooms on 30/30 (' + leaves3 + ')');
	check(loops1 === 30, 'cyclomatic number >= 1 on 30/30 (' + loops1 + ')');

	// placement legality: no prop/spawn/gem on wall/void/doorway
	{
		const d = generateDungeon(7, { roomCount: 40 });
		const doorways = new Set(d.doorways.map((c) => c.y * d.W + c.x));
		const badProps = d.props.filter((p) => {
			const i = p.y * d.W + p.x;
			if (p.kind === 'torch') return d.grid[i] !== WALL;
			return d.grid[i] !== FLOOR || doorways.has(i);
		});
		const badSpawns = d.spawns.filter((s) => d.grid[s.y * d.W + s.x] !== FLOOR || doorways.has(s.y * d.W + s.x));
		check(badProps.length === 0, 'all ' + d.props.length + ' props legally placed (' + badProps.length + ' bad)');
		check(badSpawns.length === 0, 'all ' + d.spawns.length + ' spawns legally placed');
		const gems = d.props.filter((p) => p.kind === 'gem');
		check(gems.length >= 4, 'gems placed: ' + gems.length + ' (>= 4)');
		const entranceGems = gems.filter((g) => d.rooms[g.roomId].type === 'entrance');
		check(entranceGems.length === 0, 'no gems in the entrance room');
	}

	// perf: 60-room generation median < 50 ms over 20 runs
	{
		const times = [];
		for (let i = 0; i < 20; i++) {
			const t0 = performance.now();
			generateDungeon(1000 + i, { roomCount: 60 });
			times.push(performance.now() - t0);
		}
		times.sort((a, b) => a - b);
		const median = times[10];
		const p95 = times[18];
		check(median < 50, '60-room generation median ' + median.toFixed(1) + 'ms (p95 ' + p95.toFixed(1) + 'ms) < 50ms');
	}

	// BFS field: -1 exactly on non-floor, >= 0 on all floor (connectivity proxy)
	{
		const d = generateDungeon(99, { roomCount: 50 });
		let mismatches = 0;
		for (let i = 0; i < d.grid.length; i++) {
			const isFloor = d.grid[i] === FLOOR;
			if (isFloor !== d.bfs[i] >= 0) mismatches++;
		}
		check(mismatches === 0, 'BFS field covers exactly the floor cells (' + mismatches + ' mismatches)');
	}
}
