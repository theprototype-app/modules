// waves quality test-flight (31 W2) — the Quest budget, played. The Waves template with the real
// health + waves zips; a round started from the headset board (VR emulated at the module's seams,
// as waves-shooter does). Checks what each QUALITY LEVEL makes the figures and the kill cost:
//   high   the near figures cast shadows; LOD0 up close
//   low    no figure casts a shadow; every figure past 3 m shows its LOD1 mesh (same skeleton);
//          a kill throws 3 shards (high: 10)
//   auto   follows core's `api.quality` when the core has one (31-perf K4): level 2 -> low, 0 -> high
// and, at every level, the skinned figures are frustum-CULLED again (30c drew them behind the
// player too) with a bounding sphere padded for the stride. The near/far shots go to SHOTS_DIR.
//
//   WAVES_TPSCENE=<scene.tpscene> APP_URL=https://theprototype.app:5267/ npm test -- waves-quality
const h = require('./helpers.cjs');
const fs = require('fs');
const path = require('path');

const SCENE = process.env.WAVES_TPSCENE || '/home/deck/.code/theprototype-app/cloud-lane-30-staging/union-30b/games/waves/scene.tpscene';
const SHOTS = process.env.SHOTS_DIR || '';

const headset = (page) =>
	page.evaluate(() => {
		const s = window.__stores;
		s.isVRMode.set(true);
		s.editorMode.set('interact');
		const api = window.__waves.api;
		window.__hand = window.__hand ?? { right: null, left: null };
		if (!api.__realVrHand) api.__realVrHand = api.vrHand;
		api.vrHand = (hand) => (window.__hand[hand] ? { ...window.__hand[hand], connected: true } : null);
	});
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
const setQuality = (page, q) => page.evaluate((q) => window.__waves.prefs.set({ quality: q }), q);
/** every shown figure: its distance from the player, which LOD shows, shadows, culling */
const figures = (page) =>
	page.evaluate(() => {
		const w = window.__waves;
		const eye = w.api.playerPosition();
		const T = window.__stores.THREE;
		const out = [];
		for (const f of w.avatars.figures.values()) {
			if (!f.model.visible || f.dyingAt !== null) continue;
			const p = f.model.getWorldPosition(new T.Vector3());
			const skinned = [...f.near, ...f.far].filter((m) => m.isSkinnedMesh);
			out.push({
				kind: f.kind,
				dist: +Math.hypot(p.x - eye[0], p.z - eye[2]).toFixed(2),
				lod1: f.far.length > 0 && f.far.every((m) => m.visible) && f.near.every((m) => !m.visible),
				lod0: f.near.every((m) => m.visible) && f.far.every((m) => !m.visible),
				hasLod1: f.far.length > 0,
				shadow: f.near.some((m) => m.castShadow) || f.far.some((m) => m.castShadow),
				culled: skinned.every((m) => m.frustumCulled && m.boundingSphere && m.boundingSphere.radius > 0.5),
				sameSkeleton: f.far.every((m) => m.skeleton === f.near.find((n) => n.isSkinnedMesh)?.skeleton)
			});
		}
		return out;
	});
const run = (page) => page.evaluate(() => { const s = window.__waves.snapshot()[0]; return s && { wave: s.wave, started: s.started, running: s.running }; });

h.run(async () => {
	const browser = await h.launch({ args: h.GPU_ARGS });
	const A = await h.setupPage(browser, 'A', { context: { viewport: { width: 1280, height: 720 } } });
	await h.installModule(A, 'health');
	await h.installModule(A, 'waves');
	const bytes = fs.readFileSync(SCENE);
	await A.page.evaluate(async (arr) => {
		const s = window.__stores;
		await s.sessions.applySession(await s.sessions.readSessionZip(new Uint8Array(arr).buffer), { backup: false });
	}, Array.from(bytes));
	await A.page.waitForTimeout(2500);
	await h.eventually(() => A.page.evaluate(() => window.__waves.assets.status()), (s) => Object.values(s).every((v) => v === 'ready'), '0.1 the Meshy models loaded', 40000);

	// ---- the round, from the headset board ----
	await setQuality(A.page, 'high');
	await A.page.evaluate(() => window.__stores.playMode.requestPlay());
	await A.page.waitForTimeout(800);
	await headset(A.page);
	await A.page.waitForTimeout(400);
	const center = await A.page.evaluate(() => window.__waves.start.board.rect().center);
	const eye = await A.page.evaluate(() => window.__waves.api.playerPosition());
	await A.page.evaluate(() => window.__waves.engine.setGuard(() => true));
	const handAt = [eye[0] + 0.2, eye[1] - 0.4, eye[2] - 0.2];
	await aim(A.page, 'right', handAt, center, false);
	await A.page.waitForTimeout(120);
	await aim(A.page, 'right', handAt, center, true);
	await A.page.waitForTimeout(160);
	await aim(A.page, 'right', handAt, [handAt[0], handAt[1] + 5, handAt[2] + 1], false);
	await h.eventually(() => run(A.page), (s) => s && s.running && s.started, '0.2 the round runs');
	// a fuller wave: clear waves 1-3 on the spot
	for (let i = 0; i < 3; i++) {
		const s = await run(A.page);
		if (!s.started) await h.eventually(() => run(A.page), (x) => x.started, '  wave ' + s.wave + ' starts', 15000);
		await A.page.evaluate(() => { const e = window.__waves.engine; for (const t of e.targets()) e.hit(t.uuid, t.hp); });
		await h.eventually(() => run(A.page), (x) => x.wave > s.wave, '  wave ' + s.wave + ' cleared', 15000);
	}
	await h.eventually(() => run(A.page), (x) => x.started, '0.3 wave 4 walks', 15000);
	await A.page.waitForTimeout(1500);

	// ---- HIGH ----
	const hi = await figures(A.page);
	h.check(hi.length >= 3 && hi.every((f) => f.hasLod1 && f.sameSkeleton), '1.1 every figure carries its LOD1 mesh on the SAME skeleton (' + hi.length + ' figures)');
	h.check(hi.every((f) => f.culled), '1.2 the skinned figures are frustum-culled again, with a padded bounding sphere');
	const hiNear = hi.filter((f) => f.dist < 11);
	h.check(hiNear.length > 0 && hiNear.every((f) => f.lod0 && f.shadow), '1.3 HIGH: the figures within 11 m show LOD0 and cast shadows (' + JSON.stringify(hiNear.map((f) => [f.dist, f.lod0, f.shadow])) + ')');

	// ---- LOW ----
	await setQuality(A.page, 'low');
	await A.page.waitForTimeout(300);
	const lo = await figures(A.page);
	h.check(lo.length > 0 && lo.every((f) => !f.shadow), '2.1 LOW: no figure casts a shadow');
	const loFar = lo.filter((f) => f.dist > 3.2);
	h.check(loFar.length > 0 && loFar.every((f) => f.lod1), '2.2 LOW: every figure past 3 m shows its LOD1 mesh (' + JSON.stringify(lo.map((f) => [f.dist, f.lod1 ? 1 : 0])) + ')');
	const stats = await A.page.evaluate(() => ({ ...window.__waves.avatars.stats }));
	h.check(stats.lod1 > 0 && stats.halfRate > 0, '2.3 LOW: the frame task counts LOD1 figures and half-rate poses (' + JSON.stringify(stats) + ')');
	// the figures still walk (half-rate posing loses no time): a walker's clip time advances
	const clipAdvances = await A.page.evaluate(async () => {
		const f = [...window.__waves.avatars.figures.values()].find((x) => x.model.visible && x.dyingAt === null && x.gait.speed > 0.3);
		if (!f) return null;
		const walk = f.actions.walk ?? f.actions.run;
		const t0 = walk.time;
		await new Promise((r) => setTimeout(r, 600));
		return { dt: +(walk.time - t0).toFixed(3), rate: walk.timeScale };
	});
	h.check(!!clipAdvances && clipAdvances.dt !== 0, '2.4 LOW: a walking figure still animates (walk clip time moved ' + JSON.stringify(clipAdvances) + ')');

	// the kill's shards follow the level
	const shardsOf = async () => {
		const before = (await A.page.evaluate(() => window.__waves.juice.drawn().shard)) ?? 0;
		await A.page.evaluate(() => { const e = window.__waves.engine; const t = e.targets().find((x) => x.walking); if (t) e.hit(t.uuid, t.hp); });
		await A.page.waitForTimeout(300);
		return ((await A.page.evaluate(() => window.__waves.juice.drawn().shard)) ?? 0) - before;
	};
	const lowShards = await shardsOf();
	await setQuality(A.page, 'high');
	await A.page.waitForTimeout(200);
	const highShards = await shardsOf();
	h.check(lowShards === 3 && highShards === 10, '2.5 a kill throws 3 shards on LOW, 10 on HIGH (' + lowShards + ' / ' + highShards + ')');

	// ---- AUTO follows core's api.quality (31-perf K4) when there is one ----
	const auto = await A.page.evaluate(async () => {
		const w = window.__waves;
		const listeners = [];
		const real = w.api.quality;
		w.api.quality = { level: 4, onChange: (fn) => listeners.push(fn) };
		w.prefs.set({ quality: 'auto' });
		await new Promise((r) => setTimeout(r, 700));
		const a = { level: w.quality.level(), source: w.quality.source() };
		w.api.quality.level = 0;
		listeners.forEach((fn) => fn(0));
		await new Promise((r) => setTimeout(r, 700));
		const b = { level: w.quality.level(), source: w.quality.source() };
		if (real) w.api.quality = real;
		else delete w.api.quality;
		return { a, b };
	});
	h.check(auto.a.level === 2 && auto.a.source === 'core' && auto.b.level === 0, "3.1 AUTO follows core's api.quality: core level 4 -> LOW, 0 -> HIGH (" + JSON.stringify(auto) + ')');

	// ---- the look: one figure close (LOD0) and the same at LOW (LOD1), shots for a human eye ----
	if (SHOTS) {
		fs.mkdirSync(SHOTS, { recursive: true });
		await A.page.evaluate(() => window.__stores.isVRMode.set(false));
		for (const q of ['high', 'low']) {
			await setQuality(A.page, q);
			await A.page.waitForTimeout(700);
			await A.page.screenshot({ path: path.join(SHOTS, `quality-${q}.png`) });
		}
		await setQuality(A.page, 'auto');
	}
	await h.finish(browser);
});
