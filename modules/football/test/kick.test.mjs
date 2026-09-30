// 30b: the controller-tip kick, pure — every rule with its counterfactual.
import {
	TIP_RADIUS,
	TIP_OFFSET,
	MIN_KICK_SPEED,
	KICK_GAIN,
	rotate,
	tipPoint,
	pushSample,
	ringVelocity,
	kickContact,
	kickImpulse,
	kickHaptic,
	bounced,
	armStep
} from '../src/kick.js';

const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;
const len = (v) => Math.hypot(v[0], v[1], v[2]);

/** @param {(ok: boolean, label: string) => void} check */
export function run(check) {
	// ---- the tip ----
	const id = [0, 0, 0, 1];
	const tip = tipPoint([1, 1, 1], id);
	check(near(tip[0], 1) && near(tip[1], 1) && near(tip[2], 1 - TIP_OFFSET), 'tipPoint: an unrotated controller\'s tip sits TIP_OFFSET along its -Z');
	const yaw90 = [0, Math.sin(Math.PI / 4), 0, Math.cos(Math.PI / 4)]; // +90 deg about Y: -Z turns to -X
	const turned = tipPoint([0, 0, 0], yaw90);
	check(near(turned[0], -TIP_OFFSET) && near(turned[2], 0), '  counterfactual: turned 90 degrees, the tip follows to -X');
	check(near(len(rotate([0, 0, -1], yaw90)), 1), '  rotate keeps length');
	check(tipPoint([2, 0, 0], null)[0] === 2, '  no orientation: the tip is the controller');

	// ---- velocity from samples ----
	const ring = [];
	for (let i = 0; i <= 6; i++) pushSample(ring, [i * 0.03, 0, 0], 1000 + i * 15); // 0.03 m / 15 ms = 2 m/s
	check(near(ringVelocity(ring)[0], 2, 1e-6), 'ringVelocity: 3 cm per 15 ms is 2 m/s');
	check(ring[ring.length - 1].t - ring[0].t <= 90 + 15, '  the ring keeps only the window');
	pushSample(ring, [5, 0, 0], 10); // a clock that went backwards
	check(ring.length === 1 && ringVelocity(ring)[0] === 0, '  counterfactual: a clock going backwards restarts the ring (no phantom 300 m/s swing)');

	// ---- contact ----
	const ballR = 0.22;
	const c = kickContact([0, 1.3, -0.25], [0, 0, 3], TIP_RADIUS, [0, 1.3, 0], [0, 0, 0], ballR);
	check(c.overlap && near(c.n[2], 1) && near(c.approach, 3), 'kickContact: a tip driving +Z into the ball closes at 3 m/s along +Z');
	const apart = kickContact([0, 1.3, -0.4], [0, 0, 3], TIP_RADIUS, [0, 1.3, 0], [0, 0, 0], ballR);
	check(!apart.overlap, '  counterfactual: 40 cm away is no contact');
	const receding = kickContact([0, 1.3, -0.25], [0, 0, -3], TIP_RADIUS, [0, 1.3, 0], [0, 0, 0], ballR);
	check(receding.approach < 0, '  a tip pulling AWAY has negative approach (no kick)');
	const outrun = kickContact([0, 1.3, -0.25], [0, 0, 2], TIP_RADIUS, [0, 1.3, 0], [0, 0, 3], ballR);
	check(outrun.approach < 0, '  a ball already flying away faster than the tip is not kicked');

	// ---- the impulse ----
	const imp = kickImpulse(c.n, c.approach, 0.45, [0, 0, 0]);
	check(near(imp[2], 3 * KICK_GAIN * 0.45) && near(imp[0], 0), 'kickImpulse = mass x approach x gain along n (0.45 x 3 x ' + KICK_GAIN + ')');
	const capped = kickImpulse([0, 0, 1], 20, 0.45, [0, 0, 0], KICK_GAIN, 10);
	check(near(capped[2] / 0.45, 10, 1e-6), '  a 20 m/s swing is capped at the 10 m/s ball speed');
	const onTop = kickImpulse([0, 0, 1], 8, 1, [0, 0, 6], 1, 10);
	check(near(onTop[2], 4, 1e-6), '  the cap counts the ball\'s own speed (6 + 4 = 10)');
	check(len(kickImpulse([0, 0, 1], -2, 1, [0, 0, 0])) === 0, '  counterfactual: a negative approach gives no impulse');

	// ---- the haptic ----
	check(kickHaptic(0) === 0.25 && kickHaptic(2) > kickHaptic(1) && kickHaptic(50) === 1, 'kickHaptic grows with the kick and is capped at 1');

	// ---- bounces ----
	check(bounced([0, 0, 3], [0, 0, -2.1]), 'bounced: a reversal at speed is a bounce (the glass, a post)');
	check(!bounced([0, 0, 3], [0.3, 0, 2.8]), '  counterfactual: a slight curve is not');
	check(!bounced([0, 0, 0.2], [0, 0, -0.2]), '  a crawl turning round is not (below the speed floor)');

	// ---- one swing, one kick ----
	const arm = { spent: false };
	const reach = TIP_RADIUS + ballR;
	check(armStep(arm, reach - 0.05, reach) === true, 'armStep: the first frame inside may kick');
	arm.spent = true;
	check(armStep(arm, reach - 0.05, reach) === false && armStep(arm, reach + 0.01, reach) === false, '  a spent tip still inside (or barely out) may not kick again');
	check(armStep(arm, reach + 0.05, reach) === false && arm.spent === false, '  leaving past the release gap re-arms it');
	check(armStep(arm, reach - 0.01, reach) === true, '  ...and the next swing kicks');
	check(MIN_KICK_SPEED > 0 && MIN_KICK_SPEED < 1, 'MIN_KICK_SPEED is a nudge floor (' + MIN_KICK_SPEED + ' m/s)');
}
