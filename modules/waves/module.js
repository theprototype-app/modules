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
var KINDS = Object.freeze({
  grunt: Object.freeze({ speed: 1, knock: 0.55, points: 100 }),
  runner: Object.freeze({ speed: 1.8, knock: 0.8, points: 150 }),
  tank: Object.freeze({ speed: 0.6, knock: 0.16, points: 400 })
});
function kindOf(label) {
  const s = String(label ?? "");
  if (/runner/i.test(s)) return "runner";
  if (/tank/i.test(s)) return "tank";
  return "grunt";
}
function enemyPosition(p) {
  const speed = clamp(p.speed, 0.01, 100, DEFAULTS.speed);
  const stagger = clamp(p.stagger, 0, 60, DEFAULTS.stagger);
  const leave = p.waveStart + stagger * p.index;
  const t = p.slows?.length ? warpedElapsed(leave, p.now, p.slows) : p.now - leave;
  if (!(t > 0)) return p.start.slice();
  const dx = p.goal[0] - p.start[0];
  const dz = p.goal[2] - p.start[2];
  const dist = Math.hypot(dx, dz);
  if (dist < 1e-6) return p.start.slice();
  const along = Math.min(dist, Math.max(0, t * speed - Math.max(0, Number(p.setback) || 0)));
  const f = along / dist;
  return [p.start[0] + dx * f, p.start[1], p.start[2] + dz * f];
}
var SLOW_RATE = 0.4;
function warpedElapsed(from, to, slows, rate = SLOW_RATE) {
  if (!(to > from)) return to - from;
  const w = (slows ?? []).map((x) => [Math.max(from, Number(x.at)), Math.min(to, Number(x.until))]).filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b) && b > a).sort((a, b) => a[0] - b[0]);
  let slowed = 0;
  let end = -Infinity;
  for (const [a, b] of w) {
    const s = Math.max(a, end);
    if (b > s) slowed += b - s;
    end = Math.max(end, b);
  }
  return to - from - (1 - rate) * slowed;
}
function pushedBy(uuid, events, since, now) {
  let m = 0;
  for (const e of events ?? []) if (e?.k === "push" && e.at >= since && e.at <= now) m += Number(e.d?.[uuid]) || 0;
  return m;
}
function appendFx(held, round, event, cap = 40) {
  const list = held && typeof held === "object" && held.round === round && Array.isArray(held.ev) ? held.ev : [];
  return { round, ev: [...list, event].sort((a, b) => a.at - b.at).slice(-cap) };
}
function fxOf(held, round) {
  return held && typeof held === "object" && held.round === round && Array.isArray(held.ev) ? held.ev : [];
}
function setbackOf(hits, heals, max, knock) {
  const taken = Math.max(0, Math.min(max, (Number(hits) || 0) - (Number(heals) || 0)));
  return taken * Math.max(0, Number(knock) || 0);
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
var FX_PREFIX = "waves:fx:";
var toSeconds = (ms) => ms / 1e3 % 86400;
var KILLS_ROW = "kills";
var STASH_DEPTH = -30;
function createWavesEngine(api) {
  const state = /* @__PURE__ */ new Map();
  const waveSeen = /* @__PURE__ */ new Map();
  const doneSeen = /* @__PURE__ */ new Map();
  const runSeen = /* @__PURE__ */ new Map();
  const roundSeen = /* @__PURE__ */ new Map();
  const parked = /* @__PURE__ */ new Map();
  const healExpected = /* @__PURE__ */ new Map();
  const listeners = /* @__PURE__ */ new Set();
  const hitExpected = /* @__PURE__ */ new Map();
  const seenHits = /* @__PURE__ */ new Map();
  const announcedKills = /* @__PURE__ */ new Map();
  const stashed = /* @__PURE__ */ new Set();
  const enemyListeners = /* @__PURE__ */ new Set();
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
      const damageId = damageCounters.flatMap((c) => into(g, c, "pulse").filter((id) => g.byId.get(id)?.type === "damage"))[0] ?? null;
      const label = object?.name || (uuid ? uuid.slice(0, 8) + "\u2026" : "(no target)");
      out.push({
        healthId: node.id,
        uuid,
        label,
        kind: kindOf(label),
        damageId,
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
    const fx = running ? fxOf(api.game.getVar(FX_PREFIX + name, null), round) : [];
    return {
      fx,
      slows: fx.filter((e) => e?.k === "slow"),
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
  const hitsOf = (e) => Math.max(e.hits, hitExpected.get(e.healthId) ?? 0);
  function stash(object, to) {
    object.position.fromArray(to);
  }
  function moveSweep(s) {
    const used = usedIn(s.wave, s.curve);
    const kills = s.enemies.map((e) => killsOf(hitsOf(e), e.max));
    const alive = new Set(aliveIn(s.wave, kills, s.curve));
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
        const kind = KINDS[e.kind] ?? KINDS.grunt;
        object.position.fromArray(
          enemyPosition({
            start,
            goal: (
              /** @type {number[]} */
              s.goal
            ),
            waveStart: s.waveStart,
            index,
            now: now(),
            speed: s.speed * kind.speed,
            stagger: s.stagger,
            setback: setbackOf(hitsOf(e), e.heals, e.max, kind.knock) + pushedBy(e.uuid, s.fx, s.waveStart, now()),
            slows: s.slows
          })
        );
        e.pos = object.position.toArray();
      } else if (!s.running) {
        object.position.fromArray(home);
      } else if (index >= 0 && alive.has(k)) {
        object.position.fromArray(spawnFor(index, s.spawns, home));
      } else {
        stash(object, [home[0], STASH_DEPTH, home[2]]);
        if (index < 0 && object.visible) {
          object.visible = false;
          stashed.add(e.uuid);
        }
      }
      if (index >= 0 && stashed.has(e.uuid)) {
        object.visible = true;
        stashed.delete(e.uuid);
      }
      object.updateMatrixWorld?.();
    }
    if (!s.running) {
      for (const e of s.enemies) {
        parked.delete(e.uuid);
        if (stashed.has(e.uuid)) {
          const object = objectOf(e.uuid);
          if (object) object.visible = true;
          stashed.delete(e.uuid);
        }
      }
    }
  }
  function targets() {
    const out = [];
    for (const s of state.values()) {
      if (!s.running) continue;
      const used = usedIn(s.wave, s.curve);
      for (const k of used) {
        const e = s.enemies[k];
        if (!e?.damageId || !e.uuid) continue;
        const hp = e.max - Math.max(0, hitsOf(e) - e.heals);
        if (hp <= 0) continue;
        out.push({ ...e, hp, runId: s.id, walking: s.started });
      }
    }
    return out;
  }
  function hit(uuid, n) {
    const e = targets().find((x) => x.uuid === uuid);
    if (!e) return null;
    const landed = Math.max(0, Math.min(Math.floor(n), e.hp));
    if (!landed) return null;
    for (let i = 0; i < landed; i++) api.fireNodeTrigger("damage", (_d, id) => id === e.damageId);
    hitExpected.set(e.healthId, hitsOf(e) + landed);
    const killed = landed >= e.hp;
    const pos = objectOf(uuid)?.getWorldPosition(new api.THREE.Vector3()).toArray() ?? e.pos ?? [0, 0, 0];
    if (killed) {
      api.peerVars.setMine(KILLS_ROW, api.peerVars.mine(KILLS_ROW, 0) + 1);
      const kills = killsOf(hitsOf(e), e.max);
      announcedKills.set(uuid, kills);
      emitEnemy({ kind: "death", uuid, pos, enemy: e, mine: true });
    } else emitEnemy({ kind: "hurt", uuid, pos, enemy: e, mine: true });
    const seen = seenHits.get(uuid);
    if (seen) seenHits.set(uuid, { hits: hitsOf(e), kills: killsOf(hitsOf(e), e.max) });
    return { landed, killed, enemy: e };
  }
  function addFx(event) {
    const s = [...state.values()].find((x) => x.running);
    if (!s || typeof s.round !== "number") return false;
    const key = FX_PREFIX + s.name;
    api.game.setVar(key, appendFx(api.game.getVar(key, null), s.round, event));
    s.fx = fxOf(api.game.getVar(key, null), s.round);
    s.slows = s.fx.filter((e) => e?.k === "slow");
    return true;
  }
  function emitEnemy(ev) {
    for (const fn of enemyListeners) {
      try {
        fn(ev);
      } catch (error) {
        console.warn("[waves] enemy listener failed", error);
      }
    }
  }
  function hurtSweep(s) {
    for (const e of s.enemies) {
      if (!e.uuid) continue;
      const hits = hitsOf(e);
      const kills = killsOf(hits, e.max);
      const prev = seenHits.get(e.uuid);
      seenHits.set(e.uuid, { hits, kills });
      if (!prev || !s.running || hits <= prev.hits) continue;
      const pos = objectOf(e.uuid)?.getWorldPosition(new api.THREE.Vector3()).toArray() ?? e.pos ?? [0, 0, 0];
      if (kills > prev.kills) {
        if ((announcedKills.get(e.uuid) ?? -1) >= kills) continue;
        announcedKills.set(e.uuid, kills);
        emitEnemy({ kind: "death", uuid: e.uuid, pos, enemy: e, mine: false });
      } else emitEnemy({ kind: "hurt", uuid: e.uuid, pos, enemy: e, mine: false });
    }
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
      hurtSweep(s);
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
        const shot = hitExpected.get(e.healthId);
        if (shot !== void 0 && (e.hits >= shot || e.hits === 0 && !s.running)) hitExpected.delete(e.healthId);
      }
    for (const fn of listeners) fn();
  }
  let lastSweep = -1;
  api.registerFrameTask(() => {
    const t = performance.now() / 1e3;
    if (t - lastSweep >= SWEEP) {
      lastSweep = t;
      try {
        sweep();
      } catch (error) {
        console.warn("[waves] sweep failed", error);
      }
    }
    try {
      for (const s of state.values()) moveSweep(s);
    } catch (error) {
      console.warn("[waves] walk failed", error);
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
    hitExpected.clear();
    seenHits.clear();
    announcedKills.clear();
    stashed.clear();
  }
  return {
    state,
    stateOf: (id) => state.get(id) ?? null,
    read,
    all: () => [...state.values()],
    graphView,
    runLog,
    sweep,
    targets,
    hit,
    addFx,
    /** @param {(e: {kind: 'hurt' | 'death', uuid: string, pos: number[], enemy: any, mine: boolean}) => void} fn */
    onEnemy: (fn) => {
      enemyListeners.add(fn);
      return () => enemyListeners.delete(fn);
    },
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
var PLAYER_READS = ["ability", "heat"];
function registerNodes(api, engine, player = {}) {
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
        // 30b: THIS player's gun and ability, for the HUD's bars (a local value: each
        // peer shows its own charge and heat)
        type: "wavesplayer",
        label: "Waves Player",
        defaults: { read: "ability" },
        params: [{ key: "read", kind: "select", options: PLAYER_READS }]
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
  api.registerValueNode(
    "wavesplayer",
    (data) => {
      const fn = player[String(data?.read ?? "ability")];
      return typeof fn === "function" ? Number(fn()) || 0 : 0;
    },
    { vtype: "number" }
  );
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
var POP_COLOR = { grunt: 16747100, runner: 14221130, tank: 11563263 };
function registerFx(api, engine, juice = null, feel = null) {
  const flashes = /* @__PURE__ */ new Map();
  const clock = () => typeof performance !== "undefined" ? performance.now() / 1e3 : 0;
  const enemyUuids = () => new Set(engine.all().flatMap((s) => s.enemies.map((e) => e.uuid)));
  if (typeof api.onHit === "function")
    api.onHit((hit) => {
      if (hit?.uuid && enemyUuids().has(hit.uuid)) flashes.set(hit.uuid, clock());
    });
  engine.onEnemy((ev) => {
    flashes.set(ev.uuid, clock());
    if (ev.kind === "death") {
      juice?.pop(
        ev.pos,
        /** @type {any} */
        POP_COLOR[ev.enemy?.kind] ?? POP_COLOR.grunt
      );
      feel?.sound("explosion", ev.pos);
    } else feel?.sound("hurt", ev.pos);
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

// modules/waves/src/board.js
var W = 1.6;
var H = 0.9;
var PX = 640;
function createBoard(api) {
  const THREE = api.THREE;
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(W * PX);
  canvas.height = Math.round(H * PX);
  const ctx = (
    /** @type {CanvasRenderingContext2D} */
    canvas.getContext("2d")
  );
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, toneMapped: false, depthWrite: false, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(W, H), material);
  mesh.name = "Waves board face";
  mesh.renderOrder = 10;
  const group = new THREE.Group();
  group.name = "Waves board";
  group.visible = false;
  group.add(mesh);
  let key = "";
  function draw(card) {
    const next = JSON.stringify(card);
    if (next === key) return;
    key = next;
    const w = canvas.width;
    const h = canvas.height;
    const accent = card.color ?? "#ff9c6b";
    ctx.clearRect(0, 0, w, h);
    roundRect(ctx, 8, 8, w - 16, h - 16, 44);
    ctx.fillStyle = "rgba(22, 18, 28, 0.9)";
    ctx.fill();
    ctx.lineWidth = 6;
    ctx.strokeStyle = "rgba(255, 140, 100, 0.55)";
    ctx.stroke();
    ctx.fillStyle = accent;
    roundRect(ctx, 8, 8, w - 16, 18, 9);
    ctx.fill();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = accent;
    ctx.font = "800 112px system-ui, sans-serif";
    ctx.fillText(card.title, w / 2, 120);
    ctx.fillStyle = "#efe6e6";
    ctx.font = "500 36px system-ui, sans-serif";
    (card.lines ?? []).slice(0, 4).forEach((line, i) => ctx.fillText(line, w / 2, 222 + i * 50));
    if (card.button) {
      const bw = w * 0.62;
      const bh = 104;
      const bx = (w - bw) / 2;
      const by = h - bh - 44;
      roundRect(ctx, bx, by, bw, bh, 30);
      ctx.fillStyle = "#d9533f";
      ctx.fill();
      ctx.lineWidth = 4;
      ctx.strokeStyle = "#ffd0c0";
      ctx.stroke();
      ctx.fillStyle = "#ffffff";
      ctx.font = "800 50px system-ui, sans-serif";
      ctx.fillText(card.button, w / 2, by + bh / 2 + 2);
    }
    texture.needsUpdate = true;
  }
  const _m = new THREE.Matrix4();
  const _p = new THREE.Vector3();
  const _q = new THREE.Quaternion();
  const _s = new THREE.Vector3();
  function placeFacing(at, yaw) {
    const world = new THREE.Matrix4().compose(new THREE.Vector3(at[0], at[1], at[2]), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw), new THREE.Vector3(1, 1, 1));
    const parent = group.parent;
    if (parent) {
      parent.updateMatrixWorld?.(true);
      _m.copy(parent.matrixWorld).invert().multiply(world);
    } else _m.copy(world);
    _m.decompose(_p, _q, _s);
    group.position.copy(_p);
    group.quaternion.copy(_q);
    group.scale.copy(_s);
    group.updateMatrixWorld(true);
  }
  function rect() {
    group.updateMatrixWorld(true);
    const center = new THREE.Vector3().setFromMatrixPosition(mesh.matrixWorld);
    const normal = new THREE.Vector3(0, 0, 1).transformDirection(mesh.matrixWorld);
    const right = new THREE.Vector3(1, 0, 0).transformDirection(mesh.matrixWorld);
    const scale = new THREE.Vector3().setFromMatrixScale(mesh.matrixWorld);
    return { center: center.toArray(), normal: normal.toArray(), right: right.toArray(), w: W * scale.x, h: H * scale.y };
  }
  return {
    group,
    rect,
    draw,
    placeFacing,
    show: (on) => {
      group.visible = !!on;
    },
    visible: () => group.visible,
    dispose: () => {
      group.parent?.remove(group);
      mesh.geometry.dispose();
      material.dispose();
      texture.dispose();
    }
  };
}
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// modules/waves/src/vr.js
function rotate(q, v) {
  const [qx, qy, qz, qw] = q;
  const [vx, vy, vz] = v;
  const tx = 2 * (qy * vz - qz * vy);
  const ty = 2 * (qz * vx - qx * vz);
  const tz = 2 * (qx * vy - qy * vx);
  return [vx + qw * tx + (qy * tz - qz * ty), vy + qw * ty + (qz * tx - qx * tz), vz + qw * tz + (qx * ty - qy * tx)];
}
function aimRay(hand) {
  return { origin: hand.position.slice(0, 3), dir: rotate(hand.quaternion, [0, 0, -1]) };
}
function yawOf(dir) {
  return Math.atan2(-dir[0], -dir[2]);
}
function rayRect(ray, rect) {
  const d = ray.dir;
  const n = rect.normal;
  const denom = d[0] * n[0] + d[1] * n[1] + d[2] * n[2];
  if (Math.abs(denom) < 1e-6) return null;
  const o = ray.origin;
  const c = rect.center;
  const t = ((c[0] - o[0]) * n[0] + (c[1] - o[1]) * n[1] + (c[2] - o[2]) * n[2]) / denom;
  if (!(t > 0)) return null;
  const p = [o[0] + d[0] * t - c[0], o[1] + d[1] * t - c[1], o[2] + d[2] * t - c[2]];
  const r = rect.right;
  const up = [n[1] * r[2] - n[2] * r[1], n[2] * r[0] - n[0] * r[2], n[0] * r[1] - n[1] * r[0]];
  const u = (p[0] * r[0] + p[1] * r[1] + p[2] * r[2]) / rect.w;
  const v = (p[0] * up[0] + p[1] * up[1] + p[2] * up[2]) / rect.h;
  if (Math.abs(u) > 0.5 || Math.abs(v) > 0.5) return null;
  return { t, u, v };
}
function createEdges() {
  const prev = /* @__PURE__ */ new Map();
  return {
    /** @param {string} key @param {boolean} down */
    edge(key, down) {
      const was = prev.get(key) === true;
      prev.set(key, !!down);
      return !!down && !was;
    },
    /** @param {string} key @param {boolean} down  true on the frame `down` goes false */
    release(key, down) {
      const was = prev.get(key) === true;
      prev.set(key, !!down);
      return !down && was;
    },
    clear() {
      prev.clear();
    }
  };
}
function inGame(api) {
  if (api.isPlaying?.()) return true;
  return typeof api.editorMode === "function" && api.editorMode() === "interact";
}

// modules/waves/src/start.js
var START_ELEMENT = "wv-start";
var DISTANCE = 2.4;
var DEBOUNCE = 1.2;
function registerStart(api, root) {
  const board = createBoard(api);
  root.add(board.group);
  const edges = createEdges();
  let pressedAt = -Infinity;
  let placed = false;
  const hands = () => ["right", "left"].map((hand) => ({ hand, snap: api.vrHand?.(hand) ?? null }));
  const hasStart = () => api.flow.nodes("hudbutton").some((n) => String(n.data?.element ?? "") === START_ELEMENT);
  function press() {
    const t = performance.now() / 1e3;
    if (t - pressedAt < DEBOUNCE) return false;
    pressedAt = t;
    api.fireNodeTrigger("hudbutton", (d) => String(d?.element ?? "") === START_ELEMENT);
    api.hapticPattern ? api.hapticPattern("success") : api.haptic?.(0.6, 80);
    api.playSound?.(api.music ? "portal" : "ding");
    return true;
  }
  function place() {
    const head = api.playerPosition?.() ?? [0, 1.6, 0];
    const tracked = hands().filter((h) => h.snap?.position && h.snap?.quaternion);
    let yaw = 0;
    if (tracked.length) {
      const d = aimRay(
        /** @type {any} */
        tracked[0].snap
      ).dir;
      yaw = yawOf([d[0], 0, d[2]]);
    }
    const at = [head[0] - Math.sin(yaw) * DISTANCE, head[1] + 0.15, head[2] - Math.cos(yaw) * DISTANCE];
    board.placeFacing(at, yaw);
    placed = true;
  }
  const running = () => {
    const cutoff = api.game.roundCutoff();
    return typeof cutoff === "number" && Number.isFinite(cutoff) && api.game.roundUnderway();
  };
  function frame() {
    const want = !!api.isVR?.() && inGame(api) && !running() && hasStart();
    if (!want) {
      if (board.visible()) board.show(false);
      placed = false;
      edges.clear();
      return;
    }
    board.draw({ title: "WAVES", lines: ["Hold the crystal against the waves.", "Aim a controller here and pull the trigger."], button: "SHOOT TO START" });
    if (!placed) place();
    board.show(true);
    const rect = board.rect();
    for (const { hand, snap } of hands()) {
      if (!snap?.position || !snap?.quaternion) continue;
      const pulled = edges.edge("trigger-" + hand, !!snap.trigger);
      if (pulled && rayRect(aimRay(snap), rect)) press();
    }
  }
  api.registerFrameTask(() => {
    try {
      frame();
    } catch (error) {
      console.warn("[waves] start board failed", error);
    }
  });
  return { board, press, hasStart, visible: () => board.visible() };
}

// modules/waves/src/juice.js
var TRACER_LIFE = 0.09;
var FLASH_LIFE = 0.06;
var POP_LIFE = 0.38;
var SHARD_LIFE = 0.55;
function createJuice(api, root) {
  const THREE = api.THREE;
  const group = new THREE.Group();
  group.name = "Waves juice";
  root.add(group);
  const clock = () => performance.now() / 1e3;
  const unit = new THREE.BoxGeometry(1, 1, 1);
  unit.translate(0, 0, -0.5);
  const ball = new THREE.IcosahedronGeometry(1, 1);
  const star = new THREE.PlaneGeometry(1, 1);
  const glow = (color, opacity = 1) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
  const live = [];
  const drawn = (
    /** @type {Record<string, number>} */
    {}
  );
  const pool = /* @__PURE__ */ new Map();
  function take(kind, make) {
    const list = pool.get(kind) ?? [];
    const mesh = list.pop() ?? make();
    if (!mesh.parent) group.add(mesh);
    mesh.visible = true;
    drawn[kind] = (drawn[kind] ?? 0) + 1;
    return mesh;
  }
  const _a = new THREE.Vector3();
  const _b = new THREE.Vector3();
  const local = (p) => group.worldToLocal(new THREE.Vector3(p[0], p[1], p[2]));
  function tracer(from, to, color, width = 0.018) {
    const mesh = take("tracer", () => new THREE.Mesh(unit, glow(color, 0.95)));
    mesh.material.color.setHex(color);
    mesh.material.opacity = 0.95;
    place(mesh, from, to, width);
    live.push({ mesh, born: clock(), life: TRACER_LIFE, kind: "tracer" });
  }
  function place(mesh, from, to, width) {
    group.updateMatrixWorld(true);
    _a.set(from[0], from[1], from[2]);
    _b.set(to[0], to[1], to[2]);
    const len = Math.max(1e-3, _a.distanceTo(_b));
    mesh.position.copy(local(from));
    mesh.lookAt(_a.clone().multiplyScalar(2).sub(_b));
    mesh.scale.set(width, width, len);
  }
  function flash(at, color) {
    const mesh = take("flash", () => {
      const m = new THREE.Group();
      const a = new THREE.Mesh(star, glow(16777215, 1));
      const b = new THREE.Mesh(star, glow(16777215, 1));
      b.rotation.y = Math.PI / 2;
      const c = new THREE.Mesh(ball, glow(16777215, 0.9));
      c.scale.setScalar(0.35);
      m.add(a, b, c);
      return m;
    });
    mesh.children.forEach((c) => c.material.color.setHex(color));
    mesh.position.copy(local(at));
    mesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, 0);
    mesh.scale.setScalar(0.09);
    live.push({ mesh, born: clock(), life: FLASH_LIFE, kind: "flash" });
  }
  function spark(at, color) {
    const mesh = take("spark", () => new THREE.Mesh(ball, glow(16777215, 1)));
    mesh.material.color.setHex(color);
    mesh.position.copy(local(at));
    mesh.scale.setScalar(0.06);
    live.push({ mesh, born: clock(), life: 0.12, kind: "spark" });
  }
  function pop(at, color) {
    const core = take("pop", () => new THREE.Mesh(ball, glow(16777215, 1)));
    core.material.color.setHex(color);
    core.material.opacity = 1;
    core.position.copy(local(at));
    core.scale.setScalar(0.1);
    live.push({ mesh: core, born: clock(), life: POP_LIFE, kind: "pop" });
    for (let i = 0; i < 10; i++) {
      const shard = take("shard", () => new THREE.Mesh(unit, glow(16777215, 1)));
      shard.material.color.setHex(i % 2 ? color : 16765088);
      shard.material.opacity = 1;
      shard.position.copy(local(at));
      shard.scale.set(0.05, 0.05, 0.12);
      shard.rotation.set(Math.random() * 6, Math.random() * 6, 0);
      const a = i / 10 * Math.PI * 2 + Math.random() * 0.4;
      const up = 2.2 + Math.random() * 2.2;
      const out = 1.8 + Math.random() * 2;
      live.push({ mesh: shard, born: clock(), life: SHARD_LIFE, kind: "shard", vel: new THREE.Vector3(Math.cos(a) * out, up, Math.sin(a) * out) });
    }
    api.effects?.burst?.(at, { kind: "sparks", color: "#" + color.toString(16).padStart(6, "0"), count: 24 });
    api.effects?.burst?.(at, { kind: "smoke", count: 10 });
  }
  const beams = /* @__PURE__ */ new Map();
  function beam(hand, from, to, color, heat = 0) {
    let mesh = beams.get(hand);
    if (!from || !to) {
      if (mesh) mesh.visible = false;
      return;
    }
    if (!mesh) {
      mesh = new THREE.Group();
      mesh.add(new THREE.Mesh(unit, glow(color, 0.9)));
      const outer = new THREE.Mesh(unit, glow(color, 0.25));
      outer.scale.set(3, 3, 1);
      mesh.add(outer);
      group.add(mesh);
      beams.set(hand, mesh);
    }
    mesh.visible = true;
    const c = new THREE.Color(color).lerp(new THREE.Color(16724e3), Math.max(0, Math.min(1, heat)));
    mesh.children.forEach((m) => m.material.color.copy(c));
    const w = 0.012 + 6e-3 * Math.sin(clock() * 60);
    place(mesh, from, to, w);
  }
  let lastT = clock();
  function frame() {
    const t = clock();
    const dt = Math.min(0.05, t - lastT);
    lastT = t;
    for (let i = live.length - 1; i >= 0; i--) {
      const p = live[i];
      const age = (t - p.born) / p.life;
      if (age >= 1) {
        p.mesh.visible = false;
        (pool.get(p.kind) ?? pool.set(p.kind, []).get(p.kind))?.push(p.mesh);
        live.splice(i, 1);
        continue;
      }
      if (p.kind === "tracer") p.mesh.material.opacity = 0.95 * (1 - age);
      else if (p.kind === "flash") p.mesh.scale.setScalar(0.09 + 0.05 * age);
      else if (p.kind === "spark") p.mesh.scale.setScalar(0.06 + 0.1 * age);
      else if (p.kind === "pop") {
        p.mesh.scale.setScalar(0.12 + 0.9 * Math.sqrt(age));
        p.mesh.material.opacity = 1 - age;
      } else if (p.kind === "shard" && p.vel) {
        p.vel.y -= 9.8 * dt;
        p.mesh.position.addScaledVector(p.vel, dt);
        p.mesh.rotation.x += dt * 9;
        p.mesh.material.opacity = 1 - age;
      }
    }
  }
  return { group, tracer, flash, spark, pop, beam, frame, live: () => live.length, drawn: () => ({ ...drawn }) };
}

// modules/waves/src/guns.js
var GUNS = Object.freeze({
  blaster: Object.freeze({ id: "blaster", name: "Blaster", mode: "semi", refire: 0.16, damage: 1, pellets: 1, spread: 0, range: 60, color: 3793151, sound: "shoot", blurb: "Semi-auto. One precise bolt per pull." }),
  scatter: Object.freeze({ id: "scatter", name: "Scatter", mode: "spread", refire: 0.85, damage: 1, pellets: 7, spread: 0.075, range: 28, color: 16752704, sound: "shoot", blurb: "Seven pellets in a cone. Slow, brutal up close." }),
  beam: Object.freeze({ id: "beam", name: "Beam", mode: "beam", refire: 0.12, damage: 1, pellets: 1, spread: 0, range: 40, color: 16732120, sound: "laser", heatPerSecond: 0.42, coolPerSecond: 0.55, lockUntil: 0.35, blurb: "Hold to burn. Overheats \u2014 let it cool." })
});
var GUN_IDS = Object.freeze(Object.keys(GUNS));
function gunOf(id) {
  return (
    /** @type {any} */
    GUNS[String(id)] ?? GUNS.blaster
  );
}
function trigger(gun, s, input) {
  const dt = Math.max(0, Math.min(0.25, input.t - (Number.isFinite(s.at) ? s.at : input.t)));
  let { last, heat, locked } = s;
  let fire = false;
  if (gun.mode === "beam") {
    const want = input.held && !locked;
    if (want) {
      heat = Math.min(1, heat + (gun.heatPerSecond ?? 0.4) * dt);
      if (heat >= 1) locked = true;
      if (!locked && input.t - last >= gun.refire) fire = true;
    } else heat = Math.max(0, heat - (gun.coolPerSecond ?? 0.5) * dt);
    if (locked && heat <= (gun.lockUntil ?? 0.35)) locked = false;
  } else {
    heat = 0;
    locked = false;
    if (input.pressed && input.t - last >= gun.refire) fire = true;
  }
  if (fire) last = input.t;
  return { fire, state: { last, heat, locked, at: input.t } };
}
var idleHand = () => ({ last: -Infinity, heat: 0, locked: false, at: NaN });
function pelletDirs(dir, pellets, spread, twist = 0) {
  if (pellets <= 1 || !(spread > 0)) return [dir.slice(0, 3)];
  const up = Math.abs(dir[1]) < 0.95 ? [0, 1, 0] : [1, 0, 0];
  const a = norm(cross(dir, up));
  const b = cross(a, dir);
  const out = [dir.slice(0, 3)];
  const ring = pellets - 1;
  for (let i = 0; i < ring; i++) {
    const ang = twist + i / ring * Math.PI * 2;
    const r = Math.tan(spread) * (i % 2 ? 0.6 : 1);
    out.push(norm([dir[0] + (a[0] * Math.cos(ang) + b[0] * Math.sin(ang)) * r, dir[1] + (a[1] * Math.cos(ang) + b[1] * Math.sin(ang)) * r, dir[2] + (a[2] * Math.cos(ang) + b[2] * Math.sin(ang)) * r]));
  }
  return out;
}
function cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function norm(v) {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}
function gunHands(hand) {
  if (hand === "left") return ["left"];
  if (hand === "both") return ["right", "left"];
  return ["right"];
}
function abilityHand(hand) {
  return hand === "left" ? "right" : "left";
}

// modules/waves/src/prefs.js
var ABILITY_IDS = Object.freeze(["shield", "slowmo", "pulse"]);
var HANDS = Object.freeze(["right", "left", "both"]);
var MUSIC = Object.freeze(["off", "low", "high"]);
var DEFAULT_PREFS = Object.freeze({ gun: "blaster", ability: "pulse", hand: "right", sfx: true, music: "low", haptics: true });
var KEY = "prefs";
function normalize(raw) {
  const r = raw && typeof raw === "object" ? raw : {};
  return {
    gun: GUN_IDS.includes(r.gun) ? r.gun : DEFAULT_PREFS.gun,
    ability: ABILITY_IDS.includes(r.ability) ? r.ability : DEFAULT_PREFS.ability,
    hand: HANDS.includes(r.hand) ? r.hand : DEFAULT_PREFS.hand,
    sfx: typeof r.sfx === "boolean" ? r.sfx : DEFAULT_PREFS.sfx,
    music: MUSIC.includes(r.music) ? r.music : DEFAULT_PREFS.music,
    haptics: typeof r.haptics === "boolean" ? r.haptics : DEFAULT_PREFS.haptics
  };
}
function createPrefs(api) {
  let prefs = normalize(api.storage?.get?.(KEY, null));
  const listeners = /* @__PURE__ */ new Set();
  return {
    get: () => prefs,
    /** @param {Partial<typeof DEFAULT_PREFS>} patch */
    set(patch) {
      prefs = normalize({ ...prefs, ...patch });
      api.storage?.set?.(KEY, prefs);
      for (const fn of listeners) fn(prefs);
      return prefs;
    },
    /** @param {(p: typeof DEFAULT_PREFS) => void} fn */
    onChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    }
  };
}

// modules/waves/src/feel.js
var HAPTIC_FALLBACK = Object.freeze({ tap: [0.2, 18], bump: [0.45, 35], hit: [0.8, 70], success: [0.6, 120], fail: [0.7, 160], rumble: [0.5, 220], heartbeat: [0.5, 90] });
var hasGameSounds = (api) => !!api.music && typeof api.music.play === "function";
function createFeel(api, prefs) {
  return {
    /** @param {string} name @param {number[]=} at */
    sound(name, at) {
      if (!prefs.get().sfx || !hasGameSounds(api)) return;
      api.playSound?.(name, at);
    },
    /** @param {string} pattern @param {string=} hand 'right' | 'left' ('desk' and absent buzz nothing / both) */
    haptic(pattern, hand) {
      if (!prefs.get().haptics || hand === "desk") return;
      if (typeof api.hapticPattern === "function") api.hapticPattern(pattern, hand);
      else {
        const [i, ms] = (
          /** @type {any} */
          HAPTIC_FALLBACK[pattern] ?? [0.4, 40]
        );
        api.haptic?.(i, ms, hand);
      }
    }
  };
}

// modules/waves/src/models.js
function buildGun(THREE, id, accent) {
  const g = new THREE.Group();
  g.name = "Waves gun " + id;
  const body = new THREE.MeshStandardMaterial({ color: 2830394, roughness: 0.42, metalness: 0.55 });
  const dark = new THREE.MeshStandardMaterial({ color: 1382172, roughness: 0.7, metalness: 0.2 });
  const glow = new THREE.MeshStandardMaterial({ color: accent, emissive: accent, emissiveIntensity: 2.2, roughness: 0.3 });
  const add = (geo, mat, pos, rot) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.fromArray(pos);
    if (rot) m.rotation.set(rot[0], rot[1], rot[2]);
    m.castShadow = false;
    m.receiveShadow = false;
    g.add(m);
    return m;
  };
  const barrel = (r, len) => new THREE.CylinderGeometry(r, r, len, 14).rotateX(Math.PI / 2);
  let tip = -0.24;
  if (id === "scatter") {
    add(new THREE.BoxGeometry(0.075, 0.07, 0.2), body, [0, 0.03, -0.07]);
    add(barrel(0.018, 0.2), dark, [-0.021, 0.045, -0.2]);
    add(barrel(0.018, 0.2), dark, [0.021, 0.045, -0.2]);
    add(new THREE.BoxGeometry(0.09, 0.03, 0.08), body, [0, 0.01, -0.2]);
    add(new THREE.BoxGeometry(0.08, 0.012, 0.16), glow, [0, 0.068, -0.08]);
    tip = -0.3;
  } else if (id === "beam") {
    add(new THREE.CylinderGeometry(0.036, 0.042, 0.2, 18).rotateX(Math.PI / 2), body, [0, 0.035, -0.08]);
    for (const z of [-0.05, -0.1, -0.15]) add(new THREE.TorusGeometry(0.043, 8e-3, 8, 20), glow, [0, 0.035, z]);
    add(barrel(0.014, 0.1), dark, [0, 0.035, -0.22]);
    add(new THREE.SphereGeometry(0.02, 12, 10), glow, [0, 0.035, -0.27]);
    tip = -0.28;
  } else {
    add(new THREE.BoxGeometry(0.05, 0.065, 0.18), body, [0, 0.03, -0.06]);
    add(barrel(0.014, 0.14), dark, [0, 0.042, -0.19]);
    add(new THREE.BoxGeometry(0.056, 0.012, 0.12), glow, [0, 0.066, -0.06]);
    add(new THREE.TorusGeometry(0.018, 5e-3, 8, 16), glow, [0, 0.042, -0.25]);
  }
  add(new THREE.BoxGeometry(0.04, 0.1, 0.045), dark, [0, -0.03, 0.01], [0.35, 0, 0]);
  add(new THREE.TorusGeometry(0.022, 5e-3, 6, 12, Math.PI), dark, [0, -5e-3, -0.035], [0, Math.PI / 2, 0]);
  const muzzle = new THREE.Object3D();
  muzzle.name = "muzzle";
  muzzle.position.set(0, id === "scatter" ? 0.045 : id === "beam" ? 0.035 : 0.042, tip);
  g.add(muzzle);
  g.userData.muzzle = muzzle;
  g.userData.glow = glow;
  g.userData.accent = accent;
  return g;
}

// modules/waves/src/weapon.js
var GRIP_OFFSET = [0, -0.035, 0.05];
function registerWeapon(api, engine, root, juice, prefs, feel) {
  const THREE = api.THREE;
  const edges = createEdges();
  const hands = /* @__PURE__ */ new Map();
  const clock = () => performance.now() / 1e3;
  const stats = { shots: 0, hits: 0, kills: 0, lastShot: (
    /** @type {any} */
    null
  ) };
  function handOf(hand) {
    const id = prefs.get().gun;
    let h = hands.get(hand);
    if (!h || h.gun !== id) {
      if (h) {
        h.model.parent?.remove(h.model);
        juice.beam(hand, null, null, 0);
      }
      const gun = gunOf(id);
      const model = buildGun(
        THREE,
        /** @type {any} */
        gun.id,
        gun.color
      );
      model.visible = false;
      root.add(model);
      h = { model, gun: gun.id, state: idleHand(), kick: 0, holding: false, lastSound: -Infinity };
      hands.set(hand, h);
    }
    return h;
  }
  const mouse = { down: false, pressed: false };
  if (typeof window !== "undefined") {
    const onDown = (e) => {
      if (e.button !== 0) return;
      const target = (
        /** @type {any} */
        e.target
      );
      if (!document.pointerLockElement && target?.tagName !== "CANVAS") return;
      mouse.down = true;
      mouse.pressed = true;
    };
    const onUp = (e) => {
      if (e.button === 0) mouse.down = false;
    };
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("pointerup", onUp, true);
    window.addEventListener("blur", () => mouse.down = false);
  }
  const running = () => {
    const cutoff = api.game.roundCutoff();
    return typeof cutoff === "number" && Number.isFinite(cutoff) && api.game.roundUnderway();
  };
  const _m = new THREE.Matrix4();
  const _p = new THREE.Vector3();
  const _q = new THREE.Quaternion();
  const _s = new THREE.Vector3();
  function setWorld(object, world) {
    const parent = object.parent;
    if (parent) {
      parent.updateMatrixWorld?.(true);
      _m.copy(parent.matrixWorld).invert().multiply(world);
    } else _m.copy(world);
    _m.decompose(_p, _q, _s);
    object.position.copy(_p);
    object.quaternion.copy(_q);
    object.scale.copy(_s);
    object.updateMatrixWorld(true);
  }
  function handMatrix(snap, kick) {
    const q = new THREE.Quaternion().fromArray(snap.quaternion);
    const offset = new THREE.Vector3(GRIP_OFFSET[0], GRIP_OFFSET[1], GRIP_OFFSET[2] + kick).applyQuaternion(q);
    const p = new THREE.Vector3().fromArray(snap.position).add(offset);
    return new THREE.Matrix4().compose(p, q, new THREE.Vector3(1, 1, 1));
  }
  function deskMatrix(ray, kick) {
    const d = ray.direction.clone().normalize();
    const right = new THREE.Vector3().crossVectors(d, new THREE.Vector3(0, 1, 0));
    if (right.lengthSq() < 1e-6) right.set(1, 0, 0);
    right.normalize();
    const up = new THREE.Vector3().crossVectors(right, d).normalize();
    const p = ray.origin.clone().addScaledVector(d, 0.46 - kick).addScaledVector(right, 0.17).addScaledVector(up, -0.15);
    const basis = new THREE.Matrix4().makeBasis(right, up, d.clone().negate());
    return new THREE.Matrix4().compose(p, new THREE.Quaternion().setFromRotationMatrix(basis), new THREE.Vector3(1, 1, 1));
  }
  const raycaster = new THREE.Raycaster();
  const shown = (o) => {
    for (let c = o; c; c = c.parent) if (c.visible === false) return false;
    return true;
  };
  function cast(origin, dir, range, targets) {
    const group = api.objectsGroup();
    const o = new THREE.Vector3().fromArray(origin);
    const d = new THREE.Vector3().fromArray(dir).normalize();
    raycaster.set(o, d);
    raycaster.near = 0.05;
    raycaster.far = range;
    const found = group ? raycaster.intersectObjects(group.children, true) : [];
    for (const x of found) {
      if (!x.object?.isMesh || !shown(x.object)) continue;
      let top = x.object;
      while (top.parent && top.parent !== group) top = top.parent;
      const uuid = targets.has(top.uuid) ? top.uuid : null;
      return { point: x.point.toArray(), uuid, distance: x.distance };
    }
    return { point: o.addScaledVector(d, range).toArray(), uuid: null, distance: range };
  }
  function fire(hand, origin, dir, muzzle) {
    const gun = gunOf(prefs.get().gun);
    const targets = new Map(engine.targets().map((t) => [t.uuid, t]));
    const dirs = pelletDirs(dir, gun.pellets, gun.spread, Math.random() * Math.PI);
    const perEnemy = /* @__PURE__ */ new Map();
    let end = null;
    for (const d of dirs) {
      const hit = cast(origin, d, gun.range, targets);
      if (!end) end = hit.point;
      if (gun.mode !== "beam") juice.tracer(muzzle, hit.point, gun.color, gun.pellets > 1 ? 0.012 : 0.02);
      if (hit.uuid) {
        perEnemy.set(hit.uuid, (perEnemy.get(hit.uuid) ?? 0) + gun.damage);
        juice.spark(hit.point, gun.color);
      } else if (hit.distance < gun.range) juice.spark(hit.point, 16769216);
    }
    stats.shots++;
    const results = [];
    for (const [uuid, n] of perEnemy) {
      const r = engine.hit(uuid, n);
      if (!r) continue;
      stats.hits += r.landed;
      if (r.killed) stats.kills++;
      results.push({ uuid, landed: r.landed, killed: r.killed });
    }
    stats.lastShot = { hand, gun: gun.id, pellets: dirs.length, results, end, at: clock() };
    if (gun.mode !== "beam") {
      juice.flash(muzzle, gun.color);
      feel.sound(gun.sound, muzzle);
    }
    if (results.some((r) => r.killed)) feel.haptic("hit", hand);
    else feel.haptic(gun.mode === "beam" ? "tap" : "bump", hand);
    return { end, results };
  }
  function frame() {
    const game = inGame(api);
    const vr = !!api.isVR?.();
    const t = clock();
    const gun = gunOf(prefs.get().gun);
    const armed = gunHands(prefs.get().hand);
    const live = running();
    const shownHands = /* @__PURE__ */ new Set();
    if (game && vr) {
      for (const hand of armed) {
        const snap = api.vrHand?.(hand);
        if (!snap?.position || !snap?.quaternion) continue;
        const h = handOf(hand);
        shownHands.add(hand);
        h.kick *= Math.exp(-(1 / 60) * 18);
        setWorld(h.model, handMatrix(snap, h.kick));
        h.model.visible = true;
        const held = !!snap.trigger;
        const pressed = edges.edge("trigger-" + hand, held);
        step(hand, h, gun, { pressed, held, t }, () => {
          const ray = aimRay(snap);
          const muzzle = h.model.userData.muzzle.getWorldPosition(new THREE.Vector3()).toArray();
          return { origin: ray.origin, dir: ray.dir, muzzle };
        });
      }
    } else if (game && !vr && live) {
      const ray = api.pointerRay?.();
      if (ray) {
        const h = handOf("desk");
        shownHands.add("desk");
        h.kick *= Math.exp(-(1 / 60) * 16);
        setWorld(h.model, deskMatrix(ray.ray ?? ray, h.kick));
        h.model.visible = true;
        const pressed = mouse.pressed;
        mouse.pressed = false;
        step("desk", h, gun, { pressed, held: mouse.down, t }, () => {
          const r = ray.ray ?? ray;
          const muzzle = h.model.userData.muzzle.getWorldPosition(new THREE.Vector3()).toArray();
          return { origin: r.origin.toArray(), dir: r.direction.clone().normalize().toArray(), muzzle };
        });
      }
    }
    if (!shownHands.has("desk")) mouse.pressed = false;
    for (const [hand, h] of hands)
      if (!shownHands.has(hand)) {
        h.model.visible = false;
        h.holding = false;
        juice.beam(hand, null, null, 0);
      }
  }
  function step(hand, h, gun, input, aim) {
    const wasLocked = h.state.locked;
    const r = trigger(gun, h.state, input);
    h.state = r.state;
    if (r.fire) {
      const a = aim();
      fire(hand, a.origin, a.dir, a.muzzle);
      h.kick = gun.mode === "spread" ? 0.06 : gun.mode === "beam" ? 8e-3 : 0.03;
    }
    if (gun.mode === "beam") {
      const burning = input.held && !h.state.locked;
      if (burning) {
        const a = aim();
        const hit = cast(a.origin, a.dir, gun.range, /* @__PURE__ */ new Map());
        juice.beam(hand, a.muzzle, hit.point, gun.color, h.state.heat);
        if (!h.holding || input.t - h.lastSound > 0.45) {
          feel.sound(gun.sound, a.muzzle);
          h.lastSound = input.t;
        }
      } else juice.beam(hand, null, null, 0);
      h.holding = burning;
      if (h.state.locked && !wasLocked) {
        feel.sound("fail");
        feel.haptic("fail", hand);
      }
      const glow = h.model.userData.glow;
      if (glow) {
        glow.emissiveIntensity = 1.2 + 3 * h.state.heat;
        glow.emissive.setHex(h.state.locked ? 16722448 : gun.color);
      }
    }
  }
  api.registerFrameTask(() => {
    try {
      frame();
    } catch (error) {
      console.warn("[waves] gun failed", error);
    }
  });
  return {
    fire,
    cast,
    stats,
    hands,
    /** the hand's heat 0..1 and whether it is locked (the Beam), for a HUD @param {string} hand */
    heatOf: (hand) => {
      const h = hands.get(hand);
      return h ? { heat: h.state.heat, locked: h.state.locked } : { heat: 0, locked: false };
    }
  };
}

// modules/waves/src/abilities.js
var ABILITIES = Object.freeze({
  shield: Object.freeze({ id: "shield", name: "Shield", duration: 3, cooldown: 12, color: 3793151, sound: "ring", blurb: "Blocks all damage for 3 s." }),
  slowmo: Object.freeze({ id: "slowmo", name: "Slow-mo", duration: 4, cooldown: 16, color: 9076223, sound: "whoosh", blurb: "Enemies at 40% speed for 4 s." }),
  pulse: Object.freeze({ id: "pulse", name: "Pulse", duration: 0.45, cooldown: 8, color: 16765514, sound: "kick", radius: 6, push: 3.2, blurb: "A shockwave shoves nearby enemies back." })
});
function abilityOf(id) {
  return (
    /** @type {any} */
    ABILITIES[String(id)] ?? ABILITIES.pulse
  );
}
var freshCharge = () => ({ readyAt: -Infinity, activeUntil: -Infinity, id: "" });
function use(a, s, t) {
  if (t < s.readyAt) return { ok: false, state: s };
  return { ok: true, state: { readyAt: t + a.cooldown, activeUntil: t + a.duration, id: a.id } };
}
function readiness(a, s, t) {
  if (!(t < s.readyAt)) return 1;
  return Math.max(0, Math.min(1, 1 - (s.readyAt - t) / a.cooldown));
}
var active = (s, t) => t < s.activeUntil;
function pulseShoves(enemies, at, a) {
  const out = {};
  for (const e of enemies) {
    if (!e.pos) continue;
    const d = Math.hypot(e.pos[0] - at[0], e.pos[2] - at[2]);
    if (d > a.radius) continue;
    const m = a.push * (1 - 0.5 * (d / a.radius)) * (e.kind === "tank" ? 0.35 : 1);
    out[e.uuid] = Math.round(m * 100) / 100;
  }
  return out;
}

// modules/waves/src/powers.js
function registerPowers(api, engine, root, prefs, feel) {
  const THREE = api.THREE;
  const edges = createEdges();
  let charge = freshCharge();
  let wasReady = true;
  const clock = () => performance.now() / 1e3;
  const log = (
    /** @type {{id: string, at: number, shoves?: number}[]} */
    []
  );
  const glow = (color, opacity) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, side: THREE.DoubleSide });
  const bubble = new THREE.Mesh(new THREE.IcosahedronGeometry(1.05, 2), glow(3793151, 0.14));
  bubble.name = "Waves shield";
  bubble.visible = false;
  const bubbleEdges = new THREE.LineSegments(new THREE.EdgesGeometry(bubble.geometry), new THREE.LineBasicMaterial({ color: 8386303, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false }));
  bubble.add(bubbleEdges);
  const wave = new THREE.Mesh(new THREE.TorusGeometry(1, 0.06, 8, 48).rotateX(Math.PI / 2), glow(16765514, 0.9));
  wave.name = "Waves pulse";
  wave.visible = false;
  root.add(bubble, wave);
  let waveAt = -Infinity;
  let waveFrom = [0, 0, 0];
  const placeWorld = (object, p) => {
    const v = new THREE.Vector3(p[0], p[1], p[2]);
    object.parent?.worldToLocal(v);
    object.position.copy(v);
  };
  let keyPressed = false;
  if (typeof window !== "undefined")
    window.addEventListener(
      "keydown",
      (e) => {
        if (e.code !== "KeyQ" || e.repeat) return;
        const t = (
          /** @type {any} */
          e.target
        );
        if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName ?? ""))) return;
        keyPressed = true;
      },
      true
    );
  const running = () => {
    const cutoff = api.game.roundCutoff();
    return typeof cutoff === "number" && Number.isFinite(cutoff) && api.game.roundUnderway();
  };
  function trigger2(hand) {
    const a = abilityOf(prefs.get().ability);
    const t = clock();
    const r = use(a, charge, t);
    if (!r.ok) {
      feel.haptic("tap", hand);
      return false;
    }
    charge = r.state;
    wasReady = false;
    const me = api.playerPosition?.() ?? [0, 1.6, 0];
    const entry = { id: a.id, at: t, shoves: 0 };
    if (a.id === "slowmo") {
      const now = api.now();
      engine.addFx({ k: "slow", at: now, until: now + a.duration });
    } else if (a.id === "pulse") {
      const enemies = engine.targets().map((e) => {
        const o = api.objectsGroup()?.getObjectByProperty("uuid", e.uuid);
        return { uuid: e.uuid, kind: e.kind, pos: o ? o.getWorldPosition(new THREE.Vector3()).toArray() : null };
      });
      const d = pulseShoves(enemies, me, a);
      entry.shoves = Object.keys(d).length;
      if (entry.shoves) engine.addFx({ k: "push", at: api.now(), d });
      waveAt = t;
      waveFrom = [me[0], Math.max(0.06, me[1] - 1.5), me[2]];
      api.effects?.burst?.(waveFrom, { kind: "sparkle", color: "#ffd24a", count: 30 });
    }
    log.push(entry);
    if (log.length > 20) log.shift();
    feel.sound(a.sound, me);
    feel.haptic(a.id === "pulse" ? "rumble" : "success", hand);
    return true;
  }
  function frame() {
    const t = clock();
    const game = inGame(api) && running();
    const vr = !!api.isVR?.();
    const a = abilityOf(prefs.get().ability);
    if (game) {
      if (vr) {
        const hand = abilityHand(prefs.get().hand);
        const snap = api.vrHand?.(hand);
        if (edges.edge("grip-" + hand, !!snap?.gripped)) trigger2(hand);
      } else if (keyPressed) trigger2();
    } else edges.clear();
    keyPressed = false;
    const ready = readiness(a, charge, t) >= 1;
    if (ready && !wasReady && game) feel.haptic("heartbeat", abilityHand(prefs.get().hand));
    wasReady = ready;
    const shielded = game && charge.id === "shield" && active(charge, t);
    bubble.visible = shielded;
    if (shielded) {
      placeWorld(bubble, api.playerPosition?.() ?? [0, 1.6, 0]);
      const left = charge.activeUntil - t;
      bubble.material.opacity = 0.1 + 0.06 * Math.sin(t * 9) * (left < 0.8 ? 2 : 1);
      bubble.rotation.y = t * 0.6;
    }
    const age = (t - waveAt) / 0.45;
    wave.visible = age >= 0 && age < 1;
    if (wave.visible) {
      placeWorld(wave, waveFrom);
      const r = 0.3 + (abilityOf("pulse").radius - 0.3) * Math.sqrt(age);
      wave.scale.set(r, 1 + 2 * (1 - age), r);
      wave.material.opacity = 0.9 * (1 - age);
    }
  }
  api.registerFrameTask(() => {
    try {
      frame();
    } catch (error) {
      console.warn("[waves] ability failed", error);
    }
  });
  return {
    trigger: trigger2,
    log,
    /** 0..1 charged (1 ready) */
    readiness: () => readiness(abilityOf(prefs.get().ability), charge, clock()),
    /** is THIS player shielded now — the damage rule reads it */
    shielded: () => charge.id === "shield" && active(charge, clock()),
    /** is a slow window on (anyone's) */
    slowed: () => engine.all().some((s) => (s.slows ?? []).some((w) => api.now() >= w.at && api.now() < w.until)),
    reset: () => {
      charge = freshCharge();
    }
  };
}

// modules/waves/src/index.js
var ROOT = "waves-module";
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
    const player = {};
    registerNodes(api, engine, player);
    const toolbox = registerToolbox(api, engine);
    const root = new api.THREE.Group();
    root.name = ROOT;
    const prefs = createPrefs(api);
    const feel = createFeel(api, prefs);
    const juice = createJuice(api, root);
    const fx = registerFx(api, engine, juice, feel);
    api.registerFrameTask(() => {
      if (!root.parent) api.scene()?.add(root);
    });
    api.registerSystemGroup?.(ROOT);
    const start = registerStart(api, root);
    const weapon = registerWeapon(api, engine, root, juice, prefs, feel);
    const powers = registerPowers(api, engine, root, prefs, feel);
    player.ability = () => powers.readiness();
    player.heat = () => Math.max(...["right", "left", "desk"].map((h) => weapon.heatOf(h).heat));
    let roundAt = api.game.roundCutoff();
    api.registerFrameTask(() => {
      juice.frame();
      const r = api.game.roundCutoff();
      if (r !== roundAt) {
        roundAt = r;
        powers.reset();
      }
    });
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
        start,
        root,
        prefs,
        juice,
        weapon,
        powers,
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
  ROOT,
  index_default as default
};
