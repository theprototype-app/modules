// dungeon-realms test-flight (21-C C6): the game is an OVERLAY on the Dungeon Kit, so
// BOTH real zips install on TWO peers. Seed-identical dungeons (Kit checksums match),
// the Realms overlay (gems + portals in Realms' own group), the play-mode menu (start
// menu -> P1/P2 slots -> start), the grounded rule riding the CONTRACT
// (userData.play.grounded, with its counterfactual), the minimap markers Realms adds
// (gems + portals, one fewer per collected gem), replicated gem collection, portal
// unseal + floor travel on both sides through the Kit, the value/rows node readouts,
// and a LATE JOINER catching up mid-game with both modules.
//
//   npm run pack -- dungeon && npm run pack -- dungeon-realms
//   APP_URL=https://theprototype.app:5216/ node tests/dungeon-realms.test.cjs

const { launch, setupPage, installModule, connect, check, eventually, finish, run } = require('./helpers.cjs');

/** one serializable snapshot of the Kit world + the Realms game on a page */
function snap(page) {
	return page.evaluate(
		() =>
			new Promise((resolve) => {
				window.__stores.globalScene.subscribe((scene) => {
					const kitGroup = scene?.getObjectByName('dungeon-module');
					const overlay = scene?.getObjectByName('dungeon-realms');
					const game = overlay?.userData?._dr?.game ?? null;
					const portal = overlay?.getObjectByName('dr-portal-up');
					const floors = kitGroup?.getObjectByName('dk-floors');
					const gems = overlay?.getObjectByName('dr-gems');
					const play = kitGroup?.userData?.play;
					const minimap = document.getElementById('dungeon-minimap');
					resolve({
						kit: !!kitGroup?.userData?.kit,
						seed: kitGroup?.userData?.seed ?? null,
						floorIndex: kitGroup?.userData?.floorIndex ?? null,
						checksum: kitGroup?.userData?.checksum ?? null,
						campaignChecksum: kitGroup?.userData?.campaignChecksum ?? null,
						floorInstances: floors ? floors.count : 0,
						grounded: play?.grounded ?? null,
						markers: Array.isArray(play?.markers) ? play.markers.length : null,
						markerKinds: [...new Set((play?.markers ?? []).map((m) => m.kind))].sort(),
						overlay: !!overlay,
						gemInstances: gems ? gems.count : 0,
						game: !!game,
						started: !!game?.state.started,
						won: !!game?.state.wonAt,
						p1: game?.state.slots.p1?.peerId ?? null,
						p2: game?.state.slots.p2?.peerId ?? null,
						collected: game ? Object.values(game.state.collected).reduce((sum, set) => sum + set.size, 0) : 0,
						sealedUp: portal ? portal.userData.portal.sealed : null,
						need: game?.gemTotals().need ?? 0,
						total: game?.gemTotals().total ?? 0,
						levels: game?.state.levelCount ?? 0,
						gameFloor: game?.state.floorIndex ?? null,
						menu: !!document.getElementById('dr-menu'),
						hudDom: !!document.getElementById('dr-hud'),
						minimapVisible: !!minimap && !minimap.classList.contains('hidden')
					});
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

	// both modules on both peers: the Kit is the world, Realms the game
	await installModule(A, 'dungeon');
	await installModule(A, 'dungeon-realms');
	await installModule(B, 'dungeon');
	await installModule(B, 'dungeon-realms');

	// node families present in the palette
	const groups = await A.page.evaluate(
		() => new Promise((r) => window.__stores.moduleSDK.moduleNodeGroups.subscribe((g) => r(g.map((x) => [x.group, x.items.length])))())
	);
	const realms = groups.find(([name]) => name === 'Dungeon Realms');
	const kit = groups.find(([name]) => name === 'Dungeon Kit');
	check(!!realms && realms[1] === 6, 'node palette has "Dungeon Realms" with 6 nodes — rules, menu, prop, value, rows, event (' + JSON.stringify(realms) + ')');
	check(!!kit && kit[1] === 1, 'node palette has "Dungeon Kit" with its Dungeon node');
	const retired = await A.page.evaluate(
		() => new Promise((r) => window.__stores.moduleSDK.moduleNodeGroups.subscribe((g) => r(g.some((x) => x.items.some((i) => i.type === 'drhud' || i.type === 'drdungeon'))))())
	);
	check(!retired, 'the drhud and drdungeon nodes are GONE (deleted, not ported)');

	await connect(A, B);

	// A generates via the real module-card button -> Realms asks the Kit, the Kit replicates
	await A.page.evaluate(
		() =>
			new Promise((resolve) => {
				window.__stores.moduleSDK.moduleMenuItems.subscribe((items) => {
					items.find((item) => item.moduleId === 'dungeon-realms' && item.label === 'Generate dungeon')?.action();
					resolve();
				})();
			})
	);
	await eventually(() => snap(A.page), (s) => s.floorInstances > 0 && s.overlay && s.game, 'A: the Kit builds the level and Realms builds its overlay on top');
	const a1 = await snap(A.page);
	await eventually(
		() => snap(B.page),
		(s) => s.checksum === a1.checksum && s.campaignChecksum === a1.campaignChecksum && s.overlay,
		'B regenerates the IDENTICAL dungeon from the Kit\'s {seed, params} and overlays it (checksums match)'
	);
	check(a1.levels === 5 && a1.total >= 4 && a1.gemInstances === a1.total, 'campaign has 5 floors, ' + a1.total + ' gems on floor 1 as instances (need ' + a1.need + ')');
	check(a1.markers === a1.total + 1 && a1.markerKinds.join(',') === 'door,gem', 'Realms puts its gems + the UP portal on the minimap markers (' + a1.markers + ')');
	check(!a1.hudDom, 'no #dr-hud DOM: the HUD is core HUD elements the template authors');

	// both press the real red Play button -> play mode -> the start menu appears
	await A.page.locator('#play-button').click();
	await B.page.locator('#play-button').click();
	await eventually(() => snap(A.page), (s) => s.minimapVisible && s.menu, 'A: play mode engages (core minimap off the Kit contract) and the start menu appears');
	await eventually(() => snap(B.page), (s) => s.minimapVisible && s.menu, 'B: play mode engages and the start menu appears');

	// P1 / P2 slots replicate
	check(await clickMenu(A.page, 'join-p1'), 'A clicks "Join as Player 1"');
	check(await clickMenu(B.page, 'join-p2'), 'B clicks "Join as Player 2"');
	await eventually(() => snap(A.page), (s) => s.p1 === A.id && s.p2 === B.id, 'A sees both slots claimed (P1=A, P2=B)');
	await eventually(() => snap(B.page), (s) => s.p1 === A.id && s.p2 === B.id, 'B sees both slots claimed');

	// start the adventure -> menu closes on BOTH
	await clickMenu(A.page, 'start');
	await eventually(() => snap(A.page), (s) => s.started && !s.menu, 'A: game starts, menu gone');
	await eventually(() => snap(B.page), (s) => s.started, 'B: start replicated');

	// disableFlight rides the CONTRACT: grounded true, and false when the rule is off
	check(a1.grounded === true, 'Game Rules ▸ disableFlight publishes userData.play.grounded = true (no key swallowing)');
	await A.page.evaluate(() => (window.__dungeonRealms.game.config.rules.disableFlight = false));
	await eventually(() => snap(A.page), (s) => s.grounded === false, 'counterfactual: disableFlight off -> play.grounded false');
	await A.page.evaluate(() => (window.__dungeonRealms.game.config.rules.disableFlight = true));
	await eventually(() => snap(A.page), (s) => s.grounded === true, 'restored: grounded true again');
	const qPassed = await A.page.evaluate(
		() => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyQ', cancelable: true, bubbles: true }))
	);
	check(qPassed, 'KeyQ is NOT swallowed at window capture any more (the contract does the work)');

	// the value / rows nodes read the game
	const rows = await A.page.evaluate(() => window.__dungeonRealms.nodes.rowsFor('all'));
	check(Array.isArray(rows) && rows.some((r) => /needed/.test(r)) && rows.some((r) => /^LEVEL 1 \/ 5/.test(r)) && rows.some((r) => /^P1 /.test(r)), 'Realms HUD Rows publishes gems / level / players lines (' + rows.length + ' rows)');

	// collect one gem on A -> replicates to B; one marker fewer on both
	await A.page.evaluate(() => window.__dungeonRealms.game.collectGem(1, 0));
	await eventually(() => snap(B.page), (s) => s.collected === 1, 'B receives the gem (state = 1)');
	await eventually(() => snap(A.page), (s) => s.markers === a1.markers - 1, 'A: one minimap marker fewer after the pickup');
	await eventually(() => snap(B.page), (s) => s.markers === a1.markers - 1, 'B: marker count agrees');

	// collect up to the unseal threshold -> the UP portal unseals on BOTH peers
	await A.page.evaluate(() => {
		const g = window.__dungeonRealms.game;
		for (let i = 0; i < g.gemTotals().need; i++) g.collectGem(g.state.floorIndex, i);
	});
	await eventually(() => snap(A.page), (s) => s.sealedUp === false, 'A: UP portal unseals at the gem threshold');
	await eventually(() => snap(B.page), (s) => s.sealedUp === false, 'B: unseal replicates');

	// portal travel through the REAL click dispatch -> the Kit shows floor 2 on both, same world
	await A.page.evaluate(
		() =>
			new Promise((resolve) => {
				window.__stores.globalScene.subscribe((scene) => {
					const ring = scene.getObjectByName('dungeon-realms').getObjectByName('dr-portal-up').children[0];
					resolve(window.__stores.moduleSDK.moduleClickHandlers.some((handler) => handler(ring)));
				})();
			})
	);
	await eventually(() => snap(A.page), (s) => s.floorIndex === 2 && s.gameFloor === 2 && s.overlay, 'A travels to floor 2 (Kit + overlay agree)');
	const a2 = await snap(A.page);
	await eventually(
		() => snap(B.page),
		(s) => s.floorIndex === 2 && s.gameFloor === 2 && s.checksum === a2.checksum,
		'B travels with A — floor 2 checksums match'
	);

	// late joiner: installs BOTH, connects mid-game, catches up wholesale.
	// A leaves play mode first — the approval toast is unreachable while the
	// approving peer is pointer-locked in play mode.
	await A.page.keyboard.press('Escape');
	await A.page.waitForTimeout(500);
	const C = await setupPage(browser, 'C');
	await installModule(C, 'dungeon');
	await installModule(C, 'dungeon-realms');
	await connect(C, A);
	await eventually(
		() => snap(C.page),
		(s) => s.floorIndex === 2 && s.checksum === a2.checksum && s.started && s.collected === a2.collected && s.gameFloor === 2 && s.overlay,
		'late joiner C rebuilds mid-game (floor 2, same checksum, gem count, started, overlay up)',
		30000
	);

	await finish(browser);
});
