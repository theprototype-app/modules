// the guns, the prefs and the knockback — pure (30b P1).
import { GUNS, GUN_IDS, gunOf, trigger, idleHand, pelletDirs, gunHands, abilityHand } from '../src/guns.js';
import { normalize, cycle, DEFAULT_PREFS, HANDS } from '../src/prefs.js';
import { enemyPosition, setbackOf, kindOf, KINDS } from '../src/curve.js';
import { HAPTIC_FALLBACK, hasGameSounds, createFeel } from '../src/feel.js';

/** @param {(ok: boolean, label: string) => void} check */
export function run(check) {
	check(GUN_IDS.join(',') === 'blaster,scatter,beam', 'three guns: Blaster, Scatter, Beam');
	check(gunOf('nope') === GUNS.blaster && gunOf('beam') === GUNS.beam, 'gunOf: an unknown id is the Blaster');

	// Blaster: semi-auto — one shot per press, a refire floor
	const b = GUNS.blaster;
	let s = idleHand();
	let r = trigger(b, s, { pressed: true, held: true, t: 10 });
	check(r.fire, 'Blaster: a press fires');
	r = trigger(b, r.state, { pressed: false, held: true, t: 10.5 });
	check(!r.fire, 'Blaster: holding does not refire (semi-auto)');
	r = trigger(b, r.state, { pressed: true, held: true, t: 10.52 });
	check(r.fire, 'Blaster: the next press fires');
	r = trigger(b, r.state, { pressed: true, held: true, t: 10.6 });
	check(!r.fire, 'Blaster: a press inside the refire floor does not');

	// Scatter: slow
	const sc = GUNS.scatter;
	r = trigger(sc, idleHand(), { pressed: true, held: true, t: 1 });
	const r2 = trigger(sc, r.state, { pressed: true, held: true, t: 1.5 });
	const r3 = trigger(sc, r2.state, { pressed: true, held: true, t: 1.9 });
	check(r.fire && !r2.fire && r3.fire, 'Scatter: a slow pump (0.85 s) between shots');
	const dirs = pelletDirs([0, 0, -1], sc.pellets, sc.spread, 0.3);
	check(dirs.length === 7 && dirs.every((d) => Math.abs(Math.hypot(...d) - 1) < 1e-9), 'Scatter: 7 unit pellets');
	check(dirs.every((d) => Math.acos(-d[2]) <= sc.spread + 1e-9) && dirs.some((d) => Math.acos(-d[2]) > sc.spread * 0.9), '  inside the cone, and out to its edge');
	check(pelletDirs([0, 0, -1], 1, 0.1).length === 1, 'a single-pellet gun shoots straight');

	// Beam: ticks while held, heats, locks, cools
	const bm = GUNS.beam;
	let st = idleHand();
	let fires = 0;
	let t = 0;
	for (; t < 1; t += 1 / 60) {
		const x = trigger(bm, st, { pressed: t === 0, held: true, t });
		st = x.state;
		if (x.fire) fires++;
	}
	check(fires >= 7 && fires <= 10, 'Beam: fires in ticks while held (' + fires + ' in 1 s)');
	check(st.heat > 0.35 && st.heat < 0.5 && !st.locked, 'Beam: it heats while burning (' + st.heat.toFixed(2) + ' after 1 s)');
	let lockedAt = null;
	for (; t < 4 && lockedAt === null; t += 1 / 60) {
		st = trigger(bm, st, { pressed: false, held: true, t }).state;
		if (st.locked) lockedAt = t;
	}
	check(lockedAt !== null && lockedAt > 2 && lockedAt < 2.8, 'Beam: held ~2.4 s it OVERHEATS and locks (at ' + (lockedAt ?? NaN).toFixed(2) + ' s)');
	let firedLocked = false;
	for (let k = 0; k < 30; k++, t += 1 / 60) {
		const x = trigger(bm, st, { pressed: k === 0, held: true, t });
		st = x.state;
		if (x.fire) firedLocked = true;
	}
	check(!firedLocked && st.locked, 'Beam: a locked beam does not fire, even pressed and held');
	for (const end = t + 2; t < end; t += 1 / 60) st = trigger(bm, st, { pressed: false, held: false, t }).state;
	check(!st.locked && st.heat < 0.35, 'Beam: let go, it cools and unlocks');

	check(gunHands('right').join() === 'right' && gunHands('left').join() === 'left' && gunHands('both').join() === 'right,left', 'gunHands: right / left / both');
	check(abilityHand('right') === 'left' && abilityHand('both') === 'left' && abilityHand('left') === 'right', 'abilityHand: the free hand (the left when both hold guns)');

	// prefs
	check(JSON.stringify(normalize(null)) === JSON.stringify(DEFAULT_PREFS), 'prefs: nothing stored reads as the defaults');
	const odd = normalize({ gun: 'bazooka', hand: 'both', sfx: 'yes', haptics: false, music: 'loud' });
	check(odd.gun === 'blaster' && odd.hand === 'both' && odd.sfx === true && odd.haptics === false && odd.music === DEFAULT_PREFS.music, 'prefs: a bad value falls back field by field');
	check(cycle(HANDS, 'right') === 'left' && cycle(HANDS, 'both') === 'right', 'prefs: cycle wraps');

	// knockback + kinds
	check(kindOf('Enemy 3') === 'grunt' && kindOf('Runner 1') === 'runner' && kindOf('Enemy 7 tank') === 'tank', 'kindOf: read off the name');
	check(KINDS.runner.speed > KINDS.grunt.speed && KINDS.tank.speed < KINDS.grunt.speed && KINDS.tank.knock < KINDS.grunt.knock, 'kinds: runners fast, tanks slow and heavy');
	check(setbackOf(2, 0, 3, 0.5) === 1 && setbackOf(5, 3, 3, 0.5) === 1 && setbackOf(9, 0, 3, 0.5) === 1.5 && setbackOf(0, 3, 3, 0.5) === 0, 'setbackOf: hits in THIS life (after the heals), capped at the max');
	const walk = { start: [0, 0.6, -10], goal: [0, 0.5, 0], waveStart: 100, index: 0, speed: 2, stagger: 0 };
	const free = enemyPosition({ ...walk, now: 102 });
	const shoved = enemyPosition({ ...walk, now: 102, setback: 1 });
	check(Math.abs(free[2] + 6) < 1e-9 && Math.abs(shoved[2] + 7) < 1e-9, 'enemyPosition: a 1 m setback takes 1 m off how far it came');
	check(enemyPosition({ ...walk, now: 100.2, setback: 5 })[2] === -10, '  never behind its start');
	check(enemyPosition({ ...walk, now: 200, setback: 2 })[2] === 0, '  and one long at the goal stays there');

	// feel
	check(Object.keys(HAPTIC_FALLBACK).join() === 'tap,bump,hit,success,fail,rumble,heartbeat', 'haptics: the seven C4 patterns have a one-pulse stand-in');
	check(!hasGameSounds({}) && hasGameSounds({ music: { play() {} } }), 'game sounds are there only with api.music (C5)');
	const calls = [];
	const api = { music: { play() {} }, playSound: (/** @type {string} */ n) => calls.push('s:' + n), haptic: (/** @type {number} */ i, /** @type {number} */ ms, /** @type {string} */ h) => calls.push('h:' + i + ':' + ms + ':' + h) };
	let p = { ...DEFAULT_PREFS };
	const feel = createFeel(api, { get: () => p });
	feel.sound('shoot');
	feel.haptic('hit', 'right');
	feel.haptic('hit', 'desk');
	p = { ...p, sfx: false, haptics: false };
	feel.sound('shoot');
	feel.haptic('hit', 'right');
	check(calls.join('|') === 's:shoot|h:0.8:70:right', 'feel: sounds and buzzes through the options; no hapticPattern -> the one-pulse fallback; off is off (' + calls.join('|') + ')');
}
