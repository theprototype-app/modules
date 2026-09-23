// modules/waves/src/curve.js
var DEFAULTS = Object.freeze({
  name: "enemy",
  waves: 3,
  sizeStart: 2,
  sizeStep: 1,
  interval: 3,
  speed: 1.5,
  stagger: 0.6,
  reach: 1.5
});
function clamp(n, lo, hi, fallback = lo) {
  const v = Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.min(hi, Math.max(lo, v));
}
function curveOf(data, enemies) {
  return {
    waves: Math.round(clamp(data?.waves, 1, 50, DEFAULTS.waves)),
    sizeStart: Math.round(clamp(data?.sizeStart, 1, 200, DEFAULTS.sizeStart)),
    sizeStep: Math.round(clamp(data?.sizeStep, 0, 50, DEFAULTS.sizeStep)),
    enemies: Math.max(0, Math.round(Number(enemies) || 0))
  };
}
function sizeOf(n, c) {
  if (n < 1) return 0;
  return Math.min(c.enemies, c.sizeStart + c.sizeStep * (n - 1));
}
function firstWaveOf(i, c) {
  for (let n = 1; n <= c.waves; n++) if (i < sizeOf(n, c)) return n;
  return null;
}
function killsNeeded(i, n, c) {
  const first = firstWaveOf(i, c);
  if (first === null || n < first) return 0;
  return n - first + 1;
}
function killsOf(hits, hp) {
  const max = clamp(hp, 1, 1e6, 1);
  return Math.floor(Math.max(0, Number(hits) || 0) / max);
}
function waveComplete(n, kills, c) {
  const size = sizeOf(n, c);
  if (size <= 0) return false;
  for (let i = 0; i < size; i++) if ((kills[i] ?? 0) < killsNeeded(i, n, c)) return false;
  return true;
}
function waveOf(kills, c) {
  let completed = 0;
  while (completed < c.waves && waveComplete(completed + 1, kills, c)) completed++;
  const done = completed >= c.waves;
  return { completed, wave: done ? c.waves : completed + 1, done };
}
function aliveIn(n, kills, c) {
  const out = [];
  for (let i = 0; i < sizeOf(n, c); i++) if ((kills[i] ?? 0) < killsNeeded(i, n, c)) out.push(i);
  return out;
}
function usedIn(n, c) {
  const out = [];
  for (let i = 0; i < sizeOf(n, c); i++) out.push(i);
  return out;
}
function healsBefore(i, n, c) {
  const first = firstWaveOf(i, c);
  if (first === null || n <= first) return 0;
  return n - first;
}
function enemyPosition(p) {
  const speed = clamp(p.speed, 0.01, 100, DEFAULTS.speed);
  const stagger = clamp(p.stagger, 0, 60, DEFAULTS.stagger);
  const t = p.now - p.waveStart - stagger * p.index;
  if (!(t > 0)) return p.start.slice();
  const dx = p.goal[0] - p.start[0];
  const dz = p.goal[2] - p.start[2];
  const dist = Math.hypot(dx, dz);
  if (dist < 1e-6) return p.start.slice();
  const f = Math.min(1, t * speed / dist);
  return [p.start[0] + dx * f, p.start[1], p.start[2] + dz * f];
}
function spawnFor(i, points, fallback) {
  if (!points.length) return fallback.slice();
  return points[i % points.length].slice();
}
function runEntry(r) {
  return {
    at: r.at,
    // 30: the round's stamp, the entry's identity when known (absent on an old entry)
    ...typeof r.round === "number" ? { round: r.round } : {},
    waves: r.waves,
    reached: r.reached,
    cleared: !!r.cleared,
    players: r.rows.map((x) => ({ name: String(x.name ?? ""), kills: Number(x.kills) || 0 })).sort((a, b) => b.kills - a.kills || a.name.localeCompare(b.name))
  };
}
function appendRun(log, entry, cap = 50) {
  const same = (e) => typeof entry.round === "number" && e.round === entry.round || e.at === entry.at;
  const list = Array.isArray(log) ? log.filter((e) => e && !same(e)) : [];
  list.push(entry);
  return list.slice(-cap);
}

// modules/waves/src/engine.js
var SWEEP = 0.1;
var LOG_PREFIX = "waves:";
var toSeconds = (ms) => ms / 1e3 % 86400;
var KILLS_ROW = "kills";
function createWavesEngine(api) {
  const state = /* @__PURE__ */ new Map();
  const waveSeen = /* @__PURE__ */ new Map();
  const doneSeen = /* @__PURE__ */ new Map();
  const runSeen = /* @__PURE__ */ new Map();
  const roundSeen = /* @__PURE__ */ new Map();
  const parked = /* @__PURE__ */ new Map();
  const healExpected = /* @__PURE__ */ new Map();
  const listeners = /* @__PURE__ */ new Set();
  const now = () => api.now();
  function objectOf(uuid) {
    if (!uuid) return null;
    return api.objectsGroup()?.getObjectByProperty("uuid", uuid) ?? null;
  }
  const worldPos = (object) => object.getWorldPosition(new api.THREE.Vector3()).toArray();
  function graphView() {
    const nodes = api.flow.nodes();
    const edges2 = api.flow.edges();
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const byTarget = /* @__PURE__ */ new Map();
    for (const e of edges2) {
      if (!byTarget.has(e.target)) byTarget.set(e.target, []);
      byTarget.get(e.target)?.push(e);
    }
    return { nodes, edges: edges2, byId, byTarget };
  }
  const into = (g, nodeId, handle) => (g.byTarget.get(nodeId) ?? []).filter((e) => (e.targetHandle ?? null) === handle).map((e) => e.source);
  function selectorInto(g, node, handle) {
    for (const id of into(g, node.id, handle)) {
      const src = g.byId.get(id);
      if (src?.type !== "objectselector") continue;
      const selected = String(src.data?.selected ?? "");
      if (selected && selected !== "-None-") return selected;
    }
    if (handle === "target" && node.graphId && node.graphId !== "scene") return node.graphId;
    return null;
  }
  const nameOf = (node) => String(node?.data?.name ?? "").trim() || DEFAULTS.name;
  function enemiesOf(g, name) {
    const out = [];
    for (const node of g.nodes) {
      if (node.type !== "health" || node.data?.scope === "player") continue;
      if (nameOf(node) !== name) continue;
      const uuid = selectorInto(g, node, "target");
      const object = objectOf(uuid);
      const damageCounters = into(g, node.id, "damage").filter((id) => g.byId.get(id)?.type === "counter");
      const healCounters = into(g, node.id, "heal").filter((id) => g.byId.get(id)?.type === "counter");
      let hits = 0;
      let lastHit = null;
      for (const id of damageCounters) {
        hits += Number(api.flow.nodeValue(id)) || 0;
        const stamp = api.flow.triggerStamp(id);
        if (stamp && (lastHit === null || stamp.stamp > lastHit)) lastHit = stamp.stamp;
      }
      let heals = 0;
      for (const id of healCounters) heals += Number(api.flow.nodeValue(id)) || 0;
      const max = clamp(node.data?.max, 1, 1e6, 5);
      out.push({
        healthId: node.id,
        uuid,
        label: object?.name || (uuid ? uuid.slice(0, 8) + "\u2026" : "(no target)"),
        max,
        hits,
        heals,
        lastHit,
        kills: killsOf(hits, max),
        hp: Math.max(0, Math.min(max, max - (hits - heals))),
        healNodes: g.nodes.filter((n) => n.type === "heal" && healCounters.some((c) => (g.byTarget.get(c) ?? []).some((e) => e.source === n.id))).map((n) => n.id)
      });
    }
    out.sort((a, b) => a.label.localeCompare(b.label) || a.healthId.localeCompare(b.healthId));
    return out;
  }
  function spawnPoints(prefix) {
    const p = String(prefix ?? "").trim();
    if (!p) return [];
    const root = api.objectsGroup();
    const found = (root?.children ?? []).filter((c) => String(c.name ?? "").startsWith(p));
    found.sort((a, b) => String(a.name).localeCompare(String(b.name)));
    return found.map((c) => worldPos(c));
  }
  function derive(node, g) {
    const d = node.data ?? {};
    const name = nameOf(node);
    const enemies = enemiesOf(g, name);
    const curve = curveOf(d, enemies.length);
    const kills = enemies.map((e) => e.kills);
    const { completed, wave, done } = waveOf(kills, curve);
    const cutoff = api.game.roundCutoff();
    const underway = api.game.roundUnderway();
    const running = underway && typeof cutoff === "number" && Number.isFinite(cutoff) && enemies.length > 0 && !done;
    const interval = clamp(d.interval, 0, 600, DEFAULTS.interval);
    let waveStart = typeof cutoff === "number" && Number.isFinite(cutoff) ? toSeconds(cutoff) : null;
    let clearedAt = null;
    if (completed > 0) {
      let last = null;
      for (const i of usedIn(completed, curve)) {
        const e = enemies[i];
        if (e?.lastHit !== null && e?.lastHit !== void 0 && (last === null || e.lastHit > last)) last = e.lastHit;
      }
      clearedAt = last;
      if (last !== null && !done) waveStart = last + interval;
    }
    const started = running && waveStart !== null && now() >= waveStart;
    if (typeof cutoff === "number" && Number.isFinite(cutoff)) roundSeen.set(node.id, cutoff);
    const round = roundSeen.get(node.id) ?? null;
    const goalUuid = selectorInto(g, node, "goal");
    const goalObject = objectOf(goalUuid);
    return {
      id: node.id,
      name,
      curve,
      enemies,
      wave,
      completed,
      done,
      running,
      started,
      waveStart,
      clearedAt,
      // the round this run belongs to (the shell's replicated startedAt, ms) — the run log's
      // identity: every peer agrees on it, unlike a last-hit stamp a late knock can move
      round,
      interval,
      alive: running || done ? aliveIn(wave, kills, curve).length : sizeOf(wave, curve),
      size: sizeOf(wave, curve),
      goal: goalObject ? worldPos(goalObject) : null,
      spawns: spawnPoints(d.spawnPrefix ?? "Spawn"),
      speed: clamp(d.speed, 0.01, 100, DEFAULTS.speed),
      stagger: clamp(d.stagger, 0, 60, DEFAULTS.stagger),
      reach: clamp(d.reach, 0.1, 100, DEFAULTS.reach)
    };
  }
  function healSweep(s) {
    if (!s.started) return;
    for (const i of usedIn(s.wave, s.curve)) {
      const e = s.enemies[i];
      if (!e || !e.healNodes.length) continue;
      const expected = healExpected.get(e.healthId) ?? 0;
      const heals = Math.max(e.heals, expected);
      const owed = healsBefore(i, s.wave, s.curve) * e.max - heals;
      if (owed <= 0) continue;
      const target = e.healNodes[0];
      const fire = Math.min(owed, 100);
      for (let k = 0; k < fire; k++)
        api.fireNodeTrigger("heal", (_d, id) => id === target, { replicate: false });
      healExpected.set(e.healthId, heals + fire);
    }
  }
  function moveSweep(s) {
    const used = usedIn(s.wave, s.curve);
    const alive = new Set(aliveIn(s.wave, s.enemies.map((e) => e.kills), s.curve));
    for (let k = 0; k < s.enemies.length; k++) {
      const e = s.enemies[k];
      const object = objectOf(e.uuid);
      if (!object) continue;
      if (!parked.has(e.uuid)) parked.set(e.uuid, object.position.toArray());
      const home = parked.get(e.uuid) ?? object.position.toArray();
      const index = used.indexOf(k);
      const walking = s.running && s.started && index >= 0 && alive.has(k) && s.goal;
      if (walking && s.waveStart !== null) {
        const start = spawnFor(index, s.spawns, home);
        object.position.fromArray(enemyPosition({ start, goal: (
          /** @type {number[]} */
          s.goal
        ), waveStart: s.waveStart, index, now: now(), speed: s.speed, stagger: s.stagger }));
      } else if (!s.running) {
        object.position.fromArray(home);
      } else if (index >= 0 && !alive.has(k) === false) {
        object.position.fromArray(spawnFor(index, s.spawns, home));
      }
      object.updateMatrixWorld?.();
    }
    if (!s.running) for (const e of s.enemies) parked.delete(e.uuid);
  }
  function emit(name, kind) {
    api.fireNodeTrigger("wavesevent", (d) => nameOf({ data: d }) === name && String(d?.event ?? "wave") === kind, { replicate: false });
  }
  function edges(s, firstSight) {
    const prevWave = waveSeen.get(s.id);
    const prevDone = doneSeen.get(s.id);
    const prevRun = runSeen.get(s.id);
    waveSeen.set(s.id, s.wave);
    doneSeen.set(s.id, s.done);
    runSeen.set(s.id, s.running);
    if (firstSight) return;
    if (s.running && prevRun === false) emit(s.name, "start");
    if (typeof prevWave === "number" && s.wave > prevWave && !s.done) emit(s.name, "wave");
    if (s.done && prevDone === false) {
      emit(s.name, "over");
      logRun(s);
    }
  }
  function logRun(s) {
    if (typeof s.clearedAt !== "number") return;
    const names = new Map((api.peerNames?.() ?? []).map((p) => [p.id, p.label ?? p.name]));
    const rows = (api.peerVars.all(KILLS_ROW) ?? []).map((r) => ({ name: names.get(r.id) ?? "peer " + String(r.id).slice(0, 4), kills: r.value }));
    const entry = runEntry({ at: s.clearedAt, round: s.round, waves: s.curve.waves, reached: s.wave, cleared: true, rows });
    const key = LOG_PREFIX + s.name;
    const held = api.game.getVar(key, null);
    api.game.setVar(key, { runs: appendRun(held && typeof held === "object" ? held.runs : [], entry) });
  }
  function runLog(name) {
    const v = api.game.getVar(LOG_PREFIX + name, null);
    return v && typeof v === "object" && Array.isArray(v.runs) ? v.runs : [];
  }
  function sweep() {
    const g = graphView();
    const live = /* @__PURE__ */ new Set();
    for (const node of g.nodes) {
      if (node.type !== "waves") continue;
      live.add(node.id);
      const firstSight = !state.has(node.id);
      const s = derive(node, g);
      state.set(node.id, s);
      edges(s, firstSight);
      healSweep(s);
      moveSweep(s);
    }
    for (const id of [...state.keys()])
      if (!live.has(id)) {
        state.delete(id);
        waveSeen.delete(id);
        doneSeen.delete(id);
        runSeen.delete(id);
      }
    for (const s of state.values())
      for (const e of s.enemies) {
        const expected = healExpected.get(e.healthId);
        if (expected !== void 0 && (e.heals >= expected || e.heals === 0 && e.hits === 0)) healExpected.delete(e.healthId);
      }
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
      console.warn("[waves] sweep failed", error);
    }
  });
  function read(name) {
    for (const s of state.values()) if (s.name === name) return s;
    return null;
  }
  function clear() {
    state.clear();
    waveSeen.clear();
    roundSeen.clear();
    doneSeen.clear();
    runSeen.clear();
    parked.clear();
    healExpected.clear();
  }
  return {
    state,
    stateOf: (id) => state.get(id) ?? null,
    read,
    all: () => [...state.values()],
    graphView,
    runLog,
    sweep,
    onChange: (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    clear
  };
}

// modules/waves/src/nodes.js
var READS = ["wave", "left", "size", "waves", "done"];
var EVENTS = ["wave", "over", "start"];
function registerNodes(api, engine) {
  api.registerNodeGroup({
    group: "Waves",
    items: [
      {
        type: "waves",
        label: "Waves",
        defaults: { ...DEFAULTS, spawnPrefix: "Spawn", goal: "" },
        params: [
          { key: "name", kind: "text", placeholder: DEFAULTS.name, maxLength: 40 },
          { key: "waves", kind: "range", min: 1, max: 50, step: 1 },
          { key: "sizeStart", kind: "range", min: 1, max: 50, step: 1 },
          { key: "sizeStep", kind: "range", min: 0, max: 20, step: 1 },
          { key: "interval", kind: "range", min: 0, max: 60, step: 0.5 },
          { key: "speed", kind: "range", min: 0.1, max: 20, step: 0.1 },
          { key: "stagger", kind: "range", min: 0, max: 10, step: 0.1 },
          { key: "reach", kind: "range", min: 0.5, max: 10, step: 0.5 },
          { key: "spawnPrefix", kind: "text", placeholder: "Spawn", maxLength: 40 }
        ]
      },
      {
        type: "wavesvalue",
        label: "Waves Value",
        defaults: { name: DEFAULTS.name, read: "wave" },
        params: [
          { key: "name", kind: "text", placeholder: DEFAULTS.name, maxLength: 40 },
          { key: "read", kind: "select", options: READS }
        ]
      },
      {
        // 30: the goal's crystal glows with a 0..1 value (fx.js) — the player's health
        type: "wavescore",
        label: "Goal Core",
        defaults: { value: 1, floor: 0.15, spin: 0.6 },
        params: [
          { key: "floor", kind: "range", min: 0, max: 1, step: 0.05 },
          { key: "spin", kind: "range", min: 0, max: 4, step: 0.1 }
        ]
      },
      {
        type: "wavesevent",
        label: "Waves Event",
        defaults: { name: DEFAULTS.name, event: "wave" },
        params: [
          { key: "name", kind: "text", placeholder: DEFAULTS.name, maxLength: 40 },
          { key: "event", kind: "select", options: EVENTS }
        ]
      }
    ]
  });
  api.registerValueNode(
    "waves",
    (_data, _time, ctx) => engine.stateOf(ctx?.id)?.wave ?? 0,
    { vtype: "number", inputs: { goal: "object" } }
  );
  api.registerValueNode(
    "wavesvalue",
    (data) => {
      const s = engine.read(String(data?.name ?? "").trim() || DEFAULTS.name);
      if (!s) return 0;
      switch (String(data?.read ?? "wave")) {
        case "left":
          return s.alive;
        case "size":
          return s.size;
        case "waves":
          return s.curve.waves;
        case "done":
          return s.done ? 1 : 0;
        default:
          return s.wave;
      }
    },
    { vtype: "number" }
  );
  api.registerValueNode("wavesevent", () => 0, { vtype: "event" });
}

// modules/waves/src/toolbox.js
var SELECT_CSS = "background:rgba(0,0,0,0.25);color:inherit;border:1px solid rgba(255,255,255,0.15);border-radius:4px;font-size:11px;padding:1px 3px;";
var INPUT_CSS = SELECT_CSS + "width:100%;";
var COL = 220;
var ROW = 200;
var X0 = 60;
var Y0 = 40;
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
function arenaRecipe(spec) {
  const o = spec.options;
  const name = String(o.name ?? "").trim() || DEFAULTS.name;
  const playerName = String(o.playerName ?? "").trim() || "me";
  const nodes = [];
  const edges = [];
  let row = spec.row;
  const y = () => Y0 + row * ROW;
  const wavesIdx = nodes.push({ type: "waves", x: X0, y: y(), data: { name, waves: o.waves, sizeStart: o.sizeStart, sizeStep: o.sizeStep, interval: o.interval, speed: o.speed, stagger: DEFAULTS.stagger, reach: o.reach, spawnPrefix: o.spawnPrefix } }) - 1;
  if (spec.goal) {
    const sel = nodes.push({ type: "objectselector", x: X0 - 0, y: y() + 100, data: { selected: spec.goal } }) - 1;
    edges.push({ from: sel, to: wavesIdx, handle: "goal" });
  }
  const over = nodes.push({ type: "wavesevent", x: X0 + COL, y: y(), data: { name, event: "over" } }) - 1;
  const setOver = nodes.push({ type: "setgamestate", x: X0 + 2 * COL, y: y(), data: { state: "over", outcome: "won" } }) - 1;
  edges.push({ from: over, to: setOver, handle: "trigger" });
  let playerRef = (
    /** @type {number|string|null} */
    spec.playerHealthId
  );
  if (!playerRef) {
    const pd = nodes.push({ type: "damage", x: X0 + 3 * COL, y: y(), data: { amount: 1, source: "wired" } }) - 1;
    const pc = nodes.push({ type: "counter", x: X0 + 4 * COL, y: y(), data: { op: "up", step: 1 } }) - 1;
    const ph = nodes.push({ type: "health", x: X0 + 5 * COL, y: y(), data: { name: playerName, scope: "player", max: o.playerHp, regen: o.playerRegen, deathAction: "respawn", respawnDelay: 3 } }) - 1;
    const pr = nodes.push({ type: "healthreset", x: X0 + 3 * COL, y: y() + 100, data: { name: playerName } }) - 1;
    edges.push({ from: pd, to: pc, handle: "pulse" }, { from: pc, to: ph, handle: "damage" }, { from: pr, to: pc, handle: "reset" });
    playerRef = ph;
  }
  row++;
  for (const uuid of spec.enemies) {
    const d = nodes.push({ type: "damage", x: X0, y: y(), data: { amount: 1, source: o.source, scale: o.source === "hit" ? "speed" : "none", speedRef: 3 } }) - 1;
    const c = nodes.push({ type: "counter", x: X0 + COL, y: y(), data: { op: "up", step: 1 } }) - 1;
    const h = nodes.push({ type: "health", x: X0 + 2 * COL, y: y(), data: { name, scope: "object", max: o.hp, deathAction: "hide", respawnDelay: 3 } }) - 1;
    const s = nodes.push({ type: "objectselector", x: X0 + 3 * COL, y: y(), data: { selected: uuid } }) - 1;
    const r = nodes.push({ type: "healthreset", x: X0, y: y() + 100, data: { name } }) - 1;
    const he = nodes.push({ type: "heal", x: X0 + COL, y: y() + 100, data: { amount: 1 } }) - 1;
    const hc = nodes.push({ type: "counter", x: X0 + 2 * COL, y: y() + 100, data: { op: "up", step: 1 } }) - 1;
    const z = nodes.push({ type: "damage", x: X0 + 4 * COL, y: y(), data: { amount: o.enemyDamage, source: "zone", perSecond: o.enemyRate, radius: o.reach } }) - 1;
    const zs = nodes.push({ type: "objectselector", x: X0 + 4 * COL, y: y() + 100, data: { selected: uuid } }) - 1;
    edges.push(
      { from: d, to: c, handle: "pulse" },
      { from: c, to: h, handle: "damage" },
      { from: s, to: h, handle: "target" },
      { from: r, to: c, handle: "reset" },
      { from: r, to: hc, handle: "reset" },
      { from: he, to: hc, handle: "pulse" },
      { from: hc, to: h, handle: "heal" },
      { from: zs, to: z, handle: "zone" },
      { from: z, to: playerRef, handle: "damage" }
    );
    row++;
  }
  return { nodes, edges, rows: row - spec.row };
}
function registerToolbox(api, engine) {
  function playerHealthId(playerName) {
    for (const node of api.flow.nodes("health"))
      if (node.data?.scope === "player" && (String(node.data?.name ?? "").trim() || "hp") === playerName) return node.id;
    return null;
  }
  function build(options, enemies) {
    if (!enemies.length) {
      api.toast("Select the enemy objects first (or add boxes)");
      return null;
    }
    const g = engine.graphView();
    const row = g.nodes.filter((n) => n.type === "health" || n.type === "waves").length;
    const goal = api.selectedUuids().find((u) => !enemies.includes(u)) ?? null;
    const spec = arenaRecipe({ enemies, goal: options.goal ?? goal, options, row, playerHealthId: playerHealthId(String(options.playerName ?? "").trim() || "me") });
    const ids = api.flow.addNodes({ nodes: spec.nodes, edges: spec.edges });
    api.toast("Arena: " + enemies.length + " enemies over " + options.waves + " waves" + (spec.nodes.some((n) => n.type === "objectselector" && n.data.selected === (options.goal ?? goal)) ? ", walking to the goal" : " (no goal: they hold their spawn points)"));
    return ids;
  }
  function mount(el) {
    el.textContent = "";
    el.classList.add("waves-manager");
    el.appendChild(
      elem("style", {
        textContent: ".waves-manager{display:flex;flex-direction:column;gap:8px;min-width:240px;font-size:12px}.wm-form{display:grid;grid-template-columns:auto 1fr;gap:4px 6px;align-items:center}.wm-form label{opacity:0.75;font-size:11px}.wm-buttons{display:flex;gap:6px;flex-wrap:wrap}.wm-run{padding:4px 6px;border-radius:5px;background:rgba(255,255,255,0.05);margin-bottom:3px}.wm-title{font-weight:600}.wm-line{font-size:11px;opacity:0.8}.wm-empty{opacity:0.6;font-size:11px}"
      })
    );
    el.appendChild(elem("div", { className: "tbx-label", textContent: "Build an arena" }));
    const form = elem("div", { className: "wm-form" });
    const name = (
      /** @type {HTMLInputElement} */
      elem("input", { type: "text", value: DEFAULTS.name, maxLength: 40 }, INPUT_CSS)
    );
    const waves = (
      /** @type {HTMLInputElement} */
      elem("input", { type: "number", min: "1", max: "50", step: "1", value: String(DEFAULTS.waves) }, INPUT_CSS)
    );
    const sizeStart = (
      /** @type {HTMLInputElement} */
      elem("input", { type: "number", min: "1", max: "50", step: "1", value: String(DEFAULTS.sizeStart) }, INPUT_CSS)
    );
    const sizeStep = (
      /** @type {HTMLInputElement} */
      elem("input", { type: "number", min: "0", max: "20", step: "1", value: String(DEFAULTS.sizeStep) }, INPUT_CSS)
    );
    const interval = (
      /** @type {HTMLInputElement} */
      elem("input", { type: "number", min: "0", max: "60", step: "0.5", value: String(DEFAULTS.interval) }, INPUT_CSS)
    );
    const hp = (
      /** @type {HTMLInputElement} */
      elem("input", { type: "number", min: "1", max: "20", step: "1", value: "3" }, INPUT_CSS)
    );
    const source = select(["click", "hit", "touch"], "click");
    const speed = (
      /** @type {HTMLInputElement} */
      elem("input", { type: "number", min: "0.1", max: "20", step: "0.1", value: String(DEFAULTS.speed) }, INPUT_CSS)
    );
    const reach = (
      /** @type {HTMLInputElement} */
      elem("input", { type: "number", min: "0.5", max: "10", step: "0.5", value: String(DEFAULTS.reach) }, INPUT_CSS)
    );
    const enemyDamage = (
      /** @type {HTMLInputElement} */
      elem("input", { type: "number", min: "1", max: "20", step: "1", value: "1" }, INPUT_CSS)
    );
    const enemyRate = (
      /** @type {HTMLInputElement} */
      elem("input", { type: "number", min: "0.5", max: "10", step: "0.5", value: "1" }, INPUT_CSS)
    );
    const playerName = (
      /** @type {HTMLInputElement} */
      elem("input", { type: "text", value: "me", maxLength: 40 }, INPUT_CSS)
    );
    const playerHp = (
      /** @type {HTMLInputElement} */
      elem("input", { type: "number", min: "1", max: "100", step: "1", value: "10" }, INPUT_CSS)
    );
    const spawnPrefix = (
      /** @type {HTMLInputElement} */
      elem("input", { type: "text", value: "Spawn", maxLength: 40 }, INPUT_CSS)
    );
    const count = (
      /** @type {HTMLInputElement} */
      elem("input", { type: "number", min: "1", max: "20", step: "1", value: "4" }, INPUT_CSS)
    );
    for (const [label, control] of [
      ["Enemies named", name],
      ["Waves", waves],
      ["First wave", sizeStart],
      ["+ per wave", sizeStep],
      ["Between (s)", interval],
      ["Enemy hp", hp],
      ["Killed by", source],
      ["Walk m/s", speed],
      ["Reach", reach],
      ["Enemy dmg", enemyDamage],
      ["\u2026per second", enemyRate],
      ["Player health", playerName],
      ["Player hp", playerHp],
      ["Spawn prefix", spawnPrefix],
      ["Boxes to add", count]
    ]) {
      form.appendChild(elem("label", { textContent: label }));
      form.appendChild(
        /** @type {any} */
        control
      );
    }
    el.appendChild(form);
    const options = () => ({
      name: name.value.trim() || DEFAULTS.name,
      waves: Math.max(1, Math.min(50, Number(waves.value) || DEFAULTS.waves)),
      sizeStart: Math.max(1, Math.min(50, Number(sizeStart.value) || DEFAULTS.sizeStart)),
      sizeStep: Math.max(0, Math.min(20, Number(sizeStep.value) || 0)),
      interval: Math.max(0, Math.min(60, Number(interval.value) || 0)),
      hp: Math.max(1, Math.min(20, Number(hp.value) || 3)),
      source: source.value,
      speed: Math.max(0.1, Math.min(20, Number(speed.value) || DEFAULTS.speed)),
      reach: Math.max(0.5, Math.min(10, Number(reach.value) || DEFAULTS.reach)),
      enemyDamage: Math.max(1, Math.min(20, Number(enemyDamage.value) || 1)),
      enemyRate: Math.max(0.5, Math.min(10, Number(enemyRate.value) || 1)),
      playerName: playerName.value.trim() || "me",
      playerHp: Math.max(1, Math.min(100, Number(playerHp.value) || 10)),
      playerRegen: 0,
      spawnPrefix: spawnPrefix.value.trim() || "Spawn"
    });
    const buttons = elem("div", { className: "wm-buttons" });
    const fromSelection = elem("button", { className: "tbx-btn tbx-primary", textContent: "Enemies from selection" });
    fromSelection.title = "The selected objects become the enemies; select the goal object too and it becomes the goal";
    fromSelection.addEventListener("click", () => {
      const selected = api.selectedUuids();
      const enemies = selected.length > 1 ? selected.slice(0, -1) : selected;
      const goal = selected.length > 1 ? selected[selected.length - 1] : null;
      build({ ...options(), goal }, enemies);
      refresh();
    });
    const addBoxes = elem("button", { className: "tbx-btn", textContent: "Add boxes as enemies" });
    addBoxes.title = "Creates N boxes (replicated), parks them in a row, and makes them the enemies";
    addBoxes.addEventListener("click", async () => {
      const n = Math.max(1, Math.min(20, Number(count.value) || 4));
      const made = [];
      for (let i = 0; i < n; i++) {
        const ids = await api.create("/create box", { at: [-6 + i * 1.5, 0.5, -8] });
        if (ids[0]) made.push(ids[0]);
      }
      const goal = api.selectedUuids()[0] ?? null;
      build({ ...options(), goal }, made);
      refresh();
    });
    buttons.appendChild(fromSelection);
    buttons.appendChild(addBoxes);
    el.appendChild(buttons);
    const list = elem("div", {});
    el.appendChild(list);
    function refresh() {
      list.textContent = "";
      const runs = engine.all();
      if (!runs.length) {
        list.appendChild(elem("div", { className: "wm-empty", textContent: "No arena yet. Select the enemies (and a goal), or add boxes." }));
        return;
      }
      for (const s of runs) {
        const box = elem("div", { className: "wm-run" });
        box.dataset.node = s.id;
        box.appendChild(elem("div", { className: "wm-title", textContent: s.name + " \xB7 wave " + s.wave + " of " + s.curve.waves + (s.done ? " \xB7 cleared" : s.running ? s.started ? " \xB7 " + s.alive + " left" : " \xB7 next wave soon" : " \xB7 idle") }));
        box.appendChild(elem("div", { className: "wm-line", textContent: s.enemies.length + " enemies \xB7 " + (s.goal ? "walking to the goal" : "no goal") + " \xB7 " + s.spawns.length + " spawn points \xB7 " + engine.runLog(s.name).length + " runs logged" }));
        list.appendChild(box);
      }
    }
    refresh();
    const timer = setInterval(refresh, 500);
    return () => clearInterval(timer);
  }
  const toolbox = api.registerToolbox({ id: "arena", title: "Waves", width: 280, minW: 250, sidebar: false, mount });
  api.registerMenu("Open Waves", () => api.openToolbox(toolbox));
  return { toolbox, build, arenaRecipe };
}

// modules/waves/src/hud.js
var PANEL = { bg: "rgba(22, 18, 28, 0.92)", radius: 18, border: "1px solid rgba(255, 140, 100, 0.3)" };
var BUTTON = (bg) => ({ size: 16, weight: "700", bg, color: "#ffffff", radius: 12 });
function arenaHud() {
  return {
    scene: {
      active: "",
      changedAt: 0,
      screens: [
        {
          id: "menu",
          name: "Menu",
          showWhile: "menu",
          input: "menu",
          elements: [
            { id: "menu-panel", kind: "panel", anchor: "center", x: 0, y: 0, w: 480, h: 360, z: 0, label: "", style: PANEL },
            { id: "menu-stripe", kind: "panel", anchor: "center", x: 0, y: -176, w: 480, h: 8, z: 1, label: "", style: { bg: "#ff7a4a", radius: 4 } },
            { id: "title", kind: "text", anchor: "center", x: 0, y: -122, w: 420, h: 56, z: 1, label: "WAVES", style: { size: 46, weight: "800", color: "#ff9c6b", align: "left" } },
            { id: "subtitle", kind: "text", anchor: "center", x: 0, y: -66, w: 420, h: 44, z: 1, label: "Hold the crystal. Every wave brings more enemies through the portals; the round ends when the last one falls.", style: { size: 14, color: "#e6dede", align: "left" }, wrap: true },
            { id: "wv-start", kind: "button", anchor: "center", x: 0, y: 8, w: 420, h: 54, z: 1, label: "Start", enabled: true, style: { ...BUTTON("#d9533f"), size: 20 } },
            { id: "wv-log", kind: "list", anchor: "center", x: 0, y: 92, w: 420, h: 76, z: 1, label: "", rows: [], style: { size: 12, color: "#d6c8c8", align: "left", bg: "transparent" } },
            { id: "menu-hint", kind: "text", anchor: "center", x: 0, y: 150, w: 420, h: 20, z: 1, label: "Knock them down: walk into them or grab and throw  \xB7  P pauses", style: { size: 11, color: "#9b8f8f", align: "left" } }
          ]
        },
        {
          id: "hud",
          name: "HUD",
          showWhile: "playing",
          input: "game",
          elements: [
            { id: "wv-banner", kind: "panel", anchor: "top-center", x: 0, y: 10, w: 150, h: 68, z: 0, label: "", style: { bg: "rgba(22, 18, 28, 0.78)", radius: 14, border: "1px solid rgba(255, 140, 100, 0.25)" } },
            { id: "wv-wave", kind: "text", anchor: "top-center", x: 0, y: 14, w: 122, h: 34, z: 1, label: "Wave 1", style: { size: 24, weight: "800", color: "#ff9c6b", align: "left" } },
            { id: "wv-left", kind: "text", anchor: "top-center", x: 0, y: 48, w: 122, h: 24, z: 1, label: "", style: { size: 14, color: "#e6dede", align: "left" } },
            { id: "wv-hp-label", kind: "text", anchor: "bottom-center", x: 0, y: 46, w: 340, h: 18, z: 1, label: "HEALTH", style: { size: 10, weight: "700", color: "#c8e6cc", align: "left" } },
            { id: "wv-hp", kind: "bar", anchor: "bottom-center", x: 0, y: 24, w: 340, h: 20, z: 1, label: "", min: 0, max: 1, value: 1, orientation: "horizontal", showPercent: false, style: { color: "#6fcf7a", bg: "rgba(0,0,0,0.45)", radius: 10 } },
            { id: "wv-kills", kind: "list", anchor: "top-right", x: 16, y: 14, w: 220, h: 100, z: 1, label: "", rows: [], style: { size: 13, weight: "600", color: "#ffe0d0", align: "right", bg: "transparent" } }
          ]
        },
        {
          id: "pause",
          name: "Pause",
          input: "menu",
          elements: [
            { id: "pause-panel", kind: "panel", anchor: "center", x: 0, y: 0, w: 380, h: 300, z: 0, label: "", style: PANEL },
            { id: "pause-title", kind: "text", anchor: "center", x: 0, y: -95, w: 260, h: 36, z: 1, label: "PAUSED", style: { size: 28, weight: "800", color: "#e6dede", align: "left" } },
            { id: "resume-btn", kind: "button", anchor: "center", x: 0, y: -30, w: 260, h: 44, z: 1, label: "Resume", enabled: true, style: BUTTON("#3b7dd8") },
            { id: "restart-btn", kind: "button", anchor: "center", x: 0, y: 24, w: 260, h: 44, z: 1, label: "Restart round", enabled: true, style: BUTTON("#d9533f") },
            { id: "quit-btn", kind: "button", anchor: "center", x: 0, y: 78, w: 260, h: 44, z: 1, label: "Quit to menu", enabled: true, style: { size: 15, weight: "600", bg: "#3a3440", color: "#e6dede", radius: 12 } }
          ]
        },
        {
          id: "over",
          name: "Round over",
          showWhile: "over",
          input: "menu",
          elements: [
            { id: "over-panel", kind: "panel", anchor: "center", x: 0, y: 0, w: 480, h: 360, z: 0, label: "", style: PANEL },
            { id: "over-title", kind: "text", anchor: "center", x: 0, y: -126, w: 420, h: 44, z: 1, label: "ARENA CLEARED", style: { size: 32, weight: "800", color: "#ff9c6b", align: "left" } },
            { id: "wv-kills-over", kind: "list", anchor: "center", x: 0, y: -50, w: 420, h: 90, z: 1, label: "", rows: [], style: { size: 14, color: "#e6dede", align: "center", bg: "transparent" } },
            { id: "wv-log-over", kind: "list", anchor: "center", x: 0, y: 40, w: 420, h: 70, z: 1, label: "", rows: [], style: { size: 12, color: "#d6c8c8", align: "center", bg: "transparent" } },
            { id: "wv-again", kind: "button", anchor: "center", x: 0, y: 124, w: 260, h: 48, z: 1, label: "Again", enabled: true, style: BUTTON("#d9533f") }
          ]
        }
      ]
    }
  };
}
function hudGraph(o) {
  const x = o.x ?? 60;
  const y = o.y ?? 40;
  const nodes = [
    { type: "hudbutton", x, y, data: { element: "wv-start" } },
    { type: "setgamestate", x: x + 220, y, data: { state: "playing", outcome: "" } },
    { type: "hudbutton", x, y: y + 100, data: { element: "wv-again" } },
    { type: "setgamestate", x: x + 220, y: y + 100, data: { state: "playing", outcome: "" } },
    { type: "wavesvalue", x, y: y + 200, data: { name: o.name, read: "wave" } },
    { type: "hudtext", x: x + 220, y: y + 200, data: { element: "wv-wave", format: "Wave {v}", decimals: 0 } },
    { type: "wavesvalue", x, y: y + 300, data: { name: o.name, read: "left" } },
    { type: "hudtext", x: x + 220, y: y + 300, data: { element: "wv-left", format: "{v} left", decimals: 0 } },
    { type: "healthvalue", x, y: y + 400, data: { name: o.playerName, read: "fraction" } },
    { type: "hudbar", x: x + 220, y: y + 400, data: { element: "wv-hp", min: 0, max: 1 } },
    { type: "leaderboard", x, y: y + 500, data: { variable: "kills", element: "wv-kills,wv-kills-over", limit: 8 } },
    // 30: the pause menu — P toggles it, Resume hides it, Restart re-enters playing (a fresh
    // round stamp) and Quit goes back to the menu; both close the pause screen
    { type: "keypress", x, y: y + 600, data: { code: "KeyP", edge: "down", pulse: 0.3 } },
    { type: "hudscreen", x: x + 220, y: y + 600, data: { screen: "pause", action: "toggle" } },
    { type: "hudbutton", x, y: y + 700, data: { element: "resume-btn" } },
    { type: "hudscreen", x: x + 220, y: y + 700, data: { screen: "pause", action: "hide" } },
    { type: "hudbutton", x, y: y + 800, data: { element: "restart-btn" } },
    { type: "setgamestate", x: x + 220, y: y + 800, data: { state: "playing", outcome: "", reset: true } },
    { type: "hudscreen", x: x + 440, y: y + 800, data: { screen: "pause", action: "hide" } },
    { type: "hudbutton", x, y: y + 900, data: { element: "quit-btn" } },
    { type: "setgamestate", x: x + 220, y: y + 900, data: { state: "menu", outcome: "", reset: true } },
    { type: "hudscreen", x: x + 440, y: y + 900, data: { screen: "pause", action: "hide" } }
  ];
  const edges = [
    { from: 0, to: 1, handle: "trigger" },
    { from: 2, to: 3, handle: "trigger" },
    { from: 4, to: 5, handle: "value" },
    { from: 6, to: 7, handle: "value" },
    { from: 8, to: 9, handle: "value" },
    { from: 11, to: 12, handle: "trigger" },
    { from: 13, to: 14, handle: "trigger" },
    { from: 15, to: 16, handle: "trigger" },
    { from: 15, to: 17, handle: "trigger" },
    { from: 18, to: 19, handle: "trigger" },
    { from: 18, to: 20, handle: "trigger" }
  ];
  return { nodes, edges };
}

// modules/waves/src/look.js
var FLASH = { seconds: 0.18, peak: 3.5 };
function flashLevel(age) {
  if (!(age >= 0) || age >= FLASH.seconds) return 0;
  return 1 - age / FLASH.seconds;
}
function coreGlow(fraction, floor = 0.15) {
  const f = Number.isFinite(fraction) ? Math.min(1, Math.max(0, fraction)) : 1;
  return floor + (1 - floor) * f;
}

// modules/waves/src/fx.js
function registerFx(api, engine) {
  const flashes = /* @__PURE__ */ new Map();
  const clock = () => typeof performance !== "undefined" ? performance.now() / 1e3 : 0;
  const enemyUuids = () => new Set(engine.all().flatMap((s) => s.enemies.map((e) => e.uuid)));
  if (typeof api.onHit === "function")
    api.onHit((hit) => {
      if (hit?.uuid && enemyUuids().has(hit.uuid)) flashes.set(hit.uuid, clock());
    });
  function paint(object, level) {
    object.traverse((mesh) => {
      const m = mesh.material;
      if (!mesh.isMesh || !m?.emissive || Array.isArray(m)) return;
      const base = m.userData.wvBase ??= { hex: m.emissive.getHex(), intensity: m.emissiveIntensity };
      if (base.hex !== 0) return;
      if (level > 0) {
        m.emissive.setHex(16777215);
        m.emissiveIntensity = FLASH.peak * level;
      } else {
        m.emissive.setHex(base.hex);
        m.emissiveIntensity = base.intensity;
      }
    });
  }
  api.registerFrameTask(() => {
    if (!flashes.size) return;
    const t = clock();
    for (const [uuid, at] of [...flashes]) {
      const object = api.objectsGroup()?.getObjectByProperty("uuid", uuid);
      const level = flashLevel(t - at);
      if (object) paint(object, level);
      if (level === 0) flashes.delete(uuid);
    }
  });
  api.registerEffect(
    "wavescore",
    (object, base, data, time) => {
      const m = object.material;
      if (m?.emissive && !Array.isArray(m)) {
        const full = m.userData.wvCore ??= m.emissiveIntensity || 1;
        m.emissiveIntensity = full * coreGlow(Number(data.value), Number(data.floor ?? 0.15));
      }
      const spin = Number(data.spin ?? 0.6);
      object.rotation.y = (base?.rot?.[1] ?? 0) + time * spin;
      object.position.y = (base?.pos?.[1] ?? object.position.y) + Math.sin(time * 1.3) * 0.08;
    },
    { inputs: { value: "number" } }
  );
  return { flashes };
}

// modules/waves/src/index.js
var index_default = {
  id: "waves",
  name: "Waves",
  version: "1.1.0",
  description: "Wave survival on the health module: enemies walk from spawn points to a goal, a wave ends when its last enemy dies, the run is over when the last wave does \u2014 derived on every peer, no authority.",
  /** @param {any} api the module SDK surface */
  register(api) {
    if (!api.flow?.addNodes || !api.game?.roundCutoff || !api.peerVars?.all || !api.registerValueNode) {
      api.toast("Waves needs a newer app build (the game SDK seams are missing)");
      return;
    }
    const engine = createWavesEngine(api);
    registerNodes(api, engine);
    const fx = registerFx(api, engine);
    const toolbox = registerToolbox(api, engine);
    api.hud.registerDebugLine(() => {
      const runs = engine.all();
      if (!runs.length) return null;
      return runs.map((s) => "waves (" + s.name + "): " + (s.done ? "cleared" : "wave " + s.wave + "/" + s.curve.waves + (s.running ? ", " + s.alive + " left" : ", idle"))).join(" \xB7 ");
    });
    api.hud.registerAction({
      key: "showwave",
      label: "Show the wave",
      group: "Data",
      role: "drives",
      node: "",
      via: { node: "wavesvalue", data: { name: DEFAULTS.name, read: "wave" }, handle: "value" },
      hint: "The current wave, derived from the enemies\u2019 hit counters on every peer."
    });
    api.hud.registerAction({
      key: "showleft",
      label: "Show enemies left",
      group: "Data",
      role: "drives",
      node: "",
      via: { node: "wavesvalue", data: { name: DEFAULTS.name, read: "left" }, handle: "value" },
      hint: "How many of this wave are still standing."
    });
    api.onSceneClear(() => engine.clear());
    if (typeof window !== "undefined")
      window.__waves = {
        api,
        engine,
        fx,
        toolbox,
        hud: arenaHud,
        hudGraph,
        snapshot: () => engine.all().map((s) => ({
          id: s.id,
          name: s.name,
          wave: s.wave,
          completed: s.completed,
          done: s.done,
          running: s.running,
          started: s.started,
          alive: s.alive,
          size: s.size,
          waves: s.curve.waves,
          waveStart: s.waveStart,
          goal: s.goal,
          spawns: s.spawns.length,
          enemies: s.enemies.map((e) => ({ uuid: e.uuid, label: e.label, hits: e.hits, heals: e.heals, kills: e.kills, hp: e.hp })),
          log: engine.runLog(s.name)
        }))
      };
  }
};
export {
  index_default as default
};
