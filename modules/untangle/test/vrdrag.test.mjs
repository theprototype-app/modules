// vrdrag.js — the VR trigger drag: the ray/tip math and the per-hand state machine.
import { quatRotate, handRay, tipOf, rayPlane, closestOnPlane, raySphere, sphereRim, pickDot, followPoint, createVRDrag, TIP_AHEAD, TIP_RADIUS, REACH, CONSUME_MS } from '../src/vrdrag.js';

const near = (a, b, tol = 1e-6) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) <= tol);
/** yaw (about +Y) as a quaternion [x, y, z, w] */
const yaw = (rad) => [0, Math.sin(rad / 2), 0, Math.cos(rad / 2)];
const pose = (position, quaternion = [0, 0, 0, 1], trigger = false) => ({ position, quaternion, trigger });

export function run(check) {
	// ---- the math
	check(near(quatRotate([0, 0, 0, 1], [0, 0, -1]), [0, 0, -1]), 'identity quaternion leaves -Z alone');
	check(near(quatRotate(yaw(Math.PI / 2), [0, 0, -1]), [-1, 0, 0]), 'a +90 deg yaw turns -Z to -X (three.js convention)');
	const r = handRay(pose([1, 1.5, 2], yaw(Math.PI / 2)));
	check(near(r.origin, [1, 1.5, 2]) && near(r.dir, [-1, 0, 0]), 'handRay: from the controller along its -Z');
	check(near(tipOf(pose([0, 1, 0])), [0, 1, -TIP_AHEAD]), 'the tip sits TIP_AHEAD in front of the ray origin');
	check(near(rayPlane([0, 1.6, 3], [0, 0, -1], [0, 1.6, 0], [0, 0, 1]), [0, 1.6, 0]), 'rayPlane: straight at the board hits its centre');
	check(rayPlane([0, 1.6, 3], [0, 0, 1], [0, 1.6, 0], [0, 0, 1]) === null, 'rayPlane: pointing away from the board -> null');
	check(rayPlane([0, 1.6, 3], [1, 0, 0], [0, 1.6, 0], [0, 0, 1]) === null, 'rayPlane: parallel -> null');
	check(near(closestOnPlane([0.3, 1.2, 0.25], [0, 1.6, 0], [0, 0, 1]), [0.3, 1.2, 0]), 'closestOnPlane drops the tip straight onto the board');
	check(near(raySphere([0, 0, 5], [0, 0, -1], [0, 0, 0], 1), [0, 0, 1]), 'raySphere: the NEAR hit');
	check(raySphere([0, 3, 5], [0, 0, -1], [0, 0, 0], 1) === null, 'raySphere: a miss -> null');
	check(near(sphereRim([0, 3, 5], [0, 0, -1], [0, 0, 0], 1), [0, 1, 0]), 'sphereRim: a miss above lands on the top of the rim');

	// ---- the pick: tip beats laser, reach, behind the hand, front limit
	const dots = [[0, 1.6, 0], [0.4, 1.6, 0], [-0.4, 1.2, 0]];
	const radius = 0.1;
	check(pickDot({ pose: pose([0.4, 1.6, 0.12]), dots, radius })?.how === 'tip' && pickDot({ pose: pose([0.4, 1.6, 0.12]), dots, radius }).i === 1, 'the tip touching dot 1 grabs it by the TIP');
	check(pickDot({ pose: pose([0.4, 1.6, 0.12 + TIP_RADIUS + 0.01]), dots, radius })?.how === 'laser', 'just out of tip reach, the same hand grabs by the LASER (it points at the dot)');
	const aimAt = (target, from) => {
		const d = [target[0] - from[0], target[1] - from[1], target[2] - from[2]];
		// a yaw+pitch quaternion whose -Z points along d
		const yawA = Math.atan2(-d[0], -d[2]);
		const pitch = Math.atan2(d[1], Math.hypot(d[0], d[2]));
		const qy = yaw(yawA);
		const qx = [Math.sin(pitch / 2), 0, 0, Math.cos(pitch / 2)];
		// q = qy * qx
		const [ax, ay, az, aw] = qy;
		const [bx, by, bz, bw] = qx;
		return [aw * bx + ax * bw + ay * bz - az * by, aw * by - ax * bz + ay * bw + az * bx, aw * bz + ax * by - ay * bx + az * bw, aw * bw - ax * bx - ay * by - az * bz];
	};
	const hand = [0.2, 1.4, 1.5];
	const q2 = aimAt(dots[2], hand);
	check(near(handRay(pose(hand, q2)).dir.map((v) => Math.round(v * 1e6) / 1e6), (() => {
		const d = [dots[2][0] - hand[0], dots[2][1] - hand[1], dots[2][2] - hand[2]];
		const l = Math.hypot(...d);
		return d.map((v) => Math.round((v / l) * 1e6) / 1e6);
	})(), 2e-6), '(premise) the test aims a hand exactly at dot 2');
	check(pickDot({ pose: pose(hand, q2), dots, radius })?.i === 2, 'the laser from 1.5 m picks the dot it points at (dot 2)');
	// a slightly shaky aim: 1.2 radii off still counts, 1.5 does not
	const off = (k) => pose(hand, aimAt([dots[2][0] + radius * k, dots[2][1], dots[2][2]], hand));
	check(pickDot({ pose: off(1.2), dots, radius })?.i === 2, 'a laser 1.2 radii off the dot still grabs it (a hand shakes)');
	check(pickDot({ pose: off(REACH + 0.3), dots, radius }) === null, 'a laser ' + (REACH + 0.3) + ' radii off grabs nothing');
	check(pickDot({ pose: pose([0, 1.6, -1]), dots, radius }) === null, 'a dot BEHIND the hand is never grabbed');
	check(pickDot({ pose: pose([0, 1.6, 2]), dots: [[0, 1.6, -1]], radius, frontLimit: 1 }) === null, 'a dot past the globe front face (frontLimit) is hidden');

	// ---- follow: laser on the plane, tip on the plane, the globe
	const plane = { kind: 'plane', point: [0, 1.6, 0], normal: [0, 0, 1] };
	check(near(followPoint('laser', pose(hand, q2), plane), dots[2], 1e-6), 'a laser carry lands where the ray meets the board');
	check(near(followPoint('tip', pose([0.3, 1.7, 0.05]), plane), [0.3, 1.7, 0], 1e-9), 'a tip carry rides the tip, projected onto the board');
	const globe = { kind: 'sphere', centre: [0, 1.6, 0], r: 1 };
	check(near(followPoint('laser', pose([0, 1.6, 3]), globe), [0, 1.6, 1]), 'a laser carry on the globe lands on its near face');
	check(near(followPoint('tip', pose([0, 1.6, 2]), globe), [0, 1.6, 1]), 'a tip carry on the globe rides the radial projection of the tip');
	check(near(followPoint('laser', pose([0, 4, 3]), globe), [0, 2.6, 0]), 'a laser past the globe clamps to the rim (the dot never freezes)');

	// ---- the state machine
	let t = 0;
	const events = [];
	let carried = -1;
	const board = { pickable: true, hit: /** @type {any} */ ({ i: 3, how: 'laser' }) };
	const vr = createVRDrag({
		canPick: () => board.pickable,
		pickAt: () => board.hit,
		pick: (i, h, how) => {
			carried = i;
			events.push('pick:' + i + ':' + h + ':' + how);
		},
		follow: (p, h) => events.push('follow:' + h),
		drop: (h, why) => {
			carried = -1;
			events.push('drop:' + h + ':' + why);
		},
		carrying: () => carried !== -1,
		now: () => t
	});
	const P = (trigger) => pose([0, 1.5, 1], [0, 0, 0, 1], trigger);
	vr.update({ left: P(false), right: P(false) });
	check(events.length === 0 && vr.candidate()?.i === 3, 'no trigger -> nothing happens, but the candidate (VR hover) is dot 3');
	vr.update({ left: P(true), right: P(false) });
	check(events.join() === 'pick:3:left:laser' && vr.carrier()?.hand === 'left', 'the LEFT trigger press picks dot 3 with the left hand');
	check(vr.recent(), 'the pick is recent (core\'s trailing select will be consumed)');
	t += CONSUME_MS + 1;
	check(!vr.recent(), '...and stops being recent after CONSUME_MS');
	vr.update({ left: P(true), right: P(true) });
	vr.update({ left: P(true), right: P(true) });
	check(events.filter((e) => e.startsWith('follow:left')).length === 2 && !events.some((e) => e.startsWith('pick:3:right')), 'while held the dot follows the LEFT hand; the right trigger is ignored');
	vr.update({ left: P(false), right: P(true) });
	check(events.at(-1) === 'drop:left:release' && carried === -1, 'releasing the LEFT trigger drops it');
	vr.update({ left: P(false), right: P(true) });
	check(events.at(-1) === 'drop:left:release', 'a trigger already held (right) does not pick on its own — only a PRESS does');
	vr.update({ left: P(false), right: P(false) });
	vr.update({ left: P(false), right: P(true) });
	check(events.at(-1) === 'pick:3:right:laser', 'a fresh right press picks');
	vr.update({ left: P(false), right: null });
	check(events.at(-1) === 'drop:right:lost', 'the carrying hand losing tracking drops the dot');
	board.hit = null;
	const n = events.length;
	vr.update({ left: P(false), right: P(false) });
	vr.update({ left: P(true), right: P(false) });
	check(events.length === n && vr.candidate() === null, 'a press on nothing picks nothing');
	board.hit = { i: 1, how: 'tip' };
	board.pickable = false;
	vr.update({ left: P(false), right: P(false) });
	vr.update({ left: P(false), right: P(true) });
	check(events.length === n, 'an inert board (Edit mode) never picks');
	board.pickable = true;
	vr.update({ left: P(false), right: P(false) });
	vr.update({ left: P(false), right: P(true) });
	check(events.at(-1) === 'pick:1:right:tip', 'a tip touch picks by the tip');
	carried = -1; // dropped by another path (a level change)
	vr.update({ left: P(false), right: P(true) });
	check(vr.carrier() === null && events.at(-1) === 'pick:1:right:tip', 'a carry ended elsewhere is forgotten (no phantom drop, no re-pick while held)');

	// ---- onPress: a press that grabs no dot is offered to the level bar
	{
		let t2 = 0;
		const presses = [];
		const hit = { value: /** @type {any} */ (null) };
		let held = -1;
		const m = createVRDrag({
			canPick: () => true,
			pickAt: () => hit.value,
			pick: (i) => (held = i),
			follow: () => {},
			drop: () => (held = -1),
			carrying: () => held !== -1,
			onPress: (p, h) => (presses.push(h), true),
			now: () => t2
		});
		m.update({ left: null, right: P(false) });
		m.update({ left: null, right: P(true) });
		check(presses.join() === 'right' && m.recent(), 'a press on no dot goes to onPress, and its trailing select counts as ours (recent)');
		m.update({ left: null, right: P(true) });
		check(presses.length === 1, 'a HELD trigger offers nothing more (a press is an edge)');
		m.update({ left: null, right: P(false) });
		hit.value = { i: 2, how: 'laser' };
		m.update({ left: null, right: P(true) });
		check(held === 2 && presses.length === 1, 'a press that grabs a dot never reaches onPress');
		m.update({ left: P(false), right: P(true) });
		hit.value = null;
		m.update({ left: P(true), right: P(true) });
		check(presses.length === 1, 'mid-carry the other hand\'s press reaches nothing');
	}

	// ---- the globe HOLD: one hand holds, the other still carries a dot
	{
		const ev = [];
		const dotHit = { value: /** @type {any} */ (null) };
		let held = -1;
		const m = createVRDrag({
			canPick: () => true,
			pickAt: () => dotHit.value,
			pick: (i, h) => ((held = i), ev.push('pick:' + i + ':' + h)),
			follow: (p, h) => ev.push('follow:' + h),
			drop: (h) => ((held = -1), ev.push('drop:' + h)),
			carrying: () => held !== -1,
			onPress: () => false,
			grabAt: (p, h) => (ev.push('grab:' + h), true),
			hold: (p, h) => ev.push('hold:' + h),
			release: (h, why) => ev.push('release:' + h + ':' + why)
		});
		m.update({ left: P(false), right: P(false) });
		m.update({ left: P(false), right: P(true) });
		check(m.holder()?.hand === 'right' && ev.join() === 'grab:right', 'a press on no dot and no bar HOLDS the globe (grabAt)');
		dotHit.value = { i: 4, how: 'laser' };
		m.update({ left: P(false), right: P(true) });
		m.update({ left: P(true), right: P(true) });
		check(m.carrier()?.hand === 'left' && held === 4, 'while the right hand holds the globe the LEFT hand grabs a dot');
		const k = ev.length;
		m.update({ left: P(true), right: P(true) });
		check(ev.slice(k).join() === 'hold:right,follow:left', 'each frame the hold moves the globe FIRST, then the dot follows its hand');
		dotHit.value = null;
		m.update({ left: P(true), right: P(false) });
		check(ev.at(-2) === 'release:right:release' && m.holder() === null && m.carrier()?.hand === 'left', 'releasing the right trigger lets the globe go; the left carry goes on');
		m.update({ left: P(false), right: P(false) });
		check(ev.at(-1) === 'drop:left' && held === -1, '...and the left release drops the dot');
		m.update({ left: P(false), right: P(true) });
		m.update({ left: P(true), right: P(true) });
		check(m.holder()?.hand === 'right' && ev.filter((e) => e.startsWith('grab:')).length === 2, 'the second hand\'s press cannot take a globe that is already held');
		m.update({ left: P(true), right: null });
		check(ev.at(-1) === 'release:right:lost', 'the holding hand losing tracking lets the globe go');
	}
}
