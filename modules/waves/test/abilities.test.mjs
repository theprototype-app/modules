// the abilities and their mark on the walk — pure (30b P2).
import { ABILITIES, abilityOf, freshCharge, use, readiness, active, pulseShoves } from '../src/abilities.js';
import { warpedElapsed, pushedBy, appendFx, fxOf, enemyPosition, SLOW_RATE } from '../src/curve.js';
import { abilityHand } from '../src/guns.js';

const near = (/** @type {number} */ a, /** @type {number} */ b, e = 1e-9) => Math.abs(a - b) < e;

/** @param {(ok: boolean, label: string) => void} check */
export function run(check) {
	check(Object.keys(ABILITIES).join() === 'shield,slowmo,pulse', 'three abilities: Shield, Slow-mo, Pulse');
	check(ABILITIES.shield.duration === 3 && ABILITIES.slowmo.duration === 4 && SLOW_RATE === 0.4, '  Shield 3 s, Slow-mo 4 s at 40%');
	check(abilityOf('x') === ABILITIES.pulse, 'abilityOf: an unknown id is the Pulse');
	const a = ABILITIES.shield;
	let s = freshCharge();
	check(readiness(a, s, 0) === 1, 'a fresh charge is ready');
	let r = use(a, s, 10);
	check(r.ok && active(r.state, 12.9) && !active(r.state, 13.1), 'use: it runs for its duration');
	s = r.state;
	check(!use(a, s, 15).ok && near(readiness(a, s, 16), 0.5), 'use: it will not fire again while it recharges (half charged halfway)');
	check(use(a, s, 22).ok, '  and fires once the cooldown is over');
	check(!use(ABILITIES.pulse, s, 12).ok, '  swapping the ability does not skip the cooldown');
	check(abilityHand('right') === 'left', 'the ability is on the free hand');

	// the Pulse's shove
	const shoves = pulseShoves(
		[
			{ uuid: 'a', pos: [0, 0.6, -1], kind: 'grunt' },
			{ uuid: 'b', pos: [0, 0.6, -5.5], kind: 'grunt' },
			{ uuid: 'c', pos: [0, 0.6, -2], kind: 'tank' },
			{ uuid: 'd', pos: [0, 0.6, -9], kind: 'grunt' },
			{ uuid: 'e', pos: null, kind: 'grunt' }
		],
		[0, 1.6, 0],
		ABILITIES.pulse
	);
	check(shoves.a > shoves.b && shoves.b > 0 && !('d' in shoves) && !('e' in shoves), 'pulseShoves: harder up close, nothing past the radius');
	check(shoves.c < shoves.a * 0.5, '  a tank barely moves');

	// Slow-mo: the warped clock
	check(warpedElapsed(0, 10, []) === 10, 'warpedElapsed: no window, plain time');
	check(near(warpedElapsed(0, 10, [{ at: 2, until: 6 }]), 10 - 0.6 * 4), 'warpedElapsed: a 4 s window counts at 40%');
	check(near(warpedElapsed(0, 10, [{ at: 2, until: 6 }, { at: 4, until: 8 }]), 10 - 0.6 * 6), '  overlapping windows are merged, not doubled');
	check(near(warpedElapsed(5, 10, [{ at: 2, until: 6 }]), 5 - 0.6 * 1), '  clipped to the span');
	const walk = { start: [0, 0.6, -10], goal: [0, 0.5, 0], waveStart: 100, index: 0, speed: 2, stagger: 0, now: 104 };
	check(near(enemyPosition(walk)[2], -2) && near(enemyPosition({ ...walk, slows: [{ at: 100, until: 104 }] })[2], -10 + 2 * 4 * 0.4), 'enemyPosition: a slow window slows the walk (every peer, same place)');

	// Pulse: pushes read back
	const ev = [{ k: 'push', at: 10, d: { a: 1.5 } }, { k: 'push', at: 20, d: { a: 1, b: 2 } }, { k: 'slow', at: 21, until: 25 }];
	check(pushedBy('a', ev, 0, 30) === 2.5 && pushedBy('a', ev, 15, 30) === 1 && pushedBy('a', ev, 0, 15) === 1.5 && pushedBy('c', ev, 0, 30) === 0, 'pushedBy: this wave\'s shoves up to now, per enemy');
	const held = appendFx(null, 7, { k: 'slow', at: 5, until: 9 });
	const held2 = appendFx(held, 7, { k: 'push', at: 3, d: {} });
	check(held2.round === 7 && held2.ev.length === 2 && held2.ev[0].at === 3, 'appendFx: the round\'s list, sorted');
	check(appendFx(held2, 8, { k: 'slow', at: 1, until: 2 }).ev.length === 1, '  a new round drops the old round\'s events');
	check(fxOf(held2, 7).length === 2 && fxOf(held2, 8).length === 0 && fxOf(null, 7).length === 0, 'fxOf: only this round\'s');
	let big = null;
	for (let i = 0; i < 60; i++) big = appendFx(big, 1, { k: 'push', at: i, d: {} });
	check(big.ev.length === 40 && big.ev[0].at === 20, '  capped at 40, newest kept');
}
