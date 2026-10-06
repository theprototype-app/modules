// 37-fx flight — Blocks 1.0.0 (R19) and the car's steered front knuckles (car 1.3.0, R17),
// both from their REAL zips through the real manager.
//
// BLOCKS: a drop is ONE message (seed + point); every peer builds the same 100 bodies in its
// own local rapier world and draws them as ONE InstancedMesh. Checked on two peers + a late
// joiner: the count, one draw object, the piles agreeing, the step cost, clear.
// CAR: the spawn builds 2 knuckles on the +Z axle (a Y revolute from the body with limits, no
// self-contacts and an angle motor, the wheel on an X revolute off the knuckle); a drive op
// (the message a driver sends) moves it forward along +Z, and steering turns its heading,
// where the same drive with steer 0 does not.
//
//   npm run pack -- blocks && npm run pack -- car
//   APP_URL=https://theprototype.app:5359/ node tests/fx-car-blocks.test.cjs
const h = require('./helpers.cjs');

const blocks = (peer) => peer.page.evaluate(() => window.__blocks?.stats() ?? null);
const poses = (peer, n) =>
	peer.page.evaluate((k) => Array.from({ length: k }, (_, i) => window.__blocks.pose(i)), n);

async function pressMenu(peer, cardId, label) {
	await h.openModules(peer.page);
	await peer.page.waitForTimeout(300);
	await peer.page.locator('#user-module-card-' + cardId).getByRole('button', { name: label }).click();
	await peer.page.evaluate(() => window.__stores.modulesOpen.set(false));
}

h.run(async () => {
	const browser = await h.launch();
	const A = await h.setupPage(browser, 'A');
	const B = await h.setupPage(browser, 'B');
	await h.installModule(A, 'blocks');
	await h.installModule(B, 'blocks');
	await h.connect(B, A);

	// ---- BLOCKS ---------------------------------------------------------------------------
	await pressMenu(A, 'blocks', 'Blocks: drop 100 blocks');
	await h.eventually(() => blocks(A), (s) => s?.count === 100 && s.bodies === 100, 'A: 100 blocks dropped', 15000);
	await h.eventually(() => blocks(B), (s) => s?.count === 100, 'B: the drop arrives as one message and builds the same 100', 15000);
	const seeds = await Promise.all([A, B].map((p) => p.page.evaluate(() => window.__blocks.lastDrop()?.seed)));
	h.check(seeds[0] != null && seeds[0] === seeds[1], `both peers built from the same seed (${seeds.join(' / ')})`);
	const objects = await A.page.evaluate(() => {
		let scene;
		window.__stores.globalScene.subscribe((s) => (scene = s))();
		const found = [];
		scene.traverse((o) => o.name === 'blocks-instances' && found.push({ instanced: !!o.isInstancedMesh, count: o.count }));
		let group;
		window.__stores.objectsGroup.subscribe((g) => (group = g))();
		let leaked = false;
		group.traverse((o) => (leaked = leaked || o.name === 'blocks-instances'));
		return { found, leaked };
	});
	h.check(
		objects.found.length === 1 && objects.found[0].instanced && objects.found[0].count === 100 && !objects.leaked,
		`ONE InstancedMesh draws all 100, at the scene root (${JSON.stringify(objects)})`
	);
	await h.eventually(() => blocks(A), (s) => s && !s.running, 'the pile settles and the local world stops stepping', 60000);
	const stA = await blocks(A);
	console.log(`(perf) steps ${stA.steps}, avg step ${stA.stepMs.toFixed(2)} ms, worst ${stA.maxStepMs.toFixed(2)} ms, statics ${stA.statics}`);
	h.check(stA.stepMs < 8, `a step of 100 bodies stays cheap (avg ${stA.stepMs.toFixed(2)} ms)`);
	await h.eventually(() => blocks(B), (s) => s && !s.running, 'B settles too', 60000);
	const [pa, pb] = [await poses(A, 100), await poses(B, 100)];
	const onGround = pa.filter((p) => p && p[1] > 0 && p[1] < 3).length;
	h.check(onGround > 90, `the blocks landed and piled (${onGround}/100 between the ground and 3 m)`);
	const drift = pa.map((p, i) => Math.hypot(p[0] - pb[i][0], p[1] - pb[i][1], p[2] - pb[i][2]));
	const mean = drift.reduce((a, b) => a + b, 0) / drift.length;
	console.log(`(determinism) mean block distance between the two peers' piles: ${mean.toFixed(4)} m, max ${Math.max(...drift).toFixed(4)} m`);
	h.check(mean < 0.25, `the two peers' piles agree closely (mean ${mean.toFixed(3)} m)`);

	// a late joiner replays the last drop from its seed
	const C = await h.setupPage(browser, 'C');
	await h.installModule(C, 'blocks');
	await h.connect(C, A);
	await h.eventually(() => blocks(C), (s) => s?.count === 100, 'a late joiner (C) rebuilds the last drop', 20000);
	await C.ctx.close();

	await pressMenu(A, 'blocks', 'Blocks: clear');
	await h.eventually(() => blocks(B), (s) => s?.count === 0, 'clear reaches B');

	// ---- CAR ------------------------------------------------------------------------------
	await h.installModule(A, 'car');
	await A.page.evaluate(() => window.__stores.physics.warmup().catch(() => {}));
	await pressMenu(A, 'car', 'Car: spawn demo car');
	const jointsOf = () => A.page.evaluate(() => new Promise((r) => window.__stores.joints.sceneJoints.subscribe(r)()));
	await h.eventually(jointsOf, (j) => j.length >= 6, 'the car spawns 6 joints (2 axles, 2 knuckles, 2 knuckle axles)', 20000);
	const js = await jointsOf(); // this helper's eventually() returns the CHECK, not the value
	const steer = (js ?? []).filter((d) => Math.abs(d.axisA?.[1] ?? 0) > 0.5);
	h.check(
		steer.length === 2 && steer.every((d) => d.contacts === false && Array.isArray(d.limits) && d.motor?.pos === 0),
		`two knuckles on Y revolutes with limits, no self-contacts and an angle motor (${JSON.stringify(steer.map((d) => ({ l: d.limits, c: d.contacts, m: d.motor })))})`
	);
	const carId = steer[0]?.a;
	const pose = () =>
		A.page.evaluate((u) => {
			let g;
			window.__stores.objectsGroup.subscribe((x) => (g = x))();
			const o = g.getObjectByProperty('uuid', u);
			const fwd = new o.position.constructor(0, 0, 1).applyQuaternion(o.quaternion);
			const up = new o.position.constructor(0, 1, 0).applyQuaternion(o.quaternion);
			return { p: o.position.toArray(), heading: Math.atan2(fwd.x, fwd.z), up: up.y };
		}, carId);
	const drive = (throttle, steerValue) =>
		A.page.evaluate(
			([id, t, s]) => window.__stores.moduleSDK.applyModuleMessage({ moduleId: 'car', op: 'drive', carId: id, throttle: t, steer: s }),
			[carId, throttle, steerValue]
		);
	await A.page.evaluate(() => window.__stores.physics.toggleSimulation());
	await h.eventually(() => A.page.evaluate(() => window.__stores.physics.isInitiator()), (v) => v === true, 'simulation running', 15000);
	await A.page.waitForTimeout(1500);
	const p0 = await pose();
	await drive(1, 0);
	await A.page.waitForTimeout(2500);
	const p1 = await pose();
	const dz = p1.p[2] - p0.p[2];
	const turnStraight = p1.heading - p0.heading;
	h.check(dz > 1, `throttle drives the car forward along +Z (dz ${dz.toFixed(2)} m, heading change ${turnStraight.toFixed(3)} rad)`);
	await drive(1, 1);
	await A.page.waitForTimeout(2500);
	const p2 = await pose();
	let turn = p2.heading - p1.heading;
	if (turn > Math.PI) turn -= 2 * Math.PI;
	if (turn < -Math.PI) turn += 2 * Math.PI;
	console.log(`(steer) heading change with steer 1: ${turn.toFixed(3)} rad, straight: ${turnStraight.toFixed(3)} rad, up ${p2.up.toFixed(2)}`);
	h.check(Math.abs(turn) > 0.3 && Math.abs(turn) > 4 * Math.abs(turnStraight), `steering turns the heading (${turn.toFixed(2)} rad vs ${turnStraight.toFixed(2)} straight)`);
	h.check(turn < 0, `steer right (D) turns right: facing +Z, toward -X (heading change ${turn.toFixed(2)} < 0)`);
	h.check(p2.up > 0.8 && p2.p.every(Number.isFinite), `the car stays upright through the turn (up ${p2.up.toFixed(2)})`);
	await drive(0, 0);
	await A.page.evaluate(() => window.__stores.physics.stopSimulation());

	await h.finish(browser);
});
