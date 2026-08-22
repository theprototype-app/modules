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
	await panel.locator('.cm-form input[type=number]').fill(String(options.respawn ?? 0));
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

	// modules do not travel over the wire: install on EVERY peer
	await h.installModule(A, 'collectible');
	await h.installModule(B, 'collectible');
	await h.connect(A, B);

	// a clean slate — earlier flights share this app instance
	for (const peer of [A, B])
		await peer.page.evaluate(() => {
			const s = window.__stores;
			s.clearGraphs();
			s.gameState.clearGameState();
			s.peerVars.clearPeerVars(false);
			s.isLocked.set(null);
		});
	await A.page.waitForTimeout(1000);

	// =====================================================================
	// 0. PREMISE — the module registered its two nodes and its toolbox
	// =====================================================================
	const registered = await A.page.evaluate(() => {
		const s = window.__stores;
		let groups;
		s.moduleSDK.moduleNodeGroups.subscribe((v) => (groups = v))();
		const items = (groups ?? []).flatMap((g) => (g.items ?? []).map((i) => i.type));
		let boxes;
		s.moduleToolboxes.moduleToolboxes.subscribe((v) => (boxes = v))();
		return {
			items,
			effect: !!s.moduleSDK.moduleEffects.collectible,
			value: !!s.moduleNodeIO.moduleValueNodes.collectiblecount,
			toolbox: (boxes ?? []).map((b) => b.id),
			debugLines: s.moduleHudKinds.moduleDebugLineTexts(),
			actions: s.hudActions.actionsForKind('text').map((a) => a.key)
		};
	});
	h.check(
		registered.items.includes('collectible') && registered.items.includes('collectiblecount'),
		'both nodes are in the palette (' + JSON.stringify(registered.items.filter((t) => t.startsWith('collectible'))) + ')'
	);
	h.check(registered.effect, 'the collectible EFFECT is registered');
	h.check(registered.value, 'the collectiblecount VALUE node is registered');
	h.check(registered.toolbox.includes(TOOLBOX), 'the manager toolbox is registered as ' + TOOLBOX);
	h.check(
		registered.actions.includes('mod-collectible-showleft'),
		'"Show collectibles left" is in the HUD action catalog, namespaced (' +
			JSON.stringify(registered.actions.filter((k) => k.startsWith('mod-'))) + ')'
	);
	h.check(
		registered.debugLines.length === 0,
		'the debug line stays SILENT with no collectibles in the scene (' + JSON.stringify(registered.debugLines) + ')'
	);

	// ---- 0b. HOW YOU GET IN -------------------------------------------------------
	// The toolbox opts OUT of the burger menu's Modules section (`sidebar: false`): it
	// belongs to a workflow, and the burger menu is the app's permanent chrome, which one
	// game mechanic has no standing claim on. So the ways in are the VIEWPORT menu and a
	// button on this module's own card — and the card button is clicked FOR REAL here,
	// because a card only exists for a genuinely installed module.
	await A.page.locator('#logo-menu').click();
	await A.page.waitForTimeout(600);
	const noSidebarRow = await A.page.evaluate(() => ({
		row: !!document.querySelector('#open-toolbox-mod-collectible-manager'),
		modulesSection: !!document.querySelector('#open-modules-manager')
	}));
	h.check(
		!noSidebarRow.row && noSidebarRow.modulesSection,
		'no permanent row in the burger menu (its Modules section is there, ours is not)'
	);
	await A.page.keyboard.press('Escape');
	await A.page.waitForTimeout(400);
	const viewportRow = await A.page.evaluate(() => {
		const t = window.__stores.moduleToolboxes;
		let list, open;
		t.moduleToolboxes.subscribe((v) => (list = v))();
		t.openToolboxes.subscribe((v) => (open = v))();
		return t.buildToolboxItems(list, open, 'menu').map((b) => b.id);
	});
	h.check(
		viewportRow.includes(TOOLBOX),
		'but the viewport menu still offers it (' + JSON.stringify(viewportRow) + ')'
	);
	// the real card button in the real manager
	await A.page.evaluate(() => window.__stores.modulesOpen.set(true));
	await A.page.waitForTimeout(800);
	await A.page.getByRole('tab', { name: /^User/ }).click();
	await A.page.waitForTimeout(400);
	await A.page.getByRole('button', { name: 'Open Collectibles' }).click();
	await A.page.waitForTimeout(900);
	const viaCard = await A.page.evaluate(() => {
		let open;
		window.__stores.modulesOpen.subscribe((v) => (open = v))();
		return { managerOpen: open, visible: !!document.querySelector('.collectible-manager') };
	});
	h.check(viaCard.visible, 'the "Open Collectibles" card button opens the toolbox for real');
	h.check(
		!viaCard.managerOpen,
		'and the manager dismisses itself, so the window is not left behind the dialog'
	);

	// =====================================================================
	// 1. THE RECIPE — one node pair per selected object, replicated, ONE undo
	// =====================================================================
	await openToolbox(A);
	h.check(
		await A.page.locator('.collectible-manager').isVisible(),
		'the toolbox mounted its DOM'
	);
	const gem1 = await makeBox(A, 'Gem1');
	const gem2 = await makeBox(A, 'Gem2');
	h.check(!!gem1 && !!gem2 && gem1 !== gem2, 'premise: two boxes to make collectible');

	// select BOTH and run the recipe once — it must build a pair per object
	await A.page.evaluate(
		({ a, b }) => {
			const s = window.__stores;
			s.objectActions.selectObject(a);
			s.objectActions.selectObject(b, false, true); // additive
		},
		{ a: gem1, b: gem2 }
	);
	await A.page.waitForTimeout(500);
	const selectedTwo = await A.page.evaluate(() => {
		let set;
		window.__stores.selectedObjects.subscribe((v) => (set = v))();
		return [...(set ?? [])].length;
	});
	h.check(selectedTwo === 2, 'premise: two objects selected (' + selectedTwo + ')');
	await runRecipe(A, { variable: 'gems', scope: 'shared', trigger: 'click', hide: 'on', respawn: 0 });
	await A.page.evaluate(() => window.__stores.objectActions.deselectObject());

	const built = await nodesOf(A, 'collectible');
	h.check(built.length === 2, 'the recipe built ONE collectible node per selected object (' + built.length + ')');
	h.check(
		built.every((n) => n.data.perRound === true && n.data.whilePlaying === true),
		'and stamped core\'s two flags on each (perRound + whilePlaying)'
	);
	h.check(
		built.every((n) => n.data.variable === 'gems' && n.data.hide === 'on' && n.data.scope === 'shared'),
		'with the form\'s params: ' + JSON.stringify(built[0]?.data ?? {})
	);
	const selectorsA = (await nodesOf(A, 'objectselector')).map((n) => n.data.selected);
	h.check(
		selectorsA.includes(gem1) && selectorsA.includes(gem2),
		'each pair carries an Object Selector naming its object'
	);
	const edgesA = await edgesOf(A);
	const pairEdges = built.map((n) => edgesA.find((e) => e.source === n.id)).filter(Boolean);
	h.check(
		pairEdges.length === 2 &&
			pairEdges.every((e) => e.id === 'e-' + e.source + '-' + e.target && e.targetHandle === null),
		'the edge ids take the editor\'s canonical unhandled shape — peer dedupe depends on it (' +
			JSON.stringify(pairEdges.map((e) => e.id.slice(0, 12) + '…')) + ')'
	);

	await h.eventually(
		() => nodesOf(B, 'collectible'),
		(nodes) => nodes.length === 2,
		'both collectible nodes replicated to the peer',
		12000
	);
	await h.eventually(
		() => edgesOf(B),
		(edges) => built.every((n) => edges.some((e) => e.source === n.id)),
		'and so did their wires'
	);

	// ONE undo entry per object built: assert the PROPERTY, never the stack DEPTH — a
	// correct gesture can leave the depth unchanged once recordEntry's LIMIT trim evicts
	// the oldest entry
	await A.page.evaluate(() => window.__stores.history.undo());
	await A.page.waitForTimeout(900);
	const afterUndo = await nodesOf(A, 'collectible');
	h.check(
		afterUndo.length === 1,
		'ONE undo removes one object\'s WHOLE pair — node and selector together (' + afterUndo.length + ' collectibles left)'
	);
	const selectorsAfter = (await nodesOf(A, 'objectselector')).length;
	h.check(selectorsAfter === 1, 'the selector went with it (' + selectorsAfter + ')');
	await A.page.evaluate(() => window.__stores.history.redo());
	await A.page.waitForTimeout(900);
	h.check((await nodesOf(A, 'collectible')).length === 2, 'and one redo restores it');
	await h.eventually(
		() => nodesOf(B, 'collectible'),
		(nodes) => nodes.length === 2,
		'the undo/redo round trip left the peer converged'
	);

	// running the recipe again on the same object must not double it up
	await A.page.evaluate((u) => window.__stores.objectActions.selectObject(u), gem1);
	await A.page.waitForTimeout(400);
	await runRecipe(A, { variable: 'gems', scope: 'shared', trigger: 'click', hide: 'on', respawn: 0 });
	await A.page.evaluate(() => window.__stores.objectActions.deselectObject());
	h.check(
		(await nodesOf(A, 'collectible')).length === 2,
		'an already-collectible object is SKIPPED rather than doubled'
	);

	// resolve a node by the object its selector names
	const resolveNode = async (uuid) => {
		const nodes = await nodesOf(A, 'collectible');
		const edges = await edgesOf(A);
		const selectors = (await nodesOf(A, 'objectselector'))
			.filter((n) => n.data.selected === uuid)
			.map((n) => n.id);
		return nodes.find((n) => edges.some((e) => e.source === n.id && selectors.includes(e.target))) ?? null;
	};
	const nodeGem1 = await resolveNode(gem1);
	h.check(!!nodeGem1, 'premise: the node driving Gem1 is identifiable from the graph alone');

	// =====================================================================
	// 2. SHARED CLICK-COLLECT — the object hides on BOTH peers, in a round
	// =====================================================================
	await setState(A, 'playing');
	await A.page.waitForTimeout(800);
	for (const peer of [A, B]) await setPlay(peer, true);
	await A.page.waitForTimeout(900); // let the guard see the nodes before the pulse

	h.check(
		(await visibleOf(A, gem1)) === true && (await visibleOf(B, gem1)) === true,
		'premise: Gem1 is visible on both screens before the collect'
	);
	h.check((await clickObject(A, gem1)) === 'dispatched', 'premise: the click reached the module handler');
	await h.eventually(() => visibleOf(A, gem1), (v) => v === false, 'the collector\'s gem hides');
	await h.eventually(() => visibleOf(B, gem1), (v) => v === false, 'and the SHARED pulse hides it on the peer too', 12000);
	h.check(
		(await visibleOf(A, gem2)) === true,
		'the other gem is untouched — one click, one node'
	);
	const gemsA = await sharedVar(A, 'gems');
	h.check(gemsA >= 1, 'the shared score banked at least the one pickup (' + gemsA + '; the add race can double it, which is core\'s)');

	// =====================================================================
	// 3. PER-PLAYER — the pulse never leaves the collector
	// =====================================================================
	// gem2 goes per-player through the manager's own inline edit (the replicated
	// nodedata path), which also exercises that control
	const nodeGem2 = await resolveNode(gem2);
	h.check(!!nodeGem2, 'premise: Gem2\'s node resolved');
	await setPlay(A, null); // the toolbox is hidden in play mode by design
	await A.page.waitForTimeout(400);
	await openToolbox(A);
	const rowScope = A.page
		.locator('.collectible-manager .cm-row')
		.filter({ hasText: 'Gem2' })
		.locator('select')
		.nth(1);
	await rowScope.selectOption('player');
	await A.page.waitForTimeout(1000);
	h.check(
		(await nodesOf(A, 'collectible')).find((n) => n.id === nodeGem2.id)?.data.scope === 'player',
		'the toolbox row flipped Gem2 to per-player'
	);
	await h.eventually(
		() => nodesOf(B, 'collectible'),
		(nodes) => nodes.find((n) => n.id === nodeGem2.id)?.data.scope === 'player',
		'and that inline edit replicated (api.flow.setNodeData)'
	);

	await setPlay(A, true);
	await A.page.waitForTimeout(700);
	await clickObject(A, gem2);
	await h.eventually(() => visibleOf(A, gem2), (v) => v === false, 'a per-player collect hides it for the collector');
	await A.page.waitForTimeout(2500);
	h.check(
		(await visibleOf(B, gem2)) === true,
		'and it stays VISIBLE on the peer — {replicate:false} in one bit'
	);
	h.check(
		(await stampOf(B, nodeGem2.id)) === null,
		'the peer\'s trigger log never saw the pulse at all'
	);
	await h.eventually(() => myVar(A, 'gems'), (v) => v >= 1, 'the collector banked into their OWN peer row');
	h.check((await myVar(B, 'gems')) === 0, 'the peer\'s own row stayed at 0 (' + (await myVar(B, 'gems')) + ')');

	// =====================================================================
	// 4. hide: 'off' — a counting CHECKPOINT that never vanishes
	// =====================================================================
	await setPlay(A, null);
	await A.page.waitForTimeout(400);
	const gate = await makeBox(A, 'Gate');
	await openToolbox(A);
	const gateNode = await collectibleFrom(A, gate, {
		variable: 'laps',
		scope: 'player',
		trigger: 'click',
		hide: 'off',
		respawn: 0
	});
	h.check(!!gateNode && gateNode.data.hide === 'off', 'a checkpoint node was built with hide: off');
	await setPlay(A, true);
	await A.page.waitForTimeout(900);
	await clickObject(A, gate);
	await h.eventually(() => myVar(A, 'laps'), (v) => v === 1, 'the checkpoint COUNTS (laps = 1)');
	await A.page.waitForTimeout(1500);
	h.check((await visibleOf(A, gate)) === true, 'and it never hides — that is the whole point of hide: off');
	h.check(
		!!(await stampOf(A, gateNode.id)),
		'while its trigger log still reads collected (so the count is not a fluke of the effect)'
	);

	// =====================================================================
	// 5. RESPAWN — it comes back, and a re-collect counts again
	// =====================================================================
	await setPlay(A, null);
	await A.page.waitForTimeout(400);
	const coin = await makeBox(A, 'Coin');
	await openToolbox(A);
	const coinNode = await collectibleFrom(A, coin, {
		variable: 'coins',
		scope: 'player',
		trigger: 'click',
		hide: 'on',
		respawn: 3
	});
	h.check(!!coinNode && Number(coinNode.data.respawn) === 3, 'a respawning node was built (3s)');
	await setPlay(A, true);
	await A.page.waitForTimeout(900);
	await clickObject(A, coin);
	await h.eventually(() => visibleOf(A, coin), (v) => v === false, 'the coin hides when collected');
	await h.eventually(() => myVar(A, 'coins'), (v) => v === 1, 'and counts once');
	await h.eventually(
		() => visibleOf(A, coin),
		(v) => v === true,
		'it comes BACK by itself once the pulse is older than the respawn',
		12000
	);
	await clickObject(A, coin);
	await h.eventually(
		() => myVar(A, 'coins'),
		(v) => v === 2,
		'and a re-collect counts again — a new stamp is a new pickup',
		12000
	);
	await h.eventually(() => visibleOf(A, coin), (v) => v === false, 'and it hides again');

	// =====================================================================
	// 6. perRound — back to the menu reads UN-collected, and the object returns
	// =====================================================================
	h.check(!!(await stampOf(A, nodeGem1.id)), 'premise: Gem1 still reads collected inside the round');
	await setState(A, 'menu');
	await A.page.waitForTimeout(1200);
	h.check(
		(await stampOf(A, nodeGem1.id)) === null,
		'in the menu a perRound node reads null — core retires the stamp, not us'
	);
	await h.eventually(
		() => visibleOf(A, gem1),
		(v) => v === true,
		'and the gem is handed back (whilePlaying dormancy + the restore loop)'
	);
	await h.eventually(() => visibleOf(B, gem1), (v) => v === true, 'on the peer as well');
	// manual visibility must WIN now — the reported 21-F2 bug, module edition
	await A.page.evaluate((u) => {
		let group;
		window.__stores.objectsGroup.subscribe((v) => (group = v))();
		const object = group?.getObjectByProperty('uuid', u);
		if (object) object.visible = false;
	}, gem1);
	await A.page.waitForTimeout(1200);
	h.check(
		(await visibleOf(A, gem1)) === false,
		'a manual hide outside the round STICKS (nothing re-asserts visible every frame)'
	);
	await A.page.evaluate((u) => {
		let group;
		window.__stores.objectsGroup.subscribe((v) => (group = v))();
		const object = group?.getObjectByProperty('uuid', u);
		if (object) object.visible = true;
	}, gem1);

	// =====================================================================
	// 7. THE COUNT NODE — module nodes AND a hand-built LEGACY chain
	// =====================================================================
	// a tiny inline module gives the flight api.flow.addNodes for CORE node types, so the
	// legacy chain is built exactly the way a user's graph holds it
	await A.page.evaluate(() => {
		window.__stores.moduleSDK.initModules([
			{
				id: 'ctest',
				name: 'collectible flight helper',
				version: '1.0.0',
				register(api) {
					window.__ct = api;
				}
			}
		]);
	});
	h.check(await A.page.evaluate(() => !!window.__ct), 'premise: the flight can write nodes through the SDK');

	const relic = await makeBox(A, 'Relic'); // driven by the legacy chain
	const shard = await makeBox(A, 'Shard'); // driven by a module node
	const legacy = await A.page.evaluate(
		(uuid) =>
			window.__ct.flow.addNodes({
				nodes: [
					{ type: 'onclick', x: 900, y: 40, data: {} },
					{ type: 'objectselector', x: 1120, y: 40, data: { selected: uuid } },
					{ type: 'once', x: 900, y: 220, data: {} },
					{ type: 'setvariable', x: 1120, y: 220, data: { name: 'trove', op: 'add', value: 1 } },
					{ type: 'latch', x: 900, y: 400, data: { perRound: true } }
				],
				edges: [
					{ from: 0, to: 1 },
					{ from: 0, to: 2, handle: 'trigger' },
					{ from: 2, to: 3, handle: 'trigger' },
					{ from: 0, to: 4, handle: 'set' }
				]
			}),
		relic
	);
	h.check(legacy.length === 5, 'premise: a five-node legacy chain built (' + legacy.length + ')');
	await A.page.waitForTimeout(900);
	// one MODULE collectible counting into the same variable
	const moduleTrove = await A.page.evaluate(
		(uuid) =>
			window.__ct.flow.addNodes({
				nodes: [
					{
						type: 'collectible',
						x: 900,
						y: 600,
						data: {
							variable: 'trove',
							scope: 'player',
							trigger: 'click',
							hide: 'on',
							respawn: 0,
							perRound: true,
							whilePlaying: true
						}
					},
					{ type: 'objectselector', x: 1120, y: 600, data: { selected: uuid } }
				],
				edges: [{ from: 0, to: 1 }]
			}),
		shard
	);
	h.check(moduleTrove.length === 2, 'premise: a module collectible counting into the same variable');
	// three readouts, so all three readings can be sampled at once
	const readers = await A.page.evaluate(() =>
		window.__ct.flow.addNodes({
			nodes: [
				{ type: 'collectiblecount', x: 1400, y: 40, data: { variable: 'trove', read: 'total' } },
				{ type: 'collectiblecount', x: 1400, y: 200, data: { variable: 'trove', read: 'collected' } },
				{ type: 'collectiblecount', x: 1400, y: 360, data: { variable: 'trove', read: 'left' } }
			]
		})
	);
	await A.page.waitForTimeout(1200);
	await h.eventually(
		() => valueOf(A, readers[0]),
		(v) => v === 2,
		'total = 2: the count node sees BOTH shapes — one module node and one legacy chain'
	);
	h.check((await valueOf(A, readers[1])) === 0, 'collected = 0 before anything is picked up');
	h.check((await valueOf(A, readers[2])) === 2, 'left = 2, so collected + left === total by construction');

	// collect the LEGACY one through core's own event path
	await setState(A, 'playing');
	await A.page.waitForTimeout(900);
	await setPlay(A, true);
	await A.page.waitForTimeout(700);
	await A.page.evaluate((u) => window.__stores.flowRuntime.fireObjectClick(u), relic);
	await h.eventually(
		() => valueOf(A, readers[1]),
		(v) => v === 1,
		'a legacy Latch reads collected through api.flow.nodeValue — core\'s answer, not a second one',
		12000
	);
	h.check((await valueOf(A, readers[2])) === 1, 'and left fell to 1');
	// then the module one
	await clickObject(A, shard);
	await h.eventually(
		() => valueOf(A, readers[1]),
		(v) => v === 2,
		'collecting the module node too brings collected to 2 — one number over two shapes',
		12000
	);
	await h.eventually(
		() => valueOf(A, readers[2]),
		(v) => v === 0,
		'left = 0: everything in "trove" is accounted for'
	);

	// the debug line now has something to say, and says it for every variable in use
	const debug = await A.page.evaluate(() => window.__stores.moduleHudKinds.moduleDebugLineTexts());
	h.check(
		debug.some((line) => line.includes('collectibles (trove): 2 collected, 0 left of 2')),
		'the debug line reports the same numbers (' + JSON.stringify(debug) + ')'
	);
	h.check(
		debug.some((line) => line.includes('gems') && line.includes('laps') && line.includes('coins')),
		'and covers every variable in the scene'
	);

	// =====================================================================
	// 8. THE MANAGER — live rows, and a row click selects the object
	// =====================================================================
	await setPlay(A, null);
	await A.page.waitForTimeout(500);
	await openToolbox(A);
	const panel = A.page.locator('.collectible-manager');
	const rowCount = await panel.locator('.cm-row').count();
	h.check(rowCount === 5, 'the manager lists every collectible in the scene (' + rowCount + ' rows)');
	const heads = await panel.locator('.cm-head').allInnerTexts();
	h.check(
		heads.some((t) => /^trove — \d+ collected, \d+ left of 2$/.test(t.trim())),
		'grouped by variable with live counts (' + JSON.stringify(heads) + ')'
	);
	const troveHead = heads.find((t) => t.startsWith('trove'));
	h.check(
		troveHead?.includes('2 collected, 0 left of 2'),
		'and the header agrees with the count node (' + troveHead + ')'
	);
	const gateRow = panel.locator('.cm-row').filter({ hasText: 'Gate' });
	h.check(await gateRow.count() === 1, 'a row is named after its target object');
	await A.page.evaluate(() => window.__stores.objectActions.deselectObject());
	await A.page.waitForTimeout(300);
	await gateRow.locator('.cm-name').click();
	await A.page.waitForTimeout(600);
	const selected = await A.page.evaluate(() => {
		let set;
		window.__stores.selectedObjects.subscribe((v) => (set = v))();
		return [...(set ?? [])];
	});
	h.check(selected.includes(gate), 'clicking a row SELECTS its object (' + JSON.stringify(selected.length) + ' selected)');

	// =====================================================================
	// 9. A LATE JOINER converges — and does NOT bank the history it missed
	// =====================================================================
	const troveBefore = await sharedVar(A, 'gems');
	const C = await h.setupPage(browser, 'C');
	await h.installModule(C, 'collectible'); // a peer without the module cannot evaluate the node
	await h.connect(C, A);
	await C.page.waitForTimeout(3000);
	await h.eventually(
		() => nodesOf(C, 'collectible'),
		(nodes) => nodes.length === 5,
		'the late joiner holds every collectible node',
		20000
	);
	await h.eventually(
		() => valueOf(C, readers[0]),
		(v) => v === 2,
		'and its count node agrees on the total with nothing sent about counting',
		15000
	);
	h.check(
		(await sharedVar(C, 'gems')) === troveBefore,
		'THE SEED RULE: the joiner did not bank the pulses it never witnessed (' +
			(await sharedVar(C, 'gems')) + ' vs ' + troveBefore + ')'
	);
	// THE DOCUMENTED LIMIT, and it is CORE's, not this module's: the trigger log has no
	// full-state reply in the handshake (`getnodes`, `getanim`, `gethuds`… but nothing for
	// flowTriggers), so a peer joining after a pickup cannot know it happened. The 21-F
	// recipe stood on the same stamps and behaved identically. Asserted rather than
	// skipped, so a core fix flips this check LOUDLY instead of silently.
	h.check(
		(await valueOf(C, readers[1])) === 0,
		'a late joiner reads 0 collected — past pulses are not in the handshake (DEVX #18), ' +
			'which is the pre-existing behaviour of the recipe this module replaces'
	);

	// FORWARD from here it converges: a pulse minted after the join reaches everyone
	for (const peer of [A, C]) await setPlay(peer, true);
	await A.page.waitForTimeout(1000);
	h.check(
		(await visibleOf(C, gem1)) === true,
		'premise: Gem1 is visible for the joiner (it never heard about the old collect)'
	);
	await clickObject(A, gem1);
	await h.eventually(
		() => visibleOf(C, gem1),
		(v) => v === false,
		'a SHARED collect made after the join hides the gem on the late joiner too',
		12000
	);
	await h.eventually(
		() => valueOf(C, readers[0]),
		(v) => v === 2,
		'and its trove total is unmoved by a gems pickup — the variables do not bleed'
	);

	await h.finish(browser);
});
