// Waves LOOK probe (31 W2) — not a flight: close-ups of one figure of each kind, for a human eye.
// In Edit (the figures stand at their parks facing the crystal), the camera flies ~2.4 m in front
// of each enemy; one shot with its LOD0 mesh, one with its LOD1 mesh (the same skeleton).
// WAVES_ZIP=waves-before shoots the 30c originals instead (their only mesh).
//   APP_URL=… E2E_GPU=1 SHOTS_DIR=… LABEL=after node tests/look-waves-lod.cjs
const h = require('./helpers.cjs');
const fs = require('fs');
const path = require('path');

const SCENE = process.env.WAVES_TPSCENE || '/home/deck/.code/theprototype-app/cloud-lane-30-staging/union-30b/games/waves/scene.tpscene';
const SHOTS = process.env.SHOTS_DIR || '.';
const LABEL = process.env.LABEL || 'after';

h.run(async () => {
	const browser = await h.launch({ args: h.GPU_ARGS });
	const A = await h.setupPage(browser, 'A', { context: { viewport: { width: 960, height: 720 } } });
	await h.installModule(A, 'health');
	await h.installModule(A, process.env.WAVES_ZIP || 'waves', 'waves');
	const bytes = fs.readFileSync(SCENE);
	await A.page.evaluate(async (arr) => {
		const s = window.__stores;
		await s.sessions.applySession(await s.sessions.readSessionZip(new Uint8Array(arr).buffer), { backup: false });
	}, Array.from(bytes));
	await A.page.waitForTimeout(2500);
	await h.eventually(() => A.page.evaluate(() => window.__waves.assets.status()), (s) => Object.values(s).every((v) => v === 'ready'), 'the models loaded', 40000);
	await h.eventually(() => A.page.evaluate(() => window.__waves.avatars.figures.size), (n) => n >= 3, 'the figures stand', 20000);
	fs.mkdirSync(SHOTS, { recursive: true });
	for (const kind of ['grunt', 'runner', 'tank']) {
		const at = await A.page.evaluate((kind) => {
			const T = window.__stores.THREE;
			const f = [...window.__waves.avatars.figures.values()].find((x) => x.kind === kind && x.model.visible);
			if (!f) return null;
			const p = f.model.getWorldPosition(new T.Vector3());
			const fwd = new T.Vector3(Math.sin(f.yaw), 0, Math.cos(f.yaw));
			const eye = p.clone().addScaledVector(fwd, 2.4).add(new T.Vector3(0.6, 1.1, 0));
			const target = p.clone().add(new T.Vector3(0, 0.6, 0));
			window.__stores.objectActions.flyTo(eye.toArray(), target.toArray());
			window.__lookFig = f;
			return p.toArray();
		}, kind);
		if (!at) {
			h.check(false, kind + ': a figure to shoot');
			continue;
		}
		await A.page.waitForTimeout(1800);
		for (const lod of ['lod0', 'lod1']) {
			const has = await A.page.evaluate((lod) => {
				const f = window.__lookFig;
				if (!f.far?.length) return lod === 'lod0';
				window.__waves.avatars.forceLod(lod === 'lod1' ? 1 : 0);
				return true;
			}, lod);
			if (!has) continue;
			await A.page.waitForTimeout(400);
			await A.page.screenshot({ path: path.join(SHOTS, `look-${LABEL}-${kind}-${lod}.png`) });
		}
	}
	await h.finish(browser);
});
