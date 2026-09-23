// The Kit's renderer — data in, InstancedMesh out. LEVEL geometry (floor/wall/
// pillar) is 3 draw calls; each decor prop kind is one more (spec target: level
// geometry in <= 10). Per-instance colors bake AO (adjacent-wall darkening) +
// value noise + room tint. Everything mounts under ONE group the caller owns.
//
// 21-C C6: moved here from dungeon-realms with the generator. GEMS and PORTALS
// are NOT drawn here any more — they are Dungeon Realms' objective and its
// overlay renders them from the play contract (userData.play.props/portals), so
// the Kit stays a level generator and a rule module owns what it plays with.

import { FLOOR, WALL } from './gen/dungeon.js';
import { LOOK, stoneTint, flameFlicker, pickLights, stoneTexture } from './look.js';

/** P4: the two stone textures, built once per page (the same bytes on every peer) @type {any} */
let textures = null;
/** @param {any} THREE */
function stoneTextures(THREE) {
	if (textures) return textures;
	const make = (/** @type {'brick' | 'flag'} */ kind) => {
		const t = new THREE.DataTexture(stoneTexture(kind), LOOK.textureSize, LOOK.textureSize);
		t.wrapS = t.wrapT = THREE.RepeatWrapping;
		t.magFilter = THREE.LinearFilter;
		t.minFilter = THREE.LinearMipmapLinearFilter;
		t.generateMipmaps = true;
		t.colorSpace = THREE.SRGBColorSpace;
		t.needsUpdate = true;
		return t;
	};
	textures = { brick: make('brick'), flag: make('flag') };
	return textures;
}

/** deterministic per-cell value noise in [1-amp, 1+amp] */
function cellNoise(x, y, seed, amp = 0.05) {
	let h = (Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ seed) >>> 0;
	h = Math.imul(h ^ (h >>> 13), 0x5bd1e995) >>> 0;
	return 1 - amp + ((h & 0xffff) / 0xffff) * amp * 2;
}

/**
 * Build one floor's meshes. Returns the group — the caller names it, stamps
 * userData and adds it to the scene root.
 * @param {any} THREE @param {any} dungeon (with ox/oy world offsets)
 */
export function buildFloorGroup(THREE, dungeon) {
	const { W, H, grid, rooms, props, theme, ox, oy } = dungeon;
	const group = new THREE.Group();
	const matrix = new THREE.Matrix4();
	const position = new THREE.Vector3();
	const quaternion = new THREE.Quaternion();
	const scale = new THREE.Vector3(1, 1, 1);
	const color = new THREE.Color();
	const worldX = (x) => x + ox + 0.5;
	const worldZ = (y) => y + oy + 0.5;

	// which room does a cell belong to (for tints)? re-derive cheaply
	const roomOf = new Int16Array(W * H).fill(-1);
	rooms.forEach((room) => {
		for (let y = room.y; y < room.y + room.h; y++)
			for (let x = room.x; x < room.x + room.w; x++)
				if (grid[y * W + x] === FLOOR) roomOf[y * W + x] = room.id;
	});

	// ---- floors + walls (instanced, per-instance color) ----------------------
	let floorCount = 0, wallCount = 0;
	for (let i = 0; i < grid.length; i++) {
		if (grid[i] === FLOOR) floorCount++;
		else if (grid[i] === WALL) wallCount++;
	}
	// P4: STONE — flagstones on the floors, coursed blocks on the walls: one procedural texture
	// each as the colour map (the walls also bump with it: recessed mortar), tinted per block
	// below. Bump only where it reads (walls at eye height) — it costs per pixel
	const tex = stoneTextures(THREE);
	const floorMesh = new THREE.InstancedMesh(
		new THREE.BoxGeometry(1, 0.2, 1),
		// matte stone: Lambert (the floor and the vault fill most of the frame — per-pixel cost)
		new THREE.MeshLambertMaterial({ color: 0xffffff, map: tex.flag }),
		floorCount
	);
	floorMesh.name = 'dk-floors';
	const wallMesh = new THREE.InstancedMesh(
		new THREE.BoxGeometry(1, 1, 1),
		new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: LOOK.wallRoughness, map: tex.brick, bumpMap: tex.brick, bumpScale: 1.8 }),
		wallCount
	);
	wallMesh.name = 'dk-walls';
	const wallsAround = (x, y) => {
		let count = 0;
		for (let dy = -1; dy <= 1; dy++)
			for (let dx = -1; dx <= 1; dx++) {
				const nx = x + dx, ny = y + dy;
				if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
				if (grid[ny * W + nx] === WALL) count++;
			}
		return count;
	};
	let floorIndex = 0, wallIndex = 0;
	for (let y = 0; y < H; y++)
		for (let x = 0; x < W; x++) {
			const cell = grid[y * W + x];
			if (cell === FLOOR) {
				// 30: the tile's top sits a hair ABOVE y = 0, where the editor grid draws
				matrix.makeTranslation(worldX(x), LOOK.floorTop - 0.1, worldZ(y));
				floorMesh.setMatrixAt(floorIndex, matrix);
				const roomId = roomOf[y * W + x];
				const tint = stoneTint(roomId >= 0 ? theme.floorTints[roomId % theme.floorTints.length] : theme.corridorTint, LOOK.floorLift);
				const ao = 1 - 0.09 * Math.min(wallsAround(x, y), 4);
				color.setHex(tint).multiplyScalar(ao * cellNoise(x, y, dungeon.stats.seed, 0.12) * (roomId >= 0 ? 1 : 0.9));
				floorMesh.setColorAt(floorIndex, color);
				floorIndex++;
			} else if (cell === WALL) {
				// ruined silhouette: height 2.0 ± 0.25 seeded jitter
				const height = 2 + (cellNoise(x, y, dungeon.stats.seed ^ 0x5eed, 0.125) - 1) * 2;
				position.set(worldX(x), height / 2, worldZ(y));
				scale.set(1, height, 1);
				matrix.compose(position, quaternion, scale);
				wallMesh.setMatrixAt(wallIndex, matrix);
				// P4: every block its own shade and a slight warm/cool cast — no two stones alike
				color.setHex(stoneTint(theme.wallTint, LOOK.wallLift)).multiplyScalar(cellNoise(x, y, dungeon.stats.seed ^ 0xa11, 0.16));
				color.r *= cellNoise(x, y, dungeon.stats.seed ^ 0xc01, 0.05);
				color.b *= cellNoise(x, y, dungeon.stats.seed ^ 0xc02, 0.05);
				wallMesh.setColorAt(wallIndex, color);
				wallIndex++;
			}
		}
	scale.set(1, 1, 1);
	group.add(floorMesh, wallMesh);

	// P4: the VAULT — one plane over the whole level facing DOWN (single-sided): from above (the
	// editor, a card) it is culled and invisible, from inside it closes the sky. The Kit shows it
	// only while playing (animateFloor's `playing`), so the editor keeps its open view.
	// (it runs LOOK.vaultMargin past the level so no sky shows over the outer walls' low tops)
	const VW = W + LOOK.vaultMargin * 2;
	const VH = H + LOOK.vaultMargin * 2;
	const vault = new THREE.PlaneGeometry(VW, VH);
	const uv = vault.attributes.uv;
	for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * VW, uv.getY(i) * VH);
	const ceiling = new THREE.Mesh(vault, new THREE.MeshLambertMaterial({ color: LOOK.ceilingTint, map: tex.brick }));
	ceiling.name = 'dk-ceiling';
	ceiling.rotation.x = Math.PI / 2;
	ceiling.position.set(ox + W / 2, LOOK.ceilingY, oy + H / 2);
	ceiling.visible = false;
	group.add(ceiling);

	// ---- props (one InstancedMesh per kind) -----------------------------------
	const byKind = {};
	props.forEach((p) => (byKind[p.kind] ??= []).push(p));

	/** @param {any} geometry @param {any} material @param {any[]} list @param {(p: any, i: number) => void} pose */
	const instanced = (name, geometry, material, list, pose) => {
		if (!list?.length) return null;
		const mesh = new THREE.InstancedMesh(geometry, material, list.length);
		mesh.name = name;
		list.forEach((p, i) => {
			pose(p, i);
			matrix.compose(position, quaternion, scale);
			mesh.setMatrixAt(i, matrix);
		});
		position.set(0, 0, 0);
		quaternion.identity();
		scale.set(1, 1, 1);
		group.add(mesh);
		return mesh;
	};

	instanced('dk-pillars', new THREE.CylinderGeometry(0.3, 0.38, 2.4, 8),
		new THREE.MeshStandardMaterial({ color: stoneTint(theme.wallTint, LOOK.wallLift), roughness: 0.8, map: tex.brick }),
		byKind.pillar, (p) => position.set(worldX(p.x), 1.2, worldZ(p.y)));

	instanced('dk-debris', new THREE.BoxGeometry(0.32, 0.22, 0.32),
		new THREE.MeshStandardMaterial({ color: stoneTint(theme.corridorTint, LOOK.floorLift), roughness: 1, map: tex.brick }),
		byKind.debris, (p) => {
			position.set(worldX(p.x), 0.1, worldZ(p.y));
			quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.rot ?? 0);
			scale.setScalar(p.scale ?? 1);
		});
	quaternion.identity();
	scale.set(1, 1, 1);

	instanced('dk-crates', new THREE.BoxGeometry(0.72, 0.72, 0.72),
		new THREE.MeshStandardMaterial({ color: 0x8a6a3d, roughness: 0.9 }),
		byKind.crate, (p) => position.set(worldX(p.x), 0.36, worldZ(p.y)));

	instanced('dk-braziers', new THREE.CylinderGeometry(0.3, 0.2, 0.55, 8),
		new THREE.MeshStandardMaterial({ color: 0x2c2c34, roughness: 0.6, metalness: 0.4 }),
		byKind.brazier, (p) => position.set(worldX(p.x), 0.28, worldZ(p.y)));

	instanced('dk-chests', new THREE.BoxGeometry(0.85, 0.55, 0.6),
		new THREE.MeshStandardMaterial({ color: 0xb08a2e, roughness: 0.5, metalness: 0.3 }),
		byKind.chest, (p) => position.set(worldX(p.x), 0.28, worldZ(p.y)));

	instanced('dk-crystals', new THREE.OctahedronGeometry(0.42, 0),
		new THREE.MeshStandardMaterial({ color: theme.gemColor, emissive: theme.gemColor, emissiveIntensity: 1.6, roughness: 0.3 }),
		byKind.crystal, (p) => {
			position.set(worldX(p.x), 1, worldZ(p.y));
			scale.set(1, 1.7, 1);
		});
	scale.set(1, 1, 1);

	instanced('dk-rings', new THREE.TorusGeometry(0.9, 0.07, 8, 28),
		new THREE.MeshBasicMaterial({ color: 0x3ad0c4 }),
		byKind.ring, (p) => {
			position.set(worldX(p.x), 0.06, worldZ(p.y));
			quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
		});
	quaternion.identity();

	// torches: P4 real SCONCES — an iron bracket on the wall face, a bowl and a flickering flame
	// (the bloom pass makes the glow); braziers get the flame
	const torches = byKind.torch ?? [];
	const onWall = (/** @type {any} */ p, /** @type {number} */ out) => ({ x: worldX(p.x) + (p.fx ?? 0) * out, z: worldZ(p.y) + (p.fy ?? 0) * out });
	instanced('dk-torch-brackets', new THREE.BoxGeometry(0.09, 0.42, 0.09),
		new THREE.MeshStandardMaterial({ color: 0x2a2520, roughness: 0.55, metalness: 0.6 }),
		torches, (p) => { const w = onWall(p, 0.44); position.set(w.x, 1.5, w.z); });
	instanced('dk-torch-bowls', new THREE.CylinderGeometry(0.13, 0.06, 0.12, 10),
		new THREE.MeshStandardMaterial({ color: 0x4a3a28, roughness: 0.45, metalness: 0.7 }),
		torches, (p) => { const w = onWall(p, 0.4); position.set(w.x, 1.74, w.z); });
	const flameSpots = torches.map((p) => ({ ...onWall(p, 0.4), y: 1.95 }))
		.concat((byKind.brazier ?? []).map((p) => ({ x: worldX(p.x), y: 0.75, z: worldZ(p.y) })));
	// 30: the flames GLOW (emissive over 1: the bloom pass catches them) and flicker per torch
	// (animateFloor stretches each instance from its own base pose)
	const flames = instanced('dk-flames', new THREE.ConeGeometry(0.15, 0.46, 7),
		new THREE.MeshStandardMaterial({ color: theme.torchColor, emissive: theme.torchColor, emissiveIntensity: LOOK.flameIntensity, roughness: 1 }),
		flameSpots, (p) => position.set(p.x, p.y, p.z));
	if (flames) flames.userData.spots = flameSpots;
	// point lights — CAPPED at LOOK.lightBudget, no shadow maps. At build they sit on the torches
	// nearest the entrance hall (the spawn) and spread; in play animateFloor moves them to the
	// torches nearest the player, so every torch you walk past throws a warm pool
	const entrance = rooms.find((r) => r.type === 'entrance');
	const focus = entrance ? { x: entrance.x + ox + entrance.w / 2, z: entrance.y + oy + entrance.h / 2 } : null;
	for (const i of pickLights(flameSpots, focus, LOOK.lightBudget)) {
		const spot = flameSpots[i];
		const light = new THREE.PointLight(theme.torchColor, LOOK.lightIntensity, LOOK.lightDistance, 2);
		light.name = 'dk-light';
		light.position.set(spot.x, spot.y + 0.25, spot.z);
		group.add(light);
	}

	// runtime bookkeeping (scene-root only — never serialized)
	group.userData._dk = { theme, flameSpots, assignedAt: -1 };
	return group;
}

/**
 * Per-frame juice the Kit owns: torch light and flame flicker, the vault while playing, and the
 * capped lights following the player. @param {any} group @param {number} time
 * @param {{playing?: boolean, player?: {x: number, z: number} | null}} [view]
 */
export function animateFloor(group, time, view = {}) {
	const dk = group.userData._dk;
	// P4: re-seat the capped lights on the torches nearest the player (a few times a second;
	// the COUNT never changes, so no material recompiles)
	if (view.player && dk?.flameSpots?.length && time - dk.assignedAt > LOOK.lightReassign) {
		dk.assignedAt = time;
		const lights = group.children.filter((/** @type {any} */ c) => c.name === 'dk-light');
		const nearest = pickLights(dk.flameSpots, view.player, lights.length, lights.length);
		nearest.forEach((i, k) => {
			const spot = dk.flameSpots[i];
			lights[k].position.set(spot.x, spot.y + 0.25, spot.z);
		});
	}
	group.children.forEach((child) => {
		if (child.name === 'dk-light')
			child.intensity = LOOK.lightIntensity * (1 + Math.sin(time * 9 + child.position.x * 3.7) * 0.18 + Math.sin(time * 23 + child.position.z * 5.1) * 0.1);
		else if (child.name === 'dk-ceiling') child.visible = !!view.playing;
		else if (child.name === 'dk-flames' && child.userData.spots) {
			// each flame from its OWN base pose every frame (never accumulated)
			const m = child.userData._m ??= child.matrix.clone();
			child.userData.spots.forEach((/** @type {any} */ p, /** @type {number} */ i) => {
				const k = flameFlicker(time, p.x, p.z);
				m.makeScale(1 / Math.sqrt(k), k, 1 / Math.sqrt(k)).setPosition(p.x, p.y + (k - 1) * 0.15, p.z);
				child.setMatrixAt(i, m);
			});
			child.instanceMatrix.needsUpdate = true;
		}
	});
}
