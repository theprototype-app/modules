// untangle-drag test-flight (roadmap 30, lane 30-untangle P0): the drag, driven by a REAL
// mouse. The `untangle` flight moves dots through `window.__untangle.move`; this one never
// does — every move here is a page.mouse press/move/release on a PROJECTED dot, on two
// peers, so the gesture, the pick, the carry, the drop and the replication are the subject.
//
//   1 press-drag-release: the dot follows while held (B sees the throttled previews), drops
//     where released, B lands on the identical position; the camera did NOT orbit under the
//     drag and nothing got selected (the press belongs to the board)
//   2 click-to-pick / click-to-drop: a tap carries, the dot follows the cursor, a second
//     click drops it there
//   3 a drop OFF the board: a release in the sky, and a carrying click in the sky, both drop
//     (clamped to the board edge) — "any click drops" no longer needs a board hit; a
//     carrying click on a UI element drops as well and the element still gets its click
//   4 play under a (stubbed) POINTER LOCK: the carry follows the CROSSHAIR, not the stale
//     mouse ray — press, re-aim the camera, the dot tracks it, release drops it
//
//   npm run pack -- untangle
//   APP_URL=https://theprototype.app:5234/ node tests/untangle-drag.test.cjs

const { launch, setupPage, installModule, connect, check, eventually, finish, run, projectPoint, GPU_ARGS } = require('./helpers.cjs');

const W = 1280;
const H = 720;

const state = (page) =>
	page.evaluate(() => {
		const s = window.__untangle?.state();
		if (!s) return null;
		return { ...s, positions: s.positions.map((p) => p.map((v) => Math.round(v * 1000) / 1000)) };
	});
const dotPx = async (page, i) => projectPoint(page, await page.evaluate((i) => window.__untangle.dotWorld(i), i));
const boardPx = async (page, p) => projectPoint(page, await page.evaluate((p) => window.__untangle.boardWorld(p), p));
const near = (a, b, tol = 0.04) => Math.abs(a[0] - b[0]) <= tol && Math.abs(a[1] - b[1]) <= tol;
const cameraPose = (page) =>
	page.evaluate(() => {
		let cam;
		window.__stores.globalCamera.subscribe((v) => (cam = v))();
		return [...cam.position.toArray(), ...cam.quaternion.toArray()].map((v) => Math.round(v * 1000) / 1000);
	});
/** a real drag: move to `from`, press, travel in steps, release at `to` */
async function drag(page, from, to, { steps = 12, release = true } = {}) {
	await page.mouse.move(from.x, from.y);
	await page.mouse.down();
	for (let k = 1; k <= steps; k++) {
		await page.mouse.move(from.x + ((to.x - from.x) * k) / steps, from.y + ((to.y - from.y) * k) / steps);
		await page.waitForTimeout(16);
	}
	await page.waitForTimeout(120); // a few frames at the release point
	if (release) await page.mouse.up();
}
/** point the (play) camera at a world point — what moving the mouse under a lock does */
const aimAt = (page, world) =>
	page.evaluate((w) => {
		let cam;
		window.__stores.globalCamera.subscribe((v) => (cam = v))();
		cam.lookAt(w[0], w[1], w[2]);
		cam.updateMatrixWorld(true);
	}, world);

run(async () => {
	const browser = await launch({ args: GPU_ARGS });
	const A = await setupPage(browser, 'A', { context: { viewport: { width: W, height: H } } });
	const B = await setupPage(browser, 'B');
	const renderer = await A.page.evaluate(() => {
		const gl = document.createElement('canvas').getContext('webgl2');
		const ext = gl?.getExtension('WEBGL_debug_renderer_info');
		return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown';
	});
	console.log('  renderer: ' + renderer);
	await installModule(A, 'untangle');
	await installModule(B, 'untangle');
	await connect(A, B);
	await eventually(() => state(A.page), (s) => !!s && s.built && s.positions.length > 0, 'A: the fallback board stands');
	await eventually(() => state(B.page), (s) => !!s && s.built && s.positions.length > 0, 'B: its own identical board');

	// frame the board head-on in the editor (the orbit target too, or update() reverts it)
	await A.page.evaluate(() => {
		let cam, controls;
		window.__stores.globalCamera.subscribe((v) => (cam = v))();
		window.__stores.orbitControls.subscribe((v) => (controls = v))();
		cam.position.set(0, 1.6, 3.2);
		controls.target.set(0, 1.6, 0);
		controls.update();
	});
	await A.page.waitForTimeout(400);
	const pose0 = await cameraPose(A.page);

	// ---- 1. press-drag-release -------------------------------------------------------------
	const s0 = await state(A.page);
	const T1 = [0.5, 0.45];
	await drag(A.page, await dotPx(A.page, 0), await boardPx(A.page, T1), { release: false });
	const held = await state(A.page);
	check(held.carried === 0 && held.carryMode === 'press', '1.1 pressing dot 0 picks it up and it is carried WHILE HELD (' + held.carried + ', ' + held.carryMode + ')');
	check(near(held.positions[0], T1), '1.2 the held dot follows the cursor to (' + T1 + ') before release (' + held.positions[0] + ')');
	await eventually(() => state(B.page), (s) => !near(s.positions[0], s0.positions[0], 0.01), '1.3 B sees the throttled drag PREVIEW before the drop');
	await A.page.mouse.up();
	const a1 = await state(A.page);
	check(a1.carried === -1 && a1.lastDrop === 'release', '1.4 release drops it (' + a1.lastDrop + ')');
	check(near(a1.positions[0], T1), '1.5 dot 0 dropped at (' + T1 + ') on A (' + a1.positions[0] + ')');
	await eventually(() => state(B.page), (s) => JSON.stringify(s.positions[0]) === JSON.stringify(a1.positions[0]), '1.6 B lands on the IDENTICAL final position (the authoritative move)');
	check(JSON.stringify(await cameraPose(A.page)) === JSON.stringify(pose0), '1.7 the camera did NOT orbit under the drag (the press belongs to the board)');
	const selected = await A.page.evaluate(() => {
		let v;
		window.__stores.selectedObject.subscribe((x) => (v = x))();
		return v?.name ?? null;
	});
	check(selected === null, '1.8 nothing got selected by the drag (' + selected + ')');

	// ---- 2. click to pick, click to drop -------------------------------------------------------
	const T2 = [-0.55, 0.3];
	const d1 = await dotPx(A.page, 1);
	await A.page.mouse.click(d1.x, d1.y);
	await A.page.waitForTimeout(150);
	const tapped = await state(A.page);
	check(tapped.carried === 1 && tapped.carryMode === 'click', '2.1 a TAP on dot 1 picks it up and keeps carrying after the release (' + tapped.carryMode + ')');
	const t2 = await boardPx(A.page, T2);
	for (let k = 1; k <= 10; k++) {
		await A.page.mouse.move(d1.x + ((t2.x - d1.x) * k) / 10, d1.y + ((t2.y - d1.y) * k) / 10);
		await A.page.waitForTimeout(16);
	}
	await A.page.waitForTimeout(120);
	check(near((await state(A.page)).positions[1], T2), '2.2 with no button held the carried dot follows the cursor');
	await A.page.mouse.click(t2.x, t2.y);
	const a2 = await state(A.page);
	check(a2.carried === -1 && a2.lastDrop === 'click' && near(a2.positions[1], T2), '2.3 the second click drops it at (' + T2 + ') (' + a2.positions[1] + ', ' + a2.lastDrop + ')');
	await eventually(() => state(B.page), (s) => JSON.stringify(s.positions[1]) === JSON.stringify(a2.positions[1]), '2.4 B lands on the identical position');

	// ---- 3. drops OFF the board -------------------------------------------------------------------
	const sky = await projectPoint(A.page, await A.page.evaluate(() => window.__untangle.boardWorld([2.2, 0.2])));
	await drag(A.page, await dotPx(A.page, 2), sky);
	const a3 = await state(A.page);
	check(a3.carried === -1 && a3.lastDrop === 'release' && a3.positions[2][0] === 1, '3.1 a release in the sky past the right edge drops dot 2, clamped to the edge x=1 (' + a3.positions[2] + ')');
	await eventually(() => state(B.page), (s) => JSON.stringify(s.positions[2]) === JSON.stringify(a3.positions[2]), '3.2 B agrees');
	const d3 = await dotPx(A.page, 3);
	await A.page.mouse.click(d3.x, d3.y);
	await A.page.waitForTimeout(120);
	check((await state(A.page)).carried === 3, '3.3 (premise) a tap carries dot 3');
	// a sky pixel left of the board that is really the CANVAS (not a toolbar over it)
	let skyLeft = null;
	for (const p of [[-1.9, -0.1], [-1.7, 0.4], [-1.8, -0.5], [-1.6, 0.8], [-2.2, 0.1]]) {
		const px = await projectPoint(A.page, await A.page.evaluate((p) => window.__untangle.boardWorld(p), p));
		const onCanvas = await A.page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.tagName === 'CANVAS', px);
		if (onCanvas) {
			skyLeft = px;
			break;
		}
	}
	check(!!skyLeft, '3.3b (premise) found a sky pixel left of the board that is the canvas itself');
	await A.page.mouse.move(skyLeft.x, skyLeft.y, { steps: 8 });
	await A.page.waitForTimeout(120);
	await A.page.mouse.click(skyLeft.x, skyLeft.y);
	const a3b = await state(A.page);
	check(a3b.carried === -1 && a3b.lastDrop === 'click' && a3b.positions[3][0] === -1, '3.4 a carrying click in the SKY (no board hit) drops it, clamped to x=-1 (' + a3b.positions[3] + ', ' + a3b.lastDrop + ')');
	await eventually(() => state(B.page), (s) => JSON.stringify(s.positions[3]) === JSON.stringify(a3b.positions[3]), '3.5 B agrees');
	// a carrying click on a UI element drops too, and the element still gets its click
	const d5 = await dotPx(A.page, 5);
	await A.page.mouse.click(d5.x, d5.y);
	await A.page.waitForTimeout(120);
	// a UI element over the viewport (a stand-in for any panel or HUD button)
	await A.page.evaluate(() => {
		const b = document.createElement('button');
		b.id = 'ut-test-ui';
		b.textContent = 'UI';
		b.style.cssText = 'position:fixed;left:50%;bottom:120px;width:90px;height:40px;z-index:99999';
		b.onclick = () => (b.dataset.clicked = '1');
		document.body.appendChild(b);
	});
	await A.page.locator('#ut-test-ui').click();
	const a3c = await state(A.page);
	const clicked = await A.page.evaluate(() => document.getElementById('ut-test-ui')?.dataset.clicked === '1');
	check(a3c.carried === -1 && a3c.lastDrop === 'ui' && clicked, '3.6 a carrying click on a UI element drops the dot AND the element still gets its click (' + a3c.lastDrop + ', clicked ' + clicked + ')');
	await A.page.evaluate(() => document.getElementById('ut-test-ui')?.remove());

	// ---- 4. play under a pointer lock: the carry follows the CROSSHAIR -------------------------
	await A.page.locator('#play-button').click();
	await eventually(
		() => A.page.evaluate(() => {
			let v;
			window.__stores.isLocked.subscribe((x) => (v = x))();
			return v;
		}),
		(v) => v === true,
		'4.0 (premise) A is in play'
	);
	// headless never holds a lock: stub it on the renderer's canvas (hud-play-keyboard's recipe)
	await A.page.evaluate(() => {
		const canvases = [...document.querySelectorAll('canvas')];
		const target = canvases.sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight)[0];
		Object.defineProperty(document, 'pointerLockElement', { configurable: true, get: () => target });
	});
	await A.page.waitForTimeout(300);
	// the mouse stays parked in a corner, so the api's (stale) mouse ray points at nothing
	await A.page.mouse.move(60, H - 60);
	const dot4 = await A.page.evaluate(() => window.__untangle.dotWorld(4));
	await aimAt(A.page, dot4);
	await A.page.waitForTimeout(150);
	await A.page.mouse.down();
	await A.page.waitForTimeout(150);
	const p4 = await state(A.page);
	check(p4.carried === 4, '4.1 under the lock a press picks the dot under the CROSSHAIR (dot 4; carried ' + p4.carried + ', ray ' + p4.rayMode + ')');
	const T4 = [-0.2, -0.6];
	await aimAt(A.page, await A.page.evaluate((p) => window.__untangle.boardWorld(p), T4));
	await A.page.waitForTimeout(300);
	const moving = await state(A.page);
	check(near(moving.positions[4], T4), '4.2 re-aiming the camera carries the dot with the crosshair to (' + T4 + ') (' + moving.positions[4] + ')');
	check(moving.rayMode === 'crosshair' || moving.rayMode === 'api', '4.3 the carry ray is the crosshair (' + moving.rayMode + ': "api" = core returns it, "crosshair" = built from the camera)');
	await A.page.waitForTimeout(450); // past HOLD_MS: a held press releases as a drop
	await A.page.mouse.up();
	const a4 = await state(A.page);
	check(a4.carried === -1 && near(a4.positions[4], T4), '4.4 the release drops it there (' + a4.lastDrop + ')');
	await eventually(() => state(B.page), (s) => JSON.stringify(s.positions[4]) === JSON.stringify(a4.positions[4]), '4.5 B agrees');
	await A.page.evaluate(() => Object.defineProperty(document, 'pointerLockElement', { configurable: true, get: () => null }));
	await A.page.keyboard.press('Escape');

	await finish(browser);
});
