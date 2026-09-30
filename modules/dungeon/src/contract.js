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
	for (const p of props) {
		const s = SOLID[p.kind];
		if (!s) continue;
		const cx = p.x + ox + 0.5, cz = p.y + oy + 0.5;
		boxes.push({ min: [cx - s.hx, 0, cz - s.hz], max: [cx + s.hx, s.h, cz + s.hz], kind: p.kind });
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

/**
 * The full `userData.play` record for one floor of a campaign.
 * @param {any} campaign generateCampaign()'s result
 * @param {number} floorIndex 1-based
 * @param {{grounded?: boolean | null, markers?: {x: number, z: number, kind: string}[]}=} extras
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
		// 30b (C1): no teleport, no fly in Interact/Play — a dungeon is walked (absent means false
		// too; published so a publisher-aware resolver never inherits a scene's `true`)
		locomotion: { teleport: false, fly: false },
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
