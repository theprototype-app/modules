// Stages 2–9 — one floor, pure data. Zero THREE/DOM imports (node-runnable),
// full determinism from one integer seed (forked per stage), 100% flood-fill
// connectivity with internal re-roll (max 5), ≤50ms per 60-room floor.
// Contract (spec §DATA CONTRACT): Dungeon {floorIndex, theme, name, W, H,
// grid, bfs, rooms[], edges[], doorways[], corridorCells[], props[], spawns[],
// portals[], stats}.

import { makeRng, hash32, checksum32 } from './rng.js';
import { dungeonName } from './names.js';

export const VOID = 0;
export const FLOOR = 1;
export const WALL = 2;

export const DEFAULT_PARAMS = {
	roomCount: 34,
	loopChance: 0.15,
	decorDensity: 0.6,
	monsterDensity: 1.0,
	gemDensity: 1.0
};

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

// ---- stage 2: room scatter --------------------------------------------------

/** @param {import('./types').Rng} rng @param {number} roomCount */
function scatterRooms(rng, roomCount) {
	const candidates = Math.ceil(roomCount * 1.4);
	// radius ∝ √roomCount keeps density constant; y squashed for irregularity
	const rx = 2.4 * Math.sqrt(roomCount) + 4;
	const ry = rx * 0.72;
	const rooms = [];
	for (let i = 0; i < candidates; i++) {
		// unit-disc REJECTION sample — no sin/cos (engines disagree on their ulps)
		let ux = 0, uy = 0;
		do {
			ux = rng.float(-1, 1);
			uy = rng.float(-1, 1);
		} while (ux * ux + uy * uy > 1);
		const roll = rng.next();
		const archetype = roll < 0.45 ? 'small' : roll < 0.85 ? 'medium' : 'large';
		const [lo, hi] = archetype === 'small' ? [5, 7] : archetype === 'medium' ? [8, 12] : [13, 18];
		const shapeRoll = rng.next();
		const shape = shapeRoll < 0.6 ? 'rect' : shapeRoll < 0.82 ? 'ellipse' : 'octagon';
		rooms.push({
			id: i,
			archetype,
			shape,
			w: rng.int(lo, hi),
			h: rng.int(lo, hi),
			fx: ux * rx, // float centers until separation snaps them
			fy: uy * ry
		});
	}
	// force ≥ 2 large rooms: re-pick the LAST candidates into larges
	let larges = rooms.filter((r) => r.archetype === 'large').length;
	for (let i = rooms.length - 1; i >= 0 && larges < 2; i--) {
		if (rooms[i].archetype === 'large') continue;
		rooms[i].archetype = 'large';
		rooms[i].w = rng.int(13, 18);
		rooms[i].h = rng.int(13, 18);
		larges++;
	}
	return rooms;
}

// ---- stage 3: separation ----------------------------------------------------

/** Iterative AABB push-apart with 2-cell padding; snap; cull to roomCount. */
function separateRooms(rooms, roomCount) {
	const PAD = 2;
	for (let iteration = 0; iteration < 300; iteration++) {
		let moved = false;
		for (let i = 0; i < rooms.length; i++) {
			for (let j = i + 1; j < rooms.length; j++) {
				const a = rooms[i], b = rooms[j];
				const overlapX = (a.w + b.w) / 2 + PAD - Math.abs(a.fx - b.fx);
				const overlapY = (a.h + b.h) / 2 + PAD - Math.abs(a.fy - b.fy);
				if (overlapX <= 0 || overlapY <= 0) continue;
				moved = true;
				if (overlapX < overlapY) {
					const push = overlapX / 2 + 0.05;
					const dir = a.fx < b.fx || (a.fx === b.fx && i < j) ? -1 : 1;
					a.fx += dir * push;
					b.fx -= dir * push;
				} else {
					const push = overlapY / 2 + 0.05;
					const dir = a.fy < b.fy || (a.fy === b.fy && i < j) ? -1 : 1;
					a.fy += dir * push;
					b.fy -= dir * push;
				}
			}
		}
		if (!moved) break;
	}
	// snap centers to the integer grid, cull the smallest overflow, reindex
	rooms.forEach((r) => {
		r.x = Math.round(r.fx - r.w / 2);
		r.y = Math.round(r.fy - r.h / 2);
		delete r.fx;
		delete r.fy;
	});
	rooms.sort((a, b) => b.w * b.h - a.w * a.h || a.id - b.id);
	rooms.length = Math.min(rooms.length, roomCount);
	// stable spatial order (top-left first) so ids mean the same thing per seed
	rooms.sort((a, b) => a.y - b.y || a.x - b.x || a.id - b.id);
	rooms.forEach((r, i) => (r.id = i));
	return rooms;
}

// ---- stage 4: connectivity graph (Delaunay → MST → loops) -------------------

/** Bowyer–Watson over room centers. @returns {[number, number][]} edges */
function delaunayEdges(points) {
	if (points.length < 2) return [];
	if (points.length === 2) return [[0, 1]];
	let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
	points.forEach((p) => {
		minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
		maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
	});
	const span = Math.max(maxX - minX, maxY - minY, 1) * 3;
	const midX = (minX + maxX) / 2, midY = (minY + maxY) / 2;
	const verts = [
		...points,
		{ x: midX - span * 3, y: midY - span },
		{ x: midX + span * 3, y: midY - span },
		{ x: midX, y: midY + span * 3 }
	];
	const superA = points.length;

	const inCircumcircle = (tri, p) => {
		const a = verts[tri[0]], b = verts[tri[1]], c = verts[tri[2]];
		const ax = a.x - p.x, ay = a.y - p.y;
		const bx = b.x - p.x, by = b.y - p.y;
		const cx = c.x - p.x, cy = c.y - p.y;
		const det =
			(ax * ax + ay * ay) * (bx * cy - cx * by) -
			(bx * bx + by * by) * (ax * cy - cx * ay) +
			(cx * cx + cy * cy) * (ax * by - bx * ay);
		const area = (b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y);
		if (Math.abs(area) < 1e-9) return false; // epsilon guard: degenerate tri
		return area > 0 ? det > 1e-9 : det < -1e-9;
	};

	let triangles = [[superA, superA + 1, superA + 2]];
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
			if (count !== 1) return;
			const [u, v] = key.split(':').map(Number);
			triangles.push([u, v, pi]);
		});
	}
	const edges = new Set();
	triangles.forEach((t) => {
		[[t[0], t[1]], [t[1], t[2]], [t[2], t[0]]].forEach(([u, v]) => {
			if (u >= points.length || v >= points.length) return;
			edges.add(u < v ? u + ':' + v : v + ':' + u);
		});
	});
	const list = [...edges].sort().map((key) => /** @type {[number, number]} */ (key.split(':').map(Number)));
	if (list.length === 0) {
		// degenerate collinear fallback: connect as a path in x-order
		const order = points.map((p, i) => i).sort((a, b) => points[a].x - points[b].x || points[a].y - points[b].y);
		for (let i = 1; i < order.length; i++) list.push([Math.min(order[i - 1], order[i]), Math.max(order[i - 1], order[i])]);
	}
	return list;
}

/** Prim MST + loop re-adds. @returns {{edges: {a,b,isLoop,isCritical}[], loops: number}} */
function buildGraph(centers, delaunay, rng, loopChance) {
	const length = ([u, v]) => Math.hypot(centers[u].x - centers[v].x, centers[u].y - centers[v].y);
	const inTree = new Set([0]);
	const mst = [];
	const remaining = [...delaunay];
	while (inTree.size < centers.length && remaining.length) {
		let best = -1, bestD = Infinity;
		for (let i = 0; i < remaining.length; i++) {
			const [u, v] = remaining[i];
			if (inTree.has(u) === inTree.has(v)) continue;
			const d = length(remaining[i]);
			if (d < bestD) { bestD = d; best = i; }
		}
		if (best < 0) break;
		const edge = remaining.splice(best, 1)[0];
		mst.push(edge);
		inTree.add(edge[0]);
		inTree.add(edge[1]);
	}
	const meanMst = mst.reduce((s, e) => s + length(e), 0) / Math.max(1, mst.length);
	const edges = mst.map(([a, b]) => ({ a, b, isLoop: false, isCritical: false }));
	let loops = 0;
	const rejected = [];
	remaining.forEach((edge) => {
		if (length(edge) > 2.2 * meanMst) return; // too long even for a loop
		if (rng.chance(loopChance)) {
			edges.push({ a: edge[0], b: edge[1], isLoop: true, isCritical: false });
			loops++;
		} else rejected.push(edge);
	});
	if (loops === 0 && rejected.length) {
		// loops are mandatory ARPG flow: force-add the shortest rejected edge
		rejected.sort((e1, e2) => length(e1) - length(e2));
		edges.push({ a: rejected[0][0], b: rejected[0][1], isLoop: true, isCritical: false });
		loops = 1;
	}
	return { edges, loops };
}

// ---- stage 5: semantics BEFORE carving --------------------------------------

/** BFS hop distances over the room graph. @returns {Int32Array} */
function graphDistances(roomCount, edges, from) {
	const adjacency = Array.from({ length: roomCount }, () => []);
	edges.forEach((e) => {
		adjacency[e.a].push(e.b);
		adjacency[e.b].push(e.a);
	});
	const dist = new Int32Array(roomCount).fill(-1);
	dist[from] = 0;
	const queue = [from];
	for (let qi = 0; qi < queue.length; qi++) {
		const u = queue[qi];
		for (const v of adjacency[u]) if (dist[v] < 0) { dist[v] = dist[u] + 1; queue.push(v); }
	}
	return dist;
}

function assignSemantics(rooms, edges, rng) {
	const degree = new Int32Array(rooms.length);
	edges.forEach((e) => { degree[e.a]++; degree[e.b]++; });
	rooms.forEach((r, i) => (r.degree = degree[i]));

	// boss = largest area (tie: lowest id)
	let boss = 0;
	rooms.forEach((r, i) => { if (r.w * r.h > rooms[boss].w * rooms[boss].h) boss = i; });

	// entrance = degree-1 room maximizing graph distance from boss;
	// fallback: minimum-degree room at max distance
	const fromBoss = graphDistances(rooms.length, edges, boss);
	let entrance = -1;
	for (let i = 0; i < rooms.length; i++) {
		if (i === boss || degree[i] !== 1) continue;
		if (entrance < 0 || fromBoss[i] > fromBoss[entrance]) entrance = i;
	}
	let entranceFallback = false;
	if (entrance < 0) {
		// fallback: minimum-degree room at maximum distance from the boss
		entranceFallback = true;
		for (let i = 0; i < rooms.length; i++) {
			if (i === boss) continue;
			if (
				entrance < 0 ||
				degree[i] < degree[entrance] ||
				(degree[i] === degree[entrance] && fromBoss[i] > fromBoss[entrance])
			)
				entrance = i;
		}
	}

	// depth = hops from entrance; critical path = parent chain entrance→boss
	const fromEntrance = graphDistances(rooms.length, edges, entrance);
	const maxDepth = Math.max(1, ...rooms.map((r, i) => fromEntrance[i]));
	rooms.forEach((r, i) => {
		r.depth = Math.max(0, fromEntrance[i]);
		r.difficulty = Math.min(1, 0.15 + 0.85 * (r.depth / maxDepth));
	});

	// walk boss→entrance along strictly-decreasing entrance-distance
	const adjacency = Array.from({ length: rooms.length }, () => []);
	edges.forEach((e, ei) => {
		adjacency[e.a].push({ to: e.b, edge: ei });
		adjacency[e.b].push({ to: e.a, edge: ei });
	});
	const critical = new Set([boss]);
	let cursor = boss;
	let guard = rooms.length + 2;
	while (cursor !== entrance && guard-- > 0) {
		let step = null;
		for (const { to, edge } of adjacency[cursor]) {
			if (fromEntrance[to] === fromEntrance[cursor] - 1 && (step === null || to < step.to)) step = { to, edge };
		}
		if (!step) break;
		edges[step.edge].isCritical = true;
		critical.add(step.to);
		cursor = step.to;
	}

	// room types
	rooms.forEach((r) => (r.type = 'combat'));
	rooms[boss].type = 'boss';
	rooms[entrance].type = 'entrance';

	// leaves → treasure (cap 4, farthest-first)
	const leaves = rooms
		.map((r, i) => i)
		.filter((i) => i !== boss && i !== entrance && degree[i] === 1)
		.sort((a, b) => fromEntrance[b] - fromEntrance[a] || a - b);
	leaves.slice(0, 4).forEach((i) => (rooms[i].type = 'treasure'));

	// 1–2 shrines mid-depth (40–70%) OFF the critical path
	const shrineCandidates = rooms
		.map((r, i) => i)
		.filter((i) => rooms[i].type === 'combat' && !critical.has(i) &&
			fromEntrance[i] >= 0.4 * maxDepth && fromEntrance[i] <= 0.7 * maxDepth);
	const shrineCount = Math.min(shrineCandidates.length, rng.int(1, 2));
	for (let k = 0; k < shrineCount; k++) {
		const pickIndex = rng.int(0, shrineCandidates.length - 1);
		rooms[shrineCandidates[pickIndex]].type = 'shrine';
		shrineCandidates.splice(pickIndex, 1);
	}

	// 1–2 elite arenas ON the critical path at 55–85% depth, medium+ rooms
	const eliteCandidates = rooms
		.map((r, i) => i)
		.filter((i) => rooms[i].type === 'combat' && critical.has(i) && rooms[i].archetype !== 'small' &&
			fromEntrance[i] >= 0.55 * maxDepth && fromEntrance[i] <= 0.85 * maxDepth);
	const eliteCount = Math.min(eliteCandidates.length, rng.int(1, 2));
	for (let k = 0; k < eliteCount; k++) {
		const pickIndex = rng.int(0, eliteCandidates.length - 1);
		rooms[eliteCandidates[pickIndex]].type = 'elite';
		eliteCandidates.splice(pickIndex, 1);
	}

	rooms[boss].difficulty = 1.0;
	return { boss, entrance, entranceFallback, maxDepth, criticalRooms: critical };
}

// ---- stages 6+7: carve + rasterize + fields ---------------------------------

/** Is (x,y) inside the room's SHAPE? Cell-center test, integer-safe. */
function inRoomShape(room, x, y) {
	if (x < room.x || y < room.y || x >= room.x + room.w || y >= room.y + room.h) return false;
	if (room.shape === 'rect') return true;
	const dx = x + 0.5 - (room.x + room.w / 2);
	const dy = y + 0.5 - (room.y + room.h / 2);
	if (room.shape === 'ellipse') {
		const nx = dx / (room.w / 2);
		const ny = dy / (room.h / 2);
		return nx * nx + ny * ny <= 1;
	}
	// chamfered octagon: cut the four corners
	const chamfer = Math.max(1, Math.floor(Math.min(room.w, room.h) / 3.5));
	const ex = Math.min(x - room.x, room.x + room.w - 1 - x);
	const ey = Math.min(y - room.y, room.y + room.h - 1 - y);
	return ex + ey >= chamfer;
}

function rasterize(rooms, edges, semantics, rng) {
	// bounds + 2-cell margin (corridors run center-to-center, inside room bounds)
	let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
	rooms.forEach((r) => {
		minX = Math.min(minX, r.x); minY = Math.min(minY, r.y);
		maxX = Math.max(maxX, r.x + r.w); maxY = Math.max(maxY, r.y + r.h);
	});
	const MARGIN = 3;
	const shiftX = MARGIN - minX;
	const shiftY = MARGIN - minY;
	rooms.forEach((r) => { r.x += shiftX; r.y += shiftY; });
	const W = maxX - minX + MARGIN * 2;
	const H = maxY - minY + MARGIN * 2;
	const grid = new Uint8Array(W * H);
	const roomOf = new Int16Array(W * H).fill(-1);

	rooms.forEach((r) => {
		r.cx = r.x + (r.w >> 1);
		r.cy = r.y + (r.h >> 1);
		for (let y = r.y; y < r.y + r.h; y++)
			for (let x = r.x; x < r.x + r.w; x++)
				if (inRoomShape(r, x, y)) {
					grid[y * W + x] = FLOOR;
					roomOf[y * W + x] = r.id;
				}
	});

	// stage 6 — corridor carve: width 3 critical / 2 default / 1 treasure spur
	const corridorCells = [];
	const stampCorridor = (x, y, width, horizontal) => {
		for (let o = 0; o < width; o++) {
			const off = o - (width >> 1);
			const cx2 = horizontal ? x : x + off;
			const cy2 = horizontal ? y + off : y;
			if (cx2 < 0 || cy2 < 0 || cx2 >= W || cy2 >= H) continue;
			const i = cy2 * W + cx2;
			if (grid[i] !== FLOOR) {
				grid[i] = FLOOR;
				corridorCells.push({ x: cx2, y: cy2 });
			}
		}
	};
	edges.forEach((edge) => {
		const a = rooms[edge.a], b = rooms[edge.b];
		const spur = a.type === 'treasure' || b.type === 'treasure';
		const width = edge.isCritical ? 3 : spur ? 1 : 2;
		// straight run when the spans overlap ≥ 3 cells
		const overlapX0 = Math.max(a.x, b.x), overlapX1 = Math.min(a.x + a.w, b.x + b.w);
		const overlapY0 = Math.max(a.y, b.y), overlapY1 = Math.min(a.y + a.h, b.y + b.h);
		if (overlapX1 - overlapX0 >= 3) {
			const x = (overlapX0 + overlapX1) >> 1;
			const y0 = Math.min(a.cy, b.cy), y1 = Math.max(a.cy, b.cy);
			for (let y = y0; y <= y1; y++) stampCorridor(x, y, width, false);
		} else if (overlapY1 - overlapY0 >= 3) {
			const y = (overlapY0 + overlapY1) >> 1;
			const x0 = Math.min(a.cx, b.cx), x1 = Math.max(a.cx, b.cx);
			for (let x = x0; x <= x1; x++) stampCorridor(x, y, width, true);
		} else {
			// L-corridor, seeded elbow direction
			const horizontalFirst = rng.chance(0.5);
			const stepX = a.cx <= b.cx ? 1 : -1;
			const stepY = a.cy <= b.cy ? 1 : -1;
			if (horizontalFirst) {
				for (let x = a.cx; x !== b.cx + stepX; x += stepX) stampCorridor(x, a.cy, width, true);
				for (let y = a.cy; y !== b.cy + stepY; y += stepY) stampCorridor(b.cx, y, width, false);
			} else {
				for (let y = a.cy; y !== b.cy + stepY; y += stepY) stampCorridor(a.cx, y, width, false);
				for (let x = a.cx; x !== b.cx + stepX; x += stepX) stampCorridor(x, b.cy, width, true);
			}
		}
	});

	// stage 7 — walls: any VOID cell with an 8-neighbor FLOOR
	for (let y = 0; y < H; y++)
		for (let x = 0; x < W; x++) {
			if (grid[y * W + x] !== VOID) continue;
			let nearFloor = false;
			for (let dy = -1; dy <= 1 && !nearFloor; dy++)
				for (let dx = -1; dx <= 1 && !nearFloor; dx++) {
					const nx = x + dx, ny = y + dy;
					if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
					if (grid[ny * W + nx] === FLOOR) nearFloor = true;
				}
			if (nearFloor) grid[y * W + x] = WALL;
		}

	// doorways: corridor cells 4-adjacent to room floor
	const doorways = [];
	const corridorSet = new Set(corridorCells.map((c) => c.y * W + c.x));
	corridorCells.forEach(({ x, y }) => {
		for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
			const ni = (y + dy) * W + (x + dx);
			if (grid[ni] === FLOOR && roomOf[ni] >= 0) {
				doorways.push({ x, y });
				return;
			}
		}
	});

	// per-cell BFS distance field from the entrance center
	const entranceRoom = rooms[semantics.entrance];
	const bfs = new Int16Array(W * H).fill(-1);
	const start = entranceRoom.cy * W + entranceRoom.cx;
	bfs[start] = 0;
	const queue = new Int32Array(W * H);
	queue[0] = start;
	let head = 0, tail = 1;
	while (head < tail) {
		const i = queue[head++];
		const x = i % W, y = (i / W) | 0;
		for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
			const nx = x + dx, ny = y + dy;
			if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
			const ni = ny * W + nx;
			if (grid[ni] === FLOOR && bfs[ni] < 0) {
				bfs[ni] = bfs[i] + 1;
				queue[tail++] = ni;
			}
		}
	}

	return { W, H, grid, roomOf, corridorCells, corridorSet, doorways, bfs };
}

// ---- stage 8: decoration & spawn slots (data only) --------------------------

function decorate(rooms, raster, semantics, params, rng) {
	const { W, H, grid, roomOf, doorways, corridorSet } = raster;
	const props = [];
	const spawns = [];
	const taken = new Uint8Array(W * H);
	doorways.forEach(({ x, y }) => (taken[y * W + x] = 1));

	const doorwayNear = (x, y, radius) =>
		doorways.some((d) => Math.max(Math.abs(d.x - x), Math.abs(d.y - y)) < radius);
	const allFloor8 = (x, y) => {
		for (let dy = -1; dy <= 1; dy++)
			for (let dx = -1; dx <= 1; dx++)
				if (grid[(y + dy) * W + (x + dx)] !== FLOOR) return false;
		return true;
	};
	const place = (kind, x, y, roomId, extra = {}) => {
		taken[y * W + x] = 1;
		props.push({ kind, x, y, rot: 0, scale: 1, roomId, ...extra });
	};
	/** free FLOOR cells of a room, deterministic scan order */
	const freeCells = (room, filter) => {
		const cells = [];
		for (let y = room.y; y < room.y + room.h; y++)
			for (let x = room.x; x < room.x + room.w; x++) {
				const i = y * W + x;
				if (grid[i] !== FLOOR || roomOf[i] !== room.id || taken[i]) continue;
				if (filter && !filter(x, y)) continue;
				cells.push({ x, y });
			}
		return cells;
	};
	const wallAdjacent = (x, y) =>
		[[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => grid[(y + dy) * W + (x + dx)] === WALL);

	// pillar grids in large rooms — 3-cell lattice anchored on the room center
	rooms.forEach((room) => {
		if (room.archetype !== 'large') return;
		for (let y = room.y + 1; y < room.y + room.h - 1; y++)
			for (let x = room.x + 1; x < room.x + room.w - 1; x++) {
				if ((x - room.cx) % 3 !== 0 || (y - room.cy) % 3 !== 0) continue;
				if (x === room.cx && y === room.cy) continue; // keep centers clear (portals)
				if (!allFloor8(x, y) || taken[y * W + x] || doorwayNear(x, y, 2)) continue;
				place('pillar', x, y, room.id);
			}
	});

	// torches on floor-facing wall cells, min Chebyshev spacing 4
	const torches = [];
	for (let y = 1; y < H - 1; y++)
		for (let x = 1; x < W - 1; x++) {
			if (grid[y * W + x] !== WALL) continue;
			const facing = [[1, 0], [-1, 0], [0, 1], [0, -1]].find(([dx, dy]) => grid[(y + dy) * W + (x + dx)] === FLOOR);
			if (!facing) continue;
			if (torches.some((t) => Math.max(Math.abs(t.x - x), Math.abs(t.y - y)) < 4)) continue;
			torches.push({ x, y, fx: facing[0], fy: facing[1] });
		}
	torches.forEach((t) => props.push({ kind: 'torch', x: t.x, y: t.y, rot: 0, scale: 1, roomId: roomOf[t.y * W + t.x], fx: t.fx, fy: t.fy }));

	// debris ∝ decorDensity, weighted toward LOW-difficulty rooms
	rooms.forEach((room) => {
		const cells = freeCells(room);
		const count = Math.round(cells.length * 0.05 * params.decorDensity * (1.4 - room.difficulty));
		for (let k = 0; k < count && cells.length; k++) {
			const cell = cells.splice(rng.int(0, cells.length - 1), 1)[0];
			place('debris', cell.x, cell.y, room.id, { rot: rng.float(0, 6.283), scale: rng.float(0.5, 1.1) });
		}
	});

	// crates: 2–4 per combat room, wall-adjacent, never beside doorways
	rooms.forEach((room) => {
		if (room.type !== 'combat') return;
		const cells = freeCells(room, (x, y) => wallAdjacent(x, y) && !doorwayNear(x, y, 2));
		const count = Math.min(cells.length, Math.max(0, Math.round(rng.int(2, 4) * params.decorDensity)));
		for (let k = 0; k < count && cells.length; k++) {
			const cell = cells.splice(rng.int(0, cells.length - 1), 1)[0];
			place('crate', cell.x, cell.y, room.id);
		}
	});

	// braziers ringing the boss room; chest per treasure room; shrine crystal;
	// entrance portal ring anchor
	rooms.forEach((room) => {
		if (room.type === 'boss') {
			const ring = freeCells(room, (x, y) => {
				const edgeX = Math.min(x - room.x, room.x + room.w - 1 - x);
				const edgeY = Math.min(y - room.y, room.y + room.h - 1 - y);
				return Math.min(edgeX, edgeY) === 1 && (x + y) % 3 === 0 && !doorwayNear(x, y, 2);
			});
			ring.forEach((cell) => place('brazier', cell.x, cell.y, room.id));
		} else if (room.type === 'treasure') {
			const cells = freeCells(room, (x, y) => Math.abs(x - room.cx) <= 1 && Math.abs(y - room.cy) <= 1);
			if (cells.length) {
				const cell = cells[rng.int(0, cells.length - 1)];
				place('chest', cell.x, cell.y, room.id);
			}
		} else if (room.type === 'shrine') {
			if (grid[room.cy * W + room.cx] === FLOOR && !taken[room.cy * W + room.cx])
				place('crystal', room.cx, room.cy, room.id);
		} else if (room.type === 'entrance') {
			if (!taken[room.cy * W + room.cx]) place('ring', room.cx, room.cy, room.id);
		}
	});

	// GEMS — the collectible objective (this module's play loop): scattered over
	// non-entrance rooms, weighted toward depth; count scales with gemDensity
	const gemCount = Math.max(4, Math.min(40, Math.round(rooms.length * 0.4 * (params.gemDensity ?? 1))));
	const gemRooms = rooms.filter((r) => r.type !== 'entrance');
	const gemRng = rng.fork('gems');
	let gemsPlaced = 0;
	let attempts = gemCount * 8;
	while (gemsPlaced < gemCount && attempts-- > 0) {
		// weighted room pick: deeper rooms hold more gems
		const weights = gemRooms.map((r) => 1 + r.depth);
		const total = weights.reduce((s, w2) => s + w2, 0);
		let roll = gemRng.float(0, total);
		let room = gemRooms[gemRooms.length - 1];
		for (let i = 0; i < gemRooms.length; i++) {
			roll -= weights[i];
			if (roll <= 0) { room = gemRooms[i]; break; }
		}
		const cells = freeCells(room);
		if (!cells.length) continue;
		const cell = cells[gemRng.int(0, cells.length - 1)];
		place('gem', cell.x, cell.y, room.id, { index: gemsPlaced });
		gemsPlaced++;
	}

	// enemy spawn slots: combat/elite rooms only, never on prop/doorway cells
	const spawnRng = rng.fork('spawns');
	rooms.forEach((room) => {
		if (room.type !== 'combat' && room.type !== 'elite') return;
		const area = room.w * room.h;
		const count = Math.round((area / 18) * (0.5 + room.difficulty) * params.monsterDensity);
		const cells = freeCells(room, (x, y) => !corridorSet.has(y * W + x));
		for (let k = 0; k < count && cells.length; k++) {
			const cell = cells.splice(spawnRng.int(0, cells.length - 1), 1)[0];
			taken[cell.y * W + cell.x] = 1;
			spawns.push({ x: cell.x, y: cell.y, tier: room.type === 'elite' ? 'elite' : 'normal', roomId: room.id });
		}
	});

	return { props, spawns, taken };
}

// ---- stage 9 + validation + re-roll -----------------------------------------

/** @returns {string[]} failures (empty = valid) */
export function validateDungeon(d) {
	const failures = [];
	const { W, grid, bfs } = d;
	let floorTiles = 0, reached = 0;
	for (let i = 0; i < grid.length; i++) {
		if (grid[i] !== FLOOR) continue;
		floorTiles++;
		if (bfs[i] >= 0) reached++;
	}
	if (reached !== floorTiles) failures.push('connectivity: ' + reached + '/' + floorTiles + ' floor cells reachable');
	const boss = d.rooms.find((r) => r.type === 'boss' || r.type === 'dragon');
	const entrance = d.rooms.find((r) => r.type === 'entrance');
	if (!boss) failures.push('no boss room');
	if (!entrance) failures.push('no entrance room');
	if (entrance && entrance.degree !== 1 && !d.stats.entranceFallback) failures.push('entrance degree ' + entrance.degree);
	if (boss && entrance) {
		let maxBfs = 0;
		for (let i = 0; i < bfs.length; i++) if (bfs[i] > maxBfs) maxBfs = bfs[i];
		const bossDepth = bfs[boss.cy * W + boss.cx];
		if (bossDepth < 0.6 * maxBfs) failures.push('boss depth ' + bossDepth + ' < 60% of ' + maxBfs);
	}
	const loops = d.edges.filter((e) => e.isLoop).length;
	if (loops < 1) failures.push('no loops (cyclomatic 0)');
	const doorwaySet = new Set(d.doorways.map((c) => c.y * W + c.x));
	for (const p of d.props) {
		const i = p.y * W + p.x;
		if (grid[i] === FLOOR && doorwaySet.has(i)) failures.push('prop ' + p.kind + ' on doorway');
		else if (p.kind !== 'torch' && grid[i] !== FLOOR) failures.push('prop ' + p.kind + ' off floor');
		else if (p.kind === 'torch' && grid[i] !== WALL) failures.push('torch off wall');
	}
	for (const s of d.spawns) {
		const i = s.y * W + s.x;
		if (grid[i] !== FLOOR || doorwaySet.has(i)) failures.push('spawn off floor / on doorway');
	}
	for (const portal of d.portals ?? []) {
		const i = portal.y * W + portal.x;
		if (grid[i] !== FLOOR) failures.push('portal off floor');
		else if (bfs[i] < 0) failures.push('portal unreachable');
	}
	return failures;
}

/** FNV-1a over the raster + portals — equal checksums = identical dungeons */
export function dungeonChecksum(d) {
	let h = checksum32(d.grid);
	for (const portal of d.portals ?? []) h = checksum32(new Uint8Array([portal.x & 0xff, portal.x >> 8, portal.y & 0xff, portal.y >> 8]), h);
	return h >>> 0;
}

/**
 * Generate one floor. Deterministic from (seed, params, floorIndex); re-rolls
 * internally with a derived seed on validation failure (max 5 attempts).
 * @param {number} seed @param {object=} params @param {number=} floorIndex
 * @returns {import('./types').Dungeon}
 */
export function generateDungeon(seed, params = {}, floorIndex = 1) {
	const started = now();
	const merged = { ...DEFAULT_PARAMS, ...params };
	merged.roomCount = Math.min(Math.max(merged.roomCount, 4), 60);
	merged.loopChance = Math.min(Math.max(merged.loopChance, 0), 1);

	let failures = [];
	for (let attempt = 0; attempt < 5; attempt++) {
		const attemptSeed = attempt === 0 ? seed >>> 0 : hash32(seed, 'attempt', attempt);
		const rng = makeRng(attemptSeed);
		const rooms = separateRooms(scatterRooms(rng.fork('rooms'), merged.roomCount), merged.roomCount);
		const centers = rooms.map((r) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 }));
		const { edges, loops } = buildGraph(centers, delaunayEdges(centers), rng.fork('graph'), merged.loopChance);
		const semantics = assignSemantics(rooms, edges, rng.fork('semantics'));
		const raster = rasterize(rooms, edges, semantics, rng.fork('carve'));
		const { props, spawns } = decorate(rooms, raster, semantics, merged, rng.fork('decor'));

		let floorTiles = 0, wallTiles = 0;
		for (let i = 0; i < raster.grid.length; i++) {
			if (raster.grid[i] === FLOOR) floorTiles++;
			else if (raster.grid[i] === WALL) wallTiles++;
		}
		const criticalLength = edges.filter((e) => e.isCritical).length;
		const dungeon = {
			floorIndex,
			theme: null, // stamped by the campaign
			name: dungeonName(rng.fork('name')),
			W: raster.W,
			H: raster.H,
			grid: raster.grid,
			bfs: raster.bfs,
			rooms,
			edges,
			doorways: raster.doorways,
			corridorCells: raster.corridorCells,
			props,
			spawns,
			portals: [],
			entranceId: semantics.entrance,
			bossId: semantics.boss,
			stats: {
				floorIndex,
				seed: attemptSeed,
				rooms: rooms.length,
				edges: edges.length,
				loops,
				criticalLength,
				floorTiles,
				wallTiles,
				props: props.length,
				spawns: spawns.length,
				entranceFallback: semantics.entranceFallback,
				attempts: attempt + 1,
				genMs: 0
			}
		};
		failures = validateDungeon(dungeon);
		if (failures.length === 0) {
			dungeon.stats.genMs = now() - started;
			return dungeon;
		}
	}
	throw new Error('dungeon generation failed after 5 attempts (seed ' + seed + '): ' + failures.join('; '));
}
