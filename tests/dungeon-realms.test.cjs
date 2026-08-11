// dungeon-realms test-flight: real zip install on TWO peers, seed-identical
// dungeons (checksum match), the play-mode GUI (start menu -> P1/P2 slots ->
// start), replicated gem collection, portal unseal + floor travel on both
// sides, flight-key suppression, and a LATE JOINER catching up mid-game.
//
//   npm run pack -- dungeon-realms
//   APP_URL=https://localhost:5189/ node tests/dungeon-realms.test.cjs

const { launch, setupPage, installModule, connect, check, eventually, finish, run } = require('./helpers.cjs');

/** one serializable snapshot of the module's game state on a page */
function snap(page) {
	return page.evaluate(
		() =>
			new Promise((resolve) => {
				window.__stores.globalScene.subscribe((scene) => {
					const group = scene?.getObjectByName('dungeon-module');
					const game = group?.userData?._dr?.game;
					const portal = group?.getObjectByName('dr-portal-up');
					const floors = group?.getObjectByName('dr-floors');
					const minimap = document.getElementById('dungeon-minimap');
					resolve(
						group && game
							? {
									seed: group.userData.seed,
									floorIndex: group.userData.floorIndex,
									checksum: group.userData.checksum,
									campaignChecksum: group.userData.campaignChecksum,
									floorInstances: floors ? floors.count : 0,
									started: !!game.state.started,
									won: !!game.state.wonAt,
									p1: game.state.slots.p1?.peerId ?? null,
									p2: game.state.slots.p2?.peerId ?? null,
									collected: Object.values(game.state.collected).reduce((sum, set) => sum + set.size, 0),
									sealedUp: portal ? portal.userData.portal.sealed : null,
									need: game.gemTotals().need,
									total: game.gemTotals().total,
									floors: game.state.campaign?.floors.length ?? 0,
									menu: !!document.getElementById('dr-menu'),
									hud: !!document.getElementById('dr-hud'),
									hudGems: document.getElementById('dr-gem-count')?.textContent ?? null,
									minimapVisible: !!minimap && !minimap.classList.contains('hidden')
								}
							: null
					);
				})();
			})
	);
}

/** click a GUI menu button by its action id (module GUI uses direct onclick) */
function clickMenu(page, id) {
	return page.evaluate((id) => {
		const button = document.querySelector('#dr-menu .dr-btn[data-id="' + id + '"]');
		if (!button) return false;
		button.click();
		return true;
	}, id);
}

run(async () => {
	const browser = await launch();
	const A = await setupPage(browser, 'A');
	const B = await setupPage(browser, 'B');

	await installModule(A, 'dungeon-realms');
	await installModule(B, 'dungeon-realms');

	// node family present in the palette
	const groups = await A.page.evaluate(
		() => new Promise((r) => window.__stores.moduleSDK.moduleNodeGroups.subscribe((g) => r(g.map((x) => [x.group, x.items.length])))())
	);
	const family = groups.find(([name]) => name === 'Dungeon Realms');
	check(!!family && family[1] === 5, 'node palette has "Dungeon Realms" with 5 nodes (' + JSON.stringify(family) + ')');

	await connect(A, B);

	// A generates via the real module-card button; the op replicates the recipe
	await A.page.evaluate(
		() =>
			new Promise((resolve) => {
				window.__stores.moduleSDK.moduleMenuItems.subscribe((items) => {
					items.find((item) => item.moduleId === 'dungeon-realms' && item.label === 'Generate dungeon')?.action();
					resolve();
				})();
			})
	);
	await eventually(() => snap(A.page), (s) => !!s && s.floorInstances > 0, 'A builds the dungeon (instanced floors > 0)');
	const a1 = await snap(A.page);
	await eventually(
		() => snap(B.page),
		(s) => !!s && s.checksum === a1.checksum && s.campaignChecksum === a1.campaignChecksum,
		'B regenerates the IDENTICAL dungeon from {seed, params} (checksums match)'
	);
	check(a1.floors === 5 && a1.total >= 4, 'campaign has 5 floors, ' + a1.total + ' gems hidden on floor 1 (need ' + a1.need + ')');

	// both press the real red Play button -> play mode -> the start menu appears
	await A.page.locator('#play-button').click();
	await B.page.locator('#play-button').click();
	await eventually(() => snap(A.page), (s) => s?.minimapVisible && s?.menu, 'A: play mode engages and the start menu appears');
	await eventually(() => snap(B.page), (s) => s?.minimapVisible && s?.menu, 'B: play mode engages and the start menu appears');

	// P1 / P2 slots replicate
	check(await clickMenu(A.page, 'join-p1'), 'A clicks "Join as Player 1"');
	check(await clickMenu(B.page, 'join-p2'), 'B clicks "Join as Player 2"');
	await eventually(() => snap(A.page), (s) => s?.p1 === A.id && s?.p2 === B.id, 'A sees both slots claimed (P1=A, P2=B)');
	await eventually(() => snap(B.page), (s) => s?.p1 === A.id && s?.p2 === B.id, 'B sees both slots claimed');

	// start the adventure -> menu closes, HUD appears on BOTH
	await clickMenu(A.page, 'start');
	await eventually(() => snap(A.page), (s) => s?.started && s?.hud && !s?.menu, 'A: game starts, HUD up, menu gone');
	await eventually(() => snap(B.page), (s) => s?.started && s?.hud, 'B: start replicated, HUD up');

	// flight keys are swallowed while the game runs (Game Rules ▸ disableFlight)
	const qSuppressed = await A.page.evaluate(
		() => !window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyQ', cancelable: true, bubbles: true }))
	);
	check(qSuppressed, 'KeyQ (fly up) is suppressed while the game runs');

	// collect one gem on A -> replicates to B (HUD counter agrees)
	await A.page.evaluate(
		() =>
			new Promise((resolve) => {
				window.__stores.globalScene.subscribe((scene) => {
					scene.getObjectByName('dungeon-module').userData._dr.game.collect(0);
					resolve();
				})();
			})
	);
	await eventually(() => snap(B.page), (s) => s?.collected === 1 && s?.hudGems === '1', 'B receives the gem (state + HUD counter = 1)');

	// collect up to the unseal threshold -> the UP portal unseals on BOTH peers
	await A.page.evaluate(
		() =>
			new Promise((resolve) => {
				window.__stores.globalScene.subscribe((scene) => {
					const game = scene.getObjectByName('dungeon-module').userData._dr.game;
					for (let i = 0; i < game.gemTotals().need; i++) game.collect(i);
					resolve();
				})();
			})
	);
	await eventually(() => snap(A.page), (s) => s?.sealedUp === false, 'A: UP portal unseals at the gem threshold');
	await eventually(() => snap(B.page), (s) => s?.sealedUp === false, 'B: unseal replicates');

	// portal travel through the REAL click dispatch -> floor 2 on both, same world
	await A.page.evaluate(
		() =>
			new Promise((resolve) => {
				window.__stores.globalScene.subscribe((scene) => {
					const ring = scene.getObjectByName('dungeon-module').getObjectByName('dr-portal-up').children[0];
					resolve(window.__stores.moduleSDK.moduleClickHandlers.some((handler) => handler(ring)));
				})();
			})
	);
	await eventually(() => snap(A.page), (s) => s?.floorIndex === 2, 'A travels to floor 2');
	const a2 = await snap(A.page);
	await eventually(
		() => snap(B.page),
		(s) => s?.floorIndex === 2 && s.checksum === a2.checksum,
		'B travels with A — floor 2 checksums match'
	);

	// late joiner: installs, connects mid-game, catches up wholesale.
	// A leaves play mode first — the approval toast is unreachable while the
	// approving peer is pointer-locked in play mode.
	await A.page.keyboard.press('Escape');
	await A.page.waitForTimeout(500);
	const C = await setupPage(browser, 'C');
	await installModule(C, 'dungeon-realms');
	await connect(C, A);
	await eventually(
		() => snap(C.page),
		(s) => !!s && s.floorIndex === 2 && s.checksum === a2.checksum && s.started && s.collected === a2.collected,
		'late joiner C rebuilds mid-game (floor 2, same checksum, gem count, started)',
		30000
	);

	await finish(browser);
});
