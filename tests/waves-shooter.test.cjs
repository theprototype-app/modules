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
/** aim `hand` from `from` at the enemy's LIVE position, hold the trigger `frames` frames (or,
 * with `holdMs`, for that long by the clock — a frame count is load-dependent), let go */
const shootAt = (page, hand, from, uuid, frames = 2, holdMs = 0) =>
	page.evaluate(
		({ hand, from, uuid, frames, holdMs }) =>
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
				let pressedAt = 0;
				const tick = () => {
					n++;
					if (n === 2) {
						aimNow(true);
						pressedAt = performance.now();
					} else if (n > 2 && (holdMs ? performance.now() - pressedAt < holdMs : n < 2 + frames)) aimNow(true);
					else if (n > 2) {
						aimNow(false);
						return setTimeout(resolve, 60);
					} else aimNow(false);
					requestAnimationFrame(tick);
				};
				requestAnimationFrame(tick);
			}),
		{ hand, from, uuid, frames, holdMs }
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
		// held 3.5 s it must overheat (1.0 at 0.42/s) — and, locked, cool and unlock again while
		// still held; so count the overheats (one `fail` each) rather than read the end state
		const fails0 = (await feelLog(A.page)).sounds.filter((x) => x === 'fail').length;
		const ticks0 = await A.page.evaluate(() => window.__waves.weapon.stats.shots);
		await shootAt(A.page, 'right', hand, burn.uuid, 0, 3500);
		const fails1 = (await feelLog(A.page)).sounds.filter((x) => x === 'fail').length;
		const ticks1 = await A.page.evaluate(() => window.__waves.weapon.stats.shots);
		h.check(fails1 > fails0 && ticks1 - ticks0 < 3.5 / 0.12 - 4, '2.17 held too long it OVERHEATS and locks: a fail, and fewer ticks than a free 3.5 s burn (' + (ticks1 - ticks0) + ')');
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

	// =====================================================================
	// 3. P2 — the ability in the other hand: Pulse, Slow-mo, Shield, the cooldown, Q
	// =====================================================================
	await headset(A.page, true);
	await A.page.evaluate(() => window.__stores.isLocked.set(true));
	await A.page.waitForTimeout(400);
	if ((await gameState(A.page)) !== 'playing') {
		await h.eventually(() => A.page.evaluate(() => window.__waves.start.visible()), (v) => v, '3.0 the board is back to start a new round');
		const c2 = await boardCenter(A.page);
		const e2 = await eye(A.page);
		await pull(A.page, 'right', [e2[0] + 0.2, e2[1] - 0.4, e2[2] - 0.2], c2);
		await h.eventually(() => gameState(A.page), (st) => st === 'playing', '3.0a a new round runs');
	}
	await h.eventually(() => targets(A.page), (t) => t.some((x) => x.walking), '3.0b a walking enemy', 20000);
	const fxVar = (page) => page.evaluate(() => window.__stores.gameState.gameVar('waves:fx:enemy', null));
	/** stand the player (as the module reads it) next to an enemy */
	const standNear = (page, uuid, dz = 2) =>
		page.evaluate(
			({ u, dz }) => {
				let g;
				window.__stores.objectsGroup.subscribe((v) => (g = v))();
				const api = window.__waves.api;
				if (!api.__realPlayerPosition) api.__realPlayerPosition = api.playerPosition;
				const at = g.getObjectByProperty('uuid', u).getWorldPosition(new window.__stores.THREE.Vector3());
				api.playerPosition = () => [at.x, 1.6, at.z + dz];
			},
			{ u: uuid, dz }
		);
	const grip = async (page, hand) => {
		await page.evaluate((hand) => (window.__hand[hand] = { ...(window.__hand[hand] ?? { position: [0, 1, 0], quaternion: [0, 0, 0, 1], trigger: false }), gripped: false }), hand);
		await page.waitForTimeout(100);
		await page.evaluate((hand) => (window.__hand[hand].gripped = true), hand);
		await page.waitForTimeout(150);
		await page.evaluate((hand) => (window.__hand[hand].gripped = false), hand);
		await page.waitForTimeout(100);
	};
	await A.page.evaluate(() => {
		window.__waves.prefs.set({ ability: 'pulse', hand: 'right' });
		window.__waves.powers.reset();
	});
	const pushee = (await targets(A.page)).find((t) => t.walking);
	await standNear(A.page, pushee.uuid, 2);
	const q0 = await timedPos(A.page, pushee.uuid);
	await grip(A.page, 'left');
	const q1 = await timedPos(A.page, pushee.uuid);
	const v1 = await fxVar(A.page);
	const push = (v1?.ev ?? []).filter((e) => e.k === 'push').pop();
	h.check(!!push && push.d[pushee.uuid] > 1, '3.1 the LEFT grip fires the Pulse: a replicated shove in the round\'s fx variable (' + JSON.stringify(push?.d ?? null) + ')');
	h.check(q1.p[2] < q0.p[2] + 1.5 * (q1.t - q0.t) - 1, '3.2 the enemy is thrown back along its lane (z ' + q0.p[2].toFixed(2) + ' -> ' + q1.p[2].toFixed(2) + ')');
	const n1 = (v1?.ev ?? []).length;
	await grip(A.page, 'left');
	h.check(((await fxVar(A.page))?.ev ?? []).length === n1, '3.3 a second grip inside the cooldown does nothing');
	const charge = await A.page.evaluate(() => window.__waves.powers.readiness());
	h.check(charge < 0.2, '3.4 the charge is spent and refilling (' + charge.toFixed(2) + ')');

	// Slow-mo: the walk at 40%
	await A.page.evaluate(() => {
		window.__waves.prefs.set({ ability: 'slowmo' });
		window.__waves.powers.reset();
	});
	await h.eventually(() => targets(A.page), (t) => t.some((x) => x.walking), '3.5a a walking enemy', 20000);
	// the walker FARTHEST from the goal (z most negative): it will still be walking in 2 s
	const walkers = [];
	for (const t of (await targets(A.page)).filter((x) => x.walking)) walkers.push({ ...t, z: (await worldPos(A.page, t.uuid))[2] });
	const slow = walkers.sort((a, b) => a.z - b.z)[0];
	const a0 = await timedPos(A.page, slow.uuid);
	await A.page.waitForTimeout(700);
	const a1 = await timedPos(A.page, slow.uuid);
	await grip(A.page, 'left');
	const b0 = await timedPos(A.page, slow.uuid);
	await A.page.waitForTimeout(700);
	const b1 = await timedPos(A.page, slow.uuid);
	const vFree = Math.hypot(a1.p[0] - a0.p[0], a1.p[2] - a0.p[2]) / (a1.t - a0.t);
	const vSlow = Math.hypot(b1.p[0] - b0.p[0], b1.p[2] - b0.p[2]) / (b1.t - b0.t);
	const slowEv = ((await fxVar(A.page))?.ev ?? []).filter((e) => e.k === 'slow').pop();
	h.check(!!slowEv && Math.abs(slowEv.until - slowEv.at - 4) < 0.01, '3.5 Slow-mo writes a 4 s window into the round (replicated)');
	h.check(vFree > 0.5 && vSlow > 0 && vSlow / vFree < 0.55 && vSlow / vFree > 0.25, '3.6 inside it the enemies walk at ~40% (' + vFree.toFixed(2) + ' -> ' + vSlow.toFixed(2) + ' m/s)');

	// Shield: blocks for 3 s
	await A.page.evaluate(() => {
		window.__waves.prefs.set({ ability: 'shield' });
		window.__waves.powers.reset();
	});
	await grip(A.page, 'left');
	const sh = await A.page.evaluate(() => ({ on: window.__waves.powers.shielded(), bubble: window.__waves.root.getObjectByName('Waves shield')?.visible }));
	h.check(sh.on && sh.bubble, '3.7 the Shield raises its bubble');
	await A.page.waitForTimeout(3300);
	h.check(!(await A.page.evaluate(() => window.__waves.powers.shielded())), '3.8 and drops it after 3 s');

	// both hands armed: the ability stays on the LEFT grip; a gun in the left hand moves it right
	await A.page.evaluate(() => {
		window.__waves.prefs.set({ ability: 'pulse', hand: 'left' });
		window.__waves.powers.reset();
	});
	const before3 = await A.page.evaluate(() => window.__waves.powers.log.length);
	await grip(A.page, 'left');
	const afterLeft = await A.page.evaluate(() => window.__waves.powers.log.length);
	await grip(A.page, 'right');
	const afterRight = await A.page.evaluate(() => window.__waves.powers.log.length);
	h.check(afterLeft === before3 && afterRight === before3 + 1, '3.9 with the gun in the LEFT hand the ability moves to the RIGHT grip');
	await A.page.evaluate(() => window.__waves.prefs.set({ hand: 'right' }));

	// desktop: Q
	await headset(A.page, false);
	await A.page.evaluate(() => window.__waves.powers.reset());
	const beforeQ = await A.page.evaluate(() => window.__waves.powers.log.length);
	await A.page.keyboard.press('KeyQ');
	await A.page.waitForTimeout(200);
	h.check((await A.page.evaluate(() => window.__waves.powers.log.length)) === beforeQ + 1, '3.10 on a desktop Q fires the ability');
	const stored = await A.page.evaluate(() => JSON.parse(localStorage.getItem('tp:mod:waves:prefs') ?? 'null'));
	h.check(stored?.ability === 'pulse' && stored?.hand === 'right' && stored?.gun === 'blaster', '3.11 the loadout is remembered on this device (api.storage: ' + JSON.stringify(stored) + ')');
	await A.page.evaluate(() => {
		const api = window.__waves.api;
		if (api.__realPlayerPosition) api.playerPosition = api.__realPlayerPosition;
	});

	// =====================================================================
	// 4. P3 — the shooter's run: the menu, levels, the breach, the Shield, the results
	// =====================================================================
	const screen = (page) => page.evaluate(() => window.__stores.hudDocs.visibleScreen('scene')?.id ?? null);
	const rowsOf = (page, id) => page.evaluate((i) => (window.__stores.flowRuntime.hudRowsOf(i) ?? []).map((r) => (typeof r === 'string' ? r : r?.label ?? r?.text ?? JSON.stringify(r))), id);
	// a press, then a beat: the module reads its buttons' stamps at 10 Hz (a human cannot tap twice
	// inside 100 ms; a script can, and the second press would fold into the first)
	const pressHud = async (page, label) => {
		const ok = await page.evaluate((label) => {
			const b = [...document.querySelectorAll('#hud-layer button')].find((x) => x.textContent.trim() === label);
			if (!b) return false;
			b.click();
			return true;
		}, label);
		await page.waitForTimeout(250);
		return ok;
	};
	const crystal = (page) =>
		page.evaluate(() => {
			const s = window.__stores;
			const node = s.allNodes().find((n) => n.type === 'health' && n.data?.scope === 'player');
			let values;
			s.flowValues.subscribe((v) => (values = v))();
			return Number(values?.[node?.id]);
		});
	const levelNow = (page) => page.evaluate(() => window.__waves.snapshot()[0]?.level ?? null);
	const said = (page) => page.evaluate(() => window.__said ?? []);
	await A.page.evaluate(() => {
		const api = window.__waves.api;
		window.__said = [];
		api.announce = (text) => window.__said.push(text);
		window.__music = [];
		api.music = { play: (p, o) => window.__music.push('play:' + p + ':' + o?.volume), stop: () => window.__music.push('stop') };
	});
	// back to a fresh menu, on a desktop
	await headset(A.page, false);
	await A.page.evaluate(() => {
		window.__stores.gameState.setGameState('menu');
		window.__stores.isLocked.set(true);
	});
	await h.eventually(() => screen(A.page), (x) => x === 'menu', '4.0 the shell is on the menu');
	h.check(await pressHud(A.page, 'How to play'), '4.1 the menu has How to play');
	await h.eventually(() => screen(A.page), (x) => x === 'howto', '4.2 it opens the illustrated How to play');
	await pressHud(A.page, 'Back');
	await h.eventually(() => screen(A.page), (x) => x === 'menu', '4.3 Back returns to the menu');
	await pressHud(A.page, 'Loadout');
	await h.eventually(() => screen(A.page), (x) => x === 'loadout', '4.4 Loadout opens');
	await pressHud(A.page, 'Scatter');
	await pressHud(A.page, 'Shield');
	await h.eventually(() => A.page.evaluate(() => window.__waves.prefs.get()), (p) => p.gun === 'scatter' && p.ability === 'shield', '4.5 a gun and an ability picked on the Loadout screen');
	await h.eventually(() => rowsOf(A.page, 'wv-loadout-pick'), (r) => r[0] === 'Selected: Scatter + Shield', '4.6 and shown back');
	await pressHud(A.page, 'Back');
	await pressHud(A.page, 'Options');
	await h.eventually(() => screen(A.page), (x) => x === 'options', '4.7 Options opens');
	await pressHud(A.page, 'Gun hand');
	await pressHud(A.page, 'Music');
	await h.eventually(() => A.page.evaluate(() => window.__waves.prefs.get()), (p) => p.hand === 'left' && p.music === 'high', '4.8 Gun hand and Music cycle');
	await h.eventually(() => rowsOf(A.page, 'wv-opt-hand-v'), (r) => r[0] === 'Left', '4.9 and show their value');
	await pressHud(A.page, 'Gun hand');
	await pressHud(A.page, 'Gun hand');
	await pressHud(A.page, 'Back');
	await h.eventually(() => A.page.evaluate(() => window.__waves.prefs.get().hand), (x) => x === 'right', '4.10 back to the right hand');
	await A.page.evaluate(() => window.__waves.prefs.set({ gun: 'blaster', ability: 'shield' }));

	// Play, in the headset, through the board
	await headset(A.page, true);
	await h.eventually(() => A.page.evaluate(() => window.__waves.start.visible()), (v) => v, '4.11 in the headset the board offers the start');
	{
		const c = await boardCenter(A.page);
		const e = await eye(A.page);
		await pull(A.page, 'right', [e[0] + 0.2, e[1] - 0.4, e[2] - 0.2], c);
	}
	await h.eventually(() => gameState(A.page), (x) => x === 'playing', '4.12 the round starts');
	await h.eventually(() => said(A.page), (x) => x.includes('WAVE 1'), '4.13 "WAVE 1" is announced (api.announce)');
	await h.eventually(() => A.page.evaluate(() => window.__music), (m) => m.some((x) => x.startsWith('play:arcade')), '4.14 the arcade music plays in the game');
	h.check((await crystal(A.page)) === 10, '4.15 the crystal starts at 10');
	h.check((await A.page.evaluate(() => window.__stores.peerVars.myPeerVar('score', -1))) === 0, '4.16 the score starts at 0');

	// clear level 1 fast, through the module's own shot path
	const t0 = Date.now();
	while (Date.now() - t0 < 60000 && (await levelNow(A.page)) < 2) {
		await A.page.evaluate(() => {
			for (const t of window.__waves.engine.targets()) window.__waves.engine.hit(t.uuid, 99);
		});
		await A.page.waitForTimeout(400);
	}
	h.check((await levelNow(A.page)) === 2, '4.17 three waves cleared: LEVEL 2');
	await h.eventually(() => said(A.page), (x) => x.includes('LEVEL 2'), '4.18 "LEVEL 2" is announced');
	const f4 = await feelLog(A.page);
	h.check(f4.sounds.includes('levelup'), '4.19 with the levelup sound');
	h.check((await A.page.evaluate(() => window.__stores.peerVars.myPeerVar('score', 0))) === 900, '4.20 nine grunts at level 1 scored 900');
	await h.eventually(() => targets(A.page), (t) => t.some((x) => /Runner/.test(x.label)), '4.21 level 2 brings a runner into the wave', 15000);

	// the breach: an enemy that reaches the crystal costs 2
	const hpA = await crystal(A.page);
	await h.eventually(() => crystal(A.page), (v) => v === hpA - 2, '4.22 an enemy reaching the crystal breaches it: 10 -> 8', 40000);
	h.check((await feelLog(A.page)).sounds.includes('explosion'), '4.23 with an explosion');

	// the Shield holds a breach
	await A.page.evaluate(() => window.__waves.powers.reset());
	let shielded = false;
	const t1 = Date.now();
	while (Date.now() - t1 < 40000 && !shielded) {
		const near = await A.page.evaluate(() => {
			const s = window.__waves.snapshot()[0];
			let g;
			window.__stores.objectsGroup.subscribe((v) => (g = v))();
			let best = 99;
			for (const t of window.__waves.engine.targets()) {
				if (!t.walking) continue;
				const p = g.getObjectByProperty('uuid', t.uuid).getWorldPosition(new window.__stores.THREE.Vector3());
				best = Math.min(best, Math.hypot(p.x - s.goal[0], p.z - s.goal[2]));
			}
			return best;
		});
		if (near < 1.7 + 2) {
			await grip(A.page, 'left');
			shielded = await A.page.evaluate(() => window.__waves.powers.shielded());
		} else await A.page.waitForTimeout(150);
	}
	const hpS = await crystal(A.page);
	const ringsBefore = (await feelLog(A.page)).sounds.filter((x) => x === 'ring').length;
	await h.eventually(() => feelLog(A.page), (f) => f.sounds.filter((x) => x === 'ring').length > ringsBefore + 0, '4.24 a breach while the Shield is up is BLOCKED (the ring)', 8000);
	h.check((await crystal(A.page)) === hpS, '4.25 and the crystal keeps its ' + hpS);

	// the run is lost when the crystal falls
	await h.eventually(() => gameState(A.page), (x) => x === 'over', '4.26 breaches drain the crystal: the round is OVER', 120000);
	await h.eventually(() => rowsOf(A.page, 'wv-result-title'), (r) => r[0] === 'CRYSTAL DESTROYED', '4.27 the results: CRYSTAL DESTROYED');
	const res = await rowsOf(A.page, 'wv-result');
	h.check(res.length === 3 && /level 2/.test(res[0]) && /^Score /.test(res[1]), '4.28 the results panel: wave + level, score + kills, best (' + res.join(' | ') + ')');
	const best = await A.page.evaluate(() => JSON.parse(localStorage.getItem('tp:mod:waves:best') ?? 'null'));
	h.check(best && best.score >= 900 && best.level === 2, '4.29 the best run is saved on this device (' + JSON.stringify(best) + ')');
	await h.eventually(() => A.page.evaluate(() => window.__waves.start.visible()), (v) => v, '4.30 in the headset the board shows the result and "shoot to play again"');
	h.check((await said(A.page)).includes('CRYSTAL DESTROYED'), '4.31 announced');
	await A.page.evaluate(() => window.__waves.prefs.set({ music: 'off' }));
	await h.eventually(() => A.page.evaluate(() => window.__music), (m) => m[m.length - 1] === 'stop', '4.32 Music off stops it');

	// =====================================================================
	// 5. two peers — a shot, a kill and an ability reach the other player
	// =====================================================================
	if (!process.env.SOLO) {
		const B = await h.setupPage(browser, 'B');
		await h.installModule(B, 'health');
		await h.installModule(B, 'waves');
		// the connect dialog is editor UI: out of the headset and out of play first
		await headset(A.page, false);
		await A.page.evaluate(() => window.__stores.isLocked.set(false));
		await A.page.waitForTimeout(800);
		await h.connect(A, B);
		await A.page.evaluate(() => window.__stores.isLocked.set(true));
		await h.eventually(() => B.page.evaluate(() => window.__waves?.snapshot()[0]?.enemies.length ?? 0), (n) => n === 10, '5.1 B holds the same arena (ten enemies)', 20000);
		await B.page.evaluate(() => {
			const api = window.__waves.api;
			window.__feel = { sounds: [], haptics: [] };
			api.music = { play() {}, stop() {} };
			api.playSound = (name) => window.__feel.sounds.push(name);
		});
		await A.page.evaluate(() => window.__waves.prefs.set({ gun: 'blaster', ability: 'slowmo', hand: 'right' }));
		await headset(A.page, true);
		await h.eventually(() => A.page.evaluate(() => window.__waves.start.visible()), (v) => v, '5.2 A\'s board offers another round');
		{
			const c = await boardCenter(A.page);
			const e = await eye(A.page);
			await pull(A.page, 'right', [e[0] + 0.2, e[1] - 0.4, e[2] - 0.2], c);
		}
		await h.eventually(() => gameState(B.page), (x) => x === 'playing', '5.3 A\'s board press starts the round on B too (replicated)');
		await h.eventually(() => targets(A.page), (t) => t.some((x) => x.walking), '5.4 a walking enemy', 20000);
		const prey = (await targets(A.page)).find((t) => t.walking);
		const fromA = await worldPos(A.page, prey.uuid);
		const shooter = [fromA[0], fromA[1] + 0.3, fromA[2] + 3];
		const bHits0 = (await enemyState(B.page, prey.uuid))?.hits ?? 0;
		await shootAt(A.page, 'right', shooter, prey.uuid);
		await h.eventually(() => enemyState(B.page, prey.uuid), (e) => e && e.hits === bHits0 + 1, '5.5 A\'s shot lands on B\'s copy of the counter');
		for (let i = 0; i < 4; i++) {
			await shootAt(A.page, 'right', shooter, prey.uuid);
			await A.page.waitForTimeout(220);
		}
		await h.eventually(() => enemyState(B.page, prey.uuid), (e) => e && e.kills >= 1, '5.6 the kill is B\'s too');
		await h.eventually(() => B.page.evaluate(() => window.__feel.sounds), (x) => x.includes('explosion'), '5.7 B sees (hears) it explode');
		await h.eventually(() => worldPos(B.page, prey.uuid), (p) => p && p[1] < -10, '5.8 and takes it off B\'s field');
		const scoreA = await A.page.evaluate(() => window.__stores.peerVars.myPeerVar('score', 0));
		h.check(scoreA === 100, '5.9 the kill scores on A\'s own row (' + scoreA + ')');
		await A.page.evaluate(() => window.__waves.powers.reset());
		await A.page.evaluate(() => (window.__hand.left = { position: [0, 1, 0], quaternion: [0, 0, 0, 1], trigger: false, gripped: false }));
		await A.page.waitForTimeout(120);
		await A.page.evaluate(() => (window.__hand.left.gripped = true));
		await A.page.waitForTimeout(150);
		await A.page.evaluate(() => (window.__hand.left.gripped = false));
		await h.eventually(() => B.page.evaluate(() => (window.__waves.snapshot()[0] && window.__stores.gameState.gameVar('waves:fx:enemy', null)?.ev?.filter((e) => e.k === 'slow').length) || 0), (n) => n >= 1, '5.10 A\'s Slow-mo window reaches B (the fx variable)');
	}

	await h.finish(browser);
});
