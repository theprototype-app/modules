// modules/navigation/src/brain.js
var NPC_DEFAULTS = Object.freeze({
  /** sight cone, full angle in degrees (360 = eyes in the back of its head) */
  sightAngle: 100,
  /** how far it sees, m */
  sightRange: 12,
  /** how far a normal noise (loudness 1) is heard, m; a louder noise reaches further */
  hearing: 6,
  /** it gives up when the player is further than this, m */
  chaseRange: 25,
  /** it attacks closer than this, m */
  attackRange: 1.6,
  /** s between attacks */
  attackEvery: 1,
  /** s it looks toward a noise before going to see */
  alert: 1.5,
  /** s without seeing (or hearing) the player before it gives up */
  giveUp: 4,
  /** walking speed (return, search, a guard with no Path), m/s */
  speed: 1.6,
  /** chase speed, m/s */
  run: 3.6,
  /** eye height above its feet, m */
  eye: 1.6,
  /** players closer than this are felt even outside the cone, m */
  touch: 1.2
});
var CLAMP = {
  sightAngle: [10, 360],
  sightRange: [0.5, 100],
  hearing: [0, 100],
  chaseRange: [1, 300],
  attackRange: [0.3, 20],
  attackEvery: [0.1, 30],
  alert: [0, 30],
  giveUp: [0.2, 120],
  speed: [0.1, 15],
  run: [0.1, 20],
  eye: [0.1, 5],
  touch: [0, 5]
};
function normalizeNpc(raw) {
  const out = { ...NPC_DEFAULTS };
  for (const k of Object.keys(NPC_DEFAULTS)) {
    const v = Number(raw?.[k]);
    if (raw?.[k] !== void 0 && raw?.[k] !== "" && Number.isFinite(v)) out[k] = Math.min(CLAMP[k][1], Math.max(CLAMP[k][0], v));
  }
  return out;
}
var STATES = ["idle", "patrol", "alert", "chase", "attack", "return"];
var dxz = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);
var ALERT_CAP = 60;
function inCone(from, yaw, p, angleDeg, range) {
  const d = dxz(from, p);
  if (d > range) return false;
  if (angleDeg >= 360 || d < 1e-6) return true;
  const fx = Math.sin(yaw);
  const fz = Math.cos(yaw);
  const cos = ((p[0] - from[0]) * fx + (p[2] - from[2]) * fz) / d;
  return cos >= Math.cos(angleDeg / 2 * Math.PI / 180);
}
function yawToward(a, b) {
  return Math.atan2(b[0] - a[0], b[2] - a[2]);
}
function newBrain(home, yaw = 0) {
  return {
    state: "idle",
    since: 0,
    home: [...home],
    homeYaw: yaw,
    /** the player being chased (id) */
    target: (
      /** @type {string | null} */
      null
    ),
    /** where the target was last seen / heard */
    lastPos: (
      /** @type {number[] | null} */
      null
    ),
    lastSeen: -Infinity,
    lastAttack: -Infinity,
    /** where a noise came from (alert) */
    noise: (
      /** @type {number[] | null} */
      null
    ),
    /** when it reached the noise and started looking around (-Infinity = not yet) */
    searchAt: -Infinity,
    label: "idle"
  };
}
function think(b, w) {
  const { now, pos, yaw, p } = w;
  const events = [];
  const enter = (s) => {
    if (b.state !== s) {
      b.state = s;
      b.since = now;
    }
  };
  const eye = [pos[0], pos[1] + p.eye, pos[2]];
  let seen = null;
  for (const pl of w.players) {
    const d = dxz(pos, pl.pos);
    const close = d <= p.touch && Math.abs(pl.pos[1] - pos[1]) < 2;
    const cone = close || inCone(pos, yaw, pl.pos, p.sightAngle, p.sightRange);
    if (!cone) continue;
    const chest = [pl.pos[0], pl.pos[1] + 1.2, pl.pos[2]];
    if (!close && !w.see(eye, chest)) continue;
    if (!seen || pl.id === b.target || seen.id !== b.target && d < seen.d) seen = { id: pl.id, pos: pl.pos, d };
  }
  let heard = null;
  for (const n of w.noises) {
    const reach = p.hearing * Math.max(0, n.loudness);
    if (reach > 0 && dxz(pos, n.pos) <= reach && (!heard || n.loudness > heard.loudness)) heard = n;
  }
  const calm = b.state === "idle" || b.state === "patrol" || b.state === "return" || b.state === "alert";
  if (seen) {
    if (calm || b.target !== seen.id) {
      if (calm) events.push({ name: "spotted", player: seen.id });
      b.target = seen.id;
    }
    b.lastPos = [...seen.pos];
    b.lastSeen = now;
    const level = Math.abs(seen.pos[1] - pos[1]) <= 1.2;
    if (seen.d <= p.attackRange && level) enter("attack");
    else if (b.state !== "attack" || seen.d > p.attackRange * 1.25 || !level) enter("chase");
  } else if (heard && calm) {
    if (b.state !== "alert" || !b.noise || dxz(b.noise, heard.pos) > 1) {
      events.push({ name: "heard" });
      b.searchAt = -Infinity;
    }
    b.noise = [...heard.pos];
    enter("alert");
  } else if (heard && (b.state === "chase" || b.state === "attack")) {
    b.lastPos = [...heard.pos];
  }
  if (b.state === "attack" && !seen) enter("chase");
  if (b.state === "chase") {
    const lostFor = now - b.lastSeen;
    const far = b.target && w.players.find((pl) => pl.id === b.target);
    const tooFar = far ? dxz(pos, far.pos) > p.chaseRange : false;
    if (lostFor >= p.giveUp || tooFar || !far) {
      events.push({ name: "lost", player: b.target ?? void 0 });
      events.push({ name: "gaveup", player: b.target ?? void 0 });
      b.target = null;
      enter("return");
    }
  }
  if (b.state === "alert" && (now - b.since > ALERT_CAP || w.reach && !w.reach.ok && now - b.since > p.alert + p.giveUp)) enter("return");
  const home = w.patrol ?? b.home;
  let goal = (
    /** @type {number[] | null} */
    null
  );
  let speed = p.speed;
  let face = (
    /** @type {number[] | null} */
    null
  );
  let label = b.state;
  switch (b.state) {
    case "idle":
    case "patrol": {
      if (w.patrol) enter("patrol");
      else enter("idle");
      goal = home;
      label = b.state === "patrol" ? "patrol" : "idle: guarding";
      if (b.state === "idle" && dxz(pos, home) < 0.7) face = [home[0] + Math.sin(b.homeYaw) * 5, home[1], home[2] + Math.cos(b.homeYaw) * 5];
      break;
    }
    case "alert": {
      const waited = now - b.since;
      face = b.noise;
      if (waited < p.alert) {
        goal = null;
        label = "alert: heard a noise";
      } else {
        goal = b.noise;
        label = "alert: going to look";
        if (b.noise && dxz(pos, b.noise) < 1.2) {
          if (!Number.isFinite(b.searchAt)) b.searchAt = now;
          goal = null;
          label = "alert: looking around";
          if (now - b.searchAt >= p.giveUp) {
            events.push({ name: "gaveup" });
            enter("return");
            goal = home;
          }
        }
      }
      break;
    }
    case "chase": {
      speed = p.run;
      const lostFor = now - b.lastSeen;
      goal = b.lastPos;
      label = lostFor > 0.3 ? "chase: target lost " + Math.floor(lostFor) + " s" : "chase";
      break;
    }
    case "attack": {
      goal = null;
      face = b.lastPos;
      label = "attack";
      if (now - b.lastAttack >= p.attackEvery) {
        b.lastAttack = now;
        events.push({ name: "attack", player: b.target ?? void 0 });
      }
      break;
    }
    case "return": {
      goal = home;
      label = "give up: returning";
      if (dxz(pos, home) < 0.7) {
        events.push({ name: "returned" });
        enter(w.patrol ? "patrol" : "idle");
        label = b.state;
      }
      break;
    }
  }
  if (w.reach && !w.reach.ok && goal) label += " (can't reach: " + w.reach.why + ")";
  b.label = label;
  return { state: b.state, goal, speed, face, events, label };
}

// modules/navigation/src/workerClient.js
function makeWorkerClient(api) {
  let worker = null;
  let starting = null;
  let seq = 0;
  const pending = /* @__PURE__ */ new Map();
  let dead = false;
  const stats = { started: 0, messages: 0, errors: 0, lastError: "" };
  async function start() {
    const scriptUrl = api.assetUrl("assets/nav-worker.js");
    const wasmUrl = api.assetUrl("assets/recast.wasm");
    if (!scriptUrl || !wasmUrl) throw new Error("navigation: the worker or wasm asset is missing from the module");
    const text = await (await fetch(scriptUrl)).text();
    const blob = new Blob([text], { type: "text/javascript" });
    const url = URL.createObjectURL(blob);
    worker = new Worker(url, { name: "navigation" });
    URL.revokeObjectURL(url);
    worker.onmessage = (event) => {
      const msg = event.data ?? {};
      const p = pending.get(msg.id);
      if (!p) return;
      pending.delete(msg.id);
      stats.messages++;
      if (msg.ok) p.resolve(msg);
      else {
        stats.errors++;
        stats.lastError = String(msg.error ?? "");
        p.reject(new Error(msg.error));
      }
    };
    worker.onerror = (event) => {
      stats.errors++;
      stats.lastError = String(event.message ?? "worker error");
      for (const p of pending.values()) p.reject(new Error(stats.lastError));
      pending.clear();
    };
    stats.started++;
    await call("init", { wasmUrl });
  }
  function call(op, body = {}, transfer = []) {
    if (!worker) return Promise.reject(new Error("navigation: worker not started"));
    const id = ++seq;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      worker.postMessage({ id, op, ...body }, transfer);
    });
  }
  api.onUnload(() => {
    dead = true;
    worker?.terminate();
    worker = null;
    for (const p of pending.values()) p.reject(new Error("navigation unloaded"));
    pending.clear();
  });
  return {
    stats,
    /** started (and the wasm loaded)? */
    get running() {
      return !!worker && !starting;
    },
    get started() {
      return !!worker;
    },
    /** start once; later calls share the same promise */
    ensure() {
      if (dead) return Promise.reject(new Error("navigation unloaded"));
      if (!starting && !worker) {
        starting = start().then(
          () => {
            starting = null;
          },
          (error) => {
            starting = null;
            worker?.terminate();
            worker = null;
            throw error;
          }
        );
      }
      return starting ?? Promise.resolve();
    },
    call,
    stop() {
      worker?.terminate();
      worker = null;
      for (const p of pending.values()) p.reject(new Error("navigation stopped"));
      pending.clear();
    }
  };
}

// modules/navigation/src/caps.js
function deviceClass(api) {
  const ua = typeof navigator !== "undefined" ? String(navigator.userAgent || "") : "";
  if (api?.isVR?.() || /OculusBrowser|Quest|Pico/i.test(ua)) return "headset";
  if (/Android|iPhone|iPad|Mobile/i.test(ua)) return "phone";
  return "desktop";
}
var CAPS = Object.freeze({
  desktop: Object.freeze({ npcs: 64, bakeTriangles: 6e5, rebakeMs: 2500 }),
  phone: Object.freeze({ npcs: 24, bakeTriangles: 2e5, rebakeMs: 4e3 }),
  headset: Object.freeze({ npcs: 24, bakeTriangles: 2e5, rebakeMs: 4e3 })
});
function capsFor(api) {
  const kind = deviceClass(api);
  return { kind, ...CAPS[kind] };
}
function npcCapMessage(caps, count) {
  return "Navigation: this scene has " + count + " enemies; a " + caps.kind + " runs " + caps.npcs + " at once, the rest stand still.";
}
function bakeCapMessage(caps, triangles) {
  return "Navigation: the scene has more than " + Math.round(caps.bakeTriangles / 1e3) + "k triangles to walk on (" + Math.round(triangles / 1e3) + "k+); a " + caps.kind + " bakes the first part only. Hide or simplify the biggest meshes.";
}

// modules/navigation/src/runtime.js
var NAV_EFFECTS = Object.freeze({ navnpc: 0, navchase: 1, navflee: 2, navmoveto: 3, navpatrol: 4, navwander: 5 });
var NAV_TYPES = [...Object.keys(NAV_EFFECTS), "navnoise", "navevent", "navstate", "navmesh"];
var NPC_EVENTS = ["spotted", "heard", "attack", "lost", "gaveup", "returned", "unreachable", "arrived"];
var WHY = ["any", "off mesh", "blocked", "too far"];
var SNAP_MS = 100;
var THINK_MS = 100;
var WATCH_MS = 1e3;
var BEAT_MS = 2e3;
var BEAT_TTL = 5500;
var r2 = (v) => Math.round(v * 100) / 100;
var dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
var dxz2 = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);
var wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));
function heardPeers(me, heard, now) {
  return [...heard].filter(([id, at]) => id !== me && now - at <= BEAT_TTL).map(([id]) => id);
}
function isHeardByAll(me, heard, info, now) {
  for (const id of heardPeers(me, heard, now)) {
    const hears = info.get(id)?.hears;
    if (hears && !hears.has(me)) return false;
  }
  return true;
}
function elect({ me, active, heard, info, now }) {
  const ids = [];
  if (active && isHeardByAll(me, heard, info, now)) ids.push(me);
  for (const id of heardPeers(me, heard, now)) if (info.get(id)?.ok !== false) ids.push(id);
  if (!ids.length) return null;
  ids.sort();
  return ids[0];
}
function createRuntime(api) {
  const THREE = api.THREE;
  const client = makeWorkerClient(api);
  const caps = capsFor(api);
  const me = () => String(api.peerId?.() ?? "");
  const seen = /* @__PURE__ */ new Map();
  const shown = /* @__PURE__ */ new Map();
  const agents = /* @__PURE__ */ new Map();
  const activePeers = /* @__PURE__ */ new Map();
  const beatInfo = /* @__PURE__ */ new Map();
  const eventTarget = /* @__PURE__ */ new Map();
  const noiseNodes = /* @__PURE__ */ new Map();
  const noiseStamps = /* @__PURE__ */ new Map();
  let noises = [];
  const playerFeet = /* @__PURE__ */ new Map();
  const playerLast = /* @__PURE__ */ new Map();
  const bake = {
    status: (
      /** @type {'idle' | 'baking' | 'ready' | 'empty' | 'failed'} */
      "idle"
    ),
    ms: 0,
    triangles: 0,
    area: 0,
    error: "",
    truncated: false,
    signature: "",
    at: 0,
    /** @type {{positions: Float32Array, indices: Uint32Array} | null} */
    debug: null,
    version: 0
  };
  let obstacles = [];
  let obstaclesDirty = false;
  let baking = false;
  let bakeAgain = false;
  let rebakeTimer = null;
  let stepping = false;
  let lastStepAt = 0;
  let lastThink = 0;
  let lastSnap = 0;
  let snapCount = 0;
  let lastWatch = 0;
  let lastBeat = 0;
  let wasActive = false;
  let wasAuthority = false;
  let frame = 0;
  let lastFrameAt = 0;
  let navNodes = 0;
  let lastSnapshot = null;
  const want = { overlay: false, debug: false };
  const toasted = /* @__PURE__ */ new Set();
  const stats = { thinks: 0, steps: 0, snapsSent: 0, snapsGot: 0, reaches: 0, events: (
    /** @type {Record<string, number>} */
    {}
  ), lastEvent: "" };
  const listeners = /* @__PURE__ */ new Set();
  const notify = () => listeners.forEach((fn) => {
    try {
      fn();
    } catch {
    }
  });
  const toastOnce = (key, text) => {
    if (toasted.has(key)) return;
    toasted.add(key);
    api.toast(text);
  };
  function active() {
    try {
      return !!api.isPlaying?.() || api.editorMode?.() === "interact" || !!api.isVR?.();
    } catch {
      return false;
    }
  }
  function authorityId() {
    const roster = new Set((api.peerIds?.() ?? []).map(String));
    const now = Date.now();
    for (const [id, at] of activePeers)
      if (now - at > BEAT_TTL || roster.size && !roster.has(id)) {
        activePeers.delete(id);
        beatInfo.delete(id);
      }
    return elect({ me: me(), active: active(), heard: activePeers, info: beatInfo, now });
  }
  const hearsNow = () => heardPeers(me(), activePeers, Date.now());
  const heardByAll = () => isHeardByAll(me(), activePeers, beatInfo, Date.now());
  const isAuthority = () => authorityId() === me() && active();
  function objectInput(node, handle, edges, byId) {
    for (const e of edges) {
      if (e.target !== node.id || e.targetHandle !== handle) continue;
      const src = byId.get(e.source);
      const sel = src?.type === "objectselector" ? src.data?.selected : null;
      if (sel && sel !== "-None-") return String(sel);
    }
    const own = node.data?.[handle];
    if (typeof own === "string" && own && own !== "-None-") return own;
    return node.graphId && node.graphId !== "scene" ? node.graphId : null;
  }
  function scanGraph() {
    const all = api.flow.nodes();
    const mine = all.filter((n) => NAV_TYPES.includes(n.type));
    navNodes = mine.length;
    const edges = api.flow.edges();
    const byId = new Map(all.map((n) => [n.id, n]));
    eventTarget.clear();
    noiseNodes.clear();
    for (const n of mine) {
      if (n.type === "navevent" || n.type === "navstate") eventTarget.set(n.id, objectInput(n, "npc", edges, byId));
      if (n.type === "navnoise") {
        const sources = edges.filter((e) => e.target === n.id && e.targetHandle === "trigger").map((e) => e.source);
        noiseNodes.set(n.id, { sources: [...sources, n.id], at: objectInput(n, "at", edges, byId), loudness: Number(n.data?.loudness ?? 1) || 1 });
      }
    }
    if (!navNodes) {
      agents.clear();
      shown.clear();
    }
    notify();
  }
  function bakeSettings() {
    const node = api.flow.nodes("navmesh")[0];
    return node ? { ...node.data } : {};
  }
  const needMesh = () => navNodes > 0 && (want.overlay || isAuthority() && seen.size > 0);
  async function rebake() {
    if (baking) {
      bakeAgain = true;
      return;
    }
    baking = true;
    bake.status = "baking";
    notify();
    try {
      await client.ensure();
      const geo = await api.colliderGeometry({ exclude: [...seen.keys()], maxTriangles: caps.bakeTriangles });
      if (geo.truncated) toastOnce("bake-cap", bakeCapMessage(caps, geo.triangles));
      bake.signature = geo.signature;
      bake.truncated = geo.truncated;
      obstacles = geo.moving.map((m) => ({ key: m.uuid, min: m.min, max: m.max }));
      obstaclesDirty = true;
      if (!geo.triangles) {
        Object.assign(bake, { status: "empty", triangles: 0, area: 0, debug: null, error: "nothing to walk on" });
        bake.version++;
        return;
      }
      const r = await client.call("bake", { positions: geo.positions, indices: geo.indices, bake: bakeSettings(), maxAgents: caps.npcs }, [geo.positions.buffer, geo.indices.buffer]);
      Object.assign(bake, {
        status: r.baked ? "ready" : "failed",
        ms: Math.round(r.ms ?? 0),
        triangles: r.triangles ?? geo.triangles,
        area: r.area ?? 0,
        error: r.baked ? "" : String(r.error ?? "bake failed"),
        debug: r.debug ?? null,
        at: Date.now()
      });
      bake.version++;
      for (const a of agents.values()) a.reachAt = 0;
      if (!r.baked) toastOnce("bake-failed", "Navigation: the navmesh bake failed (" + bake.error + ").");
    } catch (error) {
      Object.assign(bake, { status: "failed", error: error instanceof Error ? error.message : String(error) });
      toastOnce("bake-error", "Navigation could not start: " + bake.error);
    } finally {
      baking = false;
      notify();
      if (bakeAgain) {
        bakeAgain = false;
        scheduleRebake(200);
      }
    }
  }
  function scheduleRebake(ms) {
    if (rebakeTimer) api.timers.clearTimeout(rebakeTimer);
    rebakeTimer = api.timers.setTimeout(() => {
      rebakeTimer = null;
      if (needMesh()) rebake();
    }, ms);
  }
  async function watch() {
    if (baking || bake.status === "idle") return;
    const geo = await api.colliderGeometry({ exclude: [...seen.keys()], signatureOnly: true });
    const moving = geo.moving.map((m) => ({ key: m.uuid, min: m.min, max: m.max }));
    if (JSON.stringify(moving.map((m) => [m.key, m.min.map(r2), m.max.map(r2)])) !== JSON.stringify(obstacles.map((m) => [m.key, m.min.map(r2), m.max.map(r2)]))) {
      obstacles = moving;
      obstaclesDirty = true;
      notify();
    }
    if (geo.signature !== bake.signature) {
      bake.signature = geo.signature;
      scheduleRebake(Math.max(1200, Math.min(1e4, bake.ms * 3, caps.rebakeMs * 2)));
    }
  }
  const vW = new THREE.Vector3();
  const boxW = new THREE.Box3();
  function drive(type, object, base, data, ctx) {
    if (!object?.uuid || data?.enabled === false || data?.enabled === 0) return;
    const uuid = object.uuid;
    const cur = seen.get(uuid);
    const rank = NAV_EFFECTS[
      /** @type {keyof typeof NAV_EFFECTS} */
      type
    ] ?? 9;
    if (!cur || cur.frame !== frame || rank < cur.rank || rank === cur.rank && ctx.id < cur.nodeId) {
      seen.set(uuid, { uuid, type, rank, nodeId: ctx?.id ?? "", graphId: ctx?.graphId ?? "scene", object, data, base: { pos: [...base?.pos ?? [0, 0, 0]], rot: [...base?.rot ?? [0, 0, 0]] }, frame });
    }
    if (!active()) return;
    const s = shown.get(uuid);
    if (!s?.disp) return;
    vW.fromArray(s.disp);
    object.parent?.worldToLocal(vW);
    object.position.copy(vW);
    object.rotation.y = s.yaw + (Number(data?.faceOffset) || 0) * Math.PI / 180;
  }
  function homeOf(entry) {
    const o = entry.object;
    vW.fromArray(entry.base.pos);
    if (o.parent) {
      o.parent.updateWorldMatrix(true, false);
      vW.applyMatrix4(o.parent.matrixWorld);
    }
    const origin = vW.toArray();
    o.updateWorldMatrix(true, true);
    boxW.setFromObject(o);
    const wp = new THREE.Vector3().setFromMatrixPosition(o.matrixWorld);
    const foot = boxW.isEmpty() ? 0 : Math.max(0, wp.y - boxW.min.y);
    const size = boxW.isEmpty() ? new THREE.Vector3(0.6, 1.8, 0.6) : boxW.getSize(new THREE.Vector3());
    const radius = Math.min(1, Math.max(0.2, Math.max(size.x, size.z) / 2));
    return { origin, feet: [origin[0], origin[1] - foot, origin[2]], foot, radius, yaw: entry.base.rot[1] ?? 0 };
  }
  function objectPos(uuid) {
    const o = api.objectsGroup()?.getObjectByProperty("uuid", uuid);
    if (!o) return null;
    o.updateWorldMatrix(true, false);
    return new THREE.Vector3().setFromMatrixPosition(o.matrixWorld).toArray();
  }
  function playersNow() {
    const out = [];
    const now = Date.now();
    for (const p of api.players?.() ?? []) {
      if (p.me ? !active() : !(p.playing || now - (activePeers.get(String(p.id)) ?? -Infinity) <= BEAT_TTL)) continue;
      const raw = [p.pos[0], p.pos[1] - 1.6, p.pos[2]];
      const snap = playerFeet.get(p.id);
      const feet = snap && dxz2(snap, raw) < 0.6 && Math.abs(snap[1] - raw[1]) < 0.9 ? snap : raw;
      out.push({ id: p.id, pos: feet, head: p.pos });
    }
    return out;
  }
  function nearestPlayer(from, players) {
    let best = null;
    let bestD = Infinity;
    for (const p of players) {
      const d = dist(from, p.pos);
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    return best;
  }
  const ray = new THREE.Raycaster();
  const vA = new THREE.Vector3();
  const vB = new THREE.Vector3();
  function sees(a, from, to) {
    const root = api.objectsGroup();
    if (!root) return true;
    vA.fromArray(from);
    vB.fromArray(to).sub(vA);
    const far = vB.length();
    if (far < 0.05) return true;
    ray.set(vA, vB.normalize());
    ray.far = far;
    const hits = ray.intersectObjects(root.children, true);
    for (const h of hits) {
      const o = h.object;
      if (!o.isMesh || h.distance > far - 0.3) continue;
      let skip = false;
      for (let n = o; n && n !== root; n = n.parent) {
        if (n.uuid === a.uuid || n.visible === false || n.userData?.navIgnore || n.userData?.physics?.sensor || n.userData?.water || n.userData?.spline) {
          skip = true;
          break;
        }
      }
      if (!skip) return false;
    }
    return true;
  }
  function fire(uuid, name, extra = {}) {
    stats.events[name] = (stats.events[name] ?? 0) + 1;
    stats.lastEvent = name + (extra.why ? " (" + extra.why + ")" : "");
    api.fireNodeTrigger("navevent", (data, id) => {
      const want2 = eventTarget.has(id) ? eventTarget.get(id) : null;
      if (want2 && want2 !== uuid) return false;
      if ((data?.event ?? "spotted") !== name) return false;
      if (name === "unreachable" && data?.why && data.why !== "any" && data.why !== extra.why) return false;
      return true;
    });
  }
  function agentFor(entry) {
    let a = agents.get(entry.uuid);
    if (a) return a;
    const h = homeOf(entry);
    const was = shown.get(entry.uuid);
    const feet = was?.disp ? [was.disp[0], was.disp[1] - h.foot, was.disp[2]] : h.feet;
    a = {
      uuid: entry.uuid,
      home: h.feet,
      foot: h.foot,
      radius: h.radius,
      feet,
      vel: [0, 0, 0],
      yaw: was?.yaw ?? h.yaw,
      face: (
        /** @type {number[] | null} */
        null
      ),
      speed: 1.6,
      brain: newBrain(h.feet, h.yaw),
      target: (
        /** @type {number[] | null} */
        null
      ),
      reachOpts: {},
      reach: (
        /** @type {any} */
        null
      ),
      reachAt: 0,
      crowdGoal: (
        /** @type {number[] | null} */
        null
      ),
      stopped: false,
      unreachWhy: "",
      arrived: false,
      wp: -1,
      wpDir: 1,
      wanderAt: 0,
      fleeAt: 0,
      pending: false,
      corners: (
        /** @type {number[][]} */
        []
      ),
      state: "idle",
      label: "",
      teleport: !!was?.disp
    };
    agents.set(entry.uuid, a);
    return a;
  }
  function setTarget(a, target, opts = {}, now = Date.now()) {
    if (!target) {
      a.target = null;
      a.crowdGoal = null;
      a.reach = null;
      a.unreachWhy = "";
      return;
    }
    const moved = !a.target || dist(target, a.target) > 0.5;
    a.target = target;
    a.reachOpts = opts;
    if (moved || now - a.reachAt > 1e3) a.reachDue = true;
  }
  function waypoint(a, pathUuid, advance = true) {
    const info = pathUuid ? api.paths?.of(pathUuid) : null;
    const pts = info?.points?.map((q) => Array.isArray(q) ? q : q?.pos).filter((q) => Array.isArray(q));
    if (!pts?.length) return null;
    const n = pts.length;
    if (a.wp < 0 || a.wp >= n || a.wpPath !== pathUuid) {
      let best = 0;
      for (let i = 1; i < n; i++) if (dxz2(a.feet, pts[i]) < dxz2(a.feet, pts[best])) best = i;
      a.wp = best;
      a.wpPath = pathUuid;
    }
    if (advance && dxz2(a.feet, pts[a.wp]) < Math.max(0.7, a.radius * 1.5)) {
      if (info.closed) a.wp = (a.wp + 1) % n;
      else {
        if (a.wp + a.wpDir >= n || a.wp + a.wpDir < 0) a.wpDir = -a.wpDir;
        a.wp = Math.max(0, Math.min(n - 1, a.wp + a.wpDir));
      }
    }
    return pts[a.wp];
  }
  function collectNoises(now, players) {
    noises = noises.filter((n) => n.until > now || !n.heardBy);
    for (const [id, node] of noiseNodes) {
      for (const src of node.sources) {
        const t = api.flow.triggerStamp(src);
        const stamp = t?.stamp ?? 0;
        const before = noiseStamps.get(src);
        noiseStamps.set(src, stamp);
        if (before === void 0 || !stamp || stamp === before) continue;
        let at = node.at ? objectPos(node.at) : null;
        if (!at) at = nearestPlayer([0, 0, 0], players)?.pos ?? null;
        if (at) noises.push({ pos: at, loudness: node.loudness, until: now + 600 });
        void id;
      }
    }
    for (const p of players) {
      const last = playerLast.get(p.id);
      playerLast.set(p.id, { pos: p.pos, at: now });
      if (!last || now - last.at > 1e3) continue;
      const speed = dxz2(p.pos, last.pos) / Math.max(0.016, (now - last.at) / 1e3);
      if (speed > 4.2) noises.push({ pos: p.pos, loudness: 0.5, until: now + 300 });
    }
  }
  function thinkAll(now) {
    stats.thinks++;
    const players = playersNow();
    collectNoises(now, players);
    const clock = now / 1e3;
    for (const entry of seen.values()) {
      const a = agentFor(entry);
      const d = entry.data ?? {};
      const type = entry.type;
      let label = "";
      if (type === "navnpc") {
        const p = normalizeNpc(d);
        const pathUuid = typeof d.path === "string" && d.path && d.path !== "-None-" ? d.path : "";
        const patrol = pathUuid ? waypoint(a, pathUuid, a.brain.state === "patrol") : null;
        const out = think(a.brain, {
          now: clock,
          pos: a.feet,
          yaw: a.yaw,
          p,
          players,
          see: (from, to) => sees(a, from, to),
          noises,
          patrol,
          reach: a.reach
        });
        a.speed = out.speed;
        a.face = out.face;
        a.state = out.state;
        label = out.label;
        for (const ev of out.events) fire(a.uuid, ev.name, ev);
        setTarget(a, out.goal, { maxPath: out.state === "chase" ? p.chaseRange * 2.5 : Infinity }, now);
      } else if (type === "navchase") {
        const tgt = d.target && d.target !== "-None-" ? objectPos(d.target) : nearestPlayer(a.feet, players)?.pos ?? null;
        a.speed = Number(d.speed) || 3.5;
        a.state = "chase";
        a.face = tgt;
        const stopAt = Math.max(0.3, Number(d.stopAt) || 1.2);
        if (tgt && dxz2(a.feet, tgt) <= stopAt) {
          setTarget(a, null);
          label = "chase: caught up";
        } else {
          setTarget(a, tgt, { maxPath: Number(d.maxPath) > 0 ? Number(d.maxPath) : Infinity }, now);
          label = tgt ? "chase" : "chase: no target";
        }
      } else if (type === "navmoveto") {
        const tgt = d.target && d.target !== "-None-" ? objectPos(d.target) : Array.isArray(d.point) ? d.point : null;
        a.speed = Number(d.speed) || 2;
        a.state = "patrol";
        a.face = null;
        if (tgt && dxz2(a.feet, tgt) < 0.6) {
          if (!a.arrived) fire(a.uuid, "arrived");
          a.arrived = true;
          setTarget(a, null);
          label = "move to: arrived";
        } else {
          if (tgt && a.arrived && dxz2(a.feet, tgt) > 1.2) a.arrived = false;
          setTarget(a, tgt, {}, now);
          label = tgt ? "move to" : "move to: no target";
        }
      } else if (type === "navpatrol") {
        a.speed = Number(d.speed) || 1.6;
        a.state = "patrol";
        a.face = null;
        const pt = waypoint(a, typeof d.path === "string" ? d.path : "");
        setTarget(a, pt, {}, now);
        label = pt ? "patrol " + (a.wp + 1) : "patrol: no Path";
      } else if (type === "navflee") {
        const threat = d.from && d.from !== "-None-" ? objectPos(d.from) : nearestPlayer(a.feet, players)?.pos ?? null;
        const safe = Math.max(1, Number(d.distance) || 8);
        a.speed = Number(d.speed) || 3.5;
        a.face = null;
        if (!threat || dxz2(a.feet, threat) > safe) {
          a.state = "idle";
          setTarget(a, null);
          label = "flee: safe";
        } else {
          a.state = "alert";
          label = "flee";
          if (!a.pending && (now - a.fleeAt > 1e3 || !a.target)) {
            a.fleeAt = now;
            a.pending = true;
            const away = [a.feet[0] - threat[0], 0, a.feet[2] - threat[2]];
            const len = Math.hypot(away[0], away[2]) || 1;
            const around = [a.feet[0] + away[0] / len * safe * 0.6, a.feet[1], a.feet[2] + away[2] / len * safe * 0.6];
            client.call("random", { list: [0, 1, 2, 3, 4, 5].map((i) => ({ key: String(i), around, radius: safe * 0.6 })) }).then((r) => {
              let best = null;
              let bestD = -1;
              for (const q of r.points ?? []) if (q.point && dxz2(q.point, threat) > bestD) {
                bestD = dxz2(q.point, threat);
                best = q.point;
              }
              if (best) setTarget(a, best, {}, Date.now());
            }).catch(() => {
            }).finally(() => a.pending = false);
          }
        }
      } else if (type === "navwander") {
        const radius = Math.max(1, Number(d.radius) || 6);
        a.speed = Number(d.speed) || 1.2;
        a.state = "patrol";
        a.face = null;
        const there = !a.target || dxz2(a.feet, a.target) < 0.7 || a.reach && !a.reach.ok;
        if (there && !a.wanderAt) a.wanderAt = now + Math.max(0, Number(d.pause ?? 2)) * 1e3;
        if (a.wanderAt && now >= a.wanderAt && !a.pending) {
          a.wanderAt = 0;
          a.pending = true;
          client.call("random", { list: [{ key: a.uuid, around: a.home, radius }] }).then((r) => {
            const pt = r.points?.[0]?.point;
            if (pt) setTarget(a, pt, {}, Date.now());
          }).catch(() => {
          }).finally(() => a.pending = false);
        }
        label = a.wanderAt ? "wander: pause" : "wander";
      }
      a.label = label;
    }
    for (const n of noises) n.heardBy = true;
    for (const uuid of [...agents.keys()]) if (!seen.has(uuid)) agents.delete(uuid);
    const due = [...agents.values()].filter((a) => a.reachDue && a.target);
    if (due.length && bake.status === "ready") {
      for (const a of due) {
        a.reachDue = false;
        a.reachAt = now;
      }
      stats.reaches += due.length;
      client.call("reach", { list: due.map((a) => ({ key: a.uuid, from: a.feet, target: a.target, maxPath: Number.isFinite(a.reachOpts?.maxPath) ? a.reachOpts.maxPath : void 0 })) }).then((r) => {
        for (const res of r.results ?? []) {
          const a = agents.get(res.key);
          if (!a || !a.target) continue;
          a.reach = { ok: res.ok, why: res.why, length: res.length };
          a.crowdGoal = res.goal ?? null;
          a.stopped = false;
          if (!res.ok) {
            if (a.unreachWhy !== res.why) {
              a.unreachWhy = res.why;
              fire(a.uuid, "unreachable", { why: res.why });
            }
          } else a.unreachWhy = "";
        }
      }).catch(() => {
      });
    }
  }
  function step(now) {
    if (stepping || bake.status !== "ready") return;
    stepping = true;
    const dt = lastStepAt ? Math.min(0.5, (now - lastStepAt) / 1e3) : 1 / 60;
    lastStepAt = now;
    const list = [];
    let n = 0;
    for (const a of agents.values()) {
      if (n++ >= caps.npcs) break;
      let goal = a.crowdGoal;
      if (goal) {
        const d = dxz2(a.feet, goal);
        const park = Math.max(0.3, a.radius);
        if (a.stopped ? d < park + 0.5 : d < park) {
          a.stopped = true;
          goal = null;
        } else a.stopped = false;
      }
      list.push({ key: a.uuid, pos: a.feet, speed: a.speed, radius: a.radius, goal, teleport: a.teleport });
      a.teleport = false;
    }
    const probe = (api.players?.() ?? []).map((p) => ({ key: p.id, p: [p.pos[0], p.pos[1] - 1, p.pos[2]] }));
    const body = { agents: list, dt, probe, wantDebug: want.overlay };
    if (obstaclesDirty) {
      body.obstacles = obstacles;
      obstaclesDirty = false;
    }
    client.call("step", body).then((r) => {
      stats.steps++;
      for (const q of r.probes ?? []) if (q.point) playerFeet.set(q.key, q.point);
      if (r.debug) {
        bake.debug = r.debug;
        bake.version++;
      }
      const sdt = Math.max(0.016, dt);
      for (const s of r.agents ?? []) {
        const a = agents.get(s.key);
        if (!a) continue;
        a.feet = s.pos;
        a.vel = s.vel;
        a.corners = s.corners ?? [];
        const sp = Math.hypot(s.vel[0], s.vel[2]);
        let want2 = a.yaw;
        if (sp > 0.15) want2 = Math.atan2(s.vel[0], s.vel[2]);
        else if (a.face) want2 = yawToward(a.feet, a.face);
        a.yaw = wrapAngle(a.yaw + wrapAngle(want2 - a.yaw) * Math.min(1, sdt * 8));
        const origin = [a.feet[0], a.feet[1] + a.foot, a.feet[2]];
        const row = shown.get(a.uuid) ?? {};
        shown.set(a.uuid, { ...row, target: origin, disp: origin, vel: [0, 0, 0], yaw: a.yaw, state: a.state, label: a.label, why: a.unreachWhy, corners: a.corners, at: performance.now() });
      }
      if (r.full) toastOnce("crowd-full", npcCapMessage(caps, agents.size));
    }).catch(() => {
    }).finally(() => stepping = false);
  }
  function buildSnapshot(withCorners = false) {
    const a = [];
    for (const [uuid, s] of shown) {
      if (!agents.has(uuid)) continue;
      const row = [uuid, r2(s.disp[0]), r2(s.disp[1]), r2(s.disp[2]), r2(s.yaw), Math.max(0, STATES.indexOf(s.state)), String(s.label ?? "").slice(0, 60), s.why ?? ""];
      if (withCorners) row.push((s.corners ?? []).slice(0, 4).map((c) => c.map(r2)));
      a.push(row);
    }
    return { op: "snap", from: me(), t: Date.now(), a };
  }
  function applySnapshot(snap) {
    if (!snap || !Array.isArray(snap.a)) return;
    lastSnapshot = snap;
    if (isAuthority()) return;
    stats.snapsGot++;
    const now = performance.now();
    const live = /* @__PURE__ */ new Set();
    for (const row of snap.a) {
      const [uuid, x, y, z, yaw, si, label, why, corners] = row;
      live.add(uuid);
      const s = shown.get(uuid) ?? {};
      const target = [x, y, z];
      const dtMsg = s.at ? Math.max(0.03, (now - s.at) / 1e3) : 0;
      const vel = s.target && dtMsg ? [(x - s.target[0]) / dtMsg, (y - s.target[1]) / dtMsg, (z - s.target[2]) / dtMsg] : [0, 0, 0];
      const jump = !s.disp || dist(s.disp, target) > 4;
      shown.set(uuid, {
        ...s,
        target,
        vel: jump ? [0, 0, 0] : vel.map((v) => Math.max(-12, Math.min(12, v))),
        disp: jump ? target : s.disp,
        yaw: s.yaw ?? yaw,
        yawTarget: yaw,
        state: STATES[si] ?? "idle",
        label,
        why: why ?? "",
        corners: corners ?? s.corners ?? [],
        at: now
      });
    }
    for (const uuid of [...shown.keys()]) if (!live.has(uuid)) shown.delete(uuid);
  }
  function ease(dt) {
    const now = performance.now();
    for (const s of shown.values()) {
      if (!s.target || !s.disp) continue;
      const age = Math.min(0.25, (now - (s.at ?? now)) / 1e3);
      const aim = [s.target[0] + s.vel[0] * age, s.target[1] + s.vel[1] * age, s.target[2] + s.vel[2] * age];
      const k = Math.min(1, dt * 12);
      s.disp = [s.disp[0] + (aim[0] - s.disp[0]) * k, s.disp[1] + (aim[1] - s.disp[1]) * k, s.disp[2] + (aim[2] - s.disp[2]) * k];
      if (s.yawTarget !== void 0) s.yaw = wrapAngle(s.yaw + wrapAngle(s.yawTarget - s.yaw) * Math.min(1, dt * 10));
    }
  }
  function tick() {
    frame++;
    const now = Date.now();
    const t = performance.now();
    const dt = lastFrameAt ? Math.min(0.1, (t - lastFrameAt) / 1e3) : 1 / 60;
    lastFrameAt = t;
    if (!navNodes) return;
    const on = active();
    if (on !== wasActive || on && now - lastBeat > BEAT_MS) {
      lastBeat = now;
      api.send(on ? { op: "here", from: me(), hears: hearsNow(), ok: heardByAll() } : { op: "gone", from: me() });
    }
    if (on !== wasActive && !on) {
      agents.clear();
    }
    wasActive = on;
    for (const [uuid, e] of seen) if (frame - e.frame > 30) seen.delete(uuid);
    const auth = isAuthority();
    if (auth !== wasAuthority) {
      wasAuthority = auth;
      if (!auth) agents.clear();
      notify();
    }
    if (needMesh() && bake.status === "idle" && !baking && !rebakeTimer) scheduleRebake(300);
    if (needMesh() && now - lastWatch > WATCH_MS) {
      lastWatch = now;
      watch().catch(() => {
      });
    }
    if (auth) {
      if (seen.size > caps.npcs) toastOnce("npc-cap", npcCapMessage(caps, seen.size));
      if (now - lastThink >= THINK_MS && bake.status === "ready") {
        lastThink = now;
        thinkAll(now);
      }
      step(now);
      if (now - lastSnap >= SNAP_MS) {
        lastSnap = now;
        snapCount++;
        const snap = buildSnapshot(snapCount % 5 === 0 || want.debug);
        lastSnapshot = snap;
        if (snap.a.length) {
          api.send(snap);
          stats.snapsSent++;
        }
      }
    } else {
      lastStepAt = 0;
      ease(dt);
    }
  }
  api.onMessage((msg) => {
    if (msg?.op === "here" && msg.from) {
      const from = String(msg.from);
      const first = !activePeers.has(from);
      activePeers.set(from, Date.now());
      beatInfo.set(from, { hears: Array.isArray(msg.hears) ? new Set(msg.hears.map(String)) : null, ok: msg.ok !== false });
      if (first) lastBeat = 0;
    } else if (msg?.op === "gone" && msg.from) {
      activePeers.delete(String(msg.from));
      beatInfo.delete(String(msg.from));
    } else if (msg?.op === "snap") {
      if (msg.from) activePeers.set(String(msg.from), Date.now());
      applySnapshot(msg);
    }
  });
  api.registerStateSync({
    getState: () => lastSnapshot ?? { op: "snap", a: [] },
    applyState: (st) => applySnapshot(st)
  });
  api.flow.onChange(scanGraph);
  api.onSceneClear?.(() => {
    agents.clear();
    shown.clear();
    seen.clear();
    bake.status = "idle";
    bake.debug = null;
    bake.version++;
    notify();
  });
  return {
    drive,
    tick,
    scanGraph,
    want,
    bake,
    caps,
    stats,
    client,
    shown,
    agents,
    seen,
    get obstacles() {
      return obstacles;
    },
    active,
    isAuthority,
    authorityId,
    /** re-run the bake now (the toolbox button, a test) */
    rebake: () => rebake(),
    /** @param {() => void} fn */
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    /** an NPC State read: pure of the replicated snapshot @param {string | null} uuid */
    stateOf(uuid) {
      if (uuid) return shown.get(uuid) ?? null;
      const first = shown.values().next();
      return first.done ? null : first.value;
    },
    eventTarget,
    /** a test hook: make a noise right now (authority only) @param {number[]} pos @param {number} loudness */
    noise(pos, loudness = 1) {
      noises.push({ pos, loudness, until: Date.now() + 600 });
    },
    /** a module-level teardown helper for a test @returns {any} */
    debug() {
      return {
        navNodes,
        seen: [...seen.values()].map((e) => ({ uuid: e.uuid, type: e.type, frame: e.frame })),
        frame,
        authority: authorityId(),
        me: me(),
        // who this peer hears playing (id, ms since its last beat or snapshot) and the roster it filters by
        heard: [...activePeers].map(([id, at]) => [id, Date.now() - at, beatInfo.get(id)?.ok ?? null]),
        heardByAll: heardByAll(),
        roster: (api.peerIds?.() ?? []).map(String),
        active: active(),
        bake: { ...bake, debug: bake.debug ? { triangles: bake.debug.indices.length / 3 } : null },
        obstacles: obstacles.length,
        agents: [...agents.values()].map((a) => ({ uuid: a.uuid, feet: a.feet.map(r2), state: a.state, label: a.label, why: a.unreachWhy, target: a.target?.map(r2) ?? null, goal: a.crowdGoal?.map(r2) ?? null, reach: a.reach, wp: a.wp })),
        shown: [...shown.entries()].map(([uuid, s]) => ({ uuid, disp: s.disp?.map(r2), state: s.state, label: s.label, why: s.why })),
        stats: { ...stats, events: { ...stats.events } },
        worker: { ...client.stats, started: client.started },
        caps
      };
    }
  };
}

// modules/navigation/src/bakeDefaults.js
var BAKE_DEFAULTS = Object.freeze({
  /** voxel size across, m — smaller = finer mesh, slower bake */
  cell: 0.2,
  /** voxel height, m */
  cellHeight: 0.15,
  /** the widest NPC, m: the mesh keeps this far from walls */
  radius: 0.4,
  /** the tallest NPC, m: ceilings lower than this are not walkable */
  height: 1.8,
  /** the highest step an NPC walks up, m */
  climb: 0.45,
  /** the steepest slope, degrees */
  slope: 45
});

// modules/navigation/src/nodes.js
var enabledInput = { enabled: "boolean" };
var STATE_READS = ["state", "chasing", "alert", "reachable"];
function registerNodes(api, rt) {
  api.registerNodeGroup({
    group: "Navigation",
    items: [
      {
        type: "navnpc",
        label: "Enemy (NPC)",
        defaults: { ...NPC_DEFAULTS, path: "", enabled: true, faceOffset: 0 },
        params: [
          { key: "sightAngle", kind: "range", min: 10, max: 360, step: 5 },
          { key: "sightRange", kind: "range", min: 1, max: 60, step: 0.5 },
          { key: "hearing", kind: "range", min: 0, max: 40, step: 0.5 },
          { key: "chaseRange", kind: "range", min: 2, max: 120, step: 1 },
          { key: "attackRange", kind: "range", min: 0.3, max: 10, step: 0.1 },
          { key: "attackEvery", kind: "range", min: 0.2, max: 10, step: 0.1 },
          { key: "alert", kind: "range", min: 0, max: 10, step: 0.25 },
          { key: "giveUp", kind: "range", min: 0.5, max: 30, step: 0.5 },
          { key: "speed", kind: "range", min: 0.2, max: 8, step: 0.1 },
          { key: "run", kind: "range", min: 0.2, max: 12, step: 0.1 },
          { key: "faceOffset", kind: "range", min: -180, max: 180, step: 90 }
        ]
      },
      {
        type: "navchase",
        label: "Chase",
        defaults: { target: "", speed: 3.5, stopAt: 1.2, maxPath: 0, enabled: true },
        params: [
          { key: "speed", kind: "range", min: 0.2, max: 12, step: 0.1 },
          { key: "stopAt", kind: "range", min: 0.3, max: 10, step: 0.1 },
          { key: "maxPath", kind: "range", min: 0, max: 200, step: 1 }
        ]
      },
      {
        type: "navflee",
        label: "Flee",
        defaults: { from: "", distance: 8, speed: 3.5, enabled: true },
        params: [
          { key: "distance", kind: "range", min: 1, max: 40, step: 0.5 },
          { key: "speed", kind: "range", min: 0.2, max: 12, step: 0.1 }
        ]
      },
      {
        type: "navmoveto",
        label: "Move To",
        defaults: { target: "", speed: 2, enabled: true },
        params: [{ key: "speed", kind: "range", min: 0.2, max: 12, step: 0.1 }]
      },
      {
        type: "navpatrol",
        label: "Patrol (Path)",
        defaults: { path: "", speed: 1.6, enabled: true },
        params: [{ key: "speed", kind: "range", min: 0.2, max: 12, step: 0.1 }]
      },
      {
        type: "navwander",
        label: "Wander",
        defaults: { radius: 6, pause: 2, speed: 1.2, enabled: true },
        params: [
          { key: "radius", kind: "range", min: 1, max: 50, step: 0.5 },
          { key: "pause", kind: "range", min: 0, max: 20, step: 0.5 },
          { key: "speed", kind: "range", min: 0.2, max: 12, step: 0.1 }
        ]
      },
      {
        type: "navnoise",
        label: "Make Noise",
        defaults: { loudness: 1, at: "", trigger: 0 },
        params: [{ key: "loudness", kind: "range", min: 0.1, max: 5, step: 0.1 }]
      },
      {
        type: "navevent",
        label: "On NPC Event",
        defaults: { event: "spotted", why: "any", npc: "" },
        params: [
          { key: "event", kind: "select", options: NPC_EVENTS },
          { key: "why", kind: "select", options: WHY }
        ]
      },
      {
        type: "navstate",
        label: "NPC State",
        defaults: { read: "state", npc: "" },
        params: [{ key: "read", kind: "select", options: STATE_READS }]
      },
      {
        type: "navmesh",
        label: "Navmesh",
        defaults: { ...BAKE_DEFAULTS },
        params: [
          { key: "cell", kind: "range", min: 0.08, max: 1, step: 0.02 },
          { key: "radius", kind: "range", min: 0.1, max: 2, step: 0.05 },
          { key: "height", kind: "range", min: 0.4, max: 4, step: 0.1 },
          { key: "climb", kind: "range", min: 0, max: 2, step: 0.05 },
          { key: "slope", kind: "range", min: 5, max: 70, step: 1 }
        ]
      }
    ]
  });
  for (const type of ["navnpc", "navchase", "navflee", "navmoveto", "navpatrol", "navwander"]) {
    const inputs = type === "navnpc" || type === "navpatrol" ? { path: "object", ...enabledInput } : type === "navchase" || type === "navmoveto" ? { target: "object", ...enabledInput } : type === "navflee" ? { from: "object", ...enabledInput } : { ...enabledInput };
    api.registerEffect(type, (object, base, data, _time, ctx) => rt.drive(type, object, base, data, ctx ?? {}), { inputs });
  }
  api.registerValueNode("navnoise", () => 0, { vtype: "event", inputs: { trigger: "event", at: "object" } });
  api.registerValueNode("navevent", () => 0, { vtype: "event", inputs: { npc: "object" } });
  api.registerValueNode(
    "navstate",
    (data, _t, ctx) => {
      const npc = typeof data?.npc === "string" && data.npc && data.npc !== "-None-" ? data.npc : ctx?.graphId && ctx.graphId !== "scene" ? ctx.graphId : null;
      const s = rt.stateOf(npc);
      const state = s?.state ?? "idle";
      switch (data?.read) {
        case "chasing":
          return state === "chase" || state === "attack" ? 1 : 0;
        case "alert":
          return state === "alert" ? 1 : 0;
        case "reachable":
          return s && s.why ? 0 : 1;
        default:
          return Math.max(0, STATES.indexOf(state));
      }
    },
    { vtype: "number", inputs: { npc: "object" } }
  );
  api.registerValueNode("navmesh", () => 0, { vtype: "number" });
}

// modules/navigation/src/overlay.js
var STATE_COLORS = { idle: "#9aa4b2", patrol: "#4fb3ff", alert: "#ffc94d", chase: "#ff8a3d", attack: "#ff4d4d", return: "#b38cff" };
function createOverlay(api, rt) {
  const THREE = api.THREE;
  const group = new THREE.Group();
  group.name = "navigation-debug";
  group.userData.navIgnore = true;
  let attached = false;
  const meshMat = new THREE.MeshBasicMaterial({ color: 3526783, transparent: true, opacity: 0.32, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const edgeMat = new THREE.LineBasicMaterial({ color: 1870415, transparent: true, opacity: 0.6, depthWrite: false });
  const obstacleMat = new THREE.LineBasicMaterial({ color: 16731469, depthWrite: false });
  const pathMat = new THREE.LineBasicMaterial({ color: 16769357, depthTest: false, transparent: true });
  let navMesh = null;
  let navEdges = null;
  let navVersion = -1;
  const obstacleBoxes = /* @__PURE__ */ new Map();
  const npcViews = /* @__PURE__ */ new Map();
  function attach() {
    if (attached) return;
    api.scene()?.add(group);
    attached = true;
  }
  function detach() {
    if (!attached) return;
    group.parent?.remove(group);
    attached = false;
  }
  function rebuildNavMesh() {
    navVersion = rt.bake.version;
    if (navMesh) {
      group.remove(navMesh);
      navMesh.geometry.dispose();
      navMesh = null;
    }
    if (navEdges) {
      group.remove(navEdges);
      navEdges.geometry.dispose();
      navEdges = null;
    }
    const dbg = rt.bake.debug;
    if (!dbg || !dbg.indices?.length) return;
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array(dbg.positions);
    for (let i = 1; i < pos.length; i += 3) pos[i] += 0.04;
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setIndex(new THREE.BufferAttribute(new Uint32Array(dbg.indices), 1));
    navMesh = new THREE.Mesh(g, meshMat);
    navMesh.name = "navmesh-overlay";
    navMesh.renderOrder = 2;
    navMesh.raycast = () => {
    };
    navEdges = new THREE.LineSegments(new THREE.EdgesGeometry(g, 1), edgeMat);
    navEdges.raycast = () => {
    };
    group.add(navMesh, navEdges);
  }
  function syncObstacles() {
    const want = new Map(rt.obstacles.map((o) => [o.key, o]));
    for (const [key, line] of obstacleBoxes) {
      if (want.has(key)) continue;
      group.remove(line);
      line.geometry.dispose();
      obstacleBoxes.delete(key);
    }
    for (const [key, o] of want) {
      let line = obstacleBoxes.get(key);
      const box = new THREE.Box3(new THREE.Vector3(...o.min), new THREE.Vector3(...o.max));
      if (!line) {
        line = new THREE.Box3Helper(box, 16731469);
        line.material = obstacleMat;
        line.raycast = () => {
        };
        obstacleBoxes.set(key, line);
        group.add(line);
      } else line.box.copy(box);
    }
  }
  function clearObstacles() {
    for (const line of obstacleBoxes.values()) {
      group.remove(line);
      line.geometry.dispose();
    }
    obstacleBoxes.clear();
  }
  function makeView() {
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 96;
    const ctx = canvas.getContext("2d");
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
    sprite.scale.set(2.4, 0.45, 1);
    sprite.renderOrder = 10;
    sprite.raycast = () => {
    };
    const line = new THREE.Line(new THREE.BufferGeometry(), pathMat);
    line.renderOrder = 9;
    line.frustumCulled = false;
    line.raycast = () => {
    };
    group.add(sprite, line);
    return { sprite, line, canvas, ctx, tex, text: "" };
  }
  function drawLabel(v, text, color) {
    if (v.text === text) return;
    v.text = text;
    const { ctx, canvas } = v;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.font = "600 34px system-ui, sans-serif";
    const w = Math.min(canvas.width - 8, ctx.measureText(text).width + 36);
    const x = (canvas.width - w) / 2;
    ctx.fillStyle = "rgba(14,16,20,0.82)";
    ctx.beginPath();
    ctx.roundRect?.(x, 14, w, 64, 14);
    if (!ctx.roundRect) ctx.rect(x, 14, w, 64);
    ctx.fill();
    ctx.fillStyle = color;
    ctx.fillRect(x + 12, 38, 12, 16);
    ctx.fillStyle = "#f2f4f8";
    ctx.textBaseline = "middle";
    ctx.fillText(text, x + 30, 47, w - 40);
    v.tex.needsUpdate = true;
  }
  function syncNpcs() {
    const live = /* @__PURE__ */ new Set();
    for (const [uuid, s] of rt.shown) {
      if (!s.disp) continue;
      live.add(uuid);
      let v = npcViews.get(uuid);
      if (!v) {
        v = makeView();
        npcViews.set(uuid, v);
      }
      const color = STATE_COLORS[
        /** @type {keyof typeof STATE_COLORS} */
        s.state
      ] ?? "#9aa4b2";
      drawLabel(v, s.label || s.state || "idle", color);
      v.sprite.position.set(s.disp[0], s.disp[1] + 2.1, s.disp[2]);
      const pts = [new THREE.Vector3(s.disp[0], s.disp[1] + 0.1, s.disp[2])];
      for (const c of s.corners ?? []) pts.push(new THREE.Vector3(c[0], c[1] + 0.1, c[2]));
      v.line.geometry.setFromPoints(pts);
      v.line.visible = pts.length > 1;
    }
    for (const [uuid, v] of npcViews) {
      if (live.has(uuid)) continue;
      disposeView(v);
      npcViews.delete(uuid);
    }
  }
  function disposeView(v) {
    group.remove(v.sprite, v.line);
    v.tex.dispose();
    v.sprite.material.dispose();
    v.line.geometry.dispose();
  }
  function clearNpcs() {
    for (const v of npcViews.values()) disposeView(v);
    npcViews.clear();
  }
  function update() {
    const exported = !!api.isExport?.();
    const showMesh = rt.want.overlay && !exported;
    const showNpcs = rt.want.debug && !exported && rt.active();
    if (!showMesh && !showNpcs) {
      if (attached) {
        clearNpcs();
        clearObstacles();
        detach();
      }
      return;
    }
    attach();
    if (showMesh) {
      if (navVersion !== rt.bake.version) rebuildNavMesh();
      syncObstacles();
    } else {
      if (navMesh || navEdges) {
        navVersion = -1;
        rebuildNavMeshClear();
      }
      clearObstacles();
    }
    if (showNpcs) syncNpcs();
    else clearNpcs();
  }
  function rebuildNavMeshClear() {
    for (const m of [navMesh, navEdges]) {
      if (!m) continue;
      group.remove(m);
      m.geometry.dispose();
    }
    navMesh = null;
    navEdges = null;
  }
  api.onUnload(() => {
    clearNpcs();
    clearObstacles();
    rebuildNavMeshClear();
    detach();
    meshMat.dispose();
    edgeMat.dispose();
    obstacleMat.dispose();
    pathMat.dispose();
  });
  return {
    update,
    group,
    /** what is drawn right now (a test reads it) */
    info: () => ({ attached, navTriangles: navMesh ? navMesh.geometry.index.count / 3 : 0, obstacles: obstacleBoxes.size, npcLabels: [...npcViews.values()].map((v) => v.text) })
  };
}

// modules/navigation/src/sheet.js
function specToData(spec) {
  const d = {};
  const num = (v) => v === void 0 || v === null || v === "" ? void 0 : Number(v);
  const put = (k, v) => {
    const n = num(v);
    if (n !== void 0 && Number.isFinite(n)) d[k] = n;
  };
  put("sightAngle", spec?.sight?.angle);
  put("sightRange", spec?.sight?.range);
  put("hearing", spec?.hearing);
  put("chaseRange", spec?.chase);
  put("attackRange", spec?.attack?.range);
  put("attackEvery", spec?.attack?.every);
  put("speed", spec?.speed);
  put("run", spec?.run);
  put("giveUp", spec?.giveUp);
  put("alert", spec?.alert);
  const clamped = normalizeNpc({ ...NPC_DEFAULTS, ...d });
  const out = {};
  for (const k of Object.keys(d)) out[k] = /** @type {any} */
  clamped[k];
  return out;
}
function dataToSpec(d) {
  const p = normalizeNpc(d);
  return {
    path: typeof d?.path === "string" && d.path ? d.path : "none",
    sight: { angle: p.sightAngle, range: p.sightRange },
    hearing: p.hearing,
    chase: p.chaseRange,
    attack: { range: p.attackRange, every: p.attackEvery },
    speed: p.speed,
    run: p.run,
    giveUp: p.giveUp,
    alert: p.alert
  };
}
async function applyEnemy(api, uuid, spec = {}) {
  const object = api.objectsGroup()?.getObjectByProperty("uuid", uuid);
  if (!object) return { error: "No object " + String(uuid).slice(0, 40) + "." };
  if (object.userData?.terrain) return { error: "A terrain cannot walk \u2014 pick the object that should be the enemy." };
  if (object.userData?.spline) return { error: "A Path cannot be an enemy \u2014 pick the enemy, then choose this path as its patrol." };
  const existing = api.flow.nodes("navnpc").filter((n) => n.graphId === uuid);
  const name = object.name || "Object";
  if (spec.remove) {
    if (!existing.length) return { npc: null, note: name + " is not an enemy." };
    const n = api.flow.removeNodes ? api.flow.removeNodes(existing.map((e) => e.id), uuid) : 0;
    if (!n) return { error: "This app build cannot remove nodes for a module (flow.removeNodes is missing)." };
    return { npc: null, note: name + " is an ordinary object again." };
  }
  const warnings = [];
  const patch = specToData(spec);
  if (spec.path !== void 0) {
    const p = String(spec.path ?? "");
    if (p === "none" || p === "") patch.path = "";
    else if (p === "new") {
      object.updateWorldMatrix(true, false);
      const at = new api.THREE.Vector3().setFromMatrixPosition(object.matrixWorld);
      const r = 3;
      const pts = [
        [at.x - r, at.y, at.z - r],
        [at.x + r, at.y, at.z - r],
        [at.x + r, at.y, at.z + r],
        [at.x - r, at.y, at.z + r]
      ];
      const made = api.paths?.create ? await api.paths.create({ points: pts, closed: true, name: name + " patrol" }) : null;
      if (made) patch.path = made;
      else warnings.push("Could not draw a new patrol path; the enemy guards its spot.");
    } else if (api.paths?.of(p)) patch.path = p;
    else warnings.push("No Path object " + p.slice(0, 40) + "; the enemy keeps its patrol.");
  }
  let nodeId;
  if (existing.length) {
    nodeId = existing[0].id;
    if (Object.keys(patch).length) api.flow.setNodeData(nodeId, patch);
  } else {
    const at = api.flow.freeRegion({ w: 220, h: 360, graphId: uuid });
    const ids = api.flow.addNodes({ graphId: uuid, nodes: [{ type: "navnpc", x: at.x, y: at.y, data: { ...NPC_DEFAULTS, path: "", ...patch } }] });
    nodeId = ids[0];
    if (!nodeId) return { error: "The node editor is not ready yet \u2014 try again in a moment." };
  }
  const data = { ...NPC_DEFAULTS, path: "", ...existing[0]?.data ?? {}, ...patch };
  const pathName = data.path ? api.paths?.list().find((p) => p.uuid === data.path)?.name ?? "a path" : "";
  return {
    npc: { uuid, node: nodeId, ...dataToSpec(data) },
    note: name + (existing.length ? " updated" : " is an enemy now") + (pathName ? ": it patrols " + pathName : ": it guards its spot") + ", sees " + data.sightRange + " m in a " + data.sightAngle + "\xB0 cone, hears " + data.hearing + " m, attacks within " + data.attackRange + " m. Wire an On NPC Event (attack) to damage or a sound.",
    ...warnings.length ? { warnings } : {}
  };
}
var FIELDS = [
  { key: "sightAngle", label: "Sight angle", unit: "\xB0", min: 10, max: 360, step: 5 },
  { key: "sightRange", label: "Sight range", unit: "m", min: 1, max: 60, step: 0.5 },
  { key: "hearing", label: "Hearing", unit: "m", min: 0, max: 40, step: 0.5 },
  { key: "chaseRange", label: "Chase range", unit: "m", min: 2, max: 120, step: 1 },
  { key: "attackRange", label: "Attack range", unit: "m", min: 0.3, max: 10, step: 0.1 },
  { key: "attackEvery", label: "Attack every", unit: "s", min: 0.2, max: 10, step: 0.1 },
  { key: "speed", label: "Walk speed", unit: "m/s", min: 0.2, max: 8, step: 0.1 },
  { key: "run", label: "Chase speed", unit: "m/s", min: 0.2, max: 12, step: 0.1 },
  { key: "giveUp", label: "Give up after", unit: "s", min: 0.5, max: 30, step: 0.5 }
];
function registerSheet(api, rt) {
  let target = "";
  let rerender = null;
  const id = api.registerToolbox({
    id: "enemy",
    title: "Make this an enemy",
    width: 300,
    sidebar: false,
    playMode: true,
    onOpen: () => rerender?.(),
    mount(el) {
      const render = () => {
        el.replaceChildren();
        const object = target ? api.objectsGroup()?.getObjectByProperty("uuid", target) : null;
        const head = document.createElement("div");
        head.className = "tbx-label";
        head.id = "nav-sheet-target";
        head.textContent = object ? "Enemy: " + (object.name || "Object") : "Right-click an object \u25B8 Physics & effects \u25B8 Make this an enemy";
        el.append(head);
        if (object) renderForm(el, object);
        renderView(el);
      };
      rerender = render;
      render();
      const off = rt.subscribe(() => statusLine && (statusLine.textContent = statusText()));
      return () => {
        off();
        rerender = null;
      };
    }
  });
  let statusLine = null;
  const statusText = () => {
    const b = rt.bake;
    const base = b.status === "ready" ? "Navmesh: " + Math.round(b.area) + " m\xB2 walkable, baked in " + b.ms + " ms" + (b.truncated ? " (scene cut at the device cap)" : "") : b.status === "baking" ? "Navmesh: baking\u2026" : b.status === "failed" ? "Navmesh: failed \u2014 " + b.error : b.status === "empty" ? "Navmesh: nothing to walk on" : "Navmesh: bakes when you play";
    return base + " \xB7 " + rt.caps.kind + " cap " + rt.caps.npcs + " enemies";
  };
  function renderForm(el, object) {
    const node = api.flow.nodes("navnpc").find((n) => n.graphId === object.uuid);
    const data = { ...NPC_DEFAULTS, path: "", ...node?.data ?? {} };
    const values = {};
    const pathRow = document.createElement("label");
    pathRow.className = "tbx-row";
    const pathLabel = document.createElement("span");
    pathLabel.textContent = "Patrol";
    const select = document.createElement("select");
    select.id = "nav-sheet-path";
    select.style.cssText = "flex:1 1 auto;min-width:0;padding:4px 6px;font-size:12px;border-radius:6px;border:1px solid var(--border);background:var(--surface-inset);color:var(--text-2);color-scheme:dark light";
    const opts = [
      ["none", "None (guard this spot)"],
      ["new", "New loop around it"],
      ...api.paths.list().map((p) => [p.uuid, p.name])
    ];
    for (const [value, text] of opts) {
      const o = document.createElement("option");
      o.value = value;
      o.textContent = text;
      select.append(o);
    }
    select.value = data.path && opts.some((o) => o[0] === data.path) ? data.path : node ? "none" : "none";
    pathRow.append(pathLabel, select);
    el.append(pathRow);
    for (const f of FIELDS) {
      const row = document.createElement("label");
      row.className = "tbx-row";
      const name = document.createElement("span");
      name.textContent = f.label;
      const input = document.createElement("input");
      input.type = "range";
      input.min = String(f.min);
      input.max = String(f.max);
      input.step = String(f.step);
      input.value = String(data[f.key]);
      input.id = "nav-sheet-" + f.key;
      const out = document.createElement("span");
      out.className = "tbx-value";
      const show = () => out.textContent = input.value + " " + f.unit;
      show();
      input.oninput = () => {
        values[f.key] = Number(input.value);
        show();
      };
      row.append(name, input, out);
      el.append(row);
    }
    const go = document.createElement("button");
    go.className = "tbx-primary";
    go.id = "nav-sheet-apply";
    go.textContent = node ? "Update enemy" : "Make enemy";
    go.style.minHeight = "40px";
    go.onclick = async () => {
      go.disabled = true;
      const spec = {
        path: select.value,
        sight: { angle: values.sightAngle, range: values.sightRange },
        hearing: values.hearing,
        chase: values.chaseRange,
        attack: { range: values.attackRange, every: values.attackEvery },
        speed: values.speed,
        run: values.run,
        giveUp: values.giveUp
      };
      const r = await applyEnemy(api, object.uuid, spec);
      go.disabled = false;
      if ("error" in r) api.toast(r.error);
      else {
        api.toast(r.note);
        for (const w of r.warnings ?? []) api.toast(w);
        rerender?.();
      }
    };
    el.append(go);
    if (node) {
      const rm = document.createElement("button");
      rm.className = "tbx-danger";
      rm.id = "nav-sheet-remove";
      rm.textContent = "Not an enemy";
      rm.style.minHeight = "40px";
      rm.onclick = async () => {
        const r = await applyEnemy(api, object.uuid, { remove: true });
        api.toast("error" in r ? r.error : r.note);
        rerender?.();
      };
      el.append(rm);
    }
  }
  function renderView(el) {
    const label = document.createElement("div");
    label.className = "tbx-label";
    label.textContent = "View (this device)";
    el.append(label);
    for (
      const [key, text, idAttr] of
      /** @type {const} */
      [
        ["overlay", "Navmesh overlay", "nav-sheet-overlay"],
        ["debug", "NPC debug view (Play)", "nav-sheet-debug"]
      ]
    ) {
      const row = document.createElement("label");
      row.className = "tbx-row";
      row.style.cursor = "pointer";
      row.style.fontSize = "12px";
      const box = document.createElement("input");
      box.type = "checkbox";
      box.className = "tbx-check";
      box.id = idAttr;
      box.checked = !!rt.want[key];
      box.onchange = () => setWant(key, box.checked);
      row.append(box, document.createTextNode(text));
      el.append(row);
    }
    statusLine = document.createElement("div");
    statusLine.className = "tbx-row";
    statusLine.style.cssText = "font-size:11px;color:var(--text-muted);line-height:1.35";
    statusLine.id = "nav-sheet-status";
    statusLine.textContent = statusText();
    el.append(statusLine);
  }
  function setWant(key, on) {
    rt.want[key] = on;
    try {
      api.storage?.set?.("view:" + key, on);
    } catch {
    }
    rerender?.();
  }
  for (
    const key of
    /** @type {const} */
    ["overlay", "debug"]
  ) {
    try {
      rt.want[key] = !!api.storage?.get?.("view:" + key, false);
    } catch {
    }
  }
  api.registerViewToggle?.({ id: "overlay", label: "Navmesh overlay", tooltip: "Show where enemies can walk (green) and moving obstacles (red). This device only.", get: () => rt.want.overlay, set: (on) => setWant("overlay", on) });
  api.registerViewToggle?.({ id: "debug", label: "NPC debug view", tooltip: "In Play: each enemy\u2019s path and state. This device only; never in exported games.", get: () => rt.want.debug, set: (on) => setWant("debug", on) });
  api.registerObjectAction?.({
    id: "enemy",
    label: "Make this an enemy\u2026",
    icon: "swords",
    tooltip: "Patrol a Path, see and hear the player, chase, attack, give up and return.",
    when: (uuid) => {
      const o = api.objectsGroup()?.getObjectByProperty("uuid", uuid);
      return !!o && !o.userData?.terrain && !o.userData?.spline;
    },
    open: (uuid) => {
      target = uuid;
      rerender?.();
      api.openToolbox(id);
    },
    apply: (uuid, spec) => applyEnemy(api, uuid, spec)
  });
  api.registerMenu?.("Navigation view", () => {
    target = "";
    rerender?.();
    api.openToolbox(id);
  });
  return { id, open: (uuid) => (target = uuid, rerender?.(), api.openToolbox(id)) };
}

// modules/navigation/src/index.js
var index_default = {
  id: "navigation",
  name: "Navigation",
  version: "1.0.0",
  description: "Enemies that walk: a navmesh baked from your scene, Move To / Chase / Patrol / Flee / Wander nodes, and guards that see, hear, chase, attack and give up. Right-click an object \u25B8 Make this an enemy.",
  /** @param {any} api the module SDK surface */
  register(api) {
    if (!api.colliderGeometry || !api.paths?.of || !api.registerObjectAction || !api.flow?.addNodes || !api.registerValueNode) {
      api.toast("Navigation needs a newer app build (the game-world SDK seams are missing).");
      return;
    }
    const rt = createRuntime(api);
    registerNodes(api, rt);
    const overlay = createOverlay(api, rt);
    const sheet = registerSheet(api, rt);
    api.registerFrameTask(() => {
      rt.tick();
      overlay.update();
    });
    rt.scanGraph();
    api.hud?.registerDebugLine?.(() => {
      if (!rt.shown.size && rt.bake.status === "idle") return null;
      const by = rt.authorityId();
      return "navigation: " + rt.bake.status + (rt.bake.status === "ready" ? " " + rt.bake.ms + " ms" : "") + " \xB7 " + rt.shown.size + " enemies \xB7 steps on " + (by === null ? "nobody" : by === String(api.peerId?.() ?? "") ? "this peer" : by);
    });
    if (typeof window !== "undefined") window.__navigation = { api, rt, overlay, sheet, debug: () => ({ ...rt.debug(), overlay: overlay.info() }) };
  }
};
export {
  index_default as default
};
