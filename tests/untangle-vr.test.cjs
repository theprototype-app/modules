// untangle-vr test-flight (roadmap 30b, lane 30b-untangle): the Quest round's feedback,
// driven for real where a headless browser can and EMULATED where it cannot (WebXR).
//
//   S  the sound: a real mouse drag across many frames makes ONE 'pop' and ONE 'click' — no
//      per-frame sound — and the board is SILENT a moment after the drop (the old
//      generative pad droned forever and was re-ramped every frame of a drag: the "weird
//      sound"); a solve plays 'success' (+ 'levelup' when it unlocks the next level)
//   V  the CONTROLLER drag (emulated poses): a laser aimed near a dot shows it as the hover,
//      a trigger PRESS grabs it (pop + tap haptic on that hand), the dot follows the hand's
//      ray while held (B sees the previews), the RELEASE drops it (click + bump) and B lands
//      on the identical position; core's trailing select is consumed, never acted on; a TIP
//      touch grabs with the other hand and the dot rides the tip across the board; the other
//      hand's trigger is ignored mid-carry; Edit mode never grabs; the globe; a VR drop that
//      solves pulses 'success' on the dropping hand
//
// VR EMULATION: headless Chromium has no WebXR, so `isVRMode` is set on the store (what the
// core vr* suites do) and the controllers' WORLD poses are fed through the module's test seam
// `__untangle.vrSim({left, right})` — the same {position, quaternion, trigger} shape
// `api.vrHand(hand)` returns on a headset. Everything past the pose (pick, carry, drop,
// replication, haptics) is the real code. The feel on a Quest is OWED.
//
//   npm run pack -- untangle
//   APP_URL=https://theprototype.app:5244/ node tests/untangle-vr.test.cjs

const { launch, setupPage, installModule, connect, check, eventually, finish, run, projectPoint, audioMetrics, AUDIO_ARGS } = require('./helpers.cjs');

const W = 1280;
const H = 720;

const state = (page) => page.evaluate(() => window.__untangle?.state() ?? null);
const sfx = (page) => page.evaluate(() => window.__untangle.sfx());
const dotPx = async (page, i) => projectPoint(page, await page.evaluate((i) => window.__untangle.dotWorld(i), i));
const boardPx = async (page, p) => projectPoint(page, await page.evaluate((p) => window.__untangle.boardWorld(p), p));
const near = (a, b, tol = 0.04) => a.every((v, k) => Math.abs(v - b[k]) <= tol);
/** frame the board head-on in the editor (the orbit target too, or update() reverts it) */
const frameBoard = (page) =>
	page.evaluate(() => {
		let cam, controls;
		window.__stores.globalCamera.subscribe((v) => (cam = v))();
		window.__stores.orbitControls.subscribe((v) => (controls = v))();
		cam.position.set(0, 1.6, 3.2);
		controls.target.set(0, 1.6, 0);
		controls.update();
	});
/** a real drag: move to `from`, press, travel in `steps` frames, release at `to` */
async function drag(page, from, to, { steps = 12, release = true } = {}) {
	await page.mouse.move(from.x, from.y);
	await page.mouse.down();
	for (let k = 1; k <= steps; k++) {
		await page.mouse.move(from.x + ((to.x - from.x) * k) / steps, from.y + ((to.y - from.y) * k) / steps);
		await page.waitForTimeout(16);
	}
	await page.waitForTimeout(120);
	if (release) await page.mouse.up();
}

/** feed the module fake controller poses (merged with the last ones) */
const lastHands = { left: null, right: null };
const setHands = (page, hands) => {
	Object.assign(lastHands, hands);
	return page.evaluate((h) => window.__untangle.vrSim(h), lastHands);
};
/** a controller at `from` whose -Z points at `to`, trigger as given */
const aimPose = (page, from, to, trigger) =>
	page.evaluate(({ from, to, trigger }) => {
		const THREE = window.__stores.THREE;
		const d = new THREE.Vector3(...to).sub(new THREE.Vector3(...from)).normalize();
		return { position: from, quaternion: new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, -1), d).toArray(), trigger };
	}, { from, to, trigger });
/** the board's world frame: centre, outward normal, a far-away aim point, a pose facing the board */
const boardFrame = (page) =>
	page.evaluate(() => {
		const THREE = window.__stores.THREE;
		const w = (p) => new THREE.Vector3(...window.__untangle.boardWorld(p));
		const c = w([0, 0]);
		const n = w([1, 0]).sub(c).cross(w([0, 1]).sub(c)).normalize();
		const faceQ = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, -1), n.clone().negate()).toArray();
		const away = c.clone().add(new THREE.Vector3(0, 6, 0)).add(n.clone().multiplyScalar(4)).toArray();
		return { c: c.toArray(), n: n.toArray(), faceQ, away };
	});

run(async () => {
	const browser = await launch({ args: AUDIO_ARGS });
	const A = await setupPage(browser, 'A', { audio: true, context: { viewport: { width: W, height: H } } });
	const B = await setupPage(browser, 'B');
	await installModule(A, 'untangle');
	await installModule(B, 'untangle');
	await connect(A, B);
	await eventually(() => state(A.page), (s) => !!s && s.built && s.positions.length > 0, 'A: the fallback board stands');
	await eventually(() => state(B.page), (s) => !!s && s.built && s.positions.length > 0, 'B: its own identical board');
	// the board reacts in INTERACT (1.17's editor mode; a core without modes reacts anyway)
	await A.page.evaluate(() => window.__stores.objectActions?.setEditorMode?.('interact'));
	await A.page.evaluate(() => window.__untangle.select(12)); // 9 dots: a test drop cannot solve it by accident
	await eventually(() => state(B.page), (s) => s.level === 12, 'B follows A to level 12');
	await frameBoard(A.page);
	await A.page.waitForTimeout(500);

	// ---- S. the sound ------------------------------------------------------------------------
	const core = (await sfx(A.page)).core;
	console.log('  core sound set (C5): ' + core);
	const log0 = (await sfx(A.page)).log.length;
	// a LONG drag: 40 frames of carry, the case that used to re-ramp the pad every frame
	await drag(A.page, await dotPx(A.page, 0), await boardPx(A.page, [0.5, 0.45]), { steps: 40, release: false });
	const held = await state(A.page);
	const during = (await sfx(A.page)).log.slice(log0).filter((n) => !n.startsWith('music:'));
	check(held.carried === 0, 'S.0 (premise) dot 0 is carried by a real press-drag');
	check(JSON.stringify(during) === '["pop"]', 'S.1 forty frames of carrying made exactly ONE sound, the pick "pop" (' + JSON.stringify(during) + ')');
	await A.page.mouse.up();
	const after = (await sfx(A.page)).log.slice(log0).filter((n) => !n.startsWith('music:'));
	check(JSON.stringify(after) === '["pop","click"]', 'S.2 the drop adds ONE "click" (' + JSON.stringify(after) + ')');
	await A.page.waitForTimeout(500);
	const quiet = await sfx(A.page);
	check(quiet.live === 0, 'S.3 no module voice is still sounding 0.5 s after the drop (' + quiet.live + ' live)');
	if (!core) {
		// a core without the 30b music: the board must be SILENT between events
		const m = await audioMetrics(A, 700);
		check(!m.error && m.samples > 0 && m.contexts >= 1, 'S.4 (premise) the destination tap heard the module (' + m.contexts + ' context(s), ' + m.samples + ' samples)');
		check(m.silent, 'S.5 the board is SILENT between events (peak rms ' + m.peak.toFixed(5) + ' — the old pad droned at ~0.02 forever)');
	} else {
		check(quiet.log.includes('music:puzzle'), 'S.5 (30b core) Interact plays the quiet "puzzle" music');
	}
	// the solve: success, and the level-up for the level it unlocked
	const log1 = (await sfx(A.page)).log.length;
	await A.page.evaluate(() => window.__untangle.solve());
	await eventually(() => sfx(A.page), (s) => s.log.slice(log1).includes('levelup'), 'S.6 a solve that unlocks level 13 plays "success" then "levelup"', 3000);
	const solved = (await sfx(A.page)).log.slice(log1).filter((n) => !n.startsWith('music:') && !n.startsWith('haptic:'));
	const pops = solved.filter((n) => n === 'pop').length;
	check(solved.filter((n) => n === 'success').length === 1 && solved.indexOf('success') < solved.indexOf('levelup'), 'S.7 ONE success, before the levelup (' + [...new Set(solved)].join(',') + ')');
	check(pops === 0, 'S.8 the solve path (authoritative drops) makes no pick pops');
	await eventually(() => B.page.evaluate(() => window.__untangle.sfx()), (s) => s.log.includes('success'), 'S.9 B (lockstep) hears its own success chime');
	await B.page.waitForTimeout(900);
	const bSfx = await B.page.evaluate(() => window.__untangle.sfx());
	check(!bSfx.log.includes('levelup'), 'S.10 B moved no dot: nothing banked, no levelup on B');

	// ---- V. the controller drag (VR emulated) ---------------------------------------------------
	await A.page.evaluate(() => window.__untangle.select(12));
	await eventually(() => state(B.page), (s) => s.level === 12 && !s.won, 'V.0 (premise) a fresh level 12 on both peers');
	await A.page.evaluate(() => window.__stores.isVRMode.set(true));
	await A.page.waitForTimeout(300);
	const board = await boardFrame(A.page);
	const handAt = (world) => world.map((v, k) => v + board.n[k] * 1.2 + [0.25, -0.3, 0][k]);
	const R0 = handAt(board.c);
	const d0 = await A.page.evaluate(() => window.__untangle.dotWorld(0));
	await setHands(A.page, { right: await aimPose(A.page, R0, d0, false), left: await aimPose(A.page, board.away, board.c, false) });
	await A.page.waitForTimeout(200);
	const v1 = await A.page.evaluate(() => ({ vr: window.__untangle.vr(), hovered: window.__untangle.look().hovered }));
	check(v1.vr.on, 'V.0b (premise) the VR drag is on (isVR + poses)');
	check(v1.vr.candidate?.i === 0 && v1.hovered === 0, 'V.1 a laser aimed at dot 0 shows it as the hover (the grab candidate ' + JSON.stringify(v1.vr.candidate) + ', hovered ' + v1.hovered + ')');
	const logV = (await sfx(A.page)).log.length;
	await setHands(A.page, { right: await aimPose(A.page, R0, d0, true) });
	await A.page.waitForTimeout(120);
	const v2 = await state(A.page);
	const log2 = (await sfx(A.page)).log.slice(logV);
	check(v2.carried === 0 && v2.carryMode === 'vr-laser', 'V.2 the RIGHT trigger press grabs dot 0 by the laser (' + v2.carried + ', ' + v2.carryMode + ')');
	check(log2.includes('pop') && log2.includes('haptic:tap:right'), 'V.3 the grab pops and taps the right controller (' + log2.join(',') + ')');
	const T = [0.5, -0.4];
	const tW = await A.page.evaluate((p) => window.__untangle.boardWorld(p), T);
	for (let k = 1; k <= 10; k++) {
		const aim = d0.map((v, j) => v + ((tW[j] - v) * k) / 10);
		await setHands(A.page, { right: await aimPose(A.page, R0, aim, true) });
		await A.page.waitForTimeout(40);
	}
	await A.page.waitForTimeout(150);
	const v3 = await state(A.page);
	check(v3.carried === 0 && near(v3.positions[0], T), 'V.4 while the trigger is held the dot follows the hand\'s ray to (' + T + ') (' + v3.positions[0].map((v) => v.toFixed(3)) + ')');
	await eventually(() => state(B.page), (s) => near(s.positions[0], T, 0.2), 'V.5 B sees the drag previews');
	await setHands(A.page, { right: await aimPose(A.page, R0, tW, false) });
	await A.page.waitForTimeout(150);
	const v4 = await state(A.page);
	const log4 = (await sfx(A.page)).log.slice(logV);
	check(v4.carried === -1 && v4.lastDrop === 'vr-release' && near(v4.positions[0], T), 'V.6 the RELEASE drops it at (' + T + ') (' + v4.lastDrop + ')');
	check(log4.includes('click') && log4.includes('haptic:bump:right'), 'V.7 the drop clicks and bumps the right controller');
	await eventually(() => state(B.page), (s) => JSON.stringify(s.positions[0]) === JSON.stringify(v4.positions[0]), 'V.8 B lands on the IDENTICAL position (the authoritative move)');
	// core's trailing select (it fires on the trigger RELEASE) reaches the click handler
	const trailing = await A.page.evaluate(() => {
		let scene;
		window.__stores.globalScene.subscribe((v) => (scene = v))();
		const consumed = window.__stores.moduleSDK.runClickHandlers(scene.getObjectByName('untangle-dot-0'), null);
		return { consumed, carried: window.__untangle.state().carried };
	});
	check(trailing.consumed && trailing.carried === -1, 'V.9 core\'s trailing select on the dot is consumed and never re-picks it (consumed ' + trailing.consumed + ', carried ' + trailing.carried + ')');
	// a TIP grab with the LEFT hand: the tip touches dot 1 from the front
	const d1 = await A.page.evaluate(() => window.__untangle.dotWorld(1));
	const L1 = d1.map((v, k) => v + board.n[k] * 0.02);
	const tipPose = (at, trigger) => ({ position: at, quaternion: board.faceQ, trigger });
	await setHands(A.page, { left: tipPose(L1, false), right: await aimPose(A.page, R0, board.away, false) });
	await A.page.waitForTimeout(120);
	await setHands(A.page, { left: tipPose(L1, true) });
	await A.page.waitForTimeout(120);
	const v5 = await state(A.page);
	check(v5.carried === 1 && v5.carryMode === 'vr-tip', 'V.10 the LEFT tip touching dot 1 grabs it by the TIP (' + v5.carried + ', ' + v5.carryMode + ')');
	const d2 = await A.page.evaluate(() => window.__untangle.dotWorld(2));
	await setHands(A.page, { right: await aimPose(A.page, R0, d2, false) });
	await A.page.waitForTimeout(60);
	await setHands(A.page, { right: await aimPose(A.page, R0, d2, true) });
	await A.page.waitForTimeout(120);
	check((await state(A.page)).carried === 1, 'V.11 the RIGHT trigger mid-carry is ignored (still carrying dot 1)');
	await setHands(A.page, { right: await aimPose(A.page, R0, board.away, false) });
	const T2 = [-0.5, 0.5];
	const t2W = await A.page.evaluate((p) => window.__untangle.boardWorld(p), T2);
	for (let k = 1; k <= 10; k++) {
		const at = d1.map((v, j) => v + ((t2W[j] - v) * k) / 10 + board.n[j] * 0.05);
		await setHands(A.page, { left: tipPose(at, true) });
		await A.page.waitForTimeout(40);
	}
	await A.page.waitForTimeout(150);
	const v6 = await state(A.page);
	check(v6.carried === 1 && near(v6.positions[1], T2), 'V.12 the dot rides the LEFT tip across the board, 5 cm off it (' + v6.positions[1].map((v) => v.toFixed(3)) + ')');
	await setHands(A.page, { left: tipPose(t2W.map((v, j) => v + board.n[j] * 0.05), false) });
	await A.page.waitForTimeout(150);
	const v7 = await state(A.page);
	check(v7.carried === -1 && near(v7.positions[1], T2) && (await sfx(A.page)).log.includes('haptic:bump:left'), 'V.13 the left release drops it there and bumps the LEFT controller');
	await eventually(() => state(B.page), (s) => JSON.stringify(s.positions[1]) === JSON.stringify(v7.positions[1]), 'V.14 B agrees');
	// EDIT mode: the board stands down (the grips belong to the world there)
	const hasModes = await A.page.evaluate(() => typeof window.__stores.objectActions?.setEditorMode === 'function');
	if (hasModes) {
		await A.page.evaluate(() => window.__stores.objectActions.setEditorMode('edit'));
		const d3 = await A.page.evaluate(() => window.__untangle.dotWorld(3));
		await setHands(A.page, { right: await aimPose(A.page, R0, d3, false) });
		await A.page.waitForTimeout(80);
		await setHands(A.page, { right: await aimPose(A.page, R0, d3, true) });
		await A.page.waitForTimeout(150);
		check((await state(A.page)).carried === -1, 'V.15 in EDIT a trigger press on a dot grabs nothing');
		await setHands(A.page, { right: await aimPose(A.page, R0, d3, false) });
		await A.page.evaluate(() => window.__stores.objectActions.setEditorMode('interact'));
		await A.page.waitForTimeout(100);
	}
	// the VR drop that SOLVES: every dot but 0 on the ring, dot 0 somewhere that crosses. The
	// layout is put on BOTH peers as a (newer) state snapshot — authoritative drops would check
	// the win on the way and could solve the board before the VR drop
	const ring = (i, n) => [Math.cos((i / n) * Math.PI * 2) * 0.85, Math.sin((i / n) * Math.PI * 2) * 0.85];
	const s16 = await state(A.page);
	const n = s16.positions.length;
	let crossing = false;
	for (const spot of [[-0.85, 0], [0, 0], [0, 0.3], [-0.3, -0.2], [0.2, 0.6]]) {
		const layout = { level: s16.level, mode: '2d', positions: s16.positions.map((_, i) => (i === 0 ? spot : ring(i, n))), rev: s16.rev + 50 };
		for (const peer of [A, B]) await peer.page.evaluate((st) => window.__stores.moduleSDK.applyModuleStates({ untangle: st }), layout);
		if ((await state(A.page)).crossings > 0) {
			crossing = true;
			break;
		}
	}
	check(crossing && !(await state(A.page)).won && !(await state(B.page)).won, 'V.16 (premise) the ring minus dot 0 still crosses, on both peers');
	const d0b = await A.page.evaluate(() => window.__untangle.dotWorld(0));
	const goal = await A.page.evaluate((p) => window.__untangle.boardWorld(p), ring(0, n));
	await setHands(A.page, { right: await aimPose(A.page, R0, d0b, false) });
	await A.page.waitForTimeout(80);
	await setHands(A.page, { right: await aimPose(A.page, R0, d0b, true) });
	await A.page.waitForTimeout(100);
	for (let k = 1; k <= 6; k++) {
		await setHands(A.page, { right: await aimPose(A.page, R0, d0b.map((v, j) => v + ((goal[j] - v) * k) / 6), true) });
		await A.page.waitForTimeout(40);
	}
	const logS = (await sfx(A.page)).log.length;
	await setHands(A.page, { right: await aimPose(A.page, R0, goal, false) });
	await A.page.waitForTimeout(200);
	const v8 = await state(A.page);
	const log8 = (await sfx(A.page)).log.slice(logS);
	check(v8.won && log8.includes('success') && log8.includes('haptic:success:right'), 'V.17 the VR drop that solves chimes and pulses "success" on the RIGHT controller (' + log8.join(',') + ')');
	await eventually(() => state(B.page), (s) => s.won, 'V.18 B solves in lockstep');
	// the GLOBE: a laser grab on a front dot carries it across the sphere
	await A.page.evaluate(() => window.__untangle.select(12, '3d'));
	await eventually(() => state(B.page), (s) => s.mode === '3d' && s.level === 12, 'V.19 (premise) both peers on the level-12 globe');
	await A.page.waitForTimeout(200);
	const globe = await A.page.evaluate(() => {
		const s = window.__untangle.state();
		const all = s.positions.map((_, i) => window.__untangle.dotWorld(i));
		let front = 0;
		all.forEach((p, i) => { if (p[2] > all[front][2]) front = i; });
		return { front, world: all[front], centre: window.__untangle.boardWorld([0, 0, 0]) };
	});
	const G0 = [globe.centre[0] + 0.2, globe.centre[1] - 0.2, globe.centre[2] + 1.8];
	await setHands(A.page, { right: await aimPose(A.page, G0, globe.world, false), left: await aimPose(A.page, board.away, globe.centre, false) });
	await A.page.waitForTimeout(80);
	await setHands(A.page, { right: await aimPose(A.page, G0, globe.world, true) });
	await A.page.waitForTimeout(120);
	const g1 = await state(A.page);
	check(g1.carried === globe.front && g1.carryMode === 'vr-laser', 'V.20 a laser grabs the globe\'s front dot ' + globe.front + ' (' + g1.carried + ')');
	const g0 = g1.positions[globe.front];
	const gAim = [globe.centre[0] - 0.3, globe.centre[1] + 0.35, globe.centre[2]];
	for (let k = 1; k <= 8; k++) {
		await setHands(A.page, { right: await aimPose(A.page, G0, globe.world.map((v, j) => v + ((gAim[j] - v) * k) / 8), true) });
		await A.page.waitForTimeout(40);
	}
	await setHands(A.page, { right: await aimPose(A.page, G0, gAim, false) });
	await A.page.waitForTimeout(150);
	const g2 = await state(A.page);
	const gp = g2.positions[globe.front];
	const moved = Math.hypot(gp[0] - g0[0], gp[1] - g0[1], gp[2] - g0[2]);
	check(g2.carried === -1 && moved > 0.2 && Math.abs(Math.hypot(...gp) - 1) < 1e-6, 'V.21 the release drops it elsewhere on the sphere (moved ' + moved.toFixed(3) + ', |p| ' + Math.hypot(...gp).toFixed(6) + ')');
	await eventually(() => state(B.page), (s) => JSON.stringify(s.positions[globe.front]) === JSON.stringify(g2.positions[globe.front]), 'V.22 B lands on the identical unit vector');
	await A.page.evaluate(() => window.__untangle.select(12, '2d'));
	await A.page.evaluate(() => window.__untangle.vrSim(null));
	await A.page.evaluate(() => window.__stores.isVRMode.set(false));

	await finish(browser);
});
