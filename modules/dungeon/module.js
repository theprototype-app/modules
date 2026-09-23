// modules/dungeon/src/gen/rng.js
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
  const rng2 = {
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
  return rng2;
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

// modules/dungeon/src/gen/names.js
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
function dungeonName(rng2) {
  const adjective = rng2.pick(ADJECTIVES);
  const place = rng2.pick(PLACES);
  if (rng2.chance(0.6)) {
    const owner = rng2.pick(SYL_A) + (rng2.chance(0.5) ? "'" : "") + rng2.pick(SYL_B);
    return "The " + adjective + " " + place + " of " + owner;
  }
  return "The " + adjective + " " + place;
}

// modules/dungeon/src/gen/dungeon.js
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
function scatterRooms(rng2, roomCount) {
  const candidates = Math.ceil(roomCount * 1.4);
  const rx = 2.4 * Math.sqrt(roomCount) + 4;
  const ry = rx * 0.72;
  const rooms = [];
  for (let i = 0; i < candidates; i++) {
    let ux = 0, uy = 0;
    do {
      ux = rng2.float(-1, 1);
      uy = rng2.float(-1, 1);
    } while (ux * ux + uy * uy > 1);
    const roll = rng2.next();
    const archetype = roll < 0.45 ? "small" : roll < 0.85 ? "medium" : "large";
    const [lo, hi] = archetype === "small" ? [5, 7] : archetype === "medium" ? [8, 12] : [13, 18];
    const shapeRoll = rng2.next();
    const shape = shapeRoll < 0.6 ? "rect" : shapeRoll < 0.82 ? "ellipse" : "octagon";
    rooms.push({
      id: i,
      archetype,
      shape,
      w: rng2.int(lo, hi),
      h: rng2.int(lo, hi),
      fx: ux * rx,
      // float centers until separation snaps them
      fy: uy * ry
    });
  }
  let larges = rooms.filter((r) => r.archetype === "large").length;
  for (let i = rooms.length - 1; i >= 0 && larges < 2; i--) {
    if (rooms[i].archetype === "large") continue;
    rooms[i].archetype = "large";
    rooms[i].w = rng2.int(13, 18);
    rooms[i].h = rng2.int(13, 18);
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
function buildGraph(centers, delaunay, rng2, loopChance) {
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
    if (rng2.chance(loopChance)) {
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
function assignSemantics(rooms, edges, rng2) {
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
  const shrineCount = Math.min(shrineCandidates.length, rng2.int(1, 2));
  for (let k = 0; k < shrineCount; k++) {
    const pickIndex = rng2.int(0, shrineCandidates.length - 1);
    rooms[shrineCandidates[pickIndex]].type = "shrine";
    shrineCandidates.splice(pickIndex, 1);
  }
  const eliteCandidates = rooms.map((r, i) => i).filter((i) => rooms[i].type === "combat" && critical.has(i) && rooms[i].archetype !== "small" && fromEntrance[i] >= 0.55 * maxDepth && fromEntrance[i] <= 0.85 * maxDepth);
  const eliteCount = Math.min(eliteCandidates.length, rng2.int(1, 2));
  for (let k = 0; k < eliteCount; k++) {
    const pickIndex = rng2.int(0, eliteCandidates.length - 1);
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
function rasterize(rooms, edges, semantics, rng2) {
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
      const horizontalFirst = rng2.chance(0.5);
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
function decorate(rooms, raster, semantics, params, rng2) {
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
      const cell = cells.splice(rng2.int(0, cells.length - 1), 1)[0];
      place("debris", cell.x, cell.y, room.id, { rot: rng2.float(0, 6.283), scale: rng2.float(0.5, 1.1) });
    }
  });
  rooms.forEach((room) => {
    if (room.type !== "combat") return;
    const cells = freeCells(room, (x, y) => wallAdjacent(x, y) && !doorwayNear(x, y, 2));
    const count = Math.min(cells.length, Math.max(0, Math.round(rng2.int(2, 4) * params.decorDensity)));
    for (let k = 0; k < count && cells.length; k++) {
      const cell = cells.splice(rng2.int(0, cells.length - 1), 1)[0];
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
        const cell = cells[rng2.int(0, cells.length - 1)];
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
  const gemRng = rng2.fork("gems");
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
  const spawnRng = rng2.fork("spawns");
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
    const rng2 = makeRng(attemptSeed);
    const rooms = separateRooms(scatterRooms(rng2.fork("rooms"), merged.roomCount), merged.roomCount);
    const centers = rooms.map((r) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 }));
    const { edges, loops } = buildGraph(centers, delaunayEdges(centers), rng2.fork("graph"), merged.loopChance);
    const semantics = assignSemantics(rooms, edges, rng2.fork("semantics"));
    const raster = rasterize(rooms, edges, semantics, rng2.fork("carve"));
    const { props, spawns } = decorate(rooms, raster, semantics, merged, rng2.fork("decor"));
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
      name: dungeonName(rng2.fork("name")),
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

// modules/dungeon/src/gen/bestiary.js
var BESTIARY = [
  { id: "spider", floors: [1, 2], weight: 10 },
  { id: "bat", floors: [1, 3], weight: 8 },
  { id: "slime", floors: [2, 3], weight: 8 },
  { id: "skeleton", floors: [2, 4], weight: 9 },
  { id: "goblin", floors: [3, 4], weight: 8 },
  { id: "wraith", floors: [3, 5], weight: 6 },
  { id: "golem", floors: [4, 5], weight: 4 }
];

// modules/dungeon/src/gen/campaign.js
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
function typeSpawns(dungeon, floorIndex, bestiaryTable, rng2) {
  const legal = bestiaryTable.filter((b) => floorIndex >= b.floors[0] && floorIndex <= b.floors[1]);
  if (!legal.length) return;
  const total = legal.reduce((s, b) => s + b.weight, 0);
  dungeon.spawns.forEach((spawn) => {
    let roll = rng2.float(0, total);
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
      const slot = dungeon.spawns[rng2.int(0, dungeon.spawns.length - 1)];
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

// modules/dungeon/src/look.js
var LOOK = {
  /** the floor tiles' TOP, a hair above the editor grid (which draws at y = 0) */
  floorTop: 0.015,
  /** lifts applied to the theme tints (the themes were authored for a black void) */
  floorLift: 1.5,
  wallLift: 1.9,
  /** every theme tint is pulled this far toward a warm stone grey before the lift, so a crypt
   * reads as stone lit by torches rather than a flat green-teal */
  stone: 9208436,
  stoneMix: 0.45,
  wallRoughness: 0.78,
  /** flames: emissive over 1 so the bloom pass picks them up */
  flameIntensity: 3.2,
  /** point lights per floor — CAPPED (the frame budget). P4: four, and in play they follow the
   * player to the nearest torches, so four light the torches around you (paired fps runs: 5 fell under 90%) */
  lightBudget: 4,
  lightIntensity: 18,
  lightDistance: 10,
  /** P4: the ceiling (play only — a single-sided plane facing DOWN: invisible from above, a dark
   * vault from inside) and the torch props */
  ceilingY: 2.32,
  vaultMargin: 30,
  ceilingTint: 2762274,
  textureSize: 128,
  /** seconds between re-assigning the capped lights to the torches nearest the player */
  lightReassign: 0.25,
  /** minimum Rec.709 luma (0..1, sRGB) a lifted wall tint must reach */
  minWallLuma: 0.35
};
function mix(hex, to, t) {
  const c = (shift) => Math.round((hex >> shift & 255) * (1 - t) + (to >> shift & 255) * t);
  return c(16) << 16 | c(8) << 8 | c(0);
}
function stoneTint(hex, k) {
  return lift(mix(hex, LOOK.stone, LOOK.stoneMix), k);
}
function lift(hex, k) {
  const c = (shift) => Math.min(255, Math.round((hex >> shift & 255) * k));
  return c(16) << 16 | c(8) << 8 | c(0);
}
function pickLights(spots, focus, budget, near = 3) {
  if (budget <= 0 || !spots.length) return [];
  const order = spots.map((_, i) => i);
  const first = focus ? [...order].sort((a, b) => Math.hypot(spots[a].x - focus.x, spots[a].z - focus.z) - Math.hypot(spots[b].x - focus.x, spots[b].z - focus.z) || a - b).slice(0, Math.min(near, budget)) : [];
  const rest = order.filter((i) => !first.includes(i));
  const left = Math.min(budget - first.length, rest.length);
  const spread = [];
  for (let k = 0; k < left; k++) spread.push(rest[Math.floor(k * rest.length / left)]);
  return [...first, ...spread];
}
function flameFlicker(time, x, z) {
  return 1 + Math.sin(time * 11 + x * 2.3) * 0.12 + Math.sin(time * 27 + z * 3.1) * 0.07;
}
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = a + 1831565813 >>> 0;
    let t = a;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function stoneLayout(kind, size, seed) {
  const r = rng(seed ^ (kind === "brick" ? 177 : 241));
  const rows = kind === "brick" ? 4 : 3;
  const cuts = (n, jitter) => {
    const c = [0];
    for (let i = 1; i < n; i++) c.push(Math.round((i / n + (r() - 0.5) * jitter / n) * size));
    c.push(size);
    return c;
  };
  const rowCut = cuts(rows, kind === "brick" ? 0.3 : 0.5);
  const course = Array.from({ length: rows }, () => {
    const n = kind === "brick" ? 2 + (r() < 0.5 ? 1 : 0) : 3;
    const joints = cuts(n, 0.6).slice(0, -1);
    const offset = Math.floor(r() * size);
    return { joints: joints.map((j) => (j + offset) % size).sort((a, b) => a - b), shade: joints.map(() => 0.62 + r() * 0.38) };
  });
  return { r, rowCut, course };
}
function stoneTexture(kind, size = LOOK.textureSize, seed = 356371) {
  const { r, rowCut, course } = stoneLayout(kind, size, seed);
  const out = new Uint8Array(size * size * 4);
  const G = 8;
  const grime = Array.from({ length: G * G }, () => r());
  const blotch = (x, y) => {
    const gx = x / size * G, gy = y / size * G;
    const x0 = Math.floor(gx), y0 = Math.floor(gy), fx = gx - x0, fy = gy - y0;
    const at = (i, j) => grime[(j % G + G) % G * G + (i % G + G) % G];
    return (at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx) * (1 - fy) + (at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx) * fy;
  };
  const mortar = Math.max(1, Math.round(size / 64));
  for (let y = 0; y < size; y++) {
    let row = 0;
    while (y >= rowCut[row + 1]) row++;
    const c = course[row];
    const dy = Math.min(y - rowCut[row], rowCut[row + 1] - 1 - y);
    for (let x = 0; x < size; x++) {
      let k = c.joints.length - 1;
      for (let j = 0; j < c.joints.length; j++) if (x >= c.joints[j]) k = j;
      let dx = size;
      for (const j of c.joints) dx = Math.min(dx, Math.abs(x - j), size - Math.abs(x - j));
      const edge = Math.min(dx, dy);
      let v;
      if (edge < mortar) v = 0.5 + r() * 0.08;
      else {
        v = c.shade[k];
        v *= 1 - Math.max(0, 2 - (edge - mortar)) * 0.06;
        v *= 0.9 + r() * 0.16;
      }
      v *= 0.82 + blotch(x, y) * 0.3;
      const b = Math.max(0, Math.min(255, Math.round(v * 255)));
      const i = (y * size + x) * 4;
      out[i] = out[i + 1] = out[i + 2] = b;
      out[i + 3] = 255;
    }
  }
  return out;
}
var LIT = {
  /** how far (cells) a torch's baked light reaches */
  bakeRadius: 5,
  /** a flood walks at most this many cells, so light turns a corner but does not wander round a room */
  bakeSteps: 8,
  /** floor/wall shade = base + gain * light (light 0..1) */
  bakeBase: 0.7,
  bakeGain: 0.45,
  /** the baked light as EMISSIVE (render.js torchLit): albedo x torch colour x light x gain */
  emissiveFloor: 0.55,
  emissiveWall: 0.7,
  /** how much of the torch colour a fully lit cell takes on */
  bakeWarm: 0.35,
  /** the halo on the wall behind a flame and the pool on the floor in front of it (metres) */
  haloSize: 2.4,
  haloY: 1.65,
  /** a sconce's bowl + flame stand this far from the wall cell's centre (the face is at 0.5) */
  sconceOut: 0.64,
  haloOpacity: 0.55,
  poolSize: 3.2,
  poolOut: 1.1,
  poolOpacity: 0.3,
  haloTextureSize: 64,
  /** seconds a real light takes to fade out of one torch or into the next */
  lightFade: 0.35,
  /** a torch that holds a light counts this much nearer, so two torches at almost the same
   * distance do not trade the light back and forth every frame */
  lightStickiness: 0.75
};
function bakeTorchLight(grid, W, H, torches, opts = {}) {
  const FLOOR_V = opts.floor ?? 1;
  const WALL_V = opts.wall ?? 2;
  const radius = opts.radius ?? LIT.bakeRadius;
  const steps = opts.steps ?? LIT.bakeSteps;
  const light = new Float32Array(W * H);
  const seen = new Int32Array(W * H).fill(-1);
  const queue = new Int32Array(W * H);
  torches.forEach((t, id) => {
    const sx = t.x + (t.fx ?? 0), sy = t.y + (t.fy ?? 0);
    if (sx < 0 || sy < 0 || sx >= W || sy >= H || grid[sy * W + sx] !== FLOOR_V) return;
    const lx = t.x + 0.5 + (t.fx ?? 0) * 0.6, ly = t.y + 0.5 + (t.fy ?? 0) * 0.6;
    const depth = /* @__PURE__ */ new Map();
    let head = 0, tail = 0;
    queue[tail++] = sy * W + sx;
    seen[sy * W + sx] = id;
    depth.set(sy * W + sx, 0);
    while (head < tail) {
      const i = queue[head++];
      const x = i % W, y = i / W | 0;
      const d = Math.hypot(x + 0.5 - lx, y + 0.5 - ly);
      const w = Math.max(0, 1 - d / radius);
      const add = w * w * (3 - 2 * w);
      light[i] = 1 - (1 - light[i]) * (1 - add);
      const k = depth.get(i) ?? 0;
      if (k >= steps) continue;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const j = ny * W + nx;
        if (seen[j] === id || grid[j] !== FLOOR_V) continue;
        seen[j] = id;
        depth.set(j, k + 1);
        queue[tail++] = j;
      }
    }
  });
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (grid[i] !== WALL_V) continue;
      let best = 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        if (grid[ny * W + nx] === FLOOR_V) best = Math.max(best, light[ny * W + nx]);
      }
      light[i] = best;
    }
  return light;
}
function litShade(light) {
  return LIT.bakeBase + LIT.bakeGain * light;
}
function haloTexture(size = LIT.haloTextureSize) {
  const out = new Uint8Array(size * size * 4);
  const c = (size - 1) / 2;
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const r = Math.min(1, Math.hypot(x - c, y - c) / c);
      const v = Math.pow(1 - r, 2.2);
      const b = Math.round(v * 255);
      const i = (y * size + x) * 4;
      out[i] = out[i + 1] = out[i + 2] = b;
      out[i + 3] = 255;
    }
  return out;
}
function stepLightSlots(slots, spots, focus, dt) {
  if (!slots.length || !spots.length) return slots;
  const rate = Math.max(0, dt) / LIT.lightFade;
  let wanted;
  if (focus) {
    const held = new Set(slots.map((s) => s.torch));
    wanted = spots.map((p, i) => ({ i, d: Math.hypot(p.x - focus.x, p.z - focus.z) - (held.has(i) ? LIT.lightStickiness : 0) })).sort((a, b) => a.d - b.d || a.i - b.i).slice(0, slots.length).map((e) => e.i);
  } else wanted = slots.map((s) => s.torch).filter((t) => t >= 0);
  const want = new Set(wanted);
  for (const s of slots) {
    if (s.torch >= 0 && want.has(s.torch)) s.w = Math.min(1, s.w + rate);
    else {
      s.w = Math.max(0, s.w - rate);
      if (s.w === 0) s.torch = -1;
    }
  }
  const holding = new Set(slots.map((s) => s.torch));
  const free = wanted.filter((t) => !holding.has(t));
  for (const s of slots) if (s.torch < 0 && free.length) s.torch = /** @type {number} */
  free.shift();
  return slots;
}

// modules/dungeon/src/render.js
var textures = null;
function stoneTextures(THREE) {
  if (textures) return textures;
  const make = (kind) => {
    const t = new THREE.DataTexture(stoneTexture(kind), LOOK.textureSize, LOOK.textureSize);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.magFilter = THREE.LinearFilter;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.generateMipmaps = true;
    t.colorSpace = THREE.SRGBColorSpace;
    t.needsUpdate = true;
    return t;
  };
  textures = { brick: make("brick"), flag: make("flag") };
  const halo = new THREE.DataTexture(haloTexture(), LIT.haloTextureSize, LIT.haloTextureSize);
  halo.magFilter = THREE.LinearFilter;
  halo.minFilter = THREE.LinearFilter;
  halo.needsUpdate = true;
  textures.halo = halo;
  return textures;
}
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
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  return geometry;
}
function torchLit(THREE, material, torchColor, gain) {
  const uniform = { value: new THREE.Vector4() };
  const c = new THREE.Color(torchColor);
  uniform.value.set(c.r * gain, c.g * gain, c.b * gain, 1);
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTorch = uniform;
    shader.vertexShader = shader.vertexShader.replace("#include <common>", "#include <common>\nattribute float torchLight;\nvarying float vTorchLight;").replace("#include <begin_vertex>", "#include <begin_vertex>\nvTorchLight = torchLight;");
    shader.fragmentShader = shader.fragmentShader.replace("#include <common>", "#include <common>\nuniform vec4 uTorch;\nvarying float vTorchLight;").replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * uTorch.rgb * (vTorchLight * uTorch.w);");
  };
  material.customProgramCacheKey = () => "dk-torch-lit";
  material.userData.torch = uniform;
  return material;
}
function setTorchLight(THREE, mesh, values) {
  mesh.geometry.setAttribute("torchLight", new THREE.InstancedBufferAttribute(values, 1));
}
function cellNoise(x, y, seed, amp = 0.05) {
  let h = (Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ seed) >>> 0;
  h = Math.imul(h ^ h >>> 13, 1540483477) >>> 0;
  return 1 - amp + (h & 65535) / 65535 * amp * 2;
}
function buildFloorGroup(THREE, dungeon) {
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
  const torchProps = props.filter((p) => p.kind === "torch");
  const baked = bakeTorchLight(grid, W, H, torchProps, { floor: FLOOR, wall: WALL });
  const warm = new THREE.Color(theme.torchColor);
  const white = new THREE.Color(1, 1, 1);
  const tint = new THREE.Color();
  const bake = (i) => {
    const light = baked[i];
    tint.copy(white).lerp(warm, LIT.bakeWarm * light).multiplyScalar(litShade(light));
    color.multiply(tint);
  };
  let floorCount = 0, wallCount = 0;
  for (let i = 0; i < grid.length; i++) {
    if (grid[i] === FLOOR) floorCount++;
    else if (grid[i] === WALL) wallCount++;
  }
  const tex = stoneTextures(THREE);
  const floorMesh = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1, 0.2, 1),
    // matte stone: Lambert (the floor and the vault fill most of the frame — per-pixel cost)
    torchLit(THREE, new THREE.MeshLambertMaterial({ color: 16777215, map: tex.flag }), theme.torchColor, LIT.emissiveFloor),
    floorCount
  );
  floorMesh.name = "dk-floors";
  const wallMesh = new THREE.InstancedMesh(
    footShade(THREE, new THREE.BoxGeometry(1, 1, 1), 0.55),
    torchLit(THREE, new THREE.MeshStandardMaterial({ color: 16777215, roughness: LOOK.wallRoughness, map: tex.brick, bumpMap: tex.brick, bumpScale: 1.8, vertexColors: true }), theme.torchColor, LIT.emissiveWall),
    wallCount
  );
  wallMesh.name = "dk-walls";
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
        matrix.makeTranslation(worldX(x), LOOK.floorTop - 0.1, worldZ(y));
        floorMesh.setMatrixAt(floorIndex, matrix);
        const roomId = roomOf[y * W + x];
        const tint2 = stoneTint(roomId >= 0 ? theme.floorTints[roomId % theme.floorTints.length] : theme.corridorTint, LOOK.floorLift);
        const ao = 1 - 0.09 * Math.min(wallsAround(x, y), 4);
        color.setHex(tint2).multiplyScalar(ao * cellNoise(x, y, dungeon.stats.seed, 0.12) * (roomId >= 0 ? 1 : 0.9));
        bake(y * W + x);
        floorLight[floorIndex] = baked[y * W + x];
        floorMesh.setColorAt(floorIndex, color);
        floorIndex++;
      } else if (cell === WALL) {
        const height = 2 + (cellNoise(x, y, dungeon.stats.seed ^ 24301, 0.125) - 1) * 2;
        position.set(worldX(x), height / 2, worldZ(y));
        scale.set(1, height, 1);
        matrix.compose(position, quaternion, scale);
        wallMesh.setMatrixAt(wallIndex, matrix);
        color.setHex(stoneTint(theme.wallTint, LOOK.wallLift)).multiplyScalar(cellNoise(x, y, dungeon.stats.seed ^ 2577, 0.16));
        color.r *= cellNoise(x, y, dungeon.stats.seed ^ 3073, 0.05);
        color.b *= cellNoise(x, y, dungeon.stats.seed ^ 3074, 0.05);
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
  const VW = W + LOOK.vaultMargin * 2;
  const VH = H + LOOK.vaultMargin * 2;
  const vault = new THREE.PlaneGeometry(VW, VH);
  const uv = vault.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * VW, uv.getY(i) * VH);
  const ceiling = new THREE.Mesh(vault, new THREE.MeshLambertMaterial({ color: LOOK.ceilingTint, map: tex.brick }));
  ceiling.name = "dk-ceiling";
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.set(ox + W / 2, LOOK.ceilingY, oy + H / 2);
  ceiling.visible = false;
  group.add(ceiling);
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
  const propLit = (mesh, list) => {
    if (mesh && list?.length) setTorchLight(THREE, mesh, Float32Array.from(list.map((p) => baked[p.y * W + p.x])));
    return mesh;
  };
  const pillars = instanced(
    "dk-pillars",
    footShade(THREE, new THREE.CylinderGeometry(0.3, 0.38, 2.4, 8), 0.5),
    torchLit(THREE, new THREE.MeshStandardMaterial({ color: stoneTint(theme.wallTint, LOOK.wallLift), roughness: 0.8, map: tex.brick, vertexColors: true }), theme.torchColor, LIT.emissiveWall),
    byKind.pillar,
    (p) => position.set(worldX(p.x), 1.2, worldZ(p.y))
  );
  if (pillars) setTorchLight(THREE, pillars, Float32Array.from(byKind.pillar.map((p) => baked[p.y * W + p.x])));
  propLit(instanced(
    "dk-debris",
    new THREE.BoxGeometry(0.32, 0.22, 0.32),
    torchLit(THREE, new THREE.MeshStandardMaterial({ color: stoneTint(theme.corridorTint, LOOK.floorLift), roughness: 1, map: tex.brick }), theme.torchColor, LIT.emissiveWall),
    byKind.debris,
    (p) => {
      position.set(worldX(p.x), 0.1, worldZ(p.y));
      quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.rot ?? 0);
      scale.setScalar(p.scale ?? 1);
    }
  ), byKind.debris);
  quaternion.identity();
  scale.set(1, 1, 1);
  propLit(instanced(
    "dk-crates",
    new THREE.BoxGeometry(0.72, 0.72, 0.72),
    torchLit(THREE, new THREE.MeshStandardMaterial({ color: 9071165, roughness: 0.9 }), theme.torchColor, LIT.emissiveWall),
    byKind.crate,
    (p) => position.set(worldX(p.x), 0.36, worldZ(p.y))
  ), byKind.crate);
  propLit(instanced(
    "dk-braziers",
    new THREE.CylinderGeometry(0.3, 0.2, 0.55, 8),
    torchLit(THREE, new THREE.MeshStandardMaterial({ color: 2894900, roughness: 0.6, metalness: 0.4 }), theme.torchColor, LIT.emissiveWall),
    byKind.brazier,
    (p) => position.set(worldX(p.x), 0.28, worldZ(p.y))
  ), byKind.brazier);
  propLit(instanced(
    "dk-chests",
    new THREE.BoxGeometry(0.85, 0.55, 0.6),
    torchLit(THREE, new THREE.MeshStandardMaterial({ color: 11569710, roughness: 0.5, metalness: 0.3 }), theme.torchColor, LIT.emissiveWall),
    byKind.chest,
    (p) => position.set(worldX(p.x), 0.28, worldZ(p.y))
  ), byKind.chest);
  instanced(
    "dk-crystals",
    new THREE.OctahedronGeometry(0.42, 0),
    new THREE.MeshStandardMaterial({ color: theme.gemColor, emissive: theme.gemColor, emissiveIntensity: 1.6, roughness: 0.3 }),
    byKind.crystal,
    (p) => {
      position.set(worldX(p.x), 1, worldZ(p.y));
      scale.set(1, 1.7, 1);
    }
  );
  scale.set(1, 1, 1);
  instanced(
    "dk-rings",
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
  const onWall = (p, out) => ({ x: worldX(p.x) + (p.fx ?? 0) * out, z: worldZ(p.y) + (p.fy ?? 0) * out });
  instanced(
    "dk-torch-brackets",
    new THREE.BoxGeometry(0.09, 0.42, 0.09),
    new THREE.MeshStandardMaterial({ color: 2762016, roughness: 0.55, metalness: 0.6 }),
    torches,
    (p) => {
      const w = onWall(p, 0.54);
      position.set(w.x, 1.5, w.z);
    }
  );
  instanced(
    "dk-torch-bowls",
    new THREE.CylinderGeometry(0.13, 0.06, 0.12, 10),
    new THREE.MeshStandardMaterial({ color: 4864552, roughness: 0.45, metalness: 0.7 }),
    torches,
    (p) => {
      const w = onWall(p, LIT.sconceOut);
      position.set(w.x, 1.74, w.z);
    }
  );
  const flameSpots = torches.map((p) => ({ ...onWall(p, LIT.sconceOut), y: 1.95 })).concat((byKind.brazier ?? []).map((p) => ({ x: worldX(p.x), y: 0.75, z: worldZ(p.y) })));
  const flames = instanced(
    "dk-flames",
    new THREE.ConeGeometry(0.15, 0.46, 7),
    new THREE.MeshStandardMaterial({ color: theme.torchColor, emissive: theme.torchColor, emissiveIntensity: LOOK.flameIntensity, roughness: 1 }),
    flameSpots,
    (p) => position.set(p.x, p.y, p.z)
  );
  if (flames) flames.userData.spots = flameSpots;
  const cores = instanced(
    "dk-flame-cores",
    new THREE.ConeGeometry(0.07, 0.24, 6),
    new THREE.MeshBasicMaterial({ color: 16773576 }),
    flameSpots,
    (p) => position.set(p.x, p.y - 0.06, p.z)
  );
  if (cores) cores.userData.spots = flameSpots.map((p) => ({ ...p, y: p.y - 0.06 }));
  const haloMat = () => new THREE.MeshBasicMaterial({ color: 16777215, map: tex.halo, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
  const facingY = new THREE.Vector3(0, 1, 0);
  const halos = instanced("dk-halos", new THREE.PlaneGeometry(LIT.haloSize, LIT.haloSize), haloMat(), torches, (p) => {
    const w = onWall(p, 0.505);
    position.set(w.x, LIT.haloY, w.z);
    quaternion.setFromAxisAngle(facingY, Math.atan2(p.fx ?? 0, p.fy ?? 0));
  });
  quaternion.identity();
  const poolSpots = torches.map((p) => ({ ...onWall(p, 0.5 + LIT.poolOut) })).concat((byKind.brazier ?? []).map((p) => ({ x: worldX(p.x), z: worldZ(p.y) })));
  const pools = instanced("dk-pools", new THREE.PlaneGeometry(LIT.poolSize, LIT.poolSize), haloMat(), poolSpots, (p) => {
    position.set(p.x, LOOK.floorTop + 4e-3, p.z);
    quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
  });
  quaternion.identity();
  for (const [mesh, spots, opacity] of [[halos, torches.map((p) => onWall(p, LIT.sconceOut)), LIT.haloOpacity], [pools, poolSpots, LIT.poolOpacity]]) {
    if (!mesh) continue;
    mesh.renderOrder = 2;
    mesh.userData.flicker = { spots, opacity };
    spots.forEach((_, i) => mesh.setColorAt(i, color.set(theme.torchColor).multiplyScalar(opacity)));
  }
  const entrance = rooms.find((r) => r.type === "entrance");
  const focus = entrance ? { x: entrance.x + ox + entrance.w / 2, z: entrance.y + oy + entrance.h / 2 } : null;
  const slots = [];
  for (const i of pickLights(flameSpots, focus, LOOK.lightBudget)) {
    const spot = flameSpots[i];
    const light = new THREE.PointLight(theme.torchColor, LOOK.lightIntensity, LOOK.lightDistance, 2);
    light.name = "dk-light";
    light.position.set(spot.x, spot.y + 0.25, spot.z);
    light.userData.slot = slots.length;
    slots.push({ torch: i, w: 1 });
    group.add(light);
  }
  const torchUniforms = [];
  group.traverse((o) => {
    if (o.material?.userData?.torch) torchUniforms.push(o.material.userData.torch);
  });
  group.userData._dk = { theme, flameSpots, slots, lastTime: -1, baked, torchUniforms };
  return group;
}
function animateFloor(group, time, view = {}) {
  const dk = group.userData._dk;
  const dt = dk && dk.lastTime >= 0 ? Math.min(0.1, Math.max(0, time - dk.lastTime)) : 0;
  if (dk) dk.lastTime = time;
  if (dk?.slots?.length && dk.flameSpots?.length) stepLightSlots(dk.slots, dk.flameSpots, view.player ?? null, dt);
  if (dk?.torchUniforms) for (const u of dk.torchUniforms) u.value.w = 1 + Math.sin(time * 7.3) * 0.04 + Math.sin(time * 17.9) * 0.03;
  group.children.forEach((child) => {
    if (child.name === "dk-light") {
      const slot = dk?.slots?.[child.userData.slot];
      const spot = slot && slot.torch >= 0 ? dk.flameSpots[slot.torch] : null;
      if (spot) child.position.set(spot.x, spot.y + 0.25, spot.z);
      const w = slot ? slot.w : 1;
      child.intensity = LOOK.lightIntensity * w * (1 + Math.sin(time * 9 + child.position.x * 3.7) * 0.18 + Math.sin(time * 23 + child.position.z * 5.1) * 0.1);
    } else if (child.name === "dk-ceiling") child.visible = !!view.playing;
    else if ((child.name === "dk-flames" || child.name === "dk-flame-cores") && child.userData.spots) {
      const m = child.userData._m ??= child.matrix.clone();
      child.userData.spots.forEach((p, i) => {
        const k = flameFlicker(time, p.x, p.z);
        m.makeScale(1 / Math.sqrt(k), k, 1 / Math.sqrt(k)).setPosition(p.x, p.y + (k - 1) * 0.15, p.z);
        child.setMatrixAt(i, m);
      });
      child.instanceMatrix.needsUpdate = true;
    } else if ((child.name === "dk-halos" || child.name === "dk-pools") && child.userData.flicker && child.instanceColor) {
      const { spots, opacity } = child.userData.flicker;
      const c = child.userData._c ??= child.material.color.clone().set(dk?.theme?.torchColor ?? 16747578);
      const arr = child.instanceColor.array;
      spots.forEach((p, i) => {
        const k = opacity * (0.55 + 0.45 * flameFlicker(time, p.x, p.z));
        arr[i * 3] = c.r * k;
        arr[i * 3 + 1] = c.g * k;
        arr[i * 3 + 2] = c.b * k;
      });
      child.instanceColor.needsUpdate = true;
    }
  });
}

// modules/dungeon/src/contract.js
var GROUP_NAME = "dungeon-module";
var CONTRACT_VERSION = 2;
var BLOCKED = 3;
var SOLID = {
  pillar: { hx: 0.38, hz: 0.38, h: 2.4 },
  crate: { hx: 0.36, hz: 0.36, h: 0.72 },
  chest: { hx: 0.43, hz: 0.3, h: 0.55 },
  brazier: { hx: 0.3, hz: 0.3, h: 0.55 }
};
var WALL_HEIGHT = 2.3;
function spawnCell(room) {
  return { x: Math.floor(room.x + room.w / 2), y: Math.floor(room.y + room.h / 2) };
}
function walkGrid(dungeon) {
  const { W, grid, rooms, props } = dungeon;
  const out = Uint8Array.from(grid);
  const keep = new Set(rooms.map((r) => {
    const c = spawnCell(r);
    return c.y * W + c.x;
  }));
  for (const p of props) {
    if (!SOLID[p.kind]) continue;
    const i = p.y * W + p.x;
    if (out[i] === FLOOR && !keep.has(i)) out[i] = BLOCKED;
  }
  return out;
}
function colliderBoxes(dungeon) {
  const { W, H, grid, props, ox, oy } = dungeon;
  let open = /* @__PURE__ */ new Map();
  const boxes = [];
  const close = (r) => boxes.push({ min: [r.x0 + ox, 0, r.y0 + oy], max: [r.x1 + 1 + ox, WALL_HEIGHT, r.y1 + 1 + oy], kind: "wall" });
  for (let y = 0; y < H; y++) {
    const next = /* @__PURE__ */ new Map();
    let x = 0;
    while (x < W) {
      if (grid[y * W + x] !== WALL) {
        x++;
        continue;
      }
      let x1 = x;
      while (x1 + 1 < W && grid[y * W + x1 + 1] === WALL) x1++;
      const key = x + ":" + x1;
      const run = open.get(key);
      if (run) {
        run.y1 = y;
        open.delete(key);
        next.set(key, run);
      } else next.set(key, { x0: x, x1, y0: y, y1: y });
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
function spawnOrderedRooms(dungeon) {
  return [...dungeon.rooms].sort((a, b) => {
    const ka = a.type === "entrance" ? -1 : a.depth;
    const kb = b.type === "entrance" ? -1 : b.depth;
    return ka - kb || a.id - b.id;
  }).map((room) => worldRoom(room, dungeon.ox, dungeon.oy));
}
function playPayload(campaign, floorIndex, extras = {}) {
  const dungeon = campaign.floors[floorIndex - 1];
  if (!dungeon) return null;
  const { ox, oy } = dungeon;
  const wx = (x) => x + ox + 0.5;
  const wz = (y) => y + oy + 0.5;
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
function mergeMarkers(byOwner) {
  const out = [];
  for (const owner of Object.keys(byOwner).sort()) {
    for (const marker of byOwner[owner] ?? []) {
      if (typeof marker?.x === "number" && typeof marker?.z === "number")
        out.push({ x: marker.x, z: marker.z, kind: String(marker.kind ?? "marker") });
    }
  }
  return out;
}
function normalizeParams(params = {}) {
  const out = {};
  if (params.roomCount != null) out.roomCount = Math.max(0, Math.min(60, Math.round(Number(params.roomCount) || 0)));
  if (params.loopChance != null) out.loopChance = Math.max(0, Math.min(1, Number(params.loopChance) || 0));
  if (params.levelCount != null) out.levelCount = Math.max(1, Math.min(9, Math.round(Number(params.levelCount) || 1)));
  if (params.gemDensity != null) out.gemDensity = Math.max(0.25, Math.min(2, Number(params.gemDensity) || 1));
  if (params.decorDensity != null) out.decorDensity = Math.max(0, Math.min(2, Number(params.decorDensity) || 0));
  if (params.theme != null) out.theme = String(params.theme);
  return out;
}

// modules/dungeon/src/kit.js
function createKit(api) {
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
    floorIndex: 1
  };
  const markersByOwner = {};
  let grounded = null;
  let floorGroup = null;
  const listeners = [];
  const currentFloor = () => state.campaign?.floors[state.floorIndex - 1] ?? null;
  function group() {
    const scene = api.scene();
    if (!scene) return null;
    let existing = scene.getObjectByName(GROUP_NAME);
    if (!existing) {
      existing = new THREE.Group();
      existing.name = GROUP_NAME;
      scene.add(existing);
    }
    if (existing.userData.kit !== kit) existing.userData.kit = kit;
    return existing;
  }
  function disposeFloor() {
    if (!floorGroup) return;
    floorGroup.traverse((child) => {
      child.geometry?.dispose?.();
      if (child.material && !Array.isArray(child.material)) child.material.dispose?.();
    });
    floorGroup.parent?.remove(floorGroup);
    floorGroup = null;
  }
  function notify() {
    listeners.forEach((fn) => {
      try {
        fn();
      } catch {
      }
    });
  }
  function publish() {
    const g = group();
    if (!g) return;
    const play = state.campaign ? playPayload(state.campaign, state.floorIndex, { grounded, markers: mergeMarkers(markersByOwner) }) : null;
    if (play) {
      const dungeon = currentFloor();
      g.userData.play = play;
      g.userData.seed = state.seed;
      g.userData.params = state.params;
      g.userData.floorIndex = state.floorIndex;
      g.userData.levelCount = state.campaign.floors.length;
      g.userData.checksum = dungeon.checksum;
      g.userData.campaignChecksum = state.campaign.checksum;
      g.userData.name = dungeon.name;
      g.userData.stats = dungeon.stats;
    } else {
      delete g.userData.play;
      delete g.userData.seed;
      delete g.userData.params;
      delete g.userData.floorIndex;
      delete g.userData.levelCount;
      delete g.userData.checksum;
      delete g.userData.campaignChecksum;
      delete g.userData.name;
      delete g.userData.stats;
    }
    notify();
  }
  function rebuild() {
    disposeFloor();
    const g = group();
    const dungeon = currentFloor();
    if (g && dungeon) {
      floorGroup = buildFloorGroup(THREE, dungeon);
      floorGroup.name = "dk-floor";
      g.add(floorGroup);
    }
    publish();
  }
  function generate(seed, params = {}, opts = {}) {
    const clean = normalizeParams(params);
    let campaign;
    try {
      campaign = generateCampaign(seed >>> 0, clean);
    } catch (error) {
      api.toast("Dungeon generation failed: " + error.message);
      return false;
    }
    state.seed = seed >>> 0;
    state.params = clean;
    state.campaign = campaign;
    state.floorIndex = 1;
    for (const owner of Object.keys(markersByOwner)) delete markersByOwner[owner];
    rebuild();
    if (opts.broadcast !== false) api.send({ op: "generate", seed: state.seed, params: clean, checksum: campaign.checksum });
    return true;
  }
  function applyRemoteGenerate(data) {
    const same = data.seed === state.seed && JSON.stringify(normalizeParams(data.params ?? {})) === JSON.stringify(state.params);
    if (same && state.campaign) return;
    if (!generate(data.seed, data.params ?? {}, { broadcast: false })) return;
    if (data.checksum && data.checksum !== state.campaign.checksum)
      api.toast("Dungeon checksum differs from the sender \u2014 module versions may not match");
  }
  function showFloor(target, opts = {}) {
    const levels = state.campaign?.floors.length ?? 0;
    target = Math.round(Number(target));
    if (!levels || !(target >= 1) || target > levels) return false;
    if (target === state.floorIndex) return true;
    state.floorIndex = target;
    for (const owner of Object.keys(markersByOwner)) delete markersByOwner[owner];
    rebuild();
    if (opts.broadcast !== false) api.send({ op: "floor", floorIndex: target });
    return true;
  }
  function clear(opts = {}) {
    disposeFloor();
    state.campaign = null;
    state.seed = null;
    state.params = {};
    state.floorIndex = 1;
    for (const owner of Object.keys(markersByOwner)) delete markersByOwner[owner];
    publish();
    if (opts.broadcast !== false) api.send({ op: "clear" });
  }
  function setMarkers(owner, list) {
    if (!owner) return;
    if (list && list.length) markersByOwner[owner] = list;
    else delete markersByOwner[owner];
    const g = group();
    if (g?.userData.play) g.userData.play.markers = mergeMarkers(markersByOwner);
  }
  function setGrounded(value) {
    grounded = value == null ? null : !!value;
    const g = group();
    if (g?.userData.play) g.userData.play.grounded = grounded == null ? true : grounded;
  }
  function stats() {
    const dungeon = currentFloor();
    if (!dungeon || !state.campaign) return null;
    return {
      rooms: dungeon.rooms.length,
      gems: dungeon.props.filter((p) => p.kind === "gem").length,
      loops: dungeon.stats.loops,
      ms: Math.round(dungeon.stats.genMs * 10) / 10,
      checksum: dungeon.checksum,
      campaignChecksum: state.campaign.checksum,
      name: dungeon.name,
      floorIndex: state.floorIndex,
      levelCount: state.campaign.floors.length
    };
  }
  const kit = {
    /** bump when a field below changes shape */
    version: 2,
    generate,
    showFloor,
    clear,
    setMarkers,
    setGrounded,
    /** the replicated world state, copied */
    state: () => ({ seed: state.seed, params: { ...state.params }, floorIndex: state.floorIndex, levelCount: state.campaign?.floors.length ?? 0 }),
    /** the whole campaign (pure data) — for a rule that needs another floor's props */
    campaign: () => state.campaign,
    stats,
    /** @param {() => void} fn refresh hook (toolbox) */
    onChange: (fn) => {
      listeners.push(fn);
      return () => {
        const at = listeners.indexOf(fn);
        if (at >= 0) listeners.splice(at, 1);
      };
    }
  };
  function handleMessage(data) {
    if (data.op === "generate") applyRemoteGenerate(data);
    else if (data.op === "floor") showFloor(data.floorIndex, { broadcast: false });
    else if (data.op === "clear") clear({ broadcast: false });
  }
  function getState() {
    if (state.seed == null) return null;
    return { seed: state.seed, params: state.params, floorIndex: state.floorIndex };
  }
  function applyState(remote) {
    if (!remote || remote.seed == null) return;
    if (!generate(remote.seed, remote.params ?? {}, { broadcast: false })) return;
    if (remote.floorIndex && remote.floorIndex !== state.floorIndex) showFloor(remote.floorIndex, { broadcast: false });
  }
  let _focus = null;
  function tick(time) {
    if (!floorGroup) return;
    const playing = typeof api.isPlaying === "function" && !!api.isPlaying() || api.editorMode?.() === "interact";
    const p = typeof api.playerPosition === "function" ? api.playerPosition() : null;
    let focus = null;
    if (p && floorGroup.parent) {
      const v = (_focus ??= new THREE.Vector3()).set(p[0], p[1], p[2]);
      floorGroup.parent.updateWorldMatrix(true, false);
      floorGroup.parent.worldToLocal(v);
      focus = { x: v.x, z: v.z };
    }
    animateFloor(floorGroup, time, { playing, player: focus });
  }
  return { kit, state, group, handleMessage, getState, applyState, tick, ensureGroup: group };
}

// modules/dungeon/src/nodes.js
var NODE_TYPE = "dkdungeon";
function registerNodes(api, core) {
  const { kit } = core;
  api.registerNodeGroup({
    group: "Dungeon Kit",
    items: [
      {
        type: NODE_TYPE,
        label: "Dungeon",
        defaults: { seed: 1337, roomCount: 0, levelCount: 5, loopChance: 0.15, gemDensity: 1, apply: false },
        params: [
          { key: "seed", kind: "range", min: 0, max: 999999, step: 1 },
          { key: "roomCount", kind: "range", min: 0, max: 60, step: 2 },
          { key: "levelCount", kind: "range", min: 1, max: 9, step: 1 },
          { key: "loopChance", kind: "range", min: 0, max: 0.5, step: 0.05 },
          { key: "gemDensity", kind: "range", min: 0.25, max: 2, step: 0.05 },
          { key: "apply", kind: "toggle" }
        ]
      }
    ]
  });
  api.registerEffect(NODE_TYPE, (object, base, data) => {
    if (!data.apply) return;
    const seed = Math.max(0, Math.round(Number(data.seed) || 0));
    const params = {
      roomCount: Math.round(Number(data.roomCount) || 0),
      levelCount: Math.round(Number(data.levelCount) || 5),
      loopChance: Number(data.loopChance ?? 0.15),
      gemDensity: Number(data.gemDensity ?? 1)
    };
    const current = kit.state();
    const same = current.seed === seed && current.params.roomCount === params.roomCount && current.params.levelCount === params.levelCount && Math.abs((current.params.loopChance ?? 0.15) - params.loopChance) < 1e-9 && Math.abs((current.params.gemDensity ?? 1) - params.gemDensity) < 1e-9;
    if (same) return;
    kit.generate(seed, params, { broadcast: false });
  });
}

// modules/dungeon/src/toolbox.js
var SELECT_CSS = "background:rgba(0,0,0,0.25);color:inherit;border:1px solid rgba(255,255,255,0.15);border-radius:4px;font-size:11px;padding:1px 4px;";
function registerToolbox(api, core) {
  const { kit } = core;
  function elem(tag, props, css) {
    const node = document.createElement(tag);
    Object.assign(node, props ?? {});
    if (css) node.setAttribute("style", css);
    return node;
  }
  const recipeNode = () => {
    if (!api.flow?.nodes) return null;
    return api.flow.nodes(NODE_TYPE).find((n) => n.data?.apply) ?? null;
  };
  function applyRecipe(seed, params) {
    const node = recipeNode();
    if (node && api.flow.setNodeData(node.id, { seed, ...params })) {
      api.toast("Dungeon node updated \u2014 every peer regenerates from the graph");
      return;
    }
    kit.generate(seed, params);
  }
  function mount(el) {
    el.innerHTML = "";
    const current = kit.state();
    const values = {
      seed: current.seed ?? 1337,
      roomCount: current.params.roomCount ?? 0,
      loopChance: current.params.loopChance ?? 0.15,
      levelCount: current.params.levelCount ?? 5
    };
    const row = (label, control, out) => {
      const line = elem("div", { className: "tbx-row" }, "display:flex;align-items:center;gap:6px;margin:3px 0;");
      line.appendChild(elem("span", { className: "tbx-label", textContent: label }, "flex:1;font-size:11px;"));
      if (out) line.appendChild(out);
      line.appendChild(control);
      el.appendChild(line);
      return line;
    };
    const seedInput = (
      /** @type {HTMLInputElement} */
      elem("input", { id: "dk-seed", type: "number", value: String(values.seed), min: "0", step: "1" }, SELECT_CSS + "width:84px;")
    );
    seedInput.onchange = () => values.seed = Math.max(0, Math.round(Number(seedInput.value) || 0));
    const dice = elem("button", { id: "dk-dice", className: "tbx-btn", textContent: "\u{1F3B2}", title: "Random seed" });
    dice.onclick = () => {
      values.seed = Math.floor(Math.random() * 1e6);
      seedInput.value = String(values.seed);
    };
    const seedLine = elem("div", {}, "display:flex;align-items:center;gap:6px;margin:3px 0;");
    seedLine.appendChild(elem("span", { className: "tbx-label", textContent: "Seed" }, "flex:1;font-size:11px;"));
    seedLine.appendChild(seedInput);
    seedLine.appendChild(dice);
    el.appendChild(seedLine);
    const slider = (key, min, max, step, fmt) => {
      const out = elem("span", { textContent: fmt(values[key]) }, "font-size:11px;opacity:0.8;min-width:34px;text-align:right;");
      const input = (
        /** @type {HTMLInputElement} */
        elem("input", { id: "dk-" + key, type: "range", min: String(min), max: String(max), step: String(step), value: String(values[key]) }, "width:96px;")
      );
      input.oninput = () => {
        values[key] = Number(input.value);
        out.textContent = fmt(values[key]);
      };
      return { input, out };
    };
    const rooms = slider("roomCount", 0, 60, 2, (v) => v ? String(v) : "auto");
    row("Rooms", rooms.input, rooms.out);
    const loops = slider("loopChance", 0, 0.5, 0.05, (v) => v.toFixed(2));
    row("Extra loops", loops.input, loops.out);
    const levels = slider("levelCount", 1, 9, 1, (v) => String(v));
    row("Floors", levels.input, levels.out);
    const buttons = elem("div", {}, "display:flex;flex-wrap:wrap;gap:4px;margin:6px 0;");
    const generate = elem("button", { id: "dk-generate", className: "tbx-btn tbx-primary", textContent: "Generate" });
    generate.onclick = () => applyRecipe(values.seed, { roomCount: values.roomCount, loopChance: values.loopChance, levelCount: values.levelCount });
    const clear = elem("button", { id: "dk-clear", className: "tbx-btn", textContent: "Clear" });
    clear.onclick = () => kit.clear();
    buttons.appendChild(generate);
    buttons.appendChild(clear);
    el.appendChild(buttons);
    const floorLine = elem("div", {}, "display:flex;align-items:center;gap:6px;margin:3px 0;");
    const down = elem("button", { id: "dk-floor-down", className: "tbx-btn", textContent: "\u25C2", title: "Floor below" });
    const floorOut = elem("span", { id: "dk-floor", textContent: "\u2014" }, "flex:1;text-align:center;font-size:11px;");
    const up = elem("button", { id: "dk-floor-up", className: "tbx-btn", textContent: "\u25B8", title: "Floor above" });
    down.onclick = () => kit.showFloor(kit.state().floorIndex - 1);
    up.onclick = () => kit.showFloor(kit.state().floorIndex + 1);
    floorLine.appendChild(down);
    floorLine.appendChild(floorOut);
    floorLine.appendChild(up);
    el.appendChild(floorLine);
    const status = elem("div", { id: "dk-stats", className: "tbx-label" }, "white-space:pre-wrap;font-size:11px;opacity:0.8;margin-top:6px;");
    el.appendChild(status);
    el.appendChild(
      elem(
        "div",
        { className: "tbx-label", textContent: "Peers regenerate from the seed \u2014 the same checksum means the exact same dungeon. Dungeon Realms plays it." },
        "font-size:10px;opacity:0.6;margin-top:4px;"
      )
    );
    const refresh = () => {
      const s = kit.stats();
      const st = kit.state();
      floorOut.textContent = s ? "Floor " + s.floorIndex + " / " + s.levelCount + " \xB7 " + s.name : "no dungeon";
      down.disabled = !s || s.floorIndex <= 1;
      up.disabled = !s || s.floorIndex >= s.levelCount;
      status.textContent = s ? s.rooms + " rooms \xB7 " + s.gems + " gems \xB7 " + s.loops + " loops \xB7 " + s.ms + " ms\nchecksum " + s.checksum + " \xB7 campaign " + s.campaignChecksum + (recipeNode() ? "\nrecipe owned by the Dungeon node" : "") : "Generate a dungeon, then press the red Play button to walk it.";
      if (st.seed != null && Number(seedInput.value) !== st.seed && document.activeElement !== seedInput) {
        values.seed = st.seed;
        seedInput.value = String(st.seed);
      }
    };
    refresh();
    const off = kit.onChange(refresh);
    return () => off();
  }
  if (typeof api.registerToolbox === "function") {
    const id = api.registerToolbox({ id: "kit", title: "Dungeon Kit", width: 260, minW: 220, mount });
    api.registerMenu("Dungeon Kit", () => typeof api.openToolbox === "function" ? api.openToolbox(id) : null);
    return { id, mount, host: "toolbox" };
  }
  let panel = null;
  let cleanup = null;
  function openPanel() {
    if (panel || typeof document === "undefined") return;
    panel = elem(
      "div",
      { id: "dungeon-panel" },
      "position:fixed;right:0.5rem;top:5rem;z-index:40;display:flex;width:18rem;flex-direction:column;gap:0.5rem;border-radius:0.5rem;background:#1f2937;padding:0.75rem;font-size:0.875rem;color:#fff;box-shadow:0 10px 25px rgba(0,0,0,0.4);"
    );
    const head = elem("div", {}, "display:flex;align-items:center;justify-content:space-between");
    head.appendChild(elem("span", { textContent: "Dungeon Kit" }, "font-weight:600"));
    const close = elem("button", { id: "dungeon-close", textContent: "\u2715" }, "border-radius:2px;background:#4b5563;padding:0 0.5rem");
    close.onclick = () => {
      cleanup?.();
      cleanup = null;
      panel?.remove();
      panel = null;
    };
    head.appendChild(close);
    panel.appendChild(head);
    const body = elem("div");
    panel.appendChild(body);
    document.body.appendChild(panel);
    cleanup = mount(body) ?? null;
  }
  api.registerMenu("Dungeon Kit", openPanel);
  return { id: null, mount, host: "panel", openPanel };
}

// modules/dungeon/src/index.js
var index_default = {
  id: "dungeon",
  name: "Dungeon Kit",
  version: "2.1.0",
  description: "Level generation toolbox: a seeded multi-floor dungeon generator (rooms, corridors, decor, torches) with a toolbox, a Dungeon node and the userData.play contract the app walks in play mode. The playable game is Dungeon Realms.",
  /** @param {any} api the module SDK surface */
  register(api) {
    const core = createKit(api);
    registerNodes(api, core);
    const toolbox = registerToolbox(api, core);
    api.registerSystemGroup(GROUP_NAME);
    api.registerInteractiveGroup(GROUP_NAME);
    api.registerListedGroup?.(GROUP_NAME, { label: "Dungeon" });
    core.ensureGroup();
    api.onMessage((data) => core.handleMessage(data));
    api.onSceneClear(() => core.kit.clear({ broadcast: false }));
    api.registerStateSync({
      getState: () => core.getState(),
      applyState: (remote) => core.applyState(remote)
    });
    api.registerFrameTask((time) => core.tick(time));
    if (typeof window !== "undefined") {
      window.__dungeonKit = { kit: core.kit, toolbox, groupName: GROUP_NAME };
    }
  }
};
export {
  index_default as default
};
