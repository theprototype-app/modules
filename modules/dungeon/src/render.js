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
import { LOOK, LIT, stoneTint, flameFlicker, pickLights, stoneTexture, bakeTorchLight, litShade, haloTexture, stepLightSlots } from './look.js';
import { torchParts, SOLID_PARTS, TORCH_SCALE, TORCH_BASE_Y, FLAME_AT, FLAME_GROW } from './torch.js';

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
	// 30b: the torch halo (white — the instance colour carries the hue)
	const halo = new THREE.DataTexture(haloTexture(), LIT.haloTextureSize, LIT.haloTextureSize);
	halo.magFilter = THREE.LinearFilter;
	halo.minFilter = THREE.LinearFilter;
	halo.needsUpdate = true;
	textures.halo = halo;
	return textures;
}

/** 30b: vertex-colour AO on a box/cylinder — dark at its foot, full at its top (multiplied
 * with the instance colour: the stone darkens into the floor, the way a torch-lit room reads)
 * @param {any} THREE @param {any} geometry @param {number} foot shade at the bottom */
function footShade(THREE, geometry, foot) {
	const pos = geometry.attributes.position;
	geometry.computeBoundingBox();
	const { min, max } = geometry.boundingBox;
	const colors = new Float32Array(pos.count * 3);
	for (let i = 0; i < pos.count; i++) {
		const t = (pos.getY(i) - min.y) / Math.max(1e-6, max.y - min.y);
		const v = foot + (1 - foot) * Math.min(1, t * 1.6);
		colors[i * 3] = colors[i * 3 + 1] = colors[i * 3 + 2] = v;
	}
	geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
	return geometry;
}

/**
 * 30b: TORCH-LIT stone — the baked torch light as EMISSIVE. Each instance carries its cell's
 * baked light (a `torchLight` instance attribute, 0..1); the fragment adds the surface's own
 * albedo x the torch colour x that light to its emissive, so a lit wall reads warm and bright
 * with no real light near it (the point lights are four; the torches are hundreds), a dark
 * stretch stays dark, and it costs one multiply per pixel. `uTorch.w` is a global flicker.
 * @param {any} THREE @param {any} material @param {number} torchColor @param {number} gain
 */
function torchLit(THREE, material, torchColor, gain) {
	const uniform = { value: new THREE.Vector4() };
	const c = new THREE.Color(torchColor);
	uniform.value.set(c.r * gain, c.g * gain, c.b * gain, 1);
	material.onBeforeCompile = (/** @type {any} */ shader) => {
		shader.uniforms.uTorch = uniform;
		shader.vertexShader = shader.vertexShader
			.replace('#include <common>', '#include <common>\nattribute float torchLight;\nvarying float vTorchLight;')
			.replace('#include <begin_vertex>', '#include <begin_vertex>\nvTorchLight = torchLight;');
		shader.fragmentShader = shader.fragmentShader
			.replace('#include <common>', '#include <common>\nuniform vec4 uTorch;\nvarying float vTorchLight;')
			.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * uTorch.rgb * (vTorchLight * uTorch.w);');
	};
	material.customProgramCacheKey = () => 'dk-torch-lit';
	material.userData.torch = uniform;
	return material;
}

/** the per-instance baked light a torchLit mesh reads @param {any} THREE @param {any} mesh @param {Float32Array} values */
function setTorchLight(THREE, mesh, values) {
	mesh.geometry.setAttribute('torchLight', new THREE.InstancedBufferAttribute(values, 1));
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

	// 30b: the torch light BAKED into every floor and wall cell a torch reaches (walls stop it)
	const torchProps = props.filter((p) => p.kind === 'torch');
	const baked = bakeTorchLight(grid, W, H, torchProps, { floor: FLOOR, wall: WALL });
	const warm = new THREE.Color(theme.torchColor);
	const white = new THREE.Color(1, 1, 1);
	const tint = new THREE.Color();
	/** colour *= the baked shade, warmed toward the torch colour where it is lit @param {number} i */
	const bake = (i) => {
		const light = baked[i];
		tint.copy(white).lerp(warm, LIT.bakeWarm * light).multiplyScalar(litShade(light));
		color.multiply(tint);
	};

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
		torchLit(THREE, new THREE.MeshLambertMaterial({ color: 0xffffff, map: tex.flag }), theme.torchColor, LIT.emissiveFloor),
		floorCount
	);
	floorMesh.name = 'dk-floors';
	const wallMesh = new THREE.InstancedMesh(
		footShade(THREE, new THREE.BoxGeometry(1, 1, 1), 0.55),
		torchLit(THREE, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: LOOK.wallRoughness, map: tex.brick, bumpMap: tex.brick, bumpScale: 1.8, vertexColors: true }), theme.torchColor, LIT.emissiveWall),
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
	const floorLight = new Float32Array(floorCount), wallLight = new Float32Array(wallCount);
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
				bake(y * W + x);
				floorLight[floorIndex] = baked[y * W + x];
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
				bake(y * W + x);
				wallLight[wallIndex] = baked[y * W + x];
				wallMesh.setColorAt(wallIndex, color);
				wallIndex++;
			}
		}
	scale.set(1, 1, 1);
	setTorchLight(THREE, floorMesh, floorLight);
	setTorchLight(THREE, wallMesh, wallLight);
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

	/** 30b: a prop kind's instances read the baked torch light of their cell @param {any} mesh @param {any[]} list */
	const propLit = (mesh, list) => {
		if (mesh && list?.length) setTorchLight(THREE, mesh, Float32Array.from(list.map((/** @type {any} */ p) => baked[p.y * W + p.x])));
		return mesh;
	};
	const pillars = instanced('dk-pillars', footShade(THREE, new THREE.CylinderGeometry(0.3, 0.38, 2.4, 8), 0.5),
		torchLit(THREE, new THREE.MeshStandardMaterial({ color: stoneTint(theme.wallTint, LOOK.wallLift), roughness: 0.8, map: tex.brick, vertexColors: true }), theme.torchColor, LIT.emissiveWall),
		byKind.pillar, (p) => position.set(worldX(p.x), 1.2, worldZ(p.y)));
	if (pillars) setTorchLight(THREE, pillars, Float32Array.from(byKind.pillar.map((/** @type {any} */ p) => baked[p.y * W + p.x])));

	propLit(instanced('dk-debris', new THREE.BoxGeometry(0.32, 0.22, 0.32),
		torchLit(THREE, new THREE.MeshStandardMaterial({ color: stoneTint(theme.corridorTint, LOOK.floorLift), roughness: 1, map: tex.brick }), theme.torchColor, LIT.emissiveWall),
		byKind.debris, (p) => {
			position.set(worldX(p.x), 0.1, worldZ(p.y));
			quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.rot ?? 0);
			scale.setScalar(p.scale ?? 1);
		}), byKind.debris);
	quaternion.identity();
	scale.set(1, 1, 1);

	propLit(instanced('dk-crates', new THREE.BoxGeometry(0.72, 0.72, 0.72),
		torchLit(THREE, new THREE.MeshStandardMaterial({ color: 0x8a6a3d, roughness: 0.9 }), theme.torchColor, LIT.emissiveWall),
		byKind.crate, (p) => position.set(worldX(p.x), 0.36, worldZ(p.y))), byKind.crate);

	propLit(instanced('dk-braziers', new THREE.CylinderGeometry(0.3, 0.2, 0.55, 8),
		torchLit(THREE, new THREE.MeshStandardMaterial({ color: 0x2c2c34, roughness: 0.6, metalness: 0.4 }), theme.torchColor, LIT.emissiveWall),
		byKind.brazier, (p) => position.set(worldX(p.x), 0.28, worldZ(p.y))), byKind.brazier);

	propLit(instanced('dk-chests', new THREE.BoxGeometry(0.85, 0.55, 0.6),
		torchLit(THREE, new THREE.MeshStandardMaterial({ color: 0xb08a2e, roughness: 0.5, metalness: 0.3 }), theme.torchColor, LIT.emissiveWall),
		byKind.chest, (p) => position.set(worldX(p.x), 0.28, worldZ(p.y))), byKind.chest);

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

	// torches: the props-kit WALL TORCH (30b integrate — round 2's were a bracket + a bowl + a
	// cone): its back on the wall face, facing the floor cell, one InstancedMesh per part;
	// the model's own Flame keeps the Kit's emissive glow and per-torch flicker; braziers get
	// a bigger flame on their rim
	const torches = byKind.torch ?? [];
	const onWall = (/** @type {any} */ p, /** @type {number} */ out) => ({ x: worldX(p.x) + (p.fx ?? 0) * out, z: worldZ(p.y) + (p.fy ?? 0) * out });
	const parts = torchParts(THREE);
	const yAxis = new THREE.Vector3(0, 1, 0);
	for (const name of SOLID_PARTS)
		instanced('dk-torch-' + name.replace(/^WallTorch_/, ''), parts[name].geometry, parts[name].material, torches, (p) => {
			const w = onWall(p, 0.505);
			position.set(w.x, TORCH_BASE_Y, w.z);
			quaternion.setFromAxisAngle(yAxis, Math.atan2(p.fx ?? 0, p.fy ?? 1));
			scale.setScalar(TORCH_SCALE);
		});
	const flameOut = 0.505 + FLAME_AT[2] * TORCH_SCALE;
	const flameBase = TORCH_BASE_Y + FLAME_AT[1] * TORCH_SCALE;
	const torchFlame = TORCH_SCALE * FLAME_GROW;
	// a spot is the flame's CENTRE (lights, halos' flicker); `by`/`sc` are its base and size
	const flameSpots = torches.map((p) => ({ ...onWall(p, flameOut), y: flameBase + 0.11 * torchFlame, by: flameBase, sc: torchFlame }))
		.concat((byKind.brazier ?? []).map((p) => ({ x: worldX(p.x), y: 0.75, z: worldZ(p.y), by: 0.55, sc: 2.4 })));
	// the flames GLOW (emissive over 1: the bloom pass catches them) and flicker per torch
	// (animateFloor stretches each instance from its own base pose)
	const flames = instanced('dk-flames', parts.Flame.geometry,
		new THREE.MeshStandardMaterial({ color: theme.torchColor, emissive: theme.torchColor, emissiveIntensity: LOOK.flameIntensity, roughness: 1 }),
		flameSpots, (p) => { position.set(p.x, p.by, p.z); scale.setScalar(p.sc); });
	if (flames) flames.userData.spots = flameSpots;
	// a white-hot core inside every flame (unlit, so it reads in VR where there is no bloom)
	const cores = instanced('dk-flame-cores', new THREE.ConeGeometry(0.03, 0.1, 6),
		new THREE.MeshBasicMaterial({ color: 0xfff1c8 }),
		flameSpots, (p) => { position.set(p.x, p.by + 0.05 * p.sc, p.z); scale.setScalar(p.sc); });
	if (cores) cores.userData.spots = flameSpots.map((p) => ({ ...p, by: p.by + 0.05 * p.sc }));

	// 30b: the CHEAP light every torch throws — a warm halo on the wall behind its flame and a
	// pool on the floor in front of it (additive, no depth write, fogged; each instance's colour
	// flickers with its flame in animateFloor). Braziers stand free: they get a pool only.
	const haloMat = () => new THREE.MeshBasicMaterial({ color: 0xffffff, map: tex.halo, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
	const facingY = new THREE.Vector3(0, 1, 0);
	const halos = instanced('dk-halos', new THREE.PlaneGeometry(LIT.haloSize, LIT.haloSize), haloMat(), torches, (p) => {
		// on the wall FACE (half a cell out from the wall's centre), facing into the room
		const w = onWall(p, 0.505);
		position.set(w.x, LIT.haloY, w.z);
		quaternion.setFromAxisAngle(facingY, Math.atan2(p.fx ?? 0, p.fy ?? 0));
	});
	quaternion.identity();
	const poolSpots = torches.map((p) => ({ ...onWall(p, 0.5 + LIT.poolOut) }))
		.concat((byKind.brazier ?? []).map((p) => ({ x: worldX(p.x), z: worldZ(p.y) })));
	const pools = instanced('dk-pools', new THREE.PlaneGeometry(LIT.poolSize, LIT.poolSize), haloMat(), poolSpots, (p) => {
		position.set(p.x, LOOK.floorTop + 0.004, p.z);
		quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
	});
	quaternion.identity();
	for (const [mesh, spots, opacity] of [[halos, torches.map((p) => onWall(p, LIT.sconceOut)), LIT.haloOpacity], [pools, poolSpots, LIT.poolOpacity]]) {
		if (!mesh) continue;
		mesh.renderOrder = 2;
		mesh.userData.flicker = { spots, opacity };
		spots.forEach((_, i) => mesh.setColorAt(i, color.set(theme.torchColor).multiplyScalar(opacity)));
	}

	// the REAL point lights — LOOK.lightBudget of them, no shadow maps. They start on the torches
	// nearest the entrance hall (the spawn) and spread; every frame animateFloor hands them to
	// the torches nearest the viewer, fading (stepLightSlots) — the COUNT never changes, so no
	// lit material recompiles
	const entrance = rooms.find((r) => r.type === 'entrance');
	const focus = entrance ? { x: entrance.x + ox + entrance.w / 2, z: entrance.y + oy + entrance.h / 2 } : null;
	const slots = [];
	for (const i of pickLights(flameSpots, focus, LOOK.lightBudget)) {
		const spot = flameSpots[i];
		const light = new THREE.PointLight(theme.torchColor, LOOK.lightIntensity, LOOK.lightDistance, 2);
		light.name = 'dk-light';
		light.position.set(spot.x, spot.y + 0.25, spot.z);
		light.userData.slot = slots.length;
		slots.push({ torch: i, w: 1 });
		group.add(light);
	}

	// runtime bookkeeping (scene-root only — never serialized)
	// the torch-lit materials' shared flicker (one uniform per material; animateFloor breathes them)
	const torchUniforms = [];
	group.traverse((/** @type {any} */ o) => { if (o.material?.userData?.torch) torchUniforms.push(o.material.userData.torch); });
	group.userData._dk = { theme, flameSpots, slots, lastTime: -1, baked, torchUniforms };
	return group;
}

/**
 * Per-frame juice the Kit owns: torch light and flame flicker, the halos breathing with their
 * flames, the vault while playing, and the capped lights following the viewer.
 * @param {any} group @param {number} time
 * @param {{playing?: boolean, player?: {x: number, z: number} | null}} [view]
 */
export function animateFloor(group, time, view = {}) {
	const dk = group.userData._dk;
	const dt = dk && dk.lastTime >= 0 ? Math.min(0.1, Math.max(0, time - dk.lastTime)) : 0;
	if (dk) dk.lastTime = time;
	// 30b: the budget goes to the torches nearest the VIEWER — in play and in the editor alike —
	// and a light fades out of one torch before it fades into the next (stepLightSlots)
	if (dk?.slots?.length && dk.flameSpots?.length) stepLightSlots(dk.slots, dk.flameSpots, view.player ?? null, dt);
	// the baked torchlight breathes a little (one global flicker — the halos carry each flame's own)
	if (dk?.torchUniforms) for (const u of dk.torchUniforms) u.value.w = 1 + Math.sin(time * 7.3) * 0.04 + Math.sin(time * 17.9) * 0.03;
	group.children.forEach((/** @type {any} */ child) => {
		if (child.name === 'dk-light') {
			const slot = dk?.slots?.[child.userData.slot];
			const spot = slot && slot.torch >= 0 ? dk.flameSpots[slot.torch] : null;
			if (spot) child.position.set(spot.x, spot.y + 0.25, spot.z);
			const w = slot ? slot.w : 1;
			child.intensity = LOOK.lightIntensity * w * (1 + Math.sin(time * 9 + child.position.x * 3.7) * 0.18 + Math.sin(time * 23 + child.position.z * 5.1) * 0.1);
		} else if (child.name === 'dk-ceiling') child.visible = !!view.playing;
		else if ((child.name === 'dk-flames' || child.name === 'dk-flame-cores') && child.userData.spots) {
			// each flame from its OWN base pose every frame (never accumulated)
			const m = child.userData._m ??= child.matrix.clone();
			child.userData.spots.forEach((/** @type {any} */ p, /** @type {number} */ i) => {
				const k = flameFlicker(time, p.x, p.z);
				// grows from its BASE (the model flame's origin): no vertical bob needed
				const sc = p.sc ?? 1;
				m.makeScale(sc / Math.sqrt(k), sc * k, sc / Math.sqrt(k)).setPosition(p.x, p.by ?? p.y, p.z);
				child.setMatrixAt(i, m);
			});
			child.instanceMatrix.needsUpdate = true;
		} else if ((child.name === 'dk-halos' || child.name === 'dk-pools') && child.userData.flicker && child.instanceColor) {
			// the halo breathes with ITS flame (the same deterministic flicker, a little softer)
			const { spots, opacity } = child.userData.flicker;
			const c = child.userData._c ??= child.material.color.clone().set(dk?.theme?.torchColor ?? 0xff8c3a);
			const arr = child.instanceColor.array;
			spots.forEach((/** @type {any} */ p, /** @type {number} */ i) => {
				const k = opacity * (0.55 + 0.45 * flameFlicker(time, p.x, p.z));
				arr[i * 3] = c.r * k;
				arr[i * 3 + 1] = c.g * k;
				arr[i * 3 + 2] = c.b * k;
			});
			child.instanceColor.needsUpdate = true;
		}
	});
}
