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
//   6 (P3) the GLOBE: a real press-drag-release carries a front dot across the sphere (a
//     raycast onto the globe) and B lands on the same unit vector; a dot behind the globe
//     cannot be picked through it; a right-drag turns A's view only (no dot moves, B's view
//     stays)
//   5 (P1) the look, measured: dots 3x the old 5.5 cm, every edge one instance of ONE
//     InstancedMesh coloured red/green by its own crossing count, the edge THICKNESS on
//     screen (a perpendicular pixel scan across a real edge), the hover ring under the
//     cursor, the carried dot's lift, the backplate, and the solve burst + green rim
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
const look = (page) => page.evaluate(() => window.__untangle.look());
/**
 * How many pixels THICK the edges are on screen: for every edge, scan the perpendicular
 * through its midpoint in ONE real screenshot and take the contiguous run of the edge's own
 * hue through it. Near-parallel neighbours merge runs, so the thinnest positive run (the
 * most isolated edge) is the thickness.
 * @param {{pu: any, pv: any, hue: string}[]} list
 */
async function edgeThickness(page, list) {
	const png = await page.screenshot();
	return page.evaluate(
		async ({ b64, list }) => {
			const blob = await (await fetch('data:image/png;base64,' + b64)).blob();
			const bmp = await createImageBitmap(blob);
			const c = document.createElement('canvas');
			c.width = bmp.width;
			c.height = bmp.height;
			const g = c.getContext('2d');
			g.drawImage(bmp, 0, 0);
			const data = g.getImageData(0, 0, c.width, c.height).data;
			const sx = bmp.width / window.innerWidth;
			const runs = list.map(({ pu: a, pv: b, hue }) => {
				const mx = ((a.x + b.x) / 2) * sx;
				const my = ((a.y + b.y) / 2) * sx;
				const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
				const nx = -(b.y - a.y) / len;
				const ny = (b.x - a.x) / len;
				const match = (t) => {
					const x = Math.round(mx + nx * t);
					const y = Math.round(my + ny * t);
					if (x < 0 || y < 0 || x >= c.width || y >= c.height) return false;
					const k = (y * c.width + x) * 4;
					const [r, gg, bb] = [data[k], data[k + 1], data[k + 2]];
					return hue === 'red' ? r > gg + 50 && r > bb + 30 : gg > r + 50 && gg > bb + 10;
				};
				let centre = null;
				for (const t of [0, 1, -1, 2, -2]) if (match(t)) { centre = t; break; }
				if (centre === null) return 0;
				let lo = centre;
				let hi = centre;
				while (lo > -40 && match(lo - 1)) lo--;
				while (hi < 40 && match(hi + 1)) hi++;
				return hi - lo + 1;
			});
			const positive = runs.filter((r) => r > 0);
			return { runs, thinnest: positive.length ? Math.min(...positive) : 0 };
		},
		{ b64: png.toString('base64'), list }
	);
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
	const l1 = await look(A.page);
	check(l1.dotRadius >= 3 * 0.055 - 1e-6, 'P1: on level 1 a dot is 3x the old 5.5 cm (radius ' + l1.dotRadius.toFixed(3) + ' m)');
	// a 9-dot board: random test drops cannot solve it by accident (a 5-dot level 1 can)
	await A.page.evaluate(() => window.__untangle.select(12));
	await eventually(() => state(B.page), (s) => s.level === 12 && s.positions.length === 9, 'B follows A to level 12 (the selector path replicates)');

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

	// ---- 5. (P1) the look, measured ------------------------------------------------------------------
	const L = await look(A.page);
	const S5 = await state(A.page);
	check(L.dotRadius >= 2 * 0.055 && L.dotRadius < 3 * 0.055, '5.1 on a 9-dot board the dots ease down but stay over 2x (radius ' + L.dotRadius.toFixed(3) + ' m)');
	check(L.plate, '5.2 the backplate stands behind the dots');
	const colorsRight = L.edgeColors.every((c, k) => c === (L.edgeCrossings[k] > 0 ? L.colors.RED : L.colors.GREEN));
	check(L.edgeInstances === S5.edges.length && colorsRight, '5.3 every edge is one instance of ONE InstancedMesh (' + L.edgeInstances + '/' + S5.edges.length + '), red where it crosses, green where clear');
	// every edge scanned across its midpoint; the thinnest clean run is the thickness
	const scans = [];
	for (const [k, [u, v]] of S5.edges.entries()) scans.push({ pu: await dotPx(A.page, u), pv: await dotPx(A.page, v), hue: L.edgeCrossings[k] > 0 ? 'red' : 'green' });
	const thick = await edgeThickness(A.page, scans);
	check(thick.thinnest >= 4 && thick.thinnest <= 40, '5.4 edges are THICK on screen: the thinnest clean run across an edge is ' + thick.thinnest + ' px (a THREE.Line is 1 px; runs ' + thick.runs.join(',') + ')');
	const d6 = await dotPx(A.page, 0);
	await A.page.mouse.move(d6.x, d6.y, { steps: 4 });
	await A.page.waitForTimeout(250);
	const hov = await look(A.page);
	check(hov.hovered === 0 && hov.hoverVisible, '5.5 the hover ring shows on the dot under the cursor (' + hov.hovered + ')');
	await A.page.mouse.down();
	await A.page.mouse.move(d6.x + 30, d6.y + 10, { steps: 3 });
	await A.page.waitForTimeout(350);
	const lifted = await look(A.page);
	check(lifted.carriedZ > 0.05 && lifted.carriedScale > 1.1 && !lifted.hoverVisible, '5.6 the carried dot LIFTS toward the player and grows (z ' + lifted.carriedZ.toFixed(3) + ', scale ' + lifted.carriedScale.toFixed(2) + '), the hover ring gives way');
	await A.page.mouse.up();
	await A.page.mouse.move(40, H / 2);
	await A.page.waitForTimeout(250);
	check(!(await look(A.page)).hoverVisible, '5.7 no hover ring with the cursor off every dot');
	const fired = (await look(A.page)).burstFired;
	await A.page.evaluate(() => window.__untangle.solve());
	await A.page.waitForTimeout(150);
	const burst = await look(A.page);
	check(burst.burstActive && burst.burstFired === fired + 1 && burst.rimWon, '5.8 a solve fires the burst and turns the rim green');
	await eventually(() => look(A.page), (l) => !l.burstActive, '5.9 the burst ends by itself', 4000);
	await eventually(() => state(A.page), (s) => s.level === 13 && s.crossings > 0, '5.10 (fallback autoAdvance) level 13 arrives tangled', 6000);
	await eventually(() => state(B.page), (s) => s.level === 13, '5.11 B advanced in lockstep', 6000);

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
	await A.page.waitForTimeout(600);

	// ---- 6. (P3) the GLOBE with a real mouse ----------------------------------------------------------
	await A.page.evaluate(() => window.__untangle.select(10, '3d'));
	await eventually(() => state(B.page), (s) => s.mode === '3d' && s.level === 10, '6.0 (premise) both peers on globe level 10');
	await A.page.evaluate(() => {
		let cam, controls;
		window.__stores.globalCamera.subscribe((v) => (cam = v))();
		window.__stores.orbitControls.subscribe((v) => (controls = v))();
		cam.position.set(0, 1.6, 3.4);
		controls.target.set(0, 1.6, 0);
		controls.update();
	});
	await A.page.waitForTimeout(400);
	// which dots face the camera, and which hide behind the globe (world z vs the centre)
	const faces = await A.page.evaluate(() => window.__untangle.state().positions.map((_, i) => window.__untangle.dotWorld(i)[2]));
	const front = faces.map((z, i) => [z, i]).sort((a, b) => b[0] - a[0]);
	const fi = front[0][1];
	const bi = front[front.length - 1][1];
	// the target: a front point of the globe, as a unit vector in the globe frame (the view is unturned)
	const T6 = [-0.3, 0.25, Math.sqrt(1 - 0.09 - 0.0625)];
	const t6world = await A.page.evaluate((t) => {
		let scene;
		window.__stores.globalScene.subscribe((v) => (scene = v))();
		const g = scene.getObjectByName('untangle-module');
		const r = window.__untangle.state().board.radius * 0.92;
		return g.localToWorld(new window.__stores.THREE.Vector3(t[0] * r, t[1] * r, t[2] * r)).toArray();
	}, T6);
	await drag(A.page, await dotPx(A.page, fi), await projectPoint(A.page, t6world));
	const g6 = await state(A.page);
	const ang = (p, q) => Math.acos(Math.min(1, p[0] * q[0] + p[1] * q[1] + p[2] * q[2]));
	check(g6.carried === -1 && g6.lastDrop === 'release' && ang(g6.positions[fi], T6) < 0.05, '6.1 a real press-drag-release moves a front dot across the globe to the target (off by ' + ang(g6.positions[fi], T6).toFixed(3) + ' rad)');
	check(Math.abs(Math.hypot(...g6.positions[fi]) - 1) < 2e-3, '6.2 the dropped dot is on the sphere (a unit vector)');
	await eventually(() => state(B.page), (s) => JSON.stringify(s.positions[fi]) === JSON.stringify(g6.positions[fi]), '6.3 B lands on the identical unit vector');
	// a dot on the FAR side is hidden by the globe: pressing its pixel does not pick it
	const bp = await dotPx(A.page, bi);
	await A.page.mouse.click(bp.x, bp.y);
	await A.page.waitForTimeout(150);
	const g7 = await state(A.page);
	check(g7.carried !== bi, '6.4 a dot behind the globe cannot be picked through it (carried ' + g7.carried + ', far dot ' + bi + ')');
	if (g7.carried !== -1) {
		await A.page.mouse.click(bp.x, bp.y); // drop whatever front dot the tap took
		await A.page.waitForTimeout(150);
	}
	// right-drag ON the globe turns A's view only
	const before6 = await state(A.page);
	const vb = await B.page.evaluate(() => window.__untangle.globeView());
	const pose6 = await cameraPose(A.page);
	const centre = await projectPoint(A.page, await A.page.evaluate(() => window.__untangle.boardWorld([0, 0, 0])));
	await A.page.mouse.move(centre.x + 40, centre.y + 30);
	await A.page.mouse.down({ button: 'right' });
	await A.page.mouse.move(centre.x + 160, centre.y + 10, { steps: 8 });
	await A.page.mouse.up({ button: 'right' });
	await A.page.waitForTimeout(300);
	const va = await A.page.evaluate(() => window.__untangle.globeView());
	const after6 = await state(A.page);
	check(va.rotations > 0 && after6.carried === -1, '6.5 a right-drag on the globe turns it (' + va.rotations + ' steps) and picks nothing');
	check(JSON.stringify(after6.positions) === JSON.stringify(before6.positions), '6.6 turning moved no dot (the view turns, the unit vectors stay)');
	check(JSON.stringify(await B.page.evaluate(() => window.__untangle.globeView())) === JSON.stringify(vb), '6.7 B\'s globe did not turn (the orientation is local)');
	check(JSON.stringify(await cameraPose(A.page)) === JSON.stringify(pose6), '6.8 the camera did not pan under the right-drag (the gesture belongs to the globe)');

	await finish(browser);
});
