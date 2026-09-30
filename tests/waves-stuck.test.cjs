// waves stuck test-flight (31 W1) — "the robots stop walking sometimes when attacking after
// one of them was killed". The Waves TEMPLATE with the real health + waves zips: a round is
// started from the headset board, wave 1 is cleared, and from wave 2 on enemies are killed
// (and hurt) ONE AT A TIME while the rest of the wave walks. Every other live enemy must keep
// walking toward the crystal — never stop, never snap back to its portal — and the wave's
// start must stay where it was.
//
// THE CAUSE (measured here, 31): the wave's start was `the previous wave's LAST HIT + interval`,
// read off the damage counters' latest stamp. Every enemy of wave n-1 walks again in wave n, so
// any later hit on one of them (a shot, a kill, a breach) moved that stamp — the whole wave
// jumped back to its portals and waited `interval` seconds. The start is now frozen per round
// the moment a wave clears (and replicated, so a late joiner reads the same one).
//
//   WAVES_TPSCENE=<scene.tpscene> APP_URL=https://theprototype.app:5267/ npm test -- waves-stuck
const h = require('./helpers.cjs');
const fs = require('fs');

const SCENE = process.env.WAVES_TPSCENE || '/home/deck/.code/theprototype-app/cloud-lane-30-staging/union-30b/games/waves/scene.tpscene';

async function loadTemplate(page) {
	if (!fs.existsSync(SCENE)) throw new Error('template not found: ' + SCENE + ' (set WAVES_TPSCENE)');
	const bytes = fs.readFileSync(SCENE);
	await page.evaluate(async (arr) => {
		const s = window.__stores;
		await s.sessions.applySession(await s.sessions.readSessionZip(new Uint8Array(arr).buffer), { backup: false });
	}, Array.from(bytes));
	await page.waitForTimeout(2500);
}
const gameState = (page) =>
	page.evaluate(() => {
		let g;
		window.__stores.gameState.gameState.subscribe((v) => (g = v))();
		return g?.state ?? null;
	});
const run = (page) =>
	page.evaluate(() => {
		const s = window.__waves.snapshot()[0];
		return s && { wave: s.wave, completed: s.completed, running: s.running, started: s.started, done: s.done, waveStart: s.waveStart, alive: s.alive, size: s.size, goal: s.goal };
	});
/** every enemy the wave uses and still counts alive, with its live ground distance to the goal */
const walkers = (page, all = false) =>
	page.evaluate((all) => {
		const w = window.__waves;
		const s = w.engine.all()[0];
		if (!s) return [];
		let g;
		window.__stores.objectsGroup.subscribe((v) => (g = v))();
		return w.engine
			.targets()
			.filter((t) => all || t.walking)
			.map((t) => {
				const p = g.getObjectByProperty('uuid', t.uuid).getWorldPosition(new window.__stores.THREE.Vector3());
				const f = w.avatars.figures.get(t.uuid);
				const clip = f && (f.actions.walk ?? f.actions.run);
				return { uuid: t.uuid, label: t.label, hp: t.hp, walking: t.walking, left: Math.hypot(p.x - s.goal[0], p.z - s.goal[2]), y: p.y, clip: clip ? { rate: +clip.timeScale.toFixed(2), on: clip.enabled && clip.getEffectiveWeight() > 0.5 } : null };
			});
	}, all);
const hit = (page, uuid, n) => page.evaluate(({ uuid, n }) => window.__waves.engine.hit(uuid, n), { uuid, n });
/** kill every live enemy of the wave on the spot (scripted shots) */
const clearWave = async (page) => {
	for (const t of await page.evaluate(() => window.__waves.engine.targets().map((x) => ({ uuid: x.uuid, hp: x.hp })))) await hit(page, t.uuid, t.hp);
};
/** the headset board: VR on, Interact, the module's vrHand replaced by a pose we aim */
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

h.run(async () => {
	const browser = await h.launch({ args: h.GPU_ARGS });
	const A = await h.setupPage(browser, 'A');
	await h.installModule(A, 'health');
	await h.installModule(A, 'waves');
	await loadTemplate(A.page);

	// ---- start the round from the headset board (the way a Quest starts it) ----
	await A.page.evaluate(() => window.__stores.playMode.requestPlay());
	await A.page.waitForTimeout(800);
	await headset(A.page, true);
	await A.page.waitForTimeout(400);
	const center = await A.page.evaluate(() => window.__waves.start.board.rect().center);
	const eye = await A.page.evaluate(() => window.__waves.api.playerPosition());
	// the player's own damage must not end the round mid-test: the Shield guards every breach
	await A.page.evaluate(() => window.__waves.engine.setGuard(() => true));
	const handAt = [eye[0] + 0.2, eye[1] - 0.4, eye[2] - 0.2];
	await aim(A.page, 'right', handAt, center, false);
	await A.page.waitForTimeout(120);
	await aim(A.page, 'right', handAt, center, true);
	await A.page.waitForTimeout(160);
	await aim(A.page, 'right', handAt, center, false);
	await h.eventually(() => gameState(A.page), (s) => s === 'playing', '0.1 the round runs');
	// hands away from the board / enemies: the flight's kills are scripted, never a stray shot
	await aim(A.page, 'right', handAt, [handAt[0], handAt[1] + 5, handAt[2] + 1], false);
	await h.eventually(() => run(A.page), (s) => s && s.running && s.started && s.wave === 1, '0.2 wave 1 walks');
	const r1 = await run(A.page);
	console.log('  curve: wave ' + r1.wave + ' size ' + r1.size + ' goal ' + JSON.stringify(r1.goal));

	// ---- wave 1: cleared on the spot (no enemy of wave 1 has been hit before) ----
	await clearWave(A.page);
	await h.eventually(() => run(A.page), (s) => s && s.wave === 2 && s.completed === 1, '0.3 wave 1 cleared -> wave 2');

	// ---- waves 2..4: N kills mid-attack, the rest must keep walking ----
	let kills = 0;
	const stalls = [];
	const jumps = [];
	const frozen = [];
	let clipsSeen = 0;
	let moving = 0;
	for (let wave = 2; wave <= 6; wave++) {
		await h.eventually(() => walkers(A.page), (w) => w.length >= 2 && w.every((x) => x.left < 1e3), wave + '.0 wave ' + wave + ' walks with ' + 2 + '+ enemies', 20000);
		// let them get going (the stagger): every walker has left its portal
		await A.page.waitForTimeout(1600);
		const start0 = (await run(A.page)).waveStart;
		for (let k = 0; ; k++) {
			// the walkers that are ON THEIR WAY (left their portal: the stagger holds the last ones)
			const pre = new Map((await walkers(A.page)).map((x) => [x.uuid, x.left]));
			await A.page.waitForTimeout(300);
			const before = await walkers(A.page);
			if (before.length < 2) break;
			// the victim: the one nearest the crystal (the one the player is shooting at); a hurt
			// first (a hit that is not a kill moves the stamp too), then the kill
			before.sort((a, b) => a.left - b.left);
			const victim = before[0];
			if (victim.hp > 1) await hit(A.page, victim.uuid, 1);
			await A.page.waitForTimeout(150);
			const r = await hit(A.page, victim.uuid, 99);
			if (r?.killed) kills++;
			// the others, over the next 0.9 s: each must come CLOSER to the crystal (a walker at
			// the crystal breaches and dies — it no longer counts)
			const others = before.filter((x) => x.uuid !== victim.uuid && (pre.get(x.uuid) ?? 0) - x.left > 0.1);
			moving += others.length;
			await A.page.waitForTimeout(900);
			// ALL the wave's live enemies (walking or not): a stalled one is not `walking` any more
			const after = new Map((await walkers(A.page, true)).map((x) => [x.uuid, x]));
			for (const o of others) {
				const a = after.get(o.uuid);
				if (!a) continue; // breached (or killed by the breach) in between
				const advanced = o.left - a.left;
				if (advanced < 0.3 || !a.walking) stalls.push(`w${wave} kill#${k + 1} ${o.label}: ${o.left.toFixed(2)} -> ${a.left.toFixed(2)} m${a.walking ? '' : ' (not walking)'}`);
				// its figure's walk clip plays (a figure sliding with a frozen clip reads as stuck)
				if (a.clip) {
					clipsSeen++;
					if (!(a.clip.rate > 0 && a.clip.on)) frozen.push(`w${wave} kill#${k + 1} ${o.label}: ${JSON.stringify(a.clip)}`);
				}
			}
			const s = await run(A.page);
			if (s.wave === wave && s.waveStart !== start0) jumps.push(`w${wave} kill#${k + 1}: waveStart ${start0} -> ${s.waveStart}`);
			if (s.wave !== wave) break;
		}
		// the rest of the wave (the last walker) goes too, and the next wave comes
		await clearWave(A.page);
		await h.eventually(() => run(A.page), (s) => s && (s.wave > wave || s.done), wave + '.9 wave ' + wave + ' cleared');
	}
	// ---- a BREACH mid-wave (the enemy's own attack: it explodes on the crystal = a kill by the
	// engine's local pulses): the rest of the wave walks on ----
	await h.eventually(() => walkers(A.page), (w) => w.length >= 3, '7.0 a wave of 3+ walks', 20000);
	await A.page.evaluate(() => {
		window.__breaches = [];
		window.__waves.engine.onRun((e) => e.kind === 'breach' && window.__breaches.push(e.enemy.uuid));
	});
	const breachStart = (await run(A.page)).waveStart;
	// sample the walkers every 300 ms until the first breach; keep the sample just before it
	let lastBefore = null;
	let breacher = null;
	for (let i = 0; i < 120 && !breacher; i++) {
		const w = await walkers(A.page);
		const b = await A.page.evaluate(() => window.__breaches[0] ?? null);
		if (b) breacher = b;
		else lastBefore = w;
		await A.page.waitForTimeout(300);
	}
	h.check(!!breacher, '7.1 an enemy reached the crystal and breached');
	if (breacher && lastBefore) {
		const pre = lastBefore.filter((x) => x.uuid !== breacher && x.left > 3);
		await A.page.waitForTimeout(900);
		const after = new Map((await walkers(A.page, true)).map((x) => [x.uuid, x]));
		const stuck = pre.filter((o) => {
			const a = after.get(o.uuid);
			return a && (!a.walking || o.left - a.left < 0.3);
		});
		const s = await run(A.page);
		h.check(pre.length > 0 && stuck.length === 0 && s.waveStart === breachStart, '7.2 after the breach the other ' + pre.length + ' walkers kept walking and the wave start held' + (stuck.length || s.waveStart !== breachStart ? ' (stuck: ' + stuck.map((x) => x.label).join(', ') + '; start ' + breachStart + ' -> ' + s.waveStart + ')' : ''));
	}

	h.check(kills >= 3 && moving >= 5, '5.1 enemies were killed mid-attack while others walked (' + kills + ' kills, ' + moving + ' walkers watched)');
	h.check(jumps.length === 0, '5.2 a hit or a kill never moves the running wave\'s start' + (jumps.length ? ': ' + jumps.join('; ') : ''));
	h.check(stalls.length === 0, '5.3 after every kill, every other live enemy KEPT WALKING toward the crystal (>= 0.3 m in 0.9 s)' + (stalls.length ? ': ' + stalls.join('; ') : ''));

	h.check(clipsSeen > 0 && frozen.length === 0, '5.4 every walking figure plays its walk clip after the kills (' + clipsSeen + ' seen)' + (frozen.length ? ': ' + frozen.join('; ') : ''));

	await h.finish(browser);
});
