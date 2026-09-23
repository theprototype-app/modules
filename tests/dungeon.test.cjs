// Dungeon Kit test-flight: the REAL zip on TWO peers, the registered TOOLBOX (21-C
// C6.2 — `api.registerToolbox`, no `#dungeon-panel`), Generate through the toolbox
// DOM -> seed-identical dungeons on both peers (checksums match), the play CONTRACT
// a bare Kit publishes (grounded, NO markers, contract v2, world-space props/portals),
// the app's own minimap reading it in play mode (dungeonData), the floor stepper
// replicating travel, Clear replicating, the Dungeon node in the palette, and a LATE
// JOINER rebuilding from {seed, params, floorIndex}.
//
//   npm run pack -- dungeon
//   APP_URL=https://theprototype.app:5216/ node tests/dungeon.test.cjs

const { launch, setupPage, installModule, connect, check, eventually, finish, run } = require('./helpers.cjs');

/** the Kit's group + contract on a page */
function snap(page) {
	return page.evaluate(
		() =>
			new Promise((resolve) => {
				window.__stores.globalScene.subscribe((scene) => {
					const group = scene?.getObjectByName('dungeon-module');
					const floors = group?.getObjectByName('dk-floors');
					const play = group?.userData?.play;
					const minimap = document.getElementById('dungeon-minimap');
					resolve(
						group
							? {
									hasKit: typeof group.userData.kit?.generate === 'function',
									kitVersion: group.userData.kit?.version ?? null,
									seed: group.userData.seed ?? null,
									floorIndex: group.userData.floorIndex ?? null,
									levelCount: group.userData.levelCount ?? null,
									checksum: group.userData.checksum ?? null,
									campaignChecksum: group.userData.campaignChecksum ?? null,
									floorInstances: floors ? floors.count : 0,
									hasPlay: !!play,
									contract: play?.contract ?? null,
									grounded: play?.grounded ?? null,
									markers: Array.isArray(play?.markers) ? play.markers.length : null,
									props: play?.props?.length ?? 0,
									gems: (play?.props ?? []).filter((p) => p.kind === 'gem').length,
									portals: (play?.portals ?? []).map((p) => p.kind),
									rooms: play?.rooms?.length ?? 0,
									entranceFirst: play?.rooms?.[0]?.type === 'entrance',
									params: group.userData.params ?? null,
									minimapVisible: !!minimap && !minimap.classList.contains('hidden'),
									panelDom: !!document.getElementById('dungeon-panel'),
									toolboxHost: window.__dungeonKit?.toolbox?.host ?? null
								}
							: null
					);
				})();
			})
	);
}

/** open the Kit toolbox through the store the sidebar uses; returns true when its DOM mounted */
async function openToolbox(page) {
	return page.evaluate(async () => {
		const s = window.__stores;
		let list = [];
		s.moduleToolboxes.moduleToolboxes.subscribe((v) => (list = v))();
		const box = list.find((b) => b.moduleId === 'dungeon');
		if (!box) return { ok: false, why: 'no toolbox registered for dungeon' };
		s.moduleToolboxes.openModuleToolbox(box.id);
		for (let i = 0; i < 20 && !document.getElementById('dk-generate'); i++) await new Promise((r) => setTimeout(r, 100));
		return { ok: !!document.getElementById('dk-generate'), id: box.id, title: box.title };
	});
}

run(async () => {
	const browser = await launch();
	const A = await setupPage(browser, 'A');
	const B = await setupPage(browser, 'B');

	await installModule(A, 'dungeon');
	await installModule(B, 'dungeon');

	// the palette has the Kit's node, the group exists from the first frame, no fixed panel
	const groups = await A.page.evaluate(
		() => new Promise((r) => window.__stores.moduleSDK.moduleNodeGroups.subscribe((g) => r(g.map((x) => [x.group, x.items.length])))())
	);
	const family = groups.find(([name]) => name === 'Dungeon Kit');
	check(!!family && family[1] === 1, 'node palette has "Dungeon Kit" with 1 node (' + JSON.stringify(family) + ')');
	const empty = await snap(A.page);
	check(!!empty && empty.hasKit && empty.kitVersion === 2 && !empty.hasPlay, 'the persistent group carries userData.kit (v2) before any dungeon exists, and no play contract');
	check(empty.toolboxHost === 'toolbox' && !empty.panelDom, 'the toolbox is the registered ToolboxWindow host — no #dungeon-panel DOM (' + empty.toolboxHost + ')');

	await connect(A, B);

	// generate through the REAL toolbox DOM
	const opened = await openToolbox(A.page);
	check(opened.ok, 'A opens the Dungeon Kit toolbox (' + JSON.stringify(opened) + ')');
	await A.page.evaluate(() => {
		const seed = document.getElementById('dk-seed');
		seed.value = '4242';
		seed.dispatchEvent(new Event('change', { bubbles: true }));
		document.getElementById('dk-generate').click();
	});
	await eventually(() => snap(A.page), (s) => !!s && s.floorInstances > 0 && s.seed === 4242, 'A builds seed 4242 from the toolbox (instanced floors > 0)');
	const a1 = await snap(A.page);
	await eventually(
		() => snap(B.page),
		(s) => !!s && s.checksum === a1.checksum && s.campaignChecksum === a1.campaignChecksum && s.seed === 4242,
		'B regenerates the IDENTICAL dungeon from {seed, params} (checksums match)'
	);

	// the contract a BARE Kit publishes
	check(a1.contract === 2 && a1.hasPlay, 'userData.play carries contract v2');
	check(a1.grounded === true, 'a dungeon is walked: play.grounded is true by default');
	check(a1.markers === 0, 'a bare Kit puts NOTHING on the minimap (markers: [])');
	check(a1.gems >= 4 && a1.props > a1.gems && a1.portals.includes('up'), 'props (' + a1.props + ', ' + a1.gems + ' gems) and portals (' + a1.portals.join(',') + ') are published in world space');
	check(a1.rooms > 0 && a1.entranceFirst, 'rooms are spawn-ordered, entrance first (' + a1.rooms + ')');
	check(a1.levelCount === 5 && a1.floorIndex === 1, 'campaign of 5 floors, floor 1 shown');
	const stats = await A.page.evaluate(() => document.getElementById('dk-stats')?.textContent ?? '');
	check(/checksum \d+/.test(stats) && /gems/.test(stats), 'the toolbox footer shows the stats line (' + stats.split('\n')[0] + ')');

	// ---- 30b P1: LIT EVERYWHERE -------------------------------------------------------------
	// the user on a Quest saw light in ONE place: every torch now glows (flame + white-hot core),
	// throws a halo on its wall and a pool on its floor, and its light is BAKED into the stone it
	// reaches (an emissive per instance); the 4 real lights go to the torches nearest the viewer
	const lit = await A.page.evaluate(() => {
		let scene;
		window.__stores.globalScene.subscribe((v) => (scene = v))();
		const kit = scene.getObjectByName('dungeon-module');
		const g = kit.getObjectByName('dk-floor');
		const torches = kit.userData.play.props.filter((p) => p.kind === 'torch').length;
		const count = (name) => g.getObjectByName(name)?.count ?? 0;
		const share = (name) => {
			const a = g.getObjectByName(name)?.geometry.getAttribute('torchLight');
			if (!a) return { n: 0, lit: 0 };
			let n = 0;
			for (let i = 0; i < a.count; i++) if (a.getX(i) > 0.05) n++;
			return { n: a.count, lit: n / a.count };
		};
		const floors = g.getObjectByName('dk-floors'), walls = g.getObjectByName('dk-walls');
		return {
			torches,
			halos: count('dk-halos'), pools: count('dk-pools'), flames: count('dk-flames'), cores: count('dk-flame-cores'),
			floorLight: share('dk-floors'), wallLight: share('dk-walls'), floorCount: floors.count, wallCount: walls.count,
			patched: floors.material.customProgramCacheKey?.() === 'dk-torch-lit' && walls.material.customProgramCacheKey?.() === 'dk-torch-lit',
			wallAO: !!walls.material.vertexColors && !!walls.geometry.getAttribute('color'),
			lights: g.children.filter((c) => c.name === 'dk-light').length,
			haloAdditive: g.getObjectByName('dk-halos')?.material.blending === window.__stores.THREE.AdditiveBlending
		};
	});
	check(lit.halos === lit.torches && lit.pools >= lit.torches && lit.cores === lit.flames && lit.torches > 20, 'EVERY torch (' + lit.torches + ') has a wall halo, a floor pool and a white-hot flame core (' + lit.halos + ' / ' + lit.pools + ' / ' + lit.cores + ')');
	check(lit.haloAdditive, '  the halos are ADDITIVE glow (they read in VR, where there is no bloom pass)');
	check(lit.floorLight.n === lit.floorCount && lit.wallLight.n === lit.wallCount && lit.patched, 'the baked torch light rides every floor and wall instance (torchLight attribute) into a torch-lit emissive (patched materials)');
	check(lit.floorLight.lit > 0.6 && lit.wallLight.lit > 0.4, '  ' + Math.round(lit.floorLight.lit * 100) + '% of the floor and ' + Math.round(lit.wallLight.lit * 100) + '% of the walls are torch-lit (the rest stays dark between the pools)');
	check(lit.wallAO, '  the walls carry vertex-colour AO (dark at the foot)');
	check(lit.lights === 4, 'the real point lights stay capped at 4 (' + lit.lights + ')');
	// the lights follow the VIEWER in the EDITOR too (round 1 moved them only in Play — VR's
	// Interact never moved them: "a single place where I see lights"), and FADE across
	const lightTrace = await A.page.evaluate(async () => {
		let scene, cam;
		window.__stores.globalScene.subscribe((v) => (scene = v))();
		window.__stores.globalCamera.subscribe((v) => (cam = v))();
		const g = scene.getObjectByName('dungeon-module').getObjectByName('dk-floor');
		const dk = g.userData._dk;
		const lights = () => g.children.filter((c) => c.name === 'dk-light');
		const held = new Set(dk.slots.map((s) => s.torch));
		// the torch FARTHEST from every lit one: the viewer goes there
		let far = 0, best = -1;
		dk.flameSpots.forEach((p, i) => {
			const d = Math.min(...[...held].map((t) => Math.hypot(dk.flameSpots[t].x - p.x, dk.flameSpots[t].z - p.z)));
			if (d > best) { best = d; far = i; }
		});
		const target = dk.flameSpots[far];
		window.__stores.objectActions.flyTo([target.x + 0.5, 1.7, target.z + 0.5], [target.x, 1.5, target.z]);
		const ws = [];
		const t0 = performance.now();
		while (performance.now() - t0 < 4000) {
			await new Promise((r) => requestAnimationFrame(r));
			ws.push(...dk.slots.map((s) => s.w));
		}
		const eye = cam.getWorldPosition(new window.__stores.THREE.Vector3());
		return {
			target: { x: target.x, z: target.z },
			away: best,
			eyeNear: Math.hypot(eye.x - target.x, eye.z - target.z),
			near: lights().map((l) => Math.hypot(l.position.x - target.x, l.position.z - target.z)),
			mid: ws.filter((w) => w > 0.15 && w < 0.85).length,
			full: dk.slots.every((s) => s.w === 1)
		};
	});
	check(lightTrace.away > 15 && lightTrace.eyeNear < 3, '  (premise: the editor camera flew to a torch ' + lightTrace.away.toFixed(1) + ' m from every lit one)');
	await eventually(
		() => A.page.evaluate((t) => {
			let scene;
			window.__stores.globalScene.subscribe((v) => (scene = v))();
			const g = scene.getObjectByName('dungeon-module').getObjectByName('dk-floor');
			const dk = g.userData._dk;
			return { near: g.children.filter((c) => c.name === 'dk-light').map((l) => +Math.hypot(l.position.x - t.x, l.position.z - t.z).toFixed(1)), full: dk.slots.every((s) => s.w === 1) };
		}, lightTrace.target),
		(v) => v.full && v.near.every((d) => d < 10),
		'in the EDITOR the 4 lights moved to the torches around the viewer and settled at full strength'
	);
	check(lightTrace.mid > 4, '  and FADED across (' + lightTrace.mid + ' in-between frames), never a jump');

	// ---- 30b P2: WALK, DON'T CLIP ------------------------------------------------------------
	// core walks the PUBLISHED raster (dungeonPlay, the real app code here): solid props block it
	const walk = await A.page.evaluate(() => {
		let scene;
		window.__stores.globalScene.subscribe((v) => (scene = v))();
		const kit = scene.getObjectByName('dungeon-module');
		const play = kit.userData.play;
		const dp = window.__stores.dungeonPlay;
		const raw = { ...play, grid: kit.userData.kit.campaign().floors[play.floorIndex - 1].grid };
		const solids = play.props.filter((p) => ['pillar', 'crate', 'chest', 'brazier'].includes(p.kind));
		const stroll = (data, x, z, tx) => {
			for (let i = 0; i < 80; i++) { const n = dp.slideMove(data, x, z, Math.sign(tx - x) * 0.05, 0, 0.3); x = n.x; z = n.z; }
			return x;
		};
		let stopped = 0, through = 0, tried = 0;
		for (const p of solids) {
			// approach from the west along the prop's row, only where the west cell is open floor
			const W = play.width, cx = p.x, cy = p.y;
			if (play.grid[cy * W + cx - 1] !== play.floorValue || play.grid[cy * W + cx - 2] !== play.floorValue) continue;
			tried++;
			const wx = p.wx, wz = p.wz;
			if (stroll(play, wx - 1.5, wz, wx + 3) < wx - 0.5) stopped++;
			if (stroll(raw, wx - 1.5, wz, wx + 3) > wx) through++;
			if (tried >= 8) break;
		}
		return { solids: solids.length, tried, stopped, through, colliders: play.colliders?.length ?? 0, wallBoxes: (play.colliders ?? []).filter((b) => b.kind === 'wall').length, locomotion: play.locomotion };
	});
	check(walk.tried >= 2 && walk.stopped === walk.tried, 'the app\'s own walker (dungeonPlay.slideMove) is STOPPED by every solid prop it walks into (' + walk.stopped + '/' + walk.tried + ' of ' + walk.solids + ' pillars/crates/chests/braziers)');
	check(walk.through === walk.tried, '  counterfactual: on the generator\'s raw grid it walked THROUGH them (' + walk.through + '/' + walk.tried + ')');
	check(walk.wallBoxes > 10 && walk.colliders === walk.wallBoxes + walk.solids, 'userData.play.colliders: ' + walk.wallBoxes + ' merged wall boxes + one per solid prop (for a physics capsule)');
	check(walk.locomotion?.teleport === false && walk.locomotion?.fly === false, 'userData.play.locomotion = {teleport: false, fly: false} — a dungeon is walked in Interact/Play');

	// core reads the contract: the minimap shows in play mode (dungeonData -> userData.play)
	await A.page.locator('#play-button').click();
	await eventually(() => snap(A.page), (s) => s?.minimapVisible, 'A: play mode shows the core minimap off the Kit\'s contract');
	await A.page.keyboard.press('Escape');
	await A.page.waitForTimeout(500);

	// the floor stepper replicates travel
	await A.page.evaluate(() => document.getElementById('dk-floor-up').click());
	await eventually(() => snap(A.page), (s) => s?.floorIndex === 2, 'A steps to floor 2 through the toolbox');
	const a2 = await snap(A.page);
	check(a2.checksum !== a1.checksum, 'floor 2 is a different floor (checksum changed)');
	await eventually(() => snap(B.page), (s) => s?.floorIndex === 2 && s.checksum === a2.checksum, 'B follows to floor 2 — checksums match');

	// late joiner: installs, connects, rebuilds {seed, params, floorIndex}
	const C = await setupPage(browser, 'C');
	await installModule(C, 'dungeon');
	await connect(C, A);
	await eventually(
		() => snap(C.page),
		(s) => !!s && s.seed === 4242 && s.floorIndex === 2 && s.checksum === a2.checksum,
		'late joiner C rebuilds seed 4242 on floor 2 (same checksum)',
		30000
	);

	// clear replicates; the group stays (persistent) but the contract goes
	await A.page.evaluate(() => document.getElementById('dk-clear').click());
	await eventually(() => snap(A.page), (s) => !!s && !s.hasPlay && s.floorInstances === 0, 'A clears: no play contract, no floors, the group persists');
	await eventually(() => snap(B.page), (s) => !!s && !s.hasPlay, 'B: clear replicates');
	await eventually(() => snap(C.page), (s) => !!s && !s.hasPlay, 'C: clear replicates');

	await finish(browser);
});
