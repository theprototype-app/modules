// Stage 03 — the campaign: multi-floor stack, themes, portals, spawn typing.
// Still pure data (node-safe). generateCampaign(seed, params, bestiaryTable)
// → { seed, params, floors: Dungeon[], checksum }.
//
// World offsets (this module's co-op travel trick): every floor gets an
// {ox, oy} placing it in world space so that floor k+1's DOWN portal stands
// EXACTLY where floor k's UP portal stands. Traveling rebuilds the world
// around the players — whoever is on the portal is standing on the arrival
// portal of the next floor, so nobody needs a (SDK-less) teleport.

import { generateDungeon, dungeonChecksum, FLOOR, DEFAULT_PARAMS } from './dungeon.js';
import { makeRng, hash32, checksum32 } from './rng.js';
import { BESTIARY } from './bestiary.js';

export const DEFAULT_CAMPAIGN_PARAMS = { ...DEFAULT_PARAMS, levelCount: 5, theme: 'auto', roomCount: 0 };

export const THEMES = [
	{ id: 'crypt', floorTints: [0x5d6b58, 0x556455, 0x4e5c52, 0x616f5c], corridorTint: 0x44493f, wallTint: 0x3d4438, fogColor: 0x06080a, torchColor: 0xff8c3a, gemColor: 0x3adfae },
	{ id: 'sewer', floorTints: [0x46584a, 0x3e5346, 0x50604c, 0x394d42], corridorTint: 0x323d33, wallTint: 0x2e3b31, fogColor: 0x04100c, torchColor: 0xd8b23a, gemColor: 0x51e0d4 },
	{ id: 'forge', floorTints: [0x554744, 0x5d4a41, 0x4f423e, 0x63504a], corridorTint: 0x3c332f, wallTint: 0x372e2a, fogColor: 0x120705, torchColor: 0xff5a26, gemColor: 0xffb347 },
	{ id: 'frost', floorTints: [0x4c5a6c, 0x525f72, 0x475466, 0x596678], corridorTint: 0x39434f, wallTint: 0x333d49, fogColor: 0x060a14, torchColor: 0x6ad2ff, gemColor: 0x9fdcff },
	{ id: 'roost', floorTints: [0x50465e, 0x574c66, 0x494056, 0x5e526d], corridorTint: 0x393245, wallTint: 0x342e3f, fogColor: 0x0a0512, torchColor: 0xc99aff, gemColor: 0xe08aff }
];

/** @param {number} floorIndex 1-based @param {string} theme */
export function themeFor(floorIndex, theme = 'auto') {
	if (theme !== 'auto') return THEMES.find((t) => t.id === theme) ?? THEMES[0];
	return THEMES[(floorIndex - 1) % THEMES.length];
}

/** Auto room-count ramp: min(34 + 6·(i−1), 60); explicit roomCount overrides. */
export function roomCountFor(floorIndex, params) {
	if (params.roomCount) return params.roomCount;
	return Math.min(34 + 6 * (floorIndex - 1), 60);
}

/** Pick the free floor cell nearest a target, skipping taken kinds. */
function nearestFreeCell(dungeon, tx, ty, blocked) {
	const { W, H, grid } = dungeon;
	let best = null, bestD = Infinity;
	for (let y = 1; y < H - 1; y++)
		for (let x = 1; x < W - 1; x++) {
			if (grid[y * W + x] !== FLOOR || blocked.has(y * W + x)) continue;
			const d = (x - tx) * (x - tx) + (y - ty) * (y - ty);
			if (d < bestD) { bestD = d; best = { x, y }; }
		}
	return best;
}

/** Portal placement (3.3): UP in the boss room, DOWN in the entrance room. */
function placePortals(dungeon, floorIndex, levelCount) {
	const boss = dungeon.rooms[dungeon.bossId];
	const entrance = dungeon.rooms[dungeon.entranceId];
	const { W } = dungeon;
	// props may sit on candidate cells: debris is evictable, everything else blocks
	const blocked = new Set();
	dungeon.props.forEach((p) => {
		if (p.kind === 'torch' || p.kind === 'debris') return;
		blocked.add(p.y * W + p.x);
	});
	dungeon.spawns.forEach((s) => blocked.add(s.y * W + s.x));

	const addPortal = (kind, room, gated) => {
		const cell = nearestFreeCell(dungeon, room.cx, room.cy, blocked);
		if (!cell) return null;
		// evict debris standing on/next to the portal; reserve the 4-neighbors
		dungeon.props = dungeon.props.filter(
			(p) => !(p.kind === 'debris' && Math.abs(p.x - cell.x) <= 1 && Math.abs(p.y - cell.y) <= 1)
		);
		for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]])
			blocked.add((cell.y + dy) * W + (cell.x + dx));
		const portal = { kind, x: cell.x, y: cell.y, roomId: room.id, gated };
		dungeon.portals.push(portal);
		return portal;
	};

	if (floorIndex < levelCount) addPortal('up', boss, true);
	else {
		// top floor: the boss room is the dragon arena — no UP portal
		boss.type = 'dragon';
	}
	if (floorIndex >= 2) addPortal('down', entrance, false);
}

/** Spawn typing (3.4) from an injected bestiary table (dependency-injected). */
function typeSpawns(dungeon, floorIndex, bestiaryTable, rng) {
	const legal = bestiaryTable.filter((b) => floorIndex >= b.floors[0] && floorIndex <= b.floors[1]);
	if (!legal.length) return;
	const total = legal.reduce((s, b) => s + b.weight, 0);
	dungeon.spawns.forEach((spawn) => {
		let roll = rng.float(0, total);
		spawn.type = legal[legal.length - 1].id;
		for (const b of legal) {
			roll -= b.weight;
			if (roll <= 0) { spawn.type = b.id; break; }
		}
	});
	// variety pass: with ≥ 12 slots every legal type appears at least once
	if (dungeon.spawns.length >= 12) {
		const present = new Set(dungeon.spawns.map((s) => s.type));
		const missing = legal.filter((b) => !present.has(b.id));
		missing.forEach((b) => {
			const slot = dungeon.spawns[rng.int(0, dungeon.spawns.length - 1)];
			slot.type = b.id;
		});
	}
}

/**
 * The full campaign: levelCount floors, per-floor seeds hash(seed, i, 'floor'),
 * ramps, themes, portals (validated chain), typed spawns, world offsets.
 * @param {number} seed @param {object=} params @param {any[]=} bestiaryTable
 */
export function generateCampaign(seed, params = {}, bestiaryTable = BESTIARY) {
	const merged = { ...DEFAULT_CAMPAIGN_PARAMS, ...params };
	merged.levelCount = Math.min(Math.max(merged.levelCount ?? 5, 1), 9);
	const floors = [];
	for (let i = 1; i <= merged.levelCount; i++) {
		const floorSeed = hash32(seed, i, 'floor');
		const floorParams = {
			...merged,
			roomCount: roomCountFor(i, merged),
			monsterDensity: Math.min(merged.monsterDensity * (1 + 0.1 * (i - 1)), merged.monsterDensity * 1.5)
		};
		const dungeon = generateDungeon(floorSeed, floorParams, i);
		dungeon.theme = themeFor(i, merged.theme);
		// difficulty floor bias: +0.1·(i−1), cap 1.0 (boss stays 1.0)
		dungeon.rooms.forEach((room) => {
			if (room.type !== 'boss' && room.type !== 'dragon')
				room.difficulty = Math.min(1, room.difficulty + 0.1 * (i - 1));
		});
		placePortals(dungeon, i, merged.levelCount);
		typeSpawns(dungeon, i, bestiaryTable, makeRng(hash32(floorSeed, 'spawnTypes')));
		dungeon.checksum = dungeonChecksum(dungeon);
		floors.push(dungeon);
	}

	// world offsets: floor 1 centered at the origin; floor k+1 shifted so its
	// DOWN portal lands exactly on floor k's UP portal
	floors[0].ox = -(floors[0].W >> 1);
	floors[0].oy = -(floors[0].H >> 1);
	for (let k = 1; k < floors.length; k++) {
		const up = floors[k - 1].portals.find((p) => p.kind === 'up');
		const down = floors[k].portals.find((p) => p.kind === 'down');
		if (up && down) {
			floors[k].ox = floors[k - 1].ox + up.x - down.x;
			floors[k].oy = floors[k - 1].oy + up.y - down.y;
		} else {
			floors[k].ox = -(floors[k].W >> 1);
			floors[k].oy = -(floors[k].H >> 1);
		}
	}

	// campaign checksum: floors + portal coords (the determinism anchor)
	let h = 0x811c9dc5;
	floors.forEach((f) => {
		h = checksum32(f.grid, h);
		f.portals.forEach((p) => {
			h = checksum32(new Uint8Array([p.x & 0xff, p.x >> 8, p.y & 0xff, p.y >> 8, p.kind === 'up' ? 1 : 2]), h);
		});
	});

	const campaign = { seed: seed >>> 0, params: merged, floors, checksum: h >>> 0 };
	const failures = validateCampaign(campaign);
	if (failures.length) throw new Error('campaign validation failed: ' + failures.join('; '));
	return campaign;
}

/** @returns {string[]} failures (empty = valid) */
export function validateCampaign(campaign) {
	const failures = [];
	const { floors, params } = campaign;
	if (floors.length !== params.levelCount) failures.push('floor count ' + floors.length + ' != ' + params.levelCount);
	for (let k = 0; k < floors.length; k++) {
		const floor = floors[k];
		const i = k + 1;
		const up = floor.portals.find((p) => p.kind === 'up');
		const down = floor.portals.find((p) => p.kind === 'down');
		if (i < floors.length && (!up || !up.gated)) failures.push('floor ' + i + ' missing gated UP portal');
		if (i === floors.length && up) failures.push('top floor has an UP portal');
		if (i >= 2 && !down) failures.push('floor ' + i + ' missing DOWN portal');
		if (i === 1 && down) failures.push('floor 1 has a DOWN portal');
		for (const portal of floor.portals) {
			const cell = portal.y * floor.W + portal.x;
			if (floor.grid[cell] !== FLOOR) failures.push('floor ' + i + ' portal off floor');
			if (floor.bfs[cell] < 0) failures.push('floor ' + i + ' portal unreachable from entrance');
		}
	}
	return failures;
}
