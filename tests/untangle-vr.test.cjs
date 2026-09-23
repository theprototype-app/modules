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
//   W  the board follows the WORLD: hung under the real world rig (what core's world root
//      does for module content, 30b-vr-modes P5) and the rig turned / moved / scaled, the
//      dots follow it; a real mouse drag and a VR laser drag on the turned board land where
//      aimed (the drag plane is WORLD space); a level change rebuilds the board under the
//      rig with no orphan left behind; a scene clear takes it out of the rig
//   M  the VR LEVEL BAR under the board, by laser: hidden on a desktop and in Edit, shown in
//      VR Interact; the laser's hover lights a cell; a trigger press on ▶ / ◀ steps to the
//      next / previous UNLOCKED level on both peers (a locked ▶ does nothing), the mode cell
//      flips to the globe on both peers, ↺ restarts the level; core's trailing select on
//      the bar is consumed
//   G  HOLD the globe with one hand's trigger (not on a dot): it rides the hand rigidly —
//      the centre and every dot follow the controller's move AND turn; the holding hand's
//      stick scales it and the dots scale with it; meanwhile the OTHER hand grabs a dot and
//      carries it across the moving globe (it stays under that hand's ray), drops it, and B
//      lands on the identical unit vector; the hold is LOCAL (B's globe did not move);
//      left-stick walking is paused while holding; the flat board has no hold
//   Y  the core's VR panel (C2 draws 'vr-game-panel' / 'vr-game-wrist' on top of the world and
//      presses its own buttons) takes the laser: with one on the hand's ray the board neither
//      hovers, grabs a dot, presses the level bar nor holds the globe behind it; a TIP touch
//      still grabs; a hidden panel blocks nothing; a VR click core dispatches on any mesh of
//      the board (the plate) is consumed. (A stand-in mesh with the core's name —
//      the real one draws only while presenting.)
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
		const r = w([1, 0]).sub(c).normalize();
		return { c: c.toArray(), n: n.toArray(), r: r.toArray(), faceQ, away };
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
	// a 30b core (C6 + announce): the solve bursts sparkles and says it in the big banner
	const caps = await A.page.evaluate(() => window.__untangle.caps());
	console.log('  core seams: ' + JSON.stringify(caps));
	if (caps.effects) check(solved.includes('burst:sparkle'), 'S.8b (30b core) the solve fires an api.effects sparkle burst at the board');
	if (caps.announce) {
		check(solved.includes('announce:Level 12 solved'), 'S.8c (30b core) the solve announces "Level 12 solved"');
		const banner = await A.page.evaluate(() => document.querySelector('#game-announce')?.textContent ?? '');
		check(/Level 12 solved/.test(banner), 'S.8d (30b core) the desktop banner shows it ("' + banner.trim().slice(0, 40) + '")');
	}
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

	// ---- W. the board follows the world ----------------------------------------------------------
	await eventually(() => state(B.page), (s) => s.level === 12 && s.mode === '2d', 'W.0 (premise) both peers back on the flat level 12');
	const w1 = await A.page.evaluate(async () => {
		const THREE = window.__stores.THREE;
		let rig, scene;
		window.__stores.worldRig.subscribe((v) => (rig = v))();
		window.__stores.globalScene.subscribe((v) => (scene = v))();
		const g = scene.getObjectByName('untangle-module');
		// a core with the world root (30b-vr-modes P5) has already hung the board inside the rig
		const coreRoot = scene.getObjectByName('module-world-root');
		const homed = coreRoot ? g.parent === coreRoot && coreRoot.parent === rig : null;
		const n = window.__untangle.state().positions.length;
		const before = [...Array(n)].map((_, i) => window.__untangle.dotWorld(i));
		const identity = rig.position.length() < 1e-9 && Math.abs(rig.quaternion.w) > 1 - 1e-9 && Math.abs(rig.scale.x - 1) < 1e-9;
		rig.add(g); // module content under the world, as core's world root hangs it
		rig.position.set(0.6, 0.1, -0.5);
		rig.rotation.set(0, 0.6, 0);
		rig.scale.setScalar(1.3);
		rig.updateMatrixWorld(true);
		await new Promise((r) => setTimeout(r, 300)); // frames run: nothing may pull it back
		const after = [...Array(n)].map((_, i) => window.__untangle.dotWorld(i));
		const err = Math.max(...before.map((p, i) => new THREE.Vector3(...p).applyMatrix4(rig.matrixWorld).distanceTo(new THREE.Vector3(...after[i]))));
		return { identity, parentIsRig: g.parent === rig, err, coreRoot: !!coreRoot, homed };
	});
	check(w1.identity, 'W.0b (premise) the world rig starts at identity on a desktop');
	console.log('  core world root (30b-vr-modes P5): ' + w1.coreRoot);
	if (w1.coreRoot) check(w1.homed, 'W.0c (30b core) the board (rebuilt many times by now) hangs under the core\'s module-world-root inside the rig');
	check(w1.parentIsRig && w1.err < 1e-6, 'W.1 hung under the turned, moved and 1.3x-scaled world rig, every dot follows it (max error ' + w1.err.toExponential(1) + ' m)');
	// a REAL mouse drag on the turned board, the camera OBLIQUE to it (head-on, every point of
	// a view ray maps to the same board x,y, so a drag on the wrong plane would still land)
	const wb = await boardFrame(A.page);
	await A.page.evaluate((f) => {
		let cam, controls;
		window.__stores.globalCamera.subscribe((v) => (cam = v))();
		window.__stores.orbitControls.subscribe((v) => (controls = v))();
		cam.position.set(f.c[0] + f.n[0] * 3.4 + f.r[0] * 2, f.c[1] + f.n[1] * 3.4 + f.r[1] * 2 + 0.6, f.c[2] + f.n[2] * 3.4 + f.r[2] * 2);
		controls.target.set(...f.c);
		controls.update();
	}, wb);
	await A.page.waitForTimeout(500);
	const TW = [-0.4, -0.5];
	await drag(A.page, await dotPx(A.page, 2), await boardPx(A.page, TW));
	const w2 = await state(A.page);
	check(w2.carried === -1 && near(w2.positions[2], TW), 'W.2 a real mouse drag on the turned board drops dot 2 where aimed (' + TW + ' vs ' + w2.positions[2].map((v) => v.toFixed(3)) + ')');
	await eventually(() => state(B.page), (s) => JSON.stringify(s.positions[2]) === JSON.stringify(w2.positions[2]), 'W.3 B (no rig turn) lands on the identical board position — positions are board units');
	// a VR laser drag on the turned board
	await A.page.evaluate(() => window.__stores.isVRMode.set(true));
	const TV = [0.45, 0.5];
	const d3w = await A.page.evaluate(() => window.__untangle.dotWorld(3));
	const tvW = await A.page.evaluate((p) => window.__untangle.boardWorld(p), TV);
	const RW = wb.c.map((v, k) => v + wb.n[k] * 1.4 + [0.2, -0.3, 0][k]);
	await setHands(A.page, { right: await aimPose(A.page, RW, d3w, false), left: await aimPose(A.page, wb.away, wb.c, false) });
	await A.page.waitForTimeout(80);
	await setHands(A.page, { right: await aimPose(A.page, RW, d3w, true) });
	await A.page.waitForTimeout(100);
	for (let k = 1; k <= 8; k++) {
		await setHands(A.page, { right: await aimPose(A.page, RW, d3w.map((v, j) => v + ((tvW[j] - v) * k) / 8), true) });
		await A.page.waitForTimeout(40);
	}
	await setHands(A.page, { right: await aimPose(A.page, RW, tvW, false) });
	await A.page.waitForTimeout(150);
	const w4 = await state(A.page);
	check(w4.carried === -1 && near(w4.positions[3], TV), 'W.4 a VR laser drag on the turned board drops dot 3 where aimed (' + TV + ' vs ' + w4.positions[3].map((v) => v.toFixed(3)) + ')');
	await A.page.evaluate(() => window.__untangle.vrSim(null));
	await A.page.evaluate(() => window.__stores.isVRMode.set(false));
	// a level change rebuilds the board: under the rig again, and only ONE board in the scene
	await A.page.evaluate(() => window.__untangle.select(13));
	await A.page.waitForTimeout(300);
	const w5 = await A.page.evaluate(() => {
		let rig, scene;
		window.__stores.worldRig.subscribe((v) => (rig = v))();
		window.__stores.globalScene.subscribe((v) => (scene = v))();
		const boards = [];
		scene.traverse((o) => o.name === 'untangle-module' && boards.push(o));
		return { count: boards.length, underRig: boards.every((b) => b.parent === rig), level: window.__untangle.state().level };
	});
	check(w5.level === 13 && w5.count === 1 && w5.underRig, 'W.5 a level change rebuilds the board UNDER the rig, no orphan left (' + w5.count + ' board(s), under the rig ' + w5.underRig + ')');
	// a scene clear takes it out of the rig (and nothing is left there)
	const w6 = await A.page.evaluate(() => {
		let rig, scene;
		window.__stores.worldRig.subscribe((v) => (rig = v))();
		window.__stores.globalScene.subscribe((v) => (scene = v))();
		window.__stores.moduleSDK.runSceneClearHandlers();
		const boards = [];
		scene.traverse((o) => o.name === 'untangle-module' && boards.push(o));
		rig.position.set(0, 0, 0);
		rig.rotation.set(0, 0, 0);
		rig.scale.setScalar(1);
		rig.updateMatrixWorld(true);
		return boards.length;
	});
	check(w6 === 0, 'W.6 a scene clear removes the board from under the rig (' + w6 + ' left)');

	// ---- M. the VR level bar ---------------------------------------------------------------------
	await eventually(() => state(A.page), (s) => !!s && s.built, 'M.0 (premise) the board is back after the clear');
	await A.page.evaluate(() => window.__untangle.select(12, '2d'));
	await eventually(() => state(B.page), (s) => s.level === 12 && s.mode === '2d', 'M.0b (premise) both peers on the flat level 12');
	const bar = () => A.page.evaluate(() => window.__untangle.vrBar());
	check(!(await bar()).visible, 'M.1 on a desktop the bar is hidden (the DOM menu is the selector there)');
	await A.page.evaluate(() => window.__stores.isVRMode.set(true));
	const mb = await boardFrame(A.page);
	const RM = mb.c.map((v, k) => v + mb.n[k] * 1.3 + [0.1, -0.4, 0][k]);
	const cellW = (k) => A.page.evaluate((k) => window.__untangle.vrBarCell(k), k);
	/** aim the right laser at bar cell k and pull + release the trigger */
	async function pressCell(k) {
		const at = await cellW(k);
		await setHands(A.page, { right: await aimPose(A.page, RM, at, false), left: await aimPose(A.page, mb.away, mb.c, false) });
		await A.page.waitForTimeout(80);
		await setHands(A.page, { right: await aimPose(A.page, RM, at, true) });
		await A.page.waitForTimeout(80);
		await setHands(A.page, { right: await aimPose(A.page, RM, at, false) });
		await A.page.waitForTimeout(120);
	}
	await setHands(A.page, { right: await aimPose(A.page, RM, await cellW(2), false), left: await aimPose(A.page, mb.away, mb.c, false) });
	await A.page.waitForTimeout(150);
	const m2 = await bar();
	check(m2.visible, 'M.2 in VR Interact the bar shows under the board');
	check(m2.hover === 2, 'M.3 the laser on ▶ lights it (hover ' + m2.hover + ')');
	const unlocked = await A.page.evaluate(() => window.__untangle.progress()['2d'].unlocked);
	check(unlocked === 13 && m2.cells[2].enabled, 'M.3b (premise) level 13 is unlocked (unlocked ' + unlocked + '), so ▶ is live on 12');
	const logM = (await sfx(A.page)).log.length;
	await pressCell(2);
	check((await state(A.page)).level === 13 && (await bar()).last === 'next', 'M.4 a trigger press on ▶ goes to level 13');
	const logM2 = (await sfx(A.page)).log.slice(logM);
	check(logM2.includes('click') && logM2.includes('haptic:bump:right'), 'M.5 the press clicks and bumps the right controller');
	await eventually(() => state(B.page), (s) => s.level === 13, 'M.6 B follows to level 13 (the selector\'s replicated path)');
	const consumed = await A.page.evaluate(() => {
		let scene;
		window.__stores.globalScene.subscribe((v) => (scene = v))();
		return window.__stores.moduleSDK.runClickHandlers(scene.getObjectByName('untangle-vrbar'), null);
	});
	check(consumed, 'M.7 core\'s trailing select on the bar is consumed (never selects it)');
	await pressCell(2);
	check((await state(A.page)).level === 13, 'M.8 ▶ on the highest unlocked level does nothing (14 is locked)');
	await pressCell(0);
	check((await state(A.page)).level === 12, 'M.9 ◀ goes back to level 12');
	await eventually(() => state(B.page), (s) => s.level === 12, 'M.10 B follows');
	// ↺: a moved dot comes back to the level's scramble, on both peers
	const fresh = (await state(A.page)).positions;
	await A.page.evaluate(() => window.__untangle.move(4, [0.01, 0.02]));
	await pressCell(4);
	const m11 = await state(A.page);
	check(JSON.stringify(m11.positions) === JSON.stringify(fresh) && m11.level === 12, 'M.11 ↺ restarts the level (the moved dot is back in the scramble)');
	await eventually(() => state(B.page), (s) => JSON.stringify(s.positions) === JSON.stringify(fresh), 'M.12 B restarts too');
	await pressCell(3);
	const m13 = await state(A.page);
	check(m13.mode === '3d' && m13.level === 1, 'M.13 the mode cell flips to the globe at its continue level (' + m13.mode + ' ' + m13.level + ')');
	await eventually(() => state(B.page), (s) => s.mode === '3d' && s.level === 1, 'M.14 B flips to the globe too');
	await A.page.waitForTimeout(150);
	const m15 = await bar();
	check(m15.visible && m15.cells[3].label === 'Flat', 'M.15 under the globe the bar shows, its mode cell now says Flat');
	await pressCell(3);
	check((await state(A.page)).mode === '2d', 'M.16 ...and flips back');
	const hasModes2 = await A.page.evaluate(() => typeof window.__stores.objectActions?.setEditorMode === 'function');
	if (hasModes2) {
		await A.page.evaluate(() => window.__stores.objectActions.setEditorMode('edit'));
		await A.page.waitForTimeout(150);
		check(!(await bar()).visible, 'M.17 in EDIT the bar hides (the board does not react there)');
		await A.page.evaluate(() => window.__stores.objectActions.setEditorMode('interact'));
	}

	// ---- G. hold the globe, move the dots with the other hand ---------------------------------------
	await A.page.evaluate(() => window.__untangle.select(12, '3d'));
	await eventually(() => state(B.page), (s) => s.mode === '3d' && s.level === 12, 'G.0 (premise) both peers on the level-12 globe');
	await A.page.waitForTimeout(200);
	// a spot on the globe's front face far from every dot (a press there holds, never picks)
	const spot = await A.page.evaluate(() => {
		const THREE = window.__stores.THREE;
		const c = new THREE.Vector3(...window.__untangle.boardWorld([0, 0, 0]));
		const r = c.distanceTo(new THREE.Vector3(...window.__untangle.boardWorld([0, 0, 1])));
		const dots = window.__untangle.state().positions.map((_, i) => new THREE.Vector3(...window.__untangle.dotWorld(i)));
		let best = null;
		let bestD = -1;
		for (let k = 0; k < 400; k++) {
			const y = 1 - (2 * (k + 0.5)) / 400;
			const rr = Math.sqrt(1 - y * y);
			const phi = k * 2.399963;
			const d = new THREE.Vector3(Math.cos(phi) * rr, y, Math.sin(phi) * rr);
			if (d.z < 0.55) continue; // the face toward the player (+Z)
			const p = c.clone().addScaledVector(d, r);
			const miss = Math.min(...dots.map((q) => q.distanceTo(p)));
			if (miss > bestD) {
				bestD = miss;
				best = p;
			}
		}
		return { c: c.toArray(), r, at: best.toArray(), miss: bestD };
	});
	check(spot.miss > 0.2, 'G.0b (premise) a front spot ' + spot.miss.toFixed(2) + ' m from every dot');
	const H0 = [spot.c[0] + 0.25, spot.c[1] - 0.25, spot.c[2] + spot.r + 0.6];
	const LH = [spot.c[0] - 0.5, spot.c[1] - 0.2, spot.c[2] + spot.r + 1.2];
	await setHands(A.page, { right: await aimPose(A.page, H0, spot.at, false), left: await aimPose(A.page, LH, [spot.c[0] - 3, spot.c[1] + 3, spot.c[2]], false) });
	await A.page.waitForTimeout(100);
	const q0 = (await aimPose(A.page, H0, spot.at, true)).quaternion;
	const before = await A.page.evaluate(() => window.__untangle.state().positions.map((_, i) => window.__untangle.dotWorld(i)));
	await setHands(A.page, { right: { position: H0, quaternion: q0, trigger: true } });
	await A.page.waitForTimeout(120);
	const g1v = await A.page.evaluate(() => ({ vr: window.__untangle.vr(), s: window.__untangle.state() }));
	check(g1v.vr.holder?.hand === 'right' && g1v.s.carried === -1, 'G.1 the right trigger on the globe (not a dot) HOLDS it (holder ' + JSON.stringify(g1v.vr.holder) + ', carried ' + g1v.s.carried + ')');
	check(await A.page.evaluate(() => { let v; window.__stores.inputRuntime.inputClaims.subscribe((x) => (v = x))(); return v.includes('locomotion'); }), 'G.2 left-stick walking is paused while the globe is held');
	// move the hand 30 cm right and 10 up, and turn it 35 degrees about +Y
	const H1 = [H0[0] + 0.3, H0[1] + 0.1, H0[2]];
	const q1 = await A.page.evaluate((q0) => {
		const THREE = window.__stores.THREE;
		return new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.61).multiply(new THREE.Quaternion().fromArray(q0)).toArray();
	}, q0);
	for (let k = 1; k <= 6; k++) {
		const pos = H0.map((v, j) => v + ((H1[j] - v) * k) / 6);
		const q = await A.page.evaluate(({ q0, q1, t }) => new window.__stores.THREE.Quaternion().fromArray(q0).slerp(new window.__stores.THREE.Quaternion().fromArray(q1), t).toArray(), { q0, q1, t: k / 6 });
		await setHands(A.page, { right: { position: pos, quaternion: q, trigger: true } });
		await A.page.waitForTimeout(40);
	}
	await A.page.waitForTimeout(100);
	const rigid = await A.page.evaluate(({ H0, H1, q0, q1, before, c0 }) => {
		const THREE = window.__stores.THREE;
		const dq = new THREE.Quaternion().fromArray(q1).multiply(new THREE.Quaternion().fromArray(q0).invert());
		const ride = (p) => new THREE.Vector3(...p).sub(new THREE.Vector3(...H0)).applyQuaternion(dq).add(new THREE.Vector3(...H1));
		const after = window.__untangle.state().positions.map((_, i) => new THREE.Vector3(...window.__untangle.dotWorld(i)));
		const centre = new THREE.Vector3(...window.__untangle.globeHold().centre);
		return {
			centreErr: centre.distanceTo(ride(c0)),
			dotErr: Math.max(...before.map((p, i) => ride(p).distanceTo(after[i]))),
			moved: centre.distanceTo(new THREE.Vector3(...c0))
		};
	}, { H0, H1, q0, q1, before, c0: spot.c });
	check(rigid.moved > 0.25 && rigid.centreErr < 2e-3, 'G.3 the globe rides the hand: its centre moved ' + rigid.moved.toFixed(2) + ' m, exactly where the controller carried it (error ' + rigid.centreErr.toExponential(1) + ')');
	check(rigid.dotErr < 2e-3, 'G.4 and it TURNED with the hand: every dot followed the controller\'s move + 35 deg turn (max error ' + rigid.dotErr.toExponential(1) + ' m)');
	// the holding hand's stick scales it — the dots with it
	const look0 = await A.page.evaluate(() => ({ s: window.__untangle.globeHold().scale, r: window.__untangle.look().dotRadius }));
	await A.page.evaluate(() => window.__stores.inputRuntime.setVRAxes('right', 0, -1));
	await A.page.waitForTimeout(500);
	await A.page.evaluate(() => window.__stores.inputRuntime.setVRAxes('right', 0, 0));
	await A.page.waitForTimeout(80);
	const look1 = await A.page.evaluate(() => ({ s: window.__untangle.globeHold().scale, r: window.__untangle.look().dotRadius }));
	check(look1.s > look0.s * 1.3, 'G.5 stick forward on the holding hand grows the globe (scale ' + look0.s.toFixed(2) + ' -> ' + look1.s.toFixed(2) + ')');
	check(Math.abs(look1.r / look0.r - look1.s / look0.s) < 1e-3, 'G.6 the dots grew in proportion (dot radius x' + (look1.r / look0.r).toFixed(3) + ')');
	// the OTHER hand grabs a dot while the globe is held, and carries it across the moving globe
	const front = await A.page.evaluate((lh) => {
		const THREE = window.__stores.THREE;
		const all = window.__untangle.state().positions.map((_, i) => new THREE.Vector3(...window.__untangle.dotWorld(i)));
		const c = new THREE.Vector3(...window.__untangle.globeHold().centre);
		const eye = new THREE.Vector3(...lh);
		let best = 0;
		let bestV = -2;
		all.forEach((p, i) => {
			const facing = p.clone().sub(c).normalize().dot(eye.clone().sub(c).normalize());
			if (facing > bestV) {
				bestV = facing;
				best = i;
			}
		});
		return { i: best, at: all[best].toArray() };
	}, LH);
	await setHands(A.page, { left: await aimPose(A.page, LH, front.at, false) });
	await A.page.waitForTimeout(80);
	await setHands(A.page, { left: await aimPose(A.page, LH, front.at, true) });
	await A.page.waitForTimeout(120);
	const g7 = await A.page.evaluate(() => ({ vr: window.__untangle.vr(), s: window.__untangle.state() }));
	check(g7.s.carried === front.i && g7.vr.carrier?.hand === 'left' && g7.vr.holder?.hand === 'right', 'G.7 with the right hand holding the globe, the LEFT hand grabs dot ' + front.i + ' (carried ' + g7.s.carried + ')');
	const gp0 = g7.s.positions[front.i];
	// the right hand moves the globe while the left laser holds still: the dot stays on the left ray
	const leftAim = front.at;
	for (let k = 1; k <= 5; k++) {
		await setHands(A.page, { right: { position: [H1[0] - 0.04 * k, H1[1], H1[2]], quaternion: q1, trigger: true } });
		await A.page.waitForTimeout(40);
	}
	await A.page.waitForTimeout(100);
	const onRay = await A.page.evaluate(({ LH, leftAim, i }) => {
		const THREE = window.__stores.THREE;
		const o = new THREE.Vector3(...LH);
		const d = new THREE.Vector3(...leftAim).sub(o).normalize();
		// the dot's point ON the globe (a carried dot is DRAWN lifted off it, toward the player)
		const p = new THREE.Vector3(...window.__untangle.boardWorld(window.__untangle.state().positions[i]));
		return new THREE.Ray(o, d).distanceSqToPoint(p) ** 0.5;
	}, { LH, leftAim, i: front.i });
	check(onRay < 0.03, 'G.8 as the right hand carries the globe away, the carried dot stays under the LEFT laser (its globe point ' + (onRay * 100).toFixed(1) + ' cm off the ray)');
	await setHands(A.page, { left: await aimPose(A.page, LH, leftAim, false) });
	await A.page.waitForTimeout(150);
	const g9 = await state(A.page);
	const gq = g9.positions[front.i];
	check(g9.carried === -1 && Math.abs(Math.hypot(...gq) - 1) < 1e-6 && Math.hypot(gq[0] - gp0[0], gq[1] - gp0[1], gq[2] - gp0[2]) > 0.02, 'G.9 the left release drops it at a new spot on the sphere (a unit vector)');
	await eventually(() => state(B.page), (s) => JSON.stringify(s.positions[front.i]) === JSON.stringify(gq), 'G.10 B lands on the identical unit vector');
	check((await A.page.evaluate(() => window.__untangle.vr().holder?.hand)) === 'right', 'G.11 the right hand still holds the globe');
	await setHands(A.page, { right: { position: [H1[0] - 0.2, H1[1], H1[2]], quaternion: q1, trigger: false } });
	await A.page.waitForTimeout(120);
	const g12 = await A.page.evaluate(() => {
		let claims;
		window.__stores.inputRuntime.inputClaims.subscribe((x) => (claims = x))();
		return { holder: window.__untangle.vr().holder, hold: window.__untangle.globeHold(), walk: !claims.includes('locomotion') };
	});
	check(g12.holder === null && g12.hold.scale > 1.3 && g12.walk, 'G.12 the release lets it go where it is (scale ' + g12.hold.scale.toFixed(2) + ' kept) and walking is back');
	const bHold = await B.page.evaluate(() => window.__untangle.globeHold());
	check(bHold.scale === 1 && bHold.offset.every((v) => v === 0), 'G.13 the hold is LOCAL: B\'s globe did not move or grow');
	// the flat board has no hold
	await A.page.evaluate(() => window.__untangle.select(12, '2d'));
	await A.page.waitForTimeout(200);
	const fb = await boardFrame(A.page);
	const hFlat = fb.c.map((v, k) => v + fb.n[k] * 1.3);
	await setHands(A.page, { right: await aimPose(A.page, hFlat, fb.away, false) });
	const edge = await A.page.evaluate(() => window.__untangle.boardWorld([0.02, 0.98]));
	const spotFlat = await A.page.evaluate(() => {
		const s = window.__untangle.state();
		let best = [0, 0];
		let bestD = -1;
		for (let x = -0.9; x <= 0.9; x += 0.1)
			for (let y = -0.9; y <= 0.9; y += 0.1) {
				const d = Math.min(...s.positions.map((p) => Math.hypot(p[0] - x, p[1] - y)));
				if (d > bestD) {
					bestD = d;
					best = [x, y];
				}
			}
		return window.__untangle.boardWorld(best);
	});
	await setHands(A.page, { right: await aimPose(A.page, hFlat, spotFlat, false) });
	await A.page.waitForTimeout(80);
	await setHands(A.page, { right: await aimPose(A.page, hFlat, spotFlat, true) });
	await A.page.waitForTimeout(120);
	const g14 = await A.page.evaluate(() => ({ vr: window.__untangle.vr(), hold: window.__untangle.globeHold(), carried: window.__untangle.state().carried }));
	check(g14.vr.holder === null && g14.carried === -1 && g14.hold.scale === 1, 'G.14 the flat board has no hold (a press on an empty spot holds nothing; the globe hold was forgotten with the mode)');
	await setHands(A.page, { right: await aimPose(A.page, hFlat, spotFlat, false) });
	void edge;

	// ---- Y. the core's VR panel owns the laser where it is ------------------------------------------
	await A.page.waitForTimeout(150);
	const yb = await boardFrame(A.page);
	const YR = yb.c.map((v, k) => v + yb.n[k] * 1.4 + [0.3, -0.2, 0][k]);
	const yd0 = await A.page.evaluate(() => window.__untangle.dotWorld(0));
	/** a stand-in for the core panel: a plane at `at`, facing `face`, named like the core's */
	const panel = (name, at, face) =>
		A.page.evaluate(({ name, at, face }) => {
			const THREE = window.__stores.THREE;
			let scene;
			window.__stores.globalScene.subscribe((v) => (scene = v))();
			let m = window.__ytest;
			if (!m) {
				m = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.5), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
				scene.add(m);
				window.__ytest = m;
			}
			m.name = name;
			m.visible = true;
			m.position.set(...at);
			m.lookAt(...face);
			m.updateMatrixWorld(true);
		}, { name, at, face });
	const between = (a, b, t) => a.map((v, k) => v + (b[k] - v) * t);
	await panel('vr-game-panel', between(YR, yd0, 0.4), YR);
	await setHands(A.page, { right: await aimPose(A.page, YR, yd0, false), left: await aimPose(A.page, yb.away, [yb.away[0], yb.away[1] + 5, yb.away[2]], false) });
	await A.page.waitForTimeout(150);
	const y1 = await A.page.evaluate(() => ({ c: window.__untangle.vr().candidate, h: window.__untangle.look().hovered }));
	check(y1.c === null && y1.h === -1, 'Y.1 with the core panel on the ray, dot 0 behind it shows no hover (' + JSON.stringify(y1.c) + ')');
	await setHands(A.page, { right: await aimPose(A.page, YR, yd0, true) });
	await A.page.waitForTimeout(120);
	check((await state(A.page)).carried === -1, 'Y.2 ...and a trigger press there grabs nothing (the press is the panel\'s)');
	await setHands(A.page, { right: await aimPose(A.page, YR, yd0, false) });
	const yLevel = (await state(A.page)).level;
	const yCell = await A.page.evaluate(() => window.__untangle.vrBarCell(4));
	await panel('vr-game-wrist', between(YR, yCell, 0.4), YR);
	await setHands(A.page, { right: await aimPose(A.page, YR, yCell, false) });
	await A.page.waitForTimeout(100);
	const yb3 = await A.page.evaluate(() => window.__untangle.vrBar());
	await setHands(A.page, { right: await aimPose(A.page, YR, yCell, true) });
	await A.page.waitForTimeout(120);
	await setHands(A.page, { right: await aimPose(A.page, YR, yCell, false) });
	await A.page.waitForTimeout(100);
	const yb4 = await A.page.evaluate(() => window.__untangle.vrBar());
	check(yb3.hover === -1 && yb4.last === yb3.last && (await state(A.page)).level === yLevel, 'Y.3 a wrist card on the ray: the level bar behind it neither lights nor presses (last ' + yb4.last + ')');
	// a TIP touch is contact, not a laser: it still grabs with a panel on that hand's ray
	const yd1 = await A.page.evaluate(() => window.__untangle.dotWorld(1));
	await panel('vr-game-panel', yd1.map((v, k) => v - yb.n[k] * 0.3), yd1);
	const tipAt = yd1.map((v, k) => v + yb.n[k] * 0.02);
	await setHands(A.page, { left: { position: tipAt, quaternion: yb.faceQ, trigger: false } });
	await A.page.waitForTimeout(80);
	await setHands(A.page, { left: { position: tipAt, quaternion: yb.faceQ, trigger: true } });
	await A.page.waitForTimeout(120);
	const y4 = await state(A.page);
	check(y4.carried === 1 && y4.carryMode === 'vr-tip', 'Y.4 a TIP touch still grabs dot 1 with a panel on that hand\'s ray (' + y4.carryMode + ')');
	await setHands(A.page, { left: { position: tipAt, quaternion: yb.faceQ, trigger: false } });
	await A.page.waitForTimeout(120);
	// a HIDDEN panel blocks nothing
	await panel('vr-game-panel', between(YR, yd0, 0.4), YR);
	await A.page.evaluate(() => (window.__ytest.visible = false));
	await setHands(A.page, { right: await aimPose(A.page, YR, yd0, false), left: await aimPose(A.page, yb.away, [yb.away[0], yb.away[1] + 5, yb.away[2]], false) });
	await A.page.waitForTimeout(80);
	await setHands(A.page, { right: await aimPose(A.page, YR, yd0, true) });
	await A.page.waitForTimeout(120);
	check((await state(A.page)).carried === 0, 'Y.5 a hidden panel blocks nothing: the same press grabs dot 0');
	await setHands(A.page, { right: await aimPose(A.page, YR, yd0, false) });
	await A.page.waitForTimeout(120);
	// core's own press on the board (a 30b core dispatches the click on the trigger PRESS, maybe
	// before the frame task saw the edge): any mesh of the board is consumed, not just a dot
	await A.page.waitForTimeout(600); // past CONSUME_MS: nothing "recent" to lean on
	const y6 = await A.page.evaluate(() => {
		let scene;
		window.__stores.globalScene.subscribe((v) => (scene = v))();
		const plate = scene.getObjectByName('untangle-module')?.getObjectByName('untangle-plate');
		let mesh = null;
		plate?.traverse((o) => { if (!mesh && o.isMesh) mesh = o; });
		return { found: !!mesh, consumed: mesh ? window.__stores.moduleSDK.runClickHandlers(mesh, null) : false, carried: window.__untangle.state().carried };
	});
	check(y6.found && y6.consumed && y6.carried === -1, 'Y.6 a VR click core dispatches on the board\'s backplate is consumed (never selects the board) and grabs nothing');
	await A.page.evaluate(() => window.__ytest.removeFromParent());
	await A.page.evaluate(() => window.__untangle.vrSim(null));
	await A.page.evaluate(() => window.__stores.isVRMode.set(false));

	await finish(browser);
});
