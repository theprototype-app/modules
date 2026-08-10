// Dungeon generator — moved out of core in 17-A and rewritten as a
// SELF-CONTAINED user module: the generator pipeline and the two room helpers
// are inlined here, THREE arrives as api.THREE, and the Svelte control panel
// became plain DOM (user modules cannot ship .svelte components).
//
// Only {seed, params} replicates — every peer regenerates the identical dungeon
// locally (determinism IS the netcode). The meshes live in a module-owned group
// at the SCENE root, never in objectsGroup: the dungeon regenerates wholesale
// and must not enter the object list or GLTF sync.
//
// THE CONTRACT WITH CORE: the group's userData.play publishes the raster, and
// the app's own dungeonPlay.js consumes it for play-mode collision, spawn points
// and the minimap. Keep {grid, width, height, minX, minY, cell, floorValue,
// rooms} stable — core reads it, and any module may publish it.

// ---------------------------------------------------------------------------
// generator (inlined from the core module's generator.js)
// ---------------------------------------------------------------------------

const VOID = 0;
const FLOOR = 1;
const WALL = 2;

/** @param {number} seed */
function mulberry32(seed) {
	let a = seed >>> 0;
	return function () {
		a += 0x6d2b79f5;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/** @param {ReturnType<typeof mulberry32>} rand @param {number} count */
function scatterRooms(rand, count) {
	const rooms = [];
	for (let i = 0; i < count; i++) {
		const angle = 2 * Math.PI * rand();
		const radius = Math.sqrt(rand());
		const w = 4 + Math.floor(rand() * 8);
		const h = 4 + Math.floor(rand() * 8);
		const cx = Math.round(Math.cos(angle) * radius * 30);
		const cy = Math.round(Math.sin(angle) * radius * 20);
		rooms.push({ x: cx - (w >> 1), y: cy - (h >> 1), w, h });
	}
	return rooms;
}

/** Push overlapping rooms apart (1-cell gap), integer steps @param {any[]} rooms */
function separateRooms(rooms) {
	for (let iteration = 0; iteration < 100; iteration++) {
		let moved = false;
		for (let i = 0; i < rooms.length; i++) {
			for (let j = i + 1; j < rooms.length; j++) {
				const a = rooms[i];
				const b = rooms[j];
				const overlapX = Math.min(a.x + a.w + 1, b.x + b.w + 1) - Math.max(a.x - 1, b.x - 1);
				const overlapY = Math.min(a.y + a.h + 1, b.y + b.h + 1) - Math.max(a.y - 1, b.y - 1);
				if (overlapX <= 0 || overlapY <= 0) continue;
				moved = true;
				if (overlapX < overlapY) {
					const push = Math.ceil(overlapX / 2);
					if (a.x + a.w / 2 < b.x + b.w / 2) {
						a.x -= push;
						b.x += push;
					} else {
						a.x += push;
						b.x -= push;
					}
				} else {
					const push = Math.ceil(overlapY / 2);
					if (a.y + a.h / 2 < b.y + b.h / 2) {
						a.y -= push;
						b.y += push;
					} else {
						a.y += push;
						b.y -= push;
					}
				}
			}
		}
		if (!moved) break;
	}
	return rooms;
}

/**
 * Bowyer-Watson Delaunay triangulation.
 * @param {{x: number, y: number}[]} points
 * @returns {[number, number][]} unique edges as point-index pairs
 */
function delaunayEdges(points) {
	if (points.length < 2) return [];
	if (points.length === 2) return [[0, 1]];

	// super-triangle enclosing everything
	let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
	points.forEach((p) => {
		minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
		maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
	});
	const span = Math.max(maxX - minX, maxY - minY, 1) * 10;
	const midX = (minX + maxX) / 2;
	const midY = (minY + maxY) / 2;
	const verts = [
		...points,
		{ x: midX - span, y: midY - span },
		{ x: midX + span, y: midY - span },
		{ x: midX, y: midY + span }
	];
	const superA = points.length, superB = points.length + 1, superC = points.length + 2;

	/** circumcircle test @param {number[]} tri @param {{x,y}} p */
	const inCircumcircle = (tri, p) => {
		const a = verts[tri[0]], b = verts[tri[1]], c = verts[tri[2]];
		const ax = a.x - p.x, ay = a.y - p.y;
		const bx = b.x - p.x, by = b.y - p.y;
		const cx = c.x - p.x, cy = c.y - p.y;
		const det =
			(ax * ax + ay * ay) * (bx * cy - cx * by) -
			(bx * bx + by * by) * (ax * cy - cx * ay) +
			(cx * cx + cy * cy) * (ax * by - bx * ay);
		// orientation-aware: normalize by triangle winding
		const area = (b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y);
		return area > 0 ? det > 0 : det < 0;
	};

	let triangles = [[superA, superB, superC]];
	for (let pi = 0; pi < points.length; pi++) {
		const bad = triangles.filter((t) => inCircumcircle(t, points[pi]));
		const edgeCount = new Map();
		bad.forEach((t) => {
			[[t[0], t[1]], [t[1], t[2]], [t[2], t[0]]].forEach(([u, v]) => {
				const key = u < v ? u + ':' + v : v + ':' + u;
				edgeCount.set(key, (edgeCount.get(key) ?? 0) + 1);
			});
		});
		triangles = triangles.filter((t) => !bad.includes(t));
		edgeCount.forEach((count, key) => {
			if (count !== 1) return; // shared edges disappear
			const [u, v] = key.split(':').map(Number);
			triangles.push([u, v, pi]);
		});
	}

	const edges = new Set();
	triangles.forEach((t) => {
		[[t[0], t[1]], [t[1], t[2]], [t[2], t[0]]].forEach(([u, v]) => {
			if (u >= points.length || v >= points.length) return; // super-triangle
			edges.add(u < v ? u + ':' + v : v + ':' + u);
		});
	});
	return [...edges].sort().map((key) => key.split(':').map(Number));
}

/**
 * Prim MST over the Delaunay edges, then re-add skipped edges with loopChance.
 * @param {{x,y}[]} centers @param {[number, number][]} edges @param {ReturnType<typeof mulberry32>} rand @param {number} loopChance
 */
function chooseCorridors(centers, edges, rand, loopChance) {
	const dist2 = ([u, v]) =>
		(centers[u].x - centers[v].x) ** 2 + (centers[u].y - centers[v].y) ** 2;
	const inTree = new Set([0]);
	const chosen = [];
	const remaining = [...edges];
	while (inTree.size < centers.length && remaining.length > 0) {
		let best = -1;
		let bestD = Infinity;
		for (let i = 0; i < remaining.length; i++) {
			const [u, v] = remaining[i];
			if (inTree.has(u) === inTree.has(v)) continue;
			const d = dist2(remaining[i]);
			if (d < bestD) {
				bestD = d;
				best = i;
			}
		}
		if (best < 0) break; // disconnected (shouldn't happen with delaunay)
		const edge = remaining.splice(best, 1)[0];
		chosen.push(edge);
		inTree.add(edge[0]);
		inTree.add(edge[1]);
	}
	let loops = 0;
	remaining.forEach((edge) => {
		if (rand() < loopChance) {
			chosen.push(edge);
			loops++;
		}
	});
	return { chosen, loops };
}

/**
 * Generate the full dungeon.
 * @param {number} seed @param {{roomCount?: number, loopChance?: number}} params
 */
function generateDungeon(seed, params = {}) {
	const started = performance.now();
	const roomCount = Math.min(Math.max(params.roomCount ?? 24, 4), 80);
	const loopChance = Math.min(Math.max(params.loopChance ?? 0.15, 0), 1);
	const rand = mulberry32(seed);

	const rooms = separateRooms(scatterRooms(rand, roomCount));
	const centers = rooms.map((r) => ({ x: r.x + (r.w >> 1), y: r.y + (r.h >> 1) }));
	const { chosen, loops } = chooseCorridors(centers, delaunayEdges(centers), rand, loopChance);

	// bounds incl. corridor + wall margin
	let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
	rooms.forEach((r) => {
		minX = Math.min(minX, r.x); minY = Math.min(minY, r.y);
		maxX = Math.max(maxX, r.x + r.w); maxY = Math.max(maxY, r.y + r.h);
	});
	minX -= 2; minY -= 2; maxX += 2; maxY += 2;
	const width = maxX - minX + 1;
	const height = maxY - minY + 1;
	const grid = new Uint8Array(width * height);
	const carve = (x, y) => {
		if (x < minX || y < minY || x > maxX || y > maxY) return;
		grid[(y - minY) * width + (x - minX)] = FLOOR;
	};

	rooms.forEach((r) => {
		for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) carve(x, y);
	});
	// L corridors (2 wide), horizontal leg first — fixed order keeps peers identical
	chosen.forEach(([u, v]) => {
		const a = centers[u], b = centers[v];
		const stepX = a.x < b.x ? 1 : -1;
		for (let x = a.x; x !== b.x + stepX; x += stepX) { carve(x, a.y); carve(x, a.y + 1); }
		const stepY = a.y < b.y ? 1 : -1;
		for (let y = a.y; y !== b.y + stepY; y += stepY) { carve(b.x, y); carve(b.x + 1, y); }
	});
	// walls: VOID cells touching FLOOR (8-neighborhood)
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			if (grid[y * width + x] !== VOID) continue;
			let nearFloor = false;
			for (let dy = -1; dy <= 1 && !nearFloor; dy++)
				for (let dx = -1; dx <= 1 && !nearFloor; dx++) {
					const nx = x + dx, ny = y + dy;
					if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
					if (grid[ny * width + nx] === FLOOR) nearFloor = true;
				}
			if (nearFloor) grid[y * width + x] = WALL;
		}
	}

	return {
		grid, width, height, minX, minY,
		rooms, edges: chosen, loops,
		ms: performance.now() - started
	};
}

/** djb2 over the raster — equal checksums = identical dungeons @param {Uint8Array} grid */
function gridChecksum(grid) {
	let hash = 5381;
	for (let i = 0; i < grid.length; i++) hash = ((hash * 33) ^ grid[i]) >>> 0;
	return hash;
}

// --- room helpers (inlined from the app's dungeonPlay.js) ------------------
function roomCenter(room) {
	return { x: room.x + room.w / 2, z: room.y + room.h / 2 };
}
function farthestRoom(rooms) {
	if (!rooms?.length) return null;
	const start = roomCenter(rooms[0]);
	let best = rooms[0];
	let bestDist = -1;
	for (const room of rooms) {
		const c = roomCenter(room);
		const d = (c.x - start.x) ** 2 + (c.z - start.z) ** 2;
		if (d > bestDist) {
			bestDist = d;
			best = room;
		}
	}
	return best;
}

// --- control panel (plain DOM; the core version was a .svelte component) ----
/** @type {any} */ let panelEl = null;
/** @type {any} */ let statsEl = null;
let panelStats = null;

function setPanelStats(stats) {
	panelStats = stats;
	if (!statsEl) return;
	statsEl.textContent = stats
		? stats.rooms + ' rooms, ' + stats.loops + ' loops, ' + stats.ms + ' ms — checksum ' + stats.checksum
		: '';
}

function closePanel() {
	panelEl?.remove();
	panelEl = null;
	statsEl = null;
}

function openPanel() {
	if (panelEl || typeof document === 'undefined') return;
	const el = document.createElement('div');
	el.id = 'dungeon-panel';
	el.style.cssText =
		'position:fixed;right:0.5rem;top:5rem;z-index:40;display:flex;width:18rem;flex-direction:column;' +
		'gap:0.5rem;border-radius:0.5rem;background:#1f2937;padding:0.75rem;font-size:0.875rem;color:#fff;' +
		'box-shadow:0 10px 25px rgba(0,0,0,0.4);';
	el.innerHTML =
		'<div style="display:flex;align-items:center;justify-content:space-between">' +
		'<span style="font-weight:600">Dungeon generator</span>' +
		'<button id="dungeon-close" style="border-radius:2px;background:#4b5563;padding:0 0.5rem">✕</button></div>' +
		'<label style="display:flex;align-items:center;gap:0.5rem">Seed' +
		'<input id="dungeon-seed" type="number" value="1337" style="width:7rem;border-radius:2px;background:#374151;padding:0.125rem 0.5rem;color:#fff" />' +
		'<button id="dungeon-dice" title="Random seed" style="border-radius:2px;background:#4b5563;padding:0 0.5rem">🎲</button></label>' +
		'<label style="display:flex;flex-direction:column"><span style="display:flex;justify-content:space-between">' +
		'<span>Rooms</span><span id="dungeon-rooms-out">24</span></span>' +
		'<input id="dungeon-rooms" type="range" min="6" max="60" step="1" value="24" /></label>' +
		'<label style="display:flex;flex-direction:column"><span style="display:flex;justify-content:space-between">' +
		'<span>Extra loops</span><span id="dungeon-loops-out">0.15</span></span>' +
		'<input id="dungeon-loops" type="range" min="0" max="0.5" step="0.05" value="0.15" /></label>' +
		'<div style="display:flex;gap:0.5rem">' +
		'<button id="dungeon-generate" style="flex:1;border-radius:2px;background:#ff4000;padding:0.25rem 0.5rem">Generate</button>' +
		'<button id="dungeon-clear" style="border-radius:2px;background:#4b5563;padding:0.25rem 0.5rem">Clear</button></div>' +
		'<p id="dungeon-stats" style="font-size:0.75rem;color:#d1d5db"></p>' +
		'<p style="font-size:0.75rem;color:#9ca3af">Peers regenerate from the seed — the same checksum means the exact same dungeon.</p>';
	document.body.appendChild(el);
	panelEl = el;
	statsEl = el.querySelector('#dungeon-stats');

	const seedInput = el.querySelector('#dungeon-seed');
	const roomsInput = el.querySelector('#dungeon-rooms');
	const loopsInput = el.querySelector('#dungeon-loops');
	el.querySelector('#dungeon-close').onclick = () => closePanel();
	el.querySelector('#dungeon-dice').onclick = () => {
		// the seed CHOICE is local; the seed itself replicates
		seedInput.value = String(Math.floor(Math.random() * 1000000));
	};
	roomsInput.oninput = () => (el.querySelector('#dungeon-rooms-out').textContent = roomsInput.value);
	loopsInput.oninput = () => (el.querySelector('#dungeon-loops-out').textContent = loopsInput.value);
	el.querySelector('#dungeon-generate').onclick = () =>
		generateAndBroadcast(+seedInput.value >>> 0, {
			roomCount: +roomsInput.value,
			loopChance: +loopsInput.value
		});
	el.querySelector('#dungeon-clear').onclick = () => clearAndBroadcast();
	setPanelStats(panelStats);
}

// ---------------------------------------------------------------------------
// module
// ---------------------------------------------------------------------------

// Dungeon generator: only {seed, params} replicates — every peer regenerates
// the identical dungeon locally (determinism is the netcode). The meshes live
// in a module-owned group at the SCENE root, not in objectsGroup: the dungeon
// regenerates wholesale and must never enter the object list / GLTF sync.
// Playable layer (58): the group's userData.play publishes the raster for
// collision/spawns/minimap, and a key→door objective replicates through
// module messages ({op:'key'|'door'}) + the state sync.


/** @type {any} */ let apiRef = null;
/** @type {any} */ let THREE = null; // api.THREE
/** @type {any} */ let current = null; // {seed, params} of the built dungeon
let play = { keyHolder: null, doorOpen: false };

const GROUP_NAME = 'dungeon-module';

/** @param {{keyHolder: string | null, doorOpen: boolean}} next */
function setPlay(next) {
	play = next;
		const scene = apiRef?.scene();
	const group = scene?.getObjectByName(GROUP_NAME);
	const key = group?.getObjectByName('dungeon-key');
	if (key) key.visible = !next.keyHolder;
	const bar = group?.getObjectByName('dungeon-door-bar');
	if (bar) bar.visible = !next.doorOpen;
}

function clearGroup() {
	const scene = apiRef?.scene();
	const group = scene?.getObjectByName(GROUP_NAME);
	if (!group) return;
	group.traverse((child) => {
		child.geometry?.dispose?.();
		if (child.material && !Array.isArray(child.material)) child.material.dispose?.();
	});
	scene.remove(group);
}

/** Build (or rebuild) the dungeon locally @param {number} seed @param {any} params */
function build(seed, params) {
	const scene = apiRef?.scene();
	if (!scene) return;
	clearGroup();
	const result = generateDungeon(seed, params);
	const { grid, width, height, minX, minY } = result;

	const group = new THREE.Group();
	group.name = GROUP_NAME;

	let floors = 0;
	let walls = 0;
	for (let i = 0; i < grid.length; i++) {
		if (grid[i] === FLOOR) floors++;
		else if (grid[i] === WALL) walls++;
	}
	const floorMesh = new THREE.InstancedMesh(
		new THREE.BoxGeometry(1, 0.2, 1),
		new THREE.MeshStandardMaterial({ color: 0x8a7f70 }),
		floors
	);
	const wallMesh = new THREE.InstancedMesh(
		new THREE.BoxGeometry(1, 2.4, 1),
		new THREE.MeshStandardMaterial({ color: 0x4a4550 }),
		walls
	);
	const matrix = new THREE.Matrix4();
	let floorIndex = 0;
	let wallIndex = 0;
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const cell = grid[y * width + x];
			if (cell === FLOOR) {
				matrix.setPosition(minX + x + 0.5, -0.1, minY + y + 0.5);
				floorMesh.setMatrixAt(floorIndex++, matrix);
			} else if (cell === WALL) {
				matrix.setPosition(minX + x + 0.5, 1.2, minY + y + 0.5);
				wallMesh.setMatrixAt(wallIndex++, matrix);
			}
		}
	}
	group.add(floorMesh, wallMesh);

	// a few torches in random rooms (own rand stream, still seed-deterministic)
	const torchRand = mulberry32(seed ^ 0xbeef);
	const torchRooms = [...result.rooms].slice(0, 64);
	for (let i = 0; i < Math.min(8, torchRooms.length); i++) {
		const room = torchRooms[Math.floor(torchRand() * torchRooms.length)];
		const light = new THREE.PointLight(0xffaa55, 6, 14);
		light.position.set(room.x + (room.w >> 1) + 0.5, 1.8, room.y + (room.h >> 1) + 0.5);
		group.add(light);
	}

	// objective props (58.4): the key waits in the farthest room, the exit
	// door frame stands in the FIRST room — both seed-deterministic
	const keyRoom = farthestRoom(result.rooms);
	if (keyRoom) {
		const c = roomCenter(keyRoom);
		const key = new THREE.Mesh(
			new THREE.OctahedronGeometry(0.22, 0),
			new THREE.MeshStandardMaterial({ color: 0xffc93d, emissive: 0x8a6a00, emissiveIntensity: 0.8 })
		);
		key.name = 'dungeon-key';
		key.position.set(c.x, 0.9, c.z);
		group.add(key);
	}
	if (result.rooms.length) {
		const c = roomCenter(result.rooms[0]);
		const door = new THREE.Group();
		door.name = 'dungeon-door';
		door.position.set(c.x, 0, c.z);
		const frameMat = new THREE.MeshStandardMaterial({ color: 0x2d3340 });
		const left = new THREE.Mesh(new THREE.BoxGeometry(0.2, 2.2, 0.2), frameMat);
		left.position.set(-0.7, 1.1, 0);
		const right = left.clone();
		right.position.x = 0.7;
		const top = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.2, 0.2), frameMat);
		top.position.set(0, 2.2, 0);
		const bar = new THREE.Mesh(
			new THREE.BoxGeometry(1.2, 2, 0.08),
			new THREE.MeshStandardMaterial({
				color: 0x39d0ff,
				emissive: 0x1a6f8f,
				emissiveIntensity: 0.9,
				transparent: true,
				opacity: 0.55
			})
		);
		bar.name = 'dungeon-door-bar';
		bar.position.set(0, 1.1, 0);
		door.add(left, right, top, bar);
		group.add(door);
	}

	const stats = {
		rooms: result.rooms.length,
		loops: result.loops,
		ms: Math.round(result.ms * 10) / 10,
		checksum: gridChecksum(grid),
		floors,
		walls
	};
	group.userData = {
		seed,
		params,
		...stats,
		// the play contract (58): collision/spawn/minimap raster for dungeonPlay.js
		play: { grid, width, height, minX, minY, rooms: result.rooms, floorValue: FLOOR }
	};
	scene.add(group);
	current = { seed, params };
	setPlay({ keyHolder: null, doorOpen: false });
	setPanelStats(stats);
}

function clear() {
	clearGroup();
	current = null;
	setPlay({ keyHolder: null, doorOpen: false });
	setPanelStats(null);
}

/** Local pickup/open attempt (click handler + tests) @param {string} what */
function tryObjective(what) {
	if (!apiRef || !current) return false;
	const me = apiRef.peerId() ?? 'me';
	if (what === 'key' && !play.keyHolder) {
		setPlay({ ...play, keyHolder: me });
		apiRef.send({ op: 'key', holder: me });
		apiRef.toast('You picked up the key — find the glowing door!');
		return true;
	}
	if (what === 'door' && !play.doorOpen) {
		if (play.keyHolder !== me) {
			apiRef.toast(play.keyHolder ? 'The key holder must open the door' : 'The door needs a key');
			return false;
		}
		setPlay({ ...play, doorOpen: true });
		apiRef.send({ op: 'door' });
		apiRef.toast('The door opens — dungeon escaped! 🎉');
		return true;
	}
	return false;
}

/** Panel action: generate locally and tell every peer @param {number} seed @param {any} params */
function generateAndBroadcast(seed, params) {
	build(seed, params);
	apiRef?.send({ op: 'generate', seed: seed, params: params });
}

function clearAndBroadcast() {
	clear();
	apiRef?.send({ op: 'clear' });
}

export default {
	id: 'dungeon',
	name: 'Dungeon Generator',
	version: '1.1.0',
	description: 'Seed-replicated procedural dungeon (rooms, corridors, torches) with a key-and-door objective; publishes userData.play so the app walks it in play mode.',
	/** @param {any} api */
	register(api) {
		apiRef = api;
		THREE = api.THREE;

		api.registerSystemGroup(GROUP_NAME); // visible under the System filter
		api.registerInteractiveGroup(GROUP_NAME); // key/door are clickable (58.4)

		api.registerMenu('Dungeon generator', () => {
			openPanel();
		});

		// desktop click + VR trigger on the key/door (58.4)
		api.registerClickHandler((/** @type {any} */ mesh) => {
			if (mesh?.name === 'dungeon-key') return tryObjective('key');
			if (mesh?.name === 'dungeon-door-bar' || mesh?.parent?.name === 'dungeon-door') return tryObjective('door');
			return false;
		});

		api.onMessage((/** @type {any} */ data) => {
			if (data.op === 'generate') build(data.seed, data.params);
			else if (data.op === 'clear') clear();
			else if (data.op === 'key') {
				setPlay({ ...play, keyHolder: data.holder });
				apiRef.toast('The key was picked up!');
			} else if (data.op === 'door') {
				setPlay({ ...play, doorOpen: true });
				apiRef.toast('The door opens — dungeon escaped! 🎉');
			}
		});

		api.onSceneClear(() => clear());

		// late joiners rebuild from the current seed + objective state
		api.registerStateSync({
			getState: () => (current ? { ...current, play } : null),
			applyState: (/** @type {any} */ state) => {
				if (state?.seed != null) {
					build(state.seed, state.params);
					if (state.play) setPlay(state.play);
				}
			}
		});
	}
};
