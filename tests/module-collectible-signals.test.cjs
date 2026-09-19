// collectible SIGNALS flight (R29 S4) — split out of module-collectible.test.cjs, which
// already runs close to the runner's 8-minute cap. It covers what the module does with
// core's R29 seams: the manager redraws on api.flow/game.onChange instead of a 500ms poll,
// the recipe lands on api.flow.freeRegion, the form carries the touch radius — and the
// SAME module source still runs on an app without those seams (a 1.14.0-shaped api).
//
//   APP_URL=https://localhost:5183/ npm test -- collectible-signals
//
// (the original header of the main flight follows, for its helpers)
// collectible test-flight — the REAL zip on two peers (and a third that joins late),
// driving the module's own toolbox to build the graph and the app's own click dispatch
// to collect.
//
// What this flight is really checking is that the module BORROWS core's rules instead of
// re-implementing them: `whilePlaying` dormancy hands the object back, `perRound` retires
// a stamp on a round bump, and `{replicate:false}` keeps a per-player pulse — the hide,
// the latch AND the count — inside one peer.
//
// TWO THINGS IT DELIBERATELY DOES NOT ASSERT:
//   - the SHARED score after a shared collect. `add` is a per-peer read-modify-write off
//     one replicated stamp (core's standing Set Variable semantics), so two peers can
//     bank one pickup twice. Assert the WORLD — is the gem hidden on both screens — and
//     use `scope: 'player'` where an exact number matters.
//   - a real mouse click on the gem. The pick is core's; what belongs to the module is the
//     click HANDLER, so the flight dispatches through `moduleSDK.moduleClickHandlers` the
//     way door-keypad does.
//
//   APP_URL=https://localhost:5183/ npm test -- collectible
const h = require('./helpers.cjs');

const TOOLBOX = 'mod-collectible-manager';

// --- page reads -------------------------------------------------------------------
const nodesOf = (peer, type) =>
	peer.page.evaluate(
		(t) =>
			window.__stores
				.allNodes()
				.filter((n) => !t || n.type === t)
				.map((n) => ({ id: n.id, type: n.type, graph: n.__graph ?? 'scene', data: { ...(n.data ?? {}) } })),
		type ?? null
	);

const edgesOf = (peer) =>
	peer.page.evaluate(() => {
		let graphs;
		window.__stores.flowGraphs.subscribe((v) => (graphs = v))();
		return Object.entries(graphs ?? {}).flatMap(([graphId, doc]) =>
			(doc.edges ?? []).map((e) => ({
				id: e.id,
				source: e.source,
				target: e.target,
				targetHandle: e.targetHandle ?? null,
				graphId
			}))
		);
	});

const visibleOf = (peer, uuid) =>
	peer.page.evaluate((u) => {
		let group;
		window.__stores.objectsGroup.subscribe((v) => (group = v))();
		return group?.getObjectByProperty('uuid', u)?.visible ?? null;
	}, uuid);

/** core's own round-aware trigger-log read — the module polls exactly this */
const stampOf = (peer, id) =>
	peer.page.evaluate((i) => window.__stores.flowRuntime.nodeTriggerStamp(i), id);

/** a value node's published output (flowValues republishes ~6/s) */
const valueOf = (peer, id) =>
	peer.page.evaluate((i) => {
		let values;
		window.__stores.flowValues.subscribe((v) => (values = v))();
		return values?.[i];
	}, id);

const sharedVar = (peer, name) =>
	peer.page.evaluate((n) => window.__stores.gameState.gameVar(n, 0), name);
const myVar = (peer, name) =>
	peer.page.evaluate((n) => window.__stores.peerVars.myPeerVar(n, 0), name);

const setPlay = (peer, value) =>
	peer.page.evaluate((v) => window.__stores.isLocked.set(v), value);
const setState = (peer, state) =>
	peer.page.evaluate((s) => window.__stores.gameState.setGameState(s), state);

// --- page actions -----------------------------------------------------------------
/** a fresh replicated box with a distinct name, deselected afterwards */
async function makeBox(peer, name) {
	const uuid = await peer.page.evaluate(async () => {
		const s = window.__stores;
		s.commandsHandler.sceneCommand('/create box');
		await new Promise((r) => setTimeout(r, 1300));
		let group;
		s.objectsGroup.subscribe((v) => (group = v))();
		const last = group.children[group.children.length - 1];
		s.objectActions.deselectObject();
		return last?.uuid ?? null;
	});
	if (uuid) {
		await peer.page.evaluate(
			({ uuid, name }) => window.__stores.objectActions.renameObject(uuid, name),
			{ uuid, name }
		);
		await peer.page.waitForTimeout(400);
	}
	return uuid;
}

/** the module's click handler, through the app's own dispatch array (door-keypad's recipe) */
const clickObject = (peer, uuid) =>
	peer.page.evaluate((u) => {
		let group;
		window.__stores.objectsGroup.subscribe((v) => (group = v))();
		const object = group?.getObjectByProperty('uuid', u);
		if (!object) return 'no-object';
		window.__stores.moduleSDK.moduleClickHandlers.forEach((fn) => fn(object));
		return 'dispatched';
	}, uuid);

/** open the manager toolbox (the real opener core gives a module) */
async function openToolbox(peer) {
	await peer.page.evaluate(
		(id) => window.__stores.moduleToolboxes.openModuleToolbox(id),
		TOOLBOX
	);
	await peer.page.waitForTimeout(700);
}

/** THE RECIPE, driven through the module's own form + button */
async function runRecipe(peer, options) {
	const panel = peer.page.locator('.collectible-manager');
	await panel.locator('.cm-form input[type=text]').fill(options.variable);
	await panel.locator('.cm-form select').nth(0).selectOption(options.scope ?? 'shared');
	await panel.locator('.cm-form select').nth(1).selectOption(options.trigger ?? 'click');
	await panel.locator('.cm-form select').nth(2).selectOption(options.hide ?? 'on');
	if (options.radius != null) await panel.locator('.cm-form input.cm-in-radius').fill(String(options.radius));
	await panel.locator('.cm-form input.cm-in-respawn').fill(String(options.respawn ?? 0));
	await panel.getByRole('button', { name: 'Make collectible' }).click();
	await peer.page.waitForTimeout(1400);
}

/** select one object, run the recipe on it */
async function collectibleFrom(peer, uuid, options) {
	await peer.page.evaluate((u) => window.__stores.objectActions.selectObject(u), uuid);
	await peer.page.waitForTimeout(400);
	await runRecipe(peer, options);
	await peer.page.evaluate(() => window.__stores.objectActions.deselectObject());
	await peer.page.waitForTimeout(300);
	// the node whose selector names this object
	const nodes = await nodesOf(peer, 'collectible');
	const edges = await edgesOf(peer);
	const selectors = (await nodesOf(peer, 'objectselector'))
		.filter((n) => n.data.selected === uuid)
		.map((n) => n.id);
	const node = nodes.find((n) => edges.some((e) => e.source === n.id && selectors.includes(e.target)));
	return node ?? null;
}

h.run(async () => {
	const browser = await h.launch();
	const A = await h.setupPage(browser, 'A');
	const B = await h.setupPage(browser, 'B');
	await h.installModule(A, 'collectible');
	await h.installModule(B, 'collectible');
	await h.connect(A, B);
	for (const peer of [A, B])
		await peer.page.evaluate(() => {
			const s = window.__stores;
			s.clearGraphs();
			s.gameState.clearGameState();
			s.peerVars.clearPeerVars(false);
			s.isLocked.set(null);
		});
	await A.page.waitForTimeout(1000);
	await A.page.evaluate(() => {
		window.__stores.moduleSDK.initModules([
			{ id: 'ctest', name: 'collectible flight helper', version: '1.0.0', register(api) { window.__ct = api; } }
		]);
	});
	await openToolbox(A);
	// three rubies through the real form — rows for the manager to hold
	const rubies = [await makeBox(A, 'Ruby1'), await makeBox(A, 'Ruby2'), await makeBox(A, 'Ruby3')];
	await A.page.evaluate((uuids) => {
		for (const u of uuids) window.__stores.objectActions.selectObject(u, false, true);
	}, rubies);
	await A.page.waitForTimeout(400);
	await runRecipe(A, { variable: 'rubies', scope: 'shared', trigger: 'click', hide: 'on', respawn: 0 });
	await A.page.evaluate(() => window.__stores.objectActions.deselectObject());
	await A.page.waitForTimeout(700);
	const rubyNodes = async (peer) =>
		(await nodesOf(peer, 'collectible')).filter((n) => n.data.variable === 'rubies');
	h.check((await rubyNodes(A)).length === 3, 'premise: three rubies built through the form');
	const rubyYs = (await A.page.evaluate(() => window.__ct.flow.nodes('collectible').map((n) => n.y))).sort((a, b) => a - b);
	h.check(
		rubyYs.length === 3 && rubyYs[0] < rubyYs[1] && rubyYs[1] < rubyYs[2],
		'each pair asked freeRegion again, so they stack instead of landing on one another (' + JSON.stringify(rubyYs) + ')'
	);

	// =====================================================================
	// 11. R29 S4 — the manager listens instead of polling, the recipe lands on
	//     api.flow.freeRegion, the form carries the touch radius — and the module
	//     still runs on an app WITHOUT those seams (1.14.0-shaped)
	// =====================================================================
	const panel3 = A.page.locator('.collectible-manager');
	h.check(
		(await panel3.getAttribute('data-refresh')) === 'signal',
		'the manager redraws on core change signals (data-refresh=' + (await panel3.getAttribute('data-refresh')) + ')'
	);
	// IDLE: nothing changes for 2.5s, so a listening panel writes NOTHING to the DOM. The
	// 500ms poll rewrote the count text on every pass, which a MutationObserver sees.
	const idleMutations = await panel3.evaluate(
		(el) =>
			new Promise((resolve) => {
				let n = 0;
				const mo = new MutationObserver((list) => (n += list.length));
				mo.observe(el, { subtree: true, childList: true, characterData: true, attributes: true });
				setTimeout(() => {
					mo.disconnect();
					resolve(n);
				}, 2500);
			})
	);
	h.check(idleMutations === 0, 'an idle manager touches nothing — no poll (' + idleMutations + ' DOM mutations in 2.5s)');
	// ...and a PEER's edit still reaches it, through the signal
	const rubyTarget = (await rubyNodes(A))[0];
	await B.page.evaluate(
		(id) => {
			const n = window.__stores.allNodes().find((x) => x.id === id);
			window.__stores.nodesHandler.setNodeData(id, { respawn: 7 }, n?.__graph ?? 'scene');
		},
		rubyTarget.id
	);
	await h.eventually(
		() => panel3.locator('.cm-row[data-node="' + rubyTarget.id + '"] input.cm-respawn').inputValue(),
		(v) => v === '7',
		"a peer's edit redraws the row through the change signal (respawn 7)"
	);

	// THE RECIPE lands on freeRegion: a user node parked where the old fixed-row rule would
	// put the next pair must not be covered
	const nextRowY = await A.page.evaluate(() => {
		const count = window.__ct.flow.nodes('collectible').length;
		return 40 + count * 190;
	});
	await A.page.evaluate((y) => window.__ct.flow.addNodes({ nodes: [{ type: 'time', x: 60, y, data: {} }] }), nextRowY);
	const tiles = [await makeBox(A, 'Tile1'), await makeBox(A, 'Tile2')];
	await A.page.evaluate((uuids) => {
		window.__stores.objectActions.deselectObject();
		for (const u of uuids) window.__stores.objectActions.selectObject(u, false, true);
	}, tiles);
	await A.page.waitForTimeout(400);
	const picked = await A.page.evaluate(() => window.__ct.selectedUuids());
	h.check(picked.length === 2, 'premise: two tiles selected (' + picked.length + ')');
	// the TOUCH radius is on the form now, and refused (with the reason) under click
	const radiusIn = panel3.locator('.cm-form input.cm-in-radius');
	await panel3.locator('.cm-form select').nth(1).selectOption('click');
	h.check(await radiusIn.isDisabled(), 'the radius field is disabled under a click trigger');
	await runRecipe(A, { variable: 'tiles', scope: 'player', trigger: 'touch', hide: 'on', respawn: 0, radius: 3.5 });
	const tileNodes = (await nodesOf(A, 'collectible')).filter((n) => n.data.variable === 'tiles');
	h.check(
		tileNodes.length === 2 && tileNodes.every((n) => Number(n.data.radius) === 3.5 && n.data.trigger === 'touch'),
		'the form\'s touch radius reaches the nodes (' + JSON.stringify(tileNodes.map((n) => n.data.radius)) + ')'
	);
	const layout = await A.page.evaluate(() => {
		const ns = window.__ct.flow.nodes().filter((n) => n.graphId === 'scene');
		const hits = [];
		for (let i = 0; i < ns.length; i++)
			for (let j = i + 1; j < ns.length; j++) {
				const a = ns[i], b = ns[j];
				if (a.x < b.x + 150 && b.x < a.x + 150 && a.y < b.y + 150 && b.y < a.y + 150) hits.push([a.type, b.type, a.x, a.y]);
			}
		return { n: ns.length, hits };
	});
	h.check(layout.hits.length === 0, 'the new pairs land on free space — no card overlaps another (' + JSON.stringify(layout.hits.slice(0, 3)) + ', ' + layout.n + ' nodes)');

	// THE FALLBACK: the same module source, registered against an api with the R29 seams
	// REMOVED — what a user running core 1.14.0 hands it. It must still build and list.
	const D = await h.setupPage(browser, 'D');
	const source = require('fs').readFileSync(require('path').join(__dirname, '..', 'modules', 'collectible', 'module.js'), 'utf8');
	await D.page.evaluate(async (src) => {
		const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
		const mod = (await import(url)).default;
		await window.__stores.moduleSDK.initModules([
			{
				id: 'collectible',
				name: 'Collectibles (1.14 api)',
				version: mod.version,
				description: 'fallback probe',
				register(api) {
					const old = {
						...api,
						flow: { ...api.flow, onChange: undefined, freeRegion: undefined },
						game: { ...api.game, onChange: undefined },
						peerVars: { ...api.peerVars, onChange: undefined }
					};
					window.__oldApi = old;
					mod.register(old);
				}
			}
		]);
	}, source);
	await D.page.evaluate(() => window.__stores.moduleToolboxes.openModuleToolbox('mod-collectible-manager'));
	await D.page.waitForTimeout(800);
	const panelD = D.page.locator('.collectible-manager');
	h.check((await panelD.getAttribute('data-refresh')) === 'poll', 'on an app without onChange the manager falls back to its poll');
	const oldBoxes = [];
	for (const name of ['Old1', 'Old2']) oldBoxes.push(await makeBox(D, name));
	await D.page.evaluate((uuids) => {
		for (const u of uuids) window.__stores.objectActions.selectObject(u, false, true);
	}, oldBoxes);
	await D.page.waitForTimeout(400);
	await runRecipe(D, { variable: 'old', scope: 'shared', trigger: 'click', hide: 'on', respawn: 0 });
	const oldPos = await D.page.evaluate(() =>
		window.__stores
			.allNodes()
			.filter((n) => n.type === 'collectible')
			.map((n) => n.position.y)
			.sort((a, b) => a - b)
	);
	h.check(
		JSON.stringify(oldPos) === JSON.stringify([40, 230]),
		'and the recipe falls back to its fixed rows (' + JSON.stringify(oldPos) + ')'
	);
	await h.eventually(
		() => panelD.locator('.cm-row').count(),
		(n) => n === 2,
		'and the polled panel lists them'
	);

	await h.finish(browser);
});
