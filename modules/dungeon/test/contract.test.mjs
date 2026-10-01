// The play contract — pure, node-run. What core and Dungeon Realms both read.
import { generateCampaign } from '../src/gen/campaign.js';
import { FLOOR, WALL } from '../src/gen/dungeon.js';
import { playPayload, mergeMarkers, normalizeParams, CONTRACT_VERSION, walkGrid, colliderBoxes, BLOCKED, SOLID } from '../src/contract.js';

// core's walker, VERBATIM from src/lib/dungeonPlay.js (walkable + slideMove) — what desktop play,
// the VR stick and the capsule's raster tier run against the published grid
function walkable(data, x, z, r = 0.3) {
	if (!data) return true;
	const { grid, width, height, minX, minY, floorValue } = data;
	for (const [ox, oz] of [[-r, -r], [r, -r], [-r, r], [r, r]]) {
		const cx = Math.floor(x + ox - minX);
		const cz = Math.floor(z + oz - minY);
		if (cx < 0 || cz < 0 || cx >= width || cz >= height) return false;
		if (grid[cz * width + cx] !== floorValue) return false;
	}
	return true;
}
function slideMove(data, x, z, dx, dz, r = 0.3) {
	if (!data) return { x: x + dx, z: z + dz };
	const nx = walkable(data, x + dx, z, r) ? x + dx : x;
	const nz = walkable(data, nx, z + dz, r) ? z + dz : z;
	return { x: nx, z: nz };
}
/** walk from (x, z) toward (tx, tz) in 5 cm steps, the way a held key does @returns {{x: number, z: number}} */
function walkToward(data, x, z, tx, tz, steps = 200) {
	for (let i = 0; i < steps; i++) {
		const d = Math.hypot(tx - x, tz - z);
		if (d < 0.05) break;
		const p = slideMove(data, x, z, ((tx - x) / d) * 0.05, ((tz - z) / d) * 0.05);
		x = p.x; z = p.z;
	}
	return { x, z };
}

export function run(check) {
	const campaign = generateCampaign(1234);
	const play = playPayload(campaign, 1);
	// the dungeonPlay.js half is byte-shaped: grid + dims + offsets + rooms + floorValue
	check(play.grid.length === campaign.floors[0].grid.length && play.width === campaign.floors[0].W && play.height === campaign.floors[0].H, 'raster, width and height are the floor\'s own');
	check(play.minX === campaign.floors[0].ox && play.minY === campaign.floors[0].oy, 'minX/minY are the campaign world offsets');
	check(play.floorValue === FLOOR, 'floorValue is FLOOR');
	check(play.rooms[0].type === 'entrance', 'rooms are spawn-ordered: the entrance comes first');
	const depths = play.rooms.slice(1).map((r) => r.depth);
	check(depths.every((d, i) => i === 0 || depths[i - 1] <= d), 'then by depth (both players spawn near the start)');
	// the seam half
	check(play.contract === CONTRACT_VERSION && play.seed === 1234 && play.floorIndex === 1 && play.levelCount === 5, 'seam: contract version, seed, floorIndex, levelCount');
	const gems = play.props.filter((p) => p.kind === 'gem');
	check(gems.length >= 4 && gems.every((g) => typeof g.index === 'number' && typeof g.wx === 'number' && typeof g.wz === 'number'), 'gem props carry index + world coords (' + gems.length + ')');
	const up = play.portals.find((p) => p.kind === 'up');
	check(!!up && up.gated === true && up.wx === up.x + play.minX + 0.5, 'the gated UP portal is in world coordinates');
	// floor 2's DOWN portal stands exactly where floor 1's UP portal stands (world space)
	const play2 = playPayload(campaign, 2);
	const down = play2.portals.find((p) => p.kind === 'down');
	check(!!down && down.wx === up.wx && down.wz === up.wz, 'floor 2 DOWN portal lands on floor 1 UP portal in world space');
	// world coords sit on FLOOR cells of the raster the same record publishes
	const onFloor = gems.every((g) => play.grid[(Math.floor(g.wz - play.minY)) * play.width + Math.floor(g.wx - play.minX)] === FLOOR);
	check(onFloor, 'every gem world coordinate resolves to a FLOOR cell of the published raster');
	// defaults: grounded, no markers
	check(play.grounded === true && Array.isArray(play.markers) && play.markers.length === 0, 'a bare Kit publishes grounded:true and NO markers');
	check(playPayload(campaign, 1, { grounded: false }).grounded === false, 'grounded can be overridden by a rule module');
	check(playPayload(campaign, 9) === null, 'a floor past the campaign is null, never a throw');
	// markers merge by owner name order, garbage dropped
	const merged = mergeMarkers({ zeta: [{ x: 1, z: 2, kind: 'gem' }], alpha: [{ x: 3, z: 4 }, { x: 'no' }] });
	check(merged.length === 2 && merged[0].x === 3 && merged[0].kind === 'marker' && merged[1].kind === 'gem', 'mergeMarkers: owner order, kind default, garbage dropped');
	// params clamp
	const p = normalizeParams({ roomCount: 999, loopChance: -1, levelCount: 0, gemDensity: 5 });
	check(p.roomCount === 60 && p.loopChance === 0 && p.levelCount === 1 && p.gemDensity === 2, 'normalizeParams clamps into the generator ranges');
	check(Object.keys(normalizeParams({})).length === 0, 'normalizeParams leaves absent params absent');

	// ---- 30b: walk, don't clip -----------------------------------------------------------------
	const gen = campaign.floors[0].grid;
	let changed = 0, bad = 0;
	for (let i = 0; i < gen.length; i++) if (play.grid[i] !== gen[i]) { changed++; if (!(gen[i] === FLOOR && play.grid[i] === BLOCKED)) bad++; }
	const solids = campaign.floors.flatMap((d) => d.props).filter((p) => SOLID[p.kind]).length;
	check(bad === 0 && changed > 0, 'the published grid = the generator\'s, with ' + changed + ' solid-prop cells stamped BLOCKED (nothing else changed)');
	check(campaign.floors[0].grid === gen && gen.every((v) => v !== BLOCKED), '  the generator\'s own grid (renderer, checksum) is untouched');
	// a walker heading straight at a pillar stops short of it; on the raw grid it walked through
	let pillarTests = 0, stopped = 0, clippedRaw = 0;
	for (const d of campaign.floors) {
		const pp = playPayload(campaign, d.index ?? campaign.floors.indexOf(d) + 1);
		const raw = { ...pp, grid: d.grid };
		for (const prop of d.props.filter((q) => q.kind === 'pillar').slice(0, 6)) {
			const cx = prop.x + d.ox + 0.5, cz = prop.y + d.oy + 0.5;
			const end = walkToward(pp, cx - 1.5, cz, cx + 1.5, cz);
			const endRaw = walkToward(raw, cx - 1.5, cz, cx + 1.5, cz);
			pillarTests++;
			if (end.x < cx - SOLID.pillar.hx) stopped++;
			if (endRaw.x > cx + 1) clippedRaw++;
		}
	}
	check(pillarTests >= 6 && stopped === pillarTests, 'core\'s walker (dungeonPlay, verbatim) stops at every pillar it walks into (' + stopped + '/' + pillarTests + ')');
	check(clippedRaw === pillarTests, '  counterfactual: on the generator\'s raw grid it walked straight THROUGH them (' + clippedRaw + '/' + pillarTests + ')');
	// a walker into a wall stops at the face (the wall contract, unchanged)
	const e = play.rooms[0];
	let wallX = Math.floor(e.cx - play.minX);
	const row = Math.floor(e.cz - play.minY);
	while (play.grid[row * play.width + wallX] !== WALL) wallX++;
	const atWall = walkToward(play, e.cx, e.cz, wallX + play.minX + 3, e.cz);
	check(atWall.x <= wallX + play.minX - 0.29 && atWall.x > wallX + play.minX - 0.4, 'a walker into a wall stops at its face (' + atWall.x.toFixed(2) + ' vs face ' + (wallX + play.minX) + ')');
	// nothing the game needs is walled in: over 12 seeds x every floor, from the entrance every
	// gem, both portals and every room's spawn point stay reachable on the BLOCKED raster
	let unreachable = 0, checkedFloors = 0, trapped = 0;
	for (let seed = 1; seed <= 12; seed++) {
		const c = generateCampaign(seed * 7919);
		c.floors.forEach((d, k) => {
			const pp = playPayload(c, k + 1);
			const { grid, width: Wd, height: Hd, minX, minY } = pp;
			const seen = new Uint8Array(Wd * Hd);
			const at = (wx, wz) => Math.floor(wz - minY) * Wd + Math.floor(wx - minX);
			const start = at(pp.rooms[0].x + pp.rooms[0].w / 2, pp.rooms[0].y + pp.rooms[0].h / 2);
			const q = [start]; seen[start] = 1;
			while (q.length) {
				const i = q.pop();
				for (const n of [i + 1, i - 1, i + Wd, i - Wd]) if (!seen[n] && grid[n] === FLOOR) { seen[n] = 1; q.push(n); }
			}
			const targets = [...pp.props.filter((g) => g.kind === 'gem').map((g) => at(g.wx, g.wz)), ...pp.portals.map((g) => at(g.wx, g.wz)), ...pp.rooms.map((r) => at(r.x + r.w / 2, r.y + r.h / 2))];
			unreachable += targets.filter((t) => !seen[t]).length;
			// a spawn point is never inside a blocked cell (a peer spawned there could not move)
			trapped += pp.rooms.filter((r) => grid[at(r.x + r.w / 2, r.y + r.h / 2)] !== FLOOR).length;
			checkedFloors++;
		});
	}
	check(unreachable === 0 && trapped === 0, 'over ' + checkedFloors + ' floors every gem, portal and spawn stays reachable from the entrance on the blocked raster; no spawn cell is blocked');
	// the colliders: every wall cell covered, no floor cell inside a wall box, one box per solid
	const d0 = campaign.floors[0];
	const boxes = colliderBoxes(d0);
	const walls = boxes.filter((b) => b.kind === 'wall');
	const inBox = (x, z) => walls.some((b) => x > b.min[0] && x < b.max[0] && z > b.min[2] && z < b.max[2]);
	let uncovered = 0, floorInside = 0, wallCells = 0;
	for (let y = 0; y < d0.H; y++) for (let x = 0; x < d0.W; x++) {
		const v = d0.grid[y * d0.W + x], wx = x + d0.ox + 0.5, wz = y + d0.oy + 0.5;
		if (v === WALL) { wallCells++; if (!inBox(wx, wz)) uncovered++; }
		else if (v === FLOOR && inBox(wx, wz)) floorInside++;
	}
	check(uncovered === 0 && floorInside === 0, 'colliders: every wall cell inside a wall box, no floor cell inside one');
	check(walls.length * 3 < wallCells, '  walls merged into runs (' + walls.length + ' boxes for ' + wallCells + ' wall cells)');
	const raster0 = walkGrid(d0);
	const blockedCells = raster0.filter((v) => v === BLOCKED).length;
	check(boxes.length - walls.length === blockedCells && boxes.every((b) => b.max[1] > b.min[1] && b.min[1] === 0), '  one box per BLOCKED raster cell (' + blockedCells + '), every box standing on the floor');
	// 31: a prop's box is its WHOLE cell — the collider and the walk raster agree (a bounded
	// teleport beside a pillar never lands on a cell the walker cannot leave)
	const props0 = boxes.filter((b) => b.kind !== 'wall');
	const cellOf = (b) => Math.floor(b.min[2] - d0.oy) * d0.W + Math.floor(b.min[0] - d0.ox);
	check(props0.length > 0 && props0.every((b) => b.max[0] - b.min[0] === 1 && b.max[2] - b.min[2] === 1 && raster0[cellOf(b)] === BLOCKED), '  a solid prop\'s box covers exactly its blocked cell (' + props0.length + ' boxes)');
	check(JSON.stringify(play.colliders) === JSON.stringify(boxes), '  published on userData.play.colliders');
	check(play.locomotion && play.locomotion.teleport === false && play.locomotion.fly === false, 'the Kit publishes locomotion {teleport: false, fly: false} by default (C1: walk in Interact/Play)');
	// ---- 31 D2: bounded teleport ------------------------------------------------------------
	const tp = playPayload(campaign, 1, { teleport: true });
	check(tp.locomotion.teleport === true && tp.locomotion.fly === false, 'D2: on a core that bounds teleport the Kit turns it ON (fly stays off)');
	const b = tp.bounds;
	check(!!b && b.min.length === 3 && b.max.length === 3 && [...b.min, ...b.max].every(Number.isFinite), '  and publishes play.bounds {min, max} with finite numbers');
	let floorOut = 0, floors0 = 0, voidIn = 0;
	for (let y = 0; y < d0.H; y++) for (let x = 0; x < d0.W; x++) {
		const wx = x + d0.ox + 0.5, wz = y + d0.oy + 0.5;
		const inside = wx > b.min[0] && wx < b.max[0] && wz > b.min[2] && wz < b.max[2];
		if (d0.grid[y * d0.W + x] === FLOOR) { floors0++; if (!inside) floorOut++; }
	}
	// the bounds' edge rows: every cell just OUTSIDE the box is wall or rock, never floor
	for (let x = 0; x < d0.W; x++) for (let y = 0; y < d0.H; y++) {
		const wx = x + d0.ox + 0.5, wz = y + d0.oy + 0.5;
		if ((wx < b.min[0] || wx > b.max[0] || wz < b.min[2] || wz > b.max[2]) && d0.grid[y * d0.W + x] === FLOOR) voidIn++;
	}
	check(floorOut === 0 && voidIn === 0 && floors0 > 50, '  every one of ' + floors0 + ' floor cells lies inside the bounds, no floor cell outside them');
	const edge = (x, y) => d0.grid[y * d0.W + x];
	const x0 = Math.round(b.min[0] - d0.ox), x1 = Math.round(b.max[0] - d0.ox) - 1, y0 = Math.round(b.min[2] - d0.oy), y1 = Math.round(b.max[2] - d0.oy) - 1;
	let ringOpen = 0;
	for (let x = x0; x <= x1; x++) for (const y of [y0 - 1, y1 + 1]) if (y >= 0 && y < d0.H && edge(x, y) === FLOOR) ringOpen++;
	for (let y = y0; y <= y1; y++) for (const x of [x0 - 1, x1 + 1]) if (x >= 0 && x < d0.W && edge(x, y) === FLOOR) ringOpen++;
	check(ringOpen === 0, '  the bounds are tight: the row/column just past each side holds no floor');
	check(b.min[1] < 0 && b.max[1] < 0.72 && b.max[1] > 0.1, '  ankle-high (' + b.min[1] + '..' + b.max[1] + ' m): a crate (0.72), a pillar or a wall top is never a target');
	check(JSON.stringify(playPayload(campaign, 2, { teleport: true }).bounds) !== JSON.stringify(b), '  per floor (floor 2 has its own box)');
	check(walkGrid(d0).length === d0.grid.length && walkGrid(d0) !== d0.grid, 'walkGrid is a copy');
}
