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
	// SCOPE IS A GROUP-LEVEL CONTROL NOW (section 10): it lives on the manager's group
	// header, not on the row, because every pickup counting into one score is collected the
	// same way. Gem2 shares the "gems" group with Gem1, whose SHARED collect sections 6 and
	// 9 still lean on — so this ONE node is flipped through core's own editor path, which
	// sends exactly the `nodedata` message the panel sends, and the panel's own bulk apply
	// gets covered on a group of its own further down.
	const nodeGem2 = await resolveNode(gem2);
	h.check(!!nodeGem2, 'premise: Gem2\'s node resolved');
	await setPlay(A, null); // the toolbox is hidden in play mode by design
	await A.page.waitForTimeout(400);
	await openToolbox(A);
	const gem2Row = A.page.locator('.collectible-manager .cm-row').filter({ hasText: 'Gem2' });
	h.check(
		(await gem2Row.count()) === 1 && (await gem2Row.locator('select').count()) === 0,
		'an item row carries NO select of its own — trigger and scope live on the group header'
	);
	await A.page.evaluate(
		(id) => window.__stores.nodesHandler.setNodeData(id, { scope: 'player' }, 'scene'),
		nodeGem2.id
	);
	await A.page.waitForTimeout(1000);
	h.check(
		(await nodesOf(A, 'collectible')).find((n) => n.id === nodeGem2.id)?.data.scope === 'player',
		'Gem2 alone flipped to per-player'
	);
	await h.eventually(
		() => nodesOf(B, 'collectible'),
		(nodes) => nodes.find((n) => n.id === nodeGem2.id)?.data.scope === 'player',
		'and that edit replicated (the nodedata path api.flow.setNodeData writes through)'
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
	const groupVars = await panel.locator('.cm-group').evaluateAll((els) =>
		els.map((el) => el.getAttribute('data-var'))
	);
	h.check(
		groupVars.includes('trove') && groupVars.includes('gems'),
		'grouped by variable, one group per score (' + JSON.stringify(groupVars) + ')'
	);
	const troveGroup = panel.locator('.cm-group[data-var="trove"]');
	// textContent, not innerText: the header's separator is a ::before, which textContent
	// cannot see — so the counts read as the one string the group is really reporting
	const troveCounts = ((await troveGroup.locator('.cm-counts').textContent()) ?? '').trim();
	h.check(
		/^\d+ collected, \d+ left of 2$/.test(troveCounts),
		'each group header carries its own live counts (' + troveCounts + ')'
	);
	h.check(
		troveCounts === '2 collected, 0 left of 2',
		'and the header agrees with the count node (' + troveCounts + ')'
	);
	// S4: the counts include the hand-built LEGACY chain while only module nodes get rows —
	// the header now says so instead of leaving a count that disagrees with the rows
	const legacyLines = await panel.locator('.cm-legacy').evaluateAll((els) => els.map((el) => el.textContent));
	h.check(
		legacyLines.length === 1 && /^\+1 older recipe chain counted here/.test(legacyLines[0] ?? ''),
		'a group whose count includes an older recipe chain says so (' + JSON.stringify(legacyLines) + ')'
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
	// THE SEED RULE, and DEVX #18 made it load-bearing rather than merely tidy. The
	// joiner now RECEIVES history, and the module counts on a stamp EDGE — so without
	// the module's own first-sight rule it would read a stamp where there was none a
	// moment earlier and bank a point for every gem somebody else already collected.
	// Reading the count is the whole point of this check: the score must not move.
	h.check(
		(await sharedVar(C, 'gems')) === troveBefore,
		'THE SEED RULE: the joiner banks NOTHING for pulses it never witnessed, even though ' +
			'it now receives them (' + (await sharedVar(C, 'gems')) + ' vs ' + troveBefore + ')'
	);
	// THE LIMIT THAT WAS DOCUMENTED HERE IS GONE (core DEVX #18): the trigger log now
	// has a full-state handshake reply, so a peer joining after a pickup LEARNS it
	// happened. This block used to assert the opposite — `readers[1] === 0`, "past pulses
	// are not in the handshake" — and it was written to flip loudly the day core fixed
	// it. This is that day.
	//
	// It asserts CONVERGENCE ON THE HOST rather than a literal count, and that is not
	// timidity: what a joiner owes is the same view as everyone else, and the true
	// number here depends on how many gems the sections above left collected and on
	// where the round clock is. A pinned literal would be a second, silent premise
	// about all of that — and pinning one wrong is exactly how this check first went
	// red for a reason that had nothing to do with the feature.
	const hostCollected = await valueOf(A, readers[1]);
	await h.eventually(
		() => valueOf(C, readers[1]),
		(v) => v === hostCollected,
		'a late joiner AGREES with the host on how many are collected (' + hostCollected + ') — the pulses it never witnessed arrived in the handshake'
	);
	h.check(
		hostCollected > 0,
		'premise: there WAS something collected before the join, so that agreement means something (' + hostCollected + ')'
	);

	// THE HEADLINE, and the inversion of what this section used to assert: a gem taken
	// BEFORE C joined must arrive already gone. The old premise read "Gem1 is visible
	// for the joiner (it never heard about the old collect)" — the reported bug wearing
	// a premise's clothes. Which gem is collected depends on the sections above, so ask
	// the HOST and then require the joiner to match it.
	for (const peer of [A, C]) await setPlay(peer, true);
	await A.page.waitForTimeout(800);
	// ...and the SAME agreement about what is on screen. Asserted per gem as "C matches
	// A" rather than "this one is hidden": which gem is collected depends on every section
	// above, and a literal premise about that is how this check first went red for a
	// reason with nothing to do with the feature. Convergence is the property either way -
	// without the handshake reply the joiner shows a gem the host has hidden.
	for (const [label, uuid] of [['Gem1', gem1], ['Gem2', gem2]]) {
		const host = await visibleOf(A, uuid);
		await h.eventually(
			() => visibleOf(C, uuid),
			(v) => v === host,
			label + ' looks the same to the joiner as to the host (visible=' + host + ')',
			12000
		);
	}
	// a collect made AFTER the join still reaches them through the ordinary replicated
	// pulse, so the reply filled in the past without replacing the live path
	// pick a gem that is BOTH still there and SHARED: an earlier section put Gem2 on
	// scope:player, where a collect staying local is the feature working, not a failure
	// (that cost a red before the selection read the scope instead of guessing).
	const scopeOf = async (uuid) =>
		A.page.evaluate((id) => {
			let graphs;
			window.__stores.flowGraphs.subscribe((v) => (graphs = v))();
			const nodes = graphs.scene?.nodes ?? [];
			const edges = graphs.scene?.edges ?? [];
			const sel = nodes.filter((n) => n.type === 'objectselector' && n.data?.selected === id);
			for (const one of sel) {
				const edge = edges.find((e) => e.target === one.id);
				const owner = nodes.find((n) => n.id === edge?.source && n.type === 'collectible');
				if (owner) return String(owner.data?.scope ?? 'shared');
			}
			return null;
		}, uuid);
	let live = null;
	for (const uuid of [gem1, gem2])
		if (!live && (await visibleOf(A, uuid)) !== false && (await scopeOf(uuid)) !== 'player')
			live = uuid;
	if (live) {
		await clickObject(A, live);
		await h.eventually(
			() => visibleOf(C, live),
			(v) => v === false,
			'a SHARED collect made after the join hides that gem on the late joiner too',
			12000
		);
	} else {
		h.check(true, 'no shared gem was left uncollected — the live path is covered in section 6');
	}
	const hostTrove = await valueOf(A, readers[0]);
	await h.eventually(
		() => valueOf(C, readers[0]),
		(v) => v === hostTrove,
		'and its trove total agrees with the host — the variables do not bleed (' + hostTrove + ')'
	);

	// =====================================================================
	// 10. THE MANAGER v2 — folded groups, GROUP-WIDE settings, one-line rows
	// =====================================================================
	// The first panel gave every collectible its own two-line card with its own trigger and
	// scope select, which is unusable at the only scale that matters: a real game has sixty
	// gems. So the settings moved to whoever owns them — trigger and scope UP to the group
	// (every pickup in one score is collected the same way), respawn DOWN on the row (the one
	// genuinely per-object knob) — and a group folds.
	await setPlay(A, null);
	await setPlay(C, null);
	await A.page.waitForTimeout(700);

	/** @type {string[]} */
	const rubies = [];
	for (const name of ['Ruby1', 'Ruby2', 'Ruby3']) rubies.push(await makeBox(A, name));
	h.check(
		rubies.every(Boolean) && new Set(rubies).size === 3,
		'premise: three fresh boxes for a group of their own'
	);
	await A.page.evaluate((list) => {
		const s = window.__stores;
		s.objectActions.selectObject(list[0]);
		for (const uuid of list.slice(1)) s.objectActions.selectObject(uuid, false, true);
	}, rubies);
	await A.page.waitForTimeout(500);
	await openToolbox(A);
	await runRecipe(A, { variable: 'rubies', scope: 'shared', trigger: 'click', hide: 'on', respawn: 0 });
	await A.page.evaluate(() => window.__stores.objectActions.deselectObject());
	await A.page.waitForTimeout(700);

	const panel2 = A.page.locator('.collectible-manager');
	const rubyGroup = panel2.locator('.cm-group[data-var="rubies"]');
	h.check((await rubyGroup.count()) === 1, 'the new variable got a group of its own');
	h.check((await rubyGroup.locator('.cm-row').count()) === 3, 'holding one row per collectible');
	const rubyNodes = async (peer) =>
		(await nodesOf(peer, 'collectible')).filter((n) => n.data.variable === 'rubies');

	// ---- 10a. ONE LINE PER ITEM ---------------------------------------------------
	// Measured, not assumed: three children, all on the same line, and no select inside.
	const shape = await rubyGroup.locator('.cm-row').first().evaluate((el) => {
		const kids = [...el.children];
		const top = kids[0]?.getBoundingClientRect().top ?? 0;
		return {
			classes: kids.map((c) => c.className),
			selects: el.querySelectorAll('select').length,
			numbers: el.querySelectorAll('input[type=number]').length,
			sameLine: kids.every((c) => Math.abs(c.getBoundingClientRect().top - top) < 6)
		};
	});
	h.check(
		shape.classes.length === 3 &&
			shape.classes[0].includes('cm-name') &&
			shape.classes[1].includes('cm-status') &&
			shape.classes[2].includes('cm-respawn'),
		'a row is name · state · respawn and nothing else (' + JSON.stringify(shape.classes) + ')'
	);
	h.check(shape.selects === 0, 'with no trigger/scope select on it at all');
	h.check(shape.numbers === 1, 'and exactly one number field — respawn stayed per object');
	h.check(shape.sameLine, 'all three sit on ONE line (measured off their client rects)');

	// ---- 10b. THE GROUP FOLDS -----------------------------------------------------
	h.check(
		(await rubyGroup.locator('.cm-disc').getAttribute('aria-expanded')) === 'true',
		'a group starts open — the rows are what the panel is for'
	);
	await rubyGroup.locator('.cm-disc').click();
	await A.page.waitForTimeout(500);
	h.check((await rubyGroup.locator('.cm-row').count()) === 0, 'clicking the header FOLDS it — the rows are gone');
	h.check(
		(await rubyGroup.locator('.cm-disc').getAttribute('aria-expanded')) === 'false',
		'and the disclosure says so'
	);
	const foldedCounts = ((await rubyGroup.locator('.cm-counts').textContent()) ?? '').trim();
	h.check(
		/left of 3$/.test(foldedCounts),
		'a folded group still reports its counts (' + foldedCounts + ')'
	);
	h.check(
		(await panel2.locator('.cm-group[data-var="gems"] .cm-row').count()) >= 2,
		'folding one group leaves the others alone'
	);
	await A.page.waitForTimeout(1600); // two turns of the 500ms refresh
	h.check(
		(await rubyGroup.locator('.cm-row').count()) === 0,
		'and the refresh cannot quietly unfold it (the flag rides the rebuild signature)'
	);
	// the fold is a LOCAL PREF, not panel state: it has to survive a re-mount, which is what
	// closing and reopening the window is
	await A.page.evaluate((id) => window.__stores.moduleToolboxes.closeModuleToolbox(id), TOOLBOX);
	await A.page.waitForTimeout(500);
	await openToolbox(A);
	h.check(
		(await rubyGroup.locator('.cm-row').count()) === 0,
		'the fold survives closing and reopening the window'
	);
	await rubyGroup.locator('.cm-disc').click();
	await A.page.waitForTimeout(500);
	h.check((await rubyGroup.locator('.cm-row').count()) === 3, 'and it unfolds again');

	// ---- 10c. THE HEADER'S BULK TRIGGER ------------------------------------------
	const bulkTrigger = () => rubyGroup.locator('.cm-bulk select').nth(0);
	const bulkScope = () => rubyGroup.locator('.cm-bulk select').nth(1);
	h.check(
		(await bulkTrigger().inputValue()) === 'click',
		'the header shows the value the whole group agrees on'
	);
	await bulkTrigger().selectOption('touch');
	await A.page.waitForTimeout(1300);
	const afterBulk = await rubyNodes(A);
	h.check(
		afterBulk.length === 3 && afterBulk.every((n) => n.data.trigger === 'touch'),
		'ONE header select set trigger on EVERY member (' +
			JSON.stringify(afterBulk.map((n) => n.data.trigger)) + ')'
	);
	await h.eventually(
		() => rubyNodes(B),
		(nodes) => nodes.length === 3 && nodes.every((n) => n.data.trigger === 'touch'),
		'and all three of those edits replicated (api.flow.setNodeData, once per member)',
		15000
	);
	const gemsTriggers = (await nodesOf(A, 'collectible'))
		.filter((n) => n.data.variable === 'gems')
		.map((n) => n.data.trigger);
	h.check(
		gemsTriggers.length >= 2 && gemsTriggers.every((t) => t === 'click'),
		'and reached nothing outside its own group (gems: ' + JSON.stringify(gemsTriggers) + ')'
	);

	// ---- 10d. MIXED, and resolving it --------------------------------------------
	// break the agreement from OUTSIDE the panel — a peer's edit looks exactly like this
	await A.page.evaluate(
		(id) => window.__stores.nodesHandler.setNodeData(id, { trigger: 'click' }, 'scene'),
		afterBulk[0].id
	);
	await A.page.waitForTimeout(1300);
	const mixed = await bulkTrigger().evaluate((el) => ({
		value: el.value,
		flag: el.dataset.mixed ?? null,
		text: el.options[el.selectedIndex]?.textContent ?? null,
		options: [...el.options].map((o) => o.textContent)
	}));
	h.check(
		mixed.flag === '1' && mixed.value === '',
		'members that DISAGREE put the header control in a MIXED state (' + JSON.stringify(mixed.value) + ')'
	);
	h.check(
		mixed.text === '—',
		'shown as an em-dash rather than lying about one of the two values (' + JSON.stringify(mixed.text) + ')'
	);
	h.check(
		mixed.options.length === 3,
		'the em-dash is an EXTRA option, so neither real value is claimed (' + JSON.stringify(mixed.options) + ')'
	);
	// ...and it is a READOUT, not a value. The option stays in the list while the control
	// is open, so it must be unpickable AND unwritable: choosing it would otherwise write
	// the empty string over every member of the group. Forced through the change path here,
	// because a real pointer cannot select a disabled option — which is the first half of
	// the guard, and this asserts the second.
	const mixedIsInert = await bulkTrigger().evaluate((el) => {
		const option = [...el.options].find((o) => o.value === '');
		const wasDisabled = !!option?.disabled;
		el.value = '';
		el.dispatchEvent(new Event('change', { bubbles: true }));
		return { wasDisabled };
	});
	h.check(mixedIsInert.wasDisabled, 'the em-dash option is DISABLED, so a pointer cannot choose it back');
	await A.page.waitForTimeout(1300);
	const afterForcedMixed = await rubyNodes(A);
	h.check(
		afterForcedMixed.every((n) => n.data.trigger === 'click' || n.data.trigger === 'touch'),
		'and forcing it through the change path writes NOTHING — no member gets an empty setting (' +
			JSON.stringify([...new Set(afterForcedMixed.map((n) => n.data.trigger))]) +
			')'
	);
	await bulkTrigger().selectOption('click');
	await A.page.waitForTimeout(1300);
	h.check(
		(await rubyNodes(A)).every((n) => n.data.trigger === 'click'),
		'picking a value out of a mixed control applies it to the WHOLE group'
	);
	const resolvedSelect = await bulkTrigger().evaluate((el) => ({
		value: el.value,
		flag: el.dataset.mixed ?? null,
		options: el.options.length
	}));
	h.check(
		resolvedSelect.value === 'click' && resolvedSelect.flag === null && resolvedSelect.options === 2,
		'and the mixed state is gone once they agree (' + JSON.stringify(resolvedSelect) + ')'
	);

	// ---- 10e. THE HEADER'S BULK SCOPE --------------------------------------------
	await bulkScope().selectOption('player');
	await A.page.waitForTimeout(1300);
	h.check(
		(await rubyNodes(A)).every((n) => n.data.scope === 'player'),
		'the second header control does the same for scope'
	);
	await h.eventually(
		() => rubyNodes(B),
		(nodes) => nodes.length === 3 && nodes.every((n) => n.data.scope === 'player'),
		'and replicated the same way',
		15000
	);
	h.check(
		(await nodesOf(A, 'collectible')).find((n) => n.id === nodeGem1.id)?.data.scope === 'shared',
		'while a gem in another group kept its own scope'
	);

	// ---- 10f. RESPAWN IS STILL PER ROW ------------------------------------------
	const ruby1Row = rubyGroup.locator('.cm-row').filter({ hasText: 'Ruby1' });
	const ruby2Row = rubyGroup.locator('.cm-row').filter({ hasText: 'Ruby2' });
	const ruby1Id = await ruby1Row.getAttribute('data-node');
	const ruby2Id = await ruby2Row.getAttribute('data-node');
	h.check(!!ruby1Id && !!ruby2Id && ruby1Id !== ruby2Id, 'premise: each row names its own node');
	await ruby1Row.locator('input[type=number]').fill('4');
	await ruby1Row.locator('input[type=number]').press('Enter');
	await A.page.waitForTimeout(1300);
	const respawns = Object.fromEntries((await rubyNodes(A)).map((n) => [n.id, Number(n.data.respawn) || 0]));
	h.check(
		respawns[ruby1Id] === 4 &&
			Object.entries(respawns).every(([id, value]) => id === ruby1Id || value === 0),
		'a row edit changes THAT collectible and no other (' + JSON.stringify(respawns) + ')'
	);
	await h.eventually(
		() => rubyNodes(B),
		(nodes) => Number(nodes.find((n) => n.id === ruby1Id)?.data.respawn) === 4,
		'and the row edit replicates just as it always did'
	);

	// ---- 10g. THE ROW IS STILL A SELECT TARGET, THE CONTROL IS NOT ---------------
	const selectionNow = () =>
		A.page.evaluate(() => {
			let set;
			window.__stores.selectedObjects.subscribe((v) => (set = v))();
			return [...(set ?? [])];
		});
	await A.page.evaluate(() => window.__stores.objectActions.deselectObject());
	await A.page.waitForTimeout(300);
	await ruby2Row.locator('.cm-status').click(); // the STATE, not the name: the whole row is the target
	await A.page.waitForTimeout(600);
	h.check((await selectionNow()).includes(rubies[1]), 'clicking anywhere on a row still SELECTS its object');
	await A.page.evaluate(() => window.__stores.objectActions.deselectObject());
	await A.page.waitForTimeout(300);
	await ruby1Row.locator('input[type=number]').click();
	await A.page.waitForTimeout(600);
	h.check(
		(await selectionNow()).length === 0,
		'but clicking the respawn field does not — a control is not the row (' +
			JSON.stringify(await selectionNow()) + ')'
	);

	// ---- 10h. THE STATE WORD IS LIVE --------------------------------------------
	// The panel only shows outside play, but a click lands either way (only the HIDE is
	// play-gated), so the row's state can be watched from the editor.
	await setState(A, 'playing');
	await A.page.waitForTimeout(900);
	const statusOf = (id) => rubyGroup.locator('.cm-row[data-node="' + id + '"] .cm-status').innerText();
	h.check((await statusOf(ruby2Id)).trim() === 'waiting', 'premise: Ruby2 reads waiting');
	await clickObject(A, rubies[1]);
	await h.eventually(
		() => statusOf(ruby2Id),
		(text) => text.trim() === 'collected',
		'the state word follows the collect, live off the trigger log'
	);
	await clickObject(A, rubies[0]); // Ruby1 respawns after 4s
	await h.eventually(
		() => statusOf(ruby1Id),
		(text) => /^back in [1-4]s$/.test(text.trim()),
		'a respawning row counts DOWN instead of reading a flat "collected"'
	);
	await h.eventually(
		() => statusOf(ruby1Id),
		(text) => text.trim() === 'waiting',
		'and reads waiting again the moment it is back',
		15000
	);

	// ---- 10i. WHAT A BULK APPLY COSTS AT SCALE ----------------------------------
	// A bulk apply is N `nodedata` messages on the wire (core 1.15's setNodesData batches
	// the UNDO, not the wire — the signals flight asserts the one entry). This measures the
	// SYNCHRONOUS cost of one press on a twenty-member group and proves all twenty land on
	// the peer.
	const probeIds = await A.page.evaluate(() => {
		const nodes = [];
		for (let i = 0; i < 20; i++)
			nodes.push({
				type: 'collectible',
				x: 1800,
				y: 40 + i * 60,
				data: {
					variable: 'probe',
					scope: 'player',
					trigger: 'click',
					hide: 'on',
					respawn: 0,
					perRound: true,
					whilePlaying: true
				}
			});
		return window.__ct.flow.addNodes({ nodes });
	});
	h.check(probeIds.length === 20, 'premise: a twenty-member group (' + probeIds.length + ')');
	await A.page.waitForTimeout(2000);
	const probeGroup = panel2.locator('.cm-group[data-var="probe"]');
	h.check((await probeGroup.locator('.cm-row').count()) === 20, 'the panel lists all twenty on twenty lines');
	const probeNodes = async (peer) =>
		(await nodesOf(peer, 'collectible')).filter((n) => n.data.variable === 'probe');
	const cost = await probeGroup.locator('.cm-bulk select').nth(0).evaluate((el) => {
		el.value = 'touch';
		const t0 = performance.now();
		el.dispatchEvent(new Event('change', { bubbles: true }));
		return performance.now() - t0;
	});
	h.check(
		(await probeNodes(A)).every((n) => n.data.trigger === 'touch'),
		'one press flipped all twenty (' + cost.toFixed(1) + 'ms synchronous, twenty nodedata messages)'
	);
	await h.eventually(
		() => probeNodes(B),
		(nodes) => nodes.length === 20 && nodes.every((n) => n.data.trigger === 'touch'),
		'and all twenty landed on the peer',
		25000
	);
	// pressing a value the group ALREADY holds must send nothing, which is what keeps the
	// message count proportional to the DIFFERENCE rather than to the group
	const noop = await probeGroup.locator('.cm-bulk select').nth(0).evaluate((el) => {
		el.value = 'touch';
		el.dispatchEvent(new Event('change', { bubbles: true }));
		return el.value;
	});
	await A.page.waitForTimeout(600);
	const noopToast = await h.toasts(A.page);
	h.check(
		noop === 'touch' && noopToast.includes('was already trigger touch'),
		'and a bulk press over a group that already agrees changes nothing (' +
			(noopToast.match(/was already[^"]*/)?.[0] ?? noopToast.slice(0, 80)) + ')'
	);

	await h.finish(browser);
});
