// Dungeon Kit test-flight: the REAL zip on TWO peers, the registered TOOLBOX (21-C
// C6.2 — `api.registerToolbox`, no `#dungeon-panel`), Generate through the toolbox
// DOM -> seed-identical dungeons on both peers (checksums match), the play CONTRACT
// a bare Kit publishes (grounded, NO markers, contract v2, world-space props/portals),
// the app's own minimap reading it in play mode (dungeonData), the floor stepper
// replicating travel, Clear replicating, the Dungeon node in the palette, and a LATE
// JOINER rebuilding from {seed, params, floorIndex}.
//
//   npm run pack -- dungeon
//   APP_URL=https://theprototype.app:5216/ node tests/dungeon.test.cjs

const { launch, setupPage, installModule, connect, check, eventually, finish, run } = require('./helpers.cjs');

/** the Kit's group + contract on a page */
function snap(page) {
	return page.evaluate(
		() =>
			new Promise((resolve) => {
				window.__stores.globalScene.subscribe((scene) => {
					const group = scene?.getObjectByName('dungeon-module');
					const floors = group?.getObjectByName('dk-floors');
					const play = group?.userData?.play;
					const minimap = document.getElementById('dungeon-minimap');
					resolve(
						group
							? {
									hasKit: typeof group.userData.kit?.generate === 'function',
									kitVersion: group.userData.kit?.version ?? null,
									seed: group.userData.seed ?? null,
									floorIndex: group.userData.floorIndex ?? null,
									levelCount: group.userData.levelCount ?? null,
									checksum: group.userData.checksum ?? null,
									campaignChecksum: group.userData.campaignChecksum ?? null,
									floorInstances: floors ? floors.count : 0,
									hasPlay: !!play,
									contract: play?.contract ?? null,
									grounded: play?.grounded ?? null,
									markers: Array.isArray(play?.markers) ? play.markers.length : null,
									props: play?.props?.length ?? 0,
									gems: (play?.props ?? []).filter((p) => p.kind === 'gem').length,
									portals: (play?.portals ?? []).map((p) => p.kind),
									rooms: play?.rooms?.length ?? 0,
									entranceFirst: play?.rooms?.[0]?.type === 'entrance',
									params: group.userData.params ?? null,
									minimapVisible: !!minimap && !minimap.classList.contains('hidden'),
									panelDom: !!document.getElementById('dungeon-panel'),
									toolboxHost: window.__dungeonKit?.toolbox?.host ?? null
								}
							: null
					);
				})();
			})
	);
}

/** open the Kit toolbox through the store the sidebar uses; returns true when its DOM mounted */
async function openToolbox(page) {
	return page.evaluate(async () => {
		const s = window.__stores;
		let list = [];
		s.moduleToolboxes.moduleToolboxes.subscribe((v) => (list = v))();
		const box = list.find((b) => b.moduleId === 'dungeon');
		if (!box) return { ok: false, why: 'no toolbox registered for dungeon' };
		s.moduleToolboxes.openModuleToolbox(box.id);
		for (let i = 0; i < 20 && !document.getElementById('dk-generate'); i++) await new Promise((r) => setTimeout(r, 100));
		return { ok: !!document.getElementById('dk-generate'), id: box.id, title: box.title };
	});
}

run(async () => {
	const browser = await launch();
	const A = await setupPage(browser, 'A');
	const B = await setupPage(browser, 'B');

	await installModule(A, 'dungeon');
	await installModule(B, 'dungeon');

	// the palette has the Kit's node, the group exists from the first frame, no fixed panel
	const groups = await A.page.evaluate(
		() => new Promise((r) => window.__stores.moduleSDK.moduleNodeGroups.subscribe((g) => r(g.map((x) => [x.group, x.items.length])))())
	);
	const family = groups.find(([name]) => name === 'Dungeon Kit');
	check(!!family && family[1] === 1, 'node palette has "Dungeon Kit" with 1 node (' + JSON.stringify(family) + ')');
	const empty = await snap(A.page);
	check(!!empty && empty.hasKit && empty.kitVersion === 2 && !empty.hasPlay, 'the persistent group carries userData.kit (v2) before any dungeon exists, and no play contract');
	check(empty.toolboxHost === 'toolbox' && !empty.panelDom, 'the toolbox is the registered ToolboxWindow host — no #dungeon-panel DOM (' + empty.toolboxHost + ')');

	await connect(A, B);

	// generate through the REAL toolbox DOM
	const opened = await openToolbox(A.page);
	check(opened.ok, 'A opens the Dungeon Kit toolbox (' + JSON.stringify(opened) + ')');
	await A.page.evaluate(() => {
		const seed = document.getElementById('dk-seed');
		seed.value = '4242';
		seed.dispatchEvent(new Event('change', { bubbles: true }));
		document.getElementById('dk-generate').click();
	});
	await eventually(() => snap(A.page), (s) => !!s && s.floorInstances > 0 && s.seed === 4242, 'A builds seed 4242 from the toolbox (instanced floors > 0)');
	const a1 = await snap(A.page);
	await eventually(
		() => snap(B.page),
		(s) => !!s && s.checksum === a1.checksum && s.campaignChecksum === a1.campaignChecksum && s.seed === 4242,
		'B regenerates the IDENTICAL dungeon from {seed, params} (checksums match)'
	);

	// the contract a BARE Kit publishes
	check(a1.contract === 2 && a1.hasPlay, 'userData.play carries contract v2');
	check(a1.grounded === true, 'a dungeon is walked: play.grounded is true by default');
	check(a1.markers === 0, 'a bare Kit puts NOTHING on the minimap (markers: [])');
	check(a1.gems >= 4 && a1.props > a1.gems && a1.portals.includes('up'), 'props (' + a1.props + ', ' + a1.gems + ' gems) and portals (' + a1.portals.join(',') + ') are published in world space');
	check(a1.rooms > 0 && a1.entranceFirst, 'rooms are spawn-ordered, entrance first (' + a1.rooms + ')');
	check(a1.levelCount === 5 && a1.floorIndex === 1, 'campaign of 5 floors, floor 1 shown');
	const stats = await A.page.evaluate(() => document.getElementById('dk-stats')?.textContent ?? '');
	check(/checksum \d+/.test(stats) && /gems/.test(stats), 'the toolbox footer shows the stats line (' + stats.split('\n')[0] + ')');

	// core reads the contract: the minimap shows in play mode (dungeonData -> userData.play)
	await A.page.locator('#play-button').click();
	await eventually(() => snap(A.page), (s) => s?.minimapVisible, 'A: play mode shows the core minimap off the Kit\'s contract');
	await A.page.keyboard.press('Escape');
	await A.page.waitForTimeout(500);

	// the floor stepper replicates travel
	await A.page.evaluate(() => document.getElementById('dk-floor-up').click());
	await eventually(() => snap(A.page), (s) => s?.floorIndex === 2, 'A steps to floor 2 through the toolbox');
	const a2 = await snap(A.page);
	check(a2.checksum !== a1.checksum, 'floor 2 is a different floor (checksum changed)');
	await eventually(() => snap(B.page), (s) => s?.floorIndex === 2 && s.checksum === a2.checksum, 'B follows to floor 2 — checksums match');

	// late joiner: installs, connects, rebuilds {seed, params, floorIndex}
	const C = await setupPage(browser, 'C');
	await installModule(C, 'dungeon');
	await connect(C, A);
	await eventually(
		() => snap(C.page),
		(s) => !!s && s.seed === 4242 && s.floorIndex === 2 && s.checksum === a2.checksum,
		'late joiner C rebuilds seed 4242 on floor 2 (same checksum)',
		30000
	);

	// clear replicates; the group stays (persistent) but the contract goes
	await A.page.evaluate(() => document.getElementById('dk-clear').click());
	await eventually(() => snap(A.page), (s) => !!s && !s.hasPlay && s.floorInstances === 0, 'A clears: no play contract, no floors, the group persists');
	await eventually(() => snap(B.page), (s) => !!s && !s.hasPlay, 'B: clear replicates');
	await eventually(() => snap(C.page), (s) => !!s && !s.hasPlay, 'C: clear replicates');

	await finish(browser);
});
