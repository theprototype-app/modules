// _template test-flight — the toolchain check every other flight builds on:
// the packed zip installs through the REAL manager, the module's code actually
// runs, its primitive spawns a replicated object, and a click pulses it on a
// SECOND connected peer (apply-locally-and-send + receiver-applies).
const h = require('./helpers.cjs');

h.run(async () => {
	const browser = await h.launch();
	const A = await h.setupPage(browser, 'A');
	const B = await h.setupPage(browser, 'B');

	// --- install (both peers: modules do NOT travel over the wire) -------------
	await h.installModule(A, '_template', 'my-module');
	await h.installModule(B, '_template', 'my-module');

	h.check(
		await A.page.evaluate(() =>
			window.__stores.moduleSDK.loadedModules.some((m) => m.id === 'my-module' && m.version === '1.0.0')
		),
		'module registers with its manifest version'
	);

	// its menu button lands on the card and runs
	await h.openModules(A.page);
	await A.page.waitForTimeout(300);
	await A.page.locator('#user-module-card-my-module').getByRole('button', { name: 'Say hello' }).click();
	await h.eventually(() => h.toasts(A.page), (t) => t.includes('My Module is alive'), 'registerMenu action runs');
	await A.page.evaluate(() => window.__stores.modulesOpen.set(false));

	// --- the primitive is a normal replicated object ---------------------------
	await h.connect(A, B);
	await h.sceneCommand(A.page, '/create Mybeacon');
	await h.eventually(() => h.objectNames(B.page), (names) => names.includes('Mybeacon'), 'registerPrimitive object replicates to the peer');

	const uuid = await A.page.evaluate(
		() =>
			new Promise((r) =>
				window.__stores.objectsGroup.subscribe((g) =>
					r(g.children.find((c) => c.name === 'Mybeacon')?.uuid)
				)()
			)
	);

	// --- click -> pulse on BOTH peers -----------------------------------------
	// drive the app's own click dispatch with the exact mesh, the way the
	// viewport does (real pointer clicks need the object on screen; this flight
	// only cares that the handler + netcode agree).
	const pulsedOn = (page) =>
		page.evaluate(
			(uuid) =>
				new Promise((r) =>
					window.__stores.objectsGroup.subscribe((g) => {
						const o = g.getObjectByProperty('uuid', uuid);
						r(o ? o.scale.y : 0);
					})()
				),
			uuid
		);

	await A.page.evaluate(
		(uuid) =>
			new Promise((resolve) => {
				window.__stores.objectsGroup.subscribe((g) => {
					const object = g.getObjectByProperty('uuid', uuid);
					// moduleClickHandlers is exactly what the viewport calls on a hit
					window.__stores.moduleSDK.moduleClickHandlers.some((fn) => fn(object));
					resolve(true);
				})();
			}),
		uuid
	);

	await h.eventually(() => pulsedOn(A.page), (s) => s > 1.01, 'click pulses the beacon locally');
	await h.eventually(() => pulsedOn(B.page), (s) => s > 1.01, 'the pulse reaches the connected peer');

	// --- late joiner catches up through registerStateSync ----------------------
	const C = await h.setupPage(browser, 'C');
	await h.installModule(C, '_template', 'my-module');
	await h.connect(C, A);
	// scene sync for a late joiner is a GLTF transfer, not an instant read — poll
	// for it. (A single evaluate here passed on an idle machine and failed under
	// load, which is the definition of a flaky check.)
	await h.eventually(
		() => h.objectNames(C.page),
		(names) => names.includes('Mybeacon'),
		'a late joiner sees the beacon object',
		25000
	);

	await h.finish(browser);
});
