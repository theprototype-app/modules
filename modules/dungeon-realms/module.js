// modules/dungeon-realms/src/gen/rng.js
function hash32(seed, ...parts) {
  let h = 2166136261 ^ seed >>> 0;
  for (const part of parts) {
    const s = String(part);
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    h ^= 2654435769;
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function makeRng(seed) {
  let a = seed >>> 0;
  const next = () => {
    a += 1831565813;
    let t = a;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
  const rng = {
    seed: seed >>> 0,
    /** uniform [0,1) */
    next,
    /** uniform [a,b) @param {number} a @param {number} b */
    float: (a2, b2) => a2 + next() * (b2 - a2),
    /** integer [a,b] inclusive @param {number} a @param {number} b */
    int: (a2, b2) => a2 + Math.floor(next() * (b2 - a2 + 1)),
    /** @template T @param {T[]} arr @returns {T} */
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    /** @param {number} p */
    chance: (p) => next() < p,
    /** independent child stream — same label, same stream, always @param {string} label */
    fork: (label) => makeRng(hash32(seed, label))
  };
  return rng;
}
function checksum32(arr, h = 2166136261) {
  for (let i = 0; i < arr.length; i++) {
    h ^= arr[i] & 255;
    h = Math.imul(h, 16777619);
    h ^= arr[i] >> 8 & 255;
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// modules/dungeon-realms/src/gen/names.js
var ADJECTIVES = [
  "Ashen",
  "Sunken",
  "Howling",
  "Gilded",
  "Mossy",
  "Broken",
  "Silent",
  "Ember",
  "Frozen",
  "Obsidian",
  "Weeping",
  "Forgotten",
  "Crimson",
  "Hollow",
  "Shattered",
  "Verdant",
  "Rusted",
  "Pale",
  "Umbral",
  "Thorned"
];
var PLACES = [
  "Vaults",
  "Halls",
  "Depths",
  "Catacombs",
  "Warrens",
  "Chambers",
  "Galleries",
  "Crypts",
  "Cisterns",
  "Foundry",
  "Reliquary",
  "Barrows",
  "Passages",
  "Sanctum",
  "Undercroft",
  "Mines",
  "Roost",
  "Maze"
];
var SYL_A = ["Vor", "Mal", "Kar", "Thu", "Gor", "Zan", "Bel", "Dra", "Ny", "Ul", "Sha", "Mor"];
var SYL_B = ["gul", "thak", "ric", "mash", "dun", "zir", "goth", "ral", "ssk", "bar", "nox", "vek"];
function dungeonName(rng) {
  const adjective = rng.pick(ADJECTIVES);
  const place = rng.pick(PLACES);
  if (rng.chance(0.6)) {
    const owner = rng.pick(SYL_A) + (rng.chance(0.5) ? "'" : "") + rng.pick(SYL_B);
    return "The " + adjective + " " + place + " of " + owner;
  }
  return "The " + adjective + " " + place;
}

// modules/dungeon-realms/src/gen/dungeon.js
var VOID = 0;
var FLOOR = 1;
var WALL = 2;
var DEFAULT_PARAMS = {
  roomCount: 34,
  loopChance: 0.15,
  decorDensity: 0.6,
  monsterDensity: 1,
  gemDensity: 1
};
var now = () => typeof performance !== "undefined" ? performance.now() : Date.now();
function scatterRooms(rng, roomCount) {
  const candidates = Math.ceil(roomCount * 1.4);
  const rx = 2.4 * Math.sqrt(roomCount) + 4;
  const ry = rx * 0.72;
  const rooms = [];
  for (let i = 0; i < candidates; i++) {
    let ux = 0, uy = 0;
    do {
      ux = rng.float(-1, 1);
      uy = rng.float(-1, 1);
    } while (ux * ux + uy * uy > 1);
    const roll = rng.next();
    const archetype = roll < 0.45 ? "small" : roll < 0.85 ? "medium" : "large";
    const [lo, hi] = archetype === "small" ? [5, 7] : archetype === "medium" ? [8, 12] : [13, 18];
    const shapeRoll = rng.next();
    const shape = shapeRoll < 0.6 ? "rect" : shapeRoll < 0.82 ? "ellipse" : "octagon";
    rooms.push({
      id: i,
      archetype,
      shape,
      w: rng.int(lo, hi),
      h: rng.int(lo, hi),
      fx: ux * rx,
      // float centers until separation snaps them
      fy: uy * ry
    });
  }
  let larges = rooms.filter((r) => r.archetype === "large").length;
  for (let i = rooms.length - 1; i >= 0 && larges < 2; i--) {
    if (rooms[i].archetype === "large") continue;
    rooms[i].archetype = "large";
    rooms[i].w = rng.int(13, 18);
    rooms[i].h = rng.int(13, 18);
    larges++;
  }
  return rooms;
}
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
          const dir = a.fx < b.fx || a.fx === b.fx && i < j ? -1 : 1;
          a.fx += dir * push;
          b.fx -= dir * push;
        } else {
          const push = overlapY / 2 + 0.05;
          const dir = a.fy < b.fy || a.fy === b.fy && i < j ? -1 : 1;
          a.fy += dir * push;
          b.fy -= dir * push;
        }
      }
    }
    if (!moved) break;
  }
  rooms.forEach((r) => {
    r.x = Math.round(r.fx - r.w / 2);
    r.y = Math.round(r.fy - r.h / 2);
    delete r.fx;
    delete r.fy;
  });
  rooms.sort((a, b) => b.w * b.h - a.w * a.h || a.id - b.id);
  rooms.length = Math.min(rooms.length, roomCount);
  rooms.sort((a, b) => a.y - b.y || a.x - b.x || a.id - b.id);
  rooms.forEach((r, i) => r.id = i);
  return rooms;
}
function delaunayEdges(points) {
  if (points.length < 2) return [];
  if (points.length === 2) return [[0, 1]];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  points.forEach((p) => {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
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
    const det = (ax * ax + ay * ay) * (bx * cy - cx * by) - (bx * bx + by * by) * (ax * cy - cx * ay) + (cx * cx + cy * cy) * (ax * by - bx * ay);
    const area = (b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y);
    if (Math.abs(area) < 1e-9) return false;
    return area > 0 ? det > 1e-9 : det < -1e-9;
  };
  let triangles = [[superA, superA + 1, superA + 2]];
  for (let pi = 0; pi < points.length; pi++) {
    const bad = triangles.filter((t) => inCircumcircle(t, points[pi]));
    const edgeCount = /* @__PURE__ */ new Map();
    bad.forEach((t) => {
      [[t[0], t[1]], [t[1], t[2]], [t[2], t[0]]].forEach(([u, v]) => {
        const key = u < v ? u + ":" + v : v + ":" + u;
        edgeCount.set(key, (edgeCount.get(key) ?? 0) + 1);
      });
    });
    triangles = triangles.filter((t) => !bad.includes(t));
    edgeCount.forEach((count, key) => {
      if (count !== 1) return;
      const [u, v] = key.split(":").map(Number);
      triangles.push([u, v, pi]);
    });
  }
  const edges = /* @__PURE__ */ new Set();
  triangles.forEach((t) => {
    [[t[0], t[1]], [t[1], t[2]], [t[2], t[0]]].forEach(([u, v]) => {
      if (u >= points.length || v >= points.length) return;
      edges.add(u < v ? u + ":" + v : v + ":" + u);
    });
  });
  const list = [...edges].sort().map((key) => (
    /** @type {[number, number]} */
    key.split(":").map(Number)
  ));
  if (list.length === 0) {
    const order = points.map((p, i) => i).sort((a, b) => points[a].x - points[b].x || points[a].y - points[b].y);
    for (let i = 1; i < order.length; i++) list.push([Math.min(order[i - 1], order[i]), Math.max(order[i - 1], order[i])]);
  }
  return list;
}
function buildGraph(centers, delaunay, rng, loopChance) {
  const length = ([u, v]) => Math.hypot(centers[u].x - centers[v].x, centers[u].y - centers[v].y);
  const inTree = /* @__PURE__ */ new Set([0]);
  const mst = [];
  const remaining = [...delaunay];
  while (inTree.size < centers.length && remaining.length) {
    let best = -1, bestD = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const [u, v] = remaining[i];
      if (inTree.has(u) === inTree.has(v)) continue;
      const d = length(remaining[i]);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
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
    if (length(edge) > 2.2 * meanMst) return;
    if (rng.chance(loopChance)) {
      edges.push({ a: edge[0], b: edge[1], isLoop: true, isCritical: false });
      loops++;
    } else rejected.push(edge);
  });
  if (loops === 0 && rejected.length) {
    rejected.sort((e1, e2) => length(e1) - length(e2));
    edges.push({ a: rejected[0][0], b: rejected[0][1], isLoop: true, isCritical: false });
    loops = 1;
  }
  return { edges, loops };
}
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
    for (const v of adjacency[u]) if (dist[v] < 0) {
      dist[v] = dist[u] + 1;
      queue.push(v);
    }
  }
  return dist;
}
function assignSemantics(rooms, edges, rng) {
  const degree = new Int32Array(rooms.length);
  edges.forEach((e) => {
    degree[e.a]++;
    degree[e.b]++;
  });
  rooms.forEach((r, i) => r.degree = degree[i]);
  let boss = 0;
  rooms.forEach((r, i) => {
    if (r.w * r.h > rooms[boss].w * rooms[boss].h) boss = i;
  });
  const fromBoss = graphDistances(rooms.length, edges, boss);
  let entrance = -1;
  for (let i = 0; i < rooms.length; i++) {
    if (i === boss || degree[i] !== 1) continue;
    if (entrance < 0 || fromBoss[i] > fromBoss[entrance]) entrance = i;
  }
  let entranceFallback = false;
  if (entrance < 0) {
    entranceFallback = true;
    for (let i = 0; i < rooms.length; i++) {
      if (i === boss) continue;
      if (entrance < 0 || degree[i] < degree[entrance] || degree[i] === degree[entrance] && fromBoss[i] > fromBoss[entrance])
        entrance = i;
    }
  }
  const fromEntrance = graphDistances(rooms.length, edges, entrance);
  const maxDepth = Math.max(1, ...rooms.map((r, i) => fromEntrance[i]));
  rooms.forEach((r, i) => {
    r.depth = Math.max(0, fromEntrance[i]);
    r.difficulty = Math.min(1, 0.15 + 0.85 * (r.depth / maxDepth));
  });
  const adjacency = Array.from({ length: rooms.length }, () => []);
  edges.forEach((e, ei) => {
    adjacency[e.a].push({ to: e.b, edge: ei });
    adjacency[e.b].push({ to: e.a, edge: ei });
  });
  const critical = /* @__PURE__ */ new Set([boss]);
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
  rooms.forEach((r) => r.type = "combat");
  rooms[boss].type = "boss";
  rooms[entrance].type = "entrance";
  const leaves = rooms.map((r, i) => i).filter((i) => i !== boss && i !== entrance && degree[i] === 1).sort((a, b) => fromEntrance[b] - fromEntrance[a] || a - b);
  leaves.slice(0, 4).forEach((i) => rooms[i].type = "treasure");
  const shrineCandidates = rooms.map((r, i) => i).filter((i) => rooms[i].type === "combat" && !critical.has(i) && fromEntrance[i] >= 0.4 * maxDepth && fromEntrance[i] <= 0.7 * maxDepth);
  const shrineCount = Math.min(shrineCandidates.length, rng.int(1, 2));
  for (let k = 0; k < shrineCount; k++) {
    const pickIndex = rng.int(0, shrineCandidates.length - 1);
    rooms[shrineCandidates[pickIndex]].type = "shrine";
    shrineCandidates.splice(pickIndex, 1);
  }
  const eliteCandidates = rooms.map((r, i) => i).filter((i) => rooms[i].type === "combat" && critical.has(i) && rooms[i].archetype !== "small" && fromEntrance[i] >= 0.55 * maxDepth && fromEntrance[i] <= 0.85 * maxDepth);
  const eliteCount = Math.min(eliteCandidates.length, rng.int(1, 2));
  for (let k = 0; k < eliteCount; k++) {
    const pickIndex = rng.int(0, eliteCandidates.length - 1);
    rooms[eliteCandidates[pickIndex]].type = "elite";
    eliteCandidates.splice(pickIndex, 1);
  }
  rooms[boss].difficulty = 1;
  return { boss, entrance, entranceFallback, maxDepth, criticalRooms: critical };
}
function inRoomShape(room, x, y) {
  if (x < room.x || y < room.y || x >= room.x + room.w || y >= room.y + room.h) return false;
  if (room.shape === "rect") return true;
  const dx = x + 0.5 - (room.x + room.w / 2);
  const dy = y + 0.5 - (room.y + room.h / 2);
  if (room.shape === "ellipse") {
    const nx = dx / (room.w / 2);
    const ny = dy / (room.h / 2);
    return nx * nx + ny * ny <= 1;
  }
  const chamfer = Math.max(1, Math.floor(Math.min(room.w, room.h) / 3.5));
  const ex = Math.min(x - room.x, room.x + room.w - 1 - x);
  const ey = Math.min(y - room.y, room.y + room.h - 1 - y);
  return ex + ey >= chamfer;
}
function rasterize(rooms, edges, semantics, rng) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  rooms.forEach((r) => {
    minX = Math.min(minX, r.x);
    minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, r.x + r.w);
    maxY = Math.max(maxY, r.y + r.h);
  });
  const MARGIN = 3;
  const shiftX = MARGIN - minX;
  const shiftY = MARGIN - minY;
  rooms.forEach((r) => {
    r.x += shiftX;
    r.y += shiftY;
  });
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
    const spur = a.type === "treasure" || b.type === "treasure";
    const width = edge.isCritical ? 3 : spur ? 1 : 2;
    const overlapX0 = Math.max(a.x, b.x), overlapX1 = Math.min(a.x + a.w, b.x + b.w);
    const overlapY0 = Math.max(a.y, b.y), overlapY1 = Math.min(a.y + a.h, b.y + b.h);
    if (overlapX1 - overlapX0 >= 3) {
      const x = overlapX0 + overlapX1 >> 1;
      const y0 = Math.min(a.cy, b.cy), y1 = Math.max(a.cy, b.cy);
      for (let y = y0; y <= y1; y++) stampCorridor(x, y, width, false);
    } else if (overlapY1 - overlapY0 >= 3) {
      const y = overlapY0 + overlapY1 >> 1;
      const x0 = Math.min(a.cx, b.cx), x1 = Math.max(a.cx, b.cx);
      for (let x = x0; x <= x1; x++) stampCorridor(x, y, width, true);
    } else {
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
  const entranceRoom = rooms[semantics.entrance];
  const bfs = new Int16Array(W * H).fill(-1);
  const start = entranceRoom.cy * W + entranceRoom.cx;
  bfs[start] = 0;
  const queue = new Int32Array(W * H);
  queue[0] = start;
  let head = 0, tail = 1;
  while (head < tail) {
    const i = queue[head++];
    const x = i % W, y = i / W | 0;
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
function decorate(rooms, raster, semantics, params, rng) {
  const { W, H, grid, roomOf, doorways, corridorSet } = raster;
  const props = [];
  const spawns = [];
  const taken = new Uint8Array(W * H);
  doorways.forEach(({ x, y }) => taken[y * W + x] = 1);
  const doorwayNear = (x, y, radius) => doorways.some((d) => Math.max(Math.abs(d.x - x), Math.abs(d.y - y)) < radius);
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
  const wallAdjacent = (x, y) => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => grid[(y + dy) * W + (x + dx)] === WALL);
  rooms.forEach((room) => {
    if (room.archetype !== "large") return;
    for (let y = room.y + 1; y < room.y + room.h - 1; y++)
      for (let x = room.x + 1; x < room.x + room.w - 1; x++) {
        if ((x - room.cx) % 3 !== 0 || (y - room.cy) % 3 !== 0) continue;
        if (x === room.cx && y === room.cy) continue;
        if (!allFloor8(x, y) || taken[y * W + x] || doorwayNear(x, y, 2)) continue;
        place("pillar", x, y, room.id);
      }
  });
  const torches = [];
  for (let y = 1; y < H - 1; y++)
    for (let x = 1; x < W - 1; x++) {
      if (grid[y * W + x] !== WALL) continue;
      const facing = [[1, 0], [-1, 0], [0, 1], [0, -1]].find(([dx, dy]) => grid[(y + dy) * W + (x + dx)] === FLOOR);
      if (!facing) continue;
      if (torches.some((t) => Math.max(Math.abs(t.x - x), Math.abs(t.y - y)) < 4)) continue;
      torches.push({ x, y, fx: facing[0], fy: facing[1] });
    }
  torches.forEach((t) => props.push({ kind: "torch", x: t.x, y: t.y, rot: 0, scale: 1, roomId: roomOf[t.y * W + t.x], fx: t.fx, fy: t.fy }));
  rooms.forEach((room) => {
    const cells = freeCells(room);
    const count = Math.round(cells.length * 0.05 * params.decorDensity * (1.4 - room.difficulty));
    for (let k = 0; k < count && cells.length; k++) {
      const cell = cells.splice(rng.int(0, cells.length - 1), 1)[0];
      place("debris", cell.x, cell.y, room.id, { rot: rng.float(0, 6.283), scale: rng.float(0.5, 1.1) });
    }
  });
  rooms.forEach((room) => {
    if (room.type !== "combat") return;
    const cells = freeCells(room, (x, y) => wallAdjacent(x, y) && !doorwayNear(x, y, 2));
    const count = Math.min(cells.length, Math.max(0, Math.round(rng.int(2, 4) * params.decorDensity)));
    for (let k = 0; k < count && cells.length; k++) {
      const cell = cells.splice(rng.int(0, cells.length - 1), 1)[0];
      place("crate", cell.x, cell.y, room.id);
    }
  });
  rooms.forEach((room) => {
    if (room.type === "boss") {
      const ring = freeCells(room, (x, y) => {
        const edgeX = Math.min(x - room.x, room.x + room.w - 1 - x);
        const edgeY = Math.min(y - room.y, room.y + room.h - 1 - y);
        return Math.min(edgeX, edgeY) === 1 && (x + y) % 3 === 0 && !doorwayNear(x, y, 2);
      });
      ring.forEach((cell) => place("brazier", cell.x, cell.y, room.id));
    } else if (room.type === "treasure") {
      const cells = freeCells(room, (x, y) => Math.abs(x - room.cx) <= 1 && Math.abs(y - room.cy) <= 1);
      if (cells.length) {
        const cell = cells[rng.int(0, cells.length - 1)];
        place("chest", cell.x, cell.y, room.id);
      }
    } else if (room.type === "shrine") {
      if (grid[room.cy * W + room.cx] === FLOOR && !taken[room.cy * W + room.cx])
        place("crystal", room.cx, room.cy, room.id);
    } else if (room.type === "entrance") {
      if (!taken[room.cy * W + room.cx]) place("ring", room.cx, room.cy, room.id);
    }
  });
  const gemCount = Math.max(4, Math.min(40, Math.round(rooms.length * 0.4 * (params.gemDensity ?? 1))));
  const gemRooms = rooms.filter((r) => r.type !== "entrance");
  const gemRng = rng.fork("gems");
  let gemsPlaced = 0;
  let attempts = gemCount * 8;
  while (gemsPlaced < gemCount && attempts-- > 0) {
    const weights = gemRooms.map((r) => 1 + r.depth);
    const total = weights.reduce((s, w2) => s + w2, 0);
    let roll = gemRng.float(0, total);
    let room = gemRooms[gemRooms.length - 1];
    for (let i = 0; i < gemRooms.length; i++) {
      roll -= weights[i];
      if (roll <= 0) {
        room = gemRooms[i];
        break;
      }
    }
    const cells = freeCells(room);
    if (!cells.length) continue;
    const cell = cells[gemRng.int(0, cells.length - 1)];
    place("gem", cell.x, cell.y, room.id, { index: gemsPlaced });
    gemsPlaced++;
  }
  const spawnRng = rng.fork("spawns");
  rooms.forEach((room) => {
    if (room.type !== "combat" && room.type !== "elite") return;
    const area = room.w * room.h;
    const count = Math.round(area / 18 * (0.5 + room.difficulty) * params.monsterDensity);
    const cells = freeCells(room, (x, y) => !corridorSet.has(y * W + x));
    for (let k = 0; k < count && cells.length; k++) {
      const cell = cells.splice(spawnRng.int(0, cells.length - 1), 1)[0];
      taken[cell.y * W + cell.x] = 1;
      spawns.push({ x: cell.x, y: cell.y, tier: room.type === "elite" ? "elite" : "normal", roomId: room.id });
    }
  });
  return { props, spawns, taken };
}
function validateDungeon(d) {
  const failures = [];
  const { W, grid, bfs } = d;
  let floorTiles = 0, reached = 0;
  for (let i = 0; i < grid.length; i++) {
    if (grid[i] !== FLOOR) continue;
    floorTiles++;
    if (bfs[i] >= 0) reached++;
  }
  if (reached !== floorTiles) failures.push("connectivity: " + reached + "/" + floorTiles + " floor cells reachable");
  const boss = d.rooms.find((r) => r.type === "boss" || r.type === "dragon");
  const entrance = d.rooms.find((r) => r.type === "entrance");
  if (!boss) failures.push("no boss room");
  if (!entrance) failures.push("no entrance room");
  if (entrance && entrance.degree !== 1 && !d.stats.entranceFallback) failures.push("entrance degree " + entrance.degree);
  if (boss && entrance) {
    let maxBfs = 0;
    for (let i = 0; i < bfs.length; i++) if (bfs[i] > maxBfs) maxBfs = bfs[i];
    const bossDepth = bfs[boss.cy * W + boss.cx];
    if (bossDepth < 0.6 * maxBfs) failures.push("boss depth " + bossDepth + " < 60% of " + maxBfs);
  }
  const loops = d.edges.filter((e) => e.isLoop).length;
  if (loops < 1) failures.push("no loops (cyclomatic 0)");
  const doorwaySet = new Set(d.doorways.map((c) => c.y * W + c.x));
  for (const p of d.props) {
    const i = p.y * W + p.x;
    if (grid[i] === FLOOR && doorwaySet.has(i)) failures.push("prop " + p.kind + " on doorway");
    else if (p.kind !== "torch" && grid[i] !== FLOOR) failures.push("prop " + p.kind + " off floor");
    else if (p.kind === "torch" && grid[i] !== WALL) failures.push("torch off wall");
  }
  for (const s of d.spawns) {
    const i = s.y * W + s.x;
    if (grid[i] !== FLOOR || doorwaySet.has(i)) failures.push("spawn off floor / on doorway");
  }
  for (const portal of d.portals ?? []) {
    const i = portal.y * W + portal.x;
    if (grid[i] !== FLOOR) failures.push("portal off floor");
    else if (bfs[i] < 0) failures.push("portal unreachable");
  }
  return failures;
}
function dungeonChecksum(d) {
  let h = checksum32(d.grid);
  for (const portal of d.portals ?? []) h = checksum32(new Uint8Array([portal.x & 255, portal.x >> 8, portal.y & 255, portal.y >> 8]), h);
  return h >>> 0;
}
function generateDungeon(seed, params = {}, floorIndex = 1) {
  const started = now();
  const merged = { ...DEFAULT_PARAMS, ...params };
  merged.roomCount = Math.min(Math.max(merged.roomCount, 4), 60);
  merged.loopChance = Math.min(Math.max(merged.loopChance, 0), 1);
  let failures = [];
  for (let attempt = 0; attempt < 5; attempt++) {
    const attemptSeed = attempt === 0 ? seed >>> 0 : hash32(seed, "attempt", attempt);
    const rng = makeRng(attemptSeed);
    const rooms = separateRooms(scatterRooms(rng.fork("rooms"), merged.roomCount), merged.roomCount);
    const centers = rooms.map((r) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 }));
    const { edges, loops } = buildGraph(centers, delaunayEdges(centers), rng.fork("graph"), merged.loopChance);
    const semantics = assignSemantics(rooms, edges, rng.fork("semantics"));
    const raster = rasterize(rooms, edges, semantics, rng.fork("carve"));
    const { props, spawns } = decorate(rooms, raster, semantics, merged, rng.fork("decor"));
    let floorTiles = 0, wallTiles = 0;
    for (let i = 0; i < raster.grid.length; i++) {
      if (raster.grid[i] === FLOOR) floorTiles++;
      else if (raster.grid[i] === WALL) wallTiles++;
    }
    const criticalLength = edges.filter((e) => e.isCritical).length;
    const dungeon = {
      floorIndex,
      theme: null,
      // stamped by the campaign
      name: dungeonName(rng.fork("name")),
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
  throw new Error("dungeon generation failed after 5 attempts (seed " + seed + "): " + failures.join("; "));
}

// modules/dungeon-realms/src/gen/bestiary.js
var BESTIARY = [
  { id: "spider", floors: [1, 2], weight: 10 },
  { id: "bat", floors: [1, 3], weight: 8 },
  { id: "slime", floors: [2, 3], weight: 8 },
  { id: "skeleton", floors: [2, 4], weight: 9 },
  { id: "goblin", floors: [3, 4], weight: 8 },
  { id: "wraith", floors: [3, 5], weight: 6 },
  { id: "golem", floors: [4, 5], weight: 4 }
];

// modules/dungeon-realms/src/gen/campaign.js
var DEFAULT_CAMPAIGN_PARAMS = { ...DEFAULT_PARAMS, levelCount: 5, theme: "auto", roomCount: 0 };
var THEMES = [
  { id: "crypt", floorTints: [6122328, 5596245, 5135442, 6385500], corridorTint: 4475199, wallTint: 4015160, fogColor: 395274, torchColor: 16747578, gemColor: 3858350 },
  { id: "sewer", floorTints: [4610122, 4084550, 5267532, 3755330], corridorTint: 3292467, wallTint: 3029809, fogColor: 266252, torchColor: 14201402, gemColor: 5365972 },
  { id: "forge", floorTints: [5588804, 6113857, 5194302, 6508618], corridorTint: 3945263, wallTint: 3616298, fogColor: 1181445, torchColor: 16734758, gemColor: 16757575 },
  { id: "frost", floorTints: [5003884, 5398386, 4674662, 5858936], corridorTint: 3752783, wallTint: 3358025, fogColor: 395796, torchColor: 7000831, gemColor: 10476799 },
  { id: "roost", floorTints: [5260894, 5721190, 4800598, 6181485], corridorTint: 3748421, wallTint: 3419711, fogColor: 656658, torchColor: 13212415, gemColor: 14715647 }
];
function themeFor(floorIndex, theme = "auto") {
  if (theme !== "auto") return THEMES.find((t) => t.id === theme) ?? THEMES[0];
  return THEMES[(floorIndex - 1) % THEMES.length];
}
function roomCountFor(floorIndex, params) {
  if (params.roomCount) return params.roomCount;
  return Math.min(34 + 6 * (floorIndex - 1), 60);
}
function nearestFreeCell(dungeon, tx, ty, blocked) {
  const { W, H, grid } = dungeon;
  let best = null, bestD = Infinity;
  for (let y = 1; y < H - 1; y++)
    for (let x = 1; x < W - 1; x++) {
      if (grid[y * W + x] !== FLOOR || blocked.has(y * W + x)) continue;
      const d = (x - tx) * (x - tx) + (y - ty) * (y - ty);
      if (d < bestD) {
        bestD = d;
        best = { x, y };
      }
    }
  return best;
}
function placePortals(dungeon, floorIndex, levelCount) {
  const boss = dungeon.rooms[dungeon.bossId];
  const entrance = dungeon.rooms[dungeon.entranceId];
  const { W } = dungeon;
  const blocked = /* @__PURE__ */ new Set();
  dungeon.props.forEach((p) => {
    if (p.kind === "torch" || p.kind === "debris") return;
    blocked.add(p.y * W + p.x);
  });
  dungeon.spawns.forEach((s) => blocked.add(s.y * W + s.x));
  const addPortal = (kind, room, gated) => {
    const cell = nearestFreeCell(dungeon, room.cx, room.cy, blocked);
    if (!cell) return null;
    dungeon.props = dungeon.props.filter(
      (p) => !(p.kind === "debris" && Math.abs(p.x - cell.x) <= 1 && Math.abs(p.y - cell.y) <= 1)
    );
    for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]])
      blocked.add((cell.y + dy) * W + (cell.x + dx));
    const portal = { kind, x: cell.x, y: cell.y, roomId: room.id, gated };
    dungeon.portals.push(portal);
    return portal;
  };
  if (floorIndex < levelCount) addPortal("up", boss, true);
  else {
    boss.type = "dragon";
  }
  if (floorIndex >= 2) addPortal("down", entrance, false);
}
function typeSpawns(dungeon, floorIndex, bestiaryTable, rng) {
  const legal = bestiaryTable.filter((b) => floorIndex >= b.floors[0] && floorIndex <= b.floors[1]);
  if (!legal.length) return;
  const total = legal.reduce((s, b) => s + b.weight, 0);
  dungeon.spawns.forEach((spawn) => {
    let roll = rng.float(0, total);
    spawn.type = legal[legal.length - 1].id;
    for (const b of legal) {
      roll -= b.weight;
      if (roll <= 0) {
        spawn.type = b.id;
        break;
      }
    }
  });
  if (dungeon.spawns.length >= 12) {
    const present = new Set(dungeon.spawns.map((s) => s.type));
    const missing = legal.filter((b) => !present.has(b.id));
    missing.forEach((b) => {
      const slot = dungeon.spawns[rng.int(0, dungeon.spawns.length - 1)];
      slot.type = b.id;
    });
  }
}
function generateCampaign(seed, params = {}, bestiaryTable = BESTIARY) {
  const merged = { ...DEFAULT_CAMPAIGN_PARAMS, ...params };
  merged.levelCount = Math.min(Math.max(merged.levelCount ?? 5, 1), 9);
  const floors = [];
  for (let i = 1; i <= merged.levelCount; i++) {
    const floorSeed = hash32(seed, i, "floor");
    const floorParams = {
      ...merged,
      roomCount: roomCountFor(i, merged),
      monsterDensity: Math.min(merged.monsterDensity * (1 + 0.1 * (i - 1)), merged.monsterDensity * 1.5)
    };
    const dungeon = generateDungeon(floorSeed, floorParams, i);
    dungeon.theme = themeFor(i, merged.theme);
    dungeon.rooms.forEach((room) => {
      if (room.type !== "boss" && room.type !== "dragon")
        room.difficulty = Math.min(1, room.difficulty + 0.1 * (i - 1));
    });
    placePortals(dungeon, i, merged.levelCount);
    typeSpawns(dungeon, i, bestiaryTable, makeRng(hash32(floorSeed, "spawnTypes")));
    dungeon.checksum = dungeonChecksum(dungeon);
    floors.push(dungeon);
  }
  floors[0].ox = -(floors[0].W >> 1);
  floors[0].oy = -(floors[0].H >> 1);
  for (let k = 1; k < floors.length; k++) {
    const up = floors[k - 1].portals.find((p) => p.kind === "up");
    const down = floors[k].portals.find((p) => p.kind === "down");
    if (up && down) {
      floors[k].ox = floors[k - 1].ox + up.x - down.x;
      floors[k].oy = floors[k - 1].oy + up.y - down.y;
    } else {
      floors[k].ox = -(floors[k].W >> 1);
      floors[k].oy = -(floors[k].H >> 1);
    }
  }
  let h = 2166136261;
  floors.forEach((f) => {
    h = checksum32(f.grid, h);
    f.portals.forEach((p) => {
      h = checksum32(new Uint8Array([p.x & 255, p.x >> 8, p.y & 255, p.y >> 8, p.kind === "up" ? 1 : 2]), h);
    });
  });
  const campaign = { seed: seed >>> 0, params: merged, floors, checksum: h >>> 0 };
  const failures = validateCampaign(campaign);
  if (failures.length) throw new Error("campaign validation failed: " + failures.join("; "));
  return campaign;
}
function validateCampaign(campaign) {
  const failures = [];
  const { floors, params } = campaign;
  if (floors.length !== params.levelCount) failures.push("floor count " + floors.length + " != " + params.levelCount);
  for (let k = 0; k < floors.length; k++) {
    const floor = floors[k];
    const i = k + 1;
    const up = floor.portals.find((p) => p.kind === "up");
    const down = floor.portals.find((p) => p.kind === "down");
    if (i < floors.length && (!up || !up.gated)) failures.push("floor " + i + " missing gated UP portal");
    if (i === floors.length && up) failures.push("top floor has an UP portal");
    if (i >= 2 && !down) failures.push("floor " + i + " missing DOWN portal");
    if (i === 1 && down) failures.push("floor 1 has a DOWN portal");
    for (const portal of floor.portals) {
      const cell = portal.y * floor.W + portal.x;
      if (floor.grid[cell] !== FLOOR) failures.push("floor " + i + " portal off floor");
      if (floor.bfs[cell] < 0) failures.push("floor " + i + " portal unreachable from entrance");
    }
  }
  return failures;
}

// modules/dungeon-realms/src/render.js
function cellNoise(x, y, seed, amp = 0.05) {
  let h = (Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ seed) >>> 0;
  h = Math.imul(h ^ h >>> 13, 1540483477) >>> 0;
  return 1 - amp + (h & 65535) / 65535 * amp * 2;
}
function buildFloorGroup(THREE, dungeon, collected) {
  const { W, H, grid, rooms, props, theme, ox, oy } = dungeon;
  const group = new THREE.Group();
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3(1, 1, 1);
  const color = new THREE.Color();
  const worldX = (x) => x + ox + 0.5;
  const worldZ = (y) => y + oy + 0.5;
  const roomOf = new Int16Array(W * H).fill(-1);
  rooms.forEach((room) => {
    for (let y = room.y; y < room.y + room.h; y++)
      for (let x = room.x; x < room.x + room.w; x++)
        if (grid[y * W + x] === FLOOR) roomOf[y * W + x] = room.id;
  });
  let floorCount = 0, wallCount = 0;
  for (let i = 0; i < grid.length; i++) {
    if (grid[i] === FLOOR) floorCount++;
    else if (grid[i] === WALL) wallCount++;
  }
  const floorMesh = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1, 0.2, 1),
    new THREE.MeshStandardMaterial({ color: 16777215, roughness: 0.95 }),
    floorCount
  );
  floorMesh.name = "dr-floors";
  const wallMesh = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({ color: 16777215, roughness: 0.9 }),
    wallCount
  );
  wallMesh.name = "dr-walls";
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
        const height = 2 + (cellNoise(x, y, dungeon.stats.seed ^ 24301, 0.125) - 1) * 2;
        position.set(worldX(x), height / 2, worldZ(y));
        scale.set(1, height, 1);
        matrix.compose(position, quaternion, scale);
        wallMesh.setMatrixAt(wallIndex, matrix);
        color.setHex(theme.wallTint).multiplyScalar(cellNoise(x, y, dungeon.stats.seed ^ 2577));
        wallMesh.setColorAt(wallIndex, color);
        wallIndex++;
      }
    }
  scale.set(1, 1, 1);
  group.add(floorMesh, wallMesh);
  const byKind = {};
  props.forEach((p) => (byKind[p.kind] ??= []).push(p));
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
  instanced(
    "dr-pillars",
    new THREE.CylinderGeometry(0.3, 0.38, 2.4, 8),
    new THREE.MeshStandardMaterial({ color: theme.wallTint, roughness: 0.85 }),
    byKind.pillar,
    (p) => position.set(worldX(p.x), 1.2, worldZ(p.y))
  );
  instanced(
    "dr-debris",
    new THREE.BoxGeometry(0.32, 0.22, 0.32),
    new THREE.MeshStandardMaterial({ color: theme.corridorTint, roughness: 1 }),
    byKind.debris,
    (p) => {
      position.set(worldX(p.x), 0.1, worldZ(p.y));
      quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.rot ?? 0);
      scale.setScalar(p.scale ?? 1);
    }
  );
  quaternion.identity();
  scale.set(1, 1, 1);
  instanced(
    "dr-crates",
    new THREE.BoxGeometry(0.72, 0.72, 0.72),
    new THREE.MeshStandardMaterial({ color: 9071165, roughness: 0.9 }),
    byKind.crate,
    (p) => position.set(worldX(p.x), 0.36, worldZ(p.y))
  );
  instanced(
    "dr-braziers",
    new THREE.CylinderGeometry(0.3, 0.2, 0.55, 8),
    new THREE.MeshStandardMaterial({ color: 2894900, roughness: 0.6, metalness: 0.4 }),
    byKind.brazier,
    (p) => position.set(worldX(p.x), 0.28, worldZ(p.y))
  );
  instanced(
    "dr-chests",
    new THREE.BoxGeometry(0.85, 0.55, 0.6),
    new THREE.MeshStandardMaterial({ color: 11569710, roughness: 0.5, metalness: 0.3 }),
    byKind.chest,
    (p) => position.set(worldX(p.x), 0.28, worldZ(p.y))
  );
  instanced(
    "dr-crystals",
    new THREE.OctahedronGeometry(0.42, 0),
    new THREE.MeshBasicMaterial({ color: theme.gemColor }),
    byKind.crystal,
    (p) => {
      position.set(worldX(p.x), 1, worldZ(p.y));
      scale.set(1, 1.7, 1);
    }
  );
  scale.set(1, 1, 1);
  instanced(
    "dr-rings",
    new THREE.TorusGeometry(0.9, 0.07, 8, 28),
    new THREE.MeshBasicMaterial({ color: 3854532 }),
    byKind.ring,
    (p) => {
      position.set(worldX(p.x), 0.06, worldZ(p.y));
      quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
    }
  );
  quaternion.identity();
  const torches = byKind.torch ?? [];
  instanced(
    "dr-torch-brackets",
    new THREE.BoxGeometry(0.12, 0.34, 0.12),
    new THREE.MeshStandardMaterial({ color: 3813670, roughness: 0.8 }),
    torches,
    (p) => position.set(worldX(p.x) + (p.fx ?? 0) * 0.42, 1.45, worldZ(p.y) + (p.fy ?? 0) * 0.42)
  );
  const flameSpots = torches.map((p) => ({
    x: worldX(p.x) + (p.fx ?? 0) * 0.42,
    y: 1.78,
    z: worldZ(p.y) + (p.fy ?? 0) * 0.42
  })).concat((byKind.brazier ?? []).map((p) => ({ x: worldX(p.x), y: 0.75, z: worldZ(p.y) })));
  instanced(
    "dr-flames",
    new THREE.ConeGeometry(0.11, 0.3, 6),
    new THREE.MeshBasicMaterial({ color: theme.torchColor }),
    flameSpots,
    (p) => position.set(p.x, p.y, p.z)
  );
  const budget = 8;
  const step = Math.max(1, Math.ceil(flameSpots.length / budget));
  for (let i = 0; i < flameSpots.length && i / step < budget; i += step) {
    const spot = flameSpots[i];
    const light = new THREE.PointLight(theme.torchColor, 5, 11, 2);
    light.name = "dr-light";
    light.position.set(spot.x, spot.y + 0.25, spot.z);
    group.add(light);
  }
  const gems = (byKind.gem ?? []).slice().sort((a, b) => a.index - b.index);
  const gemWorld = gems.map((p) => ({ x: worldX(p.x), y: 0.55, z: worldZ(p.y), index: p.index }));
  const gemMesh = new THREE.InstancedMesh(
    new THREE.OctahedronGeometry(0.17, 0),
    new THREE.MeshBasicMaterial({ color: theme.gemColor }),
    Math.max(1, gemWorld.length)
  );
  gemMesh.name = "dr-gems";
  gemMesh.count = gemWorld.length;
  group.add(gemMesh);
  dungeon.portals.forEach((portal) => {
    const portalGroup = new THREE.Group();
    portalGroup.name = "dr-portal-" + portal.kind;
    portalGroup.position.set(worldX(portal.x), 0, worldZ(portal.y));
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(1.05, 0.1, 10, 36),
      new THREE.MeshBasicMaterial({ color: 5593702 })
    );
    ring.name = "dr-portal-ring";
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.1;
    const disc = new THREE.Mesh(
      new THREE.CircleGeometry(0.92, 28),
      new THREE.MeshBasicMaterial({ color: 3752016, transparent: true, opacity: 0.55 })
    );
    disc.name = "dr-portal-disc";
    disc.rotation.x = -Math.PI / 2;
    disc.position.y = 0.08;
    portalGroup.add(ring, disc);
    portalGroup.userData.portal = { kind: portal.kind, gated: portal.gated };
    group.add(portalGroup);
  });
  group.userData._dr = { gemWorld, theme };
  applyGems(group, collected);
  return group;
}
function applyGems(group, collected) {
  const gemMesh = group.getObjectByName("dr-gems");
  const { gemWorld } = group.userData._dr;
  if (!gemMesh || !gemWorld.length) return;
  const matrix = new gemMesh.matrixWorld.constructor();
  gemWorld.forEach((gem, i) => {
    if (collected.has(gem.index)) matrix.makeScale(0, 0, 0);
    else matrix.makeTranslation(gem.x, gem.y, gem.z);
    gemMesh.setMatrixAt(i, matrix);
  });
  gemMesh.instanceMatrix.needsUpdate = true;
}
function setPortalSealed(group, sealed, theme) {
  const portal = group.getObjectByName("dr-portal-up");
  if (!portal) return;
  const ring = portal.getObjectByName("dr-portal-ring");
  const disc = portal.getObjectByName("dr-portal-disc");
  if (ring) ring.material.color.setHex(sealed ? 5593702 : 3793151);
  if (disc) {
    disc.material.color.setHex(sealed ? 3752016 : theme?.gemColor ?? 3793088);
    disc.material.opacity = sealed ? 0.35 : 0.75;
  }
  portal.userData.portal.sealed = sealed;
  const down = group.getObjectByName("dr-portal-down");
  if (down) {
    down.getObjectByName("dr-portal-ring")?.material.color.setHex(3776767);
    down.userData.portal.sealed = false;
  }
}
function animateFloor(THREE, group, collected, time) {
  const data = group.userData._dr;
  if (!data) return;
  const gemMesh = group.getObjectByName("dr-gems");
  if (gemMesh && data.gemWorld.length) {
    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3(1, 1, 1);
    const axis = new THREE.Vector3(0, 1, 0);
    data.gemWorld.forEach((gem, i) => {
      if (collected.has(gem.index)) return;
      position.set(gem.x, gem.y + Math.sin(time * 2 + gem.x) * 0.08, gem.z);
      quaternion.setFromAxisAngle(axis, time * 1.6 + gem.index);
      matrix.compose(position, quaternion, scale);
      gemMesh.setMatrixAt(i, matrix);
    });
    gemMesh.instanceMatrix.needsUpdate = true;
  }
  group.children.forEach((child) => {
    if (child.name === "dr-portal-up" || child.name === "dr-portal-down") {
      const ring = child.getObjectByName("dr-portal-ring");
      if (ring && child.userData.portal?.sealed === false) ring.rotation.z = time * 0.8;
    } else if (child.name === "dr-light") {
      child.intensity = 5 + Math.sin(time * 9 + child.position.x * 3.7) * 0.9 + Math.sin(time * 23 + child.position.z * 5.1) * 0.5;
    }
  });
}

// modules/dungeon-realms/src/gui.js
var Z = 900;
var GEM_SVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" style="vertical-align:-2px"><path d="M6 3h12l4 6-10 12L2 9l4-6z" fill="#39e0c0" stroke="#bafff0" stroke-width="1.2"/><path d="M2 9h20M9 3l3 6 3-6M12 21 9 9M12 21l3-12" stroke="#0b6f5c" stroke-width="0.8"/></svg>';
var root = null;
var menuCard = null;
var hudBox = null;
var selectedIndex = 0;
var menuButtons = [];
var menuAction = null;
var keyHandler = null;
function ensureRoot() {
  if (root && document.body.contains(root)) return root;
  document.getElementById("dr-gui")?.remove();
  root = document.createElement("div");
  root.id = "dr-gui";
  root.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:" + Z + ";font-family:ui-sans-serif,system-ui,'Segoe UI',Roboto,sans-serif;";
  document.body.appendChild(root);
  return root;
}
function renderMenuButtons() {
  if (!menuCard) return;
  const list = menuCard.querySelector(".dr-buttons");
  if (!list) return;
  list.innerHTML = "";
  menuButtons.forEach((button, index) => {
    const el = document.createElement("button");
    el.type = "button";
    el.className = "dr-btn";
    el.dataset.id = button.id;
    el.textContent = button.label;
    const selected = index === selectedIndex && !button.disabled;
    el.style.cssText = "display:block;width:100%;margin:6px 0;padding:10px 18px;border-radius:10px;font-size:15px;text-align:center;cursor:pointer;transition:transform .06s;" + (button.disabled ? "background:rgba(255,255,255,.04);color:#6b7280;border:1px solid rgba(255,255,255,.06);cursor:default;" : selected ? "background:linear-gradient(180deg,#0ea5e9,#0369a1);color:#fff;border:1px solid #7dd3fc;transform:scale(1.03);" : "background:rgba(255,255,255,.08);color:#e5e7eb;border:1px solid rgba(255,255,255,.14);");
    if (!button.disabled) {
      el.onmouseenter = () => {
        selectedIndex = index;
        renderMenuButtons();
      };
      el.onclick = () => menuAction?.(button.id);
    }
    list.appendChild(el);
  });
}
function showMenu(model) {
  ensureRoot();
  const fresh = !menuCard;
  if (fresh) {
    menuCard = document.createElement("div");
    menuCard.id = "dr-menu";
    menuCard.style.cssText = "position:absolute;left:50%;top:44%;transform:translate(-50%,-50%);min-width:320px;max-width:420px;pointer-events:auto;background:rgba(13,18,28,.92);border:1px solid rgba(255,255,255,.14);border-radius:16px;padding:22px 26px;color:#e5e7eb;backdrop-filter:blur(8px);box-shadow:0 18px 60px rgba(0,0,0,.5);text-align:center;";
    root.appendChild(menuCard);
    selectedIndex = 0;
  }
  const lines = (model.lines ?? []).map((l) => '<div style="margin:2px 0">' + l + "</div>").join("");
  menuCard.innerHTML = '<div style="font-size:11px;letter-spacing:.2em;color:#67e8f9;text-transform:uppercase;margin-bottom:6px">Dungeon Realms</div><div class="dr-title" style="font-size:21px;font-weight:700;margin-bottom:4px">' + model.title + "</div>" + (model.subtitle ? '<div style="font-size:13px;color:#9ca3af;margin-bottom:8px">' + model.subtitle + "</div>" : "") + (lines ? '<div style="font-size:13px;color:#cbd5e1;margin-bottom:8px">' + lines + "</div>" : "") + '<div class="dr-buttons" style="margin-top:12px"></div><div style="font-size:11px;color:#64748b;margin-top:12px">' + (model.hint ?? "&#8593;&#8595; select &nbsp;&middot;&nbsp; Enter confirm") + "</div>";
  menuButtons = model.buttons;
  menuAction = model.onAction;
  if (selectedIndex >= menuButtons.length) selectedIndex = 0;
  renderMenuButtons();
  if (!keyHandler) {
    keyHandler = (event) => {
      if (!menuCard) return;
      if (event.code === "ArrowUp" || event.code === "ArrowDown") {
        const dir = event.code === "ArrowUp" ? -1 : 1;
        let next = selectedIndex;
        for (let i = 0; i < menuButtons.length; i++) {
          next = (next + dir + menuButtons.length) % menuButtons.length;
          if (!menuButtons[next].disabled) break;
        }
        selectedIndex = next;
        renderMenuButtons();
      } else if (event.code === "Enter" || event.code === "NumpadEnter") {
        const button = menuButtons[selectedIndex];
        if (button && !button.disabled) menuAction?.(button.id);
      } else return;
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    window.addEventListener("keydown", keyHandler, true);
  }
}
function hideMenu() {
  menuCard?.remove();
  menuCard = null;
  menuButtons = [];
  menuAction = null;
  if (keyHandler) {
    window.removeEventListener("keydown", keyHandler, true);
    keyHandler = null;
  }
}
var CORNERS = {
  "top-left": "left:16px;top:64px;",
  "top-right": "right:16px;top:64px;text-align:right;",
  "bottom-left": "left:16px;bottom:70px;",
  "bottom-right": "right:16px;bottom:70px;text-align:right;"
};
function showHud(model) {
  ensureRoot();
  if (!hudBox) {
    hudBox = document.createElement("div");
    hudBox.id = "dr-hud";
    root.appendChild(hudBox);
  }
  const corner = CORNERS[model.corner ?? "top-left"] ?? CORNERS["top-left"];
  hudBox.style.cssText = "position:absolute;" + corner + "pointer-events:none;color:#e5e7eb;text-shadow:0 1px 3px rgba(0,0,0,.9);font-size:14px;line-height:1.7;";
  const show = model.show ?? { gems: true, level: true, players: true, objective: true };
  let html = "";
  if (show.gems && model.gems)
    html += '<div id="dr-hud-gems" style="font-size:19px;font-weight:700">' + GEM_SVG + ' <span id="dr-gem-count">' + model.gems.have + '</span><span style="color:#94a3b8;font-size:14px"> / ' + model.gems.need + " needed &middot; " + model.gems.total + " hidden</span></div>";
  if (show.level && model.level)
    html += '<div id="dr-hud-level" style="font-size:12px;letter-spacing:.12em;color:#a5b4fc;text-transform:uppercase">LEVEL ' + model.level.k + " / " + model.level.n + " &nbsp;&middot;&nbsp; " + model.level.name + "</div>";
  if (show.players && model.players?.length)
    html += '<div id="dr-hud-players">' + model.players.map(
      (p) => '<span style="display:inline-block;margin-right:6px;padding:1px 8px;border-radius:99px;font-size:11px;background:' + (p.slot === "p1" ? "rgba(14,165,233,.25);border:1px solid #38bdf8" : "rgba(249,115,22,.25);border:1px solid #fb923c") + '">' + p.slot.toUpperCase() + " " + p.name + (p.me ? " (you)" : "") + "</span>"
    ).join("") + "</div>";
  (model.extraProps ?? []).forEach((prop) => {
    html += '<div style="font-size:13px;color:#cbd5e1">' + prop.name + ": <b>" + prop.value + "</b></div>";
  });
  if (show.objective && model.objective)
    html += '<div id="dr-hud-objective" style="font-size:12px;color:#86efac;max-width:280px">' + model.objective + "</div>";
  hudBox.innerHTML = html;
}
function hideHud() {
  hudBox?.remove();
  hudBox = null;
}

// modules/dungeon-realms/src/audio.js
var ctx = null;
var bus = null;
function ensure() {
  if (typeof AudioContext === "undefined") return null;
  if (!ctx) {
    ctx = new AudioContext();
    bus = ctx.createGain();
    bus.gain.value = 0.25;
    bus.connect(ctx.destination);
  }
  if (ctx.state === "suspended") ctx.resume().catch(() => {
  });
  return ctx;
}
function tone(freq, dur, type = "triangle", delay = 0, gain = 0.5) {
  const c = ensure();
  if (!c || !bus) return;
  const t0 = c.currentTime + delay;
  const osc = c.createOscillator();
  const env = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  env.gain.setValueAtTime(0, t0);
  env.gain.linearRampToValueAtTime(gain, t0 + 0.012);
  env.gain.exponentialRampToValueAtTime(1e-3, t0 + dur);
  osc.connect(env).connect(bus);
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
}
function gemChime(combo = 0) {
  const base = 620 * Math.pow(2, Math.min(combo, 12) * 0.07);
  tone(base, 0.18, "triangle");
  tone(base * 1.5, 0.22, "sine", 0.05, 0.3);
}
function portalWhoosh() {
  const c = ensure();
  if (!c || !bus) return;
  const t0 = c.currentTime;
  const osc = c.createOscillator();
  const env = c.createGain();
  osc.type = "sawtooth";
  osc.frequency.setValueAtTime(140, t0);
  osc.frequency.exponentialRampToValueAtTime(880, t0 + 0.5);
  env.gain.setValueAtTime(1e-4, t0);
  env.gain.exponentialRampToValueAtTime(0.3, t0 + 0.2);
  env.gain.exponentialRampToValueAtTime(1e-3, t0 + 0.7);
  osc.connect(env).connect(bus);
  osc.start(t0);
  osc.stop(t0 + 0.8);
}
function sealBreak() {
  tone(392, 0.3, "square", 0, 0.2);
  tone(523, 0.3, "square", 0.1, 0.2);
  tone(784, 0.5, "triangle", 0.2, 0.35);
}
function startThump() {
  tone(110, 0.35, "sine", 0, 0.6);
  tone(220, 0.2, "triangle", 0.05, 0.25);
}
function winFanfare() {
  [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.5, "triangle", i * 0.16, 0.4));
  tone(1568, 0.9, "sine", 0.64, 0.2);
}

// modules/dungeon-realms/src/game.js
var GROUP_NAME = "dungeon-module";
var DEFAULT_RULES = {
  gemShare: 0.7,
  pickupRadius: 0.9,
  allPlayersPortal: true,
  disableFlight: true
};
var DEFAULT_MENU = {
  show: "auto",
  button1: "join-p1",
  button2: "join-p2",
  button3: "start",
  button4: "new-dungeon"
};
var DEFAULT_HUD = { showGems: true, showLevel: true, showPlayers: true, showObjective: true, corner: "top-left" };
function createGame(api) {
  const THREE = api.THREE;
  const state = {
    seed: (
      /** @type {number | null} */
      null
    ),
    params: (
      /** @type {any} */
      {}
    ),
    campaign: (
      /** @type {any} */
      null
    ),
    floorIndex: 1,
    /** @type {Record<number, Set<number>>} floor -> collected gem indices */
    collected: {},
    /** @type {Record<string, {peerId: string, name: string} | null>} */
    slots: { p1: null, p2: null },
    started: false,
    startedAt: 0,
    wonAt: 0,
    /** @type {Record<string, boolean>} peerId -> standing on the UP portal */
    onPortal: {},
    myOnPortal: false,
    combo: 0,
    lastGemAt: 0,
    /** @type {Record<string, number>} custom prop counters (drprop nodes) */
    propValues: {}
  };
  const config = {
    rules: { ...DEFAULT_RULES },
    menu: { ...DEFAULT_MENU },
    hud: { ...DEFAULT_HUD },
    /** @type {Record<string, {initial: number, showInHud: boolean}>} */
    props: {}
  };
  let guiDirty = true;
  let playingNow = false;
  const me = () => api.peerId() ?? "me";
  const shortName = (peerId) => peerId === me() ? "you" : String(peerId).slice(0, 6);
  const currentFloor = () => state.campaign?.floors[state.floorIndex - 1] ?? null;
  const collectedSet = (floor = state.floorIndex) => state.collected[floor] ??= /* @__PURE__ */ new Set();
  const group = () => api.scene()?.getObjectByName(GROUP_NAME) ?? null;
  function disposeGroup() {
    const existing = group();
    if (!existing) return;
    existing.traverse((child) => {
      child.geometry?.dispose?.();
      if (child.material && !Array.isArray(child.material)) child.material.dispose?.();
    });
    existing.parent?.remove(existing);
  }
  function gemTotals(floor = state.floorIndex) {
    const dungeon = state.campaign?.floors[floor - 1];
    if (!dungeon) return { total: 0, need: 0, have: 0 };
    const total = dungeon.props.filter((p) => p.kind === "gem").length;
    const need = Math.max(1, Math.ceil(total * config.rules.gemShare));
    return { total, need, have: Math.min(collectedSet(floor).size, total) };
  }
  const sealed = () => {
    const { need, have } = gemTotals();
    return have < need;
  };
  const topFloor = () => state.floorIndex >= (state.campaign?.floors.length ?? 1);
  function rebuild() {
    disposeGroup();
    const scene = api.scene();
    const dungeon = currentFloor();
    if (!scene || !dungeon) return;
    const built = buildFloorGroup(THREE, dungeon, collectedSet());
    built.name = GROUP_NAME;
    const ordered = [...dungeon.rooms].sort((a, b) => {
      const ka = a.type === "entrance" ? -1 : a.depth;
      const kb = b.type === "entrance" ? -1 : b.depth;
      return ka - kb || a.id - b.id;
    }).map((room) => ({ x: room.x + dungeon.ox, y: room.y + dungeon.oy, w: room.w, h: room.h }));
    built.userData = {
      seed: state.seed,
      params: state.params,
      floorIndex: state.floorIndex,
      levelCount: state.campaign.floors.length,
      checksum: dungeon.checksum,
      campaignChecksum: state.campaign.checksum,
      name: dungeon.name,
      stats: dungeon.stats,
      _dr: built.userData._dr,
      play: {
        grid: dungeon.grid,
        width: dungeon.W,
        height: dungeon.H,
        minX: dungeon.ox,
        minY: dungeon.oy,
        rooms: ordered,
        floorValue: FLOOR
      }
    };
    built.userData._dr.game = {
      state,
      config,
      collect: (index) => collectGem(state.floorIndex, index),
      travel: (target) => travel(target),
      start: () => start(),
      claimSlot: (slot) => claimSlot(slot),
      menuAction: menuAction2,
      gemTotals
    };
    scene.add(built);
    setPortalSealed(built, sealed(), dungeon.theme);
    guiDirty = true;
  }
  function generate(seed, params = {}, broadcast = true) {
    let campaign;
    try {
      campaign = generateCampaign(seed, params);
    } catch (error) {
      api.toast("Dungeon generation failed: " + error.message);
      return false;
    }
    state.seed = seed >>> 0;
    state.params = params;
    state.campaign = campaign;
    state.floorIndex = 1;
    state.collected = {};
    state.started = false;
    state.wonAt = 0;
    state.onPortal = {};
    state.myOnPortal = false;
    state.combo = 0;
    state._wasSealed = void 0;
    state._menuSuppressed = false;
    rebuild();
    if (broadcast) api.send({ op: "generate", seed: state.seed, params, checksum: campaign.checksum });
    return true;
  }
  function applyRemoteGenerate(data) {
    if (data.seed === state.seed && JSON.stringify(data.params ?? {}) === JSON.stringify(state.params) && state.campaign) return;
    if (!generate(data.seed, data.params ?? {}, false)) return;
    if (data.checksum && data.checksum !== state.campaign.checksum)
      api.toast("Dungeon checksum differs from the sender \u2014 versions may not match");
  }
  function collectGem(floor, index, broadcast = true) {
    const set = collectedSet(floor);
    if (set.has(index)) return;
    set.add(index);
    const g = group();
    if (floor === state.floorIndex && g) {
      applyGems(g, set);
      const wasSealed = state._wasSealed ?? true;
      const nowSealed = sealed();
      if (wasSealed && !nowSealed && !topFloor()) {
        sealBreak();
        api.toast("The portal unseals!");
        setPortalSealed(g, false, currentFloor()?.theme);
      }
      state._wasSealed = nowSealed;
    }
    if (broadcast) {
      const now2 = api.now();
      state.combo = now2 - state.lastGemAt < 4 ? state.combo + 1 : 0;
      state.lastGemAt = now2;
      gemChime(state.combo);
      api.send({ op: "gem", floor, index });
    }
    guiDirty = true;
    if (floor === state.floorIndex && topFloor() && state.started && !state.wonAt && !sealed()) {
      state.wonAt = api.now();
      winFanfare();
      guiDirty = true;
    }
  }
  function travel(target, broadcast = true) {
    const levels = state.campaign?.floors.length ?? 0;
    if (!levels || target < 1 || target > levels || target === state.floorIndex) return;
    state.floorIndex = target;
    state.onPortal = {};
    state.myOnPortal = false;
    state._wasSealed = void 0;
    rebuild();
    portalWhoosh();
    const dungeon = currentFloor();
    api.toast("LEVEL " + target + " / " + levels + " \u2014 " + dungeon.name);
    if (broadcast) api.send({ op: "floor", floorIndex: target });
  }
  function claimSlot(slot, broadcast = true, peerId = me()) {
    const mineAlready = state.slots[slot]?.peerId === peerId;
    Object.keys(state.slots).forEach((key) => {
      if (state.slots[key]?.peerId === peerId) state.slots[key] = null;
    });
    if (!mineAlready) state.slots[slot] = { peerId, name: shortName(peerId) };
    guiDirty = true;
    if (broadcast) api.send({ op: "slot", slot, peerId: mineAlready ? null : peerId });
  }
  function applyRemoteSlot(data) {
    Object.keys(state.slots).forEach((key) => {
      if (data.peerId && state.slots[key]?.peerId === data.peerId) state.slots[key] = null;
    });
    state.slots[data.slot] = data.peerId ? { peerId: data.peerId, name: shortName(data.peerId) } : null;
    guiDirty = true;
  }
  function start(broadcast = true) {
    if (!state.campaign || state.started) return;
    state.started = true;
    state.startedAt = api.now();
    state.wonAt = 0;
    startThump();
    guiDirty = true;
    if (broadcast) api.send({ op: "start" });
  }
  function reset(broadcast = true) {
    state.started = false;
    state.wonAt = 0;
    guiDirty = true;
    if (broadcast) api.send({ op: "reset" });
  }
  function bumpProp(name, delta, broadcast = true) {
    state.propValues[name] = (state.propValues[name] ?? 0) + delta;
    guiDirty = true;
    if (broadcast) api.send({ op: "prop", name, value: state.propValues[name] });
  }
  function clear() {
    disposeGroup();
    state.campaign = null;
    state.seed = null;
    state.started = false;
    state.wonAt = 0;
    state.collected = {};
    state.onPortal = {};
    state.propValues = {};
    hideMenu();
    hideHud();
  }
  function menuAction2(id) {
    if (id === "join-p1") claimSlot("p1");
    else if (id === "join-p2") claimSlot("p2");
    else if (id === "start") start();
    else if (id === "resume") {
      state._menuSuppressed = true;
      guiDirty = true;
    } else if (id === "new-dungeon" || id === "play-again") {
      const seed = hash32(api.now() * 1e3 | 0, "dice") % 1e5;
      generate(seed, state.params ?? {});
      api.toast("New dungeon \u2014 seed " + seed);
    } else if (id === "generate") {
      const seed = hash32(api.now() * 1e3 | 0, "dice") % 1e5;
      generate(seed, {});
    }
    guiDirty = true;
  }
  function slotLabel(slot, fallback) {
    const claim = state.slots[slot];
    if (!claim) return fallback;
    return fallback + " \u2014 " + (claim.peerId === me() ? "you (click to leave)" : claim.name);
  }
  function buttonFor(action) {
    switch (action) {
      case "join-p1":
        return { id: action, label: slotLabel("p1", "Join as Player 1") };
      case "join-p2":
        return { id: action, label: slotLabel("p2", "Join as Player 2") };
      case "start":
        return { id: action, label: "Start adventure", disabled: !state.campaign };
      case "resume":
        return { id: action, label: "Resume" };
      case "new-dungeon":
        return { id: action, label: "New dungeon \u{1F3B2}" };
      case "play-again":
        return { id: action, label: "Play again \u{1F3B2}" };
      default:
        return null;
    }
  }
  function refreshGui() {
    guiDirty = false;
    const showMode = config.menu.show ?? "auto";
    const menuWanted = playingNow && showMode !== "never" && (showMode === "always" || !state.started && !state._menuSuppressed || state.wonAt > 0);
    if (menuWanted && state.wonAt) {
      const seconds = Math.max(0, Math.round(state.wonAt - state.startedAt));
      const totalGems = Object.values(state.collected).reduce((sum, set) => sum + set.size, 0);
      showMenu({
        title: "Victory!",
        subtitle: "The dragon\u2019s hoard is yours",
        lines: [
          "Gems collected: " + totalGems,
          "Time: " + Math.floor(seconds / 60) + "m " + seconds % 60 + "s",
          "Floors conquered: " + state.campaign.floors.length
        ],
        buttons: [buttonFor("play-again"), buttonFor("resume")].filter(Boolean),
        onAction: menuAction2
      });
    } else if (menuWanted) {
      const dungeon = currentFloor();
      const { total } = gemTotals();
      const buttons = state.campaign ? [config.menu.button1, config.menu.button2, config.menu.button3, config.menu.button4].map(buttonFor).filter(Boolean) : [{ id: "generate", label: "Generate a dungeon \u{1F3B2}" }];
      if (state.started && !buttons.some((b) => b.id === "resume")) buttons.push(buttonFor("resume"));
      showMenu({
        title: dungeon ? dungeon.name : "Dungeon Realms",
        subtitle: dungeon ? "LEVEL " + state.floorIndex + " / " + state.campaign.floors.length + " \xB7 " + dungeon.rooms.length + " rooms \xB7 " + total + " gems hidden" : "Co-op gem hunt \xB7 collect gems, unseal portals, reach the top",
        buttons,
        onAction: menuAction2
      });
    } else hideMenu();
    const hudWanted = playingNow && state.started && state.campaign;
    if (hudWanted) {
      const dungeon = currentFloor();
      const { total, need, have } = gemTotals();
      const players = ["p1", "p2"].filter((slot) => state.slots[slot]).map((slot) => ({ slot, name: state.slots[slot].name, me: state.slots[slot].peerId === me() }));
      const extraProps = Object.entries(config.props).filter(([, def]) => def.showInHud).map(([name, def]) => ({ name, value: state.propValues[name] ?? def.initial ?? 0 }));
      const objective = state.wonAt ? "Victory! Press Esc to leave play mode." : sealed() ? "Collect " + (need - have) + " more gem" + (need - have === 1 ? "" : "s") + (topFloor() ? " to claim the dragon\u2019s hoard" : " to unseal the portal") : topFloor() ? "The hoard is yours!" : config.rules.allPlayersPortal && players.length > 1 ? "Portal unsealed \u2014 stand on it together!" : "Portal unsealed \u2014 step through!";
      showHud({
        gems: { have, need, total },
        level: { k: state.floorIndex, n: state.campaign.floors.length, name: dungeon.name },
        players,
        objective,
        extraProps,
        corner: config.hud.corner,
        show: {
          gems: config.hud.showGems,
          level: config.hud.showLevel,
          players: config.hud.showPlayers,
          objective: config.hud.showObjective
        }
      });
    } else hideHud();
  }
  function tick(time) {
    const minimap = typeof document !== "undefined" ? document.getElementById("dungeon-minimap") : null;
    const playing = !!minimap && !minimap.classList.contains("hidden");
    if (playing !== playingNow) {
      playingNow = playing;
      if (!playing) state._menuSuppressed = false;
      guiDirty = true;
    }
    const g = group();
    if (g) animateFloor(THREE, g, collectedSet(), time);
    if (playingNow && state.started && !state.wonAt && g) {
      const ray = api.pointerRay();
      const origin = ray?.ray?.origin;
      if (origin) {
        const gems = g.userData._dr?.gemWorld ?? [];
        const set = collectedSet();
        for (const gem of gems) {
          if (set.has(gem.index)) continue;
          const dx = origin.x - gem.x;
          const dz = origin.z - gem.z;
          if (dx * dx + dz * dz < config.rules.pickupRadius * config.rules.pickupRadius && Math.abs(origin.y - gem.y) < 2.6)
            collectGem(state.floorIndex, gem.index);
        }
        const portal = g.getObjectByName("dr-portal-up");
        if (portal && !sealed()) {
          const dx = origin.x - portal.position.x;
          const dz = origin.z - portal.position.z;
          const on = dx * dx + dz * dz < 1.4 * 1.4;
          if (on !== state.myOnPortal) {
            state.myOnPortal = on;
            state.onPortal[me()] = on;
            api.send({ op: "onportal", peerId: me(), on });
          }
          if (on) {
            const others = ["p1", "p2"].map((slot) => state.slots[slot]?.peerId).filter((peerId) => peerId && peerId !== me());
            const together = !config.rules.allPlayersPortal || others.every((peerId) => state.onPortal[peerId]);
            if (together) travel(state.floorIndex + 1);
          }
        }
      }
    }
    if (guiDirty) refreshGui();
  }
  function handleMessage(data) {
    if (data.op === "generate") applyRemoteGenerate(data);
    else if (data.op === "floor") travel(data.floorIndex, false);
    else if (data.op === "gem") collectGem(data.floor, data.index, false);
    else if (data.op === "slot") applyRemoteSlot(data);
    else if (data.op === "start") {
      state.started = true;
      state.startedAt = api.now();
      guiDirty = true;
    } else if (data.op === "reset") {
      state.started = false;
      state.wonAt = 0;
      guiDirty = true;
    } else if (data.op === "onportal") {
      state.onPortal[data.peerId] = !!data.on;
    } else if (data.op === "prop") {
      state.propValues[data.name] = data.value;
      guiDirty = true;
    } else if (data.op === "clear") clear();
  }
  function getState() {
    if (state.seed == null) return null;
    return {
      seed: state.seed,
      params: state.params,
      floorIndex: state.floorIndex,
      collected: Object.fromEntries(Object.entries(state.collected).map(([floor, set]) => [floor, [...set]])),
      slots: state.slots,
      started: state.started,
      startedAt: state.startedAt,
      wonAt: state.wonAt,
      propValues: state.propValues
    };
  }
  function applyState(remote) {
    if (!remote || remote.seed == null) return;
    if (!generate(remote.seed, remote.params ?? {}, false)) return;
    Object.entries(remote.collected ?? {}).forEach(([floor, indices]) => {
      state.collected[floor] = new Set(indices);
    });
    state.slots = { p1: null, p2: null, ...remote.slots ?? {} };
    state.started = !!remote.started;
    state.startedAt = remote.startedAt ?? 0;
    state.wonAt = remote.wonAt ?? 0;
    state.propValues = remote.propValues ?? {};
    if (remote.floorIndex && remote.floorIndex !== state.floorIndex) travel(remote.floorIndex, false);
    else rebuild();
    guiDirty = true;
  }
  const suppressFlight = () => playingNow && state.started && !state.wonAt && config.rules.disableFlight;
  return {
    state,
    config,
    generate,
    collectGem,
    travel,
    claimSlot,
    start,
    reset,
    bumpProp,
    clear,
    menuAction: menuAction2,
    tick,
    handleMessage,
    getState,
    applyState,
    gemTotals,
    suppressFlight,
    group,
    markGuiDirty: () => guiDirty = true
  };
}

// modules/dungeon-realms/src/nodes.js
var EXPIRE_FRAMES = 40;
function registerNodes(api, game) {
  let frame = 0;
  const seen = { rules: -1, menu: -1, hud: -1 };
  const propSeen = {};
  api.registerNodeGroup({
    group: "Dungeon Realms",
    items: [
      {
        type: "drdungeon",
        label: "Dungeon",
        defaults: { seed: 7, roomCount: 0, levelCount: 5, gemDensity: 1, apply: false },
        params: [
          { key: "seed", kind: "range", min: 1, max: 9999, step: 1 },
          { key: "roomCount", kind: "range", min: 0, max: 60, step: 2 },
          { key: "levelCount", kind: "range", min: 1, max: 9, step: 1 },
          { key: "gemDensity", kind: "range", min: 0.25, max: 2, step: 0.05 },
          { key: "apply", kind: "toggle" }
        ]
      },
      {
        type: "drrules",
        label: "Game Rules",
        defaults: { ...DEFAULT_RULES },
        params: [
          { key: "gemShare", kind: "range", min: 0.05, max: 1, step: 0.05 },
          { key: "pickupRadius", kind: "range", min: 0.4, max: 3, step: 0.1 },
          { key: "allPlayersPortal", kind: "toggle" },
          { key: "disableFlight", kind: "toggle" }
        ]
      },
      {
        type: "drmenu",
        label: "Start Menu",
        defaults: { ...DEFAULT_MENU },
        params: [
          { key: "show", kind: "select", options: ["auto", "always", "never"] },
          { key: "button1", kind: "select", options: ["none", "join-p1", "join-p2", "start", "resume", "new-dungeon"] },
          { key: "button2", kind: "select", options: ["none", "join-p1", "join-p2", "start", "resume", "new-dungeon"] },
          { key: "button3", kind: "select", options: ["none", "join-p1", "join-p2", "start", "resume", "new-dungeon"] },
          { key: "button4", kind: "select", options: ["none", "join-p1", "join-p2", "start", "resume", "new-dungeon"] }
        ]
      },
      {
        type: "drhud",
        label: "Game HUD",
        defaults: { ...DEFAULT_HUD },
        params: [
          { key: "showGems", kind: "toggle" },
          { key: "showLevel", kind: "toggle" },
          { key: "showPlayers", kind: "toggle" },
          { key: "showObjective", kind: "toggle" },
          { key: "corner", kind: "select", options: ["top-left", "top-right", "bottom-left", "bottom-right"] }
        ]
      },
      {
        type: "drprop",
        label: "Prop Counter",
        defaults: { prop: "score", initial: 0, showInHud: true },
        params: [
          { key: "prop", kind: "select", options: ["score", "keys", "skulls", "torches"] },
          { key: "initial", kind: "range", min: 0, max: 100, step: 1 },
          { key: "showInHud", kind: "toggle" }
        ]
      }
    ]
  });
  const assign = (target, next) => {
    let changed = false;
    for (const key of Object.keys(next)) {
      if (target[key] !== next[key]) {
        target[key] = next[key];
        changed = true;
      }
    }
    if (changed) game.markGuiDirty();
  };
  api.registerEffect("drdungeon", (object, base, data) => {
    if (!data.apply) return;
    const seed = Math.round(data.seed ?? 7);
    const params = {
      roomCount: Math.round(data.roomCount ?? 0) || 0,
      levelCount: Math.round(data.levelCount ?? 5),
      gemDensity: data.gemDensity ?? 1
    };
    if (game.state.seed !== seed || JSON.stringify(game.state.params) !== JSON.stringify(params))
      game.generate(seed, params, false);
  });
  api.registerEffect("drrules", (object, base, data) => {
    seen.rules = frame;
    assign(game.config.rules, {
      gemShare: Math.min(1, Math.max(0.05, data.gemShare ?? DEFAULT_RULES.gemShare)),
      pickupRadius: data.pickupRadius ?? DEFAULT_RULES.pickupRadius,
      allPlayersPortal: !!(data.allPlayersPortal ?? DEFAULT_RULES.allPlayersPortal),
      disableFlight: !!(data.disableFlight ?? DEFAULT_RULES.disableFlight)
    });
  });
  api.registerEffect("drmenu", (object, base, data) => {
    seen.menu = frame;
    assign(game.config.menu, {
      show: data.show ?? DEFAULT_MENU.show,
      button1: data.button1 ?? DEFAULT_MENU.button1,
      button2: data.button2 ?? DEFAULT_MENU.button2,
      button3: data.button3 ?? DEFAULT_MENU.button3,
      button4: data.button4 ?? DEFAULT_MENU.button4
    });
  });
  api.registerEffect("drhud", (object, base, data) => {
    seen.hud = frame;
    assign(game.config.hud, {
      showGems: !!(data.showGems ?? true),
      showLevel: !!(data.showLevel ?? true),
      showPlayers: !!(data.showPlayers ?? true),
      showObjective: !!(data.showObjective ?? true),
      corner: data.corner ?? "top-left"
    });
  });
  api.registerEffect("drprop", (object, base, data) => {
    const name = data.prop ?? "score";
    propSeen[name] = frame;
    const existing = game.config.props[name];
    const next = { initial: Math.round(data.initial ?? 0), showInHud: !!(data.showInHud ?? true) };
    if (!existing || existing.initial !== next.initial || existing.showInHud !== next.showInHud) {
      game.config.props[name] = next;
      game.markGuiDirty();
    }
  });
  function tick() {
    frame++;
    if (seen.rules >= 0 && frame - seen.rules > EXPIRE_FRAMES) {
      seen.rules = -1;
      assign(game.config.rules, { ...DEFAULT_RULES });
    }
    if (seen.menu >= 0 && frame - seen.menu > EXPIRE_FRAMES) {
      seen.menu = -1;
      assign(game.config.menu, { ...DEFAULT_MENU });
    }
    if (seen.hud >= 0 && frame - seen.hud > EXPIRE_FRAMES) {
      seen.hud = -1;
      assign(game.config.hud, { ...DEFAULT_HUD });
    }
    for (const [name, at] of Object.entries(propSeen)) {
      if (frame - at > EXPIRE_FRAMES) {
        delete propSeen[name];
        delete game.config.props[name];
        game.markGuiDirty();
      }
    }
  }
  return { tick };
}

// modules/dungeon-realms/src/index.js
var index_default = {
  id: "dungeon-realms",
  name: "Dungeon Realms",
  version: "1.0.0",
  description: "Co-op dungeon crawl: seeded multi-floor generator, gem-gated portals, P1/P2 play \u2014 every rule editable as flow nodes.",
  /** @param {any} api the module SDK surface */
  register(api) {
    const game = createGame(api);
    const nodes = registerNodes(api, game);
    api.registerSystemGroup(GROUP_NAME);
    api.registerInteractiveGroup(GROUP_NAME);
    api.registerMenu("Generate dungeon", () => {
      const seed = hash32(api.now() * 1e3 | 0, "menu") % 1e5;
      if (game.generate(seed, game.state.params ?? {}))
        api.toast("Dungeon Realms seed " + seed + " \u2014 press the red Play button to start");
    });
    api.registerMenu("Clear dungeon", () => {
      game.clear();
      api.send({ op: "clear" });
    });
    api.registerClickHandler((mesh) => {
      let cursor = mesh;
      while (cursor && !cursor.userData?.portal && cursor.name !== "dr-gems") cursor = cursor.parent;
      if (!cursor) return false;
      if (cursor.name === "dr-gems") {
        if (!game.state.started || game.state.wonAt) return true;
        const ray = api.pointerRay();
        const gems = game.group()?.userData._dr?.gemWorld ?? [];
        const set = game.state.collected[game.state.floorIndex] ?? /* @__PURE__ */ new Set();
        const point = new api.THREE.Vector3();
        for (const gem of gems) {
          if (set.has(gem.index)) continue;
          point.set(gem.x, gem.y, gem.z);
          if (ray && ray.ray.distanceToPoint(point) < 0.55) {
            game.collectGem(game.state.floorIndex, gem.index);
            return true;
          }
        }
        return true;
      }
      const portal = cursor.userData.portal;
      if (portal.kind === "down") game.travel(game.state.floorIndex - 1);
      else if (portal.sealed) {
        const { need, have } = game.gemTotals();
        api.toast("Sealed \u2014 collect " + (need - have) + " more gem" + (need - have === 1 ? "" : "s"));
      } else game.travel(game.state.floorIndex + 1);
      return true;
    });
    api.onMessage((data) => game.handleMessage(data));
    api.registerStateSync({
      getState: () => game.getState(),
      applyState: (remote) => game.applyState(remote)
    });
    api.onSceneClear(() => game.clear());
    api.registerFrameTask((time) => {
      nodes.tick();
      game.tick(time);
    });
    if (typeof window !== "undefined") {
      window.addEventListener(
        "keydown",
        (event) => {
          if ((event.code === "KeyQ" || event.code === "KeyE") && game.suppressFlight()) {
            event.preventDefault();
            event.stopImmediatePropagation();
          }
        },
        true
      );
    }
    api.registerBindings([
      { label: "Menu \u2014 select option", keys: "ArrowUp / ArrowDown" },
      { label: "Menu \u2014 confirm", keys: "Enter" }
    ]);
  }
};
export {
  index_default as default
};
