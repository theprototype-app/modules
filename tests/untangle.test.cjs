// untangle test-flight (21-C C7): the REAL zip on TWO peers. With NO Untangle Board node
// in any graph the module falls back to today's behaviour (a level-1 board appears on its
// own after the node-or-fallback window), the board stands at the default pose, drops
// replicate as authoritative moves, a solve is detected on EVERY peer from the same
// positions and both advance in lockstep, the desktop shows NO canvas sprite (the sprite
// is the VR-only HUD path), and a LATE JOINER gets {level, positions}.
//
//   npm run pack -- untangle
//   APP_URL=https://theprototype.app:5216/ node tests/untangle.test.cjs

const { launch, setupPage, installModule, connect, check, eventually, finish, run } = require('./helpers.cjs');

const snap = (page) =>
	page.evaluate(() => {
		let scene;
		window.__stores.globalScene.subscribe((v) => (scene = v))();
		const group = scene?.getObjectByName('untangle-module');
		const s = window.__untangle?.state() ?? null;
		return s
			? {
					...s,
					positions: s.positions.map((p) => [Math.round(p[0] * 1000) / 1000, Math.round(p[1] * 1000) / 1000]),
					group: !!group,
					groupY: group ? Math.round(group.position.y * 100) / 100 : null,
					dots: group ? group.children.filter((c) => c.name.startsWith('untangle-dot-')).length : 0,
					spriteInScene: !!group?.getObjectByName('untangle-hud')
				}
			: null;
	});

run(async () => {
	const browser = await launch();
	const A = await setupPage(browser, 'A');
	const B = await setupPage(browser, 'B');
	await installModule(A, 'untangle');
	await installModule(B, 'untangle');

	const groups = await A.page.evaluate(
		() => new Promise((r) => window.__stores.moduleSDK.moduleNodeGroups.subscribe((g) => r(g.map((x) => [x.group, x.items.length])))())
	);
	const family = groups.find(([name]) => name === 'Untangle');
	check(!!family && family[1] === 3, 'node palette has "Untangle" with 3 nodes — board, value, event (' + JSON.stringify(family) + ')');

	// no node anywhere -> the fallback: a level-1 board on its own, at the default pose
	await eventually(() => snap(A.page), (s) => !!s && s.built && s.level === 1 && s.dots > 0, 'A: with no Untangle Board node the level-1 board appears on its own (the fallback window)');
	const a0 = await snap(A.page);
	check(a0.nodeOwned === false && a0.groupY === 1.6 && a0.board.radius === 1.1, 'A: not node-owned, default pose (boardY 1.6, radius 1.1)');
	check(a0.dots === a0.positions.length && a0.positions.length === 6, 'level 1 has 6 dots (' + a0.dots + ')');
	check(a0.spriteInScene === false && a0.sprite === false, 'no canvas sprite on desktop — the sprite is the VR-only HUD path');
	check(a0.crossings > 0, 'the scramble starts tangled (' + a0.crossings + ' crossings)');
	check(a0.touched === false, 'an untouched fallback board answers the state exchange with NOTHING (it must never overwrite a room)');

	await connect(A, B);
	await eventually(() => snap(B.page), (s) => !!s && s.built && s.level === 1, 'B: its own level-1 board');
	check(JSON.stringify((await snap(B.page)).positions) === JSON.stringify(a0.positions), 'B generated the IDENTICAL scramble (determinism is the netcode)');

	// a drop replicates as an authoritative move
	check(await A.page.evaluate(() => window.__untangle.move(0, [0.25, -0.4])), 'A drops dot 0 at (0.25, -0.4)');
	await eventually(() => snap(B.page), (s) => s.positions[0][0] === 0.25 && s.positions[0][1] === -0.4, 'B receives the move');
	check(await A.page.evaluate(() => window.__untangle.move(1, [5, -5])), 'A drops dot 1 far outside the board');
	await eventually(() => snap(B.page), (s) => s.positions[1][0] === 1 && s.positions[1][1] === -1, 'B: the drop was clamped to the board edge (1, -1)');

	// solve on A -> detected on BOTH from the same positions -> lockstep advance to level 2
	check(await A.page.evaluate(() => window.__untangle.solve()), 'A drops every dot on the solution circle (0 crossings)');
	await eventually(() => snap(B.page), (s) => s.crossings === 0, 'B: zero crossings from the same positions');
	await eventually(() => snap(A.page), (s) => s.level === 2 && s.dots === 7, 'A: autoAdvance to level 2 (7 dots)', 6000);
	await eventually(() => snap(B.page), (s) => s.level === 2 && s.dots === 7, 'B: advanced in lockstep with no "win" message', 6000);
	const a2 = await snap(A.page);
	check(a2.solvedCount === 1 && (await snap(B.page)).solvedCount === 1, 'both peers count ONE solve');

	// Restart level replicates
	await A.page.evaluate(
		() =>
			new Promise((resolve) => {
				window.__stores.moduleSDK.moduleMenuItems.subscribe((items) => {
					items.find((item) => item.moduleId === 'untangle' && item.label === 'Restart level')?.action();
					resolve();
				})();
			})
	);
	await eventually(() => snap(B.page), (s) => s.level === 2 && JSON.stringify(s.positions) === JSON.stringify(a2.positions), 'B: Restart level re-scrambles level 2 identically');

	// late joiner: installs, connects, gets {level, positions}
	check(await A.page.evaluate(() => window.__untangle.move(2, [0.3, 0.3])), 'A moves dot 2 before the joiner arrives');
	const C = await setupPage(browser, 'C');
	await installModule(C, 'untangle');
	await connect(C, A);
	const aEnd = await snap(A.page);
	await eventually(() => snap(C.page), (s) => !!s && s.level === 2 && JSON.stringify(s.positions) === JSON.stringify(aEnd.positions), 'late joiner C has level 2 and A\'s exact positions', 30000);
	await A.page.waitForTimeout(1500);
	const aAfter = await snap(A.page);
	check(aAfter.level === 2 && JSON.stringify(aAfter.positions) === JSON.stringify(aEnd.positions), 'counterfactual: the joiner\'s untouched level-1 board did NOT overwrite A (the symmetric state exchange)');

	await finish(browser);
});
