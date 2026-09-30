// the curve, pure — run WITHOUT the app (npm run test:waves)
import { curveOf, sizeOf, firstWaveOf, killsNeeded, killsOf, waveOf, aliveIn, usedIn, healsBefore, enemyPosition, spawnFor, runEntry, appendRun } from '../src/curve.js';

/** @param {(ok: boolean, label: string) => void} check */
export function run(check) {
	const c = curveOf({ waves: 3, sizeStart: 2, sizeStep: 1 }, 4); // 4 enemies: waves of 2, 3, 4
	check(sizeOf(1, c) === 2 && sizeOf(2, c) === 3 && sizeOf(3, c) === 4, 'sizes 2, 3, 4');
	check(sizeOf(3, curveOf({ waves: 3, sizeStart: 2, sizeStep: 5 }, 4)) === 4, 'a wave never uses more enemies than there are');
	check(firstWaveOf(0, c) === 1 && firstWaveOf(2, c) === 2 && firstWaveOf(3, c) === 3, 'enemies 0/2/3 first appear in waves 1/2/3');
	check(firstWaveOf(9, c) === null, 'a tenth enemy never appears');
	check(killsNeeded(0, 3, c) === 3 && killsNeeded(2, 3, c) === 2 && killsNeeded(3, 3, c) === 1 && killsNeeded(3, 1, c) === 0, 'kills needed accumulate per wave appeared in');
	check(killsOf(6, 3) === 2 && killsOf(7, 3) === 2 && killsOf(0, 3) === 0, 'kills = floor(hits / hp)');

	// the wave from the counters
	check(JSON.stringify(waveOf([0, 0, 0, 0], c)) === '{"completed":0,"wave":1,"done":false}', 'nothing killed: wave 1');
	check(JSON.stringify(waveOf([1, 0, 0, 0], c)) === '{"completed":0,"wave":1,"done":false}', 'one of two down: still wave 1');
	check(JSON.stringify(waveOf([1, 1, 0, 0], c)) === '{"completed":1,"wave":2,"done":false}', 'both down: wave 2');
	check(JSON.stringify(waveOf([2, 2, 1, 0], c)) === '{"completed":2,"wave":3,"done":false}', 'wave 2 cleared (the two veterans twice, the new one once): wave 3');
	check(JSON.stringify(waveOf([3, 3, 2, 1], c)) === '{"completed":3,"wave":3,"done":true}', 'everything down for the last time: done, wave stays 3');
	check(JSON.stringify(waveOf([3, 3, 2, 0], c)) === '{"completed":2,"wave":3,"done":false}', 'COUNTERFACTUAL: one straggler keeps the run open');
	check(JSON.stringify(waveOf([1, 0, 5, 5], c)) === '{"completed":0,"wave":1,"done":false}', 'COUNTERFACTUAL: kills on later enemies do not skip a wave');
	// two peers with the same counters derive the same wave, and a joiner with those
	// counters derives it too — the whole point
	check(waveOf([2, 2, 1, 0], c).wave === waveOf([2, 2, 1, 0], c).wave, 'the same counters give the same wave');

	check(aliveIn(2, [1, 1, 0, 0], c).join() === '0,1,2', 'wave 2 starts with all three alive');
	check(aliveIn(2, [2, 1, 1, 0], c).join() === '1', 'mid-wave 2: only enemy 1 left');
	check(usedIn(3, c).join() === '0,1,2,3', 'wave 3 uses all four');
	check(healsBefore(0, 3, c) === 2 && healsBefore(2, 3, c) === 1 && healsBefore(3, 3, c) === 0 && healsBefore(0, 1, c) === 0, 'heals before a wave: one per earlier appearance');

	// movement, pure in time
	const p = { start: [0, 0.5, 0], goal: [10, 0, 0], waveStart: 100, index: 0, speed: 2, stagger: 0.5 };
	check(enemyPosition({ ...p, now: 99 }).join() === '0,0.5,0', 'before the wave: at the start');
	check(enemyPosition({ ...p, now: 101 }).join() === '2,0.5,0', 'one second in at 2 m/s: 2 m along, y kept');
	check(enemyPosition({ ...p, now: 200 }).join() === '10,0.5,0', 'arrived: stays at the goal');
	check(enemyPosition({ ...p, index: 2, now: 101 }).join() === '0,0.5,0', 'the third enemy waits its stagger');
	check(enemyPosition({ ...p, index: 2, now: 102 }).join() === '2,0.5,0', 'and then walks the same line');
	check(enemyPosition({ ...p, goal: [0, 0, 0], now: 150 }).join() === '0,0.5,0', 'goal at the start: stays put');
	const a = enemyPosition({ ...p, now: 103.25 });
	const b = enemyPosition({ ...p, now: 103.25 });
	check(a.join() === b.join(), 'two peers at the same clock place it identically');

	check(spawnFor(4, [[1, 0, 0], [2, 0, 0], [3, 0, 0]], [9, 9, 9]).join() === '2,0,0', 'spawn points cycle');
	check(spawnFor(0, [], [9, 9, 9]).join() === '9,9,9', 'no points: the fallback');

	// the run log
	const e = runEntry({ at: 5, waves: 3, reached: 3, cleared: true, rows: [{ name: 'b', kills: 2 }, { name: 'a', kills: 2 }, { name: 'c', kills: 5 }] });
	check(e.players.map((x) => x.name).join() === 'c,a,b', 'players sort by kills then name');
	const log = appendRun(appendRun([], e), e);
	check(log.length === 1, 'appending the same run twice keeps one (idempotent by `at`)');
	check(appendRun(log, { ...e, at: 6 }).length === 2, 'a different run appends');
	check(appendRun(Array.from({ length: 60 }, (_, i) => ({ at: i })), { ...e, at: 999 }).length === 50, 'capped at 50');
	// 30: one round, two last-hit stamps (a knock on a dead enemy after the last kill) -> ONE run
	const r1 = runEntry({ at: 10542.71, round: 777, waves: 3, reached: 3, cleared: true, rows: [] });
	const r2 = runEntry({ at: 10542.711, round: 777, waves: 3, reached: 3, cleared: true, rows: [] });
	const twice = appendRun(appendRun([], r1), r2);
	check(twice.length === 1 && twice[0].at === 10542.711, 'the same ROUND logged with two stamps keeps ONE entry (the later)');
	check(appendRun(twice, runEntry({ at: 20, round: 778, waves: 3, reached: 3, cleared: true, rows: [] })).length === 2, '  a new round appends');
	check(!('round' in runEntry({ at: 1, waves: 1, reached: 1, cleared: true, rows: [] })), '  an entry without a round carries no round field (old logs unchanged)');
}
