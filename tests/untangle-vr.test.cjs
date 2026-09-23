// untangle-vr test-flight (roadmap 30b, lane 30b-untangle): the Quest round's feedback,
// driven for real where a headless browser can and EMULATED where it cannot (WebXR).
//
//   S  the sound: a real mouse drag across many frames makes ONE 'pop' and ONE 'click' — no
//      per-frame sound — and the board is SILENT a moment after the drop (the old
//      generative pad droned forever and was re-ramped every frame of a drag: the "weird
//      sound"); a solve plays 'success' (+ 'levelup' when it unlocks the next level)
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

	await finish(browser);
});
