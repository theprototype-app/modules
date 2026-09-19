// health test-flight — the REAL zip on two peers (and a third that joins late), driving
// the module's toolbox to build the chains and the app's own click dispatch to hit.
//
// THE CLAIM UNDER TEST is roadmap-29 fork 2: an object's health is DERIVED from damage
// pulses counted by core's Counter (one trigger-log entry per pulse, applied once per
// peer, the count riding the DEVX #18 handshake), so damage from two peers converges to
// ONE number on every peer including a late joiner, with no authority. The counterfactual
// is the shared-add model (read-modify-write on a game variable), shown losing a hit.
// A PLAYER's points ride their own peerVars row (one writer), so they are per-player.
//
//   APP_URL=https://theprototype.app:5215/ npm test -- health
const h = require('./helpers.cjs');

const TOOLBOX = 'mod-health-manager';

// --- page reads -------------------------------------------------------------------
const snapshot = (peer) => peer.page.evaluate(() => window.__health.snapshot());
const healthOf = async (peer, uuid) => (await snapshot(peer)).find((s) => s.uuid === uuid) ?? null;
const playerOf = async (peer, name) => (await snapshot(peer)).find((s) => s.scope === 'player' && s.name === name) ?? null;
const nodesOf = (peer, type) =>
	peer.page.evaluate(
		(t) =>
			window.__stores
				.allNodes()
				.filter((n) => !t || n.type === t)
				.map((n) => ({ id: n.id, type: n.type, data: { ...(n.data ?? {}) } })),
		type ?? null
	);
const edgesOf = (peer) =>
	peer.page.evaluate(() => {
		let graphs;
		window.__stores.flowGraphs.subscribe((v) => (graphs = v))();
		return Object.entries(graphs ?? {}).flatMap(([graphId, doc]) =>
			(doc.edges ?? []).map((e) => ({ id: e.id, source: e.source, target: e.target, targetHandle: e.targetHandle ?? null, graphId }))
		);
	});
const visibleOf = (peer, uuid) =>
	peer.page.evaluate((u) => {
		let group;
		window.__stores.objectsGroup.subscribe((v) => (group = v))();
		return group?.getObjectByProperty('uuid', u)?.visible ?? null;
	}, uuid);
const valueOf = (peer, id) =>
	peer.page.evaluate((i) => {
		let values;
		window.__stores.flowValues.subscribe((v) => (values = v))();
		return values?.[i];
	}, id);
const sharedVar = (peer, name) => peer.page.evaluate((n) => window.__stores.gameState.gameVar(n, 0), name);
const myVar = (peer, name) => peer.page.evaluate((n) => window.__stores.peerVars.myPeerVar(n, null), name);
const setPlay = (peer, value) => peer.page.evaluate((v) => window.__stores.isLocked.set(v), value);
const setState = (peer, state) => peer.page.evaluate((s) => window.__stores.gameState.setGameState(s), state);

// --- page actions -----------------------------------------------------------------
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
		await peer.page.evaluate(({ uuid, name }) => window.__stores.objectActions.renameObject(uuid, name), { uuid, name });
		await peer.page.waitForTimeout(400);
	}
	return uuid;
}
const clickObject = (peer, uuid) =>
	peer.page.evaluate((u) => {
		let group;
		window.__stores.objectsGroup.subscribe((v) => (group = v))();
		const object = group?.getObjectByProperty('uuid', u);
		if (!object) return 'no-object';
		window.__stores.moduleSDK.moduleClickHandlers.forEach((fn) => fn(object));
		return 'dispatched';
	}, uuid);
async function openToolbox(peer) {
	await peer.page.evaluate((id) => window.__stores.moduleToolboxes.openModuleToolbox(id), TOOLBOX);
	await peer.page.waitForTimeout(700);
}
/** the form: name · max · regen · on death · respawn · damage from · damage */
async function fillForm(peer, o) {
	const panel = peer.page.locator('.health-manager');
	await panel.locator('.hm-form input[type=text]').fill(o.name ?? 'hp');
	const numbers = panel.locator('.hm-form input[type=number]');
	await numbers.nth(0).fill(String(o.max ?? 5));
	await numbers.nth(1).fill(String(o.regen ?? 0));
	await numbers.nth(2).fill(String(o.respawnDelay ?? 3));
	await numbers.nth(3).fill(String(o.amount ?? 1));
	await numbers.nth(4).fill(String(o.radius ?? 1.5));
	const selects = panel.locator('.hm-form select');
	await selects.nth(0).selectOption(o.deathAction ?? 'hide');
	await selects.nth(1).selectOption(o.source ?? 'click');
}
async function press(page, code) {
	await page.evaluate(() => document.activeElement?.blur?.());
	await page.keyboard.down(code);
	await page.waitForTimeout(60);
	await page.keyboard.up(code);
	await page.waitForTimeout(260);
}

h.run(async () => {
	const browser = await h.launch({ args: h.GPU_ARGS });
	const A = await h.setupPage(browser, 'A');
	const B = await h.setupPage(browser, 'B');
	await h.installModule(A, 'health');
	await h.installModule(B, 'health');
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

	// =====================================================================
	// 0. PREMISE — the family, the effect, the value nodes, the toolbox, the HUD action
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
			effect: !!s.moduleSDK.moduleEffects.health,
			values: ['health', 'damage', 'heal', 'healthreset', 'healthvalue', 'healthevent'].filter((t) => !!s.moduleNodeIO.moduleValueNodes[t]),
			types: { health: s.moduleNodeIO.moduleValueTypes.health, damage: s.moduleNodeIO.moduleValueTypes.damage, healthvalue: s.moduleNodeIO.moduleValueTypes.healthvalue },
			inputs: s.moduleNodeIO.moduleNodeInputs.health,
			toolbox: (boxes ?? []).map((b) => b.id),
			debugLines: s.moduleHudKinds.moduleDebugLineTexts(),
			actions: s.hudActions.actionsForKind('text').map((a) => a.key),
			hook: !!window.__health
		};
	});
	h.check(
		['health', 'damage', 'heal', 'healthreset', 'healthvalue', 'healthevent'].every((t) => registered.items.includes(t)),
		'the six nodes are in the palette (' + JSON.stringify(registered.items.filter((t) => /health|damage|heal/.test(t))) + ')'
	);
	h.check(!registered.effect && registered.types.health === 'number', 'health is a VALUE node (its hp), NOT an effect — an effect would pin its target\'s pose');
	h.check(registered.values.length === 6, 'the six value/event nodes are registered (' + registered.values.join(',') + ')');
	h.check(registered.types.damage === 'event' && registered.types.healthvalue === 'number', 'damage outputs an EVENT, healthvalue a number');
	h.check(registered.inputs?.target === 'object' && registered.inputs?.damage === 'number' && registered.inputs?.heal === 'number' && registered.inputs?.respawnAt === 'object', 'health declares target/respawnAt (object) and damage/heal (number) inputs');
	h.check(registered.toolbox.includes(TOOLBOX), 'the manager toolbox is registered as ' + TOOLBOX);
	h.check(registered.actions.includes('mod-health-showhealth') && registered.actions.includes('mod-health-showhp'), 'the two HUD actions are in the catalog, namespaced');
	h.check(registered.debugLines.length === 0, 'the debug line stays silent with no health in the scene');
	h.check(registered.hook, 'the test hook is on window');

	// =====================================================================
	// 1. THE RECIPE — one chain per selected object, replicated, ONE undo per object
	// =====================================================================
	await openToolbox(A);
	h.check(await A.page.locator('.health-manager').isVisible(), 'the toolbox mounted its DOM');
	const crate1 = await makeBox(A, 'Crate1');
	const crate2 = await makeBox(A, 'Crate2');
	h.check(!!crate1 && !!crate2, 'premise: two boxes');
	await A.page.evaluate(({ a, b }) => {
		const s = window.__stores;
		s.objectActions.selectObject(a);
		s.objectActions.selectObject(b, false, true);
	}, { a: crate1, b: crate2 });
	await A.page.waitForTimeout(400);
	await fillForm(A, { name: 'hp', max: 3, source: 'click', amount: 1, deathAction: 'hide' });
	await A.page.locator('.health-manager').getByRole('button', { name: 'Make damageable' }).click();
	await A.page.waitForTimeout(1500);
	await A.page.evaluate(() => window.__stores.objectActions.deselectObject());

	const healths = await nodesOf(A, 'health');
	h.check(healths.length === 2, 'one health node per selected object (' + healths.length + ')');
	h.check(healths.every((n) => n.data.max === 3 && n.data.scope === 'object'), 'each carries the form');
	const allA = await nodesOf(A);
	const counts = allA.reduce((m, n) => ((m[n.type] = (m[n.type] ?? 0) + 1), m), {});
	h.check(counts.damage === 2 && counts.counter === 2 && counts.healthreset === 2 && counts.objectselector === 2, 'each chain: damage, counter, health, reset, selector (' + JSON.stringify(counts) + ')');
	const edgesA = await edgesOf(A);
	const pulseEdges = edgesA.filter((e) => e.targetHandle === 'pulse');
	const dmgEdges = edgesA.filter((e) => e.targetHandle === 'damage');
	const resetEdges = edgesA.filter((e) => e.targetHandle === 'reset');
	const targetEdges = edgesA.filter((e) => e.targetHandle === 'target');
	h.check(pulseEdges.length === 2 && dmgEdges.length === 2 && resetEdges.length === 2 && targetEdges.length === 2, 'the wires: damage->counter.pulse, counter->health.damage, reset->counter.reset, selector->health.target');
	h.check(edgesA.every((e) => e.id === 'e-' + e.source + '-' + e.target + (e.targetHandle ? '.' + e.targetHandle : '')), 'every edge id is the editor\'s canonical handle-qualified shape');
	await h.eventually(() => nodesOf(B, 'health'), (n) => n.length === 2, 'both chains replicated to the peer', 12000);
	await h.eventually(() => edgesOf(B), (e) => e.length === edgesA.length, 'and every wire (' + edgesA.length + ')');
	await h.eventually(() => snapshot(A), (s) => s.length === 2 && s.every((x) => x.hp === 3 && !x.dead), 'both read 3/3 alive on A');
	await h.eventually(() => snapshot(B), (s) => s.length === 2 && s.every((x) => x.hp === 3 && !x.dead), 'and on B');

	await A.page.evaluate(() => window.__stores.history.undo());
	await A.page.waitForTimeout(900);
	h.check((await nodesOf(A)).length === 5, 'ONE undo removes one object\'s WHOLE chain (5 nodes left)');
	await A.page.evaluate(() => window.__stores.history.redo());
	await A.page.waitForTimeout(900);
	h.check((await nodesOf(A)).length === 10, 'and one redo restores it');
	await h.eventually(() => nodesOf(B), (n) => n.length === 10, 'the round trip left the peer converged');
	await A.page.evaluate((u) => window.__stores.objectActions.selectObject(u), crate1);
	await A.page.waitForTimeout(300);
	await A.page.locator('.health-manager').getByRole('button', { name: 'Make damageable' }).click();
	await A.page.waitForTimeout(800);
	await A.page.evaluate(() => window.__stores.objectActions.deselectObject());
	h.check((await nodesOf(A, 'health')).length === 2, 'an object that already has health is SKIPPED');

	// =====================================================================
	// 2. CONVERGENCE — damage from TWO peers is ONE number on both
	// =====================================================================
	await setState(A, 'playing');
	await A.page.waitForTimeout(800);
	for (const peer of [A, B]) await setPlay(peer, true);
	await A.page.waitForTimeout(900);
	h.check((await clickObject(A, crate1)) === 'dispatched' && (await clickObject(B, crate1)) === 'dispatched', 'premise: A and B each land one hit on Crate1');
	await h.eventually(() => healthOf(A, crate1), (s) => s?.hp === 1, 'A reads Crate1 at 1/3 — its own hit AND the peer\'s', 10000);
	await h.eventually(() => healthOf(B, crate1), (s) => s?.hp === 1, 'B reads 1/3 too: ONE number, no authority', 10000);
	h.check((await healthOf(A, crate2))?.hp === 3 && (await healthOf(B, crate2))?.hp === 3, 'Crate2 is untouched on both');
	const counterId = (await nodesOf(A, 'counter'))[0].id;
	// THE COUNTERFACTUAL: the shared-add model. Both peers read the variable, THEN both
	// write what they computed — the standing setvariable race, and one hit is lost.
	const before = await Promise.all([sharedVar(A, 'cf'), sharedVar(B, 'cf')]);
	await Promise.all([
		A.page.evaluate((v) => window.__stores.gameState.setGameVar('cf', v + 1), before[0]),
		B.page.evaluate((v) => window.__stores.gameState.setGameVar('cf', v + 1), before[1])
	]);
	await A.page.waitForTimeout(1500);
	const cfA = await sharedVar(A, 'cf');
	const cfB = await sharedVar(B, 'cf');
	h.check(cfA === cfB && cfA === 1, 'COUNTERFACTUAL: a counter ADD from two peers converges on 1 hit, not 2 (' + cfA + '/' + cfB + ') — the ledger read 2');

	await clickObject(A, crate1);
	await h.eventually(() => healthOf(A, crate1), (s) => s?.dead === true, 'the third hit kills it on A');
	await h.eventually(() => healthOf(B, crate1), (s) => s?.dead === true, 'and on B');
	await h.eventually(() => visibleOf(A, crate1), (v) => v === false, 'deathAction hide: Crate1 vanishes on A');
	await h.eventually(() => visibleOf(B, crate1), (v) => v === false, 'and on B');
	await clickObject(A, crate1);
	await A.page.waitForTimeout(700);
	h.check((await valueOf(A, counterId)) === 3 || (await valueOf(A, (await nodesOf(A, 'counter'))[1].id)) === 3, 'a hit on the dead is DROPPED (the overkill guard): the counter stays at 3');
	// two readers through the module's own api (the same addNodes seam the toolbox uses)
	const readers = await A.page.evaluate(() =>
		window.__health.api.flow.addNodes({
			nodes: [
				{ type: 'healthvalue', x: 900, y: 40, data: { name: 'hp', read: 'fraction' } },
				{ type: 'healthvalue', x: 900, y: 140, data: { name: 'hp', read: 'alive' } }
			]
		})
	);
	await h.eventually(() => valueOf(A, readers[0]), (v) => v === 0.5, 'healthvalue fraction reads (0+3)/(3+3) = 0.5 for the group');
	await h.eventually(() => valueOf(A, readers[1]), (v) => v === 1, 'healthvalue alive reads 1 of 2');
	const line = await A.page.evaluate(() => window.__stores.moduleHudKinds.moduleDebugLineTexts());
	h.check(line.length === 1 && /health \(hp\): 3\/6 · 1 of 2 alive/.test(line[0]), 'the debug line reads the group (' + JSON.stringify(line) + ')');

	// =====================================================================
	// 3. A LATE JOINER reads the same numbers, and re-applies NOTHING
	// =====================================================================
	// the Approve button lives in the editor chrome, so the host leaves play to answer
	await setPlay(A, null);
	await A.page.waitForTimeout(400);
	const C = await h.setupPage(browser, 'C');
	await h.installModule(C, 'health');
	await h.connect(C, A);
	await setPlay(A, true);
	await h.eventually(() => nodesOf(C, 'health'), (n) => n.length === 2, 'the joiner holds both chains', 20000);
	const joinerView = async () => ({
		health: await healthOf(C, crate1),
		trigger: await C.page.evaluate((i) => { let t; window.__stores.flowTriggers.subscribe((v) => (t = v))(); return t?.[i] ?? null; }, counterId),
		value: await valueOf(C, counterId)
	});
	await h.eventually(joinerView, (v) => v.health?.dead === true && v.health.hp === 0, 'the joiner reads Crate1 DEAD (0/3) — the count arrived in the triggers handshake', 15000);
	h.check((await healthOf(C, crate2))?.hp === 3, 'and Crate2 at 3/3');
	await setPlay(C, true);
	await h.eventually(() => visibleOf(C, crate1), (v) => v === false, 'Crate1 is hidden for the joiner too');
	await C.page.waitForTimeout(1500);
	h.check((await healthOf(A, crate1))?.hp === 0 && (await valueOf(A, counterId)) <= 3, 'the joiner re-applied NOTHING: A\'s counter did not move');
	await clickObject(C, crate2);
	await h.eventually(() => healthOf(A, crate2), (s) => s?.hp === 2, 'a hit from the joiner reaches A (2/3)', 10000);
	await h.eventually(() => healthOf(B, crate2), (s) => s?.hp === 2, 'and B');
	await h.eventually(() => healthOf(C, crate2), (s) => s?.hp === 2, 'and itself');

	// =====================================================================
	// 4. PER-PLAYER — my row, my number; regen; death fires ONCE; respawn
	// =====================================================================
	await setPlay(A, null);
	await A.page.waitForTimeout(400);
	await openToolbox(A);
	await fillForm(A, { name: 'me', max: 5, regen: 0, source: 'wired', amount: 1, deathAction: 'respawn', respawnDelay: 2 });
	await A.page.locator('.health-manager').getByRole('button', { name: 'Player health' }).click();
	await A.page.waitForTimeout(1200);
	const player = (await nodesOf(A, 'health')).find((n) => n.data.scope === 'player');
	h.check(!!player && player.data.name === 'me', 'a player-scoped health node exists');
	const dmgMe = (await nodesOf(A, 'damage')).find((n) => n.data.source === 'wired');
	h.check(!!dmgMe, 'premise: its wired damage node');
	// a PER-PLAYER key: the keypress pulse stays in the presser's log, so only the
	// presser's damage fires (the collectible's {replicate:false} in core's own flag)
	const wired = await A.page.evaluate(
		({ dmg }) =>
			window.__health.api.flow.addNodes({
				nodes: [
					{ type: 'keypress', x: 60, y: 700, data: { code: 'KeyR', pulse: 0.3, perPlayer: true } },
					{ type: 'healthevent', x: 60, y: 800, data: { name: 'me', event: 'death' } },
					{ type: 'counter', x: 280, y: 800, data: { op: 'up', step: 1 } }
				],
				edges: [{ from: 0, to: dmg, handle: 'trigger' }, { from: 1, to: 2, handle: 'pulse' }]
			}),
		{ dmg: dmgMe.id }
	);
	await h.eventually(() => nodesOf(B, 'keypress'), (n) => n.length === 1, 'the key node replicated');
	await A.page.waitForTimeout(800);
	await setPlay(A, true);
	await A.page.waitForTimeout(500);
	await press(A.page, 'KeyR');
	await press(A.page, 'KeyR');
	await h.eventually(() => myVar(A, 'me'), (v) => v === 3, 'two presses: A\'s OWN row reads 3 (of 5)');
	await A.page.waitForTimeout(1200);
	h.check((await myVar(B, 'me')) === null && (await playerOf(B, 'me'))?.hp === 5, 'B\'s row is untouched (5/5): per-player health is per-player');
	const rows = await A.page.evaluate(() => window.__stores.peerVars.allPeerVars ? window.__stores.peerVars.allPeerVars('me').length : -1);
	h.check(rows === -1 || rows >= 1, 'the row is a peerVars row (' + rows + ')');
	// regen is a pure function of (row, clock): switch it on and watch the number climb
	// while the ROW stays exactly where the last hit wrote it
	await A.page.evaluate((id) => window.__health.api.flow.setNodeData(id, { regen: 1 }), player.id);
	await h.eventually(() => playerOf(A, 'me'), (s) => s && s.hp > 3.5, 'regen 1/s: A\'s hp climbs from 3 without anything sent', 6000);
	await h.eventually(() => playerOf(A, 'me'), (s) => s && s.hp === 5, 'and caps at 5', 8000);
	h.check((await myVar(A, 'me')) === 3, 'the ROW still holds the base written at the hit (3): regen is derived, never stored');
	await A.page.evaluate((id) => window.__health.api.flow.setNodeData(id, { regen: 0 }), player.id);
	await A.page.waitForTimeout(600);
	for (let i = 0; i < 5; i++) await press(A.page, 'KeyR');
	await h.eventually(() => playerOf(A, 'me'), (s) => s?.dead === true, 'five presses: dead', 8000);
	await h.eventually(() => valueOf(A, wired[2]), (v) => v === 1, 'the death event fired ONCE (its counter reads 1)');
	await h.eventually(() => valueOf(B, wired[2]), (v) => !v, 'and not on B — B\'s player did not die');
	await h.eventually(() => playerOf(A, 'me'), (s) => s && !s.dead && s.hp === 5, 'respawn after 2 s: back to 5/5', 8000);
	await A.page.waitForTimeout(800);
	h.check((await valueOf(A, wired[2])) === 1, 'still ONE death');

	// =====================================================================
	// 5. A NEW ROUND restores every object — core\'s round, our reset pulse
	// =====================================================================
	await setState(A, 'menu');
	await A.page.waitForTimeout(1000);
	await setState(A, 'playing');
	await h.eventually(() => healthOf(A, crate1), (s) => s?.hp === 3 && !s.dead, 'Crate1 is back to 3/3 on A after a round bump', 8000);
	await h.eventually(() => healthOf(B, crate1), (s) => s?.hp === 3 && !s.dead, 'and on B', 8000);
	await h.eventually(() => healthOf(C, crate1), (s) => s?.hp === 3 && !s.dead, 'and on the joiner', 8000);
	await h.eventually(() => visibleOf(B, crate1), (v) => v === true, 'and it is visible again');

	// =====================================================================
	// 6. HEAL — the opposite sign, through a counter of its own
	// =====================================================================
	const target2 = (await snapshot(A)).find((s) => s.uuid === crate2);
	await clickObject(A, crate2);
	await h.eventually(() => healthOf(A, crate2), (s) => s?.hp === 2, 'premise: Crate2 hurt to 2/3');
	const healed = await A.page.evaluate(
		({ hp }) =>
			window.__health.api.flow.addNodes({
				nodes: [
					{ type: 'keypress', x: 60, y: 900, data: { code: 'KeyH', pulse: 0.3 } },
					{ type: 'heal', x: 280, y: 900, data: { amount: 1 } },
					{ type: 'counter', x: 500, y: 900, data: { op: 'up', step: 1 } }
				],
				edges: [{ from: 0, to: 1, handle: 'trigger' }, { from: 1, to: 2, handle: 'pulse' }, { from: 2, to: hp, handle: 'heal' }]
			}),
		{ hp: target2.id }
	);
	await h.eventually(() => nodesOf(B, 'heal'), (n) => n.length === 1, 'the heal chain replicated');
	await A.page.waitForTimeout(800);
	await press(A.page, 'KeyH');
	await h.eventually(() => healthOf(A, crate2), (s) => s?.hp === 3, 'one heal: 3/3 on A');
	await h.eventually(() => healthOf(B, crate2), (s) => s?.hp === 3, 'and on B (the key stamp replicated; each peer fired its own local heal)');
	h.check(Array.isArray(healed) && healed.length === 3, 'premise: the heal chain was authored (' + healed.length + ' nodes)');

	// =====================================================================
	// 8. HIT — the knock feed: one `hit` message, every peer fires its own local pulses
	// =====================================================================
	// the damage node of Crate2's chain, found from the graph alone
	const chainDamageOf = async (healthId) => {
		const edges = await edgesOf(A);
		const counter = edges.find((e) => e.target === healthId && e.targetHandle === 'damage')?.source;
		return edges.find((e) => e.target === counter && e.targetHandle === 'pulse')?.source ?? null;
	};
	const dmg2 = await chainDamageOf(target2.id);
	h.check(!!dmg2, 'premise: Crate2\'s damage node resolves from the wires');
	await A.page.evaluate(({ id }) => window.__health.api.flow.setNodeData(id, { source: 'hit', scale: 'speed', speedRef: 3, amount: 1 }), { id: dmg2 });
	await h.eventually(() => nodesOf(B, 'damage'), (n) => n.some((x) => x.id === dmg2 && x.data.source === 'hit' && x.data.scale === 'speed'), 'the edit replicated (source hit, speed-scaled)');
	// the knock needs a body and the knock block (scene physics has no api write, DEVX #20)
	await A.page.evaluate(() =>
		window.__stores.scenePhysics.setScenePhysics({ knock: { enabled: true, gain: 1, maxSpeed: 10, spin: 0.8 }, play: { interaction: 'grab', grounded: false, simOnPlay: false } })
	);
	await A.page.evaluate((u) => window.__health.api.physics.set(u, { mode: 'dynamic', mass: 1, restitution: 0.2, friction: 0.6 }), crate2);
	await A.page.waitForTimeout(800);
	for (const peer of [A, B, C]) await setPlay(peer, true);
	await A.page.evaluate(() => window.__stores.physics.warmup().catch(() => {}));
	await A.page.evaluate(() => window.__stores.physics.toggleSimulation());
	await h.eventually(() => A.page.evaluate(() => window.__stores.physics.physicsDebug().length), (n) => n > 0, 'premise: the simulation runs on A');
	await A.page.waitForTimeout(1200);
	const knock = await A.page.evaluate(
		({ uuid, speed }) => {
			let group = null;
			window.__stores.objectsGroup.subscribe((g) => (group = g))();
			const o = group?.getObjectByProperty('uuid', uuid);
			if (!o) return { hits: 0, reason: 'no object' };
			const k = window.__stores.knock;
			const id = 'hp-probe';
			k.dropProbe(id);
			const [bx, by, bz] = o.position.toArray();
			let hits = 0;
			let t = 1000;
			const step = (speed * 16) / 1000;
			for (let x = bx - 1.2; x <= bx + 0.05; x += step) {
				hits += k.feedProbe(id, [x, by, bz], t).hits;
				t += 16;
			}
			k.dropProbe(id);
			return { hits };
		},
		{ uuid: crate2, speed: 6 }
	);
	h.check(knock.hits >= 1, 'premise: a 6 m/s probe sweep knocks Crate2 (' + JSON.stringify(knock) + ')');
	// 6 m/s against speedRef 3 = 2 points per knock, on every peer, from ONE message
	const expectHp = Math.max(0, 3 - 2 * knock.hits);
	await h.eventually(() => healthOf(A, crate2), (s) => s?.hp === expectHp, 'A: Crate2 took 2 points per knock (speed-scaled) -> ' + expectHp + '/3', 8000);
	await h.eventually(() => healthOf(B, crate2), (s) => s?.hp === expectHp, 'B reads the same from the hit message it received', 10000);
	await h.eventually(() => healthOf(C, crate2), (s) => s?.hp === expectHp, 'and so does C', 10000);
	await A.page.evaluate(() => window.__stores.physics.stopSimulation());
	await A.page.waitForTimeout(800);

	// =====================================================================
	// 9. TOUCH — self-proximity, an EDGE: the toucher fires a replicated pulse once
	// =====================================================================
	// In play the rig re-seats the camera at (0, 1.6, 0) every frame, so a flight moves
	// the OBJECT (a replicated move) rather than the player. Only B is in play: touch is
	// self-detected, and a peer out of play detects nothing.
	const objectPos = (peer, uuid) =>
		peer.page.evaluate((u) => {
			let group;
			window.__stores.objectsGroup.subscribe((v) => (group = v))();
			return group?.getObjectByProperty('uuid', u)?.position.toArray() ?? null;
		}, uuid);
	const moveTo = (uuid, pos) => A.page.evaluate(({ u, p }) => window.__health.api.moveObject(u, { pos: p }), { u: uuid, p: pos });
	for (const peer of [A, C]) await setPlay(peer, null);
	await A.page.waitForTimeout(400);
	const crate3 = await makeBox(A, 'Crate3');
	await moveTo(crate3, [6, 0, 0]);
	await openToolbox(A);
	await A.page.evaluate((u) => window.__stores.objectActions.selectObject(u), crate3);
	await A.page.waitForTimeout(300);
	await fillForm(A, { name: 'hp', max: 3, source: 'touch', amount: 1, radius: 2.5, deathAction: 'hide' });
	await A.page.locator('.health-manager').getByRole('button', { name: 'Make damageable' }).click();
	await A.page.waitForTimeout(1200);
	await A.page.evaluate(() => window.__stores.objectActions.deselectObject());
	await h.eventually(() => healthOf(B, crate3), (s) => s?.hp === 3, 'Crate3 has a touch chain on B', 12000);
	await h.eventually(() => objectPos(B, crate3), (p) => p && Math.abs(p[0] - 6) < 0.01, 'and stands 6 m away on B (the move replicated)');
	// where B's player stands in play is the rig's business; the flight reads it and puts
	// the crate exactly there (a replicated move), then takes it away and brings it back
	const bPlayer = await B.page.evaluate(() => window.__health.api.playerPosition());
	h.check(Array.isArray(bPlayer) && bPlayer.length === 3, 'premise: B\'s player has a position in play (' + JSON.stringify(bPlayer) + ')');
	const away3 = [bPlayer[0] + 9, bPlayer[1], bPlayer[2] + 9];
	await moveTo(crate3, bPlayer);
	await h.eventually(() => healthOf(B, crate3), (s) => s?.hp === 2, 'Crate3 arrives under B: B touched it, 2/3 on the toucher', 8000);
	await h.eventually(() => healthOf(A, crate3), (s) => s?.hp === 2, 'and on A (the toucher\'s pulse replicated; A is not even in play)', 8000);
	await B.page.waitForTimeout(1500);
	h.check((await healthOf(A, crate3))?.hp === 2, 'standing there does NOT keep hurting it: touch is an edge');
	await moveTo(crate3, away3);
	await B.page.waitForTimeout(700);
	await moveTo(crate3, bPlayer);
	await h.eventually(() => healthOf(A, crate3), (s) => s?.hp === 1, 'leaving and coming back is a second touch: 1/3', 8000);
	await moveTo(crate3, away3);
	await B.page.waitForTimeout(400);

	// =====================================================================
	// 10. ZONE — the PLAYER in a hazard: per second, local, on their own row
	// =====================================================================
	const zone = await A.page.evaluate(
		({ hp, crate }) =>
			window.__health.api.flow.addNodes({
				nodes: [
					{ type: 'damage', x: 60, y: 1100, data: { source: 'zone', amount: 1, perSecond: 2, radius: 2 } },
					{ type: 'objectselector', x: 60, y: 1200, data: { selected: crate } },
					{ type: 'counter', x: 280, y: 1100, data: { op: 'up', step: 1 } }
				],
				edges: [{ from: 1, to: 0, handle: 'zone' }, { from: 0, to: 2, handle: 'pulse' }, { from: 2, to: hp, handle: 'damage' }]
			}),
		{ hp: player.id, crate: crate3 }
	);
	h.check(zone.length === 3, 'premise: a zone chain into the player health, the zone being Crate3');
	// the respawn point: Crate1, far off, wired into respawnAt
	await moveTo(crate1, [40, 0, 40]);
	const spawnSel = await A.page.evaluate(
		({ hp, crate }) => window.__health.api.flow.addNodes({ nodes: [{ type: 'objectselector', x: 700, y: 1100, data: { selected: crate } }], edges: [{ from: 0, to: hp, handle: 'respawnAt' }] }),
		{ hp: player.id, crate: crate1 }
	);
	h.check(spawnSel.length === 1, 'premise: Crate1 is the respawn point');
	await setPlay(B, null);
	await setPlay(A, true);
	await A.page.waitForTimeout(2500); // the play rig settles the camera after a moment
	h.check((await playerOf(A, 'me'))?.hp === 5, 'premise: A at 5/5 before the hazard');
	const aPlayer = await A.page.evaluate(() => window.__health.api.playerPosition());
	await A.page.waitForTimeout(600);
	const aPlayer2 = await A.page.evaluate(() => window.__health.api.playerPosition());
	h.check(Array.isArray(aPlayer) && aPlayer.every((v, i) => Math.abs(v - aPlayer2[i]) < 0.01), 'premise: A\'s play position is stable (' + JSON.stringify(aPlayer) + ')');
	await moveTo(crate3, aPlayer2); // the hazard arrives under A
	const zoneView = async () => ({
		me: (await playerOf(A, 'me'))?.hp,
		diag: await A.page.evaluate((u) => {
			const api = window.__health.api;
			let group;
			window.__stores.objectsGroup.subscribe((v) => (group = v))();
			const o = group?.getObjectByProperty('uuid', u);
			const edges = api.flow.edges().filter((e) => e.targetHandle === 'zone' || e.targetHandle === 'respawnAt').map((e) => ({ s: e.source.slice(0, 6), t: e.target.slice(0, 6), h: e.targetHandle }));
			const zones = api.flow.nodes('damage').filter((n) => n.data.source === 'zone').map((n) => ({ id: n.id.slice(0, 6), radius: n.data.radius, perSecond: n.data.perSecond }));
			return { playing: api.isPlaying(), player: api.playerPosition(), crate: o?.getWorldPosition(new api.THREE.Vector3()).toArray(), edges, zones, row: window.__stores.peerVars.myPeerVar('me', null) };
		}, crate3)
	});
	await h.eventually(zoneView, (v) => typeof v.me === 'number' && v.me <= 3, 'in the zone: A loses about 2 points a second, on A\'s own row', 5000);
	h.check((await playerOf(B, 'me'))?.hp === 5, 'B, out of play, is untouched (5/5)');
	await h.eventually(() => playerOf(A, 'me'), (s) => s?.dead === true, 'staying kills A', 8000);
	// leave play: the editor camera is free to fly, and the zone hurts nobody outside play
	await setPlay(A, null);
	await h.eventually(() => playerOf(A, 'me'), (s) => s && !s.dead && s.hp === 5, 'respawn after 2 s: 5/5 on the row', 8000);
	await h.eventually(
		() => A.page.evaluate(() => window.__health.api.playerPosition()),
		(p) => p && Math.hypot(p[0] - 40, p[2] - 40) < 2,
		'and the camera flew to Crate1 (respawnAt) — the editor camera; in play the rig owns it (DEVX #23)',
		6000
	);
	await A.page.waitForTimeout(1200);
	h.check((await playerOf(A, 'me'))?.hp === 5, 'the number holds at 5/5');
	await moveTo(crate3, away3);

	// =====================================================================
	// 7. THE MANAGER — live rows
	// =====================================================================
	await setPlay(A, null);
	await A.page.waitForTimeout(400);
	await openToolbox(A);
	await A.page.waitForTimeout(800);
	const rowsUi = await A.page.evaluate(() =>
		[...document.querySelectorAll('.health-manager .hm-row')].map((r) => ({ name: r.querySelector('.hm-name')?.textContent, hp: r.querySelector('.hm-hp')?.textContent, status: r.querySelector('.hm-status')?.textContent }))
	);
	h.check(rowsUi.length === 4, 'four rows: three crates and the player (' + JSON.stringify(rowsUi) + ')');
	h.check(rowsUi.some((r) => /Crate1/.test(r.name) && r.hp === '3 / 3' && r.status === 'full'), 'Crate1 reads 3 / 3, full');
	// Crate3 took its third touch when it arrived under A (A was in play as the hazard's
	// bearer, and touch is self-detected by whoever is in play) — dead, and the row says so
	h.check(rowsUi.some((r) => /Crate3/.test(r.name) && r.hp === '0 / 3' && r.status === 'dead'), 'Crate3 reads 0 / 3, dead (its third touch was A\'s, in the zone section)');
	h.check(rowsUi.some((r) => /player/.test(r.name) && r.hp === '5 / 5'), 'the player row reads 5 / 5');

	await h.finish(browser);
});
