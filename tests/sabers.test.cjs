// sabers test-flight: the blade follows a REAL mouse (which is what
// api.pointerRay() reads on desktop), lives at the LOCAL scene root, streams its
// pose to a connected peer as a ghost blade, and sparks on contact with a
// replicated object — with the peer seeing the sparks too.
const h = require('./helpers.cjs');

/** read the module's scene-root group on a page */
const saberGroup = (page) =>
	page.evaluate(
		() =>
			new Promise((r) =>
				window.__stores.globalScene.subscribe((scene) => {
					const group = scene.getObjectByName('sabers-module');
					if (!group) return r(null);
					const blades = group.children.filter((c) => c.name === 'saber-blade');
					r({
						blades: blades.length,
						visible: blades.filter((b) => b.visible).length,
						sparks: group.children.filter((c) => c.name === 'saber-spark').length,
						pose: blades[0]
							? {
									p: blades[0].position.toArray(),
									q: blades[0].quaternion.toArray()
								}
							: null
					});
				})()
			)
	);

/** where the editor camera is, and which way it looks */
const cameraPose = (page) =>
	page.evaluate(
		() =>
			new Promise((r) =>
				window.__stores.globalCamera.subscribe((cam) => {
					const dir = cam.getWorldDirection(new window.__stores.THREE.Vector3());
					r({ p: cam.position.toArray(), d: [dir.x, dir.y, dir.z] });
				})()
			)
	);

h.run(async () => {
	const browser = await h.launch();
	const A = await h.setupPage(browser, 'A');
	const B = await h.setupPage(browser, 'B');

	await h.installModule(A, 'sabers');
	await h.installModule(B, 'sabers');

	// no blade before it is drawn
	const idle = await saberGroup(A.page);
	h.check(!idle || idle.visible === 0, 'nothing is drawn until you ask for it');

	// --- draw it from the module card ---------------------------------------
	await h.openModules(A.page);
	await A.page.locator('#user-module-card-sabers').getByRole('button', { name: /Draw \/ sheathe/ }).click();
	await A.page.evaluate(() => window.__stores.modulesOpen.set(false));
	await A.page.waitForTimeout(400);

	// the pointer ray only exists once a pointer has moved
	await A.page.mouse.move(500, 400);
	await A.page.waitForTimeout(500);
	await h.eventually(() => saberGroup(A.page), (g) => g && g.visible === 1, 'drawing puts one blade in the scene');

	// --- it is LOCAL content: never in the replicated objects root -------------
	const names = await h.objectNames(A.page);
	h.check(
		!names.some((n) => (n ?? '').startsWith('saber')),
		'the blade stays out of the replicated scene (derived state is local)'
	);

	// --- it follows the pointer -----------------------------------------------
	const before = await saberGroup(A.page);
	await A.page.mouse.move(900, 250);
	await A.page.waitForTimeout(500);
	const after = await saberGroup(A.page);
	const turned = before.pose.q.reduce((sum, v, i) => sum + Math.abs(v - after.pose.q[i]), 0);
	h.check(turned > 0.02, 'the blade re-aims when the pointer moves (dq=' + turned.toFixed(3) + ')');

	// --- a connected peer sees a ghost blade at your pose ----------------------
	await h.connect(A, B);
	await A.page.mouse.move(700, 380);
	await A.page.waitForTimeout(1200);
	await h.eventually(
		() => saberGroup(B.page),
		(g) => g && g.visible === 1,
		'the peer renders a ghost blade for the holder'
	);
	const [mine, theirs] = [await saberGroup(A.page), await saberGroup(B.page)];
	const drift = mine.pose.p.reduce((sum, v, i) => sum + Math.abs(v - theirs.pose.p[i]), 0);
	h.check(drift < 0.05, 'the ghost sits where the real blade is (drift=' + drift.toFixed(4) + ')');

	// --- sparks on contact, locally and on the peer ----------------------------
	// put a box exactly in blade reach: hilt is 0.55m ahead of the camera and the
	// blade is 1.2m long, so 1.2m along the view direction is inside it.
	await h.sceneCommand(A.page, '/create Box 0.8 0.8 0.8');
	const cam = await cameraPose(A.page);
	// READ the ref first, THEN mutate: writing a store from inside its own
	// subscriber re-enters the flush and corrupts svelte's queues (the whole page
	// starts throwing "Invalid array length" from unrelated stores).
	await A.page.evaluate((target) => {
		let group;
		window.__stores.objectsGroup.subscribe((value) => (group = value))();
		const box = group.children.find((c) => c.name === 'Box');
		box.position.set(target[0], target[1], target[2]);
		box.updateMatrix();
		window.__stores.objectsGroup.update((v) => v);
	}, [cam.p[0] + cam.d[0] * 1.2, cam.p[1] + cam.d[1] * 1.2, cam.p[2] + cam.d[2] * 1.2]);
	// aim dead centre, where the box now is
	const size = A.page.viewportSize();
	await A.page.mouse.move(size.width / 2, size.height / 2);

	await h.eventually(() => saberGroup(A.page), (g) => g && g.sparks > 0, 'touching an object sparks', 8000);
	await h.eventually(() => saberGroup(B.page), (g) => g && g.sparks > 0, 'and the peer sees the hit', 8000);

	// --- sheathing hides it for everyone ---------------------------------------
	await h.openModules(A.page);
	await A.page.locator('#user-module-card-sabers').getByRole('button', { name: /Draw \/ sheathe/ }).click();
	await A.page.evaluate(() => window.__stores.modulesOpen.set(false));
	await h.eventually(() => saberGroup(A.page), (g) => g.visible === 0, 'sheathing hides your blade');
	await h.eventually(() => saberGroup(B.page), (g) => g.visible === 0, 'and the peer stops seeing it');

	await h.finish(browser);
});
