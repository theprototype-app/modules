// waves-hit-reset (31-integrate, the owner's Quest report on preview-1-18): "as soon as I hit an
// enemy, ALL enemies return to their start position". Played the headset way (the module's own
// seams — isVRMode, Interact, api.vrHand — exactly as waves-shooter does): the round starts from
// the board, wave 1 walks, ONE real trigger shot lands ONE hit on ONE enemy, and every OTHER
// walker must keep the ground it has covered (its distance from its own portal never collapses).
//   WAVES_TPSCENE=<scene.tpscene> APP_URL=https://theprototype.app:5269/ E2E_GPU=1 node tests/waves-hit-reset.test.cjs
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
/** the engine's targets in the engine's order, except that a walker within 4 m of the goal goes
 * LAST (30c): a check that takes "a walking enemy" must not take the one about to breach the
 * crystal — it dies (and is stashed) between the pick and the shot (2.14 / 2.15 failed at
 * random). Not "farthest first": that picks one still standing at its portal (3.2's shove clamps) */
const targets = (page) =>
	page.evaluate(() => {
		const w = window.__waves;
		const goal = w.engine.all()[0]?.goal ?? [0, 0, 0];
		let g;
		window.__stores.objectsGroup.subscribe((v) => (g = v))();
		const left = (u) => {
			const p = g.getObjectByProperty('uuid', u)?.position;
			return p ? Math.hypot(p.x - goal[0], p.z - goal[2]) : 0;
		};
		return w.engine
			.targets()
			.map((t) => ({ uuid: t.uuid, label: t.label, hp: t.hp, walking: t.walking, left: left(t.uuid) }))
			.map((t, i) => ({ t, i, late: t.walking && t.left < 4 ? 1 : 0 }))
			.sort((a, b) => a.late - b.late || a.i - b.i)
			.map((x) => x.t);
	});
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

/** every walking enemy: its world position and how far it is from its portal (the nearest spawn pad) */
const progress = (page) =>
	page.evaluate(() => {
		const w = window.__waves;
		const s = w.engine.all()[0];
		let g;
		window.__stores.objectsGroup.subscribe((v) => (g = v))();
		const T = window.__stores.THREE;
		const pads = g.children.filter((c) => /^Spawn/.test(c.name)).map((c) => c.getWorldPosition(new T.Vector3()));
		return w.engine
			.targets()
			.filter((t) => t.walking)
			.map((t) => {
				const p = g.getObjectByProperty('uuid', t.uuid).getWorldPosition(new T.Vector3());
				const fromPortal = Math.min(...pads.map((q) => Math.hypot(p.x - q.x, p.z - q.z)));
				return { uuid: t.uuid, label: t.label, hits: t.hits ?? null, fromPortal, toGoal: Math.hypot(p.x - s.goal[0], p.z - s.goal[2]) };
			});
	});
const run = (page) => page.evaluate(() => { const s = window.__waves.snapshot()[0]; return s && { wave: s.wave, completed: s.completed, started: s.started, waveStart: s.waveStart }; });

h.run(async () => {
	const browser = await h.launch({ args: h.GPU_ARGS });
	const A = await h.setupPage(browser, 'A');
	await h.installModule(A, 'health');
	await h.installModule(A, process.env.WAVES_ZIP || 'waves', 'waves');
	await loadTemplate(A.page);
	// a Quest session is Interact WITHOUT desktop Play (isLocked stays null); PLAY=1 also presses Play
	if (process.env.PLAY) {
		await A.page.evaluate(() => window.__stores.playMode.requestPlay());
		await A.page.waitForTimeout(800);
	}
	await headset(A.page, true);
	await A.page.waitForTimeout(400);
	// a REAL session starts the scene's simulation here (simOnPlay; Play never runs in a headset)
	if (!process.env.PLAY) await A.page.evaluate(() => window.__stores.playMode.noteXRSessionStarted());
	await A.page.waitForTimeout(1500);
	const sim0 = await A.page.evaluate(() => { let v; window.__stores.physics.simulating.subscribe((x) => (v = x))(); return v; });
	h.check(sim0 === true, '0.0 (premise) the simulation runs, as in a headset session (simOnPlay)');
	// a headset session takes the governor's entry floor (shadows off, level 1) — as on a Quest
	await A.page.evaluate((l) => window.__stores.qualityGovernor.governorForTest.setLevel(l), Number(process.env.QLEVEL || 1));
	const head = await eye(A.page);
	const center = await boardCenter(A.page);
	const hand = [head[0] + 0.2, head[1] - 0.4, head[2] - 0.2];
	await pull(A.page, 'right', hand, center);
	await h.eventually(() => gameState(A.page), (s) => s === 'playing', '0.1 the round runs (started from the headset board)');
	await A.page.evaluate(() => window.__waves.engine.setGuard?.(() => true));
	await aim(A.page, 'right', hand, [hand[0], hand[1] + 5, hand[2] + 1], false);
	await h.eventually(() => progress(A.page), (p) => p.filter((x) => x.fromPortal > 1.0).length >= 2, '0.2 wave 1 walks (2+ walkers clear of their portals)', 20000);
	const r0 = await run(A.page);
	h.check(r0.wave === 1, '0.2b (premise) this is WAVE 1 — the first hit of the round (' + JSON.stringify(r0) + ')');
	const before = await progress(A.page);
	const out = before.filter((x) => x.fromPortal > 1.0);
	h.check(out.length >= 2, '0.3 (premise) 2+ walkers are well clear of their portals (' + before.map((x) => x.fromPortal.toFixed(2)).join(', ') + ')');
	// ---- ONE real shot at the walker nearest the crystal ------------------------------------
	const victim = [...out].sort((a, b) => a.toGoal - b.toGoal)[0];
	const s0 = await enemyState(A.page, victim.uuid);
	await shootAt(A.page, 'right', hand, victim.uuid);
	await h.eventually(() => enemyState(A.page, victim.uuid), (e) => e && e.hits === s0.hits + 1, '1.1 (premise) the trigger landed ONE hit on the victim');
	const samples = [];
	for (const ms of [150, 400, 900, 1500]) {
		await A.page.waitForTimeout(ms - (samples.length ? [150, 400, 900, 1500][samples.length - 1] : 0));
		samples.push(await progress(A.page));
	}
	const r1 = await run(A.page);
	const others = out.filter((x) => x.uuid !== victim.uuid);
	const worst = others.map((x) => {
		const lows = samples.map((s) => s.find((y) => y.uuid === x.uuid)?.fromPortal ?? x.fromPortal);
		return { label: x.label, before: +x.fromPortal.toFixed(2), min: +Math.min(...lows).toFixed(2) };
	});
	h.check(worst.every((x) => x.min > x.before - 0.4), '1.2 THE REPORT: no other walker goes back toward its portal after the hit (' + JSON.stringify(worst) + ')');
	h.check(worst.every((x) => x.min > 0.8), '1.3 ...and none is back at its start position');
	h.check(r1.waveStart === r0.waveStart && r1.wave === r0.wave, '1.4 the wave clock did not move (' + JSON.stringify(r0) + ' -> ' + JSON.stringify(r1) + ')');

	// ---- 2. the same in WAVE 2: every enemy of wave 1 walks again, so a hit on any of them used to
	// move "the clear" and with it the running wave's start (the 1.17 W1 bug, fixed in 2.2.0) ----
	const hitN = (uuid, n) => A.page.evaluate(({ uuid, n }) => window.__waves.engine.hit(uuid, n), { uuid, n });
	for (let i = 0; i < 6 && (await run(A.page)).wave === 1; i++) {
		for (const t of await A.page.evaluate(() => window.__waves.engine.targets().map((x) => ({ uuid: x.uuid, hp: x.hp })))) await hitN(t.uuid, t.hp);
		await A.page.waitForTimeout(600);
	}
	await h.eventually(() => run(A.page), (r) => r && r.wave === 2 && r.started, '2.0 (premise) wave 1 cleared, wave 2 walks', 25000);
	await h.eventually(() => progress(A.page), (p) => p.filter((x) => x.fromPortal > 1.0).length >= 2, '2.1 (premise) 2+ wave-2 walkers clear of their portals', 20000);
	const w0 = await run(A.page);
	const before2 = (await progress(A.page)).filter((x) => x.fromPortal > 1.0);
	const victim2 = [...before2].sort((a, b) => a.toGoal - b.toGoal)[0];
	const e0 = await enemyState(A.page, victim2.uuid);
	await shootAt(A.page, 'right', hand, victim2.uuid);
	await h.eventually(() => enemyState(A.page, victim2.uuid), (e) => e && e.hits === e0.hits + 1, '2.2 (premise) the trigger landed ONE hit in wave 2');
	const samples2 = [];
	for (let i = 0; i < 4; i++) {
		await A.page.waitForTimeout(350);
		samples2.push(await progress(A.page));
	}
	const w1 = await run(A.page);
	const worst2 = before2.filter((x) => x.uuid !== victim2.uuid).map((x) => {
		const lows = samples2.map((s) => s.find((y) => y.uuid === x.uuid)?.fromPortal ?? 0);
		return { label: x.label, before: +x.fromPortal.toFixed(2), min: +Math.min(...lows).toFixed(2) };
	});
	h.check(worst2.length > 0 && worst2.every((x) => x.min > x.before - 0.4 && x.min > 0.8), '2.3 THE REPORT in wave 2: every other walker keeps its ground after the hit (' + JSON.stringify(worst2) + ')');
	h.check(w1.waveStart === w0.waveStart, '2.4 the running wave\'s start did not move (' + w0.waveStart + ' -> ' + w1.waveStart + ')');
	await h.finish(browser);
});
