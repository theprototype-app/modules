// football 30b test-flight — "when the ball reaches the gate nothing changes" (the Quest 3
// feedback). The REAL zip on two peers, the pitch built by the module's own recipe, both in
// play with the sim on A:
//   1 NOBODY presses Start: B's hit (core's knock probe) KICKS OFF a match and seats B on a
//     team — the headset never saw the DOM menu, so before 30b no match ever started and no
//     goal could count
//   2 the kick-off: a 3-2-1 countdown on BOTH peers (announce, derived from the start stamp),
//     the ball held on the centre spot, then a whistle and a slow nudge into the kicking
//     team's own half that never reaches its net
//   3 a goal: the score, "GOAL!" with "Red 0 - 1 Blue", goal + cheer, confetti in the
//     scorer's colour, success/fail haptics by team — on the authority AND the other peer
//   4 after it: the ball rests in the net (the celebration, the clock stopped), then goes
//     back to the centre spot and the CONCEDING team kicks off into its own half
//   5 the end: level at the whistle is a GOLDEN GOAL, the next goal ends it with the final
//     whistle and "RED WINS!"; Rematch starts again with the same sides
//
//   npm run build:football && npm run pack -- football
//   flock -w 5400 /tmp/tp-e2e.lock env APP_URL=https://theprototype.app:5245/ npm test -- football-match
//
// What the game ASKED the core for (announce, sounds, bursts, haptics) is read from the
// module's own call log (`__football.game.fx.log()`), which records the call whether or not
// this core has the 30b calls — the flight runs on a 1.17 engine and on the 30b union.

const { launch, setupPage, installModule, connect, check, eventually, finish, run, GPU_ARGS } = require('./helpers.cjs');

const snap = (page) => page.evaluate(() => window.__football?.snapshot() ?? null);
const fxLog = (page) => page.evaluate(() => window.__football.game.fx.log());
const clearFx = (page) => page.evaluate(() => window.__football.game.fx.clearLog());
const phaseOf = (page) => page.evaluate(() => window.__football.game.phase());
const posOf = (page, uuid) =>
	page.evaluate((uuid) => {
		let g = null;
		window.__stores.objectsGroup.subscribe((v) => (g = v))();
		return g?.getObjectByProperty('uuid', uuid)?.position.toArray() ?? null;
	}, uuid);
/** a knock probe swept along +x through the ball's CURRENT position — core's feedProbe */
const hitBall = (page, uuid, speed = 4) =>
	page.evaluate(
		({ uuid, speed }) => {
			let g = null;
			window.__stores.objectsGroup.subscribe((v) => (g = v))();
			const o = g?.getObjectByProperty('uuid', uuid);
			if (!o) return { hits: 0, armed: false };
			const k = window.__stores.knock;
			const id = 'fm-' + Math.random().toString(36).slice(2, 6);
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
/** throw the ball (initiator) — through the centre first: the goal detector is an ENTER edge */
const into = async (page, uuid, pos) => {
	await page.evaluate(({ uuid, y }) => window.__stores.physics.applyThrow({ uuid, pos: [0, y, 0], rot: [0, 0, 0], linvel: [0, 0, 0], angvel: [0, 0, 0] }), { uuid, y: pos[1] });
	await page.waitForTimeout(300);
	await page.evaluate(({ uuid, pos }) => window.__stores.physics.applyThrow({ uuid, pos, rot: [0, 0, 0], linvel: [0, 0, 0], angvel: [0, 0, 0] }), { uuid, pos });
};
const setRules = (page, patch) =>
	page.evaluate((patch) => {
		let graphs = null;
		window.__stores.flowGraphs.subscribe((g) => (graphs = g))();
		for (const [graphId, graph] of Object.entries(graphs ?? {}))
			for (const n of graph.nodes ?? []) if (n.type === 'fbrules') {
				window.__stores.nodesHandler.setNodeData(n.id, patch, graphId);
				return true;
			}
		return false;
	}, patch);
const has = (log, kind, name, pred = () => true) => log.some((c) => c.kind === kind && c.name === name && pred(c));

run(async () => {
	const browser = await launch({ args: GPU_ARGS });
	const A = await setupPage(browser, 'A');
	const B = await setupPage(browser, 'B');
	await installModule(A, 'football');
	await installModule(B, 'football');

	const names = await A.page.evaluate(() => window.__football.toolbox.buildPitch());
	const ball = names['Football'];
	const redGate = names['Red gate'];
	const blueGate = names['Blue gate'];
	await A.page.evaluate(() =>
		window.__stores.scenePhysics.setScenePhysics({
			gravity: 0, ground: { enabled: false }, damping: { linear: 1.2, angular: 0.5 }, ccd: true,
			knock: { enabled: true, gain: 1, maxSpeed: 10, spin: 0.8 }, play: { interaction: 'grab', grounded: false, simOnPlay: true }
		})
	);
	await eventually(() => snap(A.page), (s) => s?.ball === ball && Object.keys(s.gates).length === 2, '0.1 A: the module owns the ball and both gates');
	await connect(A, B);
	await eventually(() => snap(B.page), (s) => s?.ball === ball && Object.keys(s.gates).length === 2, '0.2 B: the pitch and its graph replicated', 30000);
	// A plays first and steps the world (the authority); B follows
	await A.page.locator('#play-button').click();
	await eventually(() => A.page.evaluate(() => { let v; window.__stores.physics.simulating.subscribe((x) => (v = x))(); return v; }), (v) => v === true, '0.3 A simulates (simOnPlay)', 20000);
	await B.page.locator('#play-button').click();
	await eventually(() => snap(A.page), (s) => s?.authority === true, '0.4 A is the match authority');
	const redPos = await posOf(A.page, redGate);
	const bluePos = await posOf(A.page, blueGate);

	// ---- 1. nobody pressed Start: the first touch kicks a match off -----------------------
	const s0 = await snap(A.page);
	check(s0.started === false && s0.slots.red.length + s0.slots.blue.length === 0, '1.0 (premise) no match, nobody seated — the state a headset player was stuck in');
	await clearFx(A.page);
	await clearFx(B.page);
	const hit1 = await hitBall(B.page, ball, 4);
	check(hit1.armed && hit1.hits >= 1, "1.1 B's knock probe hits the ball (" + JSON.stringify(hit1) + ')');
	await eventually(() => snap(A.page), (s) => s?.started === true, '1.2 A: that touch STARTED a match (no Start press anywhere)');
	await eventually(() => snap(A.page), (s) => (s.slots.red.includes(B.id) || s.slots.blue.includes(B.id)), '1.3 ...and seated B on a team (auto-balance)');
	check((await snap(B.page)).started === true, '1.4 B agrees the match is on');
	const spot = [(redPos[0] + bluePos[0]) / 2, (redPos[1] + bluePos[1]) / 2, (redPos[2] + bluePos[2]) / 2];
	await A.page.waitForTimeout(700);
	check((await phaseOf(A.page)) === 'countdown', '1.5 the match opens on the kick-off countdown');
	const heldAt = await posOf(A.page, ball);
	check(Math.hypot(heldAt[0] - spot[0], heldAt[1] - spot[1], heldAt[2] - spot[2]) < 0.05, '1.6 ...with the ball held on the centre spot, whatever the touch did to it (' + heldAt.map((n) => n.toFixed(2)) + ')');

	// ---- 2. the kick-off countdown ------------------------------------------------------------
	const kickTeam = (await snap(A.page)).kickTeam;
	await eventually(() => fxLog(B.page), (log) => ['3', '2', '1'].every((n) => has(log, 'announce', n, (c) => /kicks off/.test(c.opts?.sub ?? ''))), '2.1 B shows 3, 2, 1 "' + kickTeam + ' kicks off" (derived from the start stamp, no message)', 8000);
	await eventually(() => fxLog(A.page), (log) => ['3', '2', '1'].every((n) => has(log, 'announce', n)), '2.2 A shows the same countdown', 8000);
	await eventually(() => snap(A.page), (s) => s?.serves >= 1, '2.4 the kick-off is served', 8000);
	await eventually(() => fxLog(B.page), (log) => has(log, 'sound', 'whistle') && has(log, 'announce', 'GO!'), '2.5 B: the kick-off whistle and GO!');
	const kickGate = kickTeam === 'red' ? redPos : bluePos;
	const side = Math.sign(kickGate[2] - spot[2]);
	await eventually(() => posOf(A.page, ball), (p) => (p[2] - spot[2]) * side > 0.15, '2.6 the nudge rolls the ball into the ' + kickTeam + " team's OWN half", 4000);
	await A.page.waitForTimeout(2500);
	const s2 = await snap(A.page);
	check(s2.score.red === 0 && s2.score.blue === 0 && Math.abs((await posOf(A.page, ball))[2] - spot[2]) < Math.abs(kickGate[2] - spot[2]) - 0.3, '2.7 ...and stops short of that net (no kick-off own goal)');

	// ---- 3. a goal: the ball into the RED gate scores for BLUE ----------------------------------
	await clearFx(A.page);
	await clearFx(B.page);
	const elapsedBefore = await A.page.evaluate(() => window.__football.game.elapsed());
	await into(A.page, ball, redPos);
	await eventually(() => snap(A.page), (s) => s?.score.blue === 1 && s.score.red === 0, '3.1 A: blue 1 — red 0');
	await eventually(() => snap(B.page), (s) => s?.score.blue === 1, '3.2 B: the score replicated');
	for (const [peer, who] of [[A, 'A'], [B, 'B']]) {
		const log = await fxLog(peer.page);
		check(has(log, 'announce', 'GOAL!', (c) => c.opts?.sub === 'Red 0 - 1 Blue') || has(log, 'announce', 'GOAL!', (c) => /Red 0 - 1 Blue/.test(c.opts?.sub ?? '')), '3.3 ' + who + ': announce("GOAL!", sub "Red 0 - 1 Blue")');
		check(has(log, 'sound', 'goal') && has(log, 'sound', 'cheer'), '3.4 ' + who + ': goal + cheer sounds');
		check(has(log, 'burst', 'confetti', (c) => c.opts?.color === '#4f86e6'), '3.5 ' + who + ": confetti in BLUE (the scorers') colour");
	}
	const bTeam = (await snap(B.page)).slots.blue.includes(B.id) ? 'blue' : 'red';
	const bLog = await fxLog(B.page);
	check(has(bLog, 'haptic', bTeam === 'blue' ? 'success' : 'fail'), '3.6 B (' + bTeam + ') feels ' + (bTeam === 'blue' ? 'success — its team scored' : 'fail — its team conceded'));
	check(!has(bLog, 'haptic', bTeam === 'blue' ? 'fail' : 'success'), '  counterfactual: and not the other one');

	// ---- 4. the celebration, then the conceding team kicks off -----------------------------------
	check((await phaseOf(A.page)) === 'celebrate', '4.1 the goal opens the celebration');
	await A.page.waitForTimeout(1200);
	const inNet = await posOf(A.page, ball);
	check(Math.hypot(inNet[0] - redPos[0], inNet[2] - redPos[2]) < 0.35, '4.2 the ball RESTS in the red net during it (' + inNet.map((n) => n.toFixed(2)) + ')');
	const e1 = await A.page.evaluate(() => window.__football.game.elapsed());
	await A.page.waitForTimeout(800);
	const e2 = await A.page.evaluate(() => window.__football.game.elapsed());
	check(Math.abs(e2 - e1) < 0.05 && e1 >= elapsedBefore - 0.01, '4.3 the clock is STOPPED while it celebrates (' + e1.toFixed(2) + ' -> ' + e2.toFixed(2) + ')');
	await eventually(() => phaseOf(A.page), (p) => p === 'countdown', '4.4 then the countdown', 4000);
	check((await snap(A.page)).kickTeam === 'red', '4.5 the CONCEDING team (red) kicks off');
	await A.page.waitForTimeout(400);
	const back = await posOf(A.page, ball);
	check(Math.hypot(back[0] - spot[0], back[1] - spot[1], back[2] - spot[2]) < 0.05, '4.6 the ball is back on the centre spot (' + back.map((n) => n.toFixed(2)) + ')');
	const servesBefore = (await snap(A.page)).serves;
	await eventually(() => snap(A.page), (s) => s.serves > servesBefore, '4.7 the kick-off is served', 6000);
	const redSide = Math.sign(redPos[2] - spot[2]);
	await eventually(() => posOf(A.page, ball), (p) => (p[2] - spot[2]) * redSide > 0.15, "4.8 ...into RED's own half", 4000);

	// ---- 5. golden goal, the final whistle, rematch ---------------------------------------------------
	// level it (the ball into the blue gate scores for red), then a 30 s clock (the minimum)
	await eventually(() => phaseOf(A.page), (p) => p === 'live', '  (premise) live');
	await into(A.page, ball, bluePos);
	await eventually(() => snap(A.page), (s) => s?.score.red === 1 && s.score.blue === 1, '5.1 level at 1 — 1');
	check(await setRules(A.page, { winBy: 'time', matchSeconds: 30 }), '5.2 a 30 s clock on the live Match Rules node');
	await clearFx(A.page);
	await clearFx(B.page);
	await eventually(() => A.page.evaluate(() => window.__football.game.golden()), (g) => g === true, '5.3 level at full time: GOLDEN GOAL (the match plays on)', 60000);
	check((await snap(A.page)).started === true && (await snap(A.page)).outcome === null, '  counterfactual: no result was declared');
	await eventually(() => fxLog(B.page), (log) => has(log, 'announce', 'GOLDEN GOAL'), '5.4 B shows the golden-goal banner');
	await eventually(() => phaseOf(A.page), (p) => p === 'live', '  (premise) live', 12000);
	await into(A.page, ball, bluePos);
	await eventually(() => snap(A.page), (s) => s?.started === false && s.outcome?.winner === 'red', '5.5 the golden goal ends it: RED wins', 10000);
	await eventually(() => snap(B.page), (s) => s?.outcome?.winner === 'red', '5.6 B: the result replicated');
	await eventually(() => fxLog(B.page), (log) => has(log, 'announce', 'RED WINS!', (c) => /Red 2 - 1 Blue/.test(c.opts?.sub ?? '')) && log.filter((c) => c.kind === 'sound' && c.name === 'whistle').length >= 1, '5.7 B: the final whistle and "RED WINS!" "Red 2 - 1 Blue"');
	await A.page.evaluate(() => window.__football.game.act('rematch'));
	await eventually(() => snap(B.page), (s) => s?.started === true && s.score.red === 0 && s.score.blue === 0 && (s.slots.red.includes(B.id) || s.slots.blue.includes(B.id)), '5.8 Rematch: a new match, 0 — 0, the same sides');
	await eventually(() => phaseOf(B.page), (p) => p === 'countdown', '5.9 ...straight into the kick-off countdown');

	await finish(browser);
});
