// modules/health/src/ledger.js
var DEFAULTS = Object.freeze({
  name: "hp",
  scope: "object",
  max: 5,
  regen: 0,
  deathAction: "hide",
  respawnDelay: 3
});
var SCOPES = ["object", "player"];
var DEATH_ACTIONS = ["hide", "respawn", "nothing"];
var DAMAGE_SOURCES = ["wired", "click", "touch", "zone", "hit"];
var SCALES = ["none", "speed"];
var MAX_PULSES = 20;
var HALF_DAY = 43200;
var DAY = 86400;
function clamp(n, lo, hi, fallback = lo) {
  const v = Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.min(hi, Math.max(lo, v));
}
function elapsed(later, earlier) {
  let d = later - earlier;
  if (d < -HALF_DAY) d += DAY;
  return d;
}
function objectHp({ max, hits, heals }) {
  const cap = clamp(max, 1, 1e6, DEFAULTS.max);
  const taken = Math.max(0, (Number(hits) || 0) - (Number(heals) || 0));
  const hp = clamp(cap - taken, 0, cap, cap);
  return { hp, dead: hp <= 0 };
}
function playerHp({ max, regen, base, at, now }) {
  const cap = clamp(max, 1, 1e6, DEFAULTS.max);
  if (base === null || base === void 0 || !Number.isFinite(Number(base))) return { hp: cap, dead: false };
  const held = clamp(base, 0, cap, cap);
  if (held <= 0) return { hp: 0, dead: true };
  const rate = clamp(regen, 0, 1e6, 0);
  const since = typeof at === "number" ? Math.max(0, elapsed(now, at)) : 0;
  const hp = Math.min(cap, held + rate * since);
  return { hp, dead: false };
}
function applyDelta(row, delta) {
  const cap = clamp(row.max, 1, 1e6, DEFAULTS.max);
  const { hp } = playerHp(row);
  return { base: clamp(hp + (Number(delta) || 0), 0, cap, cap), at: row.now };
}
function pulsesFor({ amount, scale, speed, speedRef }) {
  const base = clamp(amount, 0, MAX_PULSES, 1);
  if (base <= 0) return 0;
  if (scale !== "speed") return Math.round(base);
  const ref = clamp(speedRef, 0.1, 1e3, 3);
  const factor = clamp(Number(speed) / ref, 0, 3, 1);
  return Math.max(1, Math.min(MAX_PULSES, Math.round(base * factor)));
}
function fraction(hp, max) {
  const cap = clamp(max, 1, 1e6, DEFAULTS.max);
  return clamp(hp / cap, 0, 1, 0);
}
function respawnDue(deadAt, delay, now) {
  if (typeof deadAt !== "number") return false;
  return elapsed(now, deadAt) >= clamp(delay, 0, 3600, DEFAULTS.respawnDelay);
}

// modules/health/src/graph.js
var SCENE = "scene";
function indexGraph(nodes, edges) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const bySource = /* @__PURE__ */ new Map();
  const byTarget = /* @__PURE__ */ new Map();
  for (const edge of edges) {
    if (!bySource.has(edge.source)) bySource.set(edge.source, []);
    bySource.get(edge.source)?.push(edge);
    if (!byTarget.has(edge.target)) byTarget.set(edge.target, []);
    byTarget.get(edge.target)?.push(edge);
  }
  return { byId, bySource, byTarget, nodes, edges };
}
function targetsOf(node, g) {
  const out = [];
  let wired = false;
  for (const edge of g.byTarget.get(node.id) ?? []) {
    if ((edge.targetHandle ?? null) !== "target") continue;
    const src = g.byId.get(edge.source);
    if (src?.type !== "objectselector") continue;
    wired = true;
    const selected = String(src.data?.selected ?? "");
    if (selected && selected !== "-None-") out.push(selected);
  }
  if (!wired && node.graphId && node.graphId !== SCENE) out.push(node.graphId);
  return out;
}
function sourcesInto(nodeId, handle, g) {
  return (g.byTarget.get(nodeId) ?? []).filter((e) => (e.targetHandle ?? null) === handle).map((e) => e.source);
}
function chainsOf(node, g) {
  const out = [];
  const seen = /* @__PURE__ */ new Set();
  const add = (health, via, counter) => {
    const key = health.id + ":" + via + ":" + (counter?.id ?? "");
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ health, via: via === "heal" ? "heal" : "damage", counter });
  };
  for (const edge of g.bySource.get(node.id) ?? []) {
    const target = g.byId.get(edge.target);
    if (!target) continue;
    const handle = edge.targetHandle ?? null;
    if (target.type === "health" && (handle === "damage" || handle === "heal")) add(target, handle, null);
    if (target.type === "counter" && (handle === "pulse" || handle === null)) {
      for (const next of g.bySource.get(target.id) ?? []) {
        const health = g.byId.get(next.target);
        const h2 = next.targetHandle ?? null;
        if (health?.type === "health" && (h2 === "damage" || h2 === "heal")) add(health, h2, target);
      }
    }
  }
  return out;
}
function feedersOf(health, g) {
  const pick = (handle) => sourcesInto(health.id, handle, g).map((id) => g.byId.get(id)).filter(Boolean);
  return { damage: pick("damage"), heal: pick("heal") };
}
function triggerSourcesOf(node, g) {
  return sourcesInto(node.id, "trigger", g);
}
function zoneOf(node, g) {
  for (const edge of g.byTarget.get(node.id) ?? []) {
    if ((edge.targetHandle ?? null) !== "zone") continue;
    const src = g.byId.get(edge.source);
    if (src?.type !== "objectselector") continue;
    const selected = String(src.data?.selected ?? "");
    if (selected && selected !== "-None-") return selected;
  }
  return null;
}
var nameOf = (node) => String(node?.data?.name ?? "").trim() || "hp";
function recipe(spec, layout = {}) {
  const COL = layout.col ?? 220;
  const ROW = layout.rowHeight ?? 200;
  const x0 = layout.x ?? 60;
  const y = (layout.y ?? 40) + spec.row * ROW;
  const name = String(spec.health.name ?? "").trim() || "hp";
  const health = { ...spec.health, name, scope: spec.uuid ? "object" : "player" };
  const nodes = [
    { type: "damage", x: x0, y, data: { ...spec.damage } },
    { type: "counter", x: x0 + COL, y, data: { op: "up", step: 1 } },
    { type: "health", x: x0 + 2 * COL, y, data: health },
    { type: "healthreset", x: x0, y: y + 100, data: { name } }
  ];
  const edges = [
    { from: 0, to: 1, handle: "pulse" },
    { from: 1, to: 2, handle: "damage" },
    { from: 3, to: 1, handle: "reset" }
  ];
  if (spec.uuid) {
    nodes.push({ type: "objectselector", x: x0 + 3 * COL, y, data: { selected: spec.uuid } });
    edges.push({ from: 4, to: 2, handle: "target" });
  }
  return { nodes, edges };
}

// modules/health/src/engine.js
var SWEEP = 0.1;
var AT_SUFFIX = ".at";
var KILLS_ROW = "kills";
function createEngine(api) {
  const state = /* @__PURE__ */ new Map();
  const acted = /* @__PURE__ */ new Map();
  const wasDead = /* @__PURE__ */ new Map();
  const lastHp = /* @__PURE__ */ new Map();
  const respawned = /* @__PURE__ */ new Map();
  const inside = /* @__PURE__ */ new Map();
  const zoneTick = /* @__PURE__ */ new Map();
  const knocked = /* @__PURE__ */ new Map();
  const hidden = /* @__PURE__ */ new Set();
  let roundSeen = (
    /** @type {any} */
    void 0
  );
  const listeners = /* @__PURE__ */ new Set();
  const now = () => api.now();
  function graphView() {
    const nodes = api.flow.nodes();
    const edges2 = api.flow.edges();
    return indexGraph(nodes, edges2);
  }
  function numberValue(node) {
    const v = api.flow.nodeValue(node.id);
    return Number.isFinite(Number(v)) ? Number(v) : 0;
  }
  function myRow(name) {
    const base = api.peerVars.mine(name, null);
    const at = api.peerVars.mine(name + AT_SUFFIX, null);
    return {
      base: typeof base === "number" ? base : null,
      at: typeof at === "number" ? at : null
    };
  }
  function writeRow(name, base, at) {
    api.peerVars.setMine(name, base);
    api.peerVars.setMine(name + AT_SUFFIX, at);
  }
  function objectOf(uuid) {
    if (!uuid) return null;
    return api.objectsGroup()?.getObjectByProperty("uuid", uuid) ?? null;
  }
  function derive(node, g) {
    const d = node.data ?? {};
    const name = nameOf(node);
    const scope = d.scope === "player" ? "player" : "object";
    const max = clamp(d.max, 1, 1e6, DEFAULTS.max);
    const regen = clamp(d.regen, 0, 1e6, 0);
    const t = now();
    let hp = max;
    let dead = false;
    let deadAt = null;
    let uuid = null;
    if (scope === "player") {
      const row = myRow(name);
      ({ hp, dead } = playerHp({ max, regen, base: row.base, at: row.at, now: t }));
      deadAt = dead ? row.at : null;
    } else {
      const feeders = feedersOf(node, g);
      let hits = 0;
      let heals = 0;
      let latest = null;
      for (const f of feeders.damage) {
        hits += numberValue(f);
        const stamp = api.flow.triggerStamp(f.id);
        if (stamp && (latest === null || stamp.stamp > latest)) latest = stamp.stamp;
      }
      for (const f of feeders.heal) heals += numberValue(f);
      ({ hp, dead } = objectHp({ max, hits, heals }));
      deadAt = dead ? latest : null;
      uuid = targetsOf(node, g)[0] ?? null;
    }
    const object = objectOf(uuid);
    return {
      id: node.id,
      name,
      scope,
      max,
      regen,
      deathAction: String(d.deathAction ?? DEFAULTS.deathAction),
      respawnDelay: clamp(d.respawnDelay, 0, 3600, DEFAULTS.respawnDelay),
      hp,
      dead,
      uuid,
      deadAt,
      label: scope === "player" ? "player" : object?.name || (uuid ? uuid.slice(0, 8) + "\u2026" : "(no target)")
    };
  }
  function pulse(node, n, how, g) {
    if (n <= 0) return 0;
    const chains = chainsOf(node, g);
    if (!chains.length) return 0;
    const live = chains.filter((c) => {
      const s = state.get(c.health.id);
      return !s || !s.dead || how.sign > 0;
    });
    if (!live.length) return 0;
    const t = now();
    for (let i = 0; i < n; i++)
      api.fireNodeTrigger(node.type, (_d, id) => id === node.id, how.local ? { replicate: false } : void 0);
    if (how.credit && how.sign < 0)
      for (const chain of live) {
        const s = state.get(chain.health.id);
        if (!s || s.scope === "player" || s.dead) continue;
        if (s.hp - n <= 0) api.peerVars.setMine(KILLS_ROW, api.peerVars.mine(KILLS_ROW, 0) + 1);
      }
    for (const chain of live) {
      const s = state.get(chain.health.id);
      if (!s || s.scope !== "player") continue;
      const row = myRow(s.name);
      const next = applyDelta({ max: s.max, regen: s.regen, base: row.base, at: row.at, now: t }, how.sign * n);
      writeRow(s.name, next.base, next.at);
    }
    return n;
  }
  function wiredSweep(g) {
    for (const node of g.nodes) {
      if (node.type !== "damage" && node.type !== "heal") continue;
      const sources = triggerSourcesOf(node, g);
      let newest = null;
      for (const id of sources) {
        const stamp = api.flow.triggerStamp(id);
        if (stamp && (newest === null || stamp.stamp > newest)) newest = stamp.stamp;
      }
      if (!acted.has(node.id)) {
        acted.set(node.id, newest);
        continue;
      }
      if (newest === null || acted.get(node.id) === newest) continue;
      acted.set(node.id, newest);
      if (node.type === "damage" && (node.data?.source ?? "wired") !== "wired") continue;
      const n = pulsesFor({ amount: node.data?.amount ?? 1 });
      pulse(node, n, { local: true, sign: node.type === "heal" ? 1 : -1 }, g);
    }
    for (const id of [...acted.keys()]) if (!g.byId.has(id)) acted.delete(id);
  }
  function hitObjects(uuids, source, how) {
    if (!uuids.length) return 0;
    const wanted = new Set(uuids);
    const g = how.g ?? graphView();
    let fired = 0;
    for (const node of g.nodes) {
      if (node.type !== "damage" || (node.data?.source ?? "wired") !== source) continue;
      const chains = chainsOf(node, g).filter((c) => targetsOf(c.health, g).some((u) => wanted.has(u)));
      if (!chains.length) continue;
      const n = pulsesFor({
        amount: node.data?.amount ?? 1,
        scale: node.data?.scale,
        speed: how.speed,
        speedRef: node.data?.speedRef
      });
      if (pulse(node, n, { local: how.local, sign: -1, credit: how.credit ?? !how.local }, g)) fired++;
    }
    return fired;
  }
  if (typeof api.onHit === "function")
    api.onHit((hit) => {
      if (!hit?.uuid) return;
      if (knocked.get(hit.uuid) === hit.at) return;
      knocked.set(hit.uuid, hit.at);
      hitObjects([hit.uuid], "hit", { speed: Number(hit.speed) || 0, local: true, credit: !!hit.local });
    });
  function proximitySweep(g) {
    if (!api.isPlaying()) {
      inside.clear();
      return;
    }
    const position = api.playerPosition();
    if (!position) return;
    const here = new api.THREE.Vector3(position[0], position[1], position[2]);
    const tick = performance.now() / 1e3;
    for (const node of g.nodes) {
      if (node.type !== "damage") continue;
      const source = node.data?.source ?? "wired";
      if (source !== "touch" && source !== "zone") continue;
      const radius = clamp(node.data?.radius, 0.1, 100, 1.5);
      const chains = chainsOf(node, g);
      const targets = [];
      for (const chain of chains) {
        if (chain.health.data?.scope === "player") {
          const zone = zoneOf(node, g);
          if (zone) targets.push({ uuid: zone, local: true });
        } else for (const uuid of targetsOf(chain.health, g)) targets.push({ uuid, local: false });
      }
      const was = inside.get(node.id) ?? /* @__PURE__ */ new Set();
      const nowIn = /* @__PURE__ */ new Set();
      for (const t of targets) {
        const object = objectOf(t.uuid);
        if (!object) continue;
        if (object.getWorldPosition(new api.THREE.Vector3()).distanceTo(here) > radius) continue;
        nowIn.add(t.uuid);
        if (source === "touch" && !was.has(t.uuid)) fireAt(node, t, g);
      }
      if (source === "zone" && nowIn.size) {
        const every = 1 / clamp(node.data?.perSecond, 0.1, 100, 1);
        const last = zoneTick.get(node.id) ?? -Infinity;
        if (tick - last >= every) {
          zoneTick.set(node.id, tick);
          for (const t of targets) if (nowIn.has(t.uuid)) fireAt(node, t, g);
        }
      } else if (source === "zone") zoneTick.delete(node.id);
      inside.set(node.id, nowIn);
    }
    for (const id of [...inside.keys()]) if (!g.byId.has(id)) inside.delete(id);
  }
  function fireAt(node, t, g) {
    const n = pulsesFor({ amount: node.data?.amount ?? 1 });
    pulse(node, n, { local: t.local, sign: -1, credit: !t.local }, g);
  }
  function emit(name, kind) {
    api.fireNodeTrigger(
      "healthevent",
      (d) => nameOf({ data: d }) === name && String(d?.event ?? "death") === kind,
      { replicate: false }
    );
  }
  function reset(name) {
    api.fireNodeTrigger("healthreset", (d) => nameOf({ data: d }) === name, { replicate: false });
  }
  function edges(s, firstSight) {
    const before = wasDead.get(s.id);
    wasDead.set(s.id, s.dead);
    const prevHp = lastHp.get(s.id);
    lastHp.set(s.id, s.hp);
    if (firstSight) return;
    if (s.dead && before === false) emit(s.name, "death");
    if (typeof prevHp === "number" && s.hp < prevHp - 1e-9) emit(s.name, "damage");
    if (!s.dead && before === true) emit(s.name, "respawn");
  }
  function respawnSweep(s) {
    if (s.deathAction !== "respawn") return;
    if (!s.dead) {
      respawned.delete(s.id);
      return;
    }
    if (!respawnDue(s.deadAt, s.respawnDelay, now())) return;
    if (respawned.get(s.id) === s.deadAt) return;
    respawned.set(s.id, s.deadAt);
    if (s.scope === "player") {
      writeRow(s.name, s.max, now());
      const at = respawnPoint(s);
      if (at) api.flyTo(at);
    } else reset(s.name);
  }
  function respawnPoint(s) {
    const g = graphView();
    const node = g.byId.get(s.id);
    if (!node) return null;
    for (const edge of g.byTarget.get(s.id) ?? []) {
      if ((edge.targetHandle ?? null) !== "respawnAt") continue;
      const src = g.byId.get(edge.source);
      const uuid = src?.type === "objectselector" ? String(src.data?.selected ?? "") : "";
      const object = objectOf(uuid && uuid !== "-None-" ? uuid : null);
      if (object) return object.getWorldPosition(new api.THREE.Vector3()).toArray();
    }
    return null;
  }
  function roundSweep() {
    const cutoff = api.game.roundCutoff();
    if (cutoff === null) {
      roundSeen = null;
      return;
    }
    if (roundSeen === void 0 || roundSeen === null) {
      roundSeen = cutoff;
      return;
    }
    if (cutoff === roundSeen) return;
    roundSeen = cutoff;
    if (typeof cutoff !== "number" || !Number.isFinite(cutoff)) return;
    const names2 = /* @__PURE__ */ new Set();
    for (const s of state.values()) {
      names2.add(s.name);
      if (s.scope === "player") writeRow(s.name, s.max, now());
    }
    for (const name of names2) {
      reset(name);
      emit(name, "reset");
    }
  }
  function visibilitySweep() {
    const playing = api.isPlaying();
    const shouldHide = /* @__PURE__ */ new Set();
    for (const s of state.values())
      if (s.scope === "object" && s.uuid && s.dead && playing && s.deathAction !== "nothing") shouldHide.add(s.uuid);
    for (const uuid of shouldHide) {
      const object = objectOf(uuid);
      if (!object) continue;
      if (!hidden.has(uuid)) hidden.add(uuid);
      object.visible = false;
    }
    for (const uuid of [...hidden]) {
      if (shouldHide.has(uuid)) continue;
      hidden.delete(uuid);
      const object = objectOf(uuid);
      if (object) object.visible = true;
    }
  }
  function sweep() {
    const g = graphView();
    const live = /* @__PURE__ */ new Set();
    for (const node of g.nodes) {
      if (node.type !== "health") continue;
      live.add(node.id);
      const firstSight = !state.has(node.id);
      const s = derive(node, g);
      state.set(node.id, s);
      edges(s, firstSight);
      respawnSweep(s);
    }
    visibilitySweep();
    for (const id of [...state.keys()])
      if (!live.has(id)) {
        state.delete(id);
        wasDead.delete(id);
        lastHp.delete(id);
        respawned.delete(id);
      }
    roundSweep();
    wiredSweep(g);
    proximitySweep(g);
    for (const fn of listeners) fn();
  }
  let lastSweep = -1;
  api.registerFrameTask(() => {
    const t = performance.now() / 1e3;
    if (t - lastSweep < SWEEP) return;
    lastSweep = t;
    try {
      sweep();
    } catch (error) {
      console.warn("[health] sweep failed", error);
    }
  });
  function all() {
    return [...state.values()].sort((a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id));
  }
  function read(name) {
    let hp = 0;
    let max = 0;
    let alive = 0;
    let total = 0;
    for (const s of state.values()) {
      if (s.name !== name) continue;
      total++;
      hp += s.hp;
      max += s.max;
      if (!s.dead) alive++;
    }
    return { hp, max, alive, total, fraction: total ? fraction(hp, max) : 1 };
  }
  function names() {
    return [...new Set([...state.values()].map((s) => s.name))].sort();
  }
  function onChange(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }
  function clear() {
    state.clear();
    acted.clear();
    wasDead.clear();
    lastHp.clear();
    respawned.clear();
    hidden.clear();
    inside.clear();
    zoneTick.clear();
    knocked.clear();
    roundSeen = void 0;
  }
  return {
    state,
    stateOf: (id) => state.get(id) ?? null,
    all,
    read,
    names,
    graphView,
    hitObjects,
    pulse,
    reset,
    emit,
    sweep,
    onChange,
    clear,
    myRow
  };
}

// modules/health/src/nodes.js
var READS = ["fraction", "current", "max", "alive"];
var EVENTS = ["death", "damage", "respawn", "reset"];
function registerNodes(api, engine) {
  api.registerNodeGroup({
    group: "Health",
    items: [
      {
        type: "health",
        label: "Health",
        defaults: { ...DEFAULTS, target: "", damage: 0, heal: 0, respawnAt: "" },
        params: [
          { key: "name", kind: "text", placeholder: DEFAULTS.name, maxLength: 40 },
          { key: "scope", kind: "select", options: SCOPES },
          { key: "max", kind: "range", min: 1, max: 100, step: 1 },
          { key: "regen", kind: "range", min: 0, max: 10, step: 0.5 },
          { key: "deathAction", kind: "select", options: DEATH_ACTIONS },
          { key: "respawnDelay", kind: "range", min: 0, max: 30, step: 1 }
        ]
      },
      {
        type: "damage",
        label: "Damage",
        defaults: { amount: 1, source: "wired", radius: 1.5, perSecond: 1, scale: "none", speedRef: 3, trigger: 0, zone: "" },
        params: [
          { key: "amount", kind: "range", min: 1, max: MAX_PULSES, step: 1 },
          { key: "source", kind: "select", options: DAMAGE_SOURCES },
          { key: "radius", kind: "range", min: 0.5, max: 10, step: 0.5 },
          { key: "perSecond", kind: "range", min: 0.5, max: 10, step: 0.5 },
          { key: "scale", kind: "select", options: SCALES },
          { key: "speedRef", kind: "range", min: 0.5, max: 10, step: 0.5 }
        ]
      },
      {
        type: "heal",
        label: "Heal",
        defaults: { amount: 1, trigger: 0 },
        params: [{ key: "amount", kind: "range", min: 1, max: MAX_PULSES, step: 1 }]
      },
      {
        type: "healthreset",
        label: "Health Reset",
        defaults: { name: DEFAULTS.name },
        params: [{ key: "name", kind: "text", placeholder: DEFAULTS.name, maxLength: 40 }]
      },
      {
        type: "healthvalue",
        label: "Health Value",
        defaults: { name: DEFAULTS.name, read: "fraction" },
        params: [
          { key: "name", kind: "text", placeholder: DEFAULTS.name, maxLength: 40 },
          { key: "read", kind: "select", options: READS }
        ]
      },
      {
        type: "healthevent",
        label: "Health Event",
        defaults: { name: DEFAULTS.name, event: "death" },
        params: [
          { key: "name", kind: "text", placeholder: DEFAULTS.name, maxLength: 40 },
          { key: "event", kind: "select", options: EVENTS }
        ]
      }
    ]
  });
  api.registerValueNode(
    "health",
    (_data, _time, ctx) => engine.stateOf(ctx?.id)?.hp ?? 0,
    { vtype: "number", inputs: { target: "object", damage: "number", heal: "number", respawnAt: "object" } }
  );
  api.registerValueNode("damage", () => 0, { vtype: "event", inputs: { trigger: "event", zone: "object" } });
  api.registerValueNode("heal", () => 0, { vtype: "event", inputs: { trigger: "event" } });
  api.registerValueNode("healthreset", () => 0, { vtype: "event" });
  api.registerValueNode("healthevent", () => 0, { vtype: "event" });
  api.registerValueNode(
    "healthvalue",
    (data) => {
      const r = engine.read(String(data?.name ?? "").trim() || DEFAULTS.name);
      switch (String(data?.read ?? "fraction")) {
        case "current":
          return r.hp;
        case "max":
          return r.max;
        case "alive":
          return r.alive;
        default:
          return r.fraction;
      }
    },
    { vtype: "number" }
  );
}

// modules/health/src/toolbox.js
var SELECT_CSS = "background:rgba(0,0,0,0.25);color:inherit;border:1px solid rgba(255,255,255,0.15);border-radius:4px;font-size:11px;padding:1px 3px;";
var INPUT_CSS = SELECT_CSS + "width:100%;";
function elem(tag, props, css) {
  const node = document.createElement(tag);
  Object.assign(node, props ?? {});
  if (css) node.setAttribute("style", css);
  return node;
}
function select(options, value) {
  const node = (
    /** @type {HTMLSelectElement} */
    elem("select", {}, SELECT_CSS)
  );
  for (const option of options) node.appendChild(elem("option", { value: option, textContent: option }));
  node.value = value;
  return node;
}
function registerToolbox(api, engine) {
  function makeDamageable(options) {
    const uuids = api.selectedUuids();
    if (!uuids.length) {
      api.toast("Select an object first, then make it damageable");
      return { built: 0, skipped: 0 };
    }
    const g = engine.graphView();
    const taken = /* @__PURE__ */ new Set();
    let row = 0;
    for (const node of g.nodes) {
      if (node.type !== "health") continue;
      row++;
      for (const uuid of targetsOf(node, g)) taken.add(uuid);
    }
    let built = 0;
    let skipped = 0;
    for (const uuid of uuids) {
      if (taken.has(uuid)) {
        skipped++;
        continue;
      }
      api.flow.addNodes(recipe({ uuid, row, health: options.health, damage: options.damage }));
      taken.add(uuid);
      row++;
      built++;
    }
    api.toast(
      built ? built + " object" + (built === 1 ? "" : "s") + ' now damageable as "' + options.health.name + '"' + (skipped ? " (" + skipped + " already had health)" : "") : "Already damageable \u2014 nothing to add"
    );
    return { built, skipped };
  }
  function makePlayerHealth(options) {
    const g = engine.graphView();
    const name = String(options.health.name ?? "").trim() || DEFAULTS.name;
    let row = 0;
    for (const node of g.nodes) {
      if (node.type !== "health") continue;
      row++;
      if (node.data?.scope === "player" && (String(node.data?.name ?? "").trim() || DEFAULTS.name) === name) {
        api.toast('Player health "' + name + '" already exists');
        return { built: 0, skipped: 1 };
      }
    }
    api.flow.addNodes(recipe({ uuid: null, row, health: options.health, damage: options.damage }));
    api.toast('Player health "' + name + '" added');
    return { built: 1, skipped: 0 };
  }
  function mount(el) {
    el.textContent = "";
    el.classList.add("health-manager");
    el.appendChild(
      elem("style", {
        textContent: ".health-manager{display:flex;flex-direction:column;gap:8px;min-width:230px;font-size:12px}.hm-form{display:grid;grid-template-columns:auto 1fr;gap:4px 6px;align-items:center}.hm-form label{opacity:0.75;font-size:11px}.hm-buttons{display:flex;gap:6px}.hm-row{display:flex;align-items:center;gap:6px;padding:3px 5px;border-radius:5px;background:rgba(255,255,255,0.04);cursor:pointer;margin-bottom:2px}.hm-row:hover{background:rgba(255,255,255,0.09)}.hm-name{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.hm-hp{flex:0 0 auto;font-variant-numeric:tabular-nums}.hm-status{flex:0 0 auto;font-size:10px;opacity:0.7;white-space:nowrap}.hm-bar{flex:0 0 46px;height:6px;border-radius:3px;background:rgba(255,255,255,0.12);overflow:hidden}.hm-bar i{display:block;height:100%;background:#6fcf7a}.hm-empty{opacity:0.6;font-size:11px}"
      })
    );
    el.appendChild(elem("div", { className: "tbx-label", textContent: "Give the selection health" }));
    const form = elem("div", { className: "hm-form" });
    const name = (
      /** @type {HTMLInputElement} */
      elem("input", { type: "text", value: DEFAULTS.name, maxLength: 40 }, INPUT_CSS)
    );
    const max = (
      /** @type {HTMLInputElement} */
      elem("input", { type: "number", min: "1", max: "100", step: "1", value: String(DEFAULTS.max) }, INPUT_CSS)
    );
    const regen = (
      /** @type {HTMLInputElement} */
      elem("input", { type: "number", min: "0", max: "10", step: "0.5", value: "0" }, INPUT_CSS)
    );
    const deathAction = select(DEATH_ACTIONS, DEFAULTS.deathAction);
    const respawnDelay = (
      /** @type {HTMLInputElement} */
      elem("input", { type: "number", min: "0", max: "30", step: "1", value: String(DEFAULTS.respawnDelay) }, INPUT_CSS)
    );
    const source = select(DAMAGE_SOURCES, "click");
    const amount = (
      /** @type {HTMLInputElement} */
      elem("input", { type: "number", min: "1", max: String(MAX_PULSES), step: "1", value: "1" }, INPUT_CSS)
    );
    const radius = (
      /** @type {HTMLInputElement} */
      elem("input", { type: "number", min: "0.5", max: "10", step: "0.5", value: "1.5" }, INPUT_CSS)
    );
    radius.title = "For touch and zone: how close the player has to be";
    for (const [label, control] of [
      ["Name", name],
      ["Max hp", max],
      ["Regen /s", regen],
      ["On death", deathAction],
      ["Respawn (s)", respawnDelay],
      ["Damage from", source],
      ["Damage", amount],
      ["Radius", radius]
    ]) {
      form.appendChild(elem("label", { textContent: label }));
      form.appendChild(
        /** @type {any} */
        control
      );
    }
    el.appendChild(form);
    const options = () => ({
      health: {
        name: name.value.trim() || DEFAULTS.name,
        max: Math.max(1, Math.min(100, Number(max.value) || DEFAULTS.max)),
        regen: Math.max(0, Math.min(10, Number(regen.value) || 0)),
        deathAction: deathAction.value,
        respawnDelay: Math.max(0, Math.min(30, Number(respawnDelay.value) || 0))
      },
      damage: {
        amount: Math.max(1, Math.min(MAX_PULSES, Number(amount.value) || 1)),
        source: source.value,
        radius: Math.max(0.5, Math.min(10, Number(radius.value) || 1.5))
      }
    });
    const buttons = elem("div", { className: "hm-buttons" });
    const buildObjects = elem("button", { className: "tbx-btn tbx-primary", textContent: "Make damageable" });
    buildObjects.addEventListener("click", () => {
      makeDamageable(options());
      refresh(true);
    });
    const buildPlayer = elem("button", { className: "tbx-btn", textContent: "Player health" });
    buildPlayer.title = "One health for the local player, on their own peer row";
    buildPlayer.addEventListener("click", () => {
      makePlayerHealth(options());
      refresh(true);
    });
    buttons.appendChild(buildObjects);
    buttons.appendChild(buildPlayer);
    el.appendChild(buttons);
    const list = elem("div", {});
    el.appendChild(list);
    let signature = "";
    const rows = /* @__PURE__ */ new Map();
    function statusText(s) {
      if (s.scope === "object" && s.uuid && !api.objectsGroup()?.getObjectByProperty("uuid", s.uuid)) return "missing";
      if (!s.dead) return s.hp >= s.max ? "full" : "hurt";
      if (s.deathAction === "respawn" && typeof s.deadAt === "number") {
        const left = Math.max(0, s.respawnDelay - (api.now() - s.deadAt));
        return "back in " + Math.max(1, Math.ceil(left)) + "s";
      }
      return "dead";
    }
    function rebuild(model) {
      list.textContent = "";
      rows.clear();
      if (!model.length) {
        list.appendChild(elem("div", { className: "hm-empty", textContent: "No health yet. Select an object and press the button." }));
        return;
      }
      for (const s of model) {
        const row = elem("div", { className: "hm-row" });
        row.dataset.node = s.id;
        row.addEventListener("click", () => {
          if (s.uuid) api.selectObject(s.uuid);
        });
        row.appendChild(elem("div", { className: "hm-name", textContent: s.label + " \xB7 " + s.name }));
        const bar = elem("div", { className: "hm-bar" });
        const fill = elem("i", {});
        bar.appendChild(fill);
        row.appendChild(bar);
        const hp = elem("div", { className: "hm-hp", textContent: "" });
        const status = elem("div", { className: "hm-status", textContent: "" });
        row.appendChild(hp);
        row.appendChild(status);
        rows.set(s.id, { hp, status, bar: fill });
        list.appendChild(row);
      }
    }
    function refresh(force) {
      const model = engine.all();
      const next = JSON.stringify(model.map((s) => [s.id, s.label, s.name, s.scope, s.deathAction]));
      if (force || next !== signature) {
        signature = next;
        rebuild(model);
      }
      for (const s of model) {
        const r = rows.get(s.id);
        if (!r) continue;
        r.hp.textContent = Math.round(s.hp * 10) / 10 + " / " + s.max;
        r.status.textContent = statusText(s);
        r.bar.style.width = Math.round((s.max ? s.hp / s.max : 0) * 100) + "%";
        r.bar.style.background = s.dead ? "#c94a4a" : s.hp / s.max < 0.35 ? "#e0a23b" : "#6fcf7a";
      }
    }
    refresh(true);
    const timer = setInterval(refresh, 500);
    return () => clearInterval(timer);
  }
  const toolbox = api.registerToolbox({
    id: "manager",
    title: "Health",
    width: 270,
    minW: 240,
    sidebar: false,
    mount
  });
  api.registerMenu("Open Health", () => api.openToolbox(toolbox));
  return { toolbox, makeDamageable, makePlayerHealth };
}

// modules/health/src/index.js
var index_default = {
  id: "health",
  name: "Health",
  version: "1.0.0",
  description: "Hit points for objects and players: damage and heal nodes, death and respawn, converging on every peer with no authority.",
  /** @param {any} api the module SDK surface */
  register(api) {
    if (!api.flow?.addNodes || !api.game?.roundCutoff || !api.peerVars?.setMine || !api.registerValueNode) {
      api.toast("Health needs a newer app build (the game SDK seams are missing)");
      return;
    }
    const engine = createEngine(api);
    registerNodes(api, engine);
    const toolbox = registerToolbox(api, engine);
    api.registerClickHandler((object) => {
      const chain = uuidChain(api, object);
      if (chain.length) engine.hitObjects(chain, "click", { local: false });
      return false;
    }, { modes: ["interact", "play"] });
    api.hud.registerDebugLine(() => {
      const names = engine.names();
      if (!names.length) return null;
      return names.map((name) => {
        const r = engine.read(name);
        return "health (" + name + "): " + Math.round(r.hp * 10) / 10 + "/" + r.max + (r.total > 1 ? " \xB7 " + r.alive + " of " + r.total + " alive" : r.alive ? "" : " \xB7 dead");
      }).join(" \xB7 ");
    });
    api.hud.registerAction({
      key: "showhealth",
      label: "Show health (bar)",
      group: "Data",
      role: "drives",
      node: "",
      via: { node: "healthvalue", data: { name: DEFAULTS.name, read: "fraction" }, handle: "value" },
      hint: "0..1 for a Bar (min 0, max 1). Derived from the health nodes, so every peer agrees."
    });
    api.hud.registerAction({
      key: "showhp",
      label: "Show hit points",
      group: "Data",
      role: "drives",
      node: "",
      via: { node: "healthvalue", data: { name: DEFAULTS.name, read: "current" }, handle: "value" },
      hint: "The current hit points as a number \u2014 a Text or an Icon Row."
    });
    api.onSceneClear(() => engine.clear());
    if (typeof window !== "undefined")
      window.__health = {
        api,
        engine,
        toolbox,
        snapshot: () => engine.all().map((s) => ({ ...s }))
      };
  }
};
function uuidChain(api, object) {
  const root = api.objectsGroup();
  const out = [];
  let current = object;
  while (current && current !== root && out.length < 32) {
    if (current.uuid) out.push(current.uuid);
    current = current.parent;
  }
  return current === root ? out : [];
}
export {
  index_default as default
};
