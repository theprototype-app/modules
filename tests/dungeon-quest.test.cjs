// Dungeon — the Quest round (roadmap 31) test-flight: the REAL dungeon zip, one peer.
//
// D1 "In VR there is stuttering when I'm moving through the dungeon": round 2 drew EVERY torch
// of the floor every frame (the props-kit WallTorch, ~650 triangles each, + flame, core, halo,
// pool) and lit it with four point lights everywhere. Now:
//   1 the EDITOR keeps its overview — every torch drawn, four lights
//   2 a GAME view (Interact) draws only the torches near the viewer: fewer than all, every drawn
//     one within the tier's radius, the torch triangles inside the Quest budget
//   3 the set FOLLOWS the viewer: fly across the floor and the torches there are drawn now
//   4 a HEADSET (isVRMode) is tier 1: two real lights; a lower api.quality (stood in on the
//     module's own api, feature-detected like 31-perf's) hides the halos and keeps one light
// D2 "I would like to be able to teleport but not outside the dungeon walls":
//   5 the contract publishes bounds + colliders; teleport is ON only where core bounds it
//     (api.locomotion.boundedTeleport, 31-vr-core) — on an older core it stays OFF
//   6 on a core with K1 (vrControls.teleportVerdict): a floor target in the room is ok, a target
//     BEHIND A WALL is refused, a target outside the bounds is refused; without K1: SKIP (owed)
//
//   npm run pack -- dungeon
//   e2e-slot -- env E2E_GPU=1 APP_URL=https://theprototype.app:5268/ node tests/dungeon-quest.test.cjs

const { launch, setupPage, installModule, check, eventually, finish, run } = require('./helpers.cjs');

/** eventually() that RETURNS the value it settled on (the helper returns nothing) */
async function settle(fn, predicate, label, timeout = 10000) {
	const start = Date.now();
	let last;
	while (Date.now() - start < timeout) {
		last = await fn();
		if (predicate(last)) {
			check(true, label);
			return last;
		}
		await new Promise((r) => setTimeout(r, 300));
	}
	console.log('  last: ' + JSON.stringify(last));
	check(false, label);
	return last;
}

/** what the Kit draws now, and where the viewer is (the Kit's frame = world at 1:1) */
const drawn = (page) =>
	page.evaluate(() => {
		let scene, cam;
		window.__stores.globalScene.subscribe((v) => (scene = v))();
		window.__stores.globalCamera.subscribe((v) => (cam = v))();
		const kit = scene.getObjectByName('dungeon-module');
		const g = kit.getObjectByName('dk-floor');
		const dk = g.userData._dk;
		const eye = cam.getWorldPosition(new window.__stores.THREE.Vector3());
		const mesh = (n) => g.getObjectByName(n);
		const iron = mesh('dk-torch-iron');
		// the drawn torch positions: instance translations of the iron part
		const at = [];
		for (let i = 0; i < iron.count; i++) at.push([iron.instanceMatrix.array[i * 16 + 12], iron.instanceMatrix.array[i * 16 + 14]]);
		const tris = ['dk-torch-iron', 'dk-torch-oak', 'dk-torch-cloth'].reduce((t, n) => t + (mesh(n).geometry.index.count / 3) * mesh(n).count, 0);
		return {
			torches: kit.userData.play.props.filter((p) => p.kind === 'torch').length,
			solid: iron.count,
			flames: mesh('dk-flames').count,
			halos: mesh('dk-halos').count,
			halosVisible: mesh('dk-halos').visible,
			pools: mesh('dk-pools').count,
			lights: g.children.filter((c) => c.name === 'dk-light').length,
			lightsOn: g.children.filter((c) => c.name === 'dk-light' && c.visible).length,
			maxSolidDist: at.reduce((m, [x, z]) => Math.max(m, Math.hypot(x - eye.x, z - eye.z)), 0),
			torchTris: tris,
			quality: dk.quality,
			eye: [eye.x, eye.z],
			mode: (() => { let m; window.__stores.editorMode.subscribe((v) => (m = v))(); return m; })()
		};
	});

run(async () => {
	const browser = await launch();
	const A = await setupPage(browser, 'A', { context: { viewport: { width: 1280, height: 720 } } });
	await installModule(A, 'dungeon');
	await A.page.evaluate(() => window.__dungeonKit.kit.generate(1337, {}));
	await eventually(() => A.page.evaluate(() => !!window.__dungeonKit.kit.stats()), (v) => v, 'the Kit generated seed 1337');
	await A.page.waitForTimeout(600);

	// ---- 1. the editor: the overview -------------------------------------------------------
	const edit = await drawn(A.page);
	check(edit.mode !== 'interact', '(premise: the Edit view)');
	check(edit.torches > 100 && edit.solid === edit.torches && edit.halos === edit.torches && edit.flames >= edit.torches, '1 the EDITOR draws every torch (' + edit.solid + '/' + edit.torches + ' torches, ' + edit.flames + ' flames, ' + edit.halos + ' halos)');
	check(edit.lights === 4 && edit.lightsOn === 4, '  and keeps four real lights on a desktop at the best quality (' + edit.lightsOn + ')');

	// ---- 2. a game view: only the torches near the viewer -------------------------------------
	const entrance = await A.page.evaluate(() => {
		let scene;
		window.__stores.globalScene.subscribe((v) => (scene = v))();
		// a published room is its top-left corner + size (contract.worldRoom): the spawn cell's centre
		const r = scene.getObjectByName('dungeon-module').userData.play.rooms[0];
		return [Math.floor(r.x + r.w / 2) + 0.5, Math.floor(r.y + r.h / 2) + 0.5];
	});
	await A.page.evaluate((e) => window.__stores.objectActions.setEditorMode('interact'), entrance);
	await A.page.waitForTimeout(300);
	await A.page.evaluate((e) => window.__stores.objectActions.flyTo([e[0], 1.6, e[1]], [e[0] + 1, 1.5, e[1]], 1), entrance);
	const near = await settle(() => drawn(A.page), (d) => d.mode === 'interact' && Math.hypot(d.eye[0] - entrance[0], d.eye[1] - entrance[1]) < 1.5 && d.solid < d.torches, '2 in INTERACT (a game view) the Kit draws only the torches near the viewer', 8000);
	check(near.solid > 0 && near.maxSolidDist <= near.quality.solidRadius + 1e-6, '  every drawn torch within the tier\'s ' + near.quality.solidRadius + ' m (' + near.solid + '/' + near.torches + ', farthest ' + near.maxSolidDist.toFixed(1) + ' m)');
	check(near.flames < edit.flames && near.halos < edit.halos, '  flames and halos culled too (' + near.flames + '/' + edit.flames + ', ' + near.halos + '/' + edit.halos + ')');
	check(near.torchTris < 60000 && edit.torchTris > 100000, '  torch triangles ' + Math.round(edit.torchTris / 1000) + 'k -> ' + Math.round(near.torchTris / 1000) + 'k (the Quest budget is 300k for the whole frame)');

	// ---- 3. the set follows the viewer ----------------------------------------------------------
	const far = await A.page.evaluate((e) => {
		let scene;
		window.__stores.globalScene.subscribe((v) => (scene = v))();
		const spots = scene.getObjectByName('dungeon-module').getObjectByName('dk-floor').userData._dk.torchSpots;
		let best = null, d = 0;
		for (const s of spots) {
			const k = Math.hypot(s.x - e[0], s.z - e[1]);
			if (k > d) { d = k; best = s; }
		}
		return { x: best.x, z: best.z, d };
	}, entrance);
	await A.page.evaluate((f) => window.__stores.objectActions.flyTo([f.x, 1.6, f.z], [f.x + 1, 1.5, f.z], 1), far);
	const moved = await settle(
		() => drawn(A.page),
		(d) => Math.hypot(d.eye[0] - far.x, d.eye[1] - far.z) < 1.5 && d.solid > 0 && d.maxSolidDist <= d.quality.solidRadius + 1e-6,
		'3 the viewer flies ' + far.d.toFixed(0) + ' m across the floor: the drawn set FOLLOWS (every drawn torch near the new spot)',
		8000
	);
	check(moved.solid > 0, '  (' + moved.solid + ' torches drawn there)');

	// ---- 4. a headset, a lower quality -----------------------------------------------------------
	await A.page.evaluate(() => window.__stores.isVRMode.set(true));
	const vr = await settle(() => drawn(A.page), (d) => d.quality.tier >= 1, '4 a HEADSET: the Kit drops to tier 1');
	check(vr.lights === 4 && vr.lightsOn === 2, '  two real lights on (the Quest budget: <= 2), the other two hidden, never removed (' + vr.lightsOn + '/' + vr.lights + ')');
	check(vr.maxSolidDist <= vr.quality.solidRadius + 1e-6 && vr.quality.solidRadius < near.quality.solidRadius, '  a tighter torch radius (' + vr.quality.solidRadius + ' m)');
	await A.page.evaluate(() => window.__stores.isVRMode.set(false));
	await eventually(() => drawn(A.page), (d) => d.quality.tier === 0 && d.lightsOn === 4, '  leaving the headset: four lights again');
	// api.quality (31-perf) stood in on the Kit's OWN api object: level 6 = tier 3
	await A.page.evaluate(() => {
		const listeners = [];
		window.__dungeonKit.api.quality = { level: 6, max: 9, onChange: (fn) => listeners.push(fn) };
	});
	const low = await settle(() => drawn(A.page), (d) => d.quality.tier === 3, '  api.quality.level 6 (feature-detected): tier 3');
	check(low.lightsOn === 1 && !low.halosVisible && low.maxSolidDist <= low.quality.solidRadius + 1e-6, '  one light, no halos/pools, torches within ' + low.quality.solidRadius + ' m (' + low.lightsOn + ' light, halos ' + (low.halosVisible ? 'on' : 'off') + ')');
	await A.page.evaluate(() => delete window.__dungeonKit.api.quality);
	await eventually(() => drawn(A.page), (d) => d.quality.tier === 0 && d.lightsOn === 4 && d.halosVisible, '  without api.quality: the full look again');

	// back to the editor: the overview returns
	await A.page.evaluate(() => window.__stores.objectActions.setEditorMode('edit'));
	await eventually(() => drawn(A.page), (d) => d.solid === d.torches, '1b back in the EDITOR every torch is drawn again');

	// ---- 5. D2: bounds, colliders, teleport where core bounds it --------------------------------
	const contract = await A.page.evaluate(() => {
		let scene;
		window.__stores.globalScene.subscribe((v) => (scene = v))();
		const play = scene.getObjectByName('dungeon-module').userData.play;
		const resolved = window.__stores.playSettings.resolvePlaySettings(scene);
		return {
			bounds: play.bounds,
			colliders: play.colliders.length,
			teleport: play.locomotion.teleport,
			fly: play.locomotion.fly,
			resolved: resolved.locomotion,
			bounded: window.__dungeonKit.api.locomotion?.boundedTeleport === true,
			verdict: typeof window.__stores.vrControls?.teleportVerdict === 'function'
		};
	});
	check(!!contract.bounds && contract.bounds.min.length === 3 && contract.colliders > 20, '5 the contract carries play.bounds + ' + contract.colliders + ' colliders');
	check(contract.fly === false, '  fly stays OFF');
	if (contract.bounded) {
		check(contract.teleport === true && contract.resolved.teleport === true, '  core bounds teleport (api.locomotion.boundedTeleport): the dungeon turns it ON, and core resolves it on');
	} else {
		check(contract.teleport === false && contract.resolved.teleport === false, '  this core does NOT bound teleport (no api.locomotion.boundedTeleport): teleport stays OFF (a free teleport would leave the walls)');
		// the Kit re-publishes on a new world: a core that says it bounds teleport gets it
		await A.page.evaluate(() => {
			window.__dungeonKit.api.locomotion = Object.freeze({ boundedTeleport: true });
			window.__dungeonKit.kit.generate(1337, { roomCount: 20 });
		});
		const on = await settle(
			() => A.page.evaluate(() => { let s; window.__stores.globalScene.subscribe((v) => (s = v))(); return s.getObjectByName('dungeon-module').userData.play.locomotion.teleport; }),
			(v) => v === true,
			'  with api.locomotion.boundedTeleport stood in, the published contract turns teleport ON'
		);
		await A.page.evaluate(() => {
			delete window.__dungeonKit.api.locomotion;
			window.__dungeonKit.kit.generate(1337, {});
		});
	}

	// ---- 6. K1's verdicts (31-vr-core) ------------------------------------------------------------
	if (!contract.verdict) {
		console.log('SKIP 6: this core has no vrControls.teleportVerdict (31-vr-core K1 not in this build) — the wall/bounds verdicts are OWED on the union');
	} else {
		const v = await A.page.evaluate(() => {
			let scene;
			window.__stores.globalScene.subscribe((x) => (scene = x))();
			const kitGroup = scene.getObjectByName('dungeon-module');
			const play = kitGroup.userData.play;
			const { grid, width: W, height: H, minX, minY, floorValue } = play;
			const cell = (x, z) => grid[Math.floor(z - minY) * W + Math.floor(x - minX)];
			const r = play.rooms[0];
			const from = [Math.floor(r.x + r.w / 2) + 0.5, 0, Math.floor(r.y + r.h / 2) + 0.5];
			// a floor target in the same room: two cells over, all floor between
			let inRoom = null;
			for (const [dx, dz] of [[2, 0], [-2, 0], [0, 2], [0, -2], [1, 1], [-1, -1]]) {
				const x = from[0] + dx, z = from[2] + dz;
				if (cell(x, z) === floorValue && cell(from[0] + dx / 2, from[2] + dz / 2) === floorValue) { inRoom = [x, 0, z]; break; }
			}
			// a floor target BEHIND A WALL: the nearest floor cell whose straight line from `from`
			// crosses a wall cell
			let behind = null, bestD = Infinity;
			for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
				if (grid[y * W + x] !== floorValue) continue;
				const tx = x + minX + 0.5, tz = y + minY + 0.5;
				const d = Math.hypot(tx - from[0], tz - from[2]);
				if (d > 9 || d < 2 || d >= bestD) continue;
				let wall = false;
				for (let s = 0.05; s < 1; s += 0.05) if (cell(from[0] + (tx - from[0]) * s, from[2] + (tz - from[2]) * s) === 2) wall = true;
				if (wall) { behind = [tx, 0, tz]; bestD = d; }
			}
			const outside = [play.bounds.max[0] + 3, 0, from[2]];
			const toWorld = (p) => kitGroup.localToWorld(new window.__stores.THREE.Vector3(...p)).toArray();
			const V = window.__stores.vrControls.teleportVerdict;
			return {
				inRoom: inRoom && V(toWorld(from), toWorld(inRoom)),
				behind: behind && V(toWorld(from), toWorld(behind)),
				outside: V(toWorld(from), toWorld(outside)),
				targets: { from, inRoom, behind }
			};
		});
		check(v.inRoom?.ok === true, '6 K1: a floor target in the entrance room is a valid teleport (' + JSON.stringify(v.inRoom) + ')');
		check(v.behind && v.behind.ok === false, '  a target BEHIND A WALL is refused (' + JSON.stringify(v.behind) + ' ' + JSON.stringify(v.targets) + ')');
		check(v.outside?.ok === false, '  a target outside the dungeon\'s bounds is refused (' + JSON.stringify(v.outside) + ')');
	}

	await finish(browser);
});
