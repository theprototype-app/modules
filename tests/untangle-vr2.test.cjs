// untangle-vr2 test-flight (roadmap 31, lane 31-untangle): the SECOND Quest round's feedback on
// the REAL template scene (games/untangle/scene.tpscene, authored from this checkout's def).
//
//   T  the template: the board stands at the def's pose (radius 0.85, chest height 1.4) and
//      publishes a VR-only spawn 1.35 m in front of it, on the stage top the floor probe found
//   L  U3/U5 the LEVEL PICKER in the headset: core's REAL VR game panel (30b C2) is driven with
//      the template's menu screen; the module's picker lies exactly over the panel's hole (the
//      module-DOM level grid core cannot draw — measured against core's own Start rect), in
//      front of it; the laser's hover lights a cell; a trigger press on "3D globe" switches BOTH
//      peers to the globe on the SAME level; a locked cell is inert; the solved card is not the
//      menu (no picker); an open level loads on both peers; Continue starts the round
//   B  mid-round the VR bar's "Levels" cell opens the picker ON the board (drawn over it); a
//      level press loads it and closes the picker; Close closes it
//   U4 the VR bar is a console at waist height in front of the board, facing the player, drawn
//      over the scene (depthTest off) and under core's panels (renderOrder 990 < 1000); nothing
//      of the room lies between the spawn's eyes and it; a render PROBE: an opaque red box put
//      between the eye and the bar does not hide the bar (it did with the depth test on)
//   U1 the world moved / turned / SCALED 1.5x (the rig worldGrab drives): a TIP drag still lands
//      the dot exactly where the tip is. On a core with contract K1 (feature-detected: the scene's
//      play.locomotion.worldGrab survives normalisation) the real two-grip gesture in Interact
//      scales the rig first (fake XR gamepads through the real per-frame path)
//   U2 the SPAWN, through the real per-frame XR path (core's tests/e2e/fakeXR.cjs, CORE_DIR):
//      standing at the origin (inside the dots, the user's report) and entering VR lands the head
//      on the published spawn with the board's centre ahead inside a 15 degree cone, 1.2-1.5 m
//      away, below the eyes — on the board and on the globe
//   K  contract K3 (31-game-shell): when the core has api.game.levels / addSetting the module
//      handed the shell the 30 levels + the "Board" setting (feature-detected; SKIP on 1.17)
//
// VR EMULATION: `isVRMode` on the store + the module's `vrSim` seam for the controller poses
// (as untangle-vr), core's vrGamePanelFrame driven with a synthetic head (as core's vr-game-panel
// suite), and fakeXR for the spawn. The feel, the reach and the readability are OWED on a Quest.
//
//   npm run build:untangle && npm run pack -- untangle
//   (core) APP_URL=… MODULES_REPO=<this checkout> node scripts/author-templates.cjs --only untangle --out <dir>
//   UNTANGLE_TPSCENE=<dir>/games/untangle/scene.tpscene CORE_DIR=<core checkout> \
//     APP_URL=https://theprototype.app:5266/ E2E_GPU=1 node tests/untangle-vr2.test.cjs

const fs = require('fs');
const path = require('path');
const { launch, setupPage, installModule, connect, check, eventually, finish, run } = require('./helpers.cjs');

const STAGING = '/home/deck/.code/theprototype-app/cloud-lane-30-staging/31-untangle/games/untangle/scene.tpscene';
const TPSCENE = process.env.UNTANGLE_TPSCENE || (fs.existsSync(STAGING) ? STAGING : null);
const CORE_DIR = process.env.CORE_DIR || path.join(__dirname, '..', '..', 'theprototype');
const FAKE_XR = path.join(CORE_DIR, 'tests', 'e2e', 'fakeXR.cjs');

const state = (page) => page.evaluate(() => window.__untangle?.state() ?? null);
const menuOf = (page) => page.evaluate(() => window.__untangle.vrMenu());
const lastHands = { left: null, right: null };
const setHands = (page, hands) => {
	Object.assign(lastHands, hands);
	return page.evaluate((h) => window.__untangle.vrSim(h), lastHands);
};
const aimPose = (page, from, to, trigger) =>
	page.evaluate(({ from, to, trigger }) => {
		const THREE = window.__stores.THREE;
		const d = new THREE.Vector3(...to).sub(new THREE.Vector3(...from)).normalize();
		return { position: from, quaternion: new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, -1), d).toArray(), trigger };
	}, { from, to, trigger });
/** the right hand at `from`, lasering `to`: aim, press, release */
async function press(page, from, to) {
	await setHands(page, { right: await aimPose(page, from, to, false) });
	await page.waitForTimeout(90);
	await setHands(page, { right: await aimPose(page, from, to, true) });
	await page.waitForTimeout(90);
	await setHands(page, { right: await aimPose(page, from, to, false) });
	await page.waitForTimeout(150);
}
/** one frame of core's VR game panel with a head standing on the spawn, facing the board */
const panelFrame = (page, head) =>
	page.evaluate((head) => {
		const s = window.__stores;
		const THREE = s.THREE;
		return s.gameKit.vrGamePanel.vrGamePanelFrame({
			head: { position: new THREE.Vector3(...head), quaternion: new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, 0, 'YXZ')) },
			hands: [null, null],
			dt: 1 / 72
		});
	}, head);
const setGame = (page, st) => page.evaluate((st) => window.__stores.gameState.setGameState(st), st);
const gameNow = (page) => page.evaluate(() => { let v; window.__stores.gameState.gameState.subscribe((x) => (v = x))(); return v?.state ?? v; });

/** SHOTS=<dir>: a picture from the spawn's eyes (evidence, never asserted) */
async function shot(page, name, eye, target) {
	if (!process.env.SHOTS) return;
	await page.evaluate(({ eye, target }) => {
		let cam, controls;
		window.__stores.globalCamera.subscribe((v) => (cam = v))();
		window.__stores.orbitControls.subscribe((v) => (controls = v))();
		cam.position.set(...eye);
		controls.target.set(...target);
		controls.update();
	}, { eye, target });
	await page.waitForTimeout(500);
	// the load / never-saved toasts are not the game
	await page.evaluate(() => document.querySelectorAll('button').forEach((b) => { if (b.textContent.trim() === 'Not now' || b.getAttribute('aria-label') === 'Dismiss') b.click(); }));
	await page.addStyleTag({ content: '[class*="toast"], [role="status"] { display: none !important; }' });
	await page.waitForTimeout(200);
	fs.mkdirSync(process.env.SHOTS, { recursive: true });
	await page.screenshot({ path: path.join(process.env.SHOTS, name + '.png') });
}

/**
 * SHOTS=<dir>: what the HEADSET sees from `eye` (evidence, never asserted). With isVRMode on, the
 * page draws from the VR rig, not the editor camera, so this renders the scene itself through a
 * 70-degree camera at the eye into a target and writes the PNG (no post stack; sRGB-encoded here).
 */
async function eyeShot(page, name, eye, target) {
	if (!process.env.SHOTS) return;
	const png = await page.evaluate(({ eye, target }) => {
		const s = window.__stores;
		const THREE = s.THREE;
		let renderer, scene;
		s.globalRenderer.subscribe((v) => (renderer = v))();
		s.globalScene.subscribe((v) => (scene = v))();
		const W = 1280;
		const H = 720;
		const cam = new THREE.PerspectiveCamera(70, W / H, 0.05, 200);
		cam.position.set(...eye);
		cam.lookAt(new THREE.Vector3(...target));
		cam.updateMatrixWorld(true);
		const rt = new THREE.WebGLRenderTarget(W, H);
		rt.texture.colorSpace = THREE.SRGBColorSpace;
		const xr = renderer.xr.enabled;
		renderer.xr.enabled = false;
		renderer.setRenderTarget(rt);
		renderer.render(scene, cam);
		const px = new Uint8Array(W * H * 4);
		renderer.readRenderTargetPixels(rt, 0, 0, W, H, px);
		renderer.setRenderTarget(null);
		renderer.xr.enabled = xr;
		rt.dispose();
		const c = document.createElement('canvas');
		c.width = W;
		c.height = H;
		const g = c.getContext('2d');
		const img = g.createImageData(W, H);
		for (let y = 0; y < H; y++) img.data.set(px.subarray((H - 1 - y) * W * 4, (H - y) * W * 4), y * W * 4);
		g.putImageData(img, 0, 0);
		return c.toDataURL('image/png').split(',')[1];
	}, { eye, target });
	fs.mkdirSync(process.env.SHOTS, { recursive: true });
	fs.writeFileSync(path.join(process.env.SHOTS, name + '.png'), Buffer.from(png, 'base64'));
}

run(async () => {
	if (!TPSCENE || !fs.existsSync(TPSCENE)) {
		console.log('SKIP: no untangle scene.tpscene (UNTANGLE_TPSCENE, or the lane staging ' + STAGING + ')');
		return;
	}
	const browser = await launch();
	const A = await setupPage(browser, 'A', { context: { viewport: { width: 1280, height: 720 } } });
	const B = await setupPage(browser, 'B');
	await installModule(A, 'untangle');
	await installModule(B, 'untangle');
	await connect(A, B);
	await eventually(() => state(A.page), (s) => !!s && s.built, 'A: the board stands');

	// ---- T. the template ------------------------------------------------------------------------
	const bytes = Array.from(fs.readFileSync(TPSCENE));
	console.log('  scene ' + TPSCENE + ' (' + bytes.length + ' B)');
	await A.page.evaluate(async (arr) => {
		const s = window.__stores;
		await s.sessions.applySession(await s.sessions.readSessionZip(new Uint8Array(arr).buffer), { backup: false });
	}, bytes);
	await eventually(() => state(A.page), (s) => s.nodeOwned && Math.abs(s.board.radius - 0.85) < 1e-9 && Math.abs(s.board.boardY - 1.4) < 1e-9, 'T.1 the template board: radius 0.85 at chest height 1.4 (the node\'s pose)', 20000);
	await eventually(() => B.page.evaluate(() => window.__untangle.state()), (s) => s.nodeOwned && Math.abs(s.board.radius - 0.85) < 1e-9, 'T.2 B got the room and the same board', 30000);
	await eventually(() => A.page.evaluate(() => window.__untangle.spawn()), (s) => !!s && Math.abs(s.position[1] - 0.1) < 0.02, 'T.3 the board publishes a spawn standing on the stage top (y 0.1, the floor probe)', 8000);
	const sp = await A.page.evaluate(() => window.__untangle.spawn());
	check(!!sp && sp.vrOnly === true && Math.abs(sp.position[2] - 1.35) < 1e-6 && Math.abs(sp.position[0]) < 1e-6 && sp.yaw === 0, 'T.4 ...1.35 m in front of the board, centred, facing it, VR-only (' + JSON.stringify(sp) + ')');
	const resolved = await A.page.evaluate(() => {
		let scene;
		window.__stores.globalScene.subscribe((v) => (scene = v))();
		return window.__stores.playSettings.resolvePlaySettings(scene);
	});
	check(JSON.stringify(resolved.spawn?.position) === JSON.stringify(sp?.position), 'T.5 core resolves THAT spawn (the module publisher) (' + JSON.stringify(resolved.spawn) + ')');
	const k1 = resolved.locomotion?.worldGrab === true;
	// evidence: the template as a desktop player sees it (the def's view), the board and the globe
	if (process.env.SHOTS) {
		await A.page.evaluate(() => window.__stores.objectActions.setEditorMode('interact'));
		await shot(A.page, 'desktop-2d', [0, 1.55, 3.6], [0, 1.4, 0]);
		await A.page.evaluate(() => window.__untangle.select(1, '3d'));
		await A.page.waitForTimeout(400);
		await shot(A.page, 'desktop-globe', [0, 1.55, 3.6], [0, 1.4, 0]);
		await A.page.evaluate(() => window.__untangle.select(1, '2d'));
		await A.page.waitForTimeout(400);
	}
	console.log('  contract K1 (worldGrab) in this core: ' + k1);

	// the VR scene of the rest: Interact, a headset (emulated), the hands out of the way
	// (a core resolving no spawn at all: the eyes the spawn should have given, so the rest still reports)
	const stand = sp ?? resolved.spawn ?? { position: [0, 0.1, 1.35] };
	const EYE = [0, stand.position[1] + 1.6, stand.position[2]];
	const HAND = [0.22, EYE[1] - 0.4, EYE[2] - 0.25];
	const AWAY = [0, 6, 6];
	await A.page.evaluate(() => {
		window.__stores.objectActions.setEditorMode('interact');
		window.__stores.isVRMode.set(true);
	});
	await setHands(A.page, { right: await aimPose(A.page, HAND, AWAY, false), left: await aimPose(A.page, AWAY, [0, 7, 7], false) });
	await setGame(A.page, 'menu');

	// ---- L. the level picker over core's VR panel -----------------------------------------------
	const f1 = await panelFrame(A.page, EYE);
	check(f1.panel === 'menu', 'L.0 (premise) core\'s VR panel shows the template\'s menu screen (' + JSON.stringify(f1.panel) + ')');
	await eventually(() => menuOf(A.page), (m) => m.at === 'panel' && m.visible, 'L.1 the module\'s level picker is drawn ON core\'s panel (it was a blank hole: the level grid is module DOM)', 4000);
	const m1 = await menuOf(A.page);
	const fit = await A.page.evaluate(() => {
		const s = window.__stores;
		const THREE = s.THREE;
		const k = s.gameKit.vrGamePanel;
		const surf = k.vrGameSurface('vr-game-panel');
		const start = k.vrGamePanelDebug().hits['vr-game-panel'].find((x) => x.id === 'start-btn');
		if (!surf || !start) return null;
		// the Start button's canvas rect gives core's px-per-stage-px and the crop origin: the
		// levels element (480 x 330 at stage centre + (0, 10)) is then where the hole must be
		const kpx = start.w / 220;
		const cx = start.x + start.w / 2 + (640 - 640) * kpx;
		const cy = start.y + start.h / 2 + ((360 + 10) - (360 + 212)) * kpx;
		const g = surf.mesh.geometry.parameters;
		const at = surf.mesh.localToWorld(new THREE.Vector3((cx / surf.canvas.width - 0.5) * g.width, (0.5 - cy / surf.canvas.height) * g.height, 0));
		const n = new THREE.Vector3(0, 0, 1).applyQuaternion(surf.mesh.getWorldQuaternion(new THREE.Quaternion()));
		const mine = new THREE.Vector3(...window.__untangle.vrMenu().centre);
		const w = (480 * kpx * g.width) / surf.canvas.width;
		const off = mine.clone().sub(at);
		return { err: off.clone().sub(n.clone().multiplyScalar(off.dot(n))).length(), proud: off.dot(n), wantW: w, size: window.__untangle.vrMenu().size };
	});
	check(!!fit && fit.err < 0.005, 'L.2 the picker sits exactly on the hole (' + (fit ? (fit.err * 1000).toFixed(1) : '?') + ' mm from where core\'s own Start rect puts the level grid)');
	check(!!fit && Math.abs(fit.size[0] - fit.wantW) < 0.005, 'L.3 ...and is the level grid\'s size (' + (fit ? fit.size[0].toFixed(3) + ' vs ' + fit.wantW.toFixed(3) : '?') + ' m wide)');
	check(!!fit && fit.proud > 0 && fit.proud < 0.02, 'L.4 ...a few mm in front of the panel, toward the eyes (' + (fit ? (fit.proud * 1000).toFixed(1) : '?') + ' mm)');
	check(m1.renderOrder > 1000 && m1.depthTest === false, 'L.5 drawn over the scene AND over core\'s panel (renderOrder ' + m1.renderOrder + ', depthTest off)');
	// 33 G3 — the RENDER, not the hit test: from the spawn's eyes with the head LEVEL (how a player
	// stands; the 31 shots looked DOWN at the panel), the lit "2D board" cell's pixel is the
	// picker's amber, not core's panel backdrop. Both sit at core's overlay order on a K2 core, so
	// three draws the nearer ORIGIN last — the picker lost that tie on a Quest (vrmenu SORT_LEAD).
	const looks = await A.page.evaluate(({ eye }) => {
		const s = window.__stores;
		const THREE = s.THREE;
		let renderer, scene;
		s.globalRenderer.subscribe((v) => (renderer = v))();
		s.globalScene.subscribe((v) => (scene = v))();
		const W = 640;
		const H = 360;
		const out = {};
		for (const [name, pitch] of [['level', 0], ['down10', -10], ['down25', -25]]) {
			const cam = new THREE.PerspectiveCamera(70, W / H, 0.05, 200);
			cam.position.set(...eye);
			cam.rotation.set((pitch * Math.PI) / 180, 0, 0, 'YXZ');
			cam.updateMatrixWorld(true);
			const at = new THREE.Vector3(...window.__untangle.vrMenuCell('mode:2d')).project(cam);
			const x = Math.round(((at.x + 1) / 2) * W);
			const y = Math.round(((at.y + 1) / 2) * H); // GL rows run bottom-up
			const rt = new THREE.WebGLRenderTarget(W, H);
			const xr = renderer.xr.enabled;
			renderer.xr.enabled = false;
			renderer.setRenderTarget(rt);
			renderer.render(scene, cam);
			const px = new Uint8Array(4);
			renderer.readRenderTargetPixels(rt, x, y, 1, 1, px);
			renderer.setRenderTarget(null);
			renderer.xr.enabled = xr;
			rt.dispose();
			out[name] = { px: Array.from(px), x, y };
		}
		return out;
	}, { eye: EYE });
	// the render target is LINEAR: the picker's amber (#fbbf24) reads ~(245, 133, 4); core's backdrop ~(3, 2, 3)
	const amber = (p) => p[0] > 120 && p[1] > 55 && p[2] < 60 && p[0] > p[1] * 1.4;
	console.log('  picker pixels: ' + JSON.stringify(looks));
	check(m1.cells['mode:2d'].state === 'on', 'L.5a (premise) "2D board" is the lit (amber) cell');
	check(amber(looks.level.px), 'L.5b the head LEVEL (as a player stands): the picker is SEEN over core\'s panel — its amber cell, not the panel backdrop (' + looks.level.px + ')');
	check(amber(looks.down10.px) && amber(looks.down25.px), 'L.5c ...and looking down 10 / 25 degrees (' + looks.down10.px + ' / ' + looks.down25.px + ')');
	await eyeShot(A.page, 'vr-menu-panel', EYE, [0, EYE[1] - 0.25, 0]);
	await eyeShot(A.page, 'vr-menu-panel-level', EYE, [0, EYE[1], EYE[2] - 2]);
	const at3d = await A.page.evaluate(() => window.__untangle.vrMenuCell('mode:3d'));
	await setHands(A.page, { right: await aimPose(A.page, HAND, at3d, false) });
	await eventually(() => menuOf(A.page), (m) => m.hover === 'mode:3d', 'L.6 the laser on "3D globe" lights it (hover)', 3000);
	const lvl0 = (await state(A.page)).level;
	await press(A.page, HAND, at3d);
	await eventually(() => state(A.page), (s) => s.mode === '3d' && s.level === lvl0, 'L.7 a trigger press on "3D globe" switches to the GLOBE on the same level (' + lvl0 + ')', 4000);
	await eventually(() => state(B.page), (s) => s.mode === '3d' && s.level === lvl0, 'L.8 B switches too (the replicated restart path)', 8000);
	check((await menuOf(A.page)).last === 'mode:3d', 'L.9 the press went to the picker (last press mode:3d)');
	await panelFrame(A.page, EYE);
	await A.page.waitForTimeout(120);
	const lock = await A.page.evaluate(() => window.__untangle.vrMenuCell('level:2'));
	check((await menuOf(A.page)).cells['level:2'].state === 'locked', 'L.10 (premise) a new player: level 2 is locked');
	await press(A.page, HAND, lock);
	check((await state(A.page)).level === lvl0, 'L.11 a press on the locked level 2 does nothing');
	// solve the globe: the template's graph shows the solved card — not the menu
	check(await A.page.evaluate(() => window.__untangle.solve()), 'L.12 A solves the level (banks it: level 2 opens)');
	await eventually(() => gameNow(A.page), (g) => g === 'over', 'L.13 (premise) the template moves to the solved screen', 4000);
	const f2 = await panelFrame(A.page, EYE);
	await A.page.waitForTimeout(150);
	const m2 = await menuOf(A.page);
	check(f2.panel === 'solved' && m2.at === 'none' && !m2.visible, 'L.14 core\'s panel shows the solved card: its shape is not the menu\'s, so no picker (' + f2.panel + ', ' + m2.at + ')');
	await setGame(A.page, 'menu');
	await panelFrame(A.page, EYE);
	await eventually(() => menuOf(A.page), (m) => m.at === 'panel' && m.cells['level:2'].enabled, 'L.15 back on the menu: the picker returns with level 2 OPEN', 3000);
	await press(A.page, HAND, await A.page.evaluate(() => window.__untangle.vrMenuCell('level:2')));
	await eventually(() => state(A.page), (s) => s.level === 2 && s.mode === '3d', 'L.16 a press on level 2 loads globe level 2', 4000);
	await eventually(() => state(B.page), (s) => s.level === 2 && s.mode === '3d', 'L.17 on B too', 8000);
	await press(A.page, HAND, await A.page.evaluate(() => window.__untangle.vrMenuCell('mode:2d')));
	await eventually(() => state(A.page), (s) => s.level === 2 && s.mode === '2d', 'L.18 "2D board" switches back on the same level 2', 4000);
	await panelFrame(A.page, EYE);
	await A.page.waitForTimeout(100);
	await press(A.page, HAND, await A.page.evaluate(() => window.__untangle.vrMenuCell('continue')));
	await eventually(() => gameNow(A.page), (g) => g === 'playing', 'L.19 Continue starts the round (the template: Untangle Event start -> playing)', 4000);
	const f3 = await panelFrame(A.page, EYE);
	await A.page.waitForTimeout(150);
	check(f3.panel === null && (await menuOf(A.page)).at === 'none', 'L.20 mid-round core\'s panel is down and the picker with it');

	// ---- B. the picker on the board, from the VR bar -------------------------------------------
	const barCell = (k) => A.page.evaluate((k) => window.__untangle.vrBarCell(k), k);
	const bar = () => A.page.evaluate(() => window.__untangle.vrBar());
	const b0 = await bar();
	check(b0.visible && b0.cells[5].id === 'levels' && b0.cells[5].label === 'Levels', 'B.0 (premise) the VR bar shows, with a "Levels" cell');
	await press(A.page, HAND, await barCell(5));
	await eventually(() => menuOf(A.page), (m) => m.at === 'board' && m.open && m.visible, 'B.1 the bar\'s Levels opens the picker ON the board', 3000);
	const mb = await menuOf(A.page);
	check(mb.cells.close?.enabled === true && (await bar()).cells[5].label === 'Close', 'B.2 the on-board picker has Close, and the bar cell now says Close');
	const cen = await state(A.page);
	const bc = await A.page.evaluate(() => window.__untangle.centre());
	const dz = mb.centre[2] - bc[2];
	check(dz > 0 && dz < 0.2 && Math.abs(mb.centre[0] - bc[0]) < 1e-6, 'B.3 centred on the board, just in front of it (' + dz.toFixed(3) + ' m), drawn over it');
	await eyeShot(A.page, 'vr-menu-board', EYE, [0, 1.3, 0]);
	const l1 = await A.page.evaluate(() => window.__untangle.vrMenuCell('level:1'));
	await setHands(A.page, { right: await aimPose(A.page, HAND, l1, false) });
	await eventually(() => menuOf(A.page), (m) => m.hover === 'level:1', 'B.4 the laser lights level 1', 3000);
	check((await A.page.evaluate(() => window.__untangle.vr().candidate)) === null, 'B.5 ...and no dot behind the picker is offered to the trigger');
	await press(A.page, HAND, l1);
	await eventually(() => state(A.page), (s) => s.level === 1 && s.mode === '2d', 'B.6 a press loads level 1', 4000);
	check(!(await menuOf(A.page)).open, 'B.7 ...and closes the picker');
	await press(A.page, HAND, await barCell(5));
	await eventually(() => menuOf(A.page), (m) => m.open, 'B.8 (premise) opened again');
	await press(A.page, HAND, await A.page.evaluate(() => window.__untangle.vrMenuCell('close')));
	await eventually(() => menuOf(A.page), (m) => !m.open && !m.visible, 'B.9 Close closes it', 3000);
	void cen;

	// ---- U4. the bar: in front, facing you, over the scene ----------------------------------------
	for (const md of ['2d', '3d']) {
		if ((await state(A.page)).mode !== md) {
			await A.page.evaluate((md) => window.__untangle.select(1, md), md);
			await eventually(() => state(A.page), (s) => s.mode === md, 'U4.' + md + '.0 (premise) on the ' + md + ' board');
			await A.page.waitForTimeout(150);
		}
		const bp = await A.page.evaluate(() => window.__untangle.vrBarPose());
		const toEye = EYE.map((v, i) => v - bp.centre[i]);
		const len = Math.hypot(...toEye);
		const facing = bp.normal.reduce((a, v, i) => a + v * toEye[i], 0) / len;
		check(bp.centre[1] > 0.6 && bp.centre[1] < 1.1 && bp.centre[2] > 0.3, 'U4.' + md + '.1 the bar stands at waist height in front of the board (' + bp.centre.map((v) => v.toFixed(2)) + ')');
		check(facing > 0.85, 'U4.' + md + '.2 ...its face turned up toward the spawn\'s eyes (cos ' + facing.toFixed(2) + ')');
		// on a K2 core (api.vrPanel) core's overlay pass owns the order (its PANEL_ORDER, after a depth
		// clear); before it, the bar's own depthTest-off + an order under core's panels (1000)
		check(bp.depthTest === false && (bp.coreOverlay ? bp.renderOrder >= 1000 : bp.renderOrder > 0 && bp.renderOrder < 1000), 'U4.' + md + '.3 ...drawn over the scene (depthTest off; renderOrder ' + bp.renderOrder + (bp.coreOverlay ? ', core\'s overlay panel' : ', under core\'s panels') + ')');
		const blocked = await A.page.evaluate(({ eye, at }) => {
			const THREE = window.__stores.THREE;
			let root;
			window.__stores.objectsGroup.subscribe((v) => (root = v))();
			const from = new THREE.Vector3(...eye);
			const dir = new THREE.Vector3(...at).sub(from);
			const far = dir.length();
			const ray = new THREE.Raycaster(from, dir.normalize(), 0, far - 0.02);
			return ray.intersectObject(root, true).filter((h) => h.object.isMesh && h.object.visible).map((h) => h.object.name || h.object.parent?.name);
		}, { eye: EYE, at: bp.centre });
		check(blocked.length === 0, 'U4.' + md + '.4 no room object lies between the spawn\'s eyes and the bar (' + JSON.stringify(blocked) + ')');
	}
	await eyeShot(A.page, 'vr-bar-globe', EYE, [0, 1.0, 0]);
	// the render probe: a red box between the eye and the bar
	const probe = await A.page.evaluate(async ({ eye }) => {
		const s = window.__stores;
		const THREE = s.THREE;
		let renderer, scene;
		s.globalRenderer.subscribe((v) => (renderer = v))();
		s.globalScene.subscribe((v) => (scene = v))();
		const bp = window.__untangle.vrBarPose();
		const at = new THREE.Vector3(...bp.centre);
		const from = new THREE.Vector3(...eye);
		const cam = new THREE.PerspectiveCamera(8, 1, 0.05, 50);
		cam.position.copy(from);
		cam.lookAt(at);
		cam.updateMatrixWorld(true);
		const box = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 0.05), new THREE.MeshBasicMaterial({ color: 0xff0000 }));
		box.position.copy(from.clone().lerp(at, 0.5));
		box.lookAt(from);
		box.name = 'probe-box';
		const rt = new THREE.WebGLRenderTarget(32, 32);
		const px = new Uint8Array(4);
		const read = () => {
			renderer.setRenderTarget(rt);
			renderer.render(scene, cam);
			renderer.readRenderTargetPixels(rt, 16, 16, 1, 1, px);
			renderer.setRenderTarget(null);
			return Array.from(px);
		};
		const xr = renderer.xr.enabled;
		renderer.xr.enabled = false;
		const clear = read();
		scene.add(box);
		const boxed = read();
		// the counterfactual in place: the depth test back on -> the box hides the bar
		let bar;
		scene.traverse((o) => { if (o.name === 'untangle-vrbar') bar = o; });
		bar.material.depthTest = true;
		const depthOn = read();
		bar.material.depthTest = false;
		scene.remove(box);
		renderer.xr.enabled = xr;
		rt.dispose();
		return { clear, boxed, depthOn };
	}, { eye: EYE });
	const red = (p) => p[0] > 180 && p[1] < 60 && p[2] < 60;
	console.log('  probe pixels: clear ' + probe.clear + ' · box ' + probe.boxed + ' · depth test on ' + probe.depthOn);
	check(red(probe.depthOn), 'U4.5 (premise) with the depth test ON the red box in front hides the bar (' + probe.depthOn + ')');
	check(!red(probe.boxed) && Math.abs(probe.boxed[0] - probe.clear[0]) < 40 && Math.abs(probe.boxed[2] - probe.clear[2]) < 40, 'U4.6 the shipped bar draws OVER the box: the pixel is the bar\'s, not red (' + probe.boxed + ' vs ' + probe.clear + ')');

	// a raycast WITHOUT a camera over the whole board (what core's VR frame does to module content)
	// never throws — a THREE.Sprite throws there, which aborted core's controller update (U1)
	const thrown = await A.page.evaluate(() => {
		const THREE = window.__stores.THREE;
		let sc;
		window.__stores.globalScene.subscribe((v) => (sc = v))();
		const g = sc.getObjectByName('untangle-module');
		const errs = [];
		for (const y of [0.6, 1.0, 1.4, 1.8, 2.2, 2.6]) {
			try {
				new THREE.Raycaster(new THREE.Vector3(0, y, 2), new THREE.Vector3(0, 0, -1)).intersectObject(g, true);
			} catch (e) {
				errs.push(y + ': ' + String(e).slice(0, 80));
			}
		}
		return { errs, sprite: !!g.getObjectByName('untangle-hud') };
	});
	check(thrown.sprite && thrown.errs.length === 0, 'U4.7 a camera-less raycast across the board (its VR sprite HUD up) never throws (' + JSON.stringify(thrown.errs) + ')');

	// ---- U1. the world scaled: the dots still land where the tip is --------------------------------
	await A.page.evaluate(() => window.__untangle.select(12, '2d'));
	await eventually(() => state(A.page), (s) => s.level === 12 && s.mode === '2d', 'U1.0 (premise) 2D level 12');
	if (k1) {
		console.log('  K1: the real two-grip world grab in Interact');
		// OWED to the union run: grips through fakeXR (see the header) — the union core runs it below
	}
	const w = await A.page.evaluate(() => {
		let rig;
		window.__stores.worldRig.subscribe((v) => (rig = v))();
		rig.position.set(0.3, 0, 0.2);
		rig.rotation.set(0, -0.35, 0);
		rig.scale.setScalar(1.5);
		rig.updateMatrixWorld(true);
		const g = (() => { let sc; window.__stores.globalScene.subscribe((v) => (sc = v))(); return sc.getObjectByName('untangle-module'); })();
		let inRig = false;
		for (let p = g; p; p = p.parent) if (p === rig) inRig = true;
		return { inRig, scale: g.getWorldScale(new window.__stores.THREE.Vector3()).x };
	});
	check(w.inRig && Math.abs(w.scale - 1.5) < 1e-6, 'U1.1 the board rides the world rig (turned, moved, 1.5x: world scale ' + w.scale.toFixed(3) + ')');
	await A.page.waitForTimeout(200);
	const tipDrag = await A.page.evaluate(async () => {
		const THREE = window.__stores.THREE;
		const U = window.__untangle;
		const c = new THREE.Vector3(...U.boardWorld([0, 0]));
		const n = new THREE.Vector3(...U.boardWorld([1, 0])).sub(c).cross(new THREE.Vector3(...U.boardWorld([0, 1])).sub(c)).normalize();
		const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, -1), n.clone().negate()).toArray();
		// the tip sphere's centre is 2 cm ahead of the controller along its -Z (vrdrag TIP_AHEAD)
		const handFor = (tip) => new THREE.Vector3(...tip).addScaledVector(n, 0.02).toArray();
		const dot = U.dotWorld(3);
		const wait = (ms) => new Promise((r) => setTimeout(r, ms));
		U.vrSim({ right: { position: handFor(dot), quaternion: q, trigger: false }, left: null });
		await wait(120);
		U.vrSim({ right: { position: handFor(dot), quaternion: q, trigger: true }, left: null });
		await wait(120);
		const carried = U.state().carried;
		const goal = new THREE.Vector3(...U.boardWorld([0.45, -0.3]));
		for (let k = 1; k <= 12; k++) {
			const p = new THREE.Vector3(...dot).lerp(goal, k / 12).toArray();
			U.vrSim({ right: { position: handFor(p), quaternion: q, trigger: true }, left: null });
			await wait(30);
		}
		U.vrSim({ right: { position: handFor(goal.toArray()), quaternion: q, trigger: false }, left: null });
		await wait(200);
		const landed = new THREE.Vector3(...U.boardWorld(U.state().positions[3]));
		return { carried, err: landed.distanceTo(goal), pos: U.state().positions[3] };
	});
	check(tipDrag.carried === 3, 'U1.2 a controller TIP on dot 3 of the scaled board grabs it');
	check(tipDrag.err < 0.01, 'U1.3 carried and released, the dot lands exactly under the tip (' + (tipDrag.err * 1000).toFixed(1) + ' mm off; board point ' + tipDrag.pos.map((v) => v.toFixed(3)) + ')');
	await eventually(() => B.page.evaluate(() => window.__untangle.state().positions[3]), (p) => Math.abs(p[0] - tipDrag.pos[0]) < 1e-9 && Math.abs(p[1] - tipDrag.pos[1]) < 1e-9, 'U1.4 B lands on the identical board point (the rig is LOCAL, the move is board units)');
	await A.page.evaluate(() => {
		let rig;
		window.__stores.worldRig.subscribe((v) => (rig = v))();
		rig.position.set(0, 0, 0);
		rig.rotation.set(0, 0, 0);
		rig.scale.setScalar(1);
		rig.updateMatrixWorld(true);
	});
	await setHands(A.page, { right: await aimPose(A.page, HAND, AWAY, false), left: await aimPose(A.page, AWAY, [0, 7, 7], false) });

	// ---- K. contract K3: the game shell's Levels + Board setting ------------------------------------
	const sh = await A.page.evaluate(() => window.__untangle.shell());
	console.log('  contract K3 (api.game.levels / addSetting) in this core: ' + sh.hasLevels + ' / ' + sh.hasSetting);
	if (sh.hasLevels) check(sh.levels >= 1 && !sh.error, 'K.1 the module handed the shell its 30 levels (' + sh.levels + ' call(s))');
	else console.log('SKIP K.1: this core has no api.game.levels (31-game-shell) — the picker above is the VR path');
	if (sh.hasSetting) check(sh.setting && !sh.error, 'K.2 the module added the "Board: Globe / 2D" setting');
	else console.log('SKIP K.2: this core has no api.game.addSetting');

	// ---- R. 33 G2: the right stick pushes / pulls the board while the laser is on it -------------
	// "I can make bigger/smaller the globe but cannot use up/down on stick to move it further/closer
	// ... just as in edit mode for objects" — Edit's reel (grabStickAdjust) on the board, LOCAL
	{
		const reelOf = () => A.page.evaluate(() => window.__untangle.reel());
		const stickR = (x, y) => A.page.evaluate(({ x, y }) => window.__stores.inputRuntime.setVRAxes('right', x, y), { x, y });
		const claims = () => A.page.evaluate(() => { let v; window.__stores.inputRuntime.inputClaims.subscribe((x) => (v = x))(); return [...v]; });
		const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
		const along = (a, b, from, to) => {
			const d = b.map((v, i) => v - a[i]);
			const r = to.map((v, i) => v - from[i]);
			return d.reduce((acc, v, i) => acc + v * r[i], 0) / (Math.hypot(...d) * Math.hypot(...r) || 1);
		};
		if ((await state(A.page)).mode !== '2d') {
			await A.page.evaluate(() => window.__untangle.select(12, '2d'));
			await eventually(() => state(A.page), (s) => s.mode === '2d', 'R.0a (premise) the flat board');
		}
		const sticks = (await reelOf()).sticks;
		console.log('  the "sticks" input scope in this core: ' + sticks);
		const bc0 = B ? await B.page.evaluate(() => window.__untangle.centre()) : null;
		for (const md of ['2d', '3d']) {
			if (md === '3d') {
				await A.page.evaluate(() => window.__untangle.select(12, '3d'));
				await eventually(() => state(A.page), (s) => s.mode === '3d', 'R.3d.0a (premise) the globe');
				await A.page.waitForTimeout(150);
			}
			const c0 = await A.page.evaluate(() => window.__untangle.centre());
			await setHands(A.page, { right: await aimPose(A.page, HAND, c0, false) });
			await A.page.waitForTimeout(150);
			check((await reelOf()).pointing, 'R.' + md + '.0 (premise) the right laser is on the ' + (md === '3d' ? 'globe' : 'board'));
			await stickR(0, -1);
			await A.page.waitForTimeout(450);
			const held = await claims();
			await stickR(0, 0);
			await A.page.waitForTimeout(150);
			const c1 = await A.page.evaluate(() => window.__untangle.centre());
			check(dist(HAND, c1) > dist(HAND, c0) + 0.3, 'R.' + md + '.1 stick FORWARD pushes it away (' + dist(HAND, c0).toFixed(2) + ' -> ' + dist(HAND, c1).toFixed(2) + ' m from the hand)');
			check(along(c0, c1, HAND, c0) > 0.99, 'R.' + md + '.2 ...straight along the laser (cos ' + along(c0, c1, HAND, c0).toFixed(4) + ')');
			if (sticks) check(held.includes('sticks'), 'R.' + md + '.3 while the stick is deflected at the board it is the board\'s: both sticks claimed, no snap turn (' + held + ')');
			else console.log('SKIP R.' + md + '.3: this core has no "sticks" scope (1.19) — the right stick\'s Y is free in Untangle anyway');
			check(!(await claims()).includes('sticks'), 'R.' + md + '.4 back at rest the stick is the player\'s again (' + (await claims()) + ')');
			await setHands(A.page, { right: await aimPose(A.page, HAND, c1, false) });
			await stickR(0, 1);
			await A.page.waitForTimeout(450);
			await stickR(0, 0);
			await A.page.waitForTimeout(150);
			const c2 = await A.page.evaluate(() => window.__untangle.centre());
			check(dist(HAND, c2) < dist(HAND, c1) - 0.3, 'R.' + md + '.5 stick BACK pulls it closer (' + dist(HAND, c1).toFixed(2) + ' -> ' + dist(HAND, c2).toFixed(2) + ' m)');
			if (md === '3d') {
				const t0 = (await reelOf()).turns;
				await setHands(A.page, { right: await aimPose(A.page, HAND, c2, false) });
				await stickR(1, 0);
				await A.page.waitForTimeout(300);
				const heldX = await claims();
				await stickR(0, 0);
				await A.page.waitForTimeout(150);
				const r = await reelOf();
				check(r.turns > t0 && (!sticks || heldX.includes('sticks')), 'R.3d.6 left/right turns the globe' + (sticks ? ' — and no longer ALSO snap-turns the player (sticks claimed)' : '') + ' (' + (r.turns - t0) + ' frames)');
			}
		}
		if (bc0) {
			const bc1 = await B.page.evaluate(() => window.__untangle.centre());
			check(dist(bc0, bc1) < 1e-6, 'R.7 the push is LOCAL: B\'s board never moved');
		}
		// back to the authored pose (a mode change drops the local hold) for the spawn checks below
		await A.page.evaluate(() => window.__untangle.select(1, '2d'));
		await eventually(() => A.page.evaluate(() => window.__untangle.reel()), (r) => r.offset.every((v) => v === 0), 'R.8 a mode switch puts the board back where it was authored');
		await setHands(A.page, { right: await aimPose(A.page, HAND, AWAY, false) });
	}

	// ---- U2. the spawn, through the real per-frame XR path --------------------------------------
	if (!fs.existsSync(FAKE_XR)) {
		console.log('SKIP U2: no ' + FAKE_XR + ' (set CORE_DIR to a core checkout)');
	} else {
		const xr = require(FAKE_XR);
		const { aheadOf } = await import(path.join(__dirname, '..', 'modules', 'untangle', 'src', 'stance.js'));
		await A.page.evaluate(() => window.__untangle.vrSim(null));
		await A.page.evaluate(() => window.__stores.objectActions.setEditorMode('edit'));
		await xr.install(A.page);
		// standing at the ORIGIN — the middle of the old board, where the user found themself
		await xr.installSpace(A.page, { head: [0, 1.6, 0], yaw: 0.8 });
		await A.page.evaluate(() => window.__stores.vrControls.onVRSessionStart());
		await A.page.waitForTimeout(300);
		for (const md of ['2d', '3d']) {
			if (md === '3d') {
				await A.page.evaluate(() => window.__untangle.select(1, '3d'));
				await eventually(() => state(A.page), (s) => s.mode === '3d', 'U2.3d.0 (premise) the globe');
				await A.page.evaluate(() => window.__stores.vrControls.spawnPlayer());
				await A.page.waitForTimeout(200);
			}
			const head = await xr.head(A.page);
			const centre = await A.page.evaluate(() => window.__untangle.centre());
			const a = aheadOf(head, centre, { maxDeg: 15, minDist: 1.2, maxDist: 1.5, minDy: -0.6, maxDy: 0.05 });
			check(a.ok, 'U2.' + md + ' entering VR (from inside the dots) the ' + (md === '3d' ? 'globe' : 'board') + ' is IN FRONT: ' + a.dist.toFixed(2) + ' m ahead, ' + a.deg.toFixed(1) + ' deg off the facing, ' + a.dy.toFixed(2) + ' m below the eyes (head ' + [head.x, head.y, head.z].map((v) => v.toFixed(2)) + ', yaw ' + head.yaw.toFixed(2) + ')');
		}
		check((await A.page.evaluate(() => { let v; window.__stores.editorMode.subscribe((x) => (v = x))(); return v; })) === 'interact', 'U2.1 a game session lands in Interact');
		// U1 for real (contract K1): in Interact, two grips that start on no grabbable body scale the
		// WORLD — the board rides it — and the trigger still drags a dot afterwards
		if (k1) {
			const rigNow = () => A.page.evaluate(() => { let r; window.__stores.worldRig.subscribe((v) => (r = v))(); return r.scale.x; });
			const g0 = await rigNow();
			await xr.pose(A.page, 'left', [-0.15, 1.3, 1.05]);
			await xr.pose(A.page, 'right', [0.15, 1.3, 1.05]);
			await A.page.waitForTimeout(200);
			await xr.button(A.page, 'left', 1, true);
			await A.page.waitForTimeout(250);
			await xr.button(A.page, 'right', 1, true);
			await A.page.waitForTimeout(250);
			for (let k = 1; k <= 6; k++) {
				await xr.pose(A.page, 'left', [-0.15 - k * 0.04, 1.3, 1.05]);
				await xr.pose(A.page, 'right', [0.15 + k * 0.04, 1.3, 1.05]);
				await A.page.waitForTimeout(60);
			}
			await A.page.waitForTimeout(250);
			const g1 = await rigNow();
			const grips = await A.page.evaluate(() => ({ ...window.__stores.vrControls.vrGripDebug(), hold: window.__untangle.vr() }));
			await xr.button(A.page, 'left', 1, false);
			await xr.button(A.page, 'right', 1, false);
			await A.page.waitForTimeout(250);
			const ws = await A.page.evaluate(() => { let sc; window.__stores.globalScene.subscribe((v) => (sc = v))(); return sc.getObjectByName('untangle-module').getWorldScale(new window.__stores.THREE.Vector3()).x; });
			const mode = await A.page.evaluate(() => { let v; window.__stores.editorMode.subscribe((x) => (v = x))(); return v; });
			check(mode === 'interact' && g1 > g0 * 1.3, 'U1.5 (K1) in Interact, spreading two grips SCALES the world during the game (x' + g0.toFixed(2) + ' -> x' + g1.toFixed(2) + ')' + (g1 > g0 * 1.3 ? '' : ' ' + JSON.stringify(grips)));
			check(Math.abs(ws - g1) < 1e-6, 'U1.6 ...and the board scales with it (world scale ' + ws.toFixed(3) + ')');
			check((await state(A.page)).carried === -1, 'U1.7 ...the grips grabbed no dot');
		} else console.log('SKIP U1.5-U1.7: this core has no play.locomotion.worldGrab (contract K1, 31-vr-core P3)');

		// ---- S. 33 G3 — the headset's path to the levels: the controller's menu button (left X) opens
		// the game's pause menu; the laser presses Levels; the Board tabs sit above the grid; a tab
		// switches the board; a tile loads that level. The board is core's VR panel (drawn from a
		// synthetic head at the spawn's eyes, as core's suites do); the presses go through core's own
		// panel press path along a laser.
		await A.page.evaluate(() => window.__untangle.select(1, '2d'));
		await eventually(() => state(A.page), (s) => s.mode === '2d' && s.level === 1, 'S.0 (premise) 2D level 1');
		await A.page.evaluate(() => window.__stores.objectActions.setEditorMode('interact'));
		const hasTabs = await A.page.evaluate(() => typeof window.__stores.gameKit.gameShell.shellLevelTabs === 'function');
		console.log('  the shell\'s level tabs (onLevels) in this core: ' + hasTabs);
		const shellOpen = () => A.page.evaluate(() => { let v; window.__stores.gameKit.gameShell.shellMenu.subscribe((x) => (v = x))(); return v; });
		const boardIds = async () => {
			await panelFrame(A.page, EYE);
			return A.page.evaluate(() => window.__stores.gameKit.vrGamePanel.vrGamePanelDebug().hits['vr-game-panel'].map((x) => x.id));
		};
		const laser = (id) =>
			A.page.evaluate(({ id, hand }) => {
				const s = window.__stores;
				const k = s.gameKit.vrGamePanel;
				const surf = k.vrGameSurface('vr-game-panel');
				const rect = k.vrGamePanelDebug().hits['vr-game-panel'].find((x) => x.id === id);
				if (!rect) return { ok: false, why: 'no rect ' + id };
				const g = surf.mesh.geometry.parameters;
				const target = surf.mesh.localToWorld(new s.THREE.Vector3(((rect.x + rect.w / 2) / surf.canvas.width - 0.5) * g.width, (0.5 - (rect.y + rect.h / 2) / surf.canvas.height) * g.height, 0));
				const from = new s.THREE.Vector3(...hand);
				const t = k.panelTargetAlong(new s.THREE.Raycaster(from, target.clone().sub(from).normalize()));
				if (!t) return { ok: false, why: 'the laser missed' };
				return { ok: k.pressPanelTarget(t), hit: t.hit.id };
			}, { id, hand: HAND });
		await xr.button(A.page, 'left', 4, true);
		await A.page.waitForTimeout(250);
		await xr.button(A.page, 'left', 4, false);
		await A.page.waitForTimeout(150);
		check((await shellOpen()).open, 'S.1 the controller\'s menu button (left X) opens the pause menu, through the real per-frame path');
		let ids = await boardIds();
		check(ids.includes('shell:item:levels') && ids.includes('shell:item:settings'), 'S.2 the VR board offers Levels and Settings (' + ids.filter((i) => i.startsWith('shell:item')).join(', ') + ')');
		let p = await laser('shell:item:levels');
		ids = await boardIds();
		check(p.ok && (await shellOpen()).page === 'levels' && ids.includes('shell:level:1'), 'S.3 the laser opens Levels: the level tiles are on the board (' + JSON.stringify(p) + ')');
		const unlocked = await A.page.evaluate(() => window.__stores.gameKit.gameShell.gameShellDebug().levels.list.filter((l) => !l.locked).length);
		check(ids.filter((i) => i.startsWith('shell:level:')).length === unlocked, 'S.4 every open level is a tile (' + unlocked + ')');
		await eyeShot(A.page, 'vr-shell-levels', EYE, [0, EYE[1], EYE[2] - 2]);
		if (hasTabs) {
			check(ids.includes('shell:tab:0:0') && ids.includes('shell:tab:0:1'), 'S.5 the Board tabs (Globe / 2D board) sit above the grid (' + ids.filter((i) => i.startsWith('shell:tab')) + ')');
			p = await laser('shell:tab:0:0');
			await eventually(() => state(A.page), (s) => s.mode === '3d' && s.level === 1, 'S.6 the laser on the Globe tab switches the board to the globe, same level (' + JSON.stringify(p) + ')', 4000);
			check((await shellOpen()).page === 'levels', 'S.7 ...and the Levels page stays up (the tiles are now the globe\'s)');
		} else {
			console.log('SKIP S.5-S.7: this core has no level tabs (1.19) — the Board choice is the Settings row');
			await laser('shell:back');
			await boardIds();
			await laser('shell:item:settings');
			ids = await boardIds();
			check(ids.includes('shell:set:board:next'), 'S.5b the Settings page carries the Board row');
			await laser('shell:set:board:prev');
			await eventually(() => state(A.page), (s) => s.mode === '3d', 'S.6b ...and it switches the board to the globe', 4000);
			await laser('shell:back');
			await boardIds();
			await laser('shell:item:levels');
			await boardIds();
		}
		p = await laser('shell:level:1');
		await eventually(() => state(A.page), (s) => s.level === 1 && s.mode === '3d', 'S.8 a tile press loads that level on the globe (' + JSON.stringify(p) + ')', 4000);
		check(!(await shellOpen()).open, 'S.9 ...and closes the menu');
		await xr.uninstall(A.page);
	}

	await finish(browser);
});
