// football 30b test-flight — "I should be able, in interact mode, to knock the ball with the
// controller". The REAL zip on two peers, the recipe pitch, the sim on A. A headless browser
// has no WebXR, so the headset is EMULATED the way core's suites do it (`isVRMode` on) and the
// hand is driven through the kicker's feed — the same code api.vrHand feeds every frame:
//   1 B's controller TIP swung through the ball kicks it: the touch replicates, the kick
//     travels as one op and the physics initiator (A) applies it — the ball flies along the
//     swing; B's hand buzzes harder for a harder kick; both peers play the `kick` sound
//   2 one swing is ONE kick however long the tip stays inside; a slow nudge is no kick; the
//     same swing right after B's own core knock is not a second touch (dedupe)
//   3 not in a headset (isVRMode off) the tip never kicks — the desktop has its own paths
//   4 a CLICK on the ball (desktop Interact/Play, the VR trigger) kicks it away from the
//     player within reach; out of reach it does nothing
//   5 a ball thrown at the glass sounds a `hit` where it bounces (every peer, no message)
//
//   npm run build:football && npm run pack -- football
//   flock -w 5400 /tmp/tp-e2e.lock env APP_URL=https://theprototype.app:5245/ npm test -- football-kick

const { launch, setupPage, installModule, connect, check, eventually, finish, run, GPU_ARGS } = require('./helpers.cjs');

const snap = (page) => page.evaluate(() => window.__football?.snapshot() ?? null);
const fxLog = (page) => page.evaluate(() => window.__football.game.fx.log());
const clearFx = (page) => page.evaluate(() => window.__football.game.fx.clearLog());
const phaseOf = (page) => page.evaluate(() => window.__football.game.phase());
const kicks = (page) => page.evaluate(() => window.__football.kicker.kicks());
const posOf = (page, uuid) =>
	page.evaluate((uuid) => {
		let g = null;
		window.__stores.objectsGroup.subscribe((v) => (g = v))();
		return g?.getObjectByProperty('uuid', uuid)?.position.toArray() ?? null;
	}, uuid);
const velOf = (page, uuid) =>
	page.evaluate((uuid) => {
		const b = window.__stores.physics.physicsDebug().find((e) => e.uuid === uuid);
		return b?.linvel ? [b.linvel.x, b.linvel.y, b.linvel.z] : null;
	}, uuid);
/** park the ball, still, on the initiator */
const park = (page, uuid, pos) => page.evaluate(({ uuid, pos }) => window.__stores.physics.applyThrow({ uuid, pos, rot: [0, 0, 0], linvel: [0, 0, 0], angvel: [0, 0, 0] }), { uuid, pos });
/**
 * Swing `hand`'s controller along +x through the ball's CURRENT position on this page at
 * `speed` m/s (a synthetic 16 ms clock), the tip passing through the ball's centre. `dwell`
 * extra frames with the tip parked inside the ball after the pass.
 */
const swing = (page, uuid, speed, opts = {}) =>
	page.evaluate(
		({ uuid, speed, hand, dwell }) => {
			let g = null;
			window.__stores.objectsGroup.subscribe((v) => (g = v))();
			const o = g?.getObjectByProperty('uuid', uuid);
			if (!o) return { kicks: 0, live: false };
			const k = window.__football.kicker;
			const [bx, by, bz] = o.getWorldPosition(new o.position.constructor()).toArray();
			// an unrotated controller's tip sits 5 cm along its -Z: hold it 5 cm behind in z
			const cz = bz + 0.05;
			let kicks = 0;
			let live = true;
			let t = 5000;
			const step = (speed * 16) / 1000;
			for (let x = bx - 0.7; x <= bx - 0.05; x += step) {
				const r = k.feed(hand, [x, by, cz], [0, 0, 0, 1], t);
				kicks += r.kicks;
				live = live && r.live;
				t += 16;
			}
			for (let i = 0; i < dwell; i++) {
				const r = k.feed(hand, [bx - 0.05 + i * 0.001, by, cz], [0, 0, 0, 1], t);
				kicks += r.kicks;
				t += 16;
			}
			return { kicks, live };
		},
		{ uuid, speed, hand: opts.hand ?? 'right', dwell: opts.dwell ?? 0 }
	);
const has = (log, kind, name, pred = () => true) => log.some((c) => c.kind === kind && c.name === name && pred(c));

run(async () => {
	const browser = await launch({ args: GPU_ARGS });
	const A = await setupPage(browser, 'A');
	const B = await setupPage(browser, 'B');
	await installModule(A, 'football');
	await installModule(B, 'football');
	const names = await A.page.evaluate(() => window.__football.toolbox.buildPitch());
	const ball = names['Football'];
	await A.page.evaluate(() =>
		window.__stores.scenePhysics.setScenePhysics({
			gravity: 0, ground: { enabled: false }, damping: { linear: 1.2, angular: 0.5 }, ccd: true,
			knock: { enabled: true, gain: 1, maxSpeed: 10, spin: 0.8 }, play: { interaction: 'grab', grounded: false, simOnPlay: true }
		})
	);
	await eventually(() => snap(A.page), (s) => s?.ball === ball, '0.1 A: the module owns the ball');
	await connect(A, B);
	await eventually(() => snap(B.page), (s) => s?.ball === ball && Object.keys(s.gates).length === 2, '0.2 B: the pitch replicated', 30000);
	await A.page.locator('#play-button').click();
	await eventually(() => A.page.evaluate(() => { let v; window.__stores.physics.simulating.subscribe((x) => (v = x))(); return v; }), (v) => v === true, '0.3 A simulates', 20000);
	await B.page.locator('#play-button').click();
	await eventually(() => snap(A.page), (s) => s?.authority === true, '0.4 A is the authority');
	// a live match (the kicks below must not fall inside a kick-off countdown, which holds the ball)
	await A.page.evaluate(() => window.__football.game.act('start'));
	await eventually(() => phaseOf(A.page), (p) => p === 'live', '0.5 a match is live', 12000);
	await eventually(() => phaseOf(B.page), (p) => p === 'live', '0.6 B: live too', 6000);

	// ---- 3 first: not in a headset, the tip never kicks ---------------------------------------
	await park(A.page, ball, [0, 1.35, 0.6]);
	await eventually(() => posOf(B.page, ball), (p) => !!p && Math.abs(p[2] - 0.6) < 0.03, '  (premise) B sees the ball parked');
	const flat = await swing(B.page, ball, 3);
	check(flat.live === false && flat.kicks === 0, '3.1 no headset (isVRMode off): the tip is not live and kicks nothing (' + JSON.stringify(flat) + ')');

	// ---- 1. B's tip kicks the ball --------------------------------------------------------------
	await B.page.evaluate(() => window.__stores.isVRMode.set(true));
	check(await B.page.evaluate(() => window.__football.kicker.tipsLive()), '1.0 B in an (emulated) headset in play: the tips are live');
	await clearFx(A.page);
	await clearFx(B.page);
	const k1 = await swing(B.page, ball, 3, { dwell: 12 });
	check(k1.live && k1.kicks === 1, '1.1 a 3 m/s swing through the ball is ONE kick, the tip dwelling inside after it (' + JSON.stringify(k1) + ')');
	await eventually(() => velOf(A.page, ball), (v) => !!v && v[0] > 1.5, '1.2 the initiator (A) applied it: the ball flies +x along the swing (' + JSON.stringify(await velOf(A.page, ball)) + ')', 4000);
	await eventually(() => snap(A.page), (s) => s?.lastTouch?.by === B.id, '1.3 A: last touch = B (the kick crossed the wire)');
	check((await snap(B.page)).lastTouch?.by === B.id, '1.4 B: last touch = B');
	const bLog = await fxLog(B.page);
	const pulse1 = bLog.find((c) => c.kind === 'pulse');
	check(!!pulse1 && Number(pulse1.name) > 0.25 && pulse1.opts?.hand === 'right', "1.5 B's right hand buzzes, scaled by the kick (" + pulse1?.name + ')');
	check(has(bLog, 'sound', 'kick'), '1.6 B hears the kick');
	await eventually(() => fxLog(A.page), (log) => has(log, 'sound', 'kick'), '1.7 A hears it too');

	// ---- 2. the guards ------------------------------------------------------------------------------
	await park(A.page, ball, [0, 1.35, 0.6]);
	await eventually(() => posOf(B.page, ball), (p) => !!p && Math.abs(p[0]) < 0.03 && Math.abs(p[2] - 0.6) < 0.03, '  (premise) parked again');
	await B.page.waitForTimeout(300);
	const slow = await swing(B.page, ball, 0.2);
	check(slow.kicks === 0, '2.1 a 0.2 m/s nudge is not a kick (' + JSON.stringify(slow) + ')');
	await clearFx(B.page);
	const k2 = await swing(B.page, ball, 5, { dwell: 20 });
	const pulse2 = (await fxLog(B.page)).find((c) => c.kind === 'pulse');
	check(k2.kicks === 1 && Number(pulse2?.name) > Number(pulse1?.name), '2.2 a harder swing: one kick, a stronger buzz (' + pulse1?.name + ' -> ' + pulse2?.name + ')');
	// dedupe: B's CORE knock takes the touch first, the tip swing right after is not a second one
	await park(A.page, ball, [0, 1.35, 0.6]);
	await eventually(() => posOf(B.page, ball), (p) => !!p && Math.abs(p[0]) < 0.03 && Math.abs(p[2] - 0.6) < 0.03, '  (premise) parked again');
	await B.page.waitForTimeout(300);
	const before = await kicks(B.page);
	const both = await B.page.evaluate((uuid) => {
		let g = null;
		window.__stores.objectsGroup.subscribe((v) => (g = v))();
		const o = g.getObjectByProperty('uuid', uuid);
		const [bx, by, bz] = o.position.toArray();
		const knock = window.__stores.knock;
		knock.dropProbe('dd');
		let hits = 0;
		let t = 1000;
		for (let x = bx - 0.8; x <= bx + 0.05; x += 0.064) {
			hits += knock.feedProbe('dd', [x, by, bz], t).hits;
			t += 16;
		}
		knock.dropProbe('dd');
		let kicks = 0;
		t = 9000;
		for (let x = bx - 0.7; x <= bx - 0.05; x += 0.064) {
			kicks += window.__football.kicker.feed('left', [x, by, bz + 0.05], [0, 0, 0, 1], t).kicks;
			t += 16;
		}
		return { hits, kicks };
	}, ball);
	check(both.hits >= 1 && both.kicks === 0 && (await kicks(B.page)) === before, "2.3 right after B's own core knock the tip swing is NOT a second touch (" + JSON.stringify(both) + ')');

	// ---- 4. a click kicks the ball away from the player -------------------------------------------
	await B.page.evaluate(() => window.__stores.isVRMode.set(false));
	const player = await A.page.evaluate(() => window.__football.player());
	check(Array.isArray(player), '4.0 (premise) A has a camera position (' + JSON.stringify(player) + ')');
	// the ball 1.5 m in front of the player (toward the pitch centre), still
	const toward = [0 - player[0], 0, 0 - player[2]];
	const tl = Math.hypot(toward[0], toward[2]) || 1;
	const near = [player[0] + (toward[0] / tl) * 1.5, 1.35, player[2] + (toward[2] / tl) * 1.5];
	await park(A.page, ball, near);
	await A.page.waitForTimeout(300);
	const clickAt = (page, uuid) =>
		page.evaluate((uuid) => {
			let g = null;
			window.__stores.objectsGroup.subscribe((v) => (g = v))();
			const o = g.getObjectByProperty('uuid', uuid);
			return window.__stores.moduleSDK.moduleClickHandlers.some((h) => h(o));
		}, uuid);
	check(await clickAt(A.page, ball), '4.1 a click on the ball within reach is consumed (a kick)');
	await eventually(() => velOf(A.page, ball), (v) => !!v && (v[0] * toward[0] + v[2] * toward[2]) / tl > 2, '4.2 ...and the ball flies AWAY from the player (' + JSON.stringify(await velOf(A.page, ball)) + ')', 3000);
	await park(A.page, ball, [0, 1.35, -1.8]);
	await A.page.waitForTimeout(300);
	check(!(await clickAt(A.page, ball)), '4.3 counterfactual: out of reach (' + Math.hypot(player[0], player[1] - 1.35, player[2] + 1.8).toFixed(1) + ' m) a click does nothing');

	// ---- 5. the ball sounds where it bounces --------------------------------------------------------
	await clearFx(A.page);
	await clearFx(B.page);
	await A.page.evaluate((uuid) => window.__stores.physics.applyThrow({ uuid, pos: [0.6, 1.35, 0.5], rot: [0, 0, 0], linvel: [5, 0, 0], angvel: [0, 0, 0] }), ball);
	await eventually(() => fxLog(A.page), (log) => has(log, 'sound', 'hit'), '5.1 A: the ball hits the glass and sounds (`hit`)', 4000);
	await eventually(() => fxLog(B.page), (log) => has(log, 'sound', 'hit'), '5.2 B hears the bounce too (from the ball it renders, no message)', 4000);

	await finish(browser);
});
