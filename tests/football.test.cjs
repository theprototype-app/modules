// football test-flight: the REAL zip on TWO peers (+ a late joiner), the pitch built by
// the module's own recipe (the def's objects/graph, one source), zero-g + knock as scene
// physics, both peers in play with the sim on the initiator; opposite teams claimed
// through the physical buttons' click path, Start serves, peer B's hit (A1's probe hook)
// sets lastTouch on BOTH, a ball teleported into gate A scores for B in B's OWN goals
// row only, a defender's last touch is an own goal on the sheet, `ownGoals: ignore`
// scores nothing, duel refuses a second red, free for all scores by player, time mode
// ends the match for everyone and writes the saved log, a late joiner reads the same
// score/slots/outcome, the lamps and the DOM HUD lists read the same nodes (B2), a
// perPlayer HUD Button presses a Match Button, and Fit pitch replicates as moves (B3).
//
//   npm run pack -- football
//   flock -w 5400 /tmp/tp-e2e.lock env APP_URL=https://theprototype.app:5208/ npm test -- football
//
// The hit feed: with A2 in the app the module reads api.onHit; on an A1-only build it
// falls back to the knock debug hook, which the flight has on (debugStores). Either way
// the probe that HITS is core's feedProbe — the module never fakes a touch.

const { launch, setupPage, installModule, connect, check, eventually, finish, run, GPU_ARGS } = require('./helpers.cjs');

/** the module's debug snapshot on a page */
const snap = (page) => page.evaluate(() => window.__football?.snapshot() ?? null);

/** the object under `uuid` clicked through the SAME dispatch the viewport uses */
const clickObject = (page, uuid) =>
	page.evaluate((uuid) => {
		let group = null;
		window.__stores.objectsGroup.subscribe((g) => (group = g))();
		const object = group?.getObjectByProperty('uuid', uuid);
		if (!object) return false;
		return window.__stores.moduleSDK.moduleClickHandlers.some((handler) => handler(object));
	}, uuid);

/** the ball's position on that page */
const posOf = (page, uuid) =>
	page.evaluate((uuid) => {
		let group = null;
		window.__stores.objectsGroup.subscribe((g) => (group = g))();
		const o = group?.getObjectByProperty('uuid', uuid);
		return o ? o.position.toArray() : null;
	}, uuid);

const speedOf = (page, uuid) =>
	page.evaluate((uuid) => {
		const b = window.__stores.physics.physicsDebug().find((e) => e.uuid === uuid);
		return b?.linvel ? Math.hypot(b.linvel.x, b.linvel.y, b.linvel.z) : null;
	}, uuid);

/** sweep a knock probe through the ball's CURRENT position on this page, along +x, at
 * `speed` m/s on a synthetic clock — core's feedProbe, the A1 test hook */
const hitBall = (page, uuid, speed = 4) =>
	page.evaluate(
		({ uuid, speed }) => {
			let group = null;
			window.__stores.objectsGroup.subscribe((g) => (group = g))();
			const o = group?.getObjectByProperty('uuid', uuid);
			if (!o) return { hits: 0, armed: false, reason: 'no ball' };
			const k = window.__stores.knock;
			const id = 'fb-' + Math.random().toString(36).slice(2, 6);
			k.dropProbe(id);
			const [bx, by, bz] = o.position.toArray();
			let hits = 0;
			let armed = true;
			let t = 1000;
			const step = (speed * 16) / 1000;
			for (let x = bx - 1.2; x <= bx + 0.05; x += step) {
				const r = k.feedProbe(id, [x, by, bz], t);
				hits += r.hits;
				armed = armed && r.armed;
				t += 16;
			}
			k.dropProbe(id);
			return { hits, armed };
		},
		{ uuid, speed }
	);

/**
 * Park the ball INSIDE a gate sensor on the initiator (applyThrow reseats AND zeroes).
 *
 * Two waits, both load-bearing, and both learned from a red run:
 *   1. the pending SERVE. A ball entering a gate while a serve is pending is ignored by
 *      design — it is still sitting in the gate it just scored in.
 *   2. a lap through the CENTRE. The goal detector is an ENTER EDGE per gate, so a ball
 *      left inside the sensor by a gentle post-goal serve is already `inside` that gate:
 *      throwing it there again produces no edge at all and the next goal never fires.
 *      Parking at the centre for a frame clears that latch on the authority, which is
 *      what makes a second goal into the SAME gate assertable.
 */
const teleport = async (page, uuid, pos) => {
	await eventually(() => snap(page), (s) => s?.started && s.serveAt === 0, '  (premise) no serve pending');
	await page.evaluate(
		({ uuid, y }) => window.__stores.physics.applyThrow({ uuid, pos: [0, y, 0], rot: [0, 0, 0], linvel: [0, 0, 0], angvel: [0, 0, 0] }),
		{ uuid, y: pos[1] }
	);
	await page.waitForTimeout(400);
	return page.evaluate(
		({ uuid, pos }) => window.__stores.physics.applyThrow({ uuid, pos, rot: [0, 0, 0], linvel: [0, 0, 0], angvel: [0, 0, 0] }),
		{ uuid, pos }
	);
};

const myVar = (page, name) => page.evaluate((name) => window.__stores.peerVars.peerVarsDebug().mine[name] ?? 0, name);
const rowOf = (page, name, id) => page.evaluate(({ name, id }) => window.__stores.peerVars.leaderboardRows(name).find((r) => r.id === id)?.value ?? 0, { name, id });
const setRules = (page, patch) =>
	page.evaluate((patch) => {
		// the toolbox path: the live Match Rules node when there is one (the replicated
		// nodedata merge), else the module's own replicated rules op
		let graphs = null;
		window.__stores.flowGraphs.subscribe((g) => (graphs = g))();
		let found = null;
		for (const [graphId, graph] of Object.entries(graphs ?? {}))
			for (const n of graph.nodes ?? []) if (n.type === 'fbrules') found = { id: n.id, graphId };
		if (found) {
			window.__stores.nodesHandler.setNodeData(found.id, patch, found.graphId);
			return 'node';
		}
		window.__football.game.setRules(patch);
		return 'op';
	}, patch);

run(async () => {
	const browser = await launch({ args: GPU_ARGS });
	const A = await setupPage(browser, 'A');
	const B = await setupPage(browser, 'B');
	await installModule(A, 'football');
	await installModule(B, 'football');

	// ---- 1. the node family is in the palette ----------------------------------------
	const groups = await A.page.evaluate(
		() => new Promise((r) => window.__stores.moduleSDK.moduleNodeGroups.subscribe((g) => r(g.map((x) => [x.group, x.items.length])))())
	);
	const family = groups.find(([name]) => name === 'Football');
	check(!!family && family[1] === 8, '1.1 node palette has "Football" with 8 nodes (' + JSON.stringify(family) + ')');
	check((await snap(A.page))?.hitSource !== 'none', '1.2 the module found a hit feed (' + (await snap(A.page))?.hitSource + ')');

	// ---- 2. A builds the pitch (the def's objects + graph, through the recipe) ----------
	const names = await A.page.evaluate(() => window.__football.toolbox.buildPitch());
	check(!!names && Object.keys(names).length === 41, '2.1 the recipe built 41 objects (' + Object.keys(names ?? {}).length + ')');
	const ball = names['Football'];
	const redGate = names['Red gate'];
	const blueGate = names['Blue gate'];
	// the zero-g block is the template's data (scene physics has no api write, DEVX #20)
	await A.page.evaluate(() =>
		window.__stores.scenePhysics.setScenePhysics({
			// heavier damping than the template's 0.35: a 3 m/s ball in a 5 m box with 0.7 walls
			// scores on its OWN, which is the game working but makes an expected score a lottery
			gravity: 0, ground: { enabled: false }, damping: { linear: 1.2, angular: 0.5 }, ccd: true,
			knock: { enabled: true, gain: 1, maxSpeed: 10, spin: 0.8 }, play: { interaction: 'grab', grounded: false, simOnPlay: true }
		})
	);
	await eventually(() => snap(A.page), (s) => s?.ball === ball && Object.keys(s.gates).length === 2 && s.buttons.length === 4, '2.2 A: Match Rules names the ball, two gates and four buttons are owned by nodes');
	const a0 = await snap(A.page);
	check(a0.gates[redGate]?.team === 'red' && a0.gates[blueGate]?.team === 'blue', '2.3 the red gate node targets the red sensor, blue the blue');

	// ---- 3. B joins: scene, graph and physics block replicate --------------------------
	await connect(A, B);
	await eventually(
		() => B.page.evaluate((u) => { let g; window.__stores.objectsGroup.subscribe((v) => (g = v))(); return g?.children.length ?? 0; }, ball),
		(n) => n >= 41,
		'3.1 B received the pitch (41 objects)',
		30000
	);
	await eventually(() => snap(B.page), (s) => s?.ball === ball && Object.keys(s.gates).length === 2 && s.buttons.length === 4, '3.2 B: the graph replicated — same ball, gates and buttons', 20000);
	await eventually(() => B.page.evaluate(() => window.__stores.scenePhysics.scenePhysicsDebug()), (p) => p.gravity === 0 && p.knock?.enabled === true, '3.3 B: zero-g + knock block reached B');

	// ---- 4. both play: ONE simulator, elected by core's race rule (simOnPlay) -----------
	// Both presses go in back to back, which puts them INSIDE the sim's start-up window:
	// `maybeSimOnPlay` guards on "nothing is running anywhere", and that is still true on
	// both peers until the other side's `simulate` lands. Before core 29-F both peers
	// simulated and each one's 30 Hz `move` stream pinned every one of the other's bodies
	// under a permanent `hold: 'external'` — this flight passed on TIMING alone, and when
	// it lost the toss the ball snapped back and no goal could score. Core now resolves it
	// with no round trip: THE LOWER PEER ID KEEPS THE WORLD, which is the same tie-break
	// `game.isAuthority()` already falls back to when no sim runs at all.
	const simOf = (page) =>
		page.evaluate(() => {
			const p = window.__stores.physics;
			let own, remote;
			p.simulating.subscribe((v) => (own = v))();
			p.remoteSimulating.subscribe((v) => (remote = v))();
			return { own: !!own, remote: remote ?? null };
		});
	await A.page.locator('#play-button').click();
	await B.page.locator('#play-button').click();
	const low = A.id < B.id ? A : B;
	const high = A.id < B.id ? B : A;
	await eventually(() => simOf(low.page), (v) => v.own === true, `4.1 the LOWER peer id keeps the world (${low === A ? 'A' : 'B'}: ${low.id} < ${high.id})`, 20000);
	await eventually(() => simOf(high.page), (v) => v.own === false && v.remote === low.id, '4.2 the higher id yielded and knows who simulates', 20000);
	await eventually(() => snap(low.page), (s) => s?.authority === true, '4.3 the winner is the match authority (the initiator)');
	check((await snap(high.page))?.authority === false, '4.4 the loser is not');

	// Everything below drives A as the authority (teleports, serve counts, the pitch
	// tools), and which peer wins the toss is an accident of the ids, so hand the world to
	// A before the rest of the flight. Run UNCONDITIONALLY, even when A already won, so
	// every run takes the same path and produces the same checks. Deliberately explicit
	// rather than parameterising eighty lines on `low`: the race and its rule are what
	// section 4 covers, and the fixture for everything after it is A.
	await low.page.evaluate(() => window.__stores.physics.stopSimulation());
	await eventually(() => simOf(A.page), (v) => v.own === false && v.remote === null, '  (premise) the pitch is idle');
	await A.page.evaluate(() => window.__stores.physics.toggleSimulation());
	await eventually(() => simOf(A.page), (v) => v.own === true, '  (premise) A takes the world for the rest of the flight', 20000);
	await eventually(() => simOf(B.page), (v) => v.own === false && v.remote === A.id, '  (premise) B follows A');
	await eventually(() => snap(A.page), (s) => s?.authority === true, '  (premise) ...and is the match authority again');

	// ---- 5. opposite teams through the physical buttons' click path --------------------
	check(await clickObject(A.page, names['Join red']), '5.1 A clicks the Join red button object (module click handler consumed it)');
	check(await clickObject(B.page, names['Join blue']), '5.2 B clicks Join blue');
	await eventually(() => snap(A.page), (s) => s?.slots.red[0] === A.id && s?.slots.blue[0] === B.id, '5.3 A sees red=A, blue=B');
	await eventually(() => snap(B.page), (s) => s?.slots.red[0] === A.id && s?.slots.blue[0] === B.id, '5.4 B agrees');

	// ---- 6. Start serves --------------------------------------------------------------------
	// a gentle kick-off for the flight (the template serves at 3 m/s): the ball must not
	// reach a gate on its own between two assertions
	check((await setRules(A.page, { serveSpeed: 0.8 })) === 'node', '6.0 serveSpeed 0.8 written on the live Match Rules node');
	await eventually(() => snap(B.page), (s) => s?.rules.serveSpeed === 0.8, '  (premise) B reads it');
	check(await clickObject(A.page, names['Start match']), '6.1 A presses Start');
	await eventually(() => snap(B.page), (s) => s?.started === true, '6.2 B: the match started');
	await eventually(() => snap(A.page), (s) => s?.serves >= 1, '6.3 A: the kick-off was served (serveDelay 2s)', 8000);
	await eventually(() => speedOf(A.page, ball), (v) => v != null && v > 0.2, '6.4 the ball moves on the initiator (|v| > 0.2)');
	await eventually(() => snap(B.page), (s) => s?.serves >= 1, '6.5 B logged the serve');

	// ---- 7. B's hit sets lastTouch on both ----------------------------------------------------
	const bHit = await hitBall(B.page, ball, 4);
	check(bHit.armed && bHit.hits >= 1, '7.1 B\'s 4 m/s probe sweep knocks the ball (' + JSON.stringify(bHit) + ')');
	await eventually(() => snap(B.page), (s) => s?.lastTouch?.by === B.id && s.lastTouch.team === 'blue', '7.2 B: lastTouch = B (blue)');
	await eventually(() => snap(A.page), (s) => s?.lastTouch?.by === A.id ? false : s?.lastTouch?.by === B.id, '7.3 A: lastTouch = B too (the hit crossed the wire)');
	await eventually(() => myVar(B.page, 'touches'), (v) => v >= 1, '7.4 B\'s own touches row = ' + (await myVar(B.page, 'touches')));

	// ---- 8. the ball into the RED gate scores for BLUE, in B's row only ------------------------
	const redPos = await posOf(A.page, redGate);
	const servesBefore8 = (await snap(A.page)).serves;
	await teleport(A.page, ball, redPos);
	await eventually(() => snap(A.page), (s) => s?.score.blue === 1 && s.score.red === 0, '8.1 A: score blue 1 — red 0');
	await eventually(() => snap(B.page), (s) => s?.score.blue === 1, '8.2 B: the goal replicated');
	await eventually(() => myVar(B.page, 'goals'), (v) => v === 1, '8.3 B\'s OWN goals row = 1');
	check((await myVar(A.page, 'goals')) === 0, '8.4 A\'s goals row stays 0');
	await eventually(() => rowOf(A.page, 'goals', B.id), (v) => v === 1, '8.5 A\'s leaderboard shows B = 1 (peerVars replicated)');
	await eventually(() => snap(A.page), (s) => s?.serves > servesBefore8, '8.6 the ball is re-served after the goal', 8000);

	// ---- 9. a defender's last touch is an OWN GOAL on the sheet ----------------------------------
	const aHit = await hitBall(A.page, ball, 4);
	check(aHit.hits >= 1, '9.1 A (red) knocks the ball (' + JSON.stringify(aHit) + ')');
	await eventually(() => snap(B.page), (s) => s?.lastTouch?.by === A.id, '9.2 B: lastTouch = A');
	const servesBefore9 = (await snap(A.page)).serves;
	await teleport(A.page, ball, redPos);
	await eventually(() => snap(A.page), (s) => s?.score.blue === 2, '9.3 blue 2 — the own goal counts for blue');
	await eventually(() => myVar(A.page, 'owngoals'), (v) => v === 1, '9.4 A\'s owngoals row = 1');
	check((await myVar(A.page, 'goals')) === 0 && (await myVar(B.page, 'goals')) === 1, '9.5 nobody\'s goals row moved');
	await eventually(() => snap(A.page), (s) => s?.serves > servesBefore9, '9.6 re-served', 8000);

	// ---- 10. counterfactual: ownGoals 'ignore' scores nothing ----------------------------------------
	check((await setRules(A.page, { ownGoals: 'ignore' })) === 'node', '10.1 the rule is edited on the live Match Rules node (replicated graph)');
	await eventually(() => snap(B.page), (s) => s?.rules.ownGoals === 'ignore', '10.2 B reads ownGoals: ignore from the node');
	await hitBall(A.page, ball, 4);
	await eventually(() => snap(A.page), (s) => s?.lastTouch?.by === A.id, '10.3 A touched it');
	const servesBefore10 = (await snap(A.page)).serves;
	await teleport(A.page, ball, redPos);
	await eventually(() => snap(A.page), (s) => s?.serves > servesBefore10, '10.4 the ball is re-served (the goal was seen)...', 8000);
	check((await snap(A.page)).score.blue === 2 && (await myVar(A.page, 'owngoals')) === 1, '10.5 ...but the score and the sheet did not move');
	await setRules(A.page, { ownGoals: 'count' });

	// ---- 11. duel refuses a second red -----------------------------------------------------------------
	await setRules(A.page, { mode: 'duel' });
	await eventually(() => snap(B.page), (s) => s?.rules.mode === 'duel', '11.1 B reads mode duel');
	check(await clickObject(B.page, names['Join red']), '11.2 B presses Join red...');
	await B.page.waitForTimeout(800);
	check((await snap(B.page)).slots.red.length === 1 && (await snap(B.page)).slots.red[0] === A.id && (await snap(B.page)).slots.blue[0] === B.id, '11.3 ...and is refused: red is still A alone, B still blue');
	await setRules(A.page, { mode: 'teams' });
	await eventually(() => snap(B.page), (s) => s?.rules.mode === 'teams', '11.4 (counterfactual) mode teams');
	await clickObject(B.page, names['Join red']);
	await eventually(() => snap(A.page), (s) => s?.slots.red.length === 2, '11.5 ...now B may join red (two reds)');
	await clickObject(B.page, names['Join blue']);
	await eventually(() => snap(A.page), (s) => s?.slots.blue[0] === B.id && s.slots.red.length === 1, '11.6 B back to blue');

	// ---- 12. free for all scores by player ---------------------------------------------------------------------
	await setRules(A.page, { mode: 'freeforall' });
	await eventually(() => snap(B.page), (s) => s?.rules.mode === 'freeforall', '12.1 B reads free for all');
	const bHit2 = await hitBall(B.page, ball, 4);
	check(bHit2.hits >= 1, '12.2 B knocks the ball');
	await eventually(() => snap(A.page), (s) => s?.lastTouch?.by === B.id, '12.3 A: lastTouch = B');
	await teleport(A.page, ball, redPos);
	await eventually(() => snap(A.page), (s) => s?.playerGoals[B.id] === 1, '12.4 A: B\'s player goal counted');
	await eventually(() => snap(B.page), (s) => s?.playerGoals[B.id] === 1 && s.score.blue === 2, '12.5 B agrees; the team score did not move');
	await eventually(() => myVar(B.page, 'goals'), (v) => v === 2, '12.6 B\'s goals row = 2');
	await setRules(A.page, { mode: 'teams' });

	// ---- 13. time mode ends the match for everyone and writes the saved log --------------------------------
	await setRules(A.page, { winBy: 'time', matchSeconds: 30 });
	await eventually(() => snap(A.page), (s) => s?.started === false && s.outcome?.reason === 'time' && s.outcome.winner === 'blue', '13.1 A: time is up — blue wins', 45000);
	await eventually(() => snap(B.page), (s) => s?.started === false && s.outcome?.reason === 'time', '13.2 B: the match ended for everyone');
	await eventually(() => snap(A.page), (s) => s?.log.length === 1 && s.log[0].blue === 2 && s.log[0].winner === 'blue', '13.3 A: the match log has the sheet (B5, gameState.vars)');
	await eventually(() => snap(B.page), (s) => s?.log.length === 1, '13.4 B: the log replicated with the game singleton');
	await eventually(() => A.page.evaluate(() => new Promise((r) => window.__stores.gameState.gameState.subscribe((g) => r(g.state))())), (v) => v === 'over', '13.5 the game shell reads over (Football Event -> Set Game State)');

	// ---- 14. a late joiner reads the same match ----------------------------------------------------------------
	await A.page.keyboard.press('Escape');
	await A.page.waitForTimeout(500);
	const C = await setupPage(browser, 'C');
	await installModule(C, 'football');
	await connect(C, A);
	await eventually(
		() => snap(C.page),
		(s) => !!s && s.score.blue === 2 && s.slots.red[0] === A.id && s.slots.blue[0] === B.id && s.outcome?.winner === 'blue' && s.ball === ball,
		'14.1 late joiner C reads score, slots, outcome and the ball (registerStateSync + graph)',
		30000
	);
	await eventually(() => rowOf(C.page, 'goals', B.id), (v) => v === 2, '14.2 C sees B\'s goals row (peerVars re-announced)');

	// ---- 15. new match resets the score, keeps the sheet -----------------------------------------------------------
	await A.page.evaluate(() => window.__football.game.act('new-match'));
	await eventually(() => snap(B.page), (s) => s?.score.blue === 0 && s.started === false && s.outcome === null, '15.1 B: new match — score 0, menu');
	check((await myVar(B.page, 'goals')) === 2, '15.2 B\'s session goals row survives a new match (records are per session)');

	// ---- 16. B2: the physical UI and the DOM HUD read the same nodes -------------------------
	// the def's HUD document, applied on A through the replicated hud path (the template
	// carries it; the module only fills its lists)
	await A.page.evaluate(() => window.__stores.hudDocs.setHudDocFor('scene', window.__football.hud().scene));
	// play one more goal for the lamps: A starts, B touches, ball into the red gate
	await A.page.evaluate(() => window.__football.game.act('start'));
	await eventually(() => snap(A.page), (s) => s?.started && s.serves > 0 && s.serveAt === 0, '16.1 a fresh match is served', 8000);
	await hitBall(B.page, ball, 4);
	await eventually(() => snap(A.page), (s) => s?.lastTouch?.by === B.id, '16.2 B touched it');
	await teleport(A.page, ball, redPos);
	await eventually(() => snap(B.page), (s) => s?.score.blue === 1, '16.3 blue 1');
	const lamp = (page, name) =>
		page.evaluate((uuid) => {
			let g; window.__stores.objectsGroup.subscribe((v) => (g = v))();
			const o = g?.getObjectByProperty('uuid', uuid);
			return o ? { lit: o.material.userData.fbLit === true, intensity: o.material.emissiveIntensity, hex: o.material.emissive.getHex() } : null;
		}, names[name]);
	await eventually(() => lamp(A.page, 'Blue lamp 1'), (l) => l?.lit && l.intensity > 1, '16.4 A: Blue lamp 1 is lit');
	await eventually(() => lamp(B.page, 'Blue lamp 1'), (l) => l?.lit && l.intensity > 1, '16.5 B: Blue lamp 1 is lit too (same replicated score)');
	check(!(await lamp(A.page, 'Blue lamp 2'))?.lit && !(await lamp(A.page, 'Red lamp 1'))?.lit, '16.6 counterfactual: Blue lamp 2 and Red lamp 1 stay dim');
	const rows = (page, id) => page.evaluate((id) => window.__stores.flowRuntime.hudRowsOf(id), id);
	await eventually(() => rows(A.page, 'fb-score'), (r) => r.some((line) => /RED 0 — 1 BLUE/.test(line)), '16.7 the Records node wrote the score line into the HUD list (' + JSON.stringify(await rows(A.page, 'fb-score')) + ')');
	await eventually(() => rows(B.page, 'fb-sheet'), (r) => r.some((line) => /BLUE/.test(line) && /goals/.test(line)), '16.8 B: the sheet rows carry the sheet');
	await eventually(() => A.page.locator('#hud-layer').textContent(), (t) => /RED 0 — 1 BLUE/.test(t ?? ''), '16.9 the DOM HUD shows the score while playing');
	// a HUD Button press (perPlayer) reaches the Match Button through its `press` input
	await A.page.evaluate(() => window.__stores.flowRuntime.fireHudButton('fb-join-blue'));
	await eventually(() => snap(B.page), (s) => s?.slots.blue.includes(A.id) && !s.slots.red.includes(A.id), '16.10 A joined blue through the HUD button (hudbutton -> fbbutton.press)');
	check(!(await snap(B.page)).slots.blue.includes(C.id), '16.11 counterfactual: the perPlayer press moved nobody else');
	await A.page.evaluate(() => window.__stores.flowRuntime.fireHudButton('fb-join-red'));
	await eventually(() => snap(B.page), (s) => s?.slots.red[0] === A.id && !s.slots.blue.includes(A.id), '16.12 ...and back to red (A LEAVES blue — the check is empty without 16.10)');

	// ---- 17. B3: fit the pitch to a room — replicated moves ------------------------------------------
	const before = await posOf(B.page, blueGate);
	const moved = await A.page.evaluate(() => window.__football.toolbox.fitPitch({ length: 8, width: 4 }));
	check(moved === 40, '17.1 A re-laid the 40 static objects for an 8 x 4 m room, never the live ball (' + moved + ')');
	await eventually(() => posOf(B.page, blueGate), (p) => !!p && p[2] > before[2] + 1, '17.2 B sees the blue gate further out (' + before[2].toFixed(2) + ' -> ' + ((await posOf(B.page, blueGate)) ?? [0, 0, 0])[2].toFixed(2) + ')');
	await eventually(() => posOf(B.page, names['Wall right']), (p) => !!p && Math.abs(p[0] - 2.025) < 0.05, '17.3 the right wall stands at half the new width');
	check((await A.page.evaluate(() => window.__football.toolbox.roomBounds())) === null && (await A.page.evaluate(() => window.__football.toolbox.roomAnchor())) === null, '17.4 headless: no XR bounds and no room anchor — the sliders are the fallback');

	await finish(browser);
});
