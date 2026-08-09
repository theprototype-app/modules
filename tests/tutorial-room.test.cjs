// tutorial-room test-flight: build the room from the real module card, prove it
// is LOCAL content that every peer rebuilds identically from one message, tick a
// station off and watch the peer's tick appear, catch a late joiner up through
// state sync, and remove it everywhere.
const h = require('./helpers.cjs');

/** what the module put at the local scene root, on this page */
const room = (page) =>
	page.evaluate(
		() =>
			new Promise((r) =>
				window.__stores.globalScene.subscribe((scene) => {
					const group = scene.getObjectByName('tutorial-room');
					if (!group) return r(null);
					const stands = group.children.filter((c) => c.name?.startsWith('tutorial-station-'));
					r({
						stands: stands.length,
						positions: stands.map((s) => s.position.toArray().map((v) => +v.toFixed(4))),
						ticks: stands
							.flatMap((s) => s.children)
							.filter((c) => c.name?.startsWith('tutorial-tick-') && c.visible)
							.map((c) => c.name)
					});
				})()
			)
	);

const clickPlinth = (page, id) =>
	page.evaluate(
		(id) =>
			new Promise((resolve) => {
				window.__stores.globalScene.subscribe((scene) => {
					const plinth = scene.getObjectByName('tutorial-plinth-' + id);
					if (!plinth) return resolve(false);
					resolve(window.__stores.moduleSDK.moduleClickHandlers.some((fn) => fn(plinth)));
				})();
			}),
		id
	);

h.run(async () => {
	const browser = await h.launch();
	const A = await h.setupPage(browser, 'A');
	const B = await h.setupPage(browser, 'B');

	await h.installModule(A, 'tutorial-room');
	await h.installModule(B, 'tutorial-room');
	await h.connect(A, B);

	h.check((await room(A.page)) === null, 'no room until it is built');

	// --- build it from the real card ------------------------------------------
	await h.openModules(A.page);
	await A.page.locator('#user-module-card-tutorial-room').getByRole('button', { name: 'Build the tutorial room' }).click();
	await A.page.evaluate(() => window.__stores.modulesOpen.set(false));

	await h.eventually(() => room(A.page), (r) => r && r.stands === 5, 'the room builds with five stations');
	await h.eventually(() => room(B.page), (r) => r && r.stands === 5, 'and the peer builds it too, from one message');

	// --- both peers built the SAME room ---------------------------------------
	const [here, there] = [await room(A.page), await room(B.page)];
	h.check(
		JSON.stringify(here.positions) === JSON.stringify(there.positions),
		'both peers placed the stations identically (determinism IS the netcode)'
	);

	// --- it is LOCAL content ---------------------------------------------------
	const names = await h.objectNames(A.page);
	h.check(
		!names.some((n) => (n ?? '').startsWith('tutorial-')),
		'the room stays out of the replicated scene (nothing to sync, save or export)'
	);

	// --- tick a station off ----------------------------------------------------
	h.check(here.ticks.length === 0, 'no station is ticked to begin with');
	await clickPlinth(A.page, 'flow');
	await h.eventually(
		() => room(A.page),
		(r) => r.ticks.includes('tutorial-tick-flow'),
		'clicking a plinth ticks its station'
	);
	await h.eventually(
		() => room(B.page),
		(r) => r.ticks.includes('tutorial-tick-flow'),
		'and the peer sees the same tick'
	);
	// clicking again un-ticks (and only that one)
	await clickPlinth(A.page, 'flow');
	await h.eventually(() => room(B.page), (r) => r.ticks.length === 0, 'clicking again clears it on the peer too');

	// --- a late joiner gets the room AND the progress ---------------------------
	await clickPlinth(A.page, 'vr');
	await clickPlinth(A.page, 'build');
	await A.page.waitForTimeout(500);

	const C = await h.setupPage(browser, 'C');
	await h.installModule(C, 'tutorial-room');
	await h.connect(C, A);
	await h.eventually(() => room(C.page), (r) => r && r.stands === 5, 'a late joiner builds the room from state sync', 15000);
	await h.eventually(
		() => room(C.page),
		(r) => r.ticks.length === 2 && r.ticks.includes('tutorial-tick-vr') && r.ticks.includes('tutorial-tick-build'),
		'and arrives with the session\'s progress, not a blank slate'
	);

	// --- remove it everywhere ---------------------------------------------------
	await h.openModules(A.page);
	await A.page.locator('#user-module-card-tutorial-room').getByRole('button', { name: 'Remove the tutorial room' }).click();
	await A.page.evaluate(() => window.__stores.modulesOpen.set(false));
	await h.eventually(() => room(A.page), (r) => r === null, 'removing it clears the room');
	await h.eventually(() => room(B.page), (r) => r === null, 'and clears it on the peers');

	await h.finish(browser);
});
