// C2 renderer — data in, InstancedMesh out. LEVEL geometry (floor/wall/pillar)
// is 3 draw calls; each prop kind is one more (spec target: level geometry in
// ≤ 10). Per-instance colors bake AO (adjacent-wall darkening) + value noise +
// room tint. Everything mounts under ONE scene-root group the caller owns.

import { FLOOR, WALL } from './gen/dungeon.js';

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
 * @param {Set<number>} collected collected gem indices on this floor
 */
export function buildFloorGroup(THREE, dungeon, collected) {
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
	const floorMesh = new THREE.InstancedMesh(
		new THREE.BoxGeometry(1, 0.2, 1),
		new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95 }),
		floorCount
	);
	floorMesh.name = 'dr-floors';
	const wallMesh = new THREE.InstancedMesh(
		new THREE.BoxGeometry(1, 1, 1),
		new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 }),
		wallCount
	);
	wallMesh.name = 'dr-walls';
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
				matrix.makeTranslation(worldX(x), -0.1, worldZ(y));
				floorMesh.setMatrixAt(floorIndex, matrix);
				const roomId = roomOf[y * W + x];
				const tint = roomId >= 0 ? theme.floorTints[roomId % theme.floorTints.length] : theme.corridorTint;
				const ao = 1 - 0.09 * Math.min(wallsAround(x, y), 4);
				color.setHex(tint).multiplyScalar(ao * cellNoise(x, y, dungeon.stats.seed) * (roomId >= 0 ? 1 : 0.9));
				floorMesh.setColorAt(floorIndex, color);
				floorIndex++;
			} else if (cell === WALL) {
				// ruined silhouette: height 2.0 ± 0.25 seeded jitter
				const height = 2 + (cellNoise(x, y, dungeon.stats.seed ^ 0x5eed, 0.125) - 1) * 2;
				position.set(worldX(x), height / 2, worldZ(y));
				scale.set(1, height, 1);
				matrix.compose(position, quaternion, scale);
				wallMesh.setMatrixAt(wallIndex, matrix);
				color.setHex(theme.wallTint).multiplyScalar(cellNoise(x, y, dungeon.stats.seed ^ 0xa11));
				wallMesh.setColorAt(wallIndex, color);
				wallIndex++;
			}
		}
	scale.set(1, 1, 1);
	group.add(floorMesh, wallMesh);

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

	instanced('dr-pillars', new THREE.CylinderGeometry(0.3, 0.38, 2.4, 8),
		new THREE.MeshStandardMaterial({ color: theme.wallTint, roughness: 0.85 }),
		byKind.pillar, (p) => position.set(worldX(p.x), 1.2, worldZ(p.y)));

	instanced('dr-debris', new THREE.BoxGeometry(0.32, 0.22, 0.32),
		new THREE.MeshStandardMaterial({ color: theme.corridorTint, roughness: 1 }),
		byKind.debris, (p) => {
			position.set(worldX(p.x), 0.1, worldZ(p.y));
			quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.rot ?? 0);
			scale.setScalar(p.scale ?? 1);
		});
	quaternion.identity();
	scale.set(1, 1, 1);

	instanced('dr-crates', new THREE.BoxGeometry(0.72, 0.72, 0.72),
		new THREE.MeshStandardMaterial({ color: 0x8a6a3d, roughness: 0.9 }),
		byKind.crate, (p) => position.set(worldX(p.x), 0.36, worldZ(p.y)));

	instanced('dr-braziers', new THREE.CylinderGeometry(0.3, 0.2, 0.55, 8),
		new THREE.MeshStandardMaterial({ color: 0x2c2c34, roughness: 0.6, metalness: 0.4 }),
		byKind.brazier, (p) => position.set(worldX(p.x), 0.28, worldZ(p.y)));

	instanced('dr-chests', new THREE.BoxGeometry(0.85, 0.55, 0.6),
		new THREE.MeshStandardMaterial({ color: 0xb08a2e, roughness: 0.5, metalness: 0.3 }),
		byKind.chest, (p) => position.set(worldX(p.x), 0.28, worldZ(p.y)));

	instanced('dr-crystals', new THREE.OctahedronGeometry(0.42, 0),
		new THREE.MeshBasicMaterial({ color: theme.gemColor }),
		byKind.crystal, (p) => {
			position.set(worldX(p.x), 1, worldZ(p.y));
			scale.set(1, 1.7, 1);
		});
	scale.set(1, 1, 1);

	instanced('dr-rings', new THREE.TorusGeometry(0.9, 0.07, 8, 28),
		new THREE.MeshBasicMaterial({ color: 0x3ad0c4 }),
		byKind.ring, (p) => {
			position.set(worldX(p.x), 0.06, worldZ(p.y));
			quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
		});
	quaternion.identity();

	// torches: bracket on the wall face + unlit flame above it
	const torches = byKind.torch ?? [];
	instanced('dr-torch-brackets', new THREE.BoxGeometry(0.12, 0.34, 0.12),
		new THREE.MeshStandardMaterial({ color: 0x3a3126, roughness: 0.8 }),
		torches, (p) => position.set(worldX(p.x) + (p.fx ?? 0) * 0.42, 1.45, worldZ(p.y) + (p.fy ?? 0) * 0.42));
	const flameSpots = torches.map((p) => ({
		x: worldX(p.x) + (p.fx ?? 0) * 0.42, y: 1.78, z: worldZ(p.y) + (p.fy ?? 0) * 0.42
	})).concat((byKind.brazier ?? []).map((p) => ({ x: worldX(p.x), y: 0.75, z: worldZ(p.y) })));
	instanced('dr-flames', new THREE.ConeGeometry(0.11, 0.3, 6),
		new THREE.MeshBasicMaterial({ color: theme.torchColor }),
		flameSpots, (p) => position.set(p.x, p.y, p.z));

	// point lights on a spread torch subset (≤ 8) — no shadow maps
	const budget = 8;
	const step = Math.max(1, Math.ceil(flameSpots.length / budget));
	for (let i = 0; i < flameSpots.length && i / step < budget; i += step) {
		const spot = flameSpots[i];
		const light = new THREE.PointLight(theme.torchColor, 5, 11, 2);
		light.name = 'dr-light';
		light.position.set(spot.x, spot.y + 0.25, spot.z);
		group.add(light);
	}

	// ---- gems (the collectible objective) -------------------------------------
	const gems = (byKind.gem ?? []).slice().sort((a, b) => a.index - b.index);
	const gemWorld = gems.map((p) => ({ x: worldX(p.x), y: 0.55, z: worldZ(p.y), index: p.index }));
	const gemMesh = new THREE.InstancedMesh(
		new THREE.OctahedronGeometry(0.17, 0),
		new THREE.MeshBasicMaterial({ color: theme.gemColor }),
		Math.max(1, gemWorld.length)
	);
	gemMesh.name = 'dr-gems';
	gemMesh.count = gemWorld.length;
	group.add(gemMesh);

	// ---- portals ---------------------------------------------------------------
	dungeon.portals.forEach((portal) => {
		const portalGroup = new THREE.Group();
		portalGroup.name = 'dr-portal-' + portal.kind;
		portalGroup.position.set(worldX(portal.x), 0, worldZ(portal.y));
		const ring = new THREE.Mesh(
			new THREE.TorusGeometry(1.05, 0.1, 10, 36),
			new THREE.MeshBasicMaterial({ color: 0x555a66 })
		);
		ring.name = 'dr-portal-ring';
		ring.rotation.x = -Math.PI / 2;
		ring.position.y = 0.1;
		const disc = new THREE.Mesh(
			new THREE.CircleGeometry(0.92, 28),
			new THREE.MeshBasicMaterial({ color: 0x394050, transparent: true, opacity: 0.55 })
		);
		disc.name = 'dr-portal-disc';
		disc.rotation.x = -Math.PI / 2;
		disc.position.y = 0.08;
		portalGroup.add(ring, disc);
		portalGroup.userData.portal = { kind: portal.kind, gated: portal.gated };
		group.add(portalGroup);
	});

	// runtime bookkeeping the game loop reads (scene-root only — never serialized)
	group.userData._dr = { gemWorld, theme };
	applyGems(group, collected);
	return group;
}

/** Zero-scale collected gems; bob+spin comes from animateFloor. */
export function applyGems(group, collected) {
	const gemMesh = group.getObjectByName('dr-gems');
	const { gemWorld } = group.userData._dr;
	if (!gemMesh || !gemWorld.length) return;
	const matrix = new (gemMesh.matrixWorld.constructor)();
	gemWorld.forEach((gem, i) => {
		if (collected.has(gem.index)) matrix.makeScale(0, 0, 0);
		else matrix.makeTranslation(gem.x, gem.y, gem.z);
		gemMesh.setMatrixAt(i, matrix);
	});
	gemMesh.instanceMatrix.needsUpdate = true;
}

/** Seal/unseal the UP portal visuals. @param {boolean} sealed */
export function setPortalSealed(group, sealed, theme) {
	const portal = group.getObjectByName('dr-portal-up');
	if (!portal) return;
	const ring = portal.getObjectByName('dr-portal-ring');
	const disc = portal.getObjectByName('dr-portal-disc');
	if (ring) ring.material.color.setHex(sealed ? 0x555a66 : 0x39e0ff);
	if (disc) {
		disc.material.color.setHex(sealed ? 0x394050 : theme?.gemColor ?? 0x39e0c0);
		disc.material.opacity = sealed ? 0.35 : 0.75;
	}
	portal.userData.portal.sealed = sealed;
	const down = group.getObjectByName('dr-portal-down');
	if (down) {
		down.getObjectByName('dr-portal-ring')?.material.color.setHex(0x39a0ff);
		down.userData.portal.sealed = false;
	}
}

/** Per-frame juice: gem spin/bob, portal ring spin, torch light flicker. */
export function animateFloor(THREE, group, collected, time) {
	const data = group.userData._dr;
	if (!data) return;
	const gemMesh = group.getObjectByName('dr-gems');
	if (gemMesh && data.gemWorld.length) {
		const matrix = new THREE.Matrix4();
		const position = new THREE.Vector3();
		const quaternion = new THREE.Quaternion();
		const scale = new THREE.Vector3(1, 1, 1);
		const axis = new THREE.Vector3(0, 1, 0);
		data.gemWorld.forEach((gem, i) => {
			if (collected.has(gem.index)) return; // stays zero-scaled
			position.set(gem.x, gem.y + Math.sin(time * 2 + gem.x) * 0.08, gem.z);
			quaternion.setFromAxisAngle(axis, time * 1.6 + gem.index);
			matrix.compose(position, quaternion, scale);
			gemMesh.setMatrixAt(i, matrix);
		});
		gemMesh.instanceMatrix.needsUpdate = true;
	}
	group.children.forEach((child) => {
		if (child.name === 'dr-portal-up' || child.name === 'dr-portal-down') {
			const ring = child.getObjectByName('dr-portal-ring');
			if (ring && child.userData.portal?.sealed === false) ring.rotation.z = time * 0.8;
		} else if (child.name === 'dr-light') {
			child.intensity = 5 + Math.sin(time * 9 + child.position.x * 3.7) * 0.9 + Math.sin(time * 23 + child.position.z * 5.1) * 0.5;
		}
	});
}
