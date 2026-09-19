// waves test-flight — the REAL health + waves zips on two peers (and a third that joins
// late), the arena built through the module's own toolbox, the enemies killed through
// the app's own click dispatch.
//
// THE CLAIM UNDER TEST: the wave is DERIVED from the enemies' hit counters (the health
// module's ledger), every peer heals the survivors into the next wave with local pulses,
// the enemies walk a line every peer computes from the wave's start stamp, and when the
// last one falls every peer fires `over` and appends the same run to gameState.vars. So a
// two-peer round ends when the last enemy dies, and a late joiner reads the same wave.
//
//   APP_URL=https://theprototype.app:5215/ npm test -- waves
const h = require('./helpers.cjs');

const TOOLBOX = 'mod-waves-arena';

const snapshot = (peer) => peer.page.evaluate(() => window.__waves.snapshot()[0] ?? null);
const healthSnap = (peer) => peer.page.evaluate(() => window.__health.snapshot());
const nodesOf = (peer, type) =>
	peer.page.evaluate((t) => window.__stores.allNodes().filter((n) => !t || n.type === t).map((n) => ({ id: n.id, type: n.type, data: { ...(n.data ?? {}) } })), type ?? null);
const edgesOf = (peer) =>
	peer.page.evaluate(() => {
		let graphs;
		window.__stores.flowGraphs.subscribe((v) => (graphs = v))();
		return Object.entries(graphs ?? {}).flatMap(([graphId, doc]) => (doc.edges ?? []).map((e) => ({ id: e.id, source: e.source, target: e.target, targetHandle: e.targetHandle ?? null, graphId })));
	});
const objectPos = (peer, uuid) =>
	peer.page.evaluate((u) => {
		let group;
		window.__stores.objectsGroup.subscribe((v) => (group = v))();
		return group?.getObjectByProperty('uuid', u)?.position.toArray() ?? null;
	}, uuid);
const valueOf = (peer, id) =>
	peer.page.evaluate((i) => {
		let values;
		window.__stores.flowValues.subscribe((v) => (values = v))();
		return values?.[i];
	}, id);
const gameStateOf = (peer) =>
	peer.page.evaluate(() => {
		let g;
		window.__stores.gameState.gameState.subscribe((v) => (g = v))();
		return g?.state ?? null;
	});
const myVar = (peer, name) => peer.page.evaluate((n) => window.__stores.peerVars.myPeerVar(n, null), name);
const setPlay = (peer, value) => peer.page.evaluate((v) => window.__stores.isLocked.set(v), value);
const setState = (peer, state) => peer.page.evaluate((s) => window.__stores.gameState.setGameState(s), state);

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
const moveTo = (peer, uuid, pos) => peer.page.evaluate(({ u, p }) => window.__waves.api.moveObject(u, { pos: p }), { u: uuid, p: pos });
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
/** the form, in order: name · waves · first · +per · between · hp · [killed by] · walk · reach · dmg · rate · player · player hp · spawn prefix · boxes */
async function fillForm(peer, o) {
	const panel = peer.page.locator('.waves-manager');
	const texts = panel.locator('.wm-form input[type=text]');
	await texts.nth(0).fill(o.name ?? 'enemy');
	await texts.nth(1).fill(o.playerName ?? 'me');
	await texts.nth(2).fill(o.spawnPrefix ?? 'Spawn');
	const numbers = panel.locator('.wm-form input[type=number]');
	const values = [o.waves ?? 2, o.sizeStart ?? 2, o.sizeStep ?? 1, o.interval ?? 1, o.hp ?? 2, o.speed ?? 4, o.reach ?? 1.5, o.enemyDamage ?? 1, o.enemyRate ?? 1, o.playerHp ?? 10, o.count ?? 4];
	for (let i = 0; i < values.length; i++) await numbers.nth(i).fill(String(values[i]));
	await panel.locator('.wm-form select').nth(0).selectOption(o.source ?? 'click');
}

h.run(async () => {
	const browser = await h.launch({ args: h.GPU_ARGS });
	const A = await h.setupPage(browser, 'A');
	const B = await h.setupPage(browser, 'B');
	for (const peer of [A, B]) {
		await h.installModule(peer, 'health');
		await h.installModule(peer, 'waves');
	}
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
	// 0. PREMISE
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
			types: { waves: s.moduleNodeIO.moduleValueTypes.waves, wavesevent: s.moduleNodeIO.moduleValueTypes.wavesevent },
			inputs: s.moduleNodeIO.moduleNodeInputs.waves,
			toolbox: (boxes ?? []).map((b) => b.id),
			actions: s.hudActions.actionsForKind('text').map((a) => a.key),
			debugLines: s.moduleHudKinds.moduleDebugLineTexts(),
			hooks: !!window.__waves && !!window.__health
		};
	});
	h.check(['waves', 'wavesvalue', 'wavesevent'].every((t) => registered.items.includes(t)) && registered.items.includes('health'), 'the Waves family and the Health family are both in the palette');
	h.check(registered.types.waves === 'number' && registered.types.wavesevent === 'event' && registered.inputs?.goal === 'object', 'waves is a number (the wave) with a goal object input; wavesevent an event');
	h.check(registered.toolbox.includes(TOOLBOX), 'the arena toolbox is registered as ' + TOOLBOX);
	h.check(registered.actions.includes('mod-waves-showwave') && registered.actions.includes('mod-waves-showleft'), 'the HUD actions are in the catalog');
	h.check(registered.debugLines.length === 0 && registered.hooks, 'debug line silent, hooks on window');

	// =====================================================================
	// 1. THE ARENA — three enemies, a spawn point, a goal, built by the toolbox
	// =====================================================================
	const enemies = [];
	for (const name of ['Enemy1', 'Enemy2', 'Enemy3']) enemies.push(await makeBox(A, name));
	const goal = await makeBox(A, 'Goal');
	const spawn = await makeBox(A, 'Spawn 1');
	h.check(enemies.every(Boolean) && !!goal && !!spawn, 'premise: five boxes');
	await moveTo(A, enemies[0], [-3, 0.5, -14]);
	await moveTo(A, enemies[1], [0, 0.5, -14]);
	await moveTo(A, enemies[2], [3, 0.5, -14]);
	await moveTo(A, spawn, [0, 0.5, -8]);
	await moveTo(A, goal, [0, 0.5, 6]);
	await A.page.waitForTimeout(600);
	await openToolbox(A);
	h.check(await A.page.locator('.waves-manager').isVisible(), 'the toolbox mounted its DOM');
	await fillForm(A, { waves: 2, sizeStart: 2, sizeStep: 1, interval: 1, hp: 2, source: 'click', speed: 4 });
	await A.page.evaluate(({ e, g }) => {
		const s = window.__stores;
		s.objectActions.selectObject(e[0]);
		s.objectActions.selectObject(e[1], false, true);
		s.objectActions.selectObject(e[2], false, true);
		s.objectActions.selectObject(g, false, true); // the goal LAST
	}, { e: enemies, g: goal });
	await A.page.waitForTimeout(400);
	await A.page.locator('.waves-manager').getByRole('button', { name: 'Enemies from selection' }).click();
	await A.page.waitForTimeout(2500);
	await A.page.evaluate(() => window.__stores.objectActions.deselectObject());

	const wavesNodes = await nodesOf(A, 'waves');
	h.check(wavesNodes.length === 1 && wavesNodes[0].data.waves === 2 && wavesNodes[0].data.sizeStart === 2, 'ONE Waves node with the form\'s curve');
	const allA = await nodesOf(A);
	const counts = allA.reduce((m, n) => ((m[n.type] = (m[n.type] ?? 0) + 1), m), {});
	h.check(counts.health === 4 && counts.heal === 3 && counts.damage === 7 && counts.counter === 7 && counts.wavesevent === 1 && counts.setgamestate === 1, 'per enemy a health chain, a heal chain and a zone chain; the player health; over -> Set Game State (' + JSON.stringify(counts) + ')');
	const edgesA = await edgesOf(A);
	h.check(edgesA.some((e) => e.targetHandle === 'goal' && e.target === wavesNodes[0].id), 'the goal is wired into waves.goal');
	h.check(edgesA.every((e) => e.id === 'e-' + e.source + '-' + e.target + (e.targetHandle ? '.' + e.targetHandle : '')), 'every edge id is canonical');
	await h.eventually(() => nodesOf(B), (n) => n.length === allA.length, 'the whole arena replicated to B (' + allA.length + ' nodes)', 15000);
	await h.eventually(() => snapshot(A), (s) => s && s.enemies.length === 3 && s.wave === 1 && !s.running && s.goal && s.spawns === 1, 'A derives: 3 enemies, wave 1, idle, a goal, one spawn point');
	await h.eventually(() => snapshot(B), (s) => s && s.enemies.length === 3 && s.wave === 1 && s.spawns === 1, 'and so does B');
	const line = await A.page.evaluate(() => window.__stores.moduleHudKinds.moduleDebugLineTexts());
	h.check(line.some((l) => /waves \(enemy\): wave 1\/2, idle/.test(l)), 'the debug line reads the run (' + JSON.stringify(line) + ')');

	// =====================================================================
	// 2. THE ROUND STARTS — wave 1 uses two enemies, and they walk
	// =====================================================================
	await setState(A, 'playing');
	await A.page.waitForTimeout(600);
	for (const peer of [A, B]) await setPlay(peer, true);
	await h.eventually(() => snapshot(A), (s) => s?.running && s.started && s.wave === 1 && s.size === 2 && s.alive === 2, 'the run is on: wave 1, two of three enemies, both alive', 8000);
	await h.eventually(() => snapshot(B), (s) => s?.running && s.started && s.wave === 1 && s.alive === 2, 'B agrees', 8000);
	const order = (await snapshot(A)).enemies.map((e) => e.uuid);
	h.check(order.join() === enemies.join(), 'enemy order is by name: Enemy1, Enemy2, Enemy3 (deterministic on every peer)');
	const p0 = await objectPos(A, order[0]);
	await A.page.waitForTimeout(1200);
	const p1 = await objectPos(A, order[0]);
	h.check(p0 && p1 && p1[2] > p0[2] + 1, 'the first enemy walks toward the goal (+z): ' + p0[2].toFixed(1) + ' -> ' + p1[2].toFixed(1));
	const pB = await objectPos(B, order[0]);
	const pA = await objectPos(A, order[0]);
	h.check(pA && pB && Math.abs(pA[2] - pB[2]) < 0.8, 'B places it where A does (same stamp, same clock): ' + pA[2].toFixed(1) + ' vs ' + pB[2].toFixed(1));
	const p2 = await objectPos(A, order[2]);
	h.check(p2 && Math.abs(p2[2] - -14) < 0.01, 'the third enemy is not in wave 1: parked');

	// =====================================================================
	// 3. TWO PEERS CLEAR WAVE 1 — the wave advances from the counters, the survivors heal
	// =====================================================================
	await clickObject(A, order[0]);
	await A.page.waitForTimeout(300);
	await clickObject(A, order[0]);
	await h.eventually(() => snapshot(A), (s) => s?.alive === 1 && s.enemies[0].kills === 1, 'A kills the first enemy (two clicks on hp 2): one left');
	await h.eventually(() => myVar(A, 'kills'), (v) => v === 1, 'A\'s own kills row reads 1');
	await clickObject(B, order[1]);
	await B.page.waitForTimeout(300);
	await clickObject(B, order[1]);
	await h.eventually(() => snapshot(A), (s) => s?.completed === 1, 'B kills the second: wave 1 is complete on A (B\'s pulses replicated)', 8000);
	await h.eventually(() => myVar(B, 'kills'), (v) => v === 1, 'B\'s own kills row reads 1');
	h.check((await myVar(A, 'kills')) === 1, 'and A\'s is still 1: one writer per row');
	await h.eventually(() => snapshot(A), (s) => s?.wave === 2 && s.started && s.alive === 3, 'after the interval: wave 2, all three alive again (the survivors healed with local pulses)', 8000);
	await h.eventually(() => snapshot(B), (s) => s?.wave === 2 && s.started && s.alive === 3, 'B: wave 2 too', 8000);
	// the heal pulses landed this sweep; the counter's value republishes ~6/s
	await h.eventually(() => snapshot(A), (s) => s && s.enemies[0].hits === 2 && s.enemies[0].heals === 2 && s.enemies[0].hp === 2 && s.enemies[2].hits === 0, 'the ledger: enemy 1 has 2 hits and 2 heals (hp 2), enemy 3 untouched');
	await h.eventually(() => healthSnap(A), (all) => all.find((s) => s.uuid === order[0])?.hp === 2, 'the health module reads the healed enemy at 2/2');
	const readers = await A.page.evaluate(() =>
		window.__waves.api.flow.addNodes({ nodes: [{ type: 'wavesvalue', x: 1200, y: 40, data: { name: 'enemy', read: 'wave' } }, { type: 'wavesvalue', x: 1200, y: 140, data: { name: 'enemy', read: 'left' } }] })
	);
	await h.eventually(() => valueOf(A, readers[0]), (v) => v === 2, 'a Waves Value node reads wave 2');
	await h.eventually(() => valueOf(A, readers[1]), (v) => v === 3, 'and 3 left');

	// =====================================================================
	// 4. A LATE JOINER reads wave 2 from the counters alone
	// =====================================================================
	await setPlay(A, null);
	await A.page.waitForTimeout(400);
	const C = await h.setupPage(browser, 'C');
	await h.installModule(C, 'health');
	await h.installModule(C, 'waves');
	await h.connect(C, A);
	await setPlay(A, true);
	await h.eventually(() => snapshot(C), (s) => s?.wave === 2 && s.enemies.length === 3, 'the joiner reads WAVE 2 — the counts arrived in the triggers handshake', 25000);
	const cE = (await snapshot(C)).enemies;
	h.check(cE[0].hits === 2 && cE[0].heals === 2 && cE[1].hits === 2 && cE[1].heals === 2 && cE[2].hits === 0, 'and the same ledger: hits and heals per enemy match the host');
	h.check((await myVar(C, 'kills')) === null, 'the joiner has no kills row yet');
	await setPlay(C, true);
	await h.eventually(() => valueOf(C, readers[0]), (v) => v === 2, 'its Waves Value node reads 2 as well');

	// =====================================================================
	// 5. THE LAST WAVE — three peers, one kill each; the round ends; the log agrees
	// =====================================================================
	for (const [peer, i] of [[A, 0], [B, 1], [C, 2]]) {
		await clickObject(peer, order[i]);
		await peer.page.waitForTimeout(300);
		await clickObject(peer, order[i]);
	}
	await h.eventually(() => snapshot(A), (s) => s?.done === true && s.alive === 0, 'the last enemy falls: DONE on A', 10000);
	await h.eventually(() => snapshot(B), (s) => s?.done === true, 'done on B', 8000);
	await h.eventually(() => snapshot(C), (s) => s?.done === true, 'done on C', 8000);
	await h.eventually(() => gameStateOf(A), (s) => s === 'over', 'over -> Set Game State: the shell is OVER on A', 8000);
	await h.eventually(() => gameStateOf(B), (s) => s === 'over', 'and on B');
	await h.eventually(() => gameStateOf(C), (s) => s === 'over', 'and on C');
	const kills = [await myVar(A, 'kills'), await myVar(B, 'kills'), await myVar(C, 'kills')];
	h.check(kills.join() === '2,2,1', 'kills rows: A 2, B 2, C 1 — each peer credited only its own killing blows (' + kills.join() + ')');
	await h.eventually(() => snapshot(A), (s) => s?.log.length === 1 && s.log[0].cleared && s.log[0].waves === 2 && s.log[0].reached === 2, 'ONE run logged in gameState.vars: cleared, 2 waves', 8000);
	const logA = (await snapshot(A)).log[0];
	h.check(logA.players.length === 3 && logA.players[0].kills === 2 && logA.players[2].kills === 1, 'with the three players\' kills (' + JSON.stringify(logA.players.map((p) => p.kills)) + ')');
	await h.eventually(() => snapshot(B), (s) => s?.log.length === 1 && JSON.stringify(s.log[0]) === JSON.stringify(logA), 'B holds the SAME entry (every peer appended the same object; idempotent by its stamp)', 8000);
	await h.eventually(() => snapshot(C), (s) => s?.log.length === 1 && s.log[0].at === logA.at, 'and so does C');

	// =====================================================================
	// 6. THE DEF + HUD, and the manager
	// =====================================================================
	const def = await A.page.evaluate(() => ({ screens: window.__waves.hud().scene.screens.map((s) => s.id), graph: window.__waves.hudGraph({ name: 'enemy', playerName: 'me' }).nodes.length }));
	h.check(def.screens.join() === 'menu,hud,over' && def.graph === 11, 'the HUD def: menu / hud / over, an eleven-node driver graph');
	await setPlay(A, null);
	await A.page.waitForTimeout(400);
	await openToolbox(A);
	await A.page.waitForTimeout(800);
	const panel = await A.page.evaluate(() => document.querySelector('.waves-manager .wm-title')?.textContent ?? '');
	h.check(/enemy · wave 2 of 2 · cleared/.test(panel), 'the manager reads the run (' + panel + ')');

	// =====================================================================
	// 7. A NEW ROUND starts over — the health module zeroes the counters, wave 1 again
	// =====================================================================
	await setState(A, 'menu');
	await A.page.waitForTimeout(800);
	await setState(A, 'playing');
	await setPlay(A, true);
	await h.eventually(() => snapshot(A), (s) => s?.wave === 1 && !s.done && s.running && s.enemies.every((e) => e.hits === 0 && e.heals === 0), 'a new round: wave 1, every counter zero on A', 10000);
	await h.eventually(() => snapshot(B), (s) => s?.wave === 1 && !s.done && s.enemies.every((e) => e.hits === 0), 'and on B', 8000);
	await h.eventually(() => snapshot(C), (s) => s?.wave === 1 && !s.done, 'and on C', 8000);
	h.check((await snapshot(A)).log.length === 1, 'the log keeps the finished run');

	await h.finish(browser);
});
