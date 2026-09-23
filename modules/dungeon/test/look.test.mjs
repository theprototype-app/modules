// The Kit's look numbers — pure (30-visuals-mod). What makes the dungeon torch-lit instead of
// black, held to measurable floors: every theme's lifted wall reads, the tiles clear the editor
// grid, the light count stays capped, the flicker is deterministic.
import { LOOK, LIT, luma, lift, mix, stoneTint, flameFlicker, pickLights, stoneTexture, stoneLayout, bakeTorchLight, litShade, haloTexture, stepLightSlots } from '../src/look.js';
import { generateCampaign } from '../src/gen/campaign.js';
import { FLOOR, WALL } from '../src/gen/dungeon.js';
import { THEMES } from '../src/gen/campaign.js';

export function run(check) {
	check(LOOK.floorTop > 0 && LOOK.floorTop < 0.05, 'the tiles\' top sits a hair ABOVE the editor grid (y 0)');
	check(LOOK.lightBudget <= 8, 'point lights stay capped at 8 per floor (the frame budget) (' + LOOK.lightBudget + ')');
	const walls = THEMES.map((t) => luma(stoneTint(t.wallTint, LOOK.wallLift)));
	check(walls.every((l) => l >= LOOK.minWallLuma), 'every theme\'s lifted wall reads (luma >= ' + LOOK.minWallLuma + '): ' + walls.map((l) => l.toFixed(3)).join(' '));
	check(THEMES.every((t) => luma(t.wallTint) < LOOK.minWallLuma), '  counterfactual: the raw theme walls do NOT (' + THEMES.map((t) => luma(t.wallTint).toFixed(3)).join(' ') + ')');
	check(THEMES.every((t) => t.floorTints.every((c) => luma(stoneTint(c, LOOK.floorLift)) > luma(c))), 'every floor tint is lifted');
	check(mix(0x000000, 0xffffff, 0.5) === 0x808080 && mix(0x123456, 0xabcdef, 0) === 0x123456, 'mix blends per channel and is the identity at 0');
	const dist = (/** @type {number} */ a, /** @type {number} */ b) => [16, 8, 0].reduce((d, sh) => d + Math.abs(((a >> sh) & 255) - ((b >> sh) & 255)), 0);
	check(THEMES.every((t) => dist(mix(t.wallTint, LOOK.stone, LOOK.stoneMix), LOOK.stone) < dist(t.wallTint, LOOK.stone)), 'the stone mix moves every theme wall toward the warm stone grey');
	check(lift(0xffffff, 3) === 0xffffff && lift(0x102030, 1) === 0x102030, 'lift clamps each channel and is the identity at 1');
	check(flameFlicker(12.5, 3, 4) === flameFlicker(12.5, 3, 4) && flameFlicker(12.5, 3, 4) !== flameFlicker(12.5, 9, 4), 'the flame flicker is a pure function of time and the torch (same on every peer, different per torch)');
	const ks = Array.from({ length: 200 }, (_, i) => flameFlicker(i * 0.05, 1, 2));
	check(Math.min(...ks) > 0.75 && Math.max(...ks) < 1.25, '  and stays within +-25% of the flame');
	const spots = Array.from({ length: 40 }, (_, i) => ({ x: i, z: 0 }));
	const picked = pickLights(spots, { x: 30.2, z: 0 }, 8);
	check(picked.length === 8 && new Set(picked).size === 8, 'pickLights: never more than the budget, no light twice');
	check([30, 31, 29].every((i) => picked.slice(0, 3).includes(i)), '  the three flames nearest the entrance hall come first (the spawn is torch-lit)');
	check(picked.slice(3).some((i) => i < 10) && picked.slice(3).some((i) => i > 20 && i < 29), '  the rest spread over the level');
	check([9, 12, 17, 20, 23, 41, 100].every((n) => pickLights(spots.slice(0, Math.min(n, 40)).concat(Array.from({ length: Math.max(0, n - 40) }, (_, i) => ({ x: 50 + i, z: 1 }))), { x: 0, z: 0 }, 8).length === 8),
		'  ALWAYS exactly the budget (8 here) when a floor has that many flames (a changing light count recompiles every lit material on travel)');
	check(pickLights(spots.slice(0, 5), null, 8).length === 5, '  and every flame when it has fewer');
	check(pickLights(spots, null, 8).length === 8 && pickLights([], null, 8).length === 0 && pickLights(spots, null, 0).length === 0, '  no focus: an even spread; nothing to light: nothing');
	// P4: stone, the vault, lights that follow the player
	const brick = stoneTexture('brick');
	const flag = stoneTexture('flag');
	const N = LOOK.textureSize;
	check(brick.length === N * N * 4 && JSON.stringify([...stoneTexture('brick')]) === JSON.stringify([...brick]), 'stoneTexture: size x size RGBA, deterministic (every peer paints the same stone)');
	const lum = (/** @type {Uint8Array} */ t) => { const v = []; for (let i = 0; i < t.length; i += 4) v.push(t[i]); return v; };
	const b = lum(brick);
	const mean = b.reduce((a, v) => a + v, 0) / b.length;
	// the joints: in each column, the darkest pixel of the texture sits well under the stone mean
	let jointCols = 0;
	for (let x = 0; x < N; x++) { let lo = 255; for (let y = 0; y < N; y++) lo = Math.min(lo, b[y * N + x]); if (lo < mean * 0.75) jointCols++; }
	check(jointCols === N && Math.max(...b) > 200, '  recessed mortar joints darker than the stones (the map and the bump), every column crosses one');
	const distinct = new Set(b.filter((v) => v > mean).map((v) => v >> 4)).size;
	check(distinct >= 4, '  the stones differ in shade (' + distinct + ' bands)');
	// irregular: the courses put their joints in different places and the stones differ in length
	for (const kind of ['brick', 'flag']) {
		const L = stoneLayout(kind, N, 0x57013).course;
		const distinctJoints = new Set(L.map((c) => c.joints.join())).size;
		const lengths = new Set(L.flatMap((c) => c.joints.map((j, i) => (c.joints[(i + 1) % c.joints.length] - j + N) % N)));
		check(distinctJoints === L.length && lengths.size >= 3, '  irregular ' + kind + ': every course its own joints, stones of ' + lengths.size + ' lengths (not a tile grid)');
	}
	check(JSON.stringify([...flag]) !== JSON.stringify([...brick]), '  walls (coursed blocks) and floors (flagstones) are different stone');
	check(LOOK.ceilingY > 2.25 && LOOK.ceilingY < 2.6, 'the vault closes over the tallest wall (2.25) at ' + LOOK.ceilingY);
	const near = pickLights(spots, { x: 12.2, z: 0 }, 8, 8);
	check(near.length === 8 && near.every((i) => Math.abs(i - 12) <= 4), 'pickLights(near = budget): the 8 torches nearest the player (' + near.join(',') + ')');
	check(LOOK.flameIntensity > 1, 'flames are emissive over 1 (bloom catches them)');

	// ---- 30b: lit everywhere ----------------------------------------------------------------
	// a 9 x 5 map: two rooms split by a wall column at x = 4, a torch on the left room's top wall
	//   #########
	//   #...#...#
	//   #...#...#
	//   #...#...#
	//   #########
	const W = 9, H = 5;
	const g = new Uint8Array(W * H).fill(WALL);
	for (let y = 1; y <= 3; y++) for (let x = 1; x <= 7; x++) if (x !== 4) g[y * W + x] = FLOOR;
	const lit = bakeTorchLight(g, W, H, [{ x: 2, y: 0, fx: 0, fy: 1 }]);
	check(lit[1 * W + 2] > 0.8, 'bakeTorchLight: the cell under a torch is lit (' + lit[1 * W + 2].toFixed(2) + ')');
	check(lit[3 * W + 2] > 0 && lit[3 * W + 2] < lit[1 * W + 2], '  the light falls off across the room');
	check([5, 6, 7].every((x) => [1, 2, 3].every((y) => lit[y * W + x] === 0)), '  NOTHING reaches the room on the far side of the wall (the flood stops at walls)');
	check(lit[0 * W + 1] > 0 && lit[2 * W + 4] > 0 && lit[2 * W + 8] === 0, '  a wall takes the light of the floor in front of it; the far room\'s wall stays dark');
	// open the wall at (4, 2): now a doorway — the light turns into the next room, dimmer
	const g2 = Uint8Array.from(g); g2[2 * W + 4] = FLOOR;
	const lit2 = bakeTorchLight(g2, W, H, [{ x: 2, y: 0, fx: 0, fy: 1 }]);
	check(lit2[2 * W + 5] > 0 && lit2[2 * W + 5] < lit2[2 * W + 3], '  through a doorway the light spills into the next room, dimmer');
	const both = bakeTorchLight(g, W, H, [{ x: 2, y: 0, fx: 0, fy: 1 }, { x: 2, y: 4, fx: 0, fy: -1 }]);
	check(both[2 * W + 2] > lit[2 * W + 2] && both.every((v) => v <= 1), '  two torches add (as a screen: brighter, never over 1)');
	check(litShade(0) === LIT.bakeBase && litShade(1) > 1, 'litShade: an unlit cell keeps a base shade, a lit one is brighter than its tint');
	// on a real campaign: EVERY room and EVERY corridor has lit cells (the user saw light in one place)
	const campaign = generateCampaign(1337, { levelCount: 5 });
	let unlitRooms = 0, rooms = 0, corridorLit = 0, corridor = 0;
	for (const d of campaign.floors) {
		const torches = d.props.filter((p) => p.kind === 'torch');
		const L = bakeTorchLight(d.grid, d.W, d.H, torches, { floor: FLOOR, wall: WALL });
		const inRoom = new Uint8Array(d.W * d.H);
		for (const r of d.rooms) {
			rooms++;
			let best = 0;
			for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) { inRoom[y * d.W + x] = 1; best = Math.max(best, L[y * d.W + x]); }
			if (best < 0.5) unlitRooms++;
		}
		for (let i = 0; i < d.grid.length; i++) if (d.grid[i] === FLOOR && !inRoom[i]) { corridor++; if (L[i] > 0.05) corridorLit++; }
	}
	check(unlitRooms === 0, '  seed 1337, 5 floors: every one of ' + rooms + ' rooms has a torch-lit pool (>= 0.5)');
	check(corridorLit / corridor > 0.7, '  and ' + Math.round((100 * corridorLit) / corridor) + '% of corridor cells get torch light (> 70%)');
	const halo = haloTexture(32);
	const at = (/** @type {number} */ x, /** @type {number} */ y) => halo[(y * 32 + x) * 4];
	check(halo.length === 32 * 32 * 4 && at(16, 16) > 200 && at(0, 0) === 0 && at(16, 16) > at(24, 16) && at(24, 16) > at(31, 16), 'haloTexture: bright centre, falling off, black corners (additive: nothing added)');
	// the light budget: four real lights on 40 torches in a row
	const row = Array.from({ length: 40 }, (_, i) => ({ x: i, z: 0 }));
	const slots = [0, 1, 2, 3].map((t) => ({ torch: t, w: 1 }));
	stepLightSlots(slots, row, { x: 1.5, z: 0 }, 1 / 60);
	check(slots.every((s) => s.w === 1) && slots.map((s) => s.torch).join() === '0,1,2,3', 'stepLightSlots: the lights stay on the nearest torches at full strength');
	stepLightSlots(slots, row, { x: 30, z: 0 }, 1 / 60);
	check(slots.every((s) => s.torch >= 0 && s.torch <= 3 && s.w < 1 && s.w > 0), '  the viewer walks away: they FADE (no pop) before they move');
	let frames = 0;
	while (frames < 600 && !slots.every((s) => s.torch >= 28 && s.torch <= 32 && s.w === 1)) { stepLightSlots(slots, row, { x: 30, z: 0 }, 1 / 60); frames++; }
	check(frames < 600 && new Set(slots.map((s) => s.torch)).size === 4, '  then fade in on the four torches nearest the viewer (' + slots.map((s) => s.torch).join(',') + ', ' + frames + ' frames)');
	check(frames * (1 / 60) >= LIT.lightFade * 1.5, '  over a visible fade out + in (' + (frames / 60).toFixed(2) + ' s), never a jump');
	const trace = [];
	const s2 = [{ torch: 0, w: 1 }];
	for (let f = 0; f < 120; f++) { stepLightSlots(s2, row, { x: 12, z: 0 }, 1 / 60); trace.push(s2[0].w); }
	check(trace.every((w, i) => i === 0 || Math.abs(w - trace[i - 1]) <= 1 / 60 / LIT.lightFade + 1e-9), '  the weight changes by at most dt / fade per frame (smooth)');
	const sticky = [{ torch: 5, w: 1 }];
	stepLightSlots(sticky, row, { x: 5.6, z: 0 }, 1 / 60);
	check(sticky[0].torch === 5 && sticky[0].w === 1, '  a held torch is sticky: a viewer between two torches does not flip the light back and forth');
	const still = [{ torch: 7, w: 1 }];
	stepLightSlots(still, row, null, 1 / 60);
	check(still[0].torch === 7 && still[0].w === 1, '  no viewer (no camera yet): the lights stay where they are');
	check(LIT.sconceOut > 0.5 && LIT.sconceOut < 0.8, 'the sconces hang OUT on the wall face (' + LIT.sconceOut + ' from the cell centre; the face is at 0.5)');
}
