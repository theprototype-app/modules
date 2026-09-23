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

// modules/dungeon/src/torch/torch.gen.js
var TORCH_PARTS = [{ "name": "Flame", "translation": [0, 0.4665071278216737, 0.2713281572999747], "positions": "AAAAAAAAAAAAAAAAAAAAAI/CdTyamRk9AAAAAM3MTD09Clc9AAAAAM3MzD3sUTg9AAAAAAAAID7NzMw8AAAAAM3MTD6PwvU7AAAAAAAAYD4AAAAAAAAAAAAAAAAAAAAAJDnZPI/CdTwkOdk8Zg4YPc3MTD1mDhg9fFUCPc3MzD18VQI9w9CQPAAAID7D0JA8UMetO83MTD5Qx607AAAAAAAAYD4AAAAAAAAAAAAAAAAAAAAAmpkZPY/CdTw8bikiPQpXPc3MTD3tM20i7FE4Pc3MzD0UUUsizczMPAAAID5P6OEhj8L1O83MTD5jiwchAAAAAAAAYD4AAAAAAAAAAAAAAAAAAACAJDnZPI/CdTwkOdm8Zg4YPc3MTD1mDhi9fFUCPc3MzD18VQK9w9CQPAAAID7D0JC8UMetO83MTD5Qx627AAAAAAAAYD4AAACAAAAAAAAAAAAAAACAPG6pIo/CdTyamRm97TPtIs3MTD09Cle9FFHLIs3MzD3sUTi9T+hhIgAAID7NzMy8Y4uHIc3MTD6PwvW7AAAAAAAAYD4AAACAAAAAgAAAAAAAAACAJDnZvI/CdTwkOdm8Zg4Yvc3MTD1mDhi9fFUCvc3MzD18VQK9w9CQvAAAID7D0JC8UMetu83MTD5Qx627AAAAgAAAYD4AAACAAAAAgAAAAAAAAACAmpkZvY/CdTxZJf6iPQpXvc3MTD3y5jGj7FE4vc3MzD3PfBijzczMvAAAID48bqmij8L1u83MTD4UUcuhAAAAgAAAYD4AAACAAAAAgAAAAAAAAAAAJDnZvI/CdTwkOdk8Zg4Yvc3MTD1mDhg9fFUCvc3MzD18VQI9w9CQvAAAID7D0JA8UMetu83MTD5Qx607AAAAgAAAYD4AAAAAAAAAgAAAAAAAAAAAPG4po4/CdTyamRk97TNto83MTD09Clc9FFFLo83MzD3sUTg9T+jhogAAID7NzMw8Y4sHos3MTD6PwvU7AAAAgAAAYD4AAAAA", "normals": "AAAAAAAAAAAAAAAAdKKMPr0/Mr/Nwik/Qa7BPp/ZGr4Ty2k/yv+/PsEvTD51w2c/iqa5PsKwoz6cGWA/Jsm3Pq56sT5Z2V0/Jcm3Pq96sT5Z2V0/ErIbPi/tar/y8Ls+74HtPlhqJL9lNRw/iLsuP3Rupb3e8jk/eRw2PzEndj7UESk/F2I8P0yIsD71LxU/uklJP40zuj7Jvv8+WdldP696sT4lybc+8vC7Pi/tar8Sshs+gW1CP1dqJL9S4NM9SAp/P3Rupb3dyv08h1J4PzEndj54jBO9yrJuP0yIsD6kud29cMBoP40zuj5jpk++WdldP696sT4lybe+8vC7Pi/tar8Sshu+ZTUcP1hqJL/vge2+3vI5P3Rupb2Iuy6/1BEpPzEndj55HDa/9S8VP0yIsD4XYjy/yb7/Po0zuj66SUm/Jcm3Pq96sT5Z2V2/ErIbPi/tar/y8Lu+UuDTPVdqJL+BbUK/3cr9PHRupb1ICn+/eIwTvTEndj6HUni/pLndvUyIsD7Ksm6/Y6ZPvo0zuj5wwGi/Jcm3vq96sT5Z2V2/ErIbvi/tar/y8Lu+74HtvlhqJL9lNRy/iLsuv3Rupb3e8jm/eRw2vzEndj7UESm/F2I8v0yIsD71LxW/uklJv40zuj7Jvv++Wdldv696sT4lybe+8vC7vi/tar8Sshu+gW1Cv1dqJL9S4NO9SAp/v3Rupb3dyv28h1J4vzEndj54jBM9yrJuv0yIsD6kud09cMBov40zuj5jpk8+Wdldv696sT4lybc+8vC7vi/tar8Sshs+ZTUcv1hqJL/vge0+3vI5v3Rupb2Iuy4/1BEpvzEndj55HDY/9S8Vv0yIsD4XYjw/yb7/vo0zuj66SUk/Jcm3vq96sT5Z2V0/ErIbvi/tar/y8Ls+25Ohvq7NEL+YCkM/lO3DvsSu/buOgWw/yqe9vr6SgD4y72Q/1Pu4vkfEqD6MS18/Jcm3vq56sT5Z2V0/AAAAAAAAAAAAAAAA", "uvs": null, "index": "AAAHAAEACAABAAcAAQAIAAIACQACAAgAAgAJAAMACgADAAkAAwAKAAQACwAEAAoABAALAAUADAAFAAsABQAMAAYADQAGAAwABwAOAAgADwAIAA4ACAAPAAkAEAAJAA8ACQAQAAoAEQAKABAACgARAAsAEgALABEACwASAAwAEwAMABIADAATAA0AFAANABMADgAVAA8AFgAPABUADwAWABAAFwAQABYAEAAXABEAGAARABcAEQAYABIAGQASABgAEgAZABMAGgATABkAEwAaABQAGwAUABoAFQAcABYAHQAWABwAFgAdABcAHgAXAB0AFwAeABgAHwAYAB4AGAAfABkAIAAZAB8AGQAgABoAIQAaACAAGgAhABsAIgAbACEAHAAjAB0AJAAdACMAHQAkAB4AJQAeACQAHgAlAB8AJgAfACUAHwAmACAAJwAgACYAIAAnACEAKAAhACcAIQAoACIAKQAiACgAIwAqACQAKwAkACoAJAArACUALAAlACsAJQAsACYALQAmACwAJgAtACcALgAnAC0AJwAuACgALwAoAC4AKAAvACkAMAApAC8AKgAxACsAMgArADEAKwAyACwAMwAsADIALAAzAC0ANAAtADMALQA0AC4ANQAuADQALgA1AC8ANgAvADUALwA2ADAANwAwADYAMQA4ADIAOQAyADgAMgA5ADMAOgAzADkAMwA6ADQAOwA0ADoANAA7ADUAPAA1ADsANQA8ADYAPQA2ADwANgA9ADcAPgA3AD0A", "min": [-0.05249999836087227, 0, -0.05249999836087227], "max": [0.05249999836087227, 0.21875, 0.05249999836087227], "material": { "roughness": 1, "metalness": 0, "color": [0.25, 0.07, 0.01, 1], "emissive": [1, 0.34, 0.03], "emissiveStrength": 1.15, "map": null } }, { "name": "WallTorch_iron", "translation": [0, 0, 0], "positions": "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", "normals": "AACAPwAAAAAAAAAAAACAPwAAAAAAAAAAAACAPwAAAAAAAAAAAACAPwAAAAAAAAAAAACAvwAAAAAAAAAAAACAvwAAAAAAAAAAAACAvwAAAAAAAAAAAACAvwAAAAAAAAAAAAAAAAAAgD8AAAAAAAAAAAAAgD8AAAAAAAAAAAAAgD8AAAAAAAAAAAAAgD8AAAAAAAAAAAAAgL8AAAAAAAAAAAAAgL8AAAAAAAAAAAAAgL8AAAAAAAAAAAAAgL8AAAAAAAAAAAAAAAAAAIA/AAAAAAAAAAAAAIA/AAAAAAAAAAAAAIA/AAAAAAAAAAAAAIA/AAAAAAAAAAAAAIC/AAAAAAAAAAAAAIC/AAAAAAAAAAAAAIC/AAAAAAAAAAAAAIC/AAAAAAAAgL8AAIAl8wQ1P/MENb/zBDUlAACAPzIxjaQyMY0K8wQ1P/MENT/zBDWlMjENJQAAgD8AAICl8wQ1v/MENT/zBDWlAACAv8rJUyXKyVOL8wQ1v/MENb/zBDUlMjGNpQAAgL8AAIAlAAAAAAAAgL8AAIAl8wQ1P/MENb/zBDUlAACAPzIxjaQyMY0K8wQ1P/MENT/zBDWlMjENJQAAgD8AAICl8wQ1v/MENT/zBDWlAACAv8rJUyXKyVOL8wQ1v/MENb/zBDUlMjGNpQAAgL8AAIAlAAAAAAAAgCUAAIA/AAAAAAAAgCUAAIA/AAAAAAAAgCUAAIA/AAAAAAAAgCUAAIA/AAAAAAAAgCUAAIA/AAAAAAAAgCUAAIA/AAAAAAAAgCUAAIA/AAAAAAAAgCUAAIA/AAAAAAAAgCUAAIA/AAAAAAAAgCUAAIA/AAAAAAAAgCUAAIA/AAAAAAAAgCUAAIA/AAAAAAAAgCUAAIA/AAAAAAAAgCUAAIA/AAAAAAAAgCUAAIA/AAAAAAAAgCUAAIA/AAAAAAAAgCUAAIA/AAAAAAAAgKUAAIC/AAAAAAAAgKUAAIC/AAAAAAAAgKUAAIC/AAAAAAAAgKUAAIC/AAAAAAAAgKUAAIC/AAAAAAAAgKUAAIC/AAAAAAAAgKUAAIC/AAAAAAAAgKUAAIC/AAAAAAAAgKUAAIC/AAAAAAAAgKUAAIC/AAAAAAAAgKUAAIC/AAAAAAAAgKUAAIC/AAAAAAAAgKUAAIC/AAAAAAAAgKUAAIC/AAAAAAAAgKUAAIC/AAAAAAAAgKUAAIC/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", "uvs": "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", "index": "AAACAAEAAgADAAEABAAGAAUABgAHAAUACAAKAAkACgALAAkADAAOAA0ADgAPAA0AEAASABEAEgATABEAFAAWABUAFgAXABUAGAAhABkAIQAiABkAGQAiABoAIgAjABoAGgAjABsAIwAkABsAGwAkABwAJAAlABwAHAAlAB0AJQAmAB0AHQAmAB4AJgAnAB4AHgAnAB8AJwAoAB8AHwAoACAAKAApACAAMgAzACoAMwA0ACsANAA1ACwANQA2AC0ANgA3AC4ANwA4AC8AOAA5ADAAOQA6ADEARABDADsARQBEADwARgBFAD0ARwBGAD4ASABHAD8ASQBIAEAASgBJAEEASwBKAEIAXQBMAF4ATABNAF4AXgBNAF8ATQBOAF8AXwBOAGAATgBPAGAAYABPAGEATwBQAGEAYQBQAGIAUABRAGIAYgBRAGMAUQBSAGMAYwBSAGQAUgBTAGQAZABTAGUAUwBUAGUAZQBUAGYAVABVAGYAZgBVAGcAVQBWAGcAZwBWAGgAVgBXAGgAaABXAGkAVwBYAGkAaQBYAGoAWABZAGoAagBZAGsAWQBaAGsAawBaAGwAWgBbAGwAbABbAG0AWwBcAG0AbgBdAG8AXQBeAG8AbwBeAHAAXgBfAHAAcABfAHEAXwBgAHEAcQBgAHIAYABhAHIAcgBhAHMAYQBiAHMAcwBiAHQAYgBjAHQAdABjAHUAYwBkAHUAdQBkAHYAZABlAHYAdgBlAHcAZQBmAHcAdwBmAHgAZgBnAHgAeABnAHkAZwBoAHkAeQBoAHoAaABpAHoAegBpAHsAaQBqAHsAewBqAHwAagBrAHwAfABrAH0AawBsAH0AfQBsAH4AbABtAH4AfwBuAIAAbgBvAIAAgABvAIEAbwBwAIEAgQBwAIIAcABxAIIAggBxAIMAcQByAIMAgwByAIQAcgBzAIQAhABzAIUAcwB0AIUAhQB0AIYAdAB1AIYAhgB1AIcAdQB2AIcAhwB2AIgAdgB3AIgAiAB3AIkAdwB4AIkAiQB4AIoAeAB5AIoAigB5AIsAeQB6AIsAiwB6AIwAegB7AIwAjAB7AI0AewB8AI0AjQB8AI4AfAB9AI4AjgB9AI8AfQB+AI8AkAB/AJEAfwCAAJEAkQCAAJIAgACBAJIAkgCBAJMAgQCCAJMAkwCCAJQAggCDAJQAlACDAJUAgwCEAJUAlQCEAJYAhACFAJYAlgCFAJcAhQCGAJcAlwCGAJgAhgCHAJgAmACHAJkAhwCIAJkAmQCIAJoAiACJAJoAmgCJAJsAiQCKAJsAmwCKAJwAigCLAJwAnACLAJ0AiwCMAJ0AnQCMAJ4AjACNAJ4AngCNAJ8AjQCOAJ8AnwCOAKAAjgCPAKAAoQCQAKIAkACRAKIAogCRAKMAkQCSAKMAowCSAKQAkgCTAKQApACTAKUAkwCUAKUApQCUAKYAlACVAKYApgCVAKcAlQCWAKcApwCWAKgAlgCXAKgAqACXAKkAlwCYAKkAqQCYAKoAmACZAKoAqgCZAKsAmQCaAKsAqwCaAKwAmgCbAKwArACbAK0AmwCcAK0ArQCcAK4AnACdAK4ArgCdAK8AnQCeAK8ArwCeALAAngCfALAAsACfALEAnwCgALEAsgChALMAoQCiALMAswCiALQAogCjALQAtACjALUAowCkALUAtQCkALYApAClALYAtgClALcApQCmALcAtwCmALgApgCnALgAuACnALkApwCoALkAuQCoALoAqACpALoAugCpALsAqQCqALsAuwCqALwAqgCrALwAvACrAL0AqwCsAL0AvQCsAL4ArACtAL4AvgCtAL8ArQCuAL8AvwCuAMAArgCvAMAAwACvAMEArwCwAMEAwQCwAMIAsACxAMIA1ADDANUAwwDEANUA1QDEANYAxADFANYA1gDFANcAxQDGANcA1wDGANgAxgDHANgA2ADHANkAxwDIANkA2QDIANoAyADJANoA2gDJANsAyQDKANsA2wDKANwAygDLANwA3ADLAN0AywDMAN0A3QDMAN4AzADNAN4A3gDNAN8AzQDOAN8A3wDOAOAAzgDPAOAA4ADPAOEAzwDQAOEA4QDQAOIA0ADRAOIA4gDRAOMA0QDSAOMA4wDSAOQA0gDTAOQA5QDUAOYA1ADVAOYA5gDVAOcA1QDWAOcA5wDWAOgA1gDXAOgA6ADXAOkA1wDYAOkA6QDYAOoA2ADZAOoA6gDZAOsA2QDaAOsA6wDaAOwA2gDbAOwA7ADbAO0A2wDcAO0A7QDcAO4A3ADdAO4A7gDdAO8A3QDeAO8A7wDeAPAA3gDfAPAA8ADfAPEA3wDgAPEA8QDgAPIA4ADhAPIA8gDhAPMA4QDiAPMA8wDiAPQA4gDjAPQA9ADjAPUA4wDkAPUA9gDlAPcA5QDmAPcA9wDmAPgA5gDnAPgA+ADnAPkA5wDoAPkA+QDoAPoA6ADpAPoA+gDpAPsA6QDqAPsA+wDqAPwA6gDrAPwA/ADrAP0A6wDsAP0A/QDsAP4A7ADtAP4A/gDtAP8A7QDuAP8A/wDuAAAB7gDvAAABAAHvAAEB7wDwAAEBAQHwAAIB8ADxAAIBAgHxAAMB8QDyAAMBAwHyAAQB8gDzAAQBBAHzAAUB8wD0AAUBBQH0AAYB9AD1AAYBBwH2AAgB9gD3AAgBCAH3AAkB9wD4AAkBCQH4AAoB+AD5AAoBCgH5AAsB+QD6AAsBCwH6AAwB+gD7AAwBDAH7AA0B+wD8AA0BDQH8AA4B/AD9AA4BDgH9AA8B/QD+AA8BDwH+ABAB/gD/ABABEAH/ABEB/wAAAREBEQEAARIBAAEBARIBEgEBARMBAQECARMBEwECARQBAgEDARQBFAEDARUBAwEEARUBFQEEARYBBAEFARYBFgEFARcBBQEGARcBGAEHARkBBwEIARkBGQEIARoBCAEJARoBGgEJARsBCQEKARsBGwEKARwBCgELARwBHAELAR0BCwEMAR0BHQEMAR4BDAENAR4BHgENAR8BDQEOAR8BHwEOASABDgEPASABIAEPASEBDwEQASEBIQEQASIBEAERASIBIgERASMBEQESASMBIwESASQBEgETASQBJAETASUBEwEUASUBJQEUASYBFAEVASYBJgEVAScBFQEWAScBJwEWASgBFgEXASgBKQEYASoBGAEZASoBKgEZASsBGQEaASsBKwEaASwBGgEbASwBLAEbAS0BGwEcAS0BLQEcAS4BHAEdAS4BLgEdAS8BHQEeAS8BLwEeATABHgEfATABMAEfATEBHwEgATEBMQEgATIBIAEhATIBMgEhATMBIQEiATMBMwEiATQBIgEjATQBNAEjATUBIwEkATUBNQEkATYBJAElATYBNgElATcBJQEmATcBNwEmATgBJgEnATgBOAEnATkBJwEoATkBOgFBATsBQQFCATsBOwFCATwBQgFDATwBPAFDAT0BQwFEAT0BPQFEAT4BRAFFAT4BPgFFAT8BRQFGAT8BPwFGAUABRgFHAUABTgFPAUgBTwFQAUkBUAFRAUoBUQFSAUsBUgFTAUwBUwFUAU0BXAFbAVUBXQFcAVYBXgFdAVcBXwFeAVgBYAFfAVkBYQFgAVoBYgFpAWMBaQFqAWMBYwFqAWQBagFrAWQBZAFrAWUBawFsAWUBZQFsAWYBbAFtAWYBZgFtAWcBbQFuAWcBZwFuAWgBbgFvAWgBdgF3AXABdwF4AXEBeAF5AXIBeQF6AXMBegF7AXQBewF8AXUBhAGDAX0BhQGEAX4BhgGFAX8BhwGGAYABiAGHAYEBiQGIAYIB", "min": [-0.05000000074505806, 59604643443123e-23, 22351741291171123e-26], "max": [0.05000000074505806, 0.2199999988079071, 0.21614015102386475], "material": { "roughness": 0.55, "metalness": 0.75, "color": [1, 1, 1, 1], "emissive": null, "emissiveStrength": 1, "map": "data:image/jpeg;base64,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" } }, { "name": "WallTorch_oak", "translation": [0, 0, 0], "positions": "AAAAAILN5T7ZY5U+59KGPBqm5j4+yZI+SCbaPCbd6D4M+Is+SCbaPBCa6z7dioM+59KGPBzR7T5Wc3k+MAR9IrSp7j4gPnQ+59KGvBzR7T5Wc3k+SCbavBCa6z7dioM+SCbavCbd6D4M+Is+59KGvBqm5j4+yZI+MAT9ooLN5T7ZY5U+AAAAAJ5LWDydYBM+s91TPGSRbTwXSQ8+OWerPE+hkjykkgQ+OWerPMIMtTyRqe49s91TPF7l0DyqPNk9b8xGIkGI2zyeDdE9s91TvF7l0DyqPNk9OWervMIMtTyRqe49OWervE+hkjykkgQ+s91TvGSRbTwXSQ8+b8zGop5LWDydYBM+AAAAAJs76j50wYc+AAAAAJs76j50wYc+AAAAAJs76j50wYc+AAAAAJs76j50wYc+AAAAAJs76j50wYc+AAAAAJs76j50wYc+AAAAAJs76j50wYc+AAAAAJs76j50wYc+AAAAAJs76j50wYc+AAAAAJs76j50wYc+AAAAAILN5T7ZY5U+59KGPBqm5j4+yZI+SCbaPCbd6D4M+Is+SCbaPBCa6z7dioM+59KGPBzR7T5Wc3k+MAR9IrSp7j4gPnQ+59KGvBzR7T5Wc3k+SCbavBCa6z7dioM+SCbavCbd6D4M+Is+59KGvBqm5j4+yZI+MAT9ooLN5T7ZY5U+AAAAAAjXozxs5/s9AAAAAAjXozxs5/s9AAAAAAjXozxs5/s9AAAAAAjXozxs5/s9AAAAAAjXozxs5/s9AAAAAAjXozxs5/s9AAAAAAjXozxs5/s9AAAAAAjXozxs5/s9AAAAAAjXozxs5/s9AAAAAAjXozxs5/s9AAAAAJ5LWDydYBM+s91TPGSRbTwXSQ8+OWerPE+hkjykkgQ+OWerPMIMtTyRqe49s91TPF7l0DyqPNk9b8xGIkGI2zyeDdE9s91TvF7l0DyqPNk9OWervMIMtTyRqe49OWervE+hkjykkgQ+s91TvGSRbTwXSQ8+b8zGop5LWDydYBM+", "normals": "AAAAANqNpL4Ca3I/0XUWPwlXhr5Z7EM/I3NzPxT03L2PZZQ+I3NzP4Ilqj0Vhpi+0XUWP8lGcz6c/EW/Hy4NJTbalz5Fe3S/0XUWv8lGcz6c/EW/I3Nzv4Ilqj0Vhpi+I3NzvxT03L2PZZQ+0XUWvwlXhr5Z7EM/Hy6NpdqNpL4Ca3I/AAAAANqNpL4Ca3I/0XUWPwlXhr5Z7EM/I3NzPxT03L2PZZQ+I3NzP4Ilqj0Vhpi+0XUWP8lGcz6c/EW/Hy4NJTbalz5Fe3S/0XUWv8lGcz6c/EW/I3Nzv4Ilqj0Vhpi+I3NzvxT03L2PZZQ+0XUWvwlXhr5Z7EM/Hy6NpdqNpL4Ca3I/AAAAAHF4cz96N54+AAAAAHF4cz96N54+AAAAAHF4cz96N54+AAAAAHF4cz96N54+AAAAAHF4cz96N54+AAAAAHF4cz96N54+AAAAAHF4cz96N54+AAAAAHF4cz96N54+AAAAAHF4cz96N54+AAAAAHF4cz96N54+AAAAAHF4cz96N54+AAAAAHF4cz96N54+AAAAAHF4cz96N54+AAAAAHF4cz96N54+AAAAAHF4cz96N54+AAAAAHF4cz96N54+AAAAAHF4cz96N54+AAAAAHF4cz96N54+AAAAAHF4cz96N54+AAAAAHF4cz96N54+AAAAAHF4cz96N54+AAAAAHF4c796N56+AAAAAHF4c796N56+AAAAAHF4c796N56+AAAAAHF4c796N56+AAAAAHF4c796N56+AAAAAHF4c796N56+AAAAAHF4c796N56+AAAAAHF4c796N56+AAAAAHF4c796N56+AAAAAHF4c796N56+AAAAAHF4c796N56+AAAAAHF4c796N56+AAAAAHF4c796N56+AAAAAHF4c796N56+AAAAAHF4c796N56+AAAAAHF4c796N56+AAAAAHF4c796N56+AAAAAHF4c796N56+AAAAAHF4c796N56+AAAAAHF4c796N56+AAAAAHF4c796N56+", "uvs": "MzMTPwAAAAAzMxM/oYeoPDMzEz/kMzE8MzMTP+QzMbwzMxM/oYeoPDMzEz+eIp4iMzMTP6GHqLwzMxM/5DMxvDMzEz/kMzE8MzMTP6GHqLwzMxM/niIeozMzs7EAAAAAMzOzsZBqhDwzM7OxDzsLPDMzs7EPOwu8MzOzsZBqhDwzM7Oxi394IjMzs7GQaoS8MzOzsQ87C7wzM7OxDzsLPDMzs7GQaoS8MzOzsYt/+KIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAApXA89oYeoPBv25zztVwg95DMxPO1XCD3kMzG8oYeoPBv257yeIp4iKVwPvaGHqLwb9ue87VcIveQzMbztVwi95DMxPKGHqLwb9uc8niIeoylcDz0AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACuR+E8kGqEPF5BtjwHQdY8DzsLPAdB1jwPOwu8kGqEPF5BtryLf3girkfhvJBqhLxeQba8B0HWvA87C7wHQda8DzsLPJBqhLxeQbY8i3/4oq5H4Tw=", "index": "AAALAAEACwAMAAEAAQAMAAIADAANAAIAAgANAAMADQAOAAMAAwAOAAQADgAPAAQABAAPAAUADwAQAAUABQAQAAYAEAARAAYABgARAAcAEQASAAcABwASAAgAEgATAAgACAATAAkAEwAUAAkACQAUAAoAFAAVAAoAIAAhABYAIQAiABcAIgAjABgAIwAkABkAJAAlABoAJQAmABsAJgAnABwAJwAoAB0AKAApAB4AKQAqAB8ANgA1ACsANwA2ACwAOAA3AC0AOQA4AC4AOgA5AC8AOwA6ADAAPAA7ADEAPQA8ADIAPgA9ADMAPwA+ADQA", "min": [-0.026629582047462463, 0.013201622292399406, 0.10207675397396088], "max": [0.026629582047462463, 0.46613848209381104, 0.2917774021625519], "material": { "roughness": 0.78, "metalness": 0, "color": [1, 1, 1, 1], "emissive": null, "emissiveStrength": 1, "map": "data:image/jpeg;base64,/9j/2wBDAAQDAwQDAwQEBAQFBQQFBwsHBwYGBw4KCggLEA4RERAOEA8SFBoWEhMYEw8QFh8XGBsbHR0dERYgIh8cIhocHRz/2wBDAQUFBQcGBw0HBw0cEhASHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBz/wAARCAIAAgADASIAAhEBAxEB/8QAGwAAAgMBAQEAAAAAAAAAAAAAAgMBBAUABgf/xAA3EAABAwIEBgEEAQMEAgMBAQABAAIRAyEEEjFBBRMUIlFhcRUygZFCI1KhBjOxwUNiFlPR4XL/xAAYAQEBAQEBAAAAAAAAAAAAAAAAAQIDBv/EAB0RAQEBAQEBAQEBAQAAAAAAAAARARIhAiITUTH/2gAMAwEAAhEDEQA/APkYqOZ/5HDfVGK7yCA8m3lWelo2OedlJwtG0En3ovNV6eK4rVHgXJGszupz1HCcztdCVaGEoACHgkfcE0YWlOtv+VLhFLmVs2b1uVDnVT3F0R4KvjDMDSJOY3R9KwmIMaSSlwjNzVRBzTGl1HNqzc3HtafR0iWyDGnpF9PpEuGUwdClwjKNSp5MfK44qqCBEx7Wo7htK4BObxAXP4fQLDDHE6WF0uLGX1NQTJ/wgOIcbZhHwtYcOw5BjMSPI3QnBUAWg03XsZFkuJGVzXusXR4AUCo5tg+fRWscBQaXENJBsAEvoqANg5x+dEuEZzarzq4SoFV7Q4Bwn3CvuwdEnLDhImFxwdG2oMK3BQ59UkgkSPhSyu8EkmVd6OiRIcR5QnDU8oOctHtLgqtxL26lQ/EGCIJHiFadh2CXB/pCaEk92m/lLgpvxHoJL8QRGl9oWgaDSHDyluoUyQJFlbibms81yAIiJ8LjVcdAB7Vs0mEwSLXQZAbggfKtSaQHuJ2hFMES74TS0NEQHFCGyYLf2gWX6ku0shNQOi8KwKLHH7RA9o24agXGR+kpNUhVBGgKYKo8QVcOFw5OUA/Phd0WHmMxnYkJcJpLMW0XgftM+ogaMaZ0uufw6j/F5uNgoHDKcfedBaFPD1B4kCSMuhnVE3ictjIHe5XfTKViHkXRjh1EWzkR53T8nprOIl5y8sXThiKktysnykHDUqZ0Pyia5lMwAT4KnjXqyKzy0ggNRirUcNgT41hIbXuew/kI21HADY/4Ugfz6jXAAA23UuriDnc4DcBAXPcLNgzEwoLXkgEkghRVjq2Ai5uu6ykBZ0+FWNN7u0NdaxKh1F0ActwPpSYLRxdAE27o1hKONpNBkBsaWSHUKmYxTMAftKqYZ4BIb/2rMKsPxdMA5QZGkoHY2iCDETqI1VWpSrD0AL2SzTr6lotcGFZiVbdi6ToaGWBmZuh6un9raZMamVXFLEkjtkaphw9cXNlZhRdSzamSRpKE12H/AMZmNPCB1CsHfaYjVCaD4IA18FPAwV6QtkJ+URxLALM/EpHIeI7TIUGk+ASCB8IhwxLZjJ/lR1IeZy20SCxwcbEEhdldpkdHwkU0VWmxGpSi1rw4loH5XZHbNM62Ci9xDrbwqiBhKTxd0flCOHUXRLo/KITrBuPC4STJkeinqTEswOGieYD7JVinhMMDdzYOhlVwIF7j4UkQNo3RfF5lLC3IdYboi2j/AHHLsQs+AQD2zshJIM2vtKkWtEsokzzTHhSeTGbmfmVmhrjcuA9KQDkuZvoEiVvN4Uy8T2+dFP0xhI7rjUSsd3+pajpzXhAePyQSL6/KnP0vWNr6czMQT8FE3h5mBVBWMP8AUdQRp+lH/wAiAF6YPvdOfo6xu08C+Y5ndqLbJtLAuhwc8nu8rAb/AKqcCIbAAgWRt/1UWgnJ3HVTn6Ovlvsw0m5yhvlQ4Nb/ACIId8SsB3+p2ukuEkpL/wDUYOnxcpx9HePROqMDyeZ2+N0FOuwiXVjcrzDuOybwY0Qt4ydR+VeNTt6l1Zha6C7MNDOqkvYQLOcQNV5pnF3SLiFYZxgwJ2TjTtumlzGAtEb6IeiL22tN7eVkjjUhpBiCmt41ck6eApzq3Gq3hmch9iRb5VhnB2OMZcpO6zKfFjnBYSLXtqr1PiznU4DyPYCzufTWQ76HTBJylwJuJQng9JzywU3WEyRZd9RdFMseY3kXIR/UXtc92c7aqfpfCXcIotdl5TwNJiyU/hdMAkOgDaLK59Rr5zMlseEo46o+7WkHSCLFLqeEDhNMGCSSbgQo+k0iTFN3bew1T345z4DmfbvH+UIx1QAgNgDwrdPA/RWFgdlv4K4cBaDBGYkTEaBc7iNZh7SBtdA7jNRjZLwSLXT9Hian+nWtAa1lyJgLj/p4QTYRrKW7jTw6HPGmoMFc7jJAk1AGxGt0/R4g8AgDuHdpAUDggbaI9wodxoCJqzJtdA/jDibVRlOxKv6Twx/CTTvq2NQLofpRqSLQLGQqw4y9pnmiCIiULuN1HSC8ftWfRcWfplQtc1sAgwLIRgKolv3EWsEpvGXA5gdb6pn1p4AM6p6eDHDajQA4jKf+Vxwj8xaYBG+yWOMucGjMJBlc7i7s18kKenhgw1Vok5SdIUnDVC0gNaI3SG8UgHMGklCeJsIENbe4srNPFjl1myIaSDqBdc5z2Nb2iQVU+pFuYw2T4CUeKS0BzZO9kmlxoOrvLSAyJsDCkV3Zg4NbbeNFlO4pFgy+wSzxEwYA8kK86nWNsVasOvE3UOq1TkuLGQVh9e9ptN/8IBjn5nRPhOTp6DnVC0WaCfSW2oNIEG+ZYf1Co1osf2pGPMZSNU5Om24ixzgRrZCA2RNVZIxh8D0EXUPsSGwkK2GvZmMvnLoU2nimAw7uO97LC55dsIXGqToIJ9pyV6PqqDiWupt00zKRicKTak21p8LzXOdmkeIUGq43N40vupwvT04fS1DmSTJJRgUHizWgbTovLc+oASDcbSi6qq4AhxG+qclenZh6VRoeQyT/AMJnR0C4HtLIva8ry3XVAIzOj0VNPHVW6OdGsypzp1j0zuG0Xt7A1pKF3C6JAgAEalecGPqNdMuJO8ozxCobmSR7TnS43jwqm9oLWgH/AKQu4TTa3MWSdJCxW8WrN0Pcf1CY3jNZsR+U5+i41ncNaP8AwmPShvDWPBilAmCCNFnHj9YSZK4f6gxBIv8AhJ9FxZqcJD3Q1oGU+El3BXkZouLRCEcdqMzaw4ybovr782bukWkbK/o8KdwWsAHBpM+lJ4JVvLTE+E1vHnhrbuKl/HqkQHvE6FL9JMeVGFsZEhHyGgDt08r0HSOOUhgg6GEPSvvmpNb8rfScsE0m+LFKNFgNgSVvnDSIc1oHkIBhmkS1whOk5YRoBx0uFHTggzqts4VpGv4UNwodOaBdXpOWMMI0bG6Lo6bpWx0LZ+6B7Rt4YXtBkhOl5YXQtcbf/wBU/Tg1sgmy3DgHNGYGdtFBwFSbXAsU7OWM3AHUO1RtwbpMustU4J06kE/pT0jpiSIU6OWZ0oH3O3TmU4sNFd6Rwg53axZScK5sdxASrFUOLdWzvZOGIqA/aJ/KLkOnMS6BspNEyLuAH+VFQcbWBi0FR1tWcwIlFlAE39IC4EzBICeCeurzMiSo6uvIMwRsEL6wa3tYZ8FCcTcDJf8A4SJTOsrkGXXGwQc+prnKHmmNCI8qSXvALRN0hXGvUP3O0Ql5jKXH9IhSdJNz6RZKgidVRUeHkEiZVd9KpNplamWsRZn+UQY4gggCf+UqSsUsq75tEIdUG5/K2+RINp+UDsIXAdoA8q9JyyeYZiUTargJOq1OhBEhohCMAY+zTdOsJqgKpvuja9w0Fv8AhaDME4tMN0tdMbgahBygHaFOsWaoCoY0si5lpLSr44fVOsAD0pHDKpfGe8SpcWazy8AgkH9IeaJI1PvZaLuF1cjiP0lPwFRjSRcgK3Cap80NAEGy7MLkiJRPpVQBDQkllVpNyYuqlGYA0ifK4tbIEiEhwxG0pZZXJtM+FYlWYYTciAoLqd5NvKpllfu7ShDKrotKsSrgfS/id1Icx99J8KvTpVDByK3SwznD7Y+FN8XNc1wB9bJsQDOnpWKWEExIzewtCngGRd0yPCxutZjIubxYLtdpC9AOF04Evd4gBG3htJrGxUt72U6xqPOAOAFvyuIJECIO69G3h1HJmY4lpM/CP6TSiTUKd4cvM5dfaiQTE6L0v0vDtBzVLaidkJ4bQILiW5CLEbJ1iR56TJ8KD7W67hdNrBkbmB33hQ7hrQZygNCdYRhiDcXhRDp0C2zgWgFoa0KOhFwGAne6dEY0kCXKC21pBW0cBfM5oAKHoWOu1gLjsCnWEY8XiBGyn7o8rXdw3vgU7RrsFB4VmOZoP4TrCMgdpO3iVwvob7rVPCakgCmT7UHhD7mDCvWEZhkAga+1zdPlaR4S8Ew2Y1MojwgucWGfJgqXCNJ3EaTQdL6WSDj6RJ7iT7C8r1VSd5KMYiodXEq8J09KcXhyJIAkbBLFXDWE2AvbVYAe9xNz8qe8tEmSnJW6MRh3HMLDS6NtXDZonXdYJa4CxXZXCwMJyV6VlXCj7y0xpKstr4XKJc3z6XkIdu6ShJcAb/pTheo9ocZh+WYyN+V1TF4fuLS0Eb2uvDlziB3WOy4VHz90hP5nb2pq4cSWPYWnUTEIXGk5paC0EheMa97dHbporPBEOhODt6nKIDQRYXIFksszOIDvei871lRhJBJJ8KeuqNFnXATjTpu8l2UtNSfwgeA1hl05d4WA7iVYCM5nyFVqcSrk3cTsrnxqdY9C7Etab6N0EJD+ItDj2CPheafjqjpnMlOxFR2pK3nwz29F9SYX5sgjxChuOa9pOQTtZeeFQkXJTmVLfcU4TpvdUDeRbYhT1DoBDPwsRtcD+U7pwxgmMxTlemqKpPcYE+UJrNmM11ndT/7C6h1SbzdTk6aAfuHmPC7ONs0m6ynVSLyUs4h43V5Om2HHNIcfYlMbUc4wWmNbleeGLqN0N0Yx1c6H8pydvQh7gyHO/wAo+bVBF9fawBXxNQRdOp9Y8gyVOV6bIrVGk90mfCF2IqzIcZm8Cyo06eNMm4A3IVltLGWIMDXQrMWmjE1SIOaB6UDGVs0y4H41UFuJOs2PhE6jiST3CANIRQ9bWkAvdHhF1byLzBUHC1sw38AIXYKqLQTKeCTibkZJCDmA3yAyLqTgqwgRZD0lVosDHlPEQTmIAbG9lEkGcoMWsuGEr5fF1IwleYgn2qCloImL7Ig6mBOUAofp9dxkxI3Kn6bWkS5t1PBPU02kwYAR/UmtbAYZ8oHcNc03Ij4XHhhbrUBTw9ObxVggBglGOLkiACPapvwOW8iUp2GcASCN0mF1p/VnNNmk5tVw4oXAC0C9wsoNiCXaqRUaJn9pzh01ncUJEEgD4XfVHiTnEetlmB1MakEeERfQnLsfac4taI4k4Agua6fKkcQeBGZseIWaeRaHNHi6E1KJMAwZU5wrUGOfYZhIShjagp/ebE6bqk2pSkwfypFRrmxJB8pCrxxdWLPifIQsx1Vubvm6pFzdTdQXzci3hWFaAx9W4LwY1lS3iLxHcwfGyzHVNLE3uF0/1DYaJMK0+ucWlhe1GMcQIFQT4CyZvJAnyoLwP4y5OStluNdIPMs7UEomYogkZzGwhZAeIBIBITRXgXAupCtZuPsHE6mPCcMeHWcYbv7WEa4c3KAAR5RdRIgkA+lOVqgMI4G4P6RDDOiCD7stdzXk/aDHtLLXkxludQCtdMxnimWN+0/pSW+ldLKgF2AR4Sn03OEZRO6UViALRqu2sITxQqE2YNFxw75HbE6IK43zRbwpIG+icMPU7oaudhKoMOZHwqKvKB1QchpNrg7q70tcaNBC44aq0/Z+EpFIUXQRIkIuQ2x8eFadhq1uz8KOTUFi0z6SkVuQJsfwuFBojNf2n8l4mWmN5Xct8WaY8QlIQ3Ds3H4QnBs8KxynG5a4HSygNIuA7XcFKRTfgmna3pKdgfLbrTLKgglh+YXGlUmzDPsK9anOMk4QxIFkDsFUW1yahMFhjZQMM/8AtfPsK9JywXYSpIHld0VUaL0HTvJAyGV3SvMy32nZwwBgqn6TBhKmxutwYRxa0htz5R9FUNsv5Ts4efOCfu4ftEMBJALhf2t8cNeToI/5UjhtQuaIAO4U7OGPT4cwj7hdWqfD2NAkgne6vnhrw6byFDcG43IEbqdLyWzDUmkOaTG909rKRgybW1XNwwygACB4UjCkN7AYKlUzmsBylzhKIuaNajiDpZQ3DOBaBmiExuEqz/LyFlQBzQ4k1BlRh1IAS4kjQpgwb3feTa9kIwrWguzPMGClVwxdAWmSN1A4hSYCBm+Y0U9I1xy5nE6yIUuwjdIcf0nh6AcSpkua4T4UfUWtECnLf8ouhpkAEukawUPQ0w91nQfBTw9R14ezIW9v/SjrjIEDLsAETuHsBzQ6w0UDAOAPbP5Tw9KOMJJtYHxdQa7wLaD0njAuaWiPu8LnYMseZ1n9K3EVg6rlAiZ1UTVJhzZ/CtOoR3TYWQljmOzFzA2NUorA1IIFMmD4UO5u1OfkKznawtaHMI1Rc4N+0gu9oKfLqxJoz6jRRynubm5NleGLeIs0k+AjGJl326fpLoy6tHKJNKD8qlWkXyRFl6B0Eklsg6yqzsOx0w3tN5VzU3HnXuIP23Qc13graqYOm7N5BVd/DtRYELdxiazm1nwLXRCpUOoMq6OGw0Hcom4AC5MfhLhNUjVebGbIhWfb7oVl+HDd1Xe0AkybeN0PUtrvl1ipFdzgDBSc0E+Spa+ItbwrEp4rkGcplMbVcbhpkbJNOvlFhJVhlcNA7Z3U3FzRiTo0z5RCmYAA+FzMTMw0gnVWGV3GGhhnwst5pApPzRluAuFBwu5sHzK0KbHOH2GTqndKSJLQBG5WasT19BvaAZMrvqFBsWv5WS2kSHTa6kUDBlxPiyc4Vpux9EkEZiZ02U/UaN3QPCzhh2iM1Q+FJpUmuiTHiEmFX3Y9jhJ2O26h3EQbgiQLLONWk0xlcR5STiqQJ1sfCcnTSdxEwMpB8oBj3mZJErOGOogxywAuGMpZicttgrynS8ca+fEf5QHGVHS6SNkkYmk43phG3E0y2DT18JCpOLfIM/aFHUVDmh8AnUKTi6Uj+mELsZTEnKY+UhcQa7wfuJkrjWeLud3f8qOua6wZHyibiWEzlv7VKHmOm7zf2u5r5uT6TmubUkhon5Rim8kRf5UFbmOEnORPtSKtQAQ919TKfy6hJ7CANvaW6nWmCwxqLIAFepE5nD2Sp5z4y53XvquyVHi7HD5Ch1GrrDv0gLnvlvcSR7U9TUOhnyEIpPA+0qOTUAkNdfZA0V6kRmI9QiGKqRAeR+EkU6mgLid1wbUzTDgI33QP6yqLyT7hF1tbXN82SeXU+0TBvK4srbkwNUmKJ+JqyTnJ+QkHE1gZzn4ATcj72mfKU5j5s033CuI44yq10l99CuHEqo/mTOiW6ifE/hKdReDuPwr4nq+3idaNfhWqfEKrgO6JvssblOnUjwnU8zd9ApuYubrXbiX5nHOTNvhSMU/ICXOsskPdM3upzv8A7jHpZ5Wtd2LcNdN41RDEOIg5o8ysUVakH7tVPNeQe4gBOStk4oNgntJMG+qh+LYTabHY6rG5jzHeTGl0DnPIjMfwnJW67GUwDJOuk6IKnE2AQ1kti5lYRzE5TJn2u5RMgkwdlecS62ncXEshumhlKPFwHEuBGY+VlGkJsHFTymkXBn5TnC60XcSDjOpGwNkJxoqDut+VnigzaWn5XcgHRxDvlWYnq1UxLS4b2S+ryyYkm8JHTAg9zv2p6PNo63yr4TTxxCJ7R6Ck8VJsGCAk9EdJ03UHAmGwRB3KeJNOPEc1xmH5XDHtJibfKUcDBvUZHsqPp5I/3Gj4TwmrIxzBoZjZNbj6J8FZ/QwbVQbqDhCJippspMX1onF0S8mXaJdStTfoCB5lUBh6gMSYXcmo4bke1Ziem1HtIJEk7SVUqO2i/wApowz3SLhA7BOdq6FcibmqriRoP8oeYRtCeeHuJJkwu+n+1q4zNVxWLRpZMGKeCO1PbgP0mNwM6AqXFmkNxjmz26qzT4m5oAyyVLMBfQkpreGOcfsBjZTdxczRM4s47EflWBxiobZQWkbrqPB3uf8AZaFap8HIu6AY8bLG78tZn0JtMuafJ9JzKLQO4kk2sNEkYt7iSAZ0QnF12loboNln1tdbQpAkAG1zZEcHTdGZolyzjjcUCbgShOKrwbw06hJo0H4GnMBg08pT+F0iD2AAalVDi6xG4C52LeW3c6FZqeLH0Om8aAD2h+jUictwR6Setqk2fbeyMYypJIf+0/RMPbwdrcsuE72TPpdMy1tiPWqqjG1PI9hEMY4gAmb2hPSYsHhNEjQSl/SaTgbWGiEYqBaB8Im4ozcjMN1PSYhvCKRuDDTAEph4NSaDLsxF4Gy4YzWXCEYxjHG+U+wUukw1nCabXNh0DdWKfD6VKIbMnYqr1dNjSMwkmdUzr6Le+RJtKz614tnCMMQ2QLwDqudhacNPJcS4+ZhVmY6m0HM8Qb2Gie3HU2hreYNVPV8MODpvcZpOgbkpbsGL5mENJhMOOpDV4vYiJR/UKRZYgzpAT08U38PYwGKZ8EhAeHmZiGjSHarQOPpiCXNy+go5+FN7EHX0l0mMp2A3Y3W2qS/CmIDHRMG+q3X1qYDW08gE7qRVo1DlL2khXrUmPPOouAP9JwHkFLNGs4g5CB4K9E1lIBoBZfaVBpMdmyOYIte8p0R5p1J8jsi/hRy6gJMa+l6QYZkzLcxEzsAu6Vjg5wc0+LWV6OXme8NByz+FxaTAcwk/C9CcJT5tg2SJAhA7BbQzMd52TpIwYMtDmEnaymA0/wC2I+FtPw2X+LYCU+kRGZjZOkK9EZYDBANMn8KAKbiTy4Omi0qlFxYA4Nud7SkVqL4JcGgbQlFUMp6FvyYUZKYgFkk7wmvoPc4GGxulPw7wWntt7VRGSlLoZfeyAZA0HLJPpc5lRv8ANtzsoFKoQDmb+1RB5eYnJeEGZsWblPkozhqgMmJPgrnYV5BmD6lEBzAIGSfYQl4n7Rr+U7pahabgKOnIaCSPlAtxaTdv+VExchNZhXWuLoukd/I22QVxr4XRFrQrIwrpI18eVPTZtjCVVUTAvfdcXfIVo4bugtOtvaIYRxcfH/aVFIEtb3CSPSmIECyujBOzAExI8KRgXEluYT8JVilFwVABmdyr5wVSwDmE72QuwjzF2+ClRTifa5oJvEJ7sOWkkuFtIKB1I5ozCFQPcSO4QNVPLJ1cPVlxpDK6CB8J7MOHBsOIkXvogVyjDRmM/CIUpEF5j4VlmFa0hoebeE52HYwSXz8BZqxRDGwQXH5iExrms+4zfwrBoU4MyQNZCAUqbSCGvObfwlIHnsETTDgdUwY5lOIYLLsoEBrDIFvakNBE8nXyFFR9RMGxE/4QHiLg7uBNtgpDczRFHS10OV7TlFKTrdXwFFV/iAb3UinWcCHBvwCjbiWzZgIOoTmV2GW5Zi0KCpyqrbQPV0DqNTVzdPBWkMTSIaA31AIsp5lOQ4lzY2lKRlupPdbKSVLadUicl1pOq08wLZzEW8KXPpOOWXX1AKUZho1JjJY6qOQ+fst5WnnYWAXBIsgLKbgO8yNUpGcKVTNGUQPS5tN8fa2ZsfSvvY0kPE6RZQ5uWSRDQNSlRR5W2WB6UwDbL+lZcy2pE7yoIMRnMwrRXyEQclx48KQNuWfaYM0ubnygBdDiJ5n/APUCi25hhB+FwMz2nwVzi4tP9QZgNiuc5wEhwjcIOJi+21lGXM3/ANRqUt1ctyw6flC7EuN84j/CsKeWVZ1Ab5UhlQOBD7HyqpxNU/c5sIepqOmagM6hIlXw6oATMD2EwVQ0dxMkxICyXYt5N3iNCoGJdJ/qW2unJWwatNsAZpJm67qAO4h0hZQrmLvN91IrnepKkWtV2LaCNQYsVBx+UOABvrKyzXd/fM+SgOIkjvMbq8la31YtZAmBaUI4rUDGgNJPysrqLnuJHhCcVBIEmE5Stb6nVN8pnSxUHiFW8NuLarH6uBAN0t2JdGpV5Omz9QqNaRMD50Q/UaoEZhb2sFzql+510kipqCflXjE6bz8e6LEyL6qvU4jUc6zz8ArH/qeSVAz+1ecTpqHG1qgPe6PlQKlVwIDzHsrPaHkbpzA8ECdVYlXG82buufCb/UFi8pNPPa4nxKvUnOBv4WdawLH1dJPoyizVZuD+04VcpvpCl2JiwEwsqrtfU1bmPyVxrOa7NeSjdiRN7eghGMpCGxbzKFQcTUAuNdlzazmjLcjXVE7EUHiM3dbdOaaL5h0IK4xTy282Oyl2LdLZVrp6dRpipEeUVPBZs3e0AHUqXFUziXk/GigYqodTfwr/ANMP97YNySlnh7QJ5jSfUJcFM4p5P3H8KDjHH+Wmya/DsOjgR/wqVWiQ6WmQFrIm6Y7FvA+6yS/E1TcOsVVfnE/8Ku+pUGhstZ8s79LhxlQfyQdc8OkwqDqz/CSajoWuWemqOJuAubqTxhwIIj37WRlc8g3TG4ZzjonOJ1rR+uP1EKDxyqTchVmcPc/+KezhD3HQqT5W/Qzxysd7eF31uuZuDKlvB3ASRAnyms4Obfb+0/K/oscarwBOnpOZxbEvAvZMZwwN+7KPF05uBym2UjTXRZ3cXM1A4hXIEugeNlY+oVSZLhIQDCPiJbJ8lT0tSR9sfKz416FtSB98HymCuwO3jyErpqg/gSgyVTmGQiEFtuJZJaMwjUqeqZP3EnwqjaNQgdhkI+RU2bdJi1aGKp/cTf50RHEsINtBrOqpch8EZSBpK40HgXdf4SYVf6hhibeO6yIVhpkJHys/kWbJJ/CI03QMrj8qQq8KwJzAEg7E6LjUz2c2G+3KiGyM2Z0LuWZuT+0gumpmt+jKW54v5GkKuGvE3+FOV14LffpIGGoCdPeiF+IYB9n+NVDWkAfbPlESWxMEfCoX1A/+sSgNckOtEpwFTWR+kNR72gdsjeEFJ9YwRlBPmFVfWfa1h6Wi8GbgwkuAIuLD0tZrO4zjWralpP4XZqrv4lW31gAYGhSXYowVpklrKrpsYRilV2H6RdYJHaYCazFt2ZEp6AFCvoDZF09Y2m6t08TTkgsN9bqy3E0w6cu3lZurmM3pKxEyfjwns4W51y+D5Wh1NMGxMRsEbalN05XhubWdVOtamKjOFNyiagJTmcLpECX67q1LS2A+4UBrHXzRm1ErN1ZhTeFUAYDpHkJjeE0AAAZldNNgs8uG0bKc9Jts77nVLpMEOE4chxLhLbXQv4RRDQQ4Qf4qeZQAOZ8nYTqu51HKC6oSY2OinpMVH8JoAkcxgMeUv6ZTBA5rZ+Vac3DvGcVIcfJSHMpOvzQZWrqQn6e1oP8AVaWqRhCJuPSMUwWGKsXTgwNAl5PoBWpFJ1N7I3my4ue3crSbSonc+VxpUiYcDGxhSkZwxZDgchIXDFsg9pF1fdRpBv23PgSl8mjaWTfWEuE1n1MQyNHFV3PZsHHytXk0YcSwi+sIxQw0fY4fAVsTnWMHM1yk+E9tRoFg4LW6fDQIZfz4TBRwzQAGkzdOl5UaT2z3AmdJVynUDmu/pmyfy8O29yNhuFYBoDKM9tFjdazFPmEgywtB0ukOJY0AtP8AwteaERzGiRuJQVOle272TNwlIwXEkxlISTTc8HscCvRPp4GZm/pc1uD3eIO2hCvScvOtwRfIyu9mFx4YYHYY3leobWwVMAkyWzojbjsK3MLEEWKd6cY8k/hJ/tPqyg8GfqWPA+F66nj8IWNJDbCJIRniOHBgOAbFxGqd6cY8pT/0/ULhAdHwr9L/AE5Utcg7WW6OIUIyh5A1AK44+nILa0OO6m/f1rWfGMunwJ8kS5sbwjPCarB2vzRsBqtH6k0lw5nboJ3SzjqbXnKO7WxUurMZ7+G1wC5rXEgxCh3C8SPtBkjTwtB/Esr7Ak/KB3ECJgGTaQl08Z/03EGbXBjXdD9NxLXOLt9JV5/EILe0HzZD9TfJlziNu1W6nig/B1xYscXA7DRc7D1GtMseBOwV08TL5HcDqRGqW/iTtDmj4S6eMT6o5wgt/wAqfqIdZw11Q1MJBy5XZvQSH4eoIAaZK6eOfq0Mc3STZcMa12pNwqBw9f8AsK7pa4uGlJhdaPVs0E+oXDEiHXv5WcMNWbsblEcLiANDCTDpoc9mu8KDiaZtcQfOqznYesBeQEl1Kp7/AEnJ02BiKeWC38SiGIbIiMvysFzKrdZnVBzagMyQrwnb0La4gyDc+VBeBdghYTMS/wAkJ7HucPvdATle2q6sIaZ7lBrhv2vglUmUc0API3TDgSBZ5uVJi084xv8Ad+UDsfk+0gRslv4VVg5TKQ7hNcmBJO8BJiXVg8SgWKS/iDXEzdJ+j4h02JRfRK4jM1y1PlLoXYpjrQIQc1rtAPkq6zgjxqx6czhMWyPj4UuE1QbB2Ca0sG3+FdHDi24a8hT0bhADXfClxYqCABlMX3Ckjuu620BXBw+q4zlMIhwusRBbBOntLhNUi12b77fCA5gfuMi61RwmqTDgZ8Kfo9QiRf5U6xZrG5zmkQ7RMGLJsXFaL+CVACSISHcKfNogalW5pNwkYjO3LJTRUkaqW8LcCSIiLpreGVHGBERMypsMpGbMba+1JOU/P+Fc+m14EZI9lAcFUBjM2Qb3UuKq33gzohgBsf8ACsnC1ATGUiNkBw1VoFgT8qhItFoujEk3Fk1uGqi53TafD31DLRulFWZJaNQuBMkzZXjwuteB3eFDuGVsoMfKlxYpCQIBubqAe7W+/haB4XX/APX9rhw2oQTpGyXCKEnM1TmdJg6eVd+muMh7gIOx0XHAZYhw1hLhFEkkWJkX1U5n5rOMQr5wDxcAEruheBJ+4eClwijmfrJlcMxIuVd6YscGix1hTya0mGiJ3SikA4S0E2UZahuD+1f5DyJAvuu6d0B143ulIolj5/7QQXm4Nlo9IWiS4x58rjgsxDQSQRqlwjOhwiRYrswtB0K1W8MabSfRhSeH0ZEuOsaJ1hGU4kiPa41MomTPytOpgaLDIH5SatKiCQGhKKgqszXcSp5lK9yR4lDUFMkQWpYYZdEaqxmnGtSOua94UcwaifV0DWEkm10XJOpFvlChdUcJjNf2lnFVWzBsPaZynB2gj5SqjXbNBVxN0p2NrNOoulnidURJ0UvYXQQ2wSzR0JatTEuj+qVXH2i+o1iQbR8IGYedWwVYp4XtsJAU8Mr2jOH03Tew/kCLovp9BrSQ+YHleWdxPFSDnMjwUB4pib6/tcuNdOsendg6AsHk5tTOiU/DUqYgPkzuV5wcRxBAICYzH1hBIBKvOlxuNwTHywFv4Oia3hQfBzDJpc6rEp8SrNIaQAN/aeOLVd8uUaCFJq5GuODUDANRst8lDV4Ph2kARqN1ms4zUvJa4zZGOKPc1ssAjypPo8NrcDouJLRfSJVN3+nQ6+WJ2Vg8Qe+CBedQuPEahFpAbv5VzfpJir/8clwIZITWcAawEvyt9EhN694s4uIKnrzY5Cl+jnEt4PTDW6AHedE1vD6bXTmsdAUg8QL2iCQd4K4YwAQc0DynqzFluHYBFwNsoBlMmkxzG6TfTVUBijlglwvsUHWZyZmxhSaNTnsZIayZsTG6luOaJDmNBA2CyTiXF053fBQms4lxzFx8QnJWq7GUzeNNm7oDiKZfmLdtFm5nuMkSTbRSOa68GfSQq8K9Az/TAO4QmtSbBDYjUFVBSqa+DclQ6lULm2sZFlYLTMS1suAF/Kl3EaoPa0FVuRU/+uB4lQxlSINK43SYVYPEqn3RcBB9QqgO7YJulspODD/S38aomMqGZox4SYO62rcme7WUHU1SB2tPkkJnLfLppmNZAUtY42yFzdigT1D3XtlUOqPJjNA9JopO5YLmEnTwjNIn+P8AlBU57gYzklA6vcZnRtCtdK5xs0iTeUDsDmvkg+9VfEVjWj42QGsR3AknwrR4d6vuQljh7hYm+qXBXOIqNMh9/BGiNuOrt+2oL3sEw8PeCLShOBeJgfgK3AQx2IH/AJvOyk4+raaoEJfQ1AYkwLypODcHGGkmLwnh6Y7G1HtjmD8brjj6s2cD5S3YNw/iSPARdIbQCCp4epGNf/dE6hC7GudEP0Mo24Uy6WuMbqW4Ugu7CALJ4EnGvBJzEg/4XdZUNjp5lWBhRoxk7qRhBBhpj5uEuHqt1j4ygn5XHHVG5YAt5Vg4N4NgXegp6Srrk+AlwVTxOoI7RdSOJVGxDRGnwrHSVpPYJGxS3UKjBlNJsi8AK+HqBxGqXTaAoHEqg8eknPUb9zL/AAgGIN5a0/hIlPfxSrZ2ke1Vq8Vqkk67gKH4gON2Nt6SHEG+VoJ1srmYm6XU4lUfGYkD5SXY55Mko6lMO0IHwkuYINh8reZjG6jqn3vCjqHH+Z/ajl+gV3LJH2xCok4l+9Q/td1NSP8AcJHyhNImPaDpzpuniHjE1P7z+01tZ5gE/wCVTFEwja0zqQkVoNe65JBRtcSBLRI2VSmbaq1TaNdys61hofldZgNk9tYtFmD9oqOGDjZ37VgYG1nOP4Wd1rMUBTsYbdSGnTKSfhapoOiZA8WUct7ZzkeoClWM0Un+LHZH07zByb6q+GFxykEx5G6MUnEZS0wL2UpGeMHWcDaEY4dWP3CVpMbMgA3Rhwa4MIfJ9Sp0RmjhtYFoDCQ71onjhtYiSDHiNVoNquEQTk9yCjOKcywJDQl1ZigOGVYgAxpBCY7hzmj7Rli5AV0cQDXZSXfJUtx+S0FZurMVm8OLoOUidFw4cRctJBOgR1eJ1Gh5YDmO8Kq7jGIaBJIMXgK5U8WfpjJg0iBsfK76aAM2Ug6EFZjuL13E5S6xmZUfVsUXfc6FZ9J1jV+mAGJJgWBCZ9KpSHEWGsrKbxXEOcC5xICc3irhZ4kOtopPpbjQHD6MwWkjWfSYzBUc5hrr20We3iAaCBIk2B0RjGiqXNcdLqTVuNA4WiJytdOkFM6VrAcpB8LNOJdl7Hb+dlxxMtINQg+QpNLjTZhQA4ODTJQmkXEZW2nQt0WS7HNaDmc6W3QnirIkOdfyrzpcbVTDucABGokelDqD3CabmtBOqwHcWDC8tfEpFTiwMtzkA+1eNOselNOpllpZPrQqC55GpEf+q8i7i7ohlQgDaUDuLOcRNUx8q/z1nvHsRn/k5pHwll3Le45oaYsAvIniQdJfUn8om8Tbq5+uglONO8esqvZB7gSL6XUGtTLg5zmgjSQvKjiTM3+4LKTj2Pb/ALk/KcL1j1TsS0NJD25osh6pglxe0vAuQF5puMn/AMghT1ECGvEbpwdPQtxrAM7nCSNglvxzYJcRJ07RZee5/a0czTwp5jnH/ct4Tg6bz+IsYSQ2XAawLoHY8AEgtB8wLLD/AKlRsZgZXcusLNmFecK2DjvuNjm+Ej6gWMaW5RNlncuq6RFwoNN4AzBJiVpHHOmQQJ1QdaTI7Tm3CoMpVCJiy4UzpoUmFX+sIaQMsaWUjGPiQQBCzxTO0ftdyyb2urCtAYl8y17Wg/5Umu97SDUaDus5tIxYBcabtDlzbQkK1W1XyHc0DaFLa9STNYATI3sswB5MANtrqiPNAhobpupCtQ4l0yagyzEbldWxDiBDx8wsz+p26KQTmMm4SFHVe+PuEzdU3mLk/oK6SXCXZfz4S3PAOjB5Eq4m4z3ObeUo1GDXdW6pZpaDtKp1MtgIlbxjQmpT83Qg0suspTmiPfykll7arUZXQaRO67K2TdUYftKIOcI1j5SFWHfFggMna6WartLyhNRxMXSA4NpK4NE7ygHMd5hMbTqmDCBjWAakq3RYwG5n8JDKNaJyKwynVIE05CzutZi/QfTa6SdtFdp4xuUFZLecBGQbK00uBGZggWCxuN40BjZgGJOkhNbXDjGXuVAc25yC1rpo50ZS0ibSFmNVdkNa2RM6lFySXS1hF9cyqtdVYGgN08pvOfJkGB7UFg0O9ri1wgebJjQ22qqGvVDCA522qccW8tIJiRcQop4o5nnMHEgyBGiZ07czpkAXkhVWYwtBmsSD5UsxhBLnVSGgQBKk1VtuFpvpiZcT5CgYGjAa93eLyFXGOBf/ALmo/SA42mReu4bTpKTTxadg6VgWi5udgqr8BhXFwD+4SAApdxFuYDOSCNULuINkRlImZVyp4qOwNAy4OtG+oVU4dgbP6AWn1zS8kgD/ALS+pY8EkNk20Ws3WYpFlMGP2jaxpHbf5Tn4lgBlrTHpLdigJMATpGgQguVRyjO7KdbJrW02gXJPwqruIMbEhtkI4oGj7Q4HeUmni2HUmutpuEuo6m7tdMeRZUqnFW3ORo2kOVWpxMwQLz5KufOpcaDzScQ2YPjWVUqUWvc717VR/EriAAUo41zpg63JWs+dTdwyvh3NiLhUKtGrfKZ/Ks89zhYi6ENe4bQtZ4zuVmVKFYTeEh1OuN1s8h51AUHB3vqtdM8sT+uDujHOI1Wv0TZMXI1UHBtG2/hXrDnWa1lUkSb/ACn06NQ6uH7Vzou4x4UtwTjvCnS8kMoVRMOH7TBSrgdrh+09uCfIkwE5uBkTnWasVOVXi7v0UbTVbBLzZWm4IbPJIHlGeHAts9w9KXFmksqlrh/UKstr2/3I8wlnh3h5slO4fUm0wnmnq62vnBPMFx4TM7Tc1h8LJdgni4fYe0DqL2/zN0mHWtlzAX3rNiPKW5gAP9YQFkZX5speUxrSbFxI8pyvTR5U3ziDoUPKLJvZVRlBEk/KMOa0kZid1IU403Gx0Q903Aj5Qc2nAmTBUivT1MT8pCivBXfcFDKlI6vAuiDWOvnAjRFoZg+ipkOJAJlHkzEwWki6kUzrZAogOOYzohdTa86aJvJdBBJUQ6JDCYQJOHpkwJtrdQcPTkgDu8J4Y4STuV2U3sRKUhHTU8txZd07TcNt8pzRBi5HtRmO4AKVIV09MatgH2pNCkIBFimExcXHhTJO0JSF9PSAsyR8qeRSEzTA9owQSRNwoA3klFgW0aJOYNP7TWMpAzlP7QgXAXEQCSZKB7atNpBIibJ4rsaMoAM7FUrH8KA2JJ38qK0hVpkgF/cLJjTTDru1E30WVEjUfKmHC+Yx8qQrV68gFstIJM2uodxN5FoHw1UhgnOBsQfYQnCvmL39JMLqyeJ1Lfyy+kJ4pUIy5W+TZI6VwtoBfRQ3DPIzEiDsrMPTncVrEEENM6ABQeL1ifsEJYwb80y3TRQcKZgkX8JMPRHiVUj7WnXRC/iFQ5RaAUDsG6A6T+kJwLy2RJ3sr4npnXVHONwPgKBi3vi4kbpHRVCM1yD4UjCVRGoCTD001qhIJdELua86uJj0lcmoy5B+fS5+cRqPwkDQ98k5jdQKz4BzFVy9wFhEbITiINwCFYlWnPcdXKMxOp3sqoxLIgssiGKZGhCkWnOg6wkuDREjXwhdimQJE+0l+IZYaAK5jO6dy2m0Qp5TC4dwgjRUTihM38IRiWj2Fqalxf6Zrido3XHCDZypjFzun08UbAflSatw9uGAJ2KNtINtmsFDcQT/ABTG1mu7TSneVPV8SB8EKRJMZSUYr04/2j/+IhXZoWEg6qKBrBoB+kYoCBLv8oxXpEwGECfCk1KZ0kebKK4YVpMz6RjDMJEAkCxuhFak0GzpPhczEUxcBwJT0MGGbMEWOgXCixos021AQNxQB1dquOMh1nGD6U9DQ1gMGm4lFlZJIF/CR1LiCOZdKNYAaz7SFX5puByjL71XEUcpsc3wss4ssMAmEl/EAHfOpV51Omk+nSIacsRqCq7qVEm1OVnuxwmZIlLOIzE/1CtZ86zutHlUJJLIHtE3D0JBOo9rKL8xjO5DLtQ8yrErX6ah5GVd0tA7x4JKxy6rbvMFTzag1LikK1HYKkXfdZL6Sk1slUm1ajjGZ1kYqOcLkpNKuDCUmkQLfKczDNvlkwFRZVI/mYVyhi2sGuim1cXKWHOVpDS4lXqOFeQCacE2NtFWocWotP2GwsSFfpcYw+UB1Mlc9reRDcExwBgEb2XdDTDgA1pbv6T2cTwpGVrIadU6ljsMRDWwPgLPrXjPOCa2ZE+BCAYMHMOW5sbkLZbXw9QgFriQdSLJgfRe6o0gnL6U60jAdgst4mTExoo6EkkOpSfjVeiyUXNaWgRMoWtFJgaAXO2Tojz/AEe3Jt7EITgiXNBpH5hejNOmHBrXkZpJJuiNOkGiX3iABuU6I8wcC1xjlFkbkLuiYbhn5ibL0rqdCAH5ydTGgUGjQcLOv42V7OXmujptdBHdCjpaVhEr0LsFhXjM4tJ8goOkw41DQSdt06I8/wBPRv2wd0HLozcEZYXoDgKQcS17O43nZL6KkXOYHCQBeFeiMCpUoMP2GB7Sn4umLCkCF6McPoVR/E/I1SncKo1CQA1u5Maq59Ym5rP+pOkXbZceICo4Zi3tVEYcA5c2tyu5FMSM5ndWYnrQbj2gkWgW+VHXUy03bA9BUORSZcvcZXZKWaLkJMKu9WzNDXtzRrCh1cy0h9ORqqmSn9tyULaFP+LTE+Ugvc8ROZpMbKG4gAZnFsx5VI4cAtOUj8ruQ6Tlbci2qTBd6unlABAANyuONpnSx8KkcPVzWZ2+Vww1Uz2wdkmFW3YumQT2wLIS+n2gCx9yqow1QhwAuDBR9HVtayvgKpTpky1vcfaU7Cg3dTHwCmdJVEZjA9bIulM3qGClIrHBse2XUyB8ruhpkRyo/KsckPkcxy7kDM0io4pUit0NI/x9RKj6fhzc6FWxRmIeSJmfK40xYmZ2SkxWHDcIbFyg8LwTf5GD6Vnl03XIMqGgOEFqt0mKx4XhG/a+/iNUxvC6YFjJOyc1oBgAwP2u5c6ZgBul0mF9CGnK3XVC6gRJykEWTw1wkS4j4XS4nLf9KUiq5hLhZ3pS2k8tu2/lWYqOfABkIRRqku1mdCrSJp0gWghp08qwzDtcO1l98xSMlaQ0OIOkBTysT/cbrKn9JTmOXD4mZUDDsLoLBIVfl1mj7zIspNLEZhclqBrqDGkHKA34lTymOFmj9JAFS5JMIuUdSXQUEikCJc1swgykbMDY0hMdTDYlriTZE6g3Lef0gqVaOYmwVR+BzXIBC2BhaRIu78KW4aiDBm53Vz6iSvPu4aTcBV3YGpHaLeV6ro2E9oNjpKPo6QsG/bdXtOHjjhqzdGqMlQatK9p0dCzjTN9JKjoaJkmlJHhX+icPIAOkS0yrDBYSDK9IcAy0Uf8AKA4Km2OwtCneHOsWnhebcJo4Y52gMm60+mLXHKbC3wj5dQGGuER5U6Xlns4E/ML39lNbwNzdTcnyr1OriWT3CRYeUQr1ge9wBmwU61ecUxwpwJANx7TDw6AQdN4Ks82s0CJv5XGpXzuhp08KXVmKwwIptkg2vqrLMK1ozEwNUt76meX5hbRC7nPcD3QE9F+kWMa7ud69I+opwMrzm0vN1lvFckSTG8IHtqG+Z6Ra1eso03uhxAA9ojxAES15F7zKw3tqkkS423S3MeDJzfEpzhW/9QY9ze7uHlcMYCXOLr7Elee5DyRMz8qRhybzMeU5wut7rMoDQ8B2pvMqH4xogTJHk7LEGGfmIJMbIhhCROZ17Jzhdaz8SwNgnTSDuhfjSHAg3AiJ1WWcNctL4lQKIcD3gkWVmFaLsYJYczRG0qTxOLhwusotDSMxbPhA94EWF/2nOJWqeJmA3mD38ITxKIAcAItCyc/ebCIUCo3aAVeTpqOoUnEdxB3AKHp6bYEkg2BKq5XzNralQKdWSQ832QXBQYCRmuPIQjCy0NzaGdFXAqf3H5CY0PES96gfyiDIIsNMt0QpVJ/iD8Kq1zwI79dUQkTFR4HwgshlW9mgBc2jWixBHtKFQ6Z3SN0QqEj7/wDKij6as5vbe8ojh6wu60e0vmVCf9x3xKHm1D3EnTygacK82BjN4K44ao6NYF8wch51UENGa+kFTnq5YDsoHgp6OGHrC4lwiwlCKFQdo11iUxr62UAOg/CJhrRJcZ9oEOw1QD7dPBQcpxvlBjwdFaLa2+bLuQi6eoRIOUanylFLISPsi3lLySNAW7GVo9FVAccznSNFHQ1CBE5T5VpGcGkOiBp5UHM2+WQPa0Tg3hx3tshdgnSJBn5SkUJeAQdz5XGq8xeANbq2MI4GSS6DELumboWz8lLiKZxFQAZSCPak4urFiP0rXTtB+0AeFDaYc0EBoOl08FXqqlodeNFAxdR5BzEFphXOW1ndAcRbRdNNpHa3uPhKKfVVSfuMgyp6moWwXO83Vs1KYyEgAlSalIm8SlFI4mrkALj8qepqgaFytcylJvaJ0XF1NrSAfdggrdRWgy34suGJqaFsEaBPNRjdS506iF2elAMR+FQnqKmhaT8rjingXaI9poLJJJn0FINImIJESFAk4p5mPxCIY97db5dimDlCe3KTcSpJp/2ZvMIBHE3xdobPhd9QzPJ/wiLqYIOSc2xRFrLQ3fwngW7HmSQCXFC/Hl1yXAAaTqmnkgTygR8JbzSbpSAbvAQQca4wQXAbqHY0ki+86pbq1P8A+oAIRXp2/pgg6FWJTXYx0DKSbqDiCTIe4ekDn0ybtaAoLgCTLI8Qim9a/MDJ/Wi4Y6p8wd0guAMQ0HVASQQCZ9pEWxxCqCY/5UfUapMFttdVVEEkRA8kLgYF5CQq2eIPdIIGaNUIx9QAwMyrC0DdQCQCIv8A8pMKtdY+ZAF9lBxlSRpAVefXyo0A38pBY6upcgz6RHGOzZiBEKsILpBEFcbg7+kgsnGZhGUEn2u6uT9mngqt8Nv8KIjT7ikKtDF3MtNrgSuGK7dHAqoZB0mT4RGRqLJCmHHOvLD8lKdxCAYEhFkkZY/CWaUg/wBMn8K+HpL8cTJ8pDsW4E3P5V3pAT9sQFHR5rhpHyFc3GZrPOMeRoo6upqWyFo9GIBDLeVAwhIsyytwmtFlN79QZG6aMO4kSHEg6wg62Bof2oPFWyBDp9Ln61T3YfJFjf0uNE5j3jKqTuJMi2b8qtUx9y7u+FedOmpAaILjf1ooDg4OgjXdYNXGkiQXJJxhWuU7enYZIawtgWMwrNKjLyAWgka7LyLMc4G6u0eKlke1N+NM+8embhCHEBwDRqTupbgKg7eYwHWPSyGcZ7ALCVep8YpOu5oJCxua3m4ttwDybvaYPkLm8N7jOUSYHdqlsxlCr3ZQQLxKdzsO4ZnAkahZ9XxJwD5gPAPyp6AkkF4ge11OpRJcGGBG6Y6owAQRJjtOyehfRFggvnwA66E4Eh4IqwCbyU8BoMZhJ1MI+SDAblAi8qUii6g+m4RVJBOyYKD7jNM6iVZFOkQ8/wAmeNCoZToNPMf/ADHlWkVukqm9iRpfREcO/NOW/nMrho0i3K+Te0GFAOHpnQjydQpSKHKc7MQLi2qS+i9lg0dxWplb3EQHEzBOyCaYOQAS3ZWkZgpuENsXfCAsAM5b+IWm+zjp3WhJcxzT2xEayrSKYaAQC0/pcGsvLbNPhMeHhju/UzIVd7KpaYfaN1UOFGk6JYIC5tKjncIvFjGipllbtJdceFxFZxMgpBcyUstwJnxZLeKYgty2VFwqtbOV1kl1Opdxa47/ACrErRL2gG7f0oOIpNaZaLb+Vlup1AD2nu3SXtqts6x8BXlK0n4qi0k5WRFlXdj2NE5Wys2pTrRJsqzqVY3laz5xnfpqVOINOsHwkP4g68OACynUK5m6U7DYjRbz5xnfrWo7ijhAzT5ug+rPFgT+1mdHXN5UdDXTnE61qDiryIk+VB4hUd/K5WcMFXBTmYOrukwurJxT3TJud0Ta5OuyWzCvuCbprcG697J4vo24gDW+6MYsbGyWMCTBzC6NvDQdX/lTxfUnGM3uVHXDYFNHDKY/lb5TW8PokSP8lTxfVXriR7RHFudYC86q2MHQYNDHypGHpmMoMjWVLhNVxXedrplPmvuQPQTWUWub/KUwDLe9tJSrlLFGpoY7kbcHUvbRWqdZjCMxMjwnjiTGmOXaFm61FJuDqO0Me4RHAvIMuAHwrn1Wm5vdTn4XfVqZM8ppaPSl08U+hqX7xb0jGAdLbkj0FbHGRY5BlBsPKJnHScwyt18JdXxXHDnWBcTfwnDhtoBMH0jPGWPAljS0b7ymfV2BokC26np4U7h7WnuDtNQEz6cC0mXgaaJw4yHC+QjUIhxgjR7bm6n6XxXbw1rg+c3b5CL6XmDb66gpx4uZbmePeU2Ut4rlLpIIOgU9PFf6Xl7CSQBNgiHDLggw3QJ44u3K0uBJJ2XDijWiAARO6enjy2gJJMTOqRUe0n7tFpO4VUkNJN/WqS7gtRw0PoFdc3GNzWU9zSbuKU4t8rUdwR4AmZ1ukP4Q4eVrNxjc1mw1wXcpusrSPCCWzmgeVI4Q4j7pV6wms3lNBF0XL8Eq/wDSnnR2mqB3D6jTc9vlLiRVbSIAuZVltJ4uJhQ7CVAYzG3hRy6g/kUFxgqtIuYVqk+uCRNxostrqw/kUYqVh/5In2s7jWa2BVrOlhdBHhMDqwl+cidZWKK2IBs4n2UwVsQ43qW8Kcr02mvxMgB5O+iLm4kENzST60WO3EYif9wTpqiGKxA/8mqnK9NfNXBcXvsfSIPqfbniNLLGZjsQC6auvtNbxCvDZdceFOdOmoX1A4jmEOOltUTs5Ye8j1CpN4hUcACJHtWG1y94BLgCJ1Ui06czmk1YLdoRtcDJFQmd4QlpIsHD3KjIQCYJAECDZRUmox8g1D5so5jTbMQJ1UyxwaSwyfBXZQ0xyjACDhVpB1iSDe+il1XD3Bn8BSadOQzl2XGgwj7C1o3RXHEUQGktEHeFD69IScrGn42R8pn/ANcNF5KA0Wz2MBdungTUxRJOVrY1Cr1KpdOpJ2V8UWEBxaG+Us4IZrEk+Arm4kZ5cdnW/wApbhJhzwCr5wd4AmZSauBfIAY431VqRnVKIJkPlV30AL5iYWlUwLxpm/CU7C1W/wACVrNTflnGjcCSfhcGOBiLq8KTyPsOvhRy368sx5hWpyp5DuJmyKcp7gANk6pTdrkdGxAVepzLw0j8J/1NwRqGJAaUp9ZoMWB8BV6nM2mFWfTqnyCVrMTdWzicuh1UDFQSQ7XZZ7sPWOx+UPS1js5amM3WvSxZ0ziYVltYvbOe8rDbhK4ixVqnh60gQVncxc3Wy1rSZ5olNGHDompBnwsplKsBv+VaaypDQcxlZ3G81d6eHnu96LizISc1/hVsrhYl8TrKLOWkiXGyi0dRrmtgFQeYNLwoOJc2TBMf5U9W8/xIT0oS0kic0qcr3SACY9pjcU+wyT5lMFYumBHmFBXNN7WjtMzoFJovAgtPmyuNfJgdpR+wJI8pVihynuuGu8TC7kvcPtctDKYIk30XaT48hSkZxY8fxJHlcaTgZLXSr5Nh2iAlzOsz/gq0iqKLzbKuFGpu2AdCrRqDPvP/AAu58atMjQwlCBh6giwjzKnpav4PtPGMYAZbop+osgf0/i6enivyKuUX19qemqyL2HtPbxCkzVpJ9lcOJUWGZdHgKenjVfUa42JJGkqC0gOIf+hdYDazxPeZCaMbUbJDjJU5K1nAkAySPi6Etk30+FnDiFSbEqRjcwuTPlJpVh1ANaQ4ks9N0UOoAiz4PwkjHvc277zsEBxgPbv5hWaeHnDtjUwQlvwgcJl0E6FD1hiIkeNlHXPhomD8J6eAfgQTADlzuGiZzEBSMbVzEki4Q9XWn7/xCvqTBdAxsXJPpT0FMht8p+Et2LqQDJtso6mp/cfKekw0cPbJaHWhQzh7YaM2vjZK6ioT9zlHMeBAcZ+U9Ji19NaCJqH9I2cMYZJqEeAQqRqv/vIB1MqObUMgPP7T08aTeGUDP9S4Rs4fRkAvn2Fk5nCYcQT7Uh7wPvNvak3/AFfGw3A0XNs+CfaY2iykYkuPpYRfFzP7RCq/QOcI9pCt80xECpd3sKMgkAuHbvCwWVqjT95J3KJuKrAuipclTla2yGS6HwZ1AQBwLBLiZ3AWT1dUHNPcfS7rMRpzB+leUrVLw4ElzvGiE1CW5S4gmwCzTjapEF0xfRR1tY3kW8hOStIVHNs57nSPCjm5QAJneNlnjGVROYg7aKOqdpASFavNbElxhEK8G9t5WQMTU/8AX4hca4Jg6eU5K2eaRGV4Ga5KIYgiATm2mFi9RdrSbFGMRFp7Rspyta/MdMcwAaCy41L5cxc74hZIxrWxe58oXcTawnvBEeE51K2c1MaCZOy4mmS1mX87LDdxdjZyju/5UHi0lpjROdOsb3Lo3mL+9Es0cO4kljYNhdY/1MvIJFvCMcQd/IWI0hOdLi87CUHasAPnVKdgsM5whoI0JBVU41xYMoAjyu6uR9rZVmniz0eHmAABpCYKGHAIFMS32qgxGZwzBstU9U3MDad4T0WhRp5QOUJP+EQo0jMUmg+UgYgAky2CjGJAIIi9lFH09KYySTdL6ZribOEGIiUwYltMzlB9pjMYGl0ME66p6KjsEwxqSNSlu4e37pMfC0W4xxd3U2Og3ATBiW5cnJblCXSYxnYEA7pTsNlOhsvQdTsaTI2MaKDULm91OnPoJ1qc482cwNgZG8JbsRVZIynwt2q/PmljMotEKnVeCAcjQtZrO4yjjKrYGUmP8KRxOsDIF4T6rWkEAX3VZ9EXgLfjPp7OJVczZFvEJ7Mc5w+0A7LLdTLb3soDnt8/lOcOtbIxeYQWftFzXEdouscV3GxGis0sSQZiPSzy1n0vnmOOYCDogIqkdwt7S6eID233T+YHTpHgqLSS15nwkljpIgQPSt52jQBCX5j9tvBVFM03SZKjkq5n8M18KGOfYEQUpDHYR+n/ACgOFqwNJVipULQZLifEpLzVeL5gI2KilchwcQdTtKAy0kS1O5VQiACknDvefkaKoHOBqUJrMEXsudgHZoIddQMC4bOnwr4nqQ+nqCfCk1WNtNkTcE6JIN9LIxgSJzAhTw9I5rTd11wqMLh4hNOBBJF1DcA6QIMeSr4eoa9rifmEWw8om4Aw6dPKMYJ7bi4Kni+kzIg6+kJiNdFb6Nzpgn3CgcPe4A3nRLgolzBIG6B1doiJsrj+GVJvEKs/h1SYgX3VzcT0k4wAxeyE8QI1AlO+nkxcIDgCL2V8Z9A3iLTtKY3HtP3ROyruwm9gFXdRAF3KzC61Bi6ZGolGK7HGQ4R6WOKQH8k1jAP5G3tOcOmsHAGxEfK7Uzss9ji1O6m0DQrMXpbtmDRqoBImfKSMeANL7Snsx7CIcBBUmrcRJEwEIeSJA/MK5TxVEgX/ACU5j6VSWkiw2SqzOZlN22QOxBaQMtlp1aDCLOF9FWqYZ0EmI9Jm4m1nPxTjcbaJD8TUdYlaDsE8mDEHRD9PfO3rytZuM7WYa1QgAklTLjrotZnDHHwjp8LJGXyJTrCaxwSPhEHnUarZPDItIlLdwpxME/pOsJrODyYMXCsMqumDP6VhvC6mYgSI1KPo6rACDZS4oaYe4CxjzCNrXFs5T+ETaWIZqdEDjWDXdxO6i1xY8fxj8KcrgBIKU6pVIHeZ2KX/AFv73SrCrAYQYAv/AJXSXCDMKs0VnAEPmd1Io1nbhIU51YsBuVxxB7blLGHqE2uRrKY3AucZOvyp4XXdWRoT7UnEF0CTIvqn0sAHFw8alPZw2luWj2lxfVJ2Kfe8j5U9Y/X/ALWl9HpuAOvwu+iU2gy4+VOsWazXY0kGQSPlA7FF0GDb2tb6LTsJ09rjwhoMCCJj4TrCaw3V81yy/wAoXVnE/YI+VvP4K0yCIi8ygPCGwCACCY1V6xOdYJrEfwCXzLzlELaPC2gkRMG6j6WDPbaLEK9YnLFziZymfSYxwOgK2qXCqRa0usY0lWm8FolrSN9ATCm/eGfOvPw0al0+k8U2yCM0/K3fo1Fs9okD+5O+jUADmA/B0U7xrlgNbTbP3Kc1OYbPm+63/pWFa5rZkE+UY4Zgy5wlpjaNFOsOWAKlMOIAICPmU/BW2/hmDDiDliLRqpdwvBtIByiFOsWPP5aog3spjEXhroN7LecMMIyAgOkmRdC91AABoMjfVOiMRrMREtL/AEJTGsxRA1nda7X0jPblcUTH0wYAJb5KdEZBbiS7KXWcJiUwNxbnNMgxZbLTRJDu2NJi6lrqGV1wACp0RjgYgky5ttEbRVsXPGmi1XOwwByloMahJL6Mm7XH4SkUbt7XFsi5sozTcOb8wrx5QMNpyPQRtw9OPsAFkozmjmNdlcPFgrDMOcpBcDA8LSoYegCCWtEnZONGh3FpyzcGVN+ljIZQMA2Ad4F13SOIyioQRuCtbJReBGYE3nZTy6L3ZdN9E6Iyjw2T/uQzzKX9JBa489pva61hSpuaYMgmP/1EMOyZBaQNtk60jEfwkmCHtgambJFXhBAkvbf3qtt7aYL2lrPRIsq7nGS3+mQFc+tTcx52vwZ4s1w/azKvCqpBIP8Alesgh0ZWwB41QGhnmWtaI0AW8+9xjfnHjjw2sCbkom4GsPK9YcPTcD2gRvCIYOi5oiGz5V/onDy7MJVMWKZ0b/tAXpm4CkJl9xaIQvwNKTldBO8J2vDzBwVSbCyA4SoCPa9K7AtLw4PMR+0HRNzEE66WTtOGCyhUaZOistD6YWsMC0C8GEJwggQwW8p0vKm1zmiAMx1hN5jvt5ZIIumnDEPDWgC06LjQqH7S38bqVYjnOi1KdkYrui9NtvehQcusYhkGLLhTrm2RojUKKezFuaTNETuZTRi7f7YABVMtrD7mgyYUONYG4EeEgvdSNmsb8KW4guM5AC06LNzVBflAQpzVIsBKRa03VyYLWNvqYCEVSABy5HkrOzP7bNG4Ul1WBLmi6kKvOax1yzLCF2HpEjtFh5VMmpMlzY8KCahNiAY/CsQ92GpkE5YLdBKruoDcFp39pl8puBZA6magbMeUIDlt00EWUNYARbTcqXYaREgDyAgdh/RIVSHDlixc0fm6NlSmyA54/aomiy9ojcoXUWSAbmFYjZZjKTDeL2jZOHEKQI0IGyw20AY7oT2YZsxmFr6LMxrN1rfUAYMEEeDYofqGUHtIAMzOqz+RJEPvGil1Ex5J2UmLdaDcfcmDJ0E6LnY6CCAbm91nuw9Qlt7b2XdHUfaSIvMJMK0TxPuIy9oFzK48RB7YjcXVFuBLgL66qW4Ik5oMD1qkwurBxrXMd2Ek2IlC7FNaJy2GglC3BiNHSfSZ0bR4v/Ep4F9SYBbTN9QFwxNTTuk3udE9uCy218zZccMGgOa0HwlwIGJrAj7g0D9qeorAyBbe6cKEu+0gxup5QALXiUCTia0ssJB0nRM6qtOrWg7rgGgO7I8JZyAd1/RCBjMTWaO2o0gC0oeoqPbGdrRJsEpzmaQAPQQGo0icrS74skGceKVAQcyE8WqTr/hWhwpokSJ9JT+GT+DC3cYmkO4nVJ1v5XN4nWzGXSEbuGvaD221QDAvdo1XxPUjijh2wQN4TBxNx0Iy+CEvon27bKelABzSR8J4s05uPAI/5hPp42mDNhPpVG02aDNb0pDGuiQRvop4etajxZlMC+8TlTW8UpuBzO3vIWPlpmQc0D0i5dOJkx8rPONXWs3itNhADjGoAGiJvEqZ8FnhZIpSNRKnlEEWaR5TnC62RxNmYkRk8JreJUgAY13WI0NnaCjawxZonSFOcWthnEWGmc+UglDUx7AztsGiwF1lmlLocBETqpFAREiDe5SYVbfimVAJiImCgD2Ek2khVXYe7RmA9TquGEqtJDQ3L/8A6SYi42swg5Rf4UtcHEOJAaNJ1VLp3gjtuNIKI0HgEkA/CKuCoBOZwgm0BEaoMQQPHtZwovk33tIS3UnAgEjMNEg1zVMN7mg77rg4/dmbJ1iVkFlU6G+qjLXsCWlqclbIqXMkeLIQ/KR3CNgFjA1B25x+VxdXAIL2gjROSteYMtcJdqSdkRkmzoAPnVYpq1XD7plAa1WAM5/CvKVsvLiww5t1xcRbMJJ2CxXVaoPa8/CHmVd3GU5K1n1STOew0EboTWecrg6HDysoVKs3db5Uhzp1M+ZVhWi/EPI1BIM2C52JeTH+VnZ3g9zreZUkXJk/tIVcOKdvA8oHYt4LdPwFVnN/+LgZmdikSrRxuaAWgx6QnFEgNygN1VR1RotfVdzQ2BFkhVw4lztQ0nZF1QJgrP5gmBN9UfMnSfhWFXepvqMqltdoLpd8CFSGxAudVOWJ18qRavGtT3eq72hzI5g109JIBcbCbKQHETASI6oxtwHpfLH9+iZyiAcwBlSKG2VVIFmSSC7Tcq1RxNJjAS6fwqxpkE9v3elJpOizboq8zF4QAGbn0jbj8GNXAk+ll8l24CDpzcAXNwpMLrbbjsKZAIAFkxuLoEEFzS1YHSODS6DHpEMG8gEApzi3XoGV6U6tAjRG3EU84hzQ2F53lVSO3P7U5K4GjhCnJXoWYhrpBeLb6KXVKTgHOcDI1Xn81Y6TI2Rf1iIM/gpytb5qNLGy4GdURex0w8DcFeemoIALlH9XUZpnUFTkrfdVa5v3NzHSDsoNWn3WAI3WHNQOmTJ9oQ5/2knXRXlK2XVTe7SNh5SXVYJ7QXHxss+XkjNmkXgKYNz3yfaQq05wcILRr+1WeKdwGho3KCHOADg4jzKEtLmwA9WDRpucxtml190zOGuBy/cb2VIVa+a9jrCkPrXJd7UgvAtDiSDA8qHVGhsDc6wqwqVIF7TZGHuccxLYhSKY7lwcriCbxCh0NygGRvIUgEnNIzaWRCk4zNXW8QgU7uIH8TYmEQFyI7R6TOUXFhziReJujFDuP9Tu8TqlFeGh0nTzCgtpxlAkfCtNw5NJsvh06J3SDUuIAvZSkZsNcYJh2ogaIosIzGNbLTbgWtBLni99E1vDgO7ODaYNk6IyQcokNJGwjRMLoMBsk7ELWGAsM+RsmExvDYdPbEEfCnWLGNOYRyzexUmZjlTK2W4BoMWg3BKk4GS0ANzAWnynWEYumXNTA8Qp5AcJcHA+AVuHAEgS1oIuo6GoHScpB2gKdYRjCg3LdpHxqu6GmxsNLidVsdK8guiAbaKtUpPotJg5dZICtIoOwLNBJganVC7C0hlaKnduITqjqpF2FoG4SedUbILSY3IV9TxB4ewOLg9xlC7hbASeY7KB5RMxRzQdd05uJLnSGNg2kp6eK54bTaR/UOU7qDwrwC6dDKtOqPyOlwI+FLn1YgOFxpsl08UHcIcctjbeV30lxE3/AGr/AFD2taHvaCRCEVDA/rQAIsl08Zr+F1R9lyDe6S7hFdsn/tbXNJEZgfc7JzWtLSM5AJ2KvWkzXnDwrEaEXKNvCqphrnQ70t9oDDeo4iVJeGmziR5J0TvTlis4S8WzExvCP6O7NMuPkLVL8zQ4OMzp5RGqQM+Z3wp1pMZB4RUAdM20U/R8wP3LXbVAc0OeM14Xc1pkOdkBOubVOtWYyvpH/r+1DeFAyIaSFrudTdpUdl9FQX0i8w/TYbp1pMY/0sNYXPaAR+UQ4dTI0kjwVqE0mtJ7ptAKl7af3ZnCBoE61IzBg6VL+Ou8ouUQDLAG+QtHksNzN/4yFAosJcNGtFpSkZxplp/2xA1JQvYzLcAARoFqMwzHMBc+JvcqBgmPI7gWnX0lIzSGuH22O6U7LaJgLY6GjILqjQ7a6l3D6AcCanbEzsnWEYprMDWy2FPUAOgN9rZ+n0HAE1G2vZKOAoB7jzWlxFmmyXCayziGuaYaCdETsQ2xFMSFoHA0X0wRUa0nQShOAp3IdMbk6pcIoOxlNsy1oJUdUS37ALbbK83A0oLi8CLEKBgWmSHgT4Ktwms84uzTcDYQuGIe52YN9aLQGFa09rmkDedFHJGbJmbpOqXCM81qpIhn5K4vLr5T8hXzTcRci24i4XWBiAYiyUUBUDABDlBrNaAMhy+lbBaHPGWfZQhzWMADJ+dlUIGIY0jtMnyVwxIBDeWSdfhWDUpT/tA/nRQMRTzSaQEaFFJGKDmuby42EKRicjQBTuPKccRTDoFMwfAUHEsm7CY0EIEtxfbHJifCM4x0ZW0r+wiOJbJ7LfC51fwII9KIpdY/UG/4UHFPvbXVUnVYByi53U8xxECxW4lWjiqjQ3KbegpOIeTcj9KqHPIEnT/KYLjTVIVYGMqbkW3hd1j2yd1WHgkELhMw78BIVb65wPyubjnNmARsqsbDULgZlSKvjHOcBDi3dM+oPIIzkDzKywfJuiJ28pCtU49wAJfmhceIPLmnNJJ1KyL/AApjTwnOFbP1SqD9xg+0TeI1dA+ADudViXMzEqCJMXjypzhXoGcTeB94ge0TOKOAfmdIJ8rzrQBcC3pdcjWJ0snOFem+sOIdFQZYsCo+s1AGhrm5G7eV5sCNdR4UXJIOnwnGHWvTfXqmYluXMAoq8ZqOBGcAbrzTgNANfC4iTunGHWvRVOKCxMEjSFTq8SJzGfMBY5Dm72CU90i+iufOJur9XioFxGbyFXfxwsBjVZzyBoLKu8f+q3nzjG7rUdx5xaWyb7pL+NVHH7yssg/2qOW7YLXOJdXX8TqOJuUHW1Tq4lV20Xo20XE32SYnq1TxlWAMzgrVLGVJBLnEhUBTcDqmNlpspuY1jVp450Gz9U8YtxG8HUErHFU2gohVMnclZ5azWt1bgXRMfKA4p+UiXEHyVnis8uIBKNjnkdwNlItX+pdmkzPyoGJJJtcHyq5BIBLSfhFlcBZpA+FIU7qnyZJg7SuGLfmMCEoMdqQZ+EOUm+U2SKcMZWyjuMz5U9VVMQ4zrBSQ2dGm64Nc4gwbaKoeK9YzDnC/hSa9RxAyv1ukd+0iFAc6YAcoq1zHuFw62iIvqiXcx3wqji4EHuvZRLgTc2CQXhULiCSSNLo+Ydz2jaVnF8H7v8oHVRPc6RsEhWnzXQBnn3Kh1ci8bxdyzjXAy3QvxbQbbJylaJxDm2DDAv8Ach6p0HWD5Ky3Y8DUfpQcewuBy39q8nTUGNNwR61U9STEuMA2WaMZSdIgabpjcTSIFmmEhV52K1m7fHkqTiWm8Xj9Ki3E026ZCFJxlI/dkKkKvGsARdxOwhcXgTcyd1VHEKU3DZC76nTkxl/KRbizAJiTGohdkJP3R5sqh4iw/wAWohxK98sJNS4scu+UEj4Xct5BOYui0AJQ4kxv9t/SNvE6WtpT1bhnLqDKfA0hdlfGYU5J8BQOI0SCMwmLlMbxCi3LGUu8qelwvl1gIAv8Liyof4CPYTuuoTAbdKdjWmcog7gjVPRVZy3TDZg7lSG0wQC0X9qG4d0Ei4HtOZQFiIJ2voqkGygHO+0R5m6noQ15jxrKIUwCBYmbCVZbRcXRDY8ypVUm4NxE2gqDgXTNre1pdMXEQAWkXR9C0ZQXe58qdLGR0T5JLhCg4R5/k0RfVbQ4WHlxAP4RN4RlJJmCE6IxBhHkAggoekqi5yx8rcHCG5f5NhQ3hgqCAXR8ap0RiHBPkW/zZQcI4gO29LePCyAbvJjRczAuaYdZx2To5YQw7naaqelcGz/2t8YCq3+Dio6Go2GtbOU3JTojCGFdEgW1QjDVHiWCYXoRRJMgNJBgqW03Fru1tjpKdEedGCrTJbf0pGCqu/j8hb7oDmgMggzE6rnVcpBNMtMxY6p1pHn24OsXA5QAQubgqjbkEErfOLYx0ZIAFgFD8aAMwp/CdakxhjAVXNMCAd4QnhNWoXT/AB3Wy/GhsuyvukjGuc55DXQ79K5ukxkHg1VpiNpS38HrtEkAhbYxdScsOumNxDgMpByhOtSY8y/hdUNJLdPSX9PqtBtb4Xpue4tILCSfPhLfjBFmE/hXvU5x5wYB1xJG6LoHAwSZK2n4wxaiZPhV34txsGOWutJjN6F0QZhSMHDrtM6q+MW4m9M/BTOpc7u5ZBGwCXUmKrMJ3N7f8K7RwLST2xHpMZiCBIZJjdObiTlb/TEgarO7rWYmnw5k5mt7j5VhuDLj2ZbDeEluLIiCQR7RM4m9oAAA8Dys+tZFjo3AhvbnKnoagBzlt9MqrO4o9vdAECBZD9UqzOUHwYUmni0MEzKSZ0iSo6ZoOV8A6iFSfxKq5zTlMBLdxKo+e0wdfSs0uL/TgNsZM3B1Quw7abrEX1KzzxF4sXOmNUHX1C0jM4pNLjROHYIIIBOttVGSk4m9h/6rNOLdM5nyNpQuxVR0yTB9qzUrRyNAElpb5hKdTpkDM4STuFn812UDMfhCHumC4ne6Qqy+jTIMkSTsq7qTRZpn/pDmIEuP5XGNJN1pCKocJ0gKm9zgLAXWkIbaSZ8oXU2uADhB9K5rO4xnufpH5Vd1SoDst5+FY6fKS7h7XfHlaz6xnfnWKa7wuGJIm8LTfw0E2CU7hYH5WusTnVLqCRZyLml1g5NPDoJUdE5oS4k0uXHddL9k4Ui0TsmNEa6JVirnqi4UivVGyutazfRPZSoGJJhSrGeMRVO101tR52WnToYVw+4g+U8YbCyAHfkqdYufOskEtHymte+ABotXpcLLe/8ACb0uFt3iN7rPTXOsgYio3x+l3V1SJ2HpbIw+Eb/IfJRChhiLtblU6w50IxdJgNze8QjGMpCDMTqo+k1s7AWzPpS3hVV5cMhF40WfGvRjHUdQdURxbYhpy3sl/RniwZlvEo/o7/uiQBIKeHpzMSGkAVTbaUTMYBMQLpQ4Q/NeRGpTW8LcAXZtN1PF9GzFvBcRPduExmNeJBGb34S/pz7ODnQL2UjB1QA4VHAHYhTw9NbjajfLifJRO4hVJjLEidUk0KzDAzuPxojNKrBIcQN7KeKJ2MrEHK0n2CpbjKoAc6kJImSd1GWqLAuDdSYXNFQ5swfl9hAXW1jow57TG6M46q8zynNv+0lxqEgZX5gdY0UuqPbcB7n+IQSa9TJLaZzDyuy1C4EB0akypD/6klp01hcKpa9ouW37Q3RB2eoC3KwuANypcX5u6I1DdFPURMNPwg55JJ5cP3m8IOOctGamDe/pBDpgMDjN/Sh2LqXa4EmNAIUnGOF8kTrZAvK7K+acR5vKI03wwiRlvYIXYtxB7LnRAcS8jy5u6qGGq8eZ00UGoZguLgdbaKu7EPsCzXdQariSQA0+UhT3VQajXF+2mVAazNAfkhqWXyJLtPIsoJAIGYnN4CsEmu0WyzO8Jbq9MkgtgD/1RXJNzZQWOI1zBAvn0pzZPUwoOJZrBAA1jVSabnNvIQupuJFzCqOOJpjQE5tlwxTGgiD+kLqWYxOljZLNEaTMbq+B/U0rmDPwu6miBMd3iFTe2DF58whzQJN0hV7qKAbYNBGxC59akWyHRbYKiMup1UZhu4/CRKuGtTgd5MaGLoH1mTZ0HdVDVbci6A1WxMC/pWFWzUnYpRdIIkCSq5xBF5/wodiWixAM+VYlWZNoM+V1x5KpHGwTaPCEY07lOdLi8JElTYiTEqkMYTdG3FE7JC4tEjTzsozaW18pPOB2F0xjyZn9qRamY3J9wizX0XAQTBEKB8y2PCCHGBoSI2UEvkWhHrbSVwPndAo5zFj8oHZzaPiFYvI2HhcTGxKVIrCm7+2FwoHQn2rMgG4v6XQCIIlWkVhQBm8rjQB3j0FYsRpvFkD2GLOiN0pFY0ABIOqUaUCQZCsgE7n8rhmFtgrUisBUb/Eo2vqD+JVproFgnCo0TLZCUioH1HRAP4TmmoQLWHlWBXY3RmtjCZTxFP8AtMDaFmrmE0mPc7KGWHpWaeEq1dIB9I241jRLQjbj20xDSWiZNlNrWN8cVbMQ32cuiL6tQcbMADTuNV5s4rLbmG+6E1j/ABqiTrKxwvT0/wBTw7Xk5O50GBsi+r0GkTTBvaF5M1XAn+rrogdUqEkCo2PacYdPW/VabmkGmACfmyj6phL/ANAkgbFeQNWpu6Ruo5rjbMYGycYdPYDi+FaHBlEh0Xso+rYXLBpwI3G68jzqm7lGd+bWwTjDp7B3GMOcwLA1pEkoXcWokmzGtPgLyIqnMTNv8KDVc+RMfhXjDp6+pxagQMuVoGqF3FcK4NkAzpK8gXOIJzW9DVA4uFy63/CcYdPXnilEXDO53ykDieVubltzO1XlhXP95XGqSIzG6vCdPTu4lmBBaBtMKBxGnBByz5XmXVXZbuP4Sy8gHuN04OnqjxGkL52ZvMJf1RkmajLjQBeUNWNXGy4Yho1cVeE7eodxellk3PoIX8TY4Fu/wvPUq1K1yJV1lWm6LpzF6aLuIsGg19IOvYJdludbKrm2YW33RZjNon2pMKd1udolojeyjrWuEmnadholS4gBsEeVLmYgugNaN0gZ1QLhaGxpCkYhs3BnaySGYjNJYAoyVyDLZANkgeawlpDSRvZS59pySJ2SC3EiA0fsqW882mwSCwHOzZQ02ErmscTIb3DUeUltOsf/ACGfMpnJquIJqm3tAXIeTI0N7qOlcQBlOXwu5NZ1nVro20ngkc02jU6qKruwpeBAIM3CScC7OYAIhXzTaSc1VyPKT9tQepKtSMvoXjaQd/Cg4GoHC3cVrENFs5DovayIUwIM9vnwnRGKMFUJcA0j8Ihw6sWy5sLZ5OYEFxnwh5LS0QSALp0RjO4fUgnLAGqF3Ci7Vuq22sa/uE5TeP8AtRyA8EFrpnVOtJjz7+FOvEWSH8KqW9+16U4NpBaGOj0lnA5QA1vzJVz7TnHnDwusNI/aJuCqh0L0D8GBc05PlQ/DUgS3LdXtOcYjcI71feU0UyBBNyFrjCUdcsAaqejpOcDERKnS8spoDQYMfKINMC4C0zhKWazTmOmsKDgmAxpOolKsZ2WHSPyoDQ73BWm3AtLpAdBCF2AbkuHRtCXCM7KZ3ELhc73Wn9NsGjNBHlT9OAZebBS4RltYftm+qLlkiYhaZwTQ0Zg6TsAiGEYDA0Gsp0RliibER+1HJc60AfK1+lonUxHlGMLRcJmRqE6IxencNYjREMK+NASFttwrHCLSEZwLMxNiE6IwhhKgsMseyuGDqwQcp/K3+ka092UA6QVH05gBytk6yTop0vLz4wrgbAe7qTQefHtbxwReDyw0/KB2CeJsLEbJ0RhswzoF239qRhn2l7QY0WweHOc0hgbqlPwNSSS1siyvSRjgR5K4tmDJj0tRuDrQ7sdruhOBqkyG2Bkq0jNLZAFxCixvNlpdHVJcckAiZIQDBva0TTn8JSKJ1iLLpAgSrowjgyDTuDCk0ABBo23lKRQFjYypJnwrnIbFqRgawFPKZH+32+UpFJ32yphWjRblGVh11XcgAzkMeISopkEkQ7X/AClupuMyYK0RTaBmyC2yiBaaentKRlHD1CYv8oHYao3z6W12gm4PgISWNuSCVejljHDVS6LoHYeqbXW05wzRlE+UL6bXaOAKvScsB2HrO0BQihWGxn4W/wAkGdvwhOHLQ0A7xor0nLGY2p/aZVui5wcA5qvmgQbAOKE0HTZsWmynRyijVZcOardPEUxYtVbkOkDKbbrhReJi8rOxpe61jTAYI29JnWAyGho9yszlvEjJcJZNTemQE5Wtk4um0QSLe7qRjGAXDADqCV559V4kRJ+Eh+JdoRqrwnT1bMXSiJBn2j59J1u0HS0LxxxL40sjZi3NA1Tg7evzNaAGgfkqYYZzBrGz51XlaeMcLEz87J7cYTrdTjV6ekLWOywRAvbVQ5rQQMoIB1K88Mc8TDV31F4bF/ZKnGnWPQEtI0DYOyF5AuGgysD6q8aCTGpKH6vUFrEpxqdY9BmIIDQM2/pSXnUAECxHledPF6vrxpdAeLVhMWn0rxp1j0zTANz3DzdQysKWrhEbryruLVZMkwSq7+LVJJP/AAr/AD1O8ezOLYNX3jYInYtpbDatx+14M8VqEzv8KPqr/wAJ/I/o94cSw5ZqxHjcrm4hsmagvovDt4q+NNU0cVcdrlP5nePcNdSc7Nzh+Cia1rmZg9pOi8UziTyBb8qzT4hU8mFN+NXvHrnU2OYZcBO6W2nSMtzds2dK8/TxFaDdxkynitUM3IhZ51qtwUqcEMh0eSj5NOJy6+9F58vq3PMfB9oTXrNsHvge05K9KKNPNBDcnkouVQMS5su0K8sa1aIzvifKE1q2udx9TonBXrG4ei9rhYBtrFd0lKbF3adyvJtxNWTNRw9FS7FVXQTUcL2U43/TrHqzSpGzcufwSgdhqbn5ZGaNjsvMdVVzE8wqW4ytIdzDItZOdOno3UCZhrS0bzqg6XOZBBg7Fef62u0GHkqetrwYqESrzpW87DlzjBILdpUPbUJBa2YPlYIxtcCOc4/lR1dY/wDkIncFOdK3S6q0lxZEDa6jm1GSS6HHSywjiKx1quIhR1FXMDzHfCcpW7z6hDg52UHcKRiHyS5xn0sHqKk2edV3UVJPeSfCvJW1UxzwO1xOyq1cdUD5mRELPOIqntDrf8KDWcRJNvhIbr0ruKNjta1sLhxJuWwYC7UkXXls2XaR4C4VRBhpGycYdPVt4i0tyuawkamFH1BuS7WzOoC802uB/GRumDENgEMjdThem6cbmaQMo95bqHY1kgmmCdzlWKMU1zpDb+VwxYuDKclar8c0EZadtwAl9Y0tAyCBsQs1uJFzNjfRQ7FtEHbcQryVfdjWm+QZTsBqgdxCGyKRnxCz3cQY3QWnwo+o0rkNud1eUq718TFM3OkIDjDu0EfCqDiDIJcp6ui8CQTKRKf1N8wa0bXC51YuMdk7W0Sudh6ggzAKnmUHWY6PMhIpwqktiW5kRqNLSO3MfSrAsJkkHxCiWAgtid0guCsyLgWGsKDVYQHECTtCqF9/Q9oQ4Zja3iUhV8Vm6iDPhE2q2IJafzqs0+hA+VwIm4ukK0+aC0kEARoVAqtIOgtYlZliYMgldOwJtvCQrTDhAl7DAuEBc15JLsoiFQbBNz8FMhhMOebpCnPotcQ3M2TqQkHBNcScxjQAIoa5ph5B0RckamoSESEnhrBHd6sV30ymHHvEDaU4YRpJgqejLRd4hKRX6Cm3Qj9qG4QR2uEKyMA9ogObHtScIQPuBP8A2rSK/RNd/IW9rjwzNq9pn2rAwTvIQnCOboWgE6KUhH0cm4ePiUX0MBsmoITenc133NuigiQXaK3SYU3/AE9nvzALxdR/8bJmKjfkKyK5A1tpYom4wtkAkEaXUv0c4oO/0zULo/RjVAf9LVSJiB/ytQ4+oC0590Y4jVa4y7t2Tr6OfllH/SdQAmJ/CE/6XqCBkMkaQttvEK4FnTfwi+pVg7XtGtk7+jj5edf/AKdqsBIputtCUeDVWf8AjNr6L1TeJODbNy28JrMfzRlLQYG4Tv6TjHkG8NqNMcsz8KzT4c7Nly7SvUjEtcJyiFzWtqEOcALRAU71c+GE3BuaQA0/gp7cLAJzLTdSa8EtLm28ITgS9pEy3/lTpYznUhlaT+ZKRUAbbYG0K/Vwb/5AkflUqmGBvlMbWVzU1XqVYMh0BKNU3GYknTRTUwr3CQDBuFWdg6hIsfxst5mM7unhxcbRKY2lVeNUmnw+pbYq9Q4dWBJJudE2GUDMBVeBcFpT2cLqOsHD5Ct4fBkQ1xgnULQp4JjS1pMGLQNFjfpvMY/0x4EzbcovpTgCc4gheg6ak4gl+UC0eV3TYQWLpWe2owPpJA+4fCj6O4zcDwZ3XoDSwmpq3HhE3C0KkFlUCbwQnekeePC3CYdI9FAOFvJJDjbYr0ZwVAOy5xcSTdQ3DUwDlf2nROzl5z6a+HEbbIBgHm8X3Xo30GsiHAA3PpLFCS6XtItBTpI88/BPbYN3QuoZQe2Pa3jRAcbtM7ygfhWOBlzHDUK9EYzcC8jNt8I28OqknSNrLZdVptDibAhdz6Ya0eN9060jIbw2oSe7bwpbwqoWiXX+FpnGMZmJOu8oDxNog5xb3ql0mM5vDar4ggRY2KgcNe8wHggelePFg0S1zQNYCA8VeQ4DJfcJdTxX+lPuMwn2FDuFQBmdO2iceJvc0tJgaTN0A4g8iDAgayr6eEP4Q3+VT/CT9FDjap7mFb650S54UHEOcQM4k3VukxRPA3wS2pM+0k8KqtJGfT2tNrydDeUeQwTf2SE61OcYruH1h/MQubg6h0eIW0KLzlIaDOqI4YmW5QB5hXo5ZDMG9urwLxqmtpltszYWkMM7LIaCPJCI4LtJytj4U6WMuMoMuaPhQYkxqtP6ee2GggG5UOwbRq0ESlIzdHR5UFoPmBstMYRhkhvxdcMBTc0knKRsSlIzYMjwF032haowDCQTAb5lEOHMJtEeZUuEZFwSdlEZRI1W43B0yYlsjZHTwLAAJaT7TojBJtFifCg5zuY9Lffg5jKRBGvhI6LLJDgQTrKdYRjtFQCB/wAoxTcT/Kdd1rCgbZQ1xGyZDoh1MD4TojK5VfVoM+5UhleCAXZt1rZnAaHz6UPxDg2zQD6SrGYaeIAmSABdEylXiRMewtA4l7jBaAN1xruEuzWI02ClIpNpVsoL/wAohhXufedNFa6lsh5ME2AXdQAScwzHU+EuhAwZAMiAdVIwIaBA+Eb8VTIA5gul9Z3Xez5B0T08G3BkF0gR6UNwjYAiw1KW7HM15oO2q5uOkABwhPQZwbHAxmn5U9KwENhxGqBmJc0AB/8AlczEVSD3amLq+gnUWsH2mDoi5TY+xxn3ohD6wIOYk+zoiDqxIioJH+VBOUCAGGw13U5iPsYfclQRiHfygE+VxbWkS+BCDucQYc13sTZTzXOa4HPHoqHCqWluYaSoNOoS2XwXaID59RrWglwA1k6qTVAaOwztKW6jXzXy5RuVBpVA4gvbOt0BOqMzS5kkbBBmpg5cgg3CCowtObM02iyU6sQQO0wrmJTXObJAbEeUouMDJMa6qBWNwQMo8p1ItqNIJgRaPCHhfWVmant8rvqVdtwZiyt06VImOYCDoIundHTg94cQdFLgz/qdYEG/jVR9RrAmGg5va1W4AQScoPhKOAaCC9zQTtslxZqgMdWaJyifJK5vEKzXGIuLBXn4GIOdsT/hQ7h5FmkSEuE1T+o123cROxAXHG1Hx3STfRWjgKjHEgAtjQJbsK5hJcRI/wAK+HpRxdYt7naDwodi6joEtLv/AGCJ2DrAOMmItOyT0VcgZXSSniGdU51pE7gFRzmi0ExsClDh9Z4s6DpZT0NQnKHX/wCE8PTqmDqu3IGiS7C1jo821urXXPcI/MFQzFOM2Avunp4pHC1gb5jsgdQqNsKZJWgcS+ziRrcALjX7jDQCd4S6M/lPn7LqBpdglXzUOQlpB9whLfESfStFIO7j/TmDZEHn/wCuCrrGOdfKe1ODHC+UElSjM5oaL02wiGJgyWiVoilUkAszGNtlBw2ZhcGC3lKRRGLg/aD+VPWnutraJV12AsDkbO5jVSOGt15bZO6XD1T68tAimD5uubxFxA/pwBsTqrn00NJBpg/C48NBEQG3CXD1SdxJxjtAA2lC/iNYkEM09rR+kNLrtAA38qfpIEyWfhLhNZD8diH7QBfVAcRWOriQtc8Oa3Vk/AKY3hlPUuAbsITrCaxm1H5QHSfyjbVfFwQflbP0yjTEZh8qX4DDtEiHHZOsIx21nkjM0jx3IjUcY7yANgVqdLhmm7p3sg5WFBd2uAGhG6UZxrumxdrczoj5rtqp/wD1XHUcOJIa8+RKB1CiBOVzfI8pRUbiHhp7ib+VIrmHS8D8o34dmUwHAJLsHJa2XdyviUQrzMVBPoqOYST/AFCg6GAIDrphwREXIgp4UBgi1UgeJXQCbvJRPohgzFskeFJpDa34QDlGxJAsbqQwCRLiuygJb3ZRIabotNFMAAF8qMjXCQf2qb6z2jf8qs6u4CIJhWJ00nUaQcAXXjVLNJlyXCdgss4hx1a6PakVHGbOV5Z6xphlMRcR5lGAwH7hGyzWmbQY8JrGSBYj0kWrwLbA1BJUsqWMn/Oqpii43gz4hHyiIsfZUi1cFQyO4QZsiGIeALRl3lVGtAOhIKkuYP4PUgvNxbh/Jp3/AAibjCNHDL4gLODmD+Jy6XRBzRtASLWieItie2RYGAudxMSIO2kWWaS2bNaBv7UZgYIYApMKuv4g5wIDpVY4t7rkGdEsvgggAfhc6qQAf+lYjmvqRBB1lcC4kW7lIqua26gPdJi3uFSDEzsRuCpzwTcCClZ3TY3m5hdnJcfulA8VCDr8wLpzcY5rtf8ACpgmfSjuLddfSkGgOIva1wgD4Oq4cQqG7nCwtJWdD95/AUSYJyuP4SYtajeIuLR3NAi6kcRJP32O8rLh2wP6QxU9z8JzhWuOInKBzhPlAca3KQakg3NrrJh7bZTPmFwe4ayfwnKdNXrhBGcm2ijqmkAB5E6mFlcwibXKHqNssFOTpqtxTC0S8tjyoNZhu15t4WVz5vkuu59R2jYV5OjH1HR53CU+pVkHNBWsaDLgMOZEcPSDftMgJ0kYbnVYHcbIC+sRq6fELZfSpMygWclOpEuMEAfKvScsoOq/3Oj2mMqVhHebaBXHYZ7yQ14+Es4GoSJddW4TXU8XWj73SrDMTiYA5kpDcHUky8CE1mEcCQXjbUqbFymDE1my7MQTqpOIxAMl5yxeynkvDfvZIOiINN8zmQs+L6Dn4hrhDyJQur19eYTP+EwlswKgkJbhoc4zIehdisTP+679rutxM3eSELmxJJEnwk2yzrHgq+J6st4hiQ3Lmld9TxAIEi/gKuIOgM+U1sOaS1rswSYemfUcSYg20UjGYkn7tFIc1v2sJtupFYG8OB3UULq2IeO5xjVCX1cpyvIlEazS2Jc07KJpl33OnyqAz1Bo86xZQH1xfOSD4TIa2e8iVOSRBehA0n1BEOPynh5Nnvnyk5BEF9h4URFw4G8KEXG4inAky0XjwiONphwJkkaQqQp2uQYKltIukiJCTFXjjm6gwNYIUdcHtaIkHUKoykRplJTG03QBDAPlSYHNxU/a0RuCFHVvc6zGkIWs0gMHyiYDldAYSDogA1qkEOYw3shL6hM5W396Kxku0dknX0pGEBMWIJ2SkUSC8kHKYQvoAbCTvK03YIH7QJndd0LSPsFtRKdEZTqMGwGmiE0gB3NH4WsMBRMDU7XU/T2EXI/GyvRGQ0CLAwpmwDbAeVq9DTfIBuEDsAYDiRm8KdEZ5e4QATHyhBdoTIWg/CNH8iJ8JfStIsTqrSKQkAx8rocTurRokSAT6lAaQMh50SpCdyNguAaTY/NkRawmQ4oRe+3hUSGMb/Kd4ARDlRMumPCWNZ2Fl2YEWNkDQKAjNmLj4Ujkh5BBISAZ0udbqbSSJlA8Mw97f5TAaMG0bWKqSYiw/CkvEC8D4UKuNfRsYIgwPaNtSmS7KII3jVURULr2t6XCoSTB/wAJFrQ5tOJEX9KGVBYduh2WfndYkxuoFQF1nXISFaZLjMFg+QoDZII39LPD3jQ2C7muBJDjPtIVf5QMFoF94UOoEtDcw9yqXPquH32UnFVokOv7SaHVKJaNLzCqVqDwjqYmtEF5SXPqERmVxnVd9J4BiyQ4P3NlbPMeSCb/AAhOHqOi91qsxWY4jQgKw2udyPwFIwrhrr4UtwrmWlLhNf/Z" } }, { "name": "WallTorch_cloth", "translation": [0, 0, 0], "positions": "AAAAAJqk7T7NZZ4+AJvAPAba7j6BrZo+NNIbPRcE8j5e8JA+NNIbPWXt9T6u5oQ+AJvAPHYX+T4WU3Y+2bm0IuJM+j6A4m4+AJvAvHYX+T4WU3Y+NNIbvWXt9T6u5oQ+NNIbvRcE8j5e8JA+AJvAvAba7j6BrZo+2bk0o5qk7T7NZZ4+AAAAAFy2uD7KC4s+TVitPNbMuT66soc+Lj0MPealvD7N3X0+Lj0MPRIrwD7EMmg+TVitPCIEwz4eq1Y+Q6eiIpwaxD79+E8+TVitvCIEwz4eq1Y+Lj0MvRIrwD7EMmg+Lj0MvealvD7N3X0+TVitvNbMuT66soc+Q6cio1y2uD7KC4s+AAAAAL748z6G64o+AAAAAL748z6G64o+AAAAAL748z6G64o+AAAAAL748z6G64o+AAAAAL748z6G64o+AAAAAL748z6G64o+AAAAAL748z6G64o+AAAAAL748z6G64o+AAAAAL748z6G64o+AAAAAL748z6G64o+AAAAAJqk7T7NZZ4+AJvAPAba7j6BrZo+NNIbPRcE8j5e8JA+NNIbPWXt9T6u5oQ+AJvAPHYX+T4WU3Y+2bm0IuJM+j6A4m4+AJvAvHYX+T4WU3Y+NNIbvWXt9T6u5oQ+NNIbvRcE8j5e8JA+AJvAvAba7j6BrZo+2bk0o5qk7T7NZZ4+AAAAAHxovj5JCHM+AAAAAHxovj5JCHM+AAAAAHxovj5JCHM+AAAAAHxovj5JCHM+AAAAAHxovj5JCHM+AAAAAHxovj5JCHM+AAAAAHxovj5JCHM+AAAAAHxovj5JCHM+AAAAAHxovj5JCHM+AAAAAHxovj5JCHM+AAAAAFy2uD7KC4s+TVitPNbMuT66soc+Lj0MPealvD7N3X0+Lj0MPRIrwD7EMmg+TVitPCIEwz4eq1Y+Q6eiIpwaxD79+E8+TVitvCIEwz4eq1Y+Lj0MvRIrwD7EMmg+Lj0MvealvD7N3X0+TVitvNbMuT66soc+Q6cio1y2uD7KC4s+", "normals": "AAAAALXOr75Vb3A/p18WP1eckb6F90E/Rk9zP/UbBb7Fn5A+Rk9zPxhQeT2IH5y+p18WP79wXD5nt0e/UhkNJb1qjD42L3a/p18Wv79wXD5nt0e/Rk9zvxhQeT2IH5y+Rk9zv/UbBb7Fn5A+p18Wv1eckb6F90E/UhmNpbXOr75Vb3A/AAAAALXOr75Vb3A/p18WP1eckb6F90E/Rk9zP/UbBb7Fn5A+Rk9zPxhQeT2IH5y+p18WP79wXD5nt0e/UhkNJb1qjD42L3a/p18Wv79wXD5nt0e/Rk9zvxhQeT2IH5y+Rk9zv/UbBb7Fn5A+p18Wv1eckb6F90E/UhmNpbXOr75Vb3A/AAAAAHF4cz96N54+AAAAAHF4cz96N54+AAAAAHF4cz96N54+AAAAAHF4cz96N54+AAAAAHF4cz96N54+AAAAAHF4cz96N54+AAAAAHF4cz96N54+AAAAAHF4cz96N54+AAAAAHF4cz96N54+AAAAAHF4cz96N54+AAAAAHF4cz96N54+AAAAAHF4cz96N54+AAAAAHF4cz96N54+AAAAAHF4cz96N54+AAAAAHF4cz96N54+AAAAAHF4cz96N54+AAAAAHF4cz96N54+AAAAAHF4cz96N54+AAAAAHF4cz96N54+AAAAAHF4cz96N54+AAAAAHF4cz96N54+AAAAAHF4c796N56+AAAAAHF4c796N56+AAAAAHF4c796N56+AAAAAHF4c796N56+AAAAAHF4c796N56+AAAAAHF4c796N56+AAAAAHF4c796N56+AAAAAHF4c796N56+AAAAAHF4c796N56+AAAAAHF4c796N56+AAAAAHF4c796N56+AAAAAHF4c796N56+AAAAAHF4c796N56+AAAAAHF4c796N56+AAAAAHF4c796N56+AAAAAHF4c796N56+AAAAAHF4c796N56+AAAAAHF4c796N56+AAAAAHF4c796N56+AAAAAHF4c796N56+AAAAAHF4c796N56+", "uvs": "zcwMPgAAAADNzAw+wMHwPM3MDD6QJX08zcwMPpAlfbzNzAw+wMHwPM3MDD5P6OEizcwMPsDB8LzNzAw+kCV9vM3MDD6QJX08zcwMPsDB8LzNzAw+T+hho8zMzC8AAAAAzMzML2Cu2DzMzMwvAdVjPMzMzC8B1WO8zMzML2Cu2DzMzMwvFFHLIszMzC9grti8zMzMLwHVY7zMzMwvAdVjPMzMzC9grti8zMzMLxRRS6MAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADMzEw9wMHwPMqvJT3BxkI9kCV9PMHGQj2QJX28wMHwPMqvJb1P6OEizMxMvcDB8LzKryW9wcZCvZAlfbzBxkK9kCV9PMDB8LzKryU9T+hho8zMTD0AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADrUTg9YK7YPDYeFT16TC89AdVjPHpMLz0B1WO8YK7YPDYeFb0UUcsi61E4vWCu2Lw2HhW9ekwvvQHVY7x6TC+9AdVjPGCu2Lw2HhU9FFFLo+tROD0=", "index": "AAALAAEACwAMAAEAAQAMAAIADAANAAIAAgANAAMADQAOAAMAAwAOAAQADgAPAAQABAAPAAUADwAQAAUABQAQAAYAEAARAAYABgARAAcAEQASAAcABwASAAgAEgATAAgACAATAAkAEwAUAAkACQAUAAoAFAAVAAoAIAAhABYAIQAiABcAIgAjABgAIwAkABkAJAAlABoAJQAmABsAJgAnABwAJwAoAB0AKAApAB4AKQAqAB8ANgA1ACsANwA2ACwAOAA3AC0AOQA4AC4AOgA5AC8AOwA6ADAAPAA7ADEAPQA8ADIAPgA9ADMAPwA+ADQA", "min": [-0.03804226219654083, 0.36076629161834717, 0.20309825241565704], "max": [0.03804226219654083, 0.4888678193092346, 0.3093704283237457], "material": { "roughness": 0.95, "metalness": 0, "color": [1, 1, 1, 1], "emissive": null, "emissiveStrength": 1, "map": "data:image/jpeg;base64,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" } }];

// modules/dungeon/src/torch.js
var TORCH_SCALE = 1.25;
var TORCH_BASE_Y = 1.3;
var FLAME_AT = TORCH_PARTS.find((p) => p.name === "Flame")?.translation ?? [0, 0.4665, 0.2713];
var FLAME_GROW = 1.5;
function decode(b64, T) {
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  return new T(bytes.buffer);
}
var cache = null;
function torchParts(THREE) {
  if (cache) return cache;
  cache = {};
  for (const part of TORCH_PARTS) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(decode(part.positions, Float32Array), 3));
    geometry.setAttribute("normal", new THREE.BufferAttribute(decode(part.normals, Float32Array), 3));
    if (part.uvs) geometry.setAttribute("uv", new THREE.BufferAttribute(decode(part.uvs, Float32Array), 2));
    geometry.setIndex(new THREE.BufferAttribute(decode(part.index, Uint16Array), 1));
    geometry.computeBoundingSphere();
    let material = null;
    if (part.name !== "Flame") {
      const m = part.material;
      material = new THREE.MeshStandardMaterial({ roughness: m.roughness, metalness: m.metalness });
      if (m.map) {
        const tex = new THREE.TextureLoader().load(m.map);
        tex.flipY = false;
        tex.colorSpace = THREE.SRGBColorSpace;
        material.map = tex;
      }
    }
    cache[part.name] = { geometry, material };
  }
  return cache;
}
var SOLID_PARTS = TORCH_PARTS.filter((p) => p.name !== "Flame").map((p) => p.name);

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
  const parts = torchParts(THREE);
  const yAxis = new THREE.Vector3(0, 1, 0);
  for (const name of SOLID_PARTS)
    instanced("dk-torch-" + name.replace(/^WallTorch_/, ""), parts[name].geometry, parts[name].material, torches, (p) => {
      const w = onWall(p, 0.505);
      position.set(w.x, TORCH_BASE_Y, w.z);
      quaternion.setFromAxisAngle(yAxis, Math.atan2(p.fx ?? 0, p.fy ?? 1));
      scale.setScalar(TORCH_SCALE);
    });
  const flameOut = 0.505 + FLAME_AT[2] * TORCH_SCALE;
  const flameBase = TORCH_BASE_Y + FLAME_AT[1] * TORCH_SCALE;
  const torchFlame = TORCH_SCALE * FLAME_GROW;
  const flameSpots = torches.map((p) => ({ ...onWall(p, flameOut), y: flameBase + 0.11 * torchFlame, by: flameBase, sc: torchFlame })).concat((byKind.brazier ?? []).map((p) => ({ x: worldX(p.x), y: 0.75, z: worldZ(p.y), by: 0.55, sc: 2.4 })));
  const flames = instanced(
    "dk-flames",
    parts.Flame.geometry,
    new THREE.MeshStandardMaterial({ color: theme.torchColor, emissive: theme.torchColor, emissiveIntensity: LOOK.flameIntensity, roughness: 1 }),
    flameSpots,
    (p) => {
      position.set(p.x, p.by, p.z);
      scale.setScalar(p.sc);
    }
  );
  if (flames) flames.userData.spots = flameSpots;
  const cores = instanced(
    "dk-flame-cores",
    new THREE.ConeGeometry(0.03, 0.1, 6),
    new THREE.MeshBasicMaterial({ color: 16773576 }),
    flameSpots,
    (p) => {
      position.set(p.x, p.by + 0.05 * p.sc, p.z);
      scale.setScalar(p.sc);
    }
  );
  if (cores) cores.userData.spots = flameSpots.map((p) => ({ ...p, by: p.by + 0.05 * p.sc }));
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
        const sc = p.sc ?? 1;
        m.makeScale(sc / Math.sqrt(k), sc * k, sc / Math.sqrt(k)).setPosition(p.x, p.by ?? p.y, p.z);
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
  version: "2.2.1",
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
