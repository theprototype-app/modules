// Pure-node tests for navigation — run WITHOUT the app:
//   node modules/navigation/test/run.mjs      (npm run test:navigation)
//
// Drives the REAL recast half (src/navCore.js, the code the worker runs) on hand-made arenas and the
// REAL brain (src/brain.js) with plain numbers. Asserts behaviours, not floats: a path goes ROUND a
// wall (it passes the gap), a crate in the gap blocks then frees it, an unreachable target says WHY
// and hands back the closest point, a crowd agent arrives and then STOPS (no jitter), and the guard's
// states run idle → patrol → alert → chase → attack → give up → return.

import { initRecast, NavWorld, pathLength } from '../src/navCore.js';
import { newBrain, think, normalizeNpc, inCone, yawToward } from '../src/brain.js';
import { specToData, dataToSpec } from '../src/sheet.js';
import { arena } from './geo.mjs';
import { elect, isHeardByAll } from '../src/runtime.js';

let failures = 0;
let passes = 0;
/** @param {boolean} ok @param {string} label */
function check(ok, label) {
	console.log((ok ? 'PASS ' : 'FAIL ') + label);
	if (ok) passes++;
	else failures++;
}

await initRecast();

// ---- G1: bake + paths ----------------------------------------------------------------------
const w = new NavWorld({ ...arena() });
check(w.ok, 'the arena bakes (' + w.bakeMs.toFixed(0) + ' ms)');
check(w.area() > 250 && w.area() < 400, 'walkable area is the floor minus the wall and the block (' + w.area().toFixed(0) + ' m²)');
const round = w.reach([-5, 0, -5], [5, 0, -5]);
check(round.ok, 'a target behind the wall is reachable');
check(round.path.some((p) => p[2] > 3.5 && p[2] < 6.5 && Math.abs(p[0]) < 1.2), 'the path goes ROUND the wall, through the gap');
check(round.length > 20, 'the path is longer than the straight line (' + round.length.toFixed(1) + ' m vs 10)');

// ---- G6: unreachable, with the reason and the closest point --------------------------------
const air = w.reach([-5, 0, 0], [5, 6, 0]);
check(!air.ok && air.why === 'off mesh', 'a target in the air is "off mesh" (' + air.why + ')');
const wall = new NavWorld({ ...arena({ gap: false }) });
const blocked = wall.reach([-5, 0, 0], [5, 0, 0]);
check(!blocked.ok && blocked.why === 'blocked', 'a target behind a closed wall is "blocked" (' + blocked.why + ')');
check(!!blocked.goal && blocked.goal[0] < 0 && blocked.goal[0] > -1.5, 'blocked: the closest point is at the wall, on our side (x ' + blocked.goal?.[0].toFixed(2) + ')');
const far = w.reach([-5, 0, -5], [5, 0, -5], { maxPath: 10 });
check(!far.ok && far.why === 'too far', 'a path longer than the limit is "too far"');
check(!!far.goal && Math.abs(pathLength([[-5, 0.1, -5], ...[]]) - 0) < 1e-9 && far.goal[2] > -5, 'too far: it walks as far as the limit along the path');
const roof = w.reach([-5, 0, 0], [-7, 3, -7]);
check(!roof.ok && roof.why === 'blocked', 'the top of a block nobody can climb is "blocked" (an island)');

// ---- crowd: arrives, then stops (no jitter) ------------------------------------------------
w.agent('a', [-5, 0, -5], { speed: 3 });
w.moveTo('a', round.goal);
for (let i = 0; i < 60 * 12; i++) w.step(1 / 60);
const at = w.read()[0].pos;
check(Math.hypot(at[0] - 5, at[2] + 5) < 0.6, 'the agent walks round the wall to the goal in 12 s (' + at.map((v) => v.toFixed(2)) + ')');
w.moveTo('a', null);
const before = w.read()[0].pos;
for (let i = 0; i < 120; i++) w.step(1 / 60);
const after = w.read()[0].pos;
check(Math.hypot(after[0] - before[0], after[2] - before[2]) < 0.05, 'stopped at the goal it stays put (moved ' + Math.hypot(after[0] - before[0], after[2] - before[2]).toFixed(3) + ' m)');

// ---- temporary obstacle: a crate blocks the gap, then frees it ------------------------------
w.syncObstacles([{ key: 'crate', min: [-1, 0, 4], max: [1, 1, 6] }]);
for (let i = 0; i < 10; i++) w.step(1 / 60);
const crate = w.reach([-5, 0, -5], [5, 0, -5]);
check(!crate.ok && crate.why === 'blocked', 'a crate in the gap blocks the path');
w.syncObstacles([{ key: 'crate', min: [-6, 0, -9], max: [-4, 1, -7] }]);
for (let i = 0; i < 10; i++) w.step(1 / 60);
check(w.reach([-5, 0, -5], [5, 0, -5]).ok, 'the crate moved away: the path is free again');
w.syncObstacles([]);
for (let i = 0; i < 10; i++) w.step(1 / 60);
check(w.obstacles.size === 0, 'the crate gone: no obstacle left');

// ---- G5: the brain --------------------------------------------------------------------------
check(inCone([0, 0, 0], 0, [0, 0, 5], 90, 10), 'yaw 0 looks along +Z');
check(!inCone([0, 0, 0], 0, [0, 0, -5], 90, 10), 'and not behind');
check(Math.abs(yawToward([0, 0, 0], [1, 0, 0]) - Math.PI / 2) < 1e-9, 'yawToward +X = 90°');
const p = normalizeNpc({ giveUp: 2, alert: 1, attackEvery: 1, sightRange: 10, sightAngle: 90, hearing: 6 });
const b = newBrain([0, 0, 0], 0);
const clear = () => true;
const wallSee = () => false;
let t = 0;
const run = (/** @type {any} */ opts) => think(b, { now: t, pos: [0, 0, 0], yaw: 0, p, players: [], see: clear, noises: [], patrol: null, ...opts });
let o = run({ patrol: [0, 0, 3] });
check(o.state === 'patrol' && o.goal?.[2] === 3, 'with a Path it patrols');
t += 0.1;
o = run({ patrol: [0, 0, 3], noises: [{ pos: [4, 0, 0], loudness: 1 }] });
check(o.state === 'alert' && o.events.some((e) => e.name === 'heard') && o.goal === null, 'a noise within hearing: alert, it stops and looks');
t += 0.5;
o = run({ noises: [] });
check(o.state === 'alert' && o.goal === null && o.face?.[0] === 4, 'still listening (alert time not over), facing the noise');
t += 1;
o = run({ noises: [] });
check(o.state === 'alert' && o.goal?.[0] === 4, 'then it goes to look');
// the search: walk to the noise (a long walk is not cut short), look around giveUp s, walk back
{
	const sb = newBrain([0, 0, 0], 0);
	const go = (/** @type {number} */ now, /** @type {any} */ opts) => think(sb, { now, pos: [0, 0, 0], yaw: 0, p, players: [], see: clear, noises: [], patrol: null, ...opts });
	go(0, { noises: [{ pos: [12, 0, 0], loudness: 3 }] });
	const far = go(20, { pos: [6, 0, 0] });
	check(far.state === 'alert' && far.goal?.[0] === 12, 'a search 20 s long is still walking to the noise');
	const there = go(21, { pos: [11.5, 0, 0] });
	check(there.state === 'alert' && there.goal === null && /looking around/.test(there.label), 'at the noise it looks around');
	const done = go(21 + p.giveUp + 0.1, { pos: [11.5, 0, 0] });
	check(done.state === 'return' && done.events.some((e) => e.name === 'gaveup'), 'then it gives up and walks back');
	const sb2 = newBrain([0, 0, 0], 0);
	think(sb2, { now: 0, pos: [0, 0, 0], yaw: 0, p, players: [], see: clear, noises: [{ pos: [12, 0, 0], loudness: 3 }], patrol: null });
	const stuck = think(sb2, { now: p.alert + p.giveUp + 0.2, pos: [3, 0, 0], yaw: 0, p, players: [], see: clear, noises: [], patrol: null, reach: { ok: false, why: 'blocked' } });
	check(stuck.state === 'return', 'a noise it cannot walk to: it gives the search up');
	const hb = newBrain([0, 0, 0], Math.PI / 2);
	const post = think(hb, { now: 0, pos: [0.2, 0, 0], yaw: 0, p, players: [], see: clear, noises: [], patrol: null });
	check(post.state === 'idle' && !!post.face && post.face[0] > 4 && Math.abs(post.face[2]) < 0.01, 'back at its post a guard turns to its home facing');
	const lb = newBrain([0, 0, 0], 0);
	const up = think(lb, { now: 0, pos: [0, 0, 0], yaw: 0, p, players: [{ id: 'p1', pos: [0, 3, 1] }], see: clear, noises: [], patrol: null });
	check(up.state === 'chase', 'a player on a ledge 3 m above, in attack range on the ground plan, is chased, not attacked');
}
const quiet = newBrain([0, 0, 0], 0);
const r9 = think(quiet, { now: 0, pos: [0, 0, 0], yaw: 0, p, players: [], see: clear, noises: [{ pos: [9, 0, 0], loudness: 1 }], patrol: null });
check(r9.state === 'idle', 'a noise beyond hearing is not heard');
const r9b = think(quiet, { now: 0.1, pos: [0, 0, 0], yaw: 0, p, players: [], see: clear, noises: [{ pos: [9, 0, 0], loudness: 2 }], patrol: null });
check(r9b.state === 'alert', 'a louder noise reaches further (loudness 2 at 9 m)');
t += 0.1;
o = run({ players: [{ id: 'p1', pos: [0, 0, 6] }], see: wallSee });
check(o.state !== 'chase', 'a player behind a wall (no line of sight) is not seen');
t += 0.1;
o = run({ players: [{ id: 'p1', pos: [0, 0, 6] }] });
check(o.state === 'chase' && o.events.some((e) => e.name === 'spotted') && o.speed === p.run, 'a player in the cone with line of sight: spotted, chase at run speed');
t += 0.1;
o = run({ players: [{ id: 'p1', pos: [0, 0, 1.2] }] });
check(o.state === 'attack' && o.events.some((e) => e.name === 'attack'), 'within attack range: attack fires');
t += 0.5;
o = run({ players: [{ id: 'p1', pos: [0, 0, 1.2] }] });
check(!o.events.some((e) => e.name === 'attack'), 'not again before attackEvery');
t += 0.6;
o = run({ players: [{ id: 'p1', pos: [0, 0, 1.2] }] });
check(o.events.some((e) => e.name === 'attack'), 'again after attackEvery');
t += 0.1;
o = run({ players: [{ id: 'p1', pos: [0, 0, 6] }], see: wallSee });
check(o.state === 'chase' && /lost/.test(o.label) === false, 'the player ducks behind a wall: still chasing its last spot');
t += 2.1;
o = run({ pos: [0, 0, 4], players: [{ id: 'p1', pos: [0, 0, 6] }], see: wallSee });
check(o.state === 'return' && o.events.some((e) => e.name === 'gaveup'), 'lost for giveUp seconds: gives up and returns');
t += 0.1;
o = think(b, { now: t, pos: [0, 0, 0.2], yaw: 0, p, players: [], see: clear, noises: [], patrol: null });
check(o.state === 'idle' && o.events.some((e) => e.name === 'returned'), 'back home: returned, guarding again');
o = think(b, { now: t + 0.1, pos: [0, 0, 0], yaw: 0, p, players: [], see: clear, noises: [], patrol: null, reach: { ok: false, why: 'blocked' } });
check(/can't reach: blocked/.test(o.label), 'the label says why it cannot reach');

// ---- G10: the sheet's recipe data -----------------------------------------------------------
const d = specToData({ sight: { angle: 400, range: 15 }, hearing: 3, attack: { range: 2 } });
check(d.sightAngle === 360 && d.sightRange === 15 && d.hearing === 3 && d.attackRange === 2 && !('run' in d), 'the recipe clamps and keeps only what was given');
const back = dataToSpec({ ...d, path: 'abc' });
check(back.sight.angle === 360 && back.path === 'abc', 'and reads back in the agent shape');

// ---- 61-int: the election needs the authority to be HEARD -----------------------------------
{
	const now = 100000;
	const fresh = (ids) => new Map(ids.map((id) => [id, now - 100]));
	const info = (rows) => new Map(Object.entries(rows).map(([id, r]) => [id, { hears: r.hears ? new Set(r.hears) : null, ok: r.ok ?? true }]));
	// host "b" hears nobody (it refuses the viewer's module messages); viewer "a" hears the host
	check(elect({ me: 'b', active: true, heard: new Map(), info: new Map(), now }) === 'b', 'a host that hears nobody steps');
	check(!isHeardByAll('a', fresh(['b']), info({ b: { hears: [] } }), now), 'a viewer the host does not hear is not heard by all');
	check(elect({ me: 'a', active: true, heard: fresh(['b']), info: info({ b: { hears: [] } }), now }) === 'b', 'so the viewer (lower id) leaves the crowd to the host: ONE stepper');
	// two editors hear each other: the lowest id, the same answer on both
	const both = info({ a: { hears: ['b'] }, b: { hears: ['a'] } });
	check(elect({ me: 'a', active: true, heard: fresh(['b']), info: both, now }) === 'a' && elect({ me: 'b', active: true, heard: fresh(['a']), info: both, now }) === 'a', 'two editors that hear each other agree on the lowest id');
	// a peer whose own beat says it cannot step is not elected by the others
	check(elect({ me: 'b', active: true, heard: fresh(['a']), info: info({ a: { hears: ['b'], ok: false } }), now }) === 'b', 'a peer that says it is not heard is never elected');
	// an older peer that does not list whom it hears counts as hearing everyone (the old rule)
	check(elect({ me: 'a', active: true, heard: fresh(['b']), info: info({ b: {} }), now }) === 'a', 'an older peer (no hears list): the lowest id, as before');
	// a stale beat drops out; nobody plays -> null
	check(elect({ me: 'a', active: false, heard: new Map([['b', now - 9000]]), info: new Map(), now }) === null, 'nobody playing: no authority');
}

console.log('\n' + passes + ' passed, ' + failures + ' failed');
process.exit(failures ? 1 : 0);
