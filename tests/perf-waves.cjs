// Waves PERF PROBE (31 W2) — the rules' Performance protocol, by hand until core's
// `scripts/perf-games.cjs` (31-perf) lands. NOT a flight (no .test suffix): a measurement.
//
// The Waves template with the real health + waves zips, played the way a headset plays it
// (core's isVRMode + Interact, the module's vrHand emulated — the guns ride the hands), the
// round started from the headset board. Two moments:
//   A  "wave 1"  : 10 s into the round (the protocol's "after 10 s of Play")
//   B  "full"    : the biggest wave (every enemy walking — what level 3+ looks like), 6 s in
// Each reads: draw calls + triangles per display frame (every render() pass) AND one bare
// scene pass (what a headset eye draws: no composer), geometries / textures, texture MB
// (unique textures of the scene, w*h*4*1.33), lights (+ shadow casters), meshes casting shadows,
// skinned meshes shown, the modules' frame-task ms per frame, and p50/p95 frame ms under CDP
// CPU throttling x4. Run it under `e2e-slot --exclusive` (a timing measurement):
//
//   ~/.local/bin/e2e-slot --exclusive -- env APP_URL=https://theprototype.app:5267/ E2E_GPU=1 \
//     PERF_LABEL=before PERF_OUT=/home/deck/.code/lanes-30/after-31/31-waves node tests/perf-waves.cjs
// QUALITY=low|medium|high sets the module's quality before the round (31: the Waves setting).
const h = require('./helpers.cjs');
const fs = require('fs');
const path = require('path');

const SCENE = process.env.WAVES_TPSCENE || '/home/deck/.code/theprototype-app/cloud-lane-30-staging/union-30b/games/waves/scene.tpscene';
const LABEL = process.env.PERF_LABEL || 'probe';
const OUT = process.env.PERF_OUT || '';
const THROTTLE = Number(process.env.PERF_THROTTLE || 4);

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
const run = (page) => page.evaluate(() => { const s = window.__waves.snapshot()[0]; return s && { wave: s.wave, size: s.size, alive: s.alive, started: s.started, running: s.running, waves: s.waves }; });

/** the static reading: everything but the frame times */
const reading = (page) =>
	page.evaluate(async () => {
		const S = window.__stores;
		const T = S.THREE;
		const get = (store) => { let v; store.subscribe((x) => (v = x))(); return v; };
		const renderer = get(S.globalRenderer);
		const scene = get(S.globalScene);
		const camera = get(S.globalCamera);
		S.sceneBudget.startSceneMetrics();
		await new Promise((r) => setTimeout(r, 2200));
		const m = S.sceneBudget.sampleSceneMetrics();
		// one bare scene pass (a headset eye: no composer, no AO, no outline)
		const auto = renderer.info.autoReset;
		renderer.info.autoReset = true;
		renderer.render(scene, camera);
		const bare = { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles };
		renderer.info.autoReset = auto;
		let lights = 0, shadowLights = 0, casters = 0, skinned = 0, meshesShown = 0;
		const tex = new Set();
		const visibleIn = (o) => { for (let p = o; p; p = p.parent) if (p.visible === false) return false; return true; };
		scene.traverse((o) => {
			if (!visibleIn(o)) return;
			if (o.isLight && !o.isAmbientLight && !o.isHemisphereLight) { lights++; if (o.castShadow) shadowLights++; }
			if (o.isMesh || o.isPoints || o.isLine) {
				if (!o.layers.isEnabled(0)) return;
				meshesShown++;
				if (o.castShadow) casters++;
				if (o.isSkinnedMesh) skinned++;
				for (const mat of [].concat(o.material ?? []))
					for (const k of Object.keys(mat)) { const v = mat[k]; if (v && v.isTexture) tex.add(v); }
			}
		});
		let texBytes = 0;
		for (const t of tex) { const img = t.image; const w = img?.width ?? 0, h = img?.height ?? 0; texBytes += w * h * 4 * (t.generateMipmaps !== false ? 1.33 : 1); }
		const fig = window.__waves.avatars.stats;
		return {
			calls: m.calls, triangles: m.triangles, rendersPerFrame: m.rendersPerFrame,
			bareCalls: bare.calls, bareTriangles: bare.triangles,
			geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures,
			sceneTextures: tex.size, textureMB: Math.round(texBytes / 1048576 * 10) / 10,
			lights, shadowLights, casters, skinned, meshesShown, figuresWalking: fig.walking,
			shadowMap: renderer.shadowMap.enabled, pixelRatio: renderer.getPixelRatio()
		};
	});

/** frame times under CPU throttling + the modules' frame-task cost */
async function frames(page, seconds) {
	const cdp = await page.context().newCDPSession(page);
	await cdp.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE });
	const out = await page.evaluate(async (seconds) => {
		const tasks = window.__stores.moduleSDK.moduleFrameTasks;
		// time every module frame task for the window (restored after)
		const orig = tasks.slice();
		let taskMs = 0;
		for (let i = 0; i < tasks.length; i++) {
			const fn = tasks[i];
			tasks[i] = function (...a) { const t0 = performance.now(); try { return fn.apply(this, a); } finally { taskMs += performance.now() - t0; } };
		}
		const deltas = [];
		const heap0 = performance.memory?.usedJSHeapSize ?? 0;
		await new Promise((resolve) => {
			let last = performance.now();
			const end = last + seconds * 1000;
			const tick = () => {
				const now = performance.now();
				deltas.push(now - last);
				last = now;
				if (now < end) requestAnimationFrame(tick);
				else resolve();
			};
			requestAnimationFrame(tick);
		});
		for (let i = 0; i < orig.length; i++) if (tasks[i] !== orig[i]) tasks[i] = orig[i];
		deltas.shift();
		const sorted = deltas.slice().sort((a, b) => a - b);
		const q = (p) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
		return { frames: deltas.length, p50: +q(0.5).toFixed(1), p95: +q(0.95).toFixed(1), moduleMsPerFrame: +(taskMs / Math.max(1, deltas.length)).toFixed(2), heapMB: +(((performance.memory?.usedJSHeapSize ?? 0) - heap0) / 1048576).toFixed(1) };
	}, seconds);
	await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
	await cdp.detach();
	return out;
}

h.run(async () => {
	const browser = await h.launch({ args: h.GPU_ARGS });
	// PERF_STORAGE='{"k":"v"}' seeds localStorage before the app boots (an A/B of a core setting)
	const A = await h.setupPage(browser, 'A', { context: { viewport: { width: 1280, height: 720 } }, ...(process.env.PERF_STORAGE ? { storage: JSON.parse(process.env.PERF_STORAGE) } : {}) });
	await h.installModule(A, 'health');
	// WAVES_ZIP=waves-before installs <repo>/waves-before.zip (an A/B of two builds, same run)
	await h.installModule(A, process.env.WAVES_ZIP || 'waves', 'waves');
	const bytes = fs.readFileSync(SCENE);
	await A.page.evaluate(async (arr) => {
		const s = window.__stores;
		await s.sessions.applySession(await s.sessions.readSessionZip(new Uint8Array(arr).buffer), { backup: false });
	}, Array.from(bytes));
	await A.page.waitForTimeout(2500);
	await h.eventually(() => A.page.evaluate(() => window.__waves.assets.status()), (s) => Object.values(s).every((v) => v === 'ready'), 'the Meshy models loaded', 40000);
	if (process.env.QUALITY) await A.page.evaluate((q) => window.__waves.prefs.set({ quality: q }), process.env.QUALITY);

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
	// both guns out, pointing down the arena (as a player holds them)
	await aim(A.page, 'right', handAt, [handAt[0], handAt[1], handAt[2] + 8], false);
	await aim(A.page, 'left', [handAt[0] - 0.4, handAt[1], handAt[2]], [handAt[0] - 0.4, handAt[1], handAt[2] + 8], false);
	await h.eventually(() => run(A.page), (s) => s && s.running && s.started, 'the round runs');
	await A.page.waitForTimeout(10000);

	const rows = {};
	rows.wave1 = { ...(await reading(A.page)), ...(await frames(A.page, 6)), wave: (await run(A.page)).wave };
	if (OUT) await A.page.screenshot({ path: path.join(OUT, `perf-${LABEL}-wave1.png`) });

	// the biggest wave: clear waves (scripted) until every enemy walks
	for (let i = 0; i < 20; i++) {
		const s = await run(A.page);
		if (s.size >= 10 || s.wave >= s.waves) break;
		// a wave's veterans are healed only once it STARTS: clear it after that
		if (!s.started) {
			await h.eventually(() => run(A.page), (x) => x.started, '  wave ' + s.wave + ' starts', 15000);
			continue;
		}
		await A.page.evaluate(() => { const e = window.__waves.engine; for (const t of e.targets()) e.hit(t.uuid, t.hp); });
		await h.eventually(() => run(A.page), (x) => x.wave > s.wave || x.done, '  wave ' + s.wave + ' cleared', 15000);
	}
	await h.eventually(() => run(A.page), (s) => s.started, 'the full wave walks', 20000);
	await A.page.waitForTimeout(6000);
	rows.full = { ...(await reading(A.page)), ...(await frames(A.page, 6)), wave: (await run(A.page)).wave };
	// PROFILE=1: where the frame goes (unthrottled CPU profile, 4 s, top self time by function)
	if (process.env.PROFILE) {
		const cdp = await A.page.context().newCDPSession(A.page);
		await cdp.send('Profiler.enable');
		await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
		await cdp.send('Profiler.start');
		await A.page.waitForTimeout(4000);
		const { profile } = await cdp.send('Profiler.stop');
		const byId = new Map(profile.nodes.map((n) => [n.id, n]));
		const self = new Map();
		const dt = profile.timeDeltas;
		profile.samples.forEach((id, i) => {
			const n = byId.get(id);
			const f = n.callFrame;
			const key = (f.functionName || '(anon)') + ' ' + (f.url || '').split('/').slice(-2).join('/') + ':' + f.lineNumber;
			self.set(key, (self.get(key) ?? 0) + (dt[i] ?? 0));
		});
		const total = [...self.values()].reduce((a, b) => a + b, 0);
		const parent = new Map();
		for (const n of profile.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
		const byFile = new Map();
		profile.samples.forEach((id, i) => {
			const files = new Set();
			for (let x = id; x !== undefined; x = parent.get(x)) {
				const u = byId.get(x).callFrame.url;
				if (u) files.add(u.split('?')[0].split('/').slice(-2).join('/'));
			}
			for (const f of files) byFile.set(f, (byFile.get(f) ?? 0) + (dt[i] ?? 0));
		});
		// the hottest function's callers: the first frame up its stack outside svelte's runtime
		const hot = [...self].sort((a, b) => b[1] - a[1])[0][0].split(' ')[0];
		const callers = new Map();
		profile.samples.forEach((id, i) => {
			if (byId.get(id).callFrame.functionName !== hot) return;
			const chain = [];
			for (let x = parent.get(id); x !== undefined && chain.length < 40; x = parent.get(x)) {
				const f = byId.get(x).callFrame;
				const name = (f.functionName || '(anon)') + ' ' + (f.url || '').split('?')[0].split('/').slice(-1).join('/') + ':' + f.lineNumber;
				if (chain[chain.length - 1] !== name) chain.push(name);
				if (chain.length >= 14) break;
			}
			const key = chain.join(' <- ');
			callers.set(key, (callers.get(key) ?? 0) + (dt[i] ?? 0));
		});
		console.log('PROFILE callers of ' + hot + ':');
		for (const [k, v] of [...callers].sort((a, b) => b[1] - a[1]).slice(0, 8)) console.log('  ' + (v / 1000).toFixed(0).padStart(6) + ' ms  ' + k);
		console.log('PROFILE self (top 30 of ' + (total / 1000).toFixed(0) + ' ms):');
		for (const [k, v] of [...self].sort((a, b) => b[1] - a[1]).slice(0, 30)) console.log('  ' + (v / 1000).toFixed(0).padStart(6) + ' ms  ' + k);
		console.log('PROFILE inclusive by file (top 30):');
		for (const [k, v] of [...byFile].sort((a, b) => b[1] - a[1]).slice(0, 30)) console.log('  ' + (v / 1000).toFixed(0).padStart(6) + ' ms  ' + k);
		await cdp.detach();
	}
	if (OUT) await A.page.screenshot({ path: path.join(OUT, `perf-${LABEL}-full.png`) });

	console.log('PERF ' + LABEL + ' ' + JSON.stringify(rows));
	const keys = ['wave', 'calls', 'triangles', 'bareCalls', 'bareTriangles', 'rendersPerFrame', 'geometries', 'textures', 'sceneTextures', 'textureMB', 'lights', 'shadowLights', 'casters', 'skinned', 'meshesShown', 'figuresWalking', 'p50', 'p95', 'moduleMsPerFrame', 'heapMB', 'frames'];
	console.log('| metric | wave1 | full |\n|---|---|---|\n' + keys.map((k) => `| ${k} | ${rows.wave1[k]} | ${rows.full[k]} |`).join('\n'));
	if (OUT) fs.writeFileSync(path.join(OUT, `perf-${LABEL}.json`), JSON.stringify({ label: LABEL, throttle: THROTTLE, at: new Date().toISOString(), rows }, null, 2));
	await h.finish(browser);
});
