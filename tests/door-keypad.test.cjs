// door-keypad test-flight: install the real zip on two connected peers, place
// the pieces, press the code in order on peer A and watch peer B's door swing;
// then a wrong press resets, and a late joiner arrives at an already-open door.
const h = require('./helpers.cjs');

/** the module's own secret, recomputed here from the door uuid the same way */
function codeFor(uuid, buttons = 4) {
	let hash = 0x811c9dc5;
	for (const char of uuid) {
		hash ^= char.charCodeAt(0);
		hash = Math.imul(hash, 0x01000193) >>> 0;
	}
	const code = [];
	for (let i = 0; i < buttons; i++) {
		code.push((hash % buttons) + 1);
		hash = Math.imul(hash ^ (hash >>> 13), 0x01000193) >>> 0;
	}
	return code;
}

/** click a placed piece through the app's own click dispatch */
const pressButton = (page, index) =>
	page.evaluate(
		(index) =>
			new Promise((resolve) => {
				window.__stores.objectsGroup.subscribe((group) => {
					const button = group.children.find((c) => c.name === 'Kpbutton' + index);
					if (!button) return resolve(false);
					resolve(window.__stores.moduleSDK.moduleClickHandlers.some((fn) => fn(button)));
				})();
			}),
		index
	);

const doorYaw = (page) =>
	page.evaluate(
		() =>
			new Promise((r) =>
				window.__stores.objectsGroup.subscribe((g) =>
					r(g.children.find((c) => c.name === 'Kpdoor')?.rotation.y ?? 0)
				)()
			)
	);

const uuidOf = (page, name) =>
	page.evaluate(
		(name) =>
			new Promise((r) =>
				window.__stores.objectsGroup.subscribe((g) =>
					r(g.children.find((c) => c.name === name)?.uuid ?? null)
				)()
			),
		name
	);

h.run(async () => {
	const browser = await h.launch();
	const A = await h.setupPage(browser, 'A');
	const B = await h.setupPage(browser, 'B');

	await h.installModule(A, 'door-keypad');
	await h.installModule(B, 'door-keypad');
	await h.connect(A, B);

	// --- place the pieces (replicated objects, created the normal way) --------
	for (let i = 1; i <= 4; i++) await h.sceneCommand(A.page, '/create Kpbutton' + i);
	await h.sceneCommand(A.page, '/create Kpdoor');
	await h.eventually(
		() => h.objectNames(B.page),
		(names) => names.includes('Kpdoor') && names.filter((n) => n.startsWith('Kpbutton')).length === 4,
		'keypad + door replicate to the peer'
	);

	// --- the secret is derived, not sent --------------------------------------
	const doorUuid = await uuidOf(A.page, 'Kpdoor');
	const code = codeFor(doorUuid);
	h.check(code.length === 4 && code.every((d) => d >= 1 && d <= 4), 'code derives from the door uuid: ' + code.join('-'));
	const revealed = await A.page.evaluate(async () => {
		window.__stores.modulesOpen.set(true);
		return true;
	});
	h.check(revealed, 'manager opens for the card check');
	await A.page.getByRole('tab', { name: 'User', exact: true }).click();
	await A.page.waitForTimeout(300);
	await A.page.locator('#user-module-card-door-keypad').getByRole('button', { name: /Reveal the code/ }).click();
	await h.eventually(
		() => h.toasts(A.page),
		(t) => t.includes('press buttons ' + code.join(' - ')),
		'the module reveals the same code the test computed'
	);
	await A.page.evaluate(() => window.__stores.modulesOpen.set(false));

	// --- a wrong press resets, and does not open anything ----------------------
	const wrong = [1, 2, 3, 4].find((d) => d !== code[0]);
	await pressButton(A.page, wrong);
	await A.page.waitForTimeout(500);
	h.check(Math.abs(await doorYaw(A.page)) < 0.001, 'a wrong first press leaves the door shut');

	// --- enter the code in order on A ------------------------------------------
	for (const digit of code) {
		await pressButton(A.page, digit);
		await A.page.waitForTimeout(250);
	}

	// (this also PROVES the reset above: without it `entered` would still hold
	// the wrong press, the sequence could never match, and the door never opens)
	await h.eventually(() => doorYaw(A.page), (y) => y < -1.7, 'the code opens the door after the wrong press reset it', 8000);
	await h.eventually(() => doorYaw(B.page), (y) => y < -1.7, 'and on the peer that only received the unlock', 8000);

	// --- deterministic swing: both peers land on the SAME pose -----------------
	const [yawA, yawB] = [await doorYaw(A.page), await doorYaw(B.page)];
	h.check(
		Math.abs(yawA - yawB) < 0.0001,
		'both peers computed an identical final pose (' + yawA.toFixed(5) + ' vs ' + yawB.toFixed(5) + ')'
	);

	// --- a late joiner catches up through registerStateSync --------------------
	const C = await h.setupPage(browser, 'C');
	await h.installModule(C, 'door-keypad');
	await h.connect(C, A);
	await h.eventually(
		() => doorYaw(C.page),
		(y) => y < -1.7,
		'a peer joining after the unlock finds the door open',
		15000
	);

	// --- re-lock from the card resets everywhere --------------------------------
	await h.openModules(A.page);
	await A.page.locator('#user-module-card-door-keypad').getByRole('button', { name: 'Lock the door' }).click();
	await A.page.evaluate(() => window.__stores.modulesOpen.set(false));
	await h.eventually(() => doorYaw(B.page), (y) => Math.abs(y) < 0.001, 'locking again closes the door on peers');

	await h.finish(browser);
});
