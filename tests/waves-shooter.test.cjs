// waves shooter test-flight (30b) — the Waves TEMPLATE (a staged .tpscene) with the real
// health + waves zips, played the way a headset plays it.
//
// Headless Chromium has no WebXR, so the headset is EMULATED at the module's own seams:
// core's `isVRMode` store is set (what api.isVR() reads), the editor mode is 'interact'
// (where a VR Play lands, 30b C1), and the module's `api.vrHand` is replaced with a pose
// the flight aims — exactly the object the SDK hands a module from a real controller
// ({position, quaternion, trigger, gripped, connected}). Everything past that seam is the
// module's real code against the real app. The feel on a Quest is OWED, never claimed.
//
//   WAVES_TPSCENE=<staged scene.tpscene> APP_URL=https://theprototype.app:5246/ npm test -- waves-shooter
const h = require('./helpers.cjs');
const fs = require('fs');

const SCENE = process.env.WAVES_TPSCENE || '/home/deck/.code/theprototype-app/cloud-lane-30-staging/30b-waves/games/waves/scene.tpscene';

async function loadTemplate(page) {
	if (!fs.existsSync(SCENE)) throw new Error('template not found: ' + SCENE + ' (set WAVES_TPSCENE)');
	const bytes = fs.readFileSync(SCENE);
	await page.evaluate(async (arr) => {
		const s = window.__stores;
		await s.sessions.applySession(await s.sessions.readSessionZip(new Uint8Array(arr).buffer), { backup: false });
	}, Array.from(bytes));
	await page.waitForTimeout(2500);
}
const enemies = (page) =>
	page.evaluate(() => {
		let g;
		window.__stores.objectsGroup.subscribe((v) => (g = v))();
		return g.children.filter((c) => /^Enemy/.test(c.name)).map((c) => ({ name: c.name, uuid: c.uuid, pos: c.position.toArray(), visible: c.visible }));
	});
const gameState = (page) =>
	page.evaluate(() => {
		let g;
		window.__stores.gameState.gameState.subscribe((v) => (g = v))();
		return g?.state ?? null;
	});
/** the emulated headset: VR on, Interact, and a hand the flight points */
const headset = (page, on) =>
	page.evaluate((on) => {
		const s = window.__stores;
		s.isVRMode.set(on);
		s.editorMode.set(on ? 'interact' : 'edit');
		const api = window.__waves.api;
		window.__hand = window.__hand ?? { right: null, left: null };
		if (!api.__realVrHand) api.__realVrHand = api.vrHand;
		api.vrHand = on ? (hand) => (window.__hand[hand] ? { ...window.__hand[hand], connected: true } : null) : api.__realVrHand;
	}, on);
/** point a hand from `from` at `to`, trigger up or down */
const aim = (page, hand, from, to, trigger) =>
	page.evaluate(
		({ hand, from, to, trigger }) => {
			const T = window.__stores.THREE;
			const dir = new T.Vector3(to[0] - from[0], to[1] - from[1], to[2] - from[2]).normalize();
			const q = new T.Quaternion().setFromUnitVectors(new T.Vector3(0, 0, -1), dir);
			window.__hand[hand] = { position: from, quaternion: q.toArray(), trigger, gripped: false };
		},
		{ hand, from, to, trigger }
	);
const pull = async (page, hand, from, to) => {
	await aim(page, hand, from, to, false);
	await page.waitForTimeout(120);
	await aim(page, hand, from, to, true);
	await page.waitForTimeout(160);
	await aim(page, hand, from, to, false);
	await page.waitForTimeout(120);
};
const boardCenter = (page) => page.evaluate(() => window.__waves.start.board.rect().center);
const eye = (page) => page.evaluate(() => window.__waves.api.playerPosition());

h.run(async () => {
	const browser = await h.launch({ args: h.GPU_ARGS });
	const A = await h.setupPage(browser, 'A');
	await h.installModule(A, 'health');
	await h.installModule(A, 'waves');
	await loadTemplate(A.page);

	// =====================================================================
	// 0. PREMISE — the template, the enemies parked, the shell on its menu
	// =====================================================================
	const parked = await enemies(A.page);
	h.check(parked.length >= 4, '0.1 the template holds its enemies (' + parked.length + ')');
	h.check((await gameState(A.page)) === 'menu', '0.2 the game shell starts on the menu');
	const hudHiddenInVr = await A.page.evaluate(() => {
		window.__stores.isVRMode.set(true);
		const hidden = !document.querySelector('#hud-layer button');
		window.__stores.isVRMode.set(false);
		return hidden;
	});
	h.check(hudHiddenInVr, '0.3 the cause: core draws no DOM HUD in a headset (no Start button to press)');

	// =====================================================================
	// 1. P0 — a headset player starts the round, and the enemies WALK
	// =====================================================================
	await A.page.evaluate(() => window.__stores.playMode.requestPlay());
	await A.page.waitForTimeout(800);
	h.check(!(await A.page.evaluate(() => window.__waves.start.visible())), '1.1 on a desktop no board stands in the world (the DOM menu is the menu)');
	await headset(A.page, true);
	await A.page.waitForTimeout(400);
	h.check(await A.page.evaluate(() => window.__waves.start.visible()), '1.2 in a headset, in the game, with no round: the start board stands in front of the player');
	const head = await eye(A.page);
	const center = await boardCenter(A.page);
	const ahead = Math.hypot(center[0] - head[0], center[2] - head[2]);
	h.check(ahead > 1.5 && ahead < 3.5, '1.3 the board is 1.5-3.5 m ahead (' + ahead.toFixed(2) + ' m)');
	const hand = [head[0] + 0.2, head[1] - 0.4, head[2] - 0.2];
	await pull(A.page, 'right', hand, [center[0] + 3, center[1] + 3, center[2]]);
	await A.page.waitForTimeout(600);
	h.check((await gameState(A.page)) === 'menu', '1.4 a trigger aimed AWAY from the board starts nothing');
	await pull(A.page, 'right', hand, center);
	await h.eventually(() => gameState(A.page), (s) => s === 'playing', '1.5 a trigger aimed AT the board starts the round (the shell is playing)');
	await h.eventually(() => A.page.evaluate(() => window.__waves.start.visible()), (v) => v === false, '1.6 the board is gone once the round runs');
	const before = await enemies(A.page);
	await A.page.waitForTimeout(2500);
	const after = await enemies(A.page);
	const walked = before.map((e, i) => Math.hypot(after[i].pos[0] - e.pos[0], after[i].pos[2] - e.pos[2]));
	h.check(walked.filter((d) => d > 1.5).length >= 2, '1.7 the wave WALKS: ' + walked.filter((d) => d > 1.5).length + ' enemies moved > 1.5 m in 2.5 s (' + walked.map((d) => d.toFixed(2)).join(', ') + ')');
	// smooth: placed every frame, not in 10 Hz hops — sample one walker across ~30 frames
	const walker = before[walked.indexOf(Math.max(...walked))].uuid;
	const distinct = await A.page.evaluate(
		(u) =>
			new Promise((resolve) => {
				let g;
				window.__stores.objectsGroup.subscribe((v) => (g = v))();
				const seen = new Set();
				let frames = 0;
				const tick = () => {
					const o = g.getObjectByProperty('uuid', u);
					if (o) seen.add(o.position.z.toFixed(4));
					if (++frames < 30) requestAnimationFrame(tick);
					else resolve({ frames, distinct: seen.size });
				};
				requestAnimationFrame(tick);
			}),
		walker
	);
	h.check(distinct.distinct >= 18, '1.8 the walk is per-frame, not 10 Hz hops: ' + distinct.distinct + ' distinct positions in ' + distinct.frames + ' frames');

	await h.finish(browser);
});
