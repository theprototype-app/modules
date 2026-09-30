// perf-probe — the roadmap-31 Performance protocol for ONE game, on the real artefacts:
// the game's .tpscene (a Games-tab file) + the module zips installed through the real
// manager, Play entered the way a user does (#play-button), then after 10 s:
//   renderer.info draw calls + triangles (EVERY render() of a frame, and the biggest one —
//   the scene pass; the desktop composer adds its own fullscreen passes, which a headset
//   does not run), geometries / textures, a texture-MB estimate, lights (+ shadow casters),
//   p50 / p95 / max frame ms with CDP CPU throttling x4, frames over 50 ms (the stutter a
//   player feels), and the bytes the MODULES allocate per second (a CDP heap sample
//   attributed to the module bundles' functions — "no per-frame allocations").
// Not a flight (the runner only picks *.test.cjs). Run it under the exclusive slot:
//
//   e2e-slot --exclusive -- env E2E_GPU=1 APP_URL=https://theprototype.app:5268/ \
//     GAME=dungeon TPSCENE=path/scene.tpscene ZIPS=dir OUT=out.json SHOT=out.png node tests/perf-probe.cjs
//
// GAME=dungeon walks the player along the longest corridor path of floor 1 (the viewer moves,
// so the Kit's light slots, culling and the halos all run as they do for a walking player);
// GAME=football starts a match (the first touch) and lets the ball fly.

const { launch, setupPage, check, finish } = require('./helpers.cjs');
const fs = require('fs');
const path = require('path');

const GAME = process.env.GAME || 'dungeon';
const TPSCENE = process.env.TPSCENE;
const ZIPS = process.env.ZIPS || path.join(__dirname, '..');
const OUT = process.env.OUT || '';
const SHOT = process.env.SHOT || '';
const SETTLE_MS = Number(process.env.SETTLE_MS || 10000);
const MEASURE_MS = Number(process.env.MEASURE_MS || 8000);
const THROTTLE = Number(process.env.THROTTLE || 4);
const MODULES = GAME === 'dungeon' ? ['dungeon', 'dungeon-realms'] : [GAME];

async function installZip(peer, id) {
	const bytes = fs.readFileSync(path.join(ZIPS, id + '.zip'));
	await peer.page.evaluate(() => window.__stores.modulesOpen.set(true));
	await peer.page.waitForTimeout(400);
	await peer.page.getByRole('tab', { name: /^User/ }).click();
	await peer.page.waitForTimeout(200);
	await peer.page.locator('#install-module-zip').setInputFiles({ name: id + '.zip', mimeType: 'application/zip', buffer: bytes });
	for (let i = 0; i < 80; i++) {
		const ids = await peer.page.evaluate(() => window.__stores.moduleSDK.loadedModules.map((m) => m.id));
		if (ids.includes(id)) break;
		await peer.page.waitForTimeout(250);
	}
	await peer.page.evaluate(() => window.__stores.modulesOpen.set(false));
	await peer.page.waitForTimeout(300);
}

/** the page-side sampler: wraps renderer.render, counts per display frame */
const SAMPLER = () => {
	const s = window.__stores;
	let r;
	s.globalRenderer.subscribe((v) => (r = v))();
	const P = (window.__probe = { frames: [], cur: { calls: 0, tris: 0, maxCalls: 0, maxTris: 0 }, last: 0, on: false });
	const original = r.render;
	r.render = function (...args) {
		const out = original.apply(this, args);
		const i = this.info.render;
		P.cur.calls += i.calls;
		P.cur.tris += i.triangles;
		if (i.calls > P.cur.maxCalls) {
			P.cur.maxCalls = i.calls;
			P.cur.maxTris = i.triangles;
		}
		return out;
	};
	const loop = (t) => {
		if (P.on && P.last) P.frames.push({ ms: t - P.last, ...P.cur });
		P.last = t;
		P.cur = { calls: 0, tris: 0, maxCalls: 0, maxTris: 0 };
		requestAnimationFrame(loop);
	};
	requestAnimationFrame(loop);
	return true;
};

/** scene inventory: lights, shadow casters, textures (MB estimate) */
const INVENTORY = () => {
	const s = window.__stores;
	let scene, r;
	s.globalScene.subscribe((v) => (scene = v))();
	s.globalRenderer.subscribe((v) => (r = v))();
	let lights = 0, shadows = 0, meshes = 0, visibleMeshes = 0, transmissive = 0, transparent = 0, instances = 0;
	const lightKinds = {};
	const textures = new Set();
	scene.traverseVisible((o) => {
		if (o.isLight && !o.isAmbientLight) {
			lights++;
			lightKinds[o.type] = (lightKinds[o.type] || 0) + 1;
			if (o.castShadow) shadows++;
		}
		if (o.isMesh) {
			visibleMeshes++;
			if (o.isInstancedMesh) instances += o.count;
			const mats = Array.isArray(o.material) ? o.material : [o.material];
			for (const m of mats) {
				if (!m) continue;
				if (m.transmission > 0) transmissive++;
				if (m.transparent) transparent++;
				for (const k of Object.keys(m)) if (m[k]?.isTexture) textures.add(m[k]);
			}
		}
	});
	scene.traverse((o) => { if (o.isMesh) meshes++; });
	let bytes = 0;
	for (const t of textures) {
		const img = t.image;
		const w = img?.width || img?.data?.width || 0;
		const h = img?.height || img?.data?.height || 0;
		bytes += w * h * 4 * (t.generateMipmaps ? 1.33 : 1);
	}
	return {
		lights, lightKinds, shadows, meshes, visibleMeshes, instances, transmissive, transparent,
		geometries: r.info.memory.geometries, textures: r.info.memory.textures,
		textureMB: Math.round((bytes / 1048576) * 10) / 10,
		shadowMap: !!r.shadowMap.enabled
	};
};

/** the dungeon walk: the longest BFS path of the published raster, from the entrance */
const DUNGEON_PATH = () => {
	const scene = (() => { let v; window.__stores.globalScene.subscribe((x) => (v = x))(); return v; })();
	const g = scene.getObjectByName('dungeon-module');
	const p = g?.userData?.play;
	if (!p) return null;
	const { grid, width: W, height: H, minX, minY, floorValue, rooms } = p;
	const start = rooms[0];
	// a published room is its top-left corner + size in world cells (contract.worldRoom)
	const sx = Math.floor(start.x + start.w / 2 - minX), sy = Math.floor(start.y + start.h / 2 - minY);
	const prev = new Int32Array(W * H).fill(-2);
	const q = [sy * W + sx];
	prev[q[0]] = -1;
	let last = q[0];
	while (q.length) {
		const i = q.shift();
		last = i;
		const x = i % W, y = (i / W) | 0;
		for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
			const nx = x + dx, ny = y + dy;
			if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
			const j = ny * W + nx;
			if (prev[j] !== -2 || grid[j] !== floorValue) continue;
			prev[j] = i;
			q.push(j);
		}
	}
	const cells = [];
	for (let i = last; i >= 0; i = prev[i]) cells.push([(i % W) + minX + 0.5, ((i / W) | 0) + minY + 0.5]);
	cells.reverse();
	// the Kit group's local frame -> world
	const THREE = window.__stores.THREE;
	g.updateWorldMatrix(true, false);
	return cells.map(([x, z]) => new THREE.Vector3(x, 0, z).applyMatrix4(g.matrixWorld).toArray());
};

/** move the play camera along `pts` at `speed` m/s every frame (window.__walk) */
const WALK = ({ pts, speed }) => {
	let cam;
	window.__stores.playerCam.subscribe((v) => (cam = v))();
	const THREE = window.__stores.THREE;
	const W = (window.__walk = { on: true, d: 0, last: 0, laps: 0 });
	const seg = [];
	let total = 0;
	for (let i = 1; i < pts.length; i++) {
		const l = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][2] - pts[i - 1][2]);
		seg.push(l);
		total += l;
	}
	const target = new THREE.Vector3();
	const step = (t) => {
		if (!W.on) return;
		const dt = W.last ? Math.min(0.1, (t - W.last) / 1000) : 0;
		W.last = t;
		W.d += dt * speed;
		// ping-pong along the path
		const lap = Math.floor(W.d / total);
		W.laps = lap;
		let d = W.d % total;
		if (lap % 2) d = total - d;
		let i = 0;
		while (i < seg.length - 1 && d > seg[i]) d -= seg[i++];
		const k = seg[i] ? d / seg[i] : 0;
		const a = pts[i], b = pts[i + 1] ?? pts[i];
		const x = a[0] + (b[0] - a[0]) * k, z = a[2] + (b[2] - a[2]) * k;
		const parent = cam.parent;
		const world = new THREE.Vector3(x, 1.6, z);
		if (parent) parent.worldToLocal(world);
		cam.position.set(world.x, world.y, world.z);
		const dir = lap % 2 ? -1 : 1;
		target.set(x + (b[0] - a[0]) * dir, 1.6, z + (b[2] - a[2]) * dir);
		cam.lookAt(target);
		requestAnimationFrame(step);
	};
	requestAnimationFrame(step);
	return total;
};

run();

async function run() {
	if (!TPSCENE) {
		console.log('TPSCENE=<path> is required');
		process.exit(2);
	}
	// uncapped frames: vsync would clamp every frame to the display's 16.7 ms and hide the cost
	const browser = await launch({ args: ['--disable-gpu-vsync', '--disable-frame-rate-limit'] });
	const A = await setupPage(browser, 'A', { context: { viewport: { width: 1280, height: 720 } } });
	for (const id of MODULES) await installZip(A, id);
	const loaded = await A.page.evaluate(() => window.__stores.moduleSDK.loadedModules.map((m) => m.id + '@' + m.version));
	console.log('modules: ' + loaded.join(', '));
	const bytes = fs.readFileSync(TPSCENE);
	await A.page.evaluate(async (arr) => {
		const s = window.__stores;
		const payload = await s.sessions.readSessionZip(new Uint8Array(arr).buffer);
		await s.sessions.applySession(payload, { backup: false });
	}, Array.from(bytes));
	await A.page.waitForTimeout(4000);
	await A.page.evaluate(SAMPLER);

	const cdp = await A.ctx.newCDPSession(A.page);
	await A.page.locator('#play-button').click();
	await A.page.waitForTimeout(1500);
	let walked = 0;
	if (GAME === 'dungeon') {
		await A.page.evaluate(() => window.__dungeonRealms?.game?.start?.());
		const pts = await A.page.evaluate(DUNGEON_PATH);
		check(!!pts && pts.length > 10, 'a walk path through floor 1 (' + (pts?.length ?? 0) + ' cells)');
		walked = await A.page.evaluate(WALK, { pts, speed: 2.2 });
	} else if (GAME === 'football') {
		// a first touch starts the match (the module's auto-start), then the ball flies
		await A.page.evaluate(() => {
			const fb = window.__football;
			const uuid = fb?.game?.config?.ballUuid;
			if (!uuid) return;
			const g = (() => { let v; window.__stores.objectsGroup.subscribe((x) => (v = x))(); return v; })();
			const ball = g.getObjectByProperty('uuid', uuid);
			fb.game.onHit?.({ uuid, by: '', local: true, at: Date.now() });
			window.__stores.physics.applyImpulse?.(uuid, [0.6, 0.2, -1.2]);
			return !!ball;
		});
	}
	await A.page.waitForTimeout(SETTLE_MS);

	await cdp.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE });
	await cdp.send('HeapProfiler.enable');
	await cdp.send('HeapProfiler.startSampling', { samplingInterval: 1024 });
	await A.page.evaluate(() => (window.__probe.on = true));
	await A.page.waitForTimeout(MEASURE_MS);
	await A.page.evaluate(() => (window.__probe.on = false));
	const { profile } = await cdp.send('HeapProfiler.stopSampling');
	await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });

	// module allocations: every sampled node whose frame is in a module bundle (blob:/data: urls
	// the manager loads a zip's module.js from) — self bytes, per second of measurement
	const byFn = {};
	let moduleBytes = 0, allBytes = 0;
	const walk = (node, inModule) => {
		const url = node.callFrame.url || '';
		const here = inModule || /^blob:|module\.js|^data:/.test(url);
		allBytes += node.selfSize;
		if (here && node.selfSize) {
			moduleBytes += node.selfSize;
			const k = (node.callFrame.functionName || '(anon)') + ':' + node.callFrame.lineNumber;
			byFn[k] = (byFn[k] || 0) + node.selfSize;
		}
		for (const c of node.children) walk(c, here);
	};
	walk(profile.head, false);

	const frames = await A.page.evaluate(() => window.__probe.frames);
	const ms = frames.map((f) => f.ms).sort((a, b) => a - b);
	const pct = (p) => ms[Math.min(ms.length - 1, Math.floor(p * ms.length))];
	const avg = (k) => Math.round(frames.reduce((s, f) => s + f[k], 0) / Math.max(1, frames.length));
	const inv = await A.page.evaluate(INVENTORY);
	const result = {
		game: GAME,
		modules: loaded,
		tpscene: TPSCENE,
		throttle: THROTTLE,
		frames: frames.length,
		p50: Math.round(pct(0.5) * 10) / 10,
		p95: Math.round(pct(0.95) * 10) / 10,
		max: Math.round(ms[ms.length - 1] * 10) / 10,
		over50: ms.filter((m) => m > 50).length,
		callsPerFrame: avg('calls'),
		trisPerFrame: avg('tris'),
		scenePassCalls: avg('maxCalls'),
		scenePassTris: avg('maxTris'),
		...inv,
		moduleAllocKBps: Math.round(moduleBytes / 1024 / (MEASURE_MS / 1000)),
		allAllocKBps: Math.round(allBytes / 1024 / (MEASURE_MS / 1000)),
		topModuleAlloc: Object.entries(byFn).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => k + ' ' + Math.round(v / 1024) + 'KB'),
		walkedPath: walked ? Math.round(walked) : undefined
	};
	console.log(JSON.stringify(result, null, 1));
	if (OUT) fs.writeFileSync(OUT, JSON.stringify(result, null, 1));
	if (SHOT) await A.page.screenshot({ path: SHOT });
	check(frames.length > 20, 'frames measured (' + frames.length + ')');
	await finish(browser);
}
