// 31 W1: the wave clock, pure — run WITHOUT the app (npm run test:waves)
import { clearedAtOf, withClear } from '../src/curve.js';

/** @param {(ok: boolean, label: string) => void} check */
export function run(check) {
	let held = null;
	check(clearedAtOf(held, 777, 1) === null, 'no clock: no clear');
	held = withClear(held, 777, 1, 100.5);
	check(clearedAtOf(held, 777, 1) === 100.5, 'wave 1 cleared at its first-seen stamp');
	// THE BUG: a later hit on a veteran of wave 1 (it walks again in wave 2) moves the counters'
	// latest stamp; writing it again must NOT move the frozen clear
	held = withClear(held, 777, 1, 108.2);
	check(clearedAtOf(held, 777, 1) === 100.5, 'a later stamp never moves a frozen clear (the first sight wins)');
	held = withClear(held, 777, 2, 130);
	check(clearedAtOf(held, 777, 1) === 100.5 && clearedAtOf(held, 777, 2) === 130, 'wave 2 is added beside wave 1');
	check(clearedAtOf(held, 778, 1) === null, 'another round (a Restart) reads none of this round');
	const next = withClear(held, 778, 1, 5);
	check(clearedAtOf(next, 778, 1) === 5 && clearedAtOf(next, 778, 2) === null, 'a new round starts a clean clock');
	check(clearedAtOf({ round: 777, at: { 1: 'x' } }, 777, 1) === null && clearedAtOf({ round: 777 }, 777, 1) === null && clearedAtOf(42, 777, 1) === null, 'a malformed variable reads as none');
	// replicated: two peers that saw the same stamp write the same clock (JSON-equal)
	check(JSON.stringify(withClear(null, 9, 1, 3)) === JSON.stringify(withClear(null, 9, 1, 3)), 'two peers write the same clock');
}
