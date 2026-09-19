// the pure ledger, with a counterfactual per rule — run WITHOUT the app (npm run test:health)
import { objectHp, playerHp, applyDelta, pulsesFor, fraction, respawnDue, elapsed, MAX_PULSES } from '../src/ledger.js';

/** @param {(ok: boolean, label: string) => void} check */
export function run(check) {
	// ---- object health from counters -------------------------------------------------
	check(objectHp({ max: 5, hits: 0 }).hp === 5, 'untouched: hp = max');
	check(objectHp({ max: 5, hits: 3 }).hp === 2 && !objectHp({ max: 5, hits: 3 }).dead, 'three hits on five: 2, alive');
	check(objectHp({ max: 5, hits: 5 }).dead, 'five hits on five: dead');
	check(objectHp({ max: 5, hits: 9 }).hp === 0, 'overkill clamps at 0, never negative');
	check(objectHp({ max: 5, hits: 4, heals: 2 }).hp === 3, 'a heal counts against hits (4 - 2 on 5 = 3)');
	check(objectHp({ max: 5, hits: 1, heals: 4 }).hp === 5, 'a heal never goes past max');
	// THE SAME INPUTS GIVE THE SAME NUMBER — that is the whole convergence argument. The
	// counterfactual is the shared-add model: two peers each computing hp-1 from their
	// own view lose a hit; here two peers holding the same counters cannot disagree.
	const peerA = objectHp({ max: 5, hits: 2 });
	const peerB = objectHp({ max: 5, hits: 2 });
	check(peerA.hp === peerB.hp && peerA.hp === 3, 'two peers with the same counter read the same hp (3)');
	const raceA = 5 - 1; // A applies its own hit to the value it read
	const raceB = 5 - 1; // B applies its own hit to the value IT read - one hit is lost
	check(raceA === raceB && raceA !== objectHp({ max: 5, hits: 2 }).hp, 'COUNTERFACTUAL: a read-modify-write add loses a hit (4 vs the ledger\'s 3)');
	check(objectHp({ max: 'x', hits: 1 }).hp === 4, 'a bad max falls back to the default (5)');

	// ---- player health from a row ----------------------------------------------------
	const t0 = 1000;
	check(playerHp({ max: 5, base: null, now: t0 }).hp === 5, 'no row yet: full');
	check(playerHp({ max: 5, base: 2, at: t0, now: t0 }).hp === 2, 'a row at its stamp reads its base');
	check(playerHp({ max: 5, regen: 1, base: 2, at: t0, now: t0 + 2 }).hp === 4, 'regen 1/s adds 2 after 2 s');
	check(playerHp({ max: 5, regen: 1, base: 2, at: t0, now: t0 + 20 }).hp === 5, 'regen caps at max');
	check(playerHp({ max: 5, regen: 1, base: 0, at: t0, now: t0 + 20 }).dead, 'the dead do not regenerate');
	// FRAME-RATE INDEPENDENCE: the value depends on (base, at, now) only, so two peers
	// sampling at different rates read the same number for the same clock
	const slow = playerHp({ max: 5, regen: 0.5, base: 1, at: t0, now: t0 + 3 }).hp;
	const fast = playerHp({ max: 5, regen: 0.5, base: 1, at: t0, now: t0 + 3 }).hp;
	check(slow === fast && slow === 2.5, 'regen is a function of the clock, not of frames (2.5 at +3 s)');
	check(playerHp({ max: 5, regen: 1, base: 3, at: 86399, now: 1 }).hp === 5, 'a stamp across midnight still counts forward (2 s of regen)');
	check(elapsed(1, 86399) === 2, 'elapsed() wraps the seconds-of-day clock');

	// applyDelta folds the regen'd value into the new base
	const hurt = applyDelta({ max: 5, regen: 1, base: 2, at: t0, now: t0 + 2 }, -3);
	check(hurt.base === 1 && hurt.at === t0 + 2, 'damage lands on the regen\'d value (4 - 3 = 1) and restamps');
	check(applyDelta({ max: 5, base: 1, at: t0, now: t0 }, -5).base === 0, 'damage clamps at 0 (dead)');
	check(applyDelta({ max: 5, base: 1, at: t0, now: t0 }, +9).base === 5, 'a heal clamps at max');

	// ---- pulses per event ------------------------------------------------------------
	check(pulsesFor({ amount: 3 }) === 3, 'amount 3 = 3 pulses');
	check(pulsesFor({ amount: 99 }) === MAX_PULSES, 'capped at ' + MAX_PULSES);
	check(pulsesFor({ amount: 0 }) === 0, 'amount 0 fires nothing');
	check(pulsesFor({ amount: 2, scale: 'speed', speed: 6, speedRef: 3 }) === 4, 'speed scaling: twice the reference doubles (4)');
	check(pulsesFor({ amount: 2, scale: 'speed', speed: 0.1, speedRef: 3 }) === 1, 'a soft hit is never free (1)');
	check(pulsesFor({ amount: 2, scale: 'speed', speed: 100, speedRef: 3 }) === 6, 'speed scaling caps at 3x (6)');
	check(pulsesFor({ amount: 2, scale: 'none', speed: 100 }) === 2, 'no scaling ignores speed');

	// ---- readouts + respawn ------------------------------------------------------------
	check(fraction(2, 5) === 0.4, 'fraction 2/5 = 0.4');
	check(fraction(9, 5) === 1, 'fraction clamps to 1');
	check(!respawnDue(null, 3, 100), 'no death stamp: no respawn');
	check(!respawnDue(100, 3, 102), 'before the delay: not due');
	check(respawnDue(100, 3, 103), 'at the delay: due');
	check(respawnDue(86399, 3, 2), 'due across midnight');
}
