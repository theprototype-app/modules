// fps-player test-flight: install the real zip, place a capsule, enter walk mode
// with a REAL keypress, and drive it with real keys — forward moves along the
// facing, strafe moves sideways, sprint is faster than a walk, crouch squashes,
// a wall stops you, gravity puts you back on the floor, and Esc restores the
// editor's own input claims. Peer B watches the capsule walk.
const h = require('./helpers.cjs');

const bodyState = (page) =>
	page.evaluate(
		() =>
			new Promise((r) =>
				window.__stores.objectsGroup.subscribe((g) => {
					const body = g.children.find((c) => c.name === 'Fpsplayer');
					r(body ? { p: body.position.toArray(), s: body.scale.toArray(), uuid: body.uuid } : null);
				})()
			)
	);

const claims = (page) =>
	page.evaluate(
		() => new Promise((r) => window.__stores.inputRuntime.inputClaims.subscribe((c) => r([...c]))())
	);

const possessedUuid = (page) =>
	page.evaluate(() => new Promise((r) => window.__stores.possess.possessed.subscribe((v) => r(v))()));

/** hold a key for `ms` on the page, using real keyboard events */
async function hold(page, key, ms) {
	await page.keyboard.down(key);
	await page.waitForTimeout(ms);
	await page.keyboard.up(key);
	await page.waitForTimeout(150);
}

const dist = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);

h.run(async () => {
	const browser = await h.launch();
	const A = await h.setupPage(browser, 'A');
	const B = await h.setupPage(browser, 'B');

	await h.installModule(A, 'fps-player');
	await h.installModule(B, 'fps-player');
	await h.connect(A, B);

	// --- the capsule is a normal replicated object ----------------------------
	await h.sceneCommand(A.page, '/create Fpsplayer');
	await h.eventually(() => h.objectNames(B.page), (n) => n.includes('Fpsplayer'), 'the player capsule replicates');

	// --- enter walk mode with the key (not the card: modal-open suppresses input)
	await A.page.mouse.move(600, 400);
	await A.page.keyboard.press('KeyJ');
	await A.page.waitForTimeout(600);

	const uuid = (await bodyState(A.page)).uuid;
	h.check((await possessedUuid(A.page)) === uuid, 'walk mode possesses the capsule (lock + undo entry are core\'s)');
	const held = await claims(A.page);
	h.check(
		held.includes('keys') && held.includes('locomotion'),
		'it claims keys + locomotion so the editor stops flying the camera'
	);

	// --- forward ---------------------------------------------------------------
	const start = await bodyState(A.page);
	await hold(A.page, 'KeyW', 700);
	const walked = await bodyState(A.page);
	const walkDist = dist(start.p, walked.p);
	h.check(walkDist > 0.5, 'W walks the capsule (' + walkDist.toFixed(2) + 'm)');

	// --- sprint is faster than a walk ------------------------------------------
	const beforeSprint = await bodyState(A.page);
	await A.page.keyboard.down('Shift');
	await hold(A.page, 'KeyW', 700);
	await A.page.keyboard.up('Shift');
	const sprinted = await bodyState(A.page);
	const sprintDist = dist(beforeSprint.p, sprinted.p);
	h.check(
		sprintDist > walkDist * 1.25,
		'Shift sprints (' + sprintDist.toFixed(2) + 'm vs ' + walkDist.toFixed(2) + 'm)'
	);

	// --- strafe moves sideways, not along the facing ---------------------------
	const beforeStrafe = await bodyState(A.page);
	await hold(A.page, 'KeyD', 600);
	const strafed = await bodyState(A.page);
	h.check(dist(beforeStrafe.p, strafed.p) > 0.4, 'D strafes (possess alone only turns)');

	// --- crouch squashes and slows ---------------------------------------------
	await A.page.keyboard.down('KeyC');
	await A.page.waitForTimeout(300);
	const crouched = await bodyState(A.page);
	h.check(crouched.s[1] < 0.7, 'C crouches the capsule (scale.y=' + crouched.s[1].toFixed(2) + ')');
	await A.page.keyboard.up('KeyC');
	await A.page.waitForTimeout(300);
	h.check((await bodyState(A.page)).s[1] > 0.95, 'standing up restores its height');

	// --- jump leaves the floor and gravity brings it back ----------------------
	const floorY = (await bodyState(A.page)).p[1];
	await A.page.keyboard.down('Space');
	await A.page.waitForTimeout(180);
	const midAir = (await bodyState(A.page)).p[1];
	await A.page.keyboard.up('Space');
	h.check(midAir > floorY + 0.1, 'Space jumps (' + (midAir - floorY).toFixed(2) + 'm up)');
	// headless renders through SwiftShader at a handful of fps and the module caps
	// dt to avoid tunnelling, so a jump takes SECONDS of wall time here: poll for
	// the landing instead of guessing a duration
	await h.eventually(
		() => bodyState(A.page).then((b) => b.p[1]),
		(y) => Math.abs(y - floorY) < 0.05,
		'gravity puts it back on the floor',
		15000
	);

	// --- the peer saw the walk --------------------------------------------------
	const [here, there] = [await bodyState(A.page), await bodyState(B.page)];
	h.check(
		dist(here.p, there.p) < 0.6,
		'the peer sees the capsule where it walked to (drift=' + dist(here.p, there.p).toFixed(2) + 'm)'
	);

	// --- a wall stops you --------------------------------------------------------
	await h.sceneCommand(A.page, '/create Box 4 3 0.4');
	await A.page.evaluate(() => {
		let group;
		window.__stores.objectsGroup.subscribe((v) => (group = v))();
		const body = group.children.find((c) => c.name === 'Fpsplayer');
		const box = group.children.find((c) => c.name === 'Box');
		// park the wall one metre ahead of the capsule's facing
		box.position.set(body.position.x - Math.sin(body.rotation.y) * 0.6, body.position.y + 1, body.position.z - Math.cos(body.rotation.y) * 0.6);
		box.updateMatrix();
		window.__stores.objectsGroup.update((v) => v);
	});
	await A.page.waitForTimeout(300);
	const atWall = await bodyState(A.page);
	await hold(A.page, 'KeyW', 800);
	const pushed = await bodyState(A.page);
	h.check(
		dist(atWall.p, pushed.p) < 0.3,
		'a wall blocks the walk (' + dist(atWall.p, pushed.p).toFixed(2) + 'm vs ' + walkDist.toFixed(2) + 'm unobstructed)'
	);
	// ...and the module is not simply frozen: backing away from it still moves
	await hold(A.page, 'KeyS', 700);
	const backed = await bodyState(A.page);
	h.check(
		dist(pushed.p, backed.p) > 0.3,
		'backing away from the wall still walks (' + dist(pushed.p, backed.p).toFixed(2) + 'm)'
	);

	// --- leaving restores everything --------------------------------------------
	await A.page.keyboard.press('Escape');
	await A.page.waitForTimeout(600);
	h.check((await possessedUuid(A.page)) === null, 'Esc leaves walk mode');
	const after = await claims(A.page);
	h.check(
		!after.includes('keys') && !after.includes('locomotion'),
		'and gives the editor its input back'
	);

	await h.finish(browser);
});
