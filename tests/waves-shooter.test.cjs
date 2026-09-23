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
/** the engine's view of one enemy (hits, kills, hp) by uuid */
const enemyState = (page, uuid) => page.evaluate((u) => (window.__waves.snapshot()[0]?.enemies ?? []).find((e) => e.uuid === u) ?? null, uuid);
const targets = (page) => page.evaluate(() => window.__waves.engine.targets().map((t) => ({ uuid: t.uuid, label: t.label, hp: t.hp, walking: t.walking })));
const timedPos = (page, uuid) =>
	page.evaluate((u) => {
		let g;
		window.__stores.objectsGroup.subscribe((v) => (g = v))();
		const o = g.getObjectByProperty('uuid', u);
		return { p: o.getWorldPosition(new window.__stores.THREE.Vector3()).toArray(), t: performance.now() / 1000 };
	}, uuid);
const worldPos = (page, uuid) =>
	page.evaluate((u) => {
		let g;
		window.__stores.objectsGroup.subscribe((v) => (g = v))();
		const o = g.getObjectByProperty('uuid', u);
		return o ? o.getWorldPosition(new window.__stores.THREE.Vector3()).toArray() : null;
	}, uuid);
/** aim `hand` from `from` at the enemy's LIVE position, hold the trigger `frames` frames, let go */
const shootAt = (page, hand, from, uuid, frames = 2) =>
	page.evaluate(
		({ hand, from, uuid, frames }) =>
			new Promise((resolve) => {
				const T = window.__stores.THREE;
				let g;
				window.__stores.objectsGroup.subscribe((v) => (g = v))();
				const aimNow = (trigger) => {
					const o = g.getObjectByProperty('uuid', uuid);
					const to = o.getWorldPosition(new T.Vector3());
					const dir = to.clone().sub(new T.Vector3(...from)).normalize();
					const q = new T.Quaternion().setFromUnitVectors(new T.Vector3(0, 0, -1), dir);
					window.__hand[hand] = { position: from, quaternion: q.toArray(), trigger, gripped: false };
				};
				aimNow(false);
				let n = 0;
				const tick = () => {
					n++;
					if (n === 2) aimNow(true);
					else if (n > 2 && n < 2 + frames) aimNow(true);
					else if (n >= 2 + frames) {
						aimNow(false);
						return setTimeout(resolve, 60);
					} else aimNow(false);
					requestAnimationFrame(tick);
				};
				requestAnimationFrame(tick);
			}),
		{ hand, from, uuid, frames }
	);
/** record every sound and buzz the module asks for (the 30b core seams, stubbed on its api) */
const recordFeel = (page) =>
	page.evaluate(() => {
		const api = window.__waves.api;
		window.__feel = { sounds: [], haptics: [] };
		api.music = api.music ?? { play() {}, stop() {} };
		api.playSound = (name, at) => window.__feel.sounds.push(name);
		api.hapticPattern = (name, hand) => window.__feel.haptics.push(name + ':' + hand);
	});
const feelLog = (page) => page.evaluate(() => window.__feel);

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


	// =====================================================================
	// 2. P1 — the gun in the hand: hitscan, knockback, the kill
	// =====================================================================
	await recordFeel(A.page);
	await A.page.evaluate(() => window.__waves.prefs.set({ gun: 'blaster', hand: 'right' }));
	await aim(A.page, 'right', hand, [hand[0], hand[1], hand[2] - 5], false);
	await aim(A.page, 'left', [hand[0] - 0.4, hand[1], hand[2]], [hand[0] - 0.4, hand[1], hand[2] - 5], false);
	await A.page.waitForTimeout(300);
	const gunPose = await A.page.evaluate(() => {
		const r = window.__waves.weapon.hands.get('right');
		const l = window.__waves.weapon.hands.get('left');
		return { right: r?.model.visible ?? false, rightAt: r ? r.model.getWorldPosition(new window.__stores.THREE.Vector3()).toArray() : null, left: l?.model.visible ?? false };
	});
	h.check(gunPose.right && Math.hypot(gunPose.rightAt[0] - hand[0], gunPose.rightAt[1] - hand[1], gunPose.rightAt[2] - hand[2]) < 0.15, '2.1 a gun rides the RIGHT controller (within 15 cm of the hand)');
	h.check(!gunPose.left, '2.2 and none in the left (the handedness option: right)');
	await h.eventually(() => targets(A.page), (t) => t.filter((x) => x.walking).length >= 2, '2.3 the wave offers walking targets');
	const [first] = await targets(A.page);
	const s0 = await enemyState(A.page, first.uuid);
	const p0 = await timedPos(A.page, first.uuid);
	const drawn0 = await A.page.evaluate(() => window.__waves.juice.drawn());
	await shootAt(A.page, 'right', hand, first.uuid);
	const p1 = await timedPos(A.page, first.uuid);
	await h.eventually(() => enemyState(A.page, first.uuid), (e) => e && e.hits === s0.hits + 1, '2.4 a trigger pull aimed at an enemy lands ONE hit on its health counter (the replicated ledger)');
	// it walks toward +z at <= 1.5 m/s; unshoved it would be at least near p0 + the walk. The shove is 0.55 m.
	const unshoved = p0.p[2] + 1.5 * (p1.t - p0.t) * 0.8;
	h.check(p1.p[2] < unshoved - 0.3, '2.5 the hit shoves it BACK along its lane (z ' + p0.p[2].toFixed(2) + ' -> ' + p1.p[2].toFixed(2) + ' in ' + (p1.t - p0.t).toFixed(2) + ' s; unshoved >= ' + unshoved.toFixed(2) + ')');
	const drawn1 = await A.page.evaluate(() => window.__waves.juice.drawn());
	const more = (k) => (drawn1[k] ?? 0) - (drawn0[k] ?? 0);
	h.check(more('tracer') >= 1 && more('flash') >= 1 && more('spark') >= 1, '2.6 the shot drew its tracer, muzzle flash and hit spark (' + JSON.stringify(drawn1) + ')');
	const f1 = await feelLog(A.page);
	h.check(f1.sounds.includes('shoot') && f1.haptics.some((x) => x.endsWith(':right')), '2.7 it sounded (shoot) and buzzed the right hand (' + f1.sounds.join(',') + ' / ' + f1.haptics.join(',') + ')');
	await shootAt(A.page, 'right', hand, first.uuid);
	await A.page.waitForTimeout(200);
	await shootAt(A.page, 'right', hand, first.uuid);
	await h.eventually(() => enemyState(A.page, first.uuid), (e) => e && e.kills >= 1, '2.8 three bolts kill a three-point enemy (kills 1)');
	await h.eventually(() => worldPos(A.page, first.uuid), (p) => p && p[1] < -10, '2.9 the dead are taken off the field (under the ground, out of reach)');
	const f2 = await feelLog(A.page);
	h.check(f2.sounds.includes('explosion') && f2.haptics.includes('hit:right'), '2.10 the kill explodes and hits the hand (explosion / hit)');
	h.check((await A.page.evaluate(() => window.__stores.peerVars.myPeerVar('kills', 0))) === 1, '2.11 the kill is credited to this player (kills row 1)');
	await h.eventually(() => targets(A.page), (t) => t.some((x) => x.walking && x.uuid !== first.uuid), '2.12a another walking enemy');
	const [second] = (await targets(A.page)).filter((t) => t.walking && t.uuid !== first.uuid);
	const s2 = await enemyState(A.page, second.uuid);
	await pull(A.page, 'right', hand, [hand[0], hand[1] + 8, hand[2] + 1]);
	await A.page.waitForTimeout(500);
	h.check((await enemyState(A.page, second.uuid)).hits === s2.hits, '2.12 a shot at the sky hits nothing');

	if (process.env.DEBUG_WAVES) console.log('DEBUG', await gameState(A.page), JSON.stringify(await A.page.evaluate(() => { const s = window.__waves.snapshot()[0]; return { wave: s.wave, running: s.running, started: s.started, done: s.done, alive: s.alive, enemies: s.enemies.map((e) => [e.label, e.hits, e.heals, e.kills, e.hp]) }; })));

	// Scatter: one pull, several pellets into one close enemy
	await A.page.evaluate(() => window.__waves.prefs.set({ gun: 'scatter' }));
	await A.page.waitForTimeout(200);
	await h.eventually(() => targets(A.page), (t) => t.some((x) => x.walking && x.hp >= 2), '2.15a a walking enemy with 2+ points left', 15000);
	const close = (await targets(A.page)).find((t) => t.walking && t.hp >= 2);
	if (close) {
		const at = await worldPos(A.page, close.uuid);
		const from = [at[0], at[1] + 0.2, at[2] + 2.2];
		const before = await A.page.evaluate(() => window.__waves.weapon.stats.hits);
		await shootAt(A.page, 'right', from, close.uuid);
		const landed = (await A.page.evaluate(() => window.__waves.weapon.stats.lastShot)) ?? {};
		h.check(landed.pellets === 7 && (await A.page.evaluate(() => window.__waves.weapon.stats.hits)) - before >= 2, '2.15 the Scatter throws 7 pellets and lands several on a close enemy (' + JSON.stringify(landed.results) + ')');
	} else h.check(false, '2.15 a close enemy for the Scatter');

	// Beam: hold to burn, it heats, it locks
	await A.page.evaluate(() => window.__waves.prefs.set({ gun: 'beam' }));
	await A.page.waitForTimeout(200);
	await h.eventually(() => targets(A.page), (t) => t.some((x) => x.walking), '2.16a a walking enemy for the Beam', 15000);
	const burn = (await targets(A.page)).find((t) => t.walking);
	if (burn) {
		const before = await A.page.evaluate(() => window.__waves.weapon.stats.shots);
		await shootAt(A.page, 'right', hand, burn.uuid, 50);
		const after = await A.page.evaluate(() => ({ shots: window.__waves.weapon.stats.shots, heat: window.__waves.weapon.heatOf('right') }));
		h.check(after.shots - before >= 4 && after.heat.heat > 0.2, '2.16 the Beam fires in ticks while held and heats (' + (after.shots - before) + ' ticks, heat ' + after.heat.heat.toFixed(2) + ')');
		await shootAt(A.page, 'right', hand, burn.uuid, 200);
		const hot = await A.page.evaluate(() => window.__waves.weapon.heatOf('right'));
		const f3 = await feelLog(A.page);
		h.check(hot.locked && f3.sounds.includes('fail'), '2.17 held too long it OVERHEATS and locks (heat ' + hot.heat.toFixed(2) + ', fail sound)');
	} else h.check(false, '2.16 a walking target for the Beam');
	await A.page.evaluate(() => window.__waves.prefs.set({ gun: 'blaster' }));

	await h.eventually(() => targets(A.page), (t) => t.some((x) => x.walking), '2.13a a walking enemy for the desktop', 15000);
	const deskTarget = (await targets(A.page)).find((t) => t.walking);
	// the desktop: a click fires down the crosshair
	await headset(A.page, false);
	await A.page.evaluate(() => {
		const s = window.__stores;
		s.isLocked.set(true);
	});
	await A.page.waitForTimeout(300);
	const deskHits = await A.page.evaluate(
		async ({ u }) => {
			const T = window.__stores.THREE;
			const api = window.__waves.api;
			let g;
			window.__stores.objectsGroup.subscribe((v) => (g = v))();
			if (!api.__realPointerRay) api.__realPointerRay = api.pointerRay;
			api.pointerRay = () => {
				const o = g.getObjectByProperty('uuid', u);
				const at = o.getWorldPosition(new T.Vector3());
				const eye = at.clone().add(new T.Vector3(0.5, 1, 4));
				return new T.Raycaster(eye, at.clone().sub(eye).normalize());
			};
			await new Promise((r) => setTimeout(r, 200));
			const before = window.__waves.weapon.stats.hits;
			const canvas = document.querySelector('canvas');
			canvas.dispatchEvent(new PointerEvent('pointerdown', { button: 0, bubbles: true }));
			await new Promise((r) => setTimeout(r, 120));
			canvas.dispatchEvent(new PointerEvent('pointerup', { button: 0, bubbles: true }));
			await new Promise((r) => setTimeout(r, 200));
			const desk = window.__waves.weapon.hands.get('desk');
			return { hits: window.__waves.weapon.stats.hits - before, viewmodel: !!desk?.model.visible };
		},
		{ u: deskTarget.uuid }
	);
	h.check(deskHits.viewmodel, '2.13 on a desktop in play the gun sits in the view');
	h.check(deskHits.hits === 1, '2.14 a click fires down the crosshair and hits (' + deskHits.hits + ')');
	await A.page.evaluate(() => {
		const api = window.__waves.api;
		api.pointerRay = api.__realPointerRay;
		window.__stores.isLocked.set(false);
	});
	await headset(A.page, true);
	await A.page.waitForTimeout(300);

	await h.finish(browser);
});
