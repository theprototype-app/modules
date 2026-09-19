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

import { FLOOR } from './gen/dungeon.js';

export const GROUP_NAME = 'dungeon-module';
export const CONTRACT_VERSION = 2;

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
		grid: dungeon.grid,
		width: dungeon.W,
		height: dungeon.H,
		minX: ox,
		minY: oy,
		rooms: spawnOrderedRooms(dungeon),
		floorValue: FLOOR,
		// ---- play settings (playSettings.js) --------------------------------------------
		// a dungeon is WALKED: the fly keys are off unless a rule module says otherwise
		grounded: extras.grounded == null ? true : !!extras.grounded,
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
