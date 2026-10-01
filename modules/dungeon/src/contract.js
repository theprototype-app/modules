// THE PLAY CONTRACT — the pure half of what the Kit publishes on its scene-root
// group's `userData.play`. Zero THREE/DOM (node-tested in test/contract.test.mjs).
//
// Core reads {grid, width, height, minX, minY, rooms, floorValue} for play-mode
// collision, spawns and the minimap (dungeonPlay.js), and `grounded` / `markers`
// through playSettings.js. Everything else is the INTER-MODULE seam (21-C C6):
// an installed module's entry file may have no imports, so Dungeon Realms cannot
// share code with the Kit — it shares the SCENE, reading this record through
// api.scene().getObjectByName('dungeon-module').userData.play. Keep the fields
// below stable; add, never rename.
//
// World coordinates: a floor cell (x, y) of floor k sits at world
// (x + ox + 0.5, y + oy + 0.5) — `ox`/`oy` are the campaign's world offsets, which
// place floor k+1's DOWN portal exactly where floor k's UP portal stands.

import { FLOOR, WALL } from './gen/dungeon.js';

export const GROUP_NAME = 'dungeon-module';
export const CONTRACT_VERSION = 2;

// ---- 30b: WALK, DON'T CLIP ----------------------------------------------------------------
// Core walks a dungeon on the published raster (dungeonPlay.walkable: a cell that is not
// `floorValue` stops the walker) — desktop play, the VR stick and the Interact/Play capsule.
// Round 1 published the generator's raster as is, so the SOLID props standing on floor cells
// (pillars, crates, chests, braziers) were walked straight through. The published grid now
// stamps their cells BLOCKED; the generator's own grid (the renderer, the checksum) is
// untouched. `colliders` carries the same solids as world AABBs for a physics capsule.

/** the value a solid prop's cell carries in the PUBLISHED grid (not floor: the walker stops) */
export const BLOCKED = 3;
/** the props a walker cannot pass, and their collider half-extents / heights (metres) — the
 * sizes render.js draws. A crystal floats over a shrine's centre (a spawn point) and debris
 * is ankle-high rubble: both stay walkable. */
export const SOLID = {
	pillar: { hx: 0.38, hz: 0.38, h: 2.4 },
	crate: { hx: 0.36, hz: 0.36, h: 0.72 },
	chest: { hx: 0.43, hz: 0.3, h: 0.55 },
	brazier: { hx: 0.3, hz: 0.3, h: 0.55 }
};
/** every wall's collider reaches this high (the renderer's tallest wall is 2.25) */
export const WALL_HEIGHT = 2.3;

/** the cell a core spawn lands on for a room (dungeonPlay.roomCenter) @param {any} room local coords */
function spawnCell(room) {
	return { x: Math.floor(room.x + room.w / 2), y: Math.floor(room.y + room.h / 2) };
}

/**
 * The raster core walks: the generator's grid with every SOLID prop's cell stamped BLOCKED —
 * except a room's spawn cell (a chest can stand at a treasure room's centre; a peer spawned
 * there must never be walled in). @param {any} dungeon @returns {Uint8Array}
 */
export function walkGrid(dungeon) {
	const { W, grid, rooms, props } = dungeon;
	const out = Uint8Array.from(grid);
	const keep = new Set(rooms.map((r) => { const c = spawnCell(r); return c.y * W + c.x; }));
	for (const p of props) {
		if (!SOLID[p.kind]) continue;
		const i = p.y * W + p.x;
		if (out[i] === FLOOR && !keep.has(i)) out[i] = BLOCKED;
	}
	return out;
}

/**
 * The solids as world AABBs {min:[x,y,z], max:[x,y,z], kind}: wall cells merged into runs
 * (row runs, then identical runs stacked down the rows), plus one box per solid prop.
 * @param {any} dungeon (with ox/oy) @returns {{min: number[], max: number[], kind: string}[]}
 */
export function colliderBoxes(dungeon) {
	const { W, H, grid, props, ox, oy } = dungeon;
	/** @type {Map<string, {x0: number, x1: number, y0: number, y1: number}>} open runs by span */
	let open = new Map();
	const boxes = [];
	const close = (/** @type {{x0: number, x1: number, y0: number, y1: number}} */ r) =>
		boxes.push({ min: [r.x0 + ox, 0, r.y0 + oy], max: [r.x1 + 1 + ox, WALL_HEIGHT, r.y1 + 1 + oy], kind: 'wall' });
	for (let y = 0; y < H; y++) {
		const next = new Map();
		let x = 0;
		while (x < W) {
			if (grid[y * W + x] !== WALL) { x++; continue; }
			let x1 = x;
			while (x1 + 1 < W && grid[y * W + x1 + 1] === WALL) x1++;
			const key = x + ':' + x1;
			const run = open.get(key);
			if (run) { run.y1 = y; open.delete(key); next.set(key, run); }
			else next.set(key, { x0: x, x1, y0: y, y1: y });
			x = x1 + 1;
		}
		open.forEach(close);
		open = next;
	}
	open.forEach(close);
	// 31: a solid prop's box covers its WHOLE cell (the walk raster blocks the whole cell): a
	// bounded teleport (K1) that lands beside a pillar must never land on a cell the walker then
	// cannot leave — the box and the raster agree to the centimetre
	// (and exactly where the raster blocks it: a room's spawn cell stays open in both)
	const raster = walkGrid(dungeon);
	for (const p of props) {
		const s = SOLID[p.kind];
		if (!s || raster[p.y * W + p.x] !== BLOCKED) continue;
		const x0 = p.x + ox, z0 = p.y + oy;
		boxes.push({ min: [x0, 0, z0], max: [x0 + 1, s.h, z0 + 1], kind: p.kind });
	}
	return boxes;
}

/** @param {any} room @param {number} ox @param {number} oy */
function worldRoom(room, ox, oy) {
	return {
		x: room.x + ox,
		y: room.y + oy,
		w: room.w,
		h: room.h,
		id: room.id,
		type: room.type,
		depth: room.depth,
		cx: room.cx + ox + 0.5,
		cz: room.cy + oy + 0.5
	};
}

/**
 * Rooms in SPAWN order: the entrance first, then by depth, then by id — so every peer
 * (dungeonPlay.spawnPointFor takes consecutive rooms by sorted peer id) starts near
 * the dungeon's start together.
 * @param {any} dungeon
 */
export function spawnOrderedRooms(dungeon) {
	return [...dungeon.rooms]
		.sort((a, b) => {
			const ka = a.type === 'entrance' ? -1 : a.depth;
			const kb = b.type === 'entrance' ? -1 : b.depth;
			return ka - kb || a.id - b.id;
		})
		.map((room) => worldRoom(room, dungeon.ox, dungeon.oy));
}

// ---- 31: TELEPORT, BUT NEVER OUT OF THE DUNGEON (D2) ---------------------------------------
// The user on a Quest: "I would like to be able to teleport but not outside the dungeon walls
// (now I see teleporting disabled)". Core's K1 teleport (31-vr-core) is BOUNDED in Interact/Play:
// the arc's target must be a walkable surface, the segment to it must not cross a collider, and
// it must lie inside `play.bounds`. The Kit publishes the three: `colliders` (every wall cell,
// every solid prop's cell), and `bounds` — the box around the floor's FLOOR cells, which the
// outer walls enclose, only ankle-high (a target on a crate, a pillar or a wall top is refused:
// the walker could not step off a blocked cell).

/** the teleport target's height window above the floor (metres): the floor, nothing standing on it */
export const TELEPORT_Y = { min: -0.5, max: 0.4 };

/**
 * `play.bounds` for one floor — pure: the box around its FLOOR cells, world coordinates (the
 * Kit group's frame), `{min: [x, y, z], max: [x, y, z]}`. @param {any} dungeon
 */
export function teleportBounds(dungeon) {
	const { W, H, grid, ox, oy } = dungeon;
	let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
	for (let y = 0; y < H; y++)
		for (let x = 0; x < W; x++) {
			if (grid[y * W + x] !== FLOOR) continue;
			if (x < x0) x0 = x;
			if (x > x1) x1 = x;
			if (y < y0) y0 = y;
			if (y > y1) y1 = y;
		}
	if (x0 === Infinity) return null;
	return { min: [x0 + ox, TELEPORT_Y.min, y0 + oy], max: [x1 + 1 + ox, TELEPORT_Y.max, y1 + 1 + oy] };
}

/**
 * The full `userData.play` record for one floor of a campaign.
 * @param {any} campaign generateCampaign()'s result
 * @param {number} floorIndex 1-based
 * @param {{grounded?: boolean | null, markers?: {x: number, z: number, kind: string}[], teleport?: boolean}=} extras
 *   `teleport`: allow K1's bounded teleport (the Kit passes true only on a core that bounds it)
 */
export function playPayload(campaign, floorIndex, extras = {}) {
	const dungeon = campaign.floors[floorIndex - 1];
	if (!dungeon) return null;
	const { ox, oy } = dungeon;
	const wx = (/** @type {number} */ x) => x + ox + 0.5;
	const wz = (/** @type {number} */ y) => y + oy + 0.5;
	const play = {
		// ---- the core half (dungeonPlay.js shape — DO NOT CHANGE) ----------------------
		// 30b: the WALK raster — solid props' cells BLOCKED (walkGrid); same shape, same values
		// for floor / wall
		grid: walkGrid(dungeon),
		width: dungeon.W,
		height: dungeon.H,
		minX: ox,
		minY: oy,
		rooms: spawnOrderedRooms(dungeon),
		floorValue: FLOOR,
		// ---- play settings (playSettings.js) --------------------------------------------
		// a dungeon is WALKED: the fly keys are off unless a rule module says otherwise
		grounded: extras.grounded == null ? true : !!extras.grounded,
		// 30b (C1): no fly in Interact/Play — a dungeon is walked (published so a publisher-aware
		// resolver never inherits a scene's `true`). 31 (D2): teleport ON where core bounds it to
		// `bounds` + `colliders` (K1) — never on a core whose teleport would leave the walls
		locomotion: { teleport: extras.teleport === true, fly: false },
		bounds: teleportBounds(dungeon),
		// 30b: the solids as world AABBs for a physics capsule (the raster above is the walk)
		colliders: colliderBoxes(dungeon),
		// ---- the inter-module seam (a rule module reads these) --------------------------
		contract: CONTRACT_VERSION,
		seed: campaign.seed,
		params: campaign.params,
		floorIndex,
		levelCount: campaign.floors.length,
		name: dungeon.name,
		theme: dungeon.theme,
		checksum: dungeon.checksum,
		campaignChecksum: campaign.checksum,
		/** every prop in WORLD coordinates (gems carry `index`) */
		props: dungeon.props.map((p) => ({ ...p, wx: wx(p.x), wz: wz(p.y) })),
		/** portals in world coordinates: kind 'up' | 'down', gated */
		portals: dungeon.portals.map((p) => ({ kind: p.kind, gated: !!p.gated, roomId: p.roomId, x: p.x, y: p.y, wx: wx(p.x), wz: wz(p.y) })),
		/** typed enemy spawn slots in world coordinates */
		spawns: dungeon.spawns.map((s) => ({ ...s, wx: wx(s.x), wz: wz(s.y) })),
		/** minimap markers: a BARE Kit publishes none — rule modules add theirs */
		markers: Array.isArray(extras.markers) ? extras.markers : []
	};
	return play;
}

/**
 * Merge per-owner marker lists into one array, owner name order, so two rule
 * modules never fight over the minimap.
 * @param {Record<string, {x: number, z: number, kind: string}[]>} byOwner
 */
export function mergeMarkers(byOwner) {
	const out = [];
	for (const owner of Object.keys(byOwner).sort()) {
		for (const marker of byOwner[owner] ?? []) {
			if (typeof marker?.x === 'number' && typeof marker?.z === 'number')
				out.push({ x: marker.x, z: marker.z, kind: String(marker.kind ?? 'marker') });
		}
	}
	return out;
}

/** Clamp toolbox/node params into the generator's legal ranges. @param {any} params */
export function normalizeParams(params = {}) {
	const out = {};
	if (params.roomCount != null) out.roomCount = Math.max(0, Math.min(60, Math.round(Number(params.roomCount) || 0)));
	if (params.loopChance != null) out.loopChance = Math.max(0, Math.min(1, Number(params.loopChance) || 0));
	if (params.levelCount != null) out.levelCount = Math.max(1, Math.min(9, Math.round(Number(params.levelCount) || 1)));
	if (params.gemDensity != null) out.gemDensity = Math.max(0.25, Math.min(2, Number(params.gemDensity) || 1));
	if (params.decorDensity != null) out.decorDensity = Math.max(0, Math.min(2, Number(params.decorDensity) || 0));
	if (params.theme != null) out.theme = String(params.theme);
	return out;
}
