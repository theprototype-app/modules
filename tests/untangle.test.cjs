// untangle test-flight (21-C C7): the REAL zip on TWO peers. With NO Untangle Board node
// in any graph the module falls back to today's behaviour (a level-1 board appears on its
// own after the node-or-fallback window), the board stands at the default pose, drops
// replicate as authoritative moves, a solve is detected on EVERY peer from the same
// positions and both advance in lockstep, the desktop shows NO canvas sprite (the sprite
// is the VR-only HUD path), and a LATE JOINER gets {level, positions}.
//
// Roadmap 30 P2 — PROGRESS: the solver (A moved the dots) banks level 1 and opens level 2
// LOCALLY; B, who never moved a dot, banks nothing; A RELOADS and the progress is still there
// under `tp:mod:untangle:progress`; the real HUD level grid (the module's own HUD kind) shows
// 2 open and 3 locked, a locked cell is inert, an open one changes the board; Reset progress
// asks first, then locks level 2 again and toasts.
//
//   npm run pack -- untangle
//   APP_URL=https://theprototype.app:5216/ node tests/untangle.test.cjs

const { launch, setupPage, installModule, connect, check, eventually, finish, run, toasts } = require('./helpers.cjs');

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
	check(a0.dots === a0.positions.length && a0.positions.length === 5, 'level 1 has 5 dots — the roadmap-30 curve (' + a0.dots + ')');
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
	await eventually(() => snap(A.page), (s) => s.level === 2 && s.dots === 5 && s.edges.length === 6, 'A: autoAdvance to level 2 (5 dots, 6 edges)', 6000);
	await eventually(() => snap(B.page), (s) => s.level === 2 && s.dots === 5, 'B: advanced in lockstep with no "win" message', 6000);
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
	// a NUDGE (0.01): it changes the positions without changing the crossing structure — a
	// far move can solve a 5-dot board outright and advance the level under the test
	check(await A.page.evaluate(() => {
		const p = window.__untangle.state().positions[2];
		return window.__untangle.move(2, [p[0] + 0.01, p[1]]);
	}), 'A nudges dot 2 before the joiner arrives');
	check((await snap(A.page)).crossings > 0, '(premise) the board is still tangled');
	const C = await setupPage(browser, 'C');
	await installModule(C, 'untangle');
	await connect(C, A);
	const aEnd = await snap(A.page);
	await eventually(() => snap(C.page), (s) => !!s && s.level === 2 && JSON.stringify(s.positions) === JSON.stringify(aEnd.positions), 'late joiner C has level 2 and A\'s exact positions', 30000);
	await A.page.waitForTimeout(1500);
	const aAfter = await snap(A.page);
	check(aAfter.level === 2 && JSON.stringify(aAfter.positions) === JSON.stringify(aEnd.positions), 'counterfactual: the joiner\'s untouched level-1 board did NOT overwrite A (the symmetric state exchange)');

	// ---- P2: progress survives a reload; the grid locks; Reset progress -------------------------
	const progA = await A.page.evaluate(() => window.__untangle.progress());
	const progB = await B.page.evaluate(() => window.__untangle.progress());
	check(progA['2d'].unlocked === 2 && JSON.stringify(progA['2d'].solved) === '[1]', 'P2.1 A (the solver) banked level 1 and opened level 2 (' + JSON.stringify(progA['2d']) + ')');
	check(progB['2d'].unlocked === 1 && progB['2d'].solved.length === 0, 'P2.2 B never moved a dot: nothing banked (progress is per player)');
	const key = await A.page.evaluate(() => localStorage.getItem('tp:mod:untangle:progress'));
	check(!!key && JSON.parse(key)['2d'].unlocked === 2, 'P2.3 stored under tp:mod:untangle:progress (' + (await A.page.evaluate(() => window.__untangle.storageKind)) + ')');
	await C.ctx.close();
	await B.ctx.close();
	await A.page.reload({ waitUntil: 'domcontentloaded' });
	await A.page.waitForFunction(() => window.__stores && !!window.__stores.moduleSDK, null, { timeout: 30000 });
	await eventually(() => A.page.evaluate(() => window.__stores.moduleSDK.loadedModules.map((m) => m.id)), (ids) => ids.includes('untangle'), 'P2.4 (premise) after the reload the installed module loads again', 20000);
	await eventually(() => A.page.evaluate(() => window.__untangle?.progress?.()), (p) => !!p && p['2d'].unlocked === 2 && p['2d'].solved.includes(1), 'P2.5 after the RELOAD level 2 is still open and level 1 solved');
	// the real grid: a HUD document with the module's levels element on a menu screen, in play
	await A.page.evaluate(() =>
		window.__stores.hudDocs.hudDocsRestore(
			{
				scene: {
					active: 'menu',
					changedAt: 0,
					screens: [{ id: 'menu', name: 'Menu', showWhile: '', input: 'menu', elements: [{ id: 'lv', kind: 'mod-untangle-levels', anchor: 'center', x: 0, y: 0, w: 480, h: 300, z: 1, label: '' }] }]
				}
			},
			false
		)
	);
	await A.page.locator('#play-button').click();
	const cell = (n) => A.page.locator('#hud-layer .ut-cell[data-level="' + n + '"]');
	await eventually(() => cell(3).getAttribute('data-state').catch(() => null), (v) => v === 'locked', 'P2.6 the grid renders: level 3 is LOCKED', 10000);
	check((await cell(2).getAttribute('data-state')) === 'next' && (await cell(1).getAttribute('data-state')) === 'solved', 'P2.7 level 1 shows solved, level 2 is the highlighted next level');
	const before = (await snap(A.page)).level;
	await cell(3).click({ force: true });
	await A.page.waitForTimeout(300);
	check((await snap(A.page)).level === before, 'P2.8 a locked cell is inert (the board stays on level ' + before + ')');
	await cell(2).click();
	await eventually(() => snap(A.page), (s) => s.level === 2, 'P2.9 an open cell loads that level');
	await A.page.locator('#hud-layer .ut-reset').click();
	await eventually(() => A.page.locator('#hud-layer .ut-reset-yes').count(), (n) => n === 1, 'P2.10 Reset progress ASKS first');
	check((await A.page.evaluate(() => window.__untangle.progress()))['2d'].unlocked === 2, 'P2.11 ...and nothing is reset until you confirm');
	await A.page.locator('#hud-layer .ut-reset-yes').click();
	await eventually(() => cell(2).getAttribute('data-state'), (v) => v === 'locked', 'P2.12 confirmed: level 2 is locked again');
	check(/progress reset/i.test(await toasts(A.page)), 'P2.13 a toast says so');
	const cleared = JSON.parse(await A.page.evaluate(() => localStorage.getItem('tp:mod:untangle:progress')));
	check(cleared['2d'].unlocked === 1 && cleared['2d'].solved.length === 0 && cleared['3d'].unlocked === 1, 'P2.14 the stored progress is the default again');
	await A.page.keyboard.press('Escape');

	await finish(browser);
});
