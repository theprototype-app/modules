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
function levelOf(wave, perLevel) {
  const p = Math.round(clamp(perLevel, 0, 50, 0));
  if (!p) return 1;
  return Math.max(1, Math.ceil(Math.max(1, wave) / p));
}
function levelSpeed(level, step) {
  return 1 + clamp(step, 0, 2, 0) * Math.max(0, level - 1);
}
function opensLevel(wave, perLevel) {
  const p = Math.round(clamp(perLevel, 0, 50, 0));
  return p > 0 && wave > 1 && (wave - 1) % p === 0;
}
function killScore(points, level) {
  return Math.round(points * Math.max(1, level));
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
function appendFx(held, round, event, cap2 = 40) {
  const list = held && typeof held === "object" && held.round === round && Array.isArray(held.ev) ? held.ev : [];
  return { round, ev: [...list, event].sort((a, b) => a.at - b.at).slice(-cap2) };
}
function fxOf(held, round) {
  return held && typeof held === "object" && held.round === round && Array.isArray(held.ev) ? held.ev : [];
}
function setbackOf(hits, heals, max, knock) {
  const taken = Math.max(0, Math.min(max, (Number(hits) || 0) - (Number(heals) || 0)));
  return taken * Math.max(0, Number(knock) || 0);
}
function groundDistance(a, b) {
  return Math.hypot(a[0] - b[0], a[2] - b[2]);
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
function appendRun(log, entry, cap2 = 50) {
  const same = (e) => typeof entry.round === "number" && e.round === entry.round || e.at === entry.at;
  const list = Array.isArray(log) ? log.filter((e) => e && !same(e)) : [];
  list.push(entry);
  return list.slice(-cap2);
}

// modules/waves/src/engine.js
var SWEEP = 0.1;
var LOG_PREFIX = "waves:";
var FX_PREFIX = "waves:fx:";
var toSeconds = (ms) => ms / 1e3 % 86400;
var KILLS_ROW = "kills";
var SCORE_ROW = "score";
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
  const roundRun = /* @__PURE__ */ new Map();
  const breached = /* @__PURE__ */ new Map();
  const firstSeen = /* @__PURE__ */ new Map();
  const runListeners = /* @__PURE__ */ new Set();
  let guard = () => false;
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
    const perLevel = clamp(d.perLevel, 0, 50, 0);
    const level = levelOf(wave, perLevel);
    return {
      fx,
      perLevel,
      level,
      levelSpeed: levelSpeed(level, d.levelSpeed),
      // 30b: an enemy that reaches the goal BREACHES it (explodes, hurts the players) — only
      // when the node asks; a pre-30b arena keeps its enemies standing at the goal
      breach: d.breach === true,
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
            speed: s.speed * kind.speed * (s.levelSpeed ?? 1),
            stagger: s.stagger,
            setback: setbackOf(hitsOf(e), e.heals, e.max, kind.knock) + pushedBy(e.uuid, s.fx, s.waveStart, now()),
            slows: s.slows
          })
        );
        e.pos = object.position.toArray();
        if (s.breach && groundDistance(
          e.pos,
          /** @type {number[]} */
          s.goal
        ) <= s.reach) breachBy(s, e, object);
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
  function breachBy(s, e, object) {
    const life = killsOf(hitsOf(e), e.max);
    if (breached.get(e.uuid) === life) return;
    if (performance.now() / 1e3 - (firstSeen.get(s.id) ?? Infinity) < 1) return;
    const left = e.max - Math.max(0, hitsOf(e) - e.heals);
    if (left <= 0 || !e.damageId) return;
    breached.set(e.uuid, life);
    for (let i = 0; i < left; i++) api.fireNodeTrigger("damage", (_d, id) => id === e.damageId, { replicate: false });
    hitExpected.set(e.healthId, hitsOf(e) + left);
    announcedKills.set(e.uuid, killsOf(hitsOf(e), e.max));
    const pos = object.getWorldPosition(new api.THREE.Vector3()).toArray();
    const blocked = guard();
    if (!blocked) emit(s.name, "breach");
    emitRun({ kind: "breach", s, enemy: e, pos, blocked });
  }
  function emitRun(ev) {
    for (const fn of runListeners) {
      try {
        fn(ev);
      } catch (error) {
        console.warn("[waves] run listener failed", error);
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
        out.push({ ...e, hp, runId: s.id, walking: s.started, level: s.level });
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
      const points = killScore((KINDS[e.kind] ?? KINDS.grunt).points, e.level ?? 1);
      api.peerVars.setMine(SCORE_ROW, api.peerVars.mine(SCORE_ROW, 0) + points);
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
    const prevRound = roundRun.get(s.id);
    roundRun.set(s.id, s.running ? s.round : null);
    waveSeen.set(s.id, s.wave);
    doneSeen.set(s.id, s.done);
    runSeen.set(s.id, s.running);
    if (firstSight) return;
    if (s.running && (prevRun === false || typeof prevRound === "number" && prevRound !== s.round)) {
      emit(s.name, "start");
      emitRun({ kind: "start", s });
    }
    if (typeof prevWave === "number" && s.wave > prevWave && !s.done) {
      emit(s.name, "wave");
      if (opensLevel(s.wave, s.perLevel)) {
        emit(s.name, "level");
        emitRun({ kind: "level", s });
      } else emitRun({ kind: "wave", s });
    }
    if (s.done && prevDone === false) {
      emit(s.name, "over");
      logRun(s);
      emitRun({ kind: "over", s, won: true });
    } else if (!s.running && prevRun === true && !s.done) emitRun({ kind: "over", s, won: false });
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
      if (firstSight) firstSeen.set(node.id, performance.now() / 1e3);
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
        roundRun.delete(id);
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
    breached.clear();
    firstSeen.clear();
    roundRun.clear();
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
    /** @param {(e: {kind: string, s: any, enemy?: any, pos?: number[]}) => void} fn */
    onRun: (fn) => {
      runListeners.add(fn);
      return () => runListeners.delete(fn);
    },
    /** @param {() => boolean} fn the local rule a breach asks before it hurts this player */
    setGuard: (fn) => {
      guard = fn;
    },
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
var READS = ["wave", "left", "size", "waves", "done", "level"];
var EVENTS = ["wave", "over", "start", "level", "breach"];
var PLAYER_READS = ["ability", "heat", "score", "best"];
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
          { key: "spawnPrefix", kind: "text", placeholder: "Spawn", maxLength: 40 },
          // 30b: levels (every N waves; 0 = none), their speed-up, and the breach
          { key: "perLevel", kind: "range", min: 0, max: 10, step: 1 },
          { key: "levelSpeed", kind: "range", min: 0, max: 0.5, step: 0.01 },
          { key: "breach", kind: "toggle" }
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
        case "level":
          return s.level ?? 1;
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
  const extra = {
    ...o.stagger !== void 0 ? { stagger: o.stagger } : { stagger: DEFAULTS.stagger },
    ...o.perLevel ? { perLevel: o.perLevel, levelSpeed: o.levelSpeed ?? 0 } : {},
    ...o.breach ? { breach: true } : {}
  };
  const wavesIdx = nodes.push({ type: "waves", x: X0, y: y(), data: { name, waves: o.waves, sizeStart: o.sizeStart, sizeStep: o.sizeStep, interval: o.interval, speed: o.speed, reach: o.reach, spawnPrefix: o.spawnPrefix, ...extra } }) - 1;
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
    const ph = nodes.push({ type: "health", x: X0 + 5 * COL, y: y(), data: { name: playerName, scope: "player", max: o.playerHp, regen: o.playerRegen, deathAction: o.breach ? "nothing" : "respawn", respawnDelay: 3 } }) - 1;
    const pr = nodes.push({ type: "healthreset", x: X0 + 3 * COL, y: y() + 100, data: { name: playerName } }) - 1;
    edges.push({ from: pd, to: pc, handle: "pulse" }, { from: pc, to: ph, handle: "damage" }, { from: pr, to: pc, handle: "reset" });
    playerRef = ph;
    if (o.breach) {
      const bd = nodes.push({ type: "damage", x: X0 + 3 * COL, y: y() + 200, data: { amount: o.breachDamage ?? 2, source: "wired" } }) - 1;
      const be = nodes.push({ type: "wavesevent", x: X0 + 2 * COL, y: y() + 200, data: { name, event: "breach" } }) - 1;
      const death = nodes.push({ type: "healthevent", x: X0 + 4 * COL, y: y() + 300, data: { name: playerName, event: "death" } }) - 1;
      const lost = nodes.push({ type: "setgamestate", x: X0 + 5 * COL, y: y() + 300, data: { state: "over", outcome: "lost" } }) - 1;
      edges.push({ from: be, to: bd, handle: "trigger" }, { from: bd, to: pc, handle: "pulse" }, { from: death, to: lost, handle: "trigger" });
    }
  }
  row++;
  spec.enemies.forEach((uuid, i) => {
    const d = nodes.push({ type: "damage", x: X0, y: y(), data: { amount: 1, source: o.source, scale: o.source === "hit" ? "speed" : "none", speedRef: 3 } }) - 1;
    const c = nodes.push({ type: "counter", x: X0 + COL, y: y(), data: { op: "up", step: 1 } }) - 1;
    const hp = spec.hps?.[i] ?? o.hp;
    const h = nodes.push({ type: "health", x: X0 + 2 * COL, y: y(), data: { name, scope: "object", max: hp, deathAction: "hide", respawnDelay: 3 } }) - 1;
    const s = nodes.push({ type: "objectselector", x: X0 + 3 * COL, y: y(), data: { selected: uuid } }) - 1;
    const r = nodes.push({ type: "healthreset", x: X0, y: y() + 100, data: { name } }) - 1;
    const he = nodes.push({ type: "heal", x: X0 + COL, y: y() + 100, data: { amount: 1 } }) - 1;
    const hc = nodes.push({ type: "counter", x: X0 + 2 * COL, y: y() + 100, data: { op: "up", step: 1 } }) - 1;
    edges.push(
      { from: d, to: c, handle: "pulse" },
      { from: c, to: h, handle: "damage" },
      { from: s, to: h, handle: "target" },
      { from: r, to: c, handle: "reset" },
      { from: r, to: hc, handle: "reset" },
      { from: he, to: hc, handle: "pulse" },
      { from: hc, to: h, handle: "heal" }
    );
    if (o.zone !== false) {
      const z = nodes.push({ type: "damage", x: X0 + 4 * COL, y: y(), data: { amount: o.enemyDamage, source: "zone", perSecond: o.enemyRate, radius: o.reach } }) - 1;
      const zs = nodes.push({ type: "objectselector", x: X0 + 4 * COL, y: y() + 100, data: { selected: uuid } }) - 1;
      edges.push({ from: zs, to: z, handle: "zone" }, { from: z, to: playerRef, handle: "damage" });
    }
    row++;
  });
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
var PANEL = { bg: "rgba(22, 18, 28, 0.93)", radius: 18, border: "1px solid rgba(255, 140, 100, 0.3)" };
var BUTTON = (bg, size = 16) => ({ size, weight: "700", bg, color: "#ffffff", radius: 12 });
var QUIET = { size: 15, weight: "600", bg: "#3a3440", color: "#e6dede", radius: 12 };
var TITLE = (size) => ({ size, weight: "800", color: "#ff9c6b", align: "center" });
var BODY = { size: 14, color: "#e6dede", align: "left" };
var GUN_BUTTONS = Object.freeze([
  ["wv-gun-blaster", "Blaster", "#1e8fb0", "Semi-auto. One precise bolt per pull."],
  ["wv-gun-scatter", "Scatter", "#c46a1c", "7 pellets, slow pump. Brutal up close."],
  ["wv-gun-beam", "Beam", "#a2308c", "Hold to burn. Overheats \u2014 let it cool."]
]);
var ABILITY_BUTTONS = Object.freeze([
  ["wv-ab-shield", "Shield", "#1e8fb0", "Blocks all crystal damage for 3 s."],
  ["wv-ab-slowmo", "Slow-mo", "#5a4fc0", "Every enemy at 40% for 4 s."],
  ["wv-ab-pulse", "Pulse", "#b8901c", "A shockwave shoves them back."]
]);
var OPTION_BUTTONS = Object.freeze([
  ["wv-opt-music", "Music"],
  ["wv-opt-sfx", "Sound effects"],
  ["wv-opt-hand", "Gun hand"],
  ["wv-opt-haptics", "Vibration"]
]);
var NAV = Object.freeze([
  ["wv-nav-howto", "howto", "show"],
  ["wv-nav-loadout", "loadout", "show"],
  ["wv-nav-options", "options", "show"],
  ["wv-back-howto", "howto", "hide"],
  ["wv-back-loadout", "loadout", "hide"],
  ["wv-back-options", "options", "hide"]
]);
function tile(id, x, y, glyph, bg) {
  return [
    { id: id + "-bg", kind: "panel", anchor: "center", x, y, w: 64, h: 64, z: 1, label: "", style: { bg, radius: 14, border: "1px solid rgba(255,255,255,0.25)" } },
    { id, kind: "text", anchor: "center", x, y, w: 64, h: 64, z: 2, label: glyph, style: { size: 34, color: "#ffffff", align: "center" } }
  ];
}
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
            { id: "menu-panel", kind: "panel", anchor: "center", x: 0, y: 0, w: 520, h: 480, z: 0, label: "", style: PANEL },
            { id: "menu-stripe", kind: "panel", anchor: "center", x: 0, y: -236, w: 520, h: 8, z: 1, label: "", style: { bg: "#ff7a4a", radius: 4 } },
            { id: "title", kind: "text", anchor: "center", x: 0, y: -188, w: 460, h: 60, z: 1, label: "WAVES", style: TITLE(52) },
            { id: "subtitle", kind: "text", anchor: "center", x: 0, y: -136, w: 440, h: 44, z: 1, label: "Five levels of enemies pour out of the portals. Pick your gun, hold the crystal.", style: { size: 14, color: "#e6dede", align: "center" }, wrap: true },
            { id: "wv-start", kind: "button", anchor: "center", x: 0, y: -68, w: 440, h: 60, z: 1, label: "\u25B6  Play", enabled: true, style: BUTTON("#d9533f", 22) },
            { id: "wv-nav-howto", kind: "button", anchor: "center", x: 0, y: 2, w: 440, h: 46, z: 1, label: "How to play", enabled: true, style: QUIET },
            { id: "wv-nav-loadout", kind: "button", anchor: "center", x: 0, y: 56, w: 440, h: 46, z: 1, label: "Loadout", enabled: true, style: QUIET },
            { id: "wv-nav-options", kind: "button", anchor: "center", x: 0, y: 110, w: 440, h: 46, z: 1, label: "Options", enabled: true, style: QUIET },
            { id: "wv-loadout-now", kind: "list", anchor: "center", x: 0, y: 160, w: 440, h: 22, z: 1, label: "", rows: [], style: { size: 13, weight: "600", color: "#ffd0b0", align: "center", bg: "transparent" } },
            { id: "wv-best", kind: "list", anchor: "center", x: 0, y: 184, w: 440, h: 22, z: 1, label: "", rows: [], style: { size: 13, color: "#d6c8c8", align: "center", bg: "transparent" } },
            { id: "menu-hint", kind: "text", anchor: "center", x: 0, y: 216, w: 460, h: 20, z: 1, label: "Trigger / click: shoot  \xB7  Grip / Q: ability  \xB7  P: pause", style: { size: 11, color: "#9b8f8f", align: "center" } }
          ]
        },
        {
          id: "howto",
          name: "How to play",
          input: "menu",
          elements: [
            { id: "howto-panel", kind: "panel", anchor: "center", x: 0, y: 0, w: 640, h: 540, z: 0, label: "", style: PANEL },
            { id: "howto-title", kind: "text", anchor: "center", x: 0, y: -226, w: 560, h: 44, z: 1, label: "HOW TO PLAY", style: TITLE(32) },
            ...tile("howto-icon-1", -250, -150, "\u{1F3AF}", "#1e8fb0"),
            { id: "howto-1", kind: "text", anchor: "center", x: 50, y: -150, w: 480, h: 74, z: 1, label: "SHOOT \u2014 pull the trigger (desktop: click). The gun is in your right hand; switch hands in Options.", style: BODY, wrap: true },
            ...tile("howto-icon-2", -250, -64, "\u{1F48E}", "#2a8a9a"),
            { id: "howto-2", kind: "text", anchor: "center", x: 50, y: -64, w: 480, h: 74, z: 1, label: "HOLD THE CRYSTAL \u2014 enemies walk from the portals to it. One that reaches it explodes: \u22122 crystal. At zero the run is lost.", style: BODY, wrap: true },
            ...tile("howto-icon-3", -250, 22, "\u270B", "#8a5cff"),
            { id: "howto-3", kind: "text", anchor: "center", x: 50, y: 22, w: 480, h: 74, z: 1, label: "ABILITY \u2014 squeeze the grip on your free hand (desktop: Q): Shield, Slow-mo or Pulse. Then it recharges.", style: BODY, wrap: true },
            ...tile("howto-icon-4", -250, 108, "\u2B50", "#b8901c"),
            { id: "howto-4", kind: "text", anchor: "center", x: 50, y: 108, w: 480, h: 74, z: 1, label: "LEVELS \u2014 every 3 waves is a new level: runners, then tanks, then faster. Higher levels score more.", style: BODY, wrap: true },
            { id: "wv-back-howto", kind: "button", anchor: "center", x: 0, y: 212, w: 260, h: 46, z: 1, label: "Back", enabled: true, style: QUIET }
          ]
        },
        {
          id: "loadout",
          name: "Loadout",
          input: "menu",
          elements: [
            { id: "loadout-panel", kind: "panel", anchor: "center", x: 0, y: 0, w: 660, h: 520, z: 0, label: "", style: PANEL },
            { id: "loadout-title", kind: "text", anchor: "center", x: 0, y: -214, w: 560, h: 44, z: 1, label: "LOADOUT", style: TITLE(32) },
            { id: "loadout-gun", kind: "text", anchor: "center", x: 0, y: -168, w: 600, h: 22, z: 1, label: "GUN", style: { size: 12, weight: "700", color: "#c8b8b8", align: "center" } },
            ...GUN_BUTTONS.flatMap(([id, label, bg, blurb], i) => [
              { id, kind: "button", anchor: "center", x: -205 + i * 205, y: -126, w: 190, h: 50, z: 1, label, enabled: true, style: BUTTON(bg, 17) },
              { id: id + "-blurb", kind: "text", anchor: "center", x: -205 + i * 205, y: -78, w: 190, h: 40, z: 1, label: blurb, style: { size: 12, color: "#d6c8c8", align: "center" }, wrap: true }
            ]),
            { id: "loadout-ability", kind: "text", anchor: "center", x: 0, y: -24, w: 600, h: 22, z: 1, label: "ABILITY", style: { size: 12, weight: "700", color: "#c8b8b8", align: "center" } },
            ...ABILITY_BUTTONS.flatMap(([id, label, bg, blurb], i) => [
              { id, kind: "button", anchor: "center", x: -205 + i * 205, y: 18, w: 190, h: 50, z: 1, label, enabled: true, style: BUTTON(bg, 17) },
              { id: id + "-blurb", kind: "text", anchor: "center", x: -205 + i * 205, y: 66, w: 190, h: 40, z: 1, label: blurb, style: { size: 12, color: "#d6c8c8", align: "center" }, wrap: true }
            ]),
            { id: "wv-loadout-pick", kind: "list", anchor: "center", x: 0, y: 128, w: 560, h: 28, z: 1, label: "", rows: [], style: { size: 17, weight: "700", color: "#ffd0b0", align: "center", bg: "transparent" } },
            { id: "wv-back-loadout", kind: "button", anchor: "center", x: 0, y: 196, w: 260, h: 46, z: 1, label: "Back", enabled: true, style: QUIET }
          ]
        },
        {
          id: "options",
          name: "Options",
          input: "menu",
          elements: [
            { id: "options-panel", kind: "panel", anchor: "center", x: 0, y: 0, w: 540, h: 460, z: 0, label: "", style: PANEL },
            { id: "options-title", kind: "text", anchor: "center", x: 0, y: -184, w: 480, h: 44, z: 1, label: "OPTIONS", style: TITLE(32) },
            ...OPTION_BUTTONS.flatMap(([id, label], i) => [
              { id, kind: "button", anchor: "center", x: -80, y: -112 + i * 60, w: 260, h: 46, z: 1, label, enabled: true, style: QUIET },
              { id: id + "-v", kind: "list", anchor: "center", x: 150, y: -112 + i * 60, w: 170, h: 30, z: 1, label: "", rows: [], style: { size: 16, weight: "700", color: "#ffd0b0", align: "left", bg: "transparent" } }
            ]),
            { id: "options-hint", kind: "text", anchor: "center", x: 0, y: 130, w: 480, h: 20, z: 1, label: "Tap a setting to change it. Saved on this device.", style: { size: 12, color: "#9b8f8f", align: "center" } },
            { id: "wv-back-options", kind: "button", anchor: "center", x: 0, y: 182, w: 260, h: 46, z: 1, label: "Back", enabled: true, style: QUIET }
          ]
        },
        {
          id: "hud",
          name: "HUD",
          showWhile: "playing",
          input: "game",
          elements: [
            { id: "wv-banner", kind: "panel", anchor: "top-center", x: 0, y: 10, w: 190, h: 86, z: 0, label: "", style: { bg: "rgba(22, 18, 28, 0.78)", radius: 14, border: "1px solid rgba(255, 140, 100, 0.25)" } },
            { id: "wv-wave", kind: "text", anchor: "top-center", x: 0, y: 14, w: 170, h: 32, z: 1, label: "Wave 1", style: { size: 24, weight: "800", color: "#ff9c6b", align: "center" } },
            { id: "wv-level", kind: "text", anchor: "top-center", x: 0, y: 46, w: 170, h: 20, z: 1, label: "LEVEL 1", style: { size: 12, weight: "700", color: "#ffd24a", align: "center" } },
            { id: "wv-left", kind: "text", anchor: "top-center", x: 0, y: 66, w: 170, h: 22, z: 1, label: "", style: { size: 13, color: "#e6dede", align: "center" } },
            { id: "wv-score-bg", kind: "panel", anchor: "top-left", x: 16, y: 12, w: 180, h: 70, z: 0, label: "", style: { bg: "rgba(22, 18, 28, 0.78)", radius: 14, border: "1px solid rgba(255, 140, 100, 0.25)" } },
            { id: "wv-score-label", kind: "text", anchor: "top-left", x: 30, y: 18, w: 150, h: 18, z: 1, label: "SCORE", style: { size: 11, weight: "700", color: "#c8b8b8", align: "left" } },
            { id: "wv-score", kind: "text", anchor: "top-left", x: 30, y: 38, w: 160, h: 36, z: 1, label: "0", style: { size: 28, weight: "800", color: "#ffffff", align: "left" } },
            { id: "wv-hp-label", kind: "text", anchor: "bottom-center", x: 0, y: 46, w: 340, h: 18, z: 1, label: "CRYSTAL", style: { size: 11, weight: "700", color: "#9ff0ff", align: "center" } },
            { id: "wv-hp", kind: "bar", anchor: "bottom-center", x: 0, y: 24, w: 340, h: 20, z: 1, label: "", min: 0, max: 1, value: 1, orientation: "horizontal", showPercent: false, style: { color: "#39e0ff", bg: "rgba(0,0,0,0.45)", radius: 10 } },
            { id: "wv-ability-label", kind: "list", anchor: "bottom-right", x: 20, y: 62, w: 200, h: 24, z: 1, label: "", rows: [], rowHeight: 20, style: { size: 11, weight: "700", color: "#ffe7a0", align: "left", bg: "transparent" } },
            { id: "wv-ability", kind: "bar", anchor: "bottom-right", x: 20, y: 46, w: 200, h: 14, z: 1, label: "", min: 0, max: 1, value: 1, orientation: "horizontal", showPercent: false, style: { color: "#ffd24a", bg: "rgba(0,0,0,0.45)", radius: 7 } },
            { id: "wv-heat-label", kind: "text", anchor: "bottom-right", x: 20, y: 30, w: 200, h: 14, z: 1, label: "HEAT", style: { size: 9, weight: "700", color: "#ff9ce8", align: "right" } },
            { id: "wv-heat", kind: "bar", anchor: "bottom-right", x: 20, y: 18, w: 200, h: 10, z: 1, label: "", min: 0, max: 1, value: 0, orientation: "horizontal", showPercent: false, style: { color: "#ff4fd8", bg: "rgba(0,0,0,0.45)", radius: 5 } },
            { id: "wv-crosshair", kind: "crosshair", anchor: "center", x: 0, y: 0, w: 24, h: 24, z: 2, label: "", thickness: 2, gap: 5, dot: true, style: { color: "#ffffff", opacity: 0.85 } },
            { id: "wv-kills", kind: "list", anchor: "top-right", x: 16, y: 14, w: 220, h: 100, z: 1, label: "", rows: [], style: { size: 13, weight: "600", color: "#ffe0d0", align: "right", bg: "transparent" } }
          ]
        },
        {
          id: "pause",
          name: "Pause",
          input: "menu",
          elements: [
            { id: "pause-panel", kind: "panel", anchor: "center", x: 0, y: 0, w: 380, h: 300, z: 0, label: "", style: PANEL },
            { id: "pause-title", kind: "text", anchor: "center", x: 0, y: -95, w: 260, h: 36, z: 1, label: "PAUSED", style: { size: 28, weight: "800", color: "#e6dede", align: "center" } },
            { id: "resume-btn", kind: "button", anchor: "center", x: 0, y: -30, w: 260, h: 44, z: 1, label: "Resume", enabled: true, style: BUTTON("#3b7dd8") },
            { id: "restart-btn", kind: "button", anchor: "center", x: 0, y: 24, w: 260, h: 44, z: 1, label: "Restart round", enabled: true, style: BUTTON("#d9533f") },
            { id: "quit-btn", kind: "button", anchor: "center", x: 0, y: 78, w: 260, h: 44, z: 1, label: "Quit to menu", enabled: true, style: QUIET }
          ]
        },
        {
          id: "over",
          name: "Results",
          showWhile: "over",
          input: "menu",
          elements: [
            { id: "over-panel", kind: "panel", anchor: "center", x: 0, y: 0, w: 520, h: 440, z: 0, label: "", style: PANEL },
            { id: "over-stripe", kind: "panel", anchor: "center", x: 0, y: -216, w: 520, h: 8, z: 1, label: "", style: { bg: "#ff7a4a", radius: 4 } },
            { id: "over-title", kind: "text", anchor: "center", x: 0, y: -176, w: 460, h: 40, z: 1, label: "RESULTS", style: TITLE(30) },
            // list rows align left (core draws them so): the rows sit in the buttons' column
            { id: "wv-result-title", kind: "list", anchor: "center", x: 0, y: -124, w: 300, h: 34, z: 1, label: "", rows: ["ROUND OVER"], rowHeight: 30, style: { size: 22, weight: "800", color: "#ffd0b0", align: "left", bg: "transparent" } },
            { id: "wv-result", kind: "list", anchor: "center", x: 0, y: -58, w: 300, h: 80, z: 1, label: "", rows: [], rowHeight: 24, style: { size: 15, color: "#e6dede", align: "left", bg: "transparent" } },
            { id: "wv-kills-over", kind: "list", anchor: "center", x: 0, y: 30, w: 300, h: 76, z: 1, label: "", rows: [], style: { size: 13, color: "#ffe0d0", align: "left", bg: "transparent" } },
            { id: "wv-again", kind: "button", anchor: "center", x: 0, y: 118, w: 300, h: 52, z: 1, label: "Play again", enabled: true, style: BUTTON("#d9533f", 18) },
            { id: "wv-menu", kind: "button", anchor: "center", x: 0, y: 176, w: 300, h: 44, z: 1, label: "Menu", enabled: true, style: QUIET }
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
    // 30b: the board ranks SCORE (each player's own row), in play and on the results
    { type: "leaderboard", x, y: y + 500, data: { variable: "score", element: "wv-kills,wv-kills-over", limit: 8 } },
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
  const add = (node) => nodes.push(node) - 1;
  let row = y + 1e3;
  {
    const b = add({ type: "hudbutton", x, y: row, data: { element: "wv-menu" } });
    const g = add({ type: "setgamestate", x: x + 220, y: row, data: { state: "menu", outcome: "", reset: true } });
    edges.push({ from: b, to: g, handle: "trigger" });
    row += 100;
  }
  for (
    const [type, data, target, tdata] of
    /** @type {[string, any, string, any][]} */
    [
      ["wavesvalue", { name: o.name, read: "level" }, "hudtext", { element: "wv-level", format: "LEVEL {v}", decimals: 0 }],
      ["wavesplayer", { read: "score" }, "hudtext", { element: "wv-score", format: "{v}", decimals: 0 }],
      ["wavesplayer", { read: "ability" }, "hudbar", { element: "wv-ability", min: 0, max: 1 }],
      ["wavesplayer", { read: "heat" }, "hudbar", { element: "wv-heat", min: 0, max: 1 }]
    ]
  ) {
    const a = add({ type, x, y: row, data });
    const b = add({ type: target, x: x + 220, y: row, data: tdata });
    edges.push({ from: a, to: b, handle: "value" });
    row += 100;
  }
  for (const [element, screen, action] of NAV) {
    const b = add({ type: "hudbutton", x, y: row, data: { element, perPlayer: true } });
    const s = add({ type: "hudscreen", x: x + 220, y: row, data: { screen, action } });
    edges.push({ from: b, to: s, handle: "trigger" });
    row += 100;
  }
  for (const [element] of [...GUN_BUTTONS, ...ABILITY_BUTTONS, ...OPTION_BUTTONS]) {
    add({ type: "hudbutton", x, y: row, data: { element, perPlayer: true } });
    row += 80;
  }
  return { nodes, edges, rows: Math.ceil((row - y) / 200) };
}

// modules/waves/src/look.js
var CORE = "Goal core";
var FLASH = { seconds: 0.18, peak: 3.5 };
function flashLevel(age) {
  if (!(age >= 0) || age >= FLASH.seconds) return 0;
  return 1 - age / FLASH.seconds;
}
function coreGlow(fraction, floor = 0.15) {
  const f = Number.isFinite(fraction) ? Math.min(1, Math.max(0, fraction)) : 1;
  return floor + (1 - floor) * f;
}
var ENEMY_BODY = 16747100;
var VISOR = 8255999;
var ENEMY_LOOKS = Object.freeze({
  grunt: Object.freeze({ body: ENEMY_BODY, visor: VISOR, r: 0.32, h: 0.5, mass: 1 }),
  runner: Object.freeze({ body: 12120138, visor: 16726830, r: 0.24, h: 0.46, mass: 0.6 }),
  tank: Object.freeze({ body: 9067775, visor: 16765514, r: 0.46, h: 0.62, mass: 3 })
});

// modules/waves/src/fx.js
var POP_COLOR = { grunt: 16747100, runner: 14221130, tank: 11563263 };
function registerFx(api, engine, juice = null, feel = null, figureOf2 = null) {
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
      const figure = figureOf2?.(uuid);
      if (figure) paint(figure, level);
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
  let transient = (
    /** @type {{card: any, until: number} | null} */
    null
  );
  let resultCard = () => null;
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
  function place(lift = 0.15, distance = DISTANCE) {
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
    const at = [head[0] - Math.sin(yaw) * distance, head[1] + lift, head[2] - Math.cos(yaw) * distance];
    board.placeFacing(at, yaw);
    placed = true;
  }
  const running = () => {
    const cutoff = api.game.roundCutoff();
    return typeof cutoff === "number" && Number.isFinite(cutoff) && api.game.roundUnderway();
  };
  let mode = "";
  function frame() {
    const vrGame = !!api.isVR?.() && inGame(api);
    if (transient && performance.now() / 1e3 < transient.until && vrGame) {
      board.draw(transient.card);
      if (mode !== "card") {
        place(0.9, 3.4);
        mode = "card";
      }
      board.show(true);
      return;
    }
    transient = null;
    if (mode === "card") {
      placed = false;
      mode = "";
    }
    const want = vrGame && !running() && hasStart();
    if (!want) {
      if (board.visible()) board.show(false);
      placed = false;
      edges.clear();
      return;
    }
    const result = resultCard();
    board.draw(result ? { title: result.title, lines: result.lines, button: "SHOOT TO PLAY AGAIN", color: result.color } : { title: "WAVES", lines: ["Hold the crystal against the waves.", "Aim a controller here and pull the trigger."], button: "SHOOT TO START" });
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
  return {
    board,
    press,
    hasStart,
    visible: () => board.visible(),
    /** a banner on the board for `ms` (the headset's announce fallback) @param {any} card @param {number} ms */
    card(card, ms) {
      transient = { card, until: performance.now() / 1e3 + ms / 1e3 };
      mode = "";
    },
    /** @param {() => any} fn */
    setResult(fn) {
      resultCard = fn;
    }
  };
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
function cycle(list, value) {
  const i = list.indexOf(value);
  return list[(i + 1) % list.length];
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

// modules/waves/src/figures.js
var STAND_IN_LAYER = 30;
var HELPER_LAYER = 1;
var FIGURES = Object.freeze({
  grunt: Object.freeze({ walk: "walk", clipSpeed: 1.1, height: 1.2 }),
  runner: Object.freeze({ walk: "run", clipSpeed: 2.6, height: 1.05 }),
  tank: Object.freeze({ walk: "walk", clipSpeed: 0.8, height: 1.6 })
});
var figureOf = (kind) => (
  /** @type {any} */
  FIGURES[kind] ?? FIGURES.grunt
);
function footDrop(kind) {
  const l = (
    /** @type {any} */
    ENEMY_LOOKS[kind] ?? ENEMY_LOOKS.grunt
  );
  return Math.round((l.r + l.h / 2) * 1e3) / 1e3;
}
function fitScale(modelHeight, height) {
  if (!(modelHeight > 1e-6) || !(height > 0)) return 1;
  return height / modelHeight;
}
function yawTo(from, to) {
  const dx = to[0] - from[0];
  const dz = to[2] - from[2];
  if (Math.hypot(dx, dz) < 1e-6) return 0;
  return Math.atan2(dx, dz);
}
function turnToward(current, target, dt, rate = 6) {
  let d = target - current;
  d = Math.atan2(Math.sin(d), Math.cos(d));
  const step = Math.max(0, rate * dt);
  if (Math.abs(d) <= step) return target;
  return current + Math.sign(d) * step;
}
function gait(prev, a, b, dt, yaw) {
  if (!(dt > 0)) return { speed: prev.speed, forward: true };
  const dx = b[0] - a[0];
  const dz = b[2] - a[2];
  const raw = Math.hypot(dx, dz) / dt;
  const speed = raw > 12 ? 0 : raw;
  const forward = dx * Math.sin(yaw) + dz * Math.cos(yaw) >= -1e-4;
  const k = Math.min(1, dt * 10);
  return { speed: prev.speed + (speed - prev.speed) * k, forward };
}
function walkRate(speed, clipSpeed, scale = 1) {
  if (!(speed > 0.03) || !(clipSpeed > 0)) return 0;
  return Math.min(2.5, Math.max(0.2, speed / (clipSpeed * (scale > 0 ? scale : 1))));
}
var UNDERGROUND = -10;
function figureShown(s) {
  if (s.dying) return true;
  return !!s.visible && s.y > UNDERGROUND;
}
var DEATH_SECONDS = 1.4;
var SINK = Object.freeze({ seconds: 0.5, depth: 0.9 });
function sinkDepth(age) {
  const t = age - DEATH_SECONDS;
  if (!(t > 0)) return 0;
  return Math.min(1, t / SINK.seconds) * SINK.depth;
}
var deathOver = (age) => !(age < DEATH_SECONDS + SINK.seconds);
var GUN_FITS = Object.freeze({
  // measured on the post-processed GLBs (30 cm long, centred): side renders + the vertex profile
  blaster: Object.freeze({ grip: [0, -0.012, 0.065], muzzle: [0, 0.03, -0.152], cell: [0, 0.018, -0.068], cellSize: [0.069, 8e-3, 0.07], cellShape: "box" }),
  // the Scatter's cell is its orange energy cell under the barrels, at the pump
  scatter: Object.freeze({ grip: [0, 0, 0.095], muzzle: [0, 0.023, -0.152], cell: [0, 4e-3, 0], cellSize: [0.031, 0.017, 0.024], cellShape: "box" }),
  // the Beam's glow IS its emitter orb: a glowing ball over the painted one
  beam: Object.freeze({ grip: [0, -8e-3, 0.115], muzzle: [0, 0.03, -0.158], cell: [0, 0.03, -0.142], cellSize: [0.032, 0.032, 0.032], cellShape: "ball" })
});
var gunFit = (id) => (
  /** @type {any} */
  GUN_FITS[id] ?? GUN_FITS.blaster
);
var fromGrip = (point, grip) => [point[0] - grip[0], point[1] - grip[1], point[2] - grip[2]];

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
function gunFromAsset(THREE, scene, id, accent) {
  const fit = gunFit(id);
  const g = new THREE.Group();
  g.name = "Waves gun " + id;
  scene.position.set(-fit.grip[0], -fit.grip[1], -fit.grip[2]);
  scene.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = false;
    o.receiveShadow = false;
  });
  g.add(scene);
  const glow = new THREE.MeshStandardMaterial({ color: accent, emissive: accent, emissiveIntensity: 2.2, roughness: 0.3 });
  const [cx, cy, cz] = fit.cellSize;
  const cell = new THREE.Mesh(fit.cellShape === "ball" ? new THREE.SphereGeometry(cx / 2, 16, 12) : new THREE.BoxGeometry(cx, cy, cz), glow);
  cell.name = "glow";
  cell.position.fromArray(fromGrip(fit.cell, fit.grip));
  g.add(cell);
  const muzzle = new THREE.Object3D();
  muzzle.name = "muzzle";
  muzzle.position.fromArray(fromGrip(fit.muzzle, fit.grip));
  g.add(muzzle);
  g.userData.muzzle = muzzle;
  g.userData.glow = glow;
  g.userData.accent = accent;
  g.userData.glb = true;
  return g;
}

// modules/waves/src/weapon.js
var GRIP_OFFSET = [0, -0.035, 0.05];
function registerWeapon(api, engine, root, juice, prefs, feel, assets = null) {
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
    const gun = gunOf(id);
    const ready = !!assets?.get(gun.id);
    if (!h || h.gun !== gun.id || ready && !h.glb) {
      const glb = ready ? assets?.instance(gun.id) : null;
      if (h) {
        h.model.parent?.remove(h.model);
        if (h.glb) h.model.traverse((o) => o.isMesh && o.material?.dispose?.());
        if (h.gun !== gun.id) juice.beam(hand, null, null, 0);
      }
      const model = glb ? gunFromAsset(
        THREE,
        glb.scene,
        /** @type {any} */
        gun.id,
        gun.color
      ) : buildGun(
        THREE,
        /** @type {any} */
        gun.id,
        gun.color
      );
      model.visible = false;
      root.add(model);
      const keep = h && h.gun === gun.id ? h : null;
      h = { model, gun: gun.id, glb: !!glb, state: keep?.state ?? idleHand(), kick: keep?.kick ?? 0, holding: keep?.holding ?? false, lastSound: keep?.lastSound ?? -Infinity };
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
  raycaster.layers.enable(STAND_IN_LAYER);
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

// modules/waves/src/session.js
var BEST_KEY = "best";
var LEVEL_NEWS = { 2: "Runners incoming \u2014 fast and fragile", 3: "Tanks! Heavy, slow, worth 400", 4: "Everything, faster", 5: "The last stand" };
var fmt = (n) => Math.round(n).toLocaleString("en-US");
function betterRun(a, b) {
  if (!a) return b;
  if (!b) return a;
  if (b.score !== a.score) return b.score > a.score ? b : a;
  return (b.level ?? 0) > (a.level ?? 0) ? b : a;
}
function resultLines(r) {
  return {
    title: r.won ? "ARENA CLEARED" : "CRYSTAL DESTROYED",
    lines: [
      (r.won ? "All " + r.waves + " waves held" : "Fell on wave " + r.wave + " of " + r.waves) + " \xB7 level " + r.level,
      "Score " + fmt(r.score) + " \xB7 " + r.kills + (r.kills === 1 ? " kill" : " kills"),
      r.isBest ? "NEW BEST!" : "Best: " + fmt(r.best?.score ?? 0) + " \xB7 level " + (r.best?.level ?? 1)
    ]
  };
}
function registerSession(api, engine, juice, feel, prefs, board) {
  let best = api.storage?.get?.(BEST_KEY, null) ?? null;
  let result = null;
  const said = (
    /** @type {{text: string, sub?: string}[]} */
    []
  );
  function announce(text, o = {}) {
    said.push({ text, sub: o.sub });
    if (said.length > 30) said.shift();
    if (typeof api.announce === "function") {
      api.announce(text, { sub: o.sub, ms: o.ms ?? 1800, color: o.color });
      return;
    }
    if (api.isVR?.()) board?.card({ title: text, lines: o.sub ? [o.sub] : [], color: o.color }, o.ms ?? 1800);
    else if (o.big) api.toast?.(o.sub ? text + " \u2014 " + o.sub : text);
  }
  const crystal = (s) => s?.goal ? [s.goal[0], s.goal[1] + 1.6, s.goal[2]] : [0, 2, 0];
  function crystalHp() {
    const node = api.flow.nodes("health").find((n) => n.data?.scope === "player");
    return node ? Number(api.flow.nodeValue(node.id)) : NaN;
  }
  function crystalFell() {
    if (crystalHp() <= 0) return true;
    return api.flow.nodes("healthevent").some((n) => {
      if (String(n.data?.event ?? "") !== "death") return false;
      const st = api.flow.triggerStamp(n.id);
      return !!st && st.stamp !== null && Number(st.age) < 3;
    });
  }
  let pendingLoss = null;
  function pushRows() {
    api.hud.rows("wv-best", best ? ["Best: " + fmt(best.score) + " \xB7 level " + best.level] : ["No best run yet"]);
    if (result) {
      const r = resultLines(result);
      api.hud.rows("wv-result-title", [r.title]);
      api.hud.rows("wv-result", r.lines);
    }
  }
  engine.onRun((ev) => {
    const s = ev.s;
    if (ev.kind === "start") {
      api.peerVars.setMine("score", 0);
      api.peerVars.setMine("kills", 0);
      result = null;
      api.hud.clearRows("wv-result");
      api.hud.clearRows("wv-result-title");
      announce("WAVE 1", { sub: "Hold the crystal!", color: "#ff9c6b" });
      feel.sound("whistle");
    } else if (ev.kind === "wave") {
      announce("Wave " + s.wave, { sub: s.perLevel ? "Level " + s.level : void 0, ms: 1300 });
      feel.sound("whoosh");
    } else if (ev.kind === "level") {
      announce("LEVEL " + s.level, { sub: (
        /** @type {any} */
        LEVEL_NEWS[s.level] ?? "Faster"
      ), color: "#ffd24a", big: true });
      feel.sound("levelup");
      feel.haptic("success");
      const c = crystal(s);
      if (api.effects?.burst) api.effects.burst(c, { kind: "confetti", count: 80 });
      else juice.pop(c, 16765514);
    } else if (ev.kind === "breach") {
      juice.pop(ev.pos ?? crystal(s), 16726830);
      feel.sound(ev.blocked ? "ring" : "explosion", ev.pos);
      feel.haptic(ev.blocked ? "bump" : "fail");
      if (!ev.blocked) api.effects?.burst?.(crystal(s), { kind: "sparks", color: "#ff3b2e", count: 30 });
    } else if (ev.kind === "over") {
      if (ev.won) finish(s, true);
      else pendingLoss = { s, until: performance.now() / 1e3 + 1.5 };
    }
    pushRows();
  });
  function finish(s, won) {
    const run = { score: Number(api.peerVars.mine("score", 0)) || 0, level: s.level ?? 1, wave: s.wave, at: Date.now() };
    const isBest = !best || betterRun(best, run) === run;
    if (isBest) {
      best = run;
      api.storage?.set?.(BEST_KEY, best);
    }
    result = { won, level: run.level, wave: s.wave, waves: s.curve.waves, score: run.score, kills: Number(api.peerVars.mine("kills", 0)) || 0, best, isBest };
    const r = resultLines(result);
    announce(r.title, { sub: r.lines[1], color: won ? "#6fcf7a" : "#ff5a4a", ms: 2600, big: true });
    feel.sound(won ? "cheer" : "fail");
    feel.haptic(won ? "success" : "fail");
    if (won) {
      if (api.effects?.burst) api.effects.burst(crystal(s), { kind: "confetti", count: 120 });
      else juice.pop(crystal(s), 7327610);
    }
    pushRows();
  }
  let lastRows = 0;
  api.registerFrameTask(() => {
    const now = performance.now() / 1e3;
    if (now - lastRows > 1) {
      lastRows = now;
      pushRows();
    }
    if (!pendingLoss) return;
    if (crystalFell()) {
      const s = pendingLoss.s;
      pendingLoss = null;
      finish(s, false);
    } else if (performance.now() / 1e3 > pendingLoss.until) pendingLoss = null;
  });
  pushRows();
  return {
    best: () => best,
    result: () => result,
    said,
    announce,
    pushRows
  };
}

// modules/waves/src/menu.js
var ACTIONS = Object.freeze({
  ...Object.fromEntries(GUN_IDS.map((id) => ["wv-gun-" + id, () => ({ gun: id })])),
  ...Object.fromEntries(ABILITY_IDS.map((id) => ["wv-ab-" + id, () => ({ ability: id })])),
  "wv-opt-music": (p) => ({ music: cycle(MUSIC, p.music) }),
  "wv-opt-sfx": (p) => ({ sfx: !p.sfx }),
  "wv-opt-hand": (p) => ({ hand: cycle(HANDS, p.hand) }),
  "wv-opt-haptics": (p) => ({ haptics: !p.haptics })
});
var MUSIC_VOLUME = Object.freeze({ off: 0, low: 0.35, high: 0.7 });
var cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
function menuRows(p) {
  const gun = gunOf(p.gun).name;
  const ability = abilityOf(p.ability).name;
  return {
    "wv-loadout-now": [gun + " + " + ability],
    "wv-loadout-pick": ["Selected: " + gun + " + " + ability],
    "wv-opt-music-v": [cap(p.music)],
    "wv-opt-sfx-v": [p.sfx ? "On" : "Off"],
    "wv-opt-hand-v": [p.hand === "both" ? "Both" : cap(p.hand)],
    "wv-opt-haptics-v": [p.haptics ? "On" : "Off"],
    "wv-ability-label": [ability.toUpperCase() + (p.hand === "both" ? " \u2014 left grip / Q" : " \u2014 grip / Q")]
  };
}
function registerMenu(api, engine, prefs, feel) {
  const acted = /* @__PURE__ */ new Map();
  const pressed = (
    /** @type {string[]} */
    []
  );
  function pushRows() {
    for (const [id, rows] of Object.entries(menuRows(prefs.get()))) api.hud.rows(id, rows);
  }
  function sweep() {
    for (const node of api.flow.nodes("hudbutton")) {
      const element = String(node.data?.element ?? "");
      const act = ACTIONS[element];
      if (!act) continue;
      const stamp = api.flow.triggerStamp(node.id)?.stamp ?? null;
      if (!acted.has(node.id)) {
        acted.set(node.id, stamp);
        continue;
      }
      if (stamp === null || acted.get(node.id) === stamp) continue;
      acted.set(node.id, stamp);
      prefs.set(act(prefs.get()));
      pressed.push(element);
      if (pressed.length > 40) pressed.shift();
      feel.sound("click");
      feel.haptic("tap");
    }
  }
  let playing = (
    /** @type {string | null} */
    null
  );
  function music() {
    if (!api.music?.play) return;
    const p = prefs.get();
    const volume = (
      /** @type {any} */
      MUSIC_VOLUME[p.music] ?? 0
    );
    const want = inGame(api) && volume > 0 && engine.all().length > 0 ? "arcade@" + volume : null;
    if (want === playing) return;
    if (want) api.music.play("arcade", { volume });
    else api.music.stop?.();
    playing = want;
  }
  let lastStep = 0;
  function steps() {
    const t = performance.now() / 1e3;
    if (t - lastStep < 0.42 || !inGame(api)) return;
    const me = api.playerPosition?.();
    if (!me) return;
    let best = null;
    let bestD = 12;
    for (const e of engine.targets()) {
      if (!e.walking) continue;
      const o = api.objectsGroup()?.getObjectByProperty("uuid", e.uuid);
      if (!o) continue;
      const p = o.getWorldPosition(new api.THREE.Vector3());
      const d = Math.hypot(p.x - me[0], p.z - me[2]);
      if (d < bestD) {
        bestD = d;
        best = p.toArray();
      }
    }
    if (!best) return;
    lastStep = t;
    feel.sound("step", best);
  }
  let last = 0;
  let lastRows = 0;
  api.registerFrameTask(() => {
    const t = performance.now() / 1e3;
    try {
      steps();
      if (t - last < 0.1) return;
      last = t;
      sweep();
      music();
      if (t - lastRows > 1) {
        lastRows = t;
        pushRows();
      }
    } catch (error) {
      console.warn("[waves] menu failed", error);
    }
  });
  prefs.onChange(() => {
    pushRows();
    music();
  });
  pushRows();
  return { sweep, pressed, pushRows, playing: () => playing };
}

// modules/waves/src/gltf/loader.chunk
var loader_default = `var p=globalThis.__wavesTHREE;if(!p)throw new Error("waves: __wavesTHREE unset before the loader chunk");var se=p.AnimationClip,Bt=p.AnimationMixer,Ye=p.Bone,Ze=p.Box3,K=p.BufferAttribute,re=p.BufferGeometry,Qe=p.ClampToEdgeWrapping,C=p.Color,oe=p.ColorManagement,Je=p.DirectionalLight,$e=p.DoubleSide,ie=p.FileLoader,kt=p.Float32BufferAttribute,et=p.FrontSide,V=p.Group,tt=p.ImageBitmapLoader,ae=p.InstancedBufferAttribute,nt=p.InstancedMesh,ce=p.InterleavedBuffer,ue=p.InterleavedBufferAttribute,st=p.Interpolant,rt=p.InterpolateDiscrete,le=p.InterpolateLinear,ot=p.Line,it=p.LineBasicMaterial,at=p.LineLoop,ct=p.LineSegments,X=p.LinearFilter,fe=p.LinearMipmapLinearFilter,ut=p.LinearMipmapNearestFilter,I=p.LinearSRGBColorSpace,lt=p.Loader,P=p.LoaderUtils,q=p.Material,ft=p.MathUtils,H=p.Matrix4,dt=p.Mesh,D=p.MeshBasicMaterial,_=p.MeshPhysicalMaterial,de=p.MeshStandardMaterial,ht=p.MirroredRepeatWrapping,he=p.NearestFilter,pt=p.NearestMipmapLinearFilter,mt=p.NearestMipmapNearestFilter,pe=p.NumberKeyframeTrack,me=p.Object3D,gt=p.OrthographicCamera,Tt=p.PerspectiveCamera,xt=p.PointLight,At=p.Points,Rt=p.PointsMaterial,yt=p.PropertyBinding,W=p.Quaternion,Y=p.QuaternionKeyframeTrack,Z=p.RepeatWrapping,F=p.SRGBColorSpace,Mt=p.Skeleton,Pt=p.SkeletonHelper,bt=p.SkinnedMesh,wt=p.Sphere,Et=p.SpotLight,ge=p.Texture,St=p.TextureLoader,z=p.TriangleFanDrawMode,Q=p.TriangleStripDrawMode,_t=p.TrianglesDrawMode,Te=p.Vector2,L=p.Vector3,J=p.VectorKeyframeTrack;function xe(f,t){if(t===_t)return console.warn("THREE.BufferGeometryUtils.toTrianglesDrawMode(): Geometry already defined as triangles."),f;if(t===z||t===Q){let e=f.getIndex();if(e===null){let o=[],a=f.getAttribute("position");if(a!==void 0){for(let i=0;i<a.count;i++)o.push(i);f.setIndex(o),e=f.getIndex()}else return console.error("THREE.BufferGeometryUtils.toTrianglesDrawMode(): Undefined position attribute. Processing not possible."),f}let s=e.count-2,n=[];if(t===z)for(let o=1;o<=s;o++)n.push(e.getX(0)),n.push(e.getX(o)),n.push(e.getX(o+1));else for(let o=0;o<s;o++)o%2===0?(n.push(e.getX(o)),n.push(e.getX(o+1)),n.push(e.getX(o+2))):(n.push(e.getX(o+2)),n.push(e.getX(o+1)),n.push(e.getX(o)));n.length/3!==s&&console.error("THREE.BufferGeometryUtils.toTrianglesDrawMode(): Unable to generate correct amount of triangles.");let r=f.clone();return r.setIndex(n),r.clearGroups(),r}else return console.error("THREE.BufferGeometryUtils.toTrianglesDrawMode(): Unknown draw mode:",t),f}function Ae(f){let t=new Map,e=new Map,s=f.clone();return It(f,s,function(n,r){t.set(r,n),e.set(n,r)}),s.traverse(function(n){if(!n.isSkinnedMesh)return;let r=n,o=t.get(n),a=o.skeleton.bones;r.skeleton=o.skeleton.clone(),r.bindMatrix.copy(o.bindMatrix),r.skeleton.bones=a.map(function(i){return e.get(i)}),r.bind(r.skeleton,r.bindMatrix)}),s}function It(f,t,e){e(f,t);for(let s=0;s<f.children.length;s++)It(f.children[s],t.children[s],e)}var be=class extends lt{constructor(t){super(t),this.dracoLoader=null,this.ktx2Loader=null,this.meshoptDecoder=null,this.pluginCallbacks=[],this.register(function(e){return new _e(e)}),this.register(function(e){return new Ie(e)}),this.register(function(e){return new He(e)}),this.register(function(e){return new De(e)}),this.register(function(e){return new Fe(e)}),this.register(function(e){return new Ne(e)}),this.register(function(e){return new Oe(e)}),this.register(function(e){return new Ce(e)}),this.register(function(e){return new ve(e)}),this.register(function(e){return new Se(e)}),this.register(function(e){return new Be(e)}),this.register(function(e){return new Le(e)}),this.register(function(e){return new Pe(e)}),this.register(function(e){return new ke(e)}),this.register(function(e){return new we(e)}),this.register(function(e){return new $(e,T.EXT_MESHOPT_COMPRESSION)}),this.register(function(e){return new $(e,T.KHR_MESHOPT_COMPRESSION)}),this.register(function(e){return new Ue(e)})}load(t,e,s,n){let r=this,o;if(this.resourcePath!=="")o=this.resourcePath;else if(this.path!==""){let c=P.extractUrlBase(t);o=P.resolveURL(c,this.path)}else o=P.extractUrlBase(t);this.manager.itemStart(t);let a=function(c){n?n(c):console.error(c),r.manager.itemError(t),r.manager.itemEnd(t)},i=new ie(this.manager);i.setPath(this.path),i.setResponseType("arraybuffer"),i.setRequestHeader(this.requestHeader),i.setWithCredentials(this.withCredentials),i.load(t,function(c){try{r.parse(c,o,function(u){e(u),r.manager.itemEnd(t)},a)}catch(u){a(u)}},s,a)}setDRACOLoader(t){return this.dracoLoader=t,this}setKTX2Loader(t){return this.ktx2Loader=t,this}setMeshoptDecoder(t){return this.meshoptDecoder=t,this}register(t){return this.pluginCallbacks.indexOf(t)===-1&&this.pluginCallbacks.push(t),this}unregister(t){return this.pluginCallbacks.indexOf(t)!==-1&&this.pluginCallbacks.splice(this.pluginCallbacks.indexOf(t),1),this}parse(t,e,s,n){let r,o={},a={},i=new TextDecoder;if(typeof t=="string")r=JSON.parse(t);else if(t instanceof ArrayBuffer)if(i.decode(new Uint8Array(t,0,4))===vt){try{o[T.KHR_BINARY_GLTF]=new Ge(t)}catch(l){n&&n(l);return}r=JSON.parse(o[T.KHR_BINARY_GLTF].content)}else r=JSON.parse(i.decode(t));else r=t;if(r.asset===void 0||r.asset.version[0]<2){n&&n(new Error("THREE.GLTFLoader: Unsupported asset. glTF versions >=2.0 are supported."));return}let c=new We(r,{path:e||this.resourcePath||"",crossOrigin:this.crossOrigin,requestHeader:this.requestHeader,manager:this.manager,ktx2Loader:this.ktx2Loader,meshoptDecoder:this.meshoptDecoder});c.fileLoader.setRequestHeader(this.requestHeader);for(let u=0;u<this.pluginCallbacks.length;u++){let l=this.pluginCallbacks[u](c);l.name||console.error("THREE.GLTFLoader: Invalid plugin found: missing name"),a[l.name]=l,o[l.name]=!0}if(r.extensionsUsed)for(let u=0;u<r.extensionsUsed.length;++u){let l=r.extensionsUsed[u],d=r.extensionsRequired||[];switch(l){case T.KHR_MATERIALS_UNLIT:o[l]=new Ee;break;case T.KHR_DRACO_MESH_COMPRESSION:o[l]=new Ke(r,this.dracoLoader);break;case T.KHR_TEXTURE_TRANSFORM:o[l]=new ze;break;case T.KHR_MESH_QUANTIZATION:o[l]=new je;break;default:d.indexOf(l)>=0&&a[l]===void 0&&console.warn('THREE.GLTFLoader: Unknown extension "'+l+'".')}}c.setExtensions(o),c.setPlugins(a),c.parse(s,n)}parseAsync(t,e){let s=this;return new Promise(function(n,r){s.parse(t,e,n,r)})}};function Ht(){let f={};return{get:function(t){return f[t]},add:function(t,e){f[t]=e},remove:function(t){delete f[t]},removeAll:function(){f={}}}}function b(f,t,e){let s=f.json.materials[t];return s.extensions&&s.extensions[e]?s.extensions[e]:null}var T={KHR_BINARY_GLTF:"KHR_binary_glTF",KHR_DRACO_MESH_COMPRESSION:"KHR_draco_mesh_compression",KHR_LIGHTS_PUNCTUAL:"KHR_lights_punctual",KHR_MATERIALS_CLEARCOAT:"KHR_materials_clearcoat",KHR_MATERIALS_DISPERSION:"KHR_materials_dispersion",KHR_MATERIALS_IOR:"KHR_materials_ior",KHR_MATERIALS_SHEEN:"KHR_materials_sheen",KHR_MATERIALS_SPECULAR:"KHR_materials_specular",KHR_MATERIALS_TRANSMISSION:"KHR_materials_transmission",KHR_MATERIALS_IRIDESCENCE:"KHR_materials_iridescence",KHR_MATERIALS_ANISOTROPY:"KHR_materials_anisotropy",KHR_MATERIALS_UNLIT:"KHR_materials_unlit",KHR_MATERIALS_VOLUME:"KHR_materials_volume",KHR_TEXTURE_BASISU:"KHR_texture_basisu",KHR_TEXTURE_TRANSFORM:"KHR_texture_transform",KHR_MESH_QUANTIZATION:"KHR_mesh_quantization",KHR_MATERIALS_EMISSIVE_STRENGTH:"KHR_materials_emissive_strength",EXT_MATERIALS_BUMP:"EXT_materials_bump",EXT_TEXTURE_WEBP:"EXT_texture_webp",EXT_TEXTURE_AVIF:"EXT_texture_avif",EXT_MESHOPT_COMPRESSION:"EXT_meshopt_compression",KHR_MESHOPT_COMPRESSION:"KHR_meshopt_compression",EXT_MESH_GPU_INSTANCING:"EXT_mesh_gpu_instancing"},we=class{constructor(t){this.parser=t,this.name=T.KHR_LIGHTS_PUNCTUAL,this.cache={refs:{},uses:{}}}_markDefs(){let t=this.parser,e=this.parser.json.nodes||[];for(let s=0,n=e.length;s<n;s++){let r=e[s];r.extensions&&r.extensions[this.name]&&r.extensions[this.name].light!==void 0&&t._addNodeRef(this.cache,r.extensions[this.name].light)}}_loadLight(t){let e=this.parser,s="light:"+t,n=e.cache.get(s);if(n)return n;let r=e.json,i=((r.extensions&&r.extensions[this.name]||{}).lights||[])[t],c,u=new C(16777215);i.color!==void 0&&u.setRGB(i.color[0],i.color[1],i.color[2],I);let l=i.range!==void 0?i.range:0;switch(i.type){case"directional":c=new Je(u),c.target.position.set(0,0,-1),c.add(c.target);break;case"point":c=new xt(u),c.distance=l;break;case"spot":c=new Et(u),c.distance=l,i.spot=i.spot||{},i.spot.innerConeAngle=i.spot.innerConeAngle!==void 0?i.spot.innerConeAngle:0,i.spot.outerConeAngle=i.spot.outerConeAngle!==void 0?i.spot.outerConeAngle:Math.PI/4,c.angle=i.spot.outerConeAngle,c.penumbra=1-i.spot.innerConeAngle/i.spot.outerConeAngle,c.target.position.set(0,0,-1),c.add(c.target);break;default:throw new Error("THREE.GLTFLoader: Unexpected light type: "+i.type)}return c.position.set(0,0,0),N(c,i),i.intensity!==void 0&&(c.intensity=i.intensity),c.name=e.createUniqueName(i.name||"light_"+t),n=Promise.resolve(c),e.cache.add(s,n),n}getDependency(t,e){if(t==="light")return this._loadLight(e)}createNodeAttachment(t){let e=this,s=this.parser,r=s.json.nodes[t],a=(r.extensions&&r.extensions[this.name]||{}).light;return a===void 0?null:this._loadLight(a).then(function(i){return s._getNodeRef(e.cache,a,i)})}},Ee=class{constructor(){this.name=T.KHR_MATERIALS_UNLIT}getMaterialType(){return D}extendParams(t,e,s){let n=[];t.color=new C(1,1,1),t.opacity=1;let r=e.pbrMetallicRoughness;if(r){if(Array.isArray(r.baseColorFactor)){let o=r.baseColorFactor;t.color.setRGB(o[0],o[1],o[2],I),t.opacity=o[3]}r.baseColorTexture!==void 0&&n.push(s.assignTexture(t,"map",r.baseColorTexture,F))}return Promise.all(n)}},Se=class{constructor(t){this.parser=t,this.name=T.KHR_MATERIALS_EMISSIVE_STRENGTH}extendMaterialParams(t,e){let s=b(this.parser,t,this.name);return s===null||s.emissiveStrength!==void 0&&(e.emissiveIntensity=s.emissiveStrength),Promise.resolve()}},_e=class{constructor(t){this.parser=t,this.name=T.KHR_MATERIALS_CLEARCOAT}getMaterialType(t){return b(this.parser,t,this.name)!==null?_:null}extendMaterialParams(t,e){let s=b(this.parser,t,this.name);if(s===null)return Promise.resolve();let n=[];if(s.clearcoatFactor!==void 0&&(e.clearcoat=s.clearcoatFactor),s.clearcoatTexture!==void 0&&n.push(this.parser.assignTexture(e,"clearcoatMap",s.clearcoatTexture)),s.clearcoatRoughnessFactor!==void 0&&(e.clearcoatRoughness=s.clearcoatRoughnessFactor),s.clearcoatRoughnessTexture!==void 0&&n.push(this.parser.assignTexture(e,"clearcoatRoughnessMap",s.clearcoatRoughnessTexture)),s.clearcoatNormalTexture!==void 0&&(n.push(this.parser.assignTexture(e,"clearcoatNormalMap",s.clearcoatNormalTexture)),s.clearcoatNormalTexture.scale!==void 0)){let r=s.clearcoatNormalTexture.scale;e.clearcoatNormalScale=new Te(r,r)}return Promise.all(n)}},Ie=class{constructor(t){this.parser=t,this.name=T.KHR_MATERIALS_DISPERSION}getMaterialType(t){return b(this.parser,t,this.name)!==null?_:null}extendMaterialParams(t,e){let s=b(this.parser,t,this.name);return s===null||(e.dispersion=s.dispersion!==void 0?s.dispersion:0),Promise.resolve()}},Le=class{constructor(t){this.parser=t,this.name=T.KHR_MATERIALS_IRIDESCENCE}getMaterialType(t){return b(this.parser,t,this.name)!==null?_:null}extendMaterialParams(t,e){let s=b(this.parser,t,this.name);if(s===null)return Promise.resolve();let n=[];return s.iridescenceFactor!==void 0&&(e.iridescence=s.iridescenceFactor),s.iridescenceTexture!==void 0&&n.push(this.parser.assignTexture(e,"iridescenceMap",s.iridescenceTexture)),s.iridescenceIor!==void 0&&(e.iridescenceIOR=s.iridescenceIor),e.iridescenceThicknessRange===void 0&&(e.iridescenceThicknessRange=[100,400]),s.iridescenceThicknessMinimum!==void 0&&(e.iridescenceThicknessRange[0]=s.iridescenceThicknessMinimum),s.iridescenceThicknessMaximum!==void 0&&(e.iridescenceThicknessRange[1]=s.iridescenceThicknessMaximum),s.iridescenceThicknessTexture!==void 0&&n.push(this.parser.assignTexture(e,"iridescenceThicknessMap",s.iridescenceThicknessTexture)),Promise.all(n)}},Ne=class{constructor(t){this.parser=t,this.name=T.KHR_MATERIALS_SHEEN}getMaterialType(t){return b(this.parser,t,this.name)!==null?_:null}extendMaterialParams(t,e){let s=b(this.parser,t,this.name);if(s===null)return Promise.resolve();let n=[];if(e.sheenColor=new C(0,0,0),e.sheenRoughness=0,e.sheen=1,s.sheenColorFactor!==void 0){let r=s.sheenColorFactor;e.sheenColor.setRGB(r[0],r[1],r[2],I)}return s.sheenRoughnessFactor!==void 0&&(e.sheenRoughness=s.sheenRoughnessFactor),s.sheenColorTexture!==void 0&&n.push(this.parser.assignTexture(e,"sheenColorMap",s.sheenColorTexture,F)),s.sheenRoughnessTexture!==void 0&&n.push(this.parser.assignTexture(e,"sheenRoughnessMap",s.sheenRoughnessTexture)),Promise.all(n)}},Oe=class{constructor(t){this.parser=t,this.name=T.KHR_MATERIALS_TRANSMISSION}getMaterialType(t){return b(this.parser,t,this.name)!==null?_:null}extendMaterialParams(t,e){let s=b(this.parser,t,this.name);if(s===null)return Promise.resolve();let n=[];return s.transmissionFactor!==void 0&&(e.transmission=s.transmissionFactor),s.transmissionTexture!==void 0&&n.push(this.parser.assignTexture(e,"transmissionMap",s.transmissionTexture)),Promise.all(n)}},Ce=class{constructor(t){this.parser=t,this.name=T.KHR_MATERIALS_VOLUME}getMaterialType(t){return b(this.parser,t,this.name)!==null?_:null}extendMaterialParams(t,e){let s=b(this.parser,t,this.name);if(s===null)return Promise.resolve();let n=[];e.thickness=s.thicknessFactor!==void 0?s.thicknessFactor:0,s.thicknessTexture!==void 0&&n.push(this.parser.assignTexture(e,"thicknessMap",s.thicknessTexture)),e.attenuationDistance=s.attenuationDistance||1/0;let r=s.attenuationColor||[1,1,1];return e.attenuationColor=new C().setRGB(r[0],r[1],r[2],I),Promise.all(n)}},ve=class{constructor(t){this.parser=t,this.name=T.KHR_MATERIALS_IOR}getMaterialType(t){return b(this.parser,t,this.name)!==null?_:null}extendMaterialParams(t,e){let s=b(this.parser,t,this.name);return s===null||(e.ior=s.ior!==void 0?s.ior:1.5,e.ior===0&&(e.ior=1e3)),Promise.resolve()}},Be=class{constructor(t){this.parser=t,this.name=T.KHR_MATERIALS_SPECULAR}getMaterialType(t){return b(this.parser,t,this.name)!==null?_:null}extendMaterialParams(t,e){let s=b(this.parser,t,this.name);if(s===null)return Promise.resolve();let n=[];e.specularIntensity=s.specularFactor!==void 0?s.specularFactor:1,s.specularTexture!==void 0&&n.push(this.parser.assignTexture(e,"specularIntensityMap",s.specularTexture));let r=s.specularColorFactor||[1,1,1];return e.specularColor=new C().setRGB(r[0],r[1],r[2],I),s.specularColorTexture!==void 0&&n.push(this.parser.assignTexture(e,"specularColorMap",s.specularColorTexture,F)),Promise.all(n)}},ke=class{constructor(t){this.parser=t,this.name=T.EXT_MATERIALS_BUMP}getMaterialType(t){return b(this.parser,t,this.name)!==null?_:null}extendMaterialParams(t,e){let s=b(this.parser,t,this.name);if(s===null)return Promise.resolve();let n=[];return e.bumpScale=s.bumpFactor!==void 0?s.bumpFactor:1,s.bumpTexture!==void 0&&n.push(this.parser.assignTexture(e,"bumpMap",s.bumpTexture)),Promise.all(n)}},Pe=class{constructor(t){this.parser=t,this.name=T.KHR_MATERIALS_ANISOTROPY}getMaterialType(t){return b(this.parser,t,this.name)!==null?_:null}extendMaterialParams(t,e){let s=b(this.parser,t,this.name);if(s===null)return Promise.resolve();let n=[];return s.anisotropyStrength!==void 0&&(e.anisotropy=s.anisotropyStrength),s.anisotropyRotation!==void 0&&(e.anisotropyRotation=s.anisotropyRotation),s.anisotropyTexture!==void 0&&n.push(this.parser.assignTexture(e,"anisotropyMap",s.anisotropyTexture)),Promise.all(n)}},He=class{constructor(t){this.parser=t,this.name=T.KHR_TEXTURE_BASISU}loadTexture(t){let e=this.parser,s=e.json,n=s.textures[t];if(!n.extensions||!n.extensions[this.name])return null;let r=n.extensions[this.name],o=e.options.ktx2Loader;if(!o){if(s.extensionsRequired&&s.extensionsRequired.indexOf(this.name)>=0)throw new Error("THREE.GLTFLoader: setKTX2Loader must be called before loading KTX2 textures");return null}return e.loadTextureImage(t,r.source,o)}},De=class{constructor(t){this.parser=t,this.name=T.EXT_TEXTURE_WEBP}loadTexture(t){let e=this.name,s=this.parser,n=s.json,r=n.textures[t];if(!r.extensions||!r.extensions[e])return null;let o=r.extensions[e],a=n.images[o.source],i=s.textureLoader;if(a.uri){let c=s.options.manager.getHandler(a.uri);c!==null&&(i=c)}return s.loadTextureImage(t,o.source,i)}},Fe=class{constructor(t){this.parser=t,this.name=T.EXT_TEXTURE_AVIF}loadTexture(t){let e=this.name,s=this.parser,n=s.json,r=n.textures[t];if(!r.extensions||!r.extensions[e])return null;let o=r.extensions[e],a=n.images[o.source],i=s.textureLoader;if(a.uri){let c=s.options.manager.getHandler(a.uri);c!==null&&(i=c)}return s.loadTextureImage(t,o.source,i)}},$=class{constructor(t,e){this.name=e,this.parser=t}loadBufferView(t){let e=this.parser.json,s=e.bufferViews[t];if(s.extensions&&s.extensions[this.name]){let n=s.extensions[this.name],r=this.parser.getDependency("buffer",n.buffer),o=this.parser.options.meshoptDecoder;if(!o||!o.supported){if(e.extensionsRequired&&e.extensionsRequired.indexOf(this.name)>=0)throw new Error("THREE.GLTFLoader: setMeshoptDecoder must be called before loading compressed files");return null}return r.then(function(a){let i=n.byteOffset||0,c=n.byteLength||0,u=n.count,l=n.byteStride,d=new Uint8Array(a,i,c);return o.decodeGltfBufferAsync?o.decodeGltfBufferAsync(u,l,d,n.mode,n.filter).then(function(h){return h.buffer}):o.ready.then(function(){let h=new ArrayBuffer(u*l);return o.decodeGltfBuffer(new Uint8Array(h),u,l,d,n.mode,n.filter),h})})}else return null}},Ue=class{constructor(t){this.name=T.EXT_MESH_GPU_INSTANCING,this.parser=t}createNodeMesh(t){let e=this.parser.json,s=e.nodes[t];if(!s.extensions||!s.extensions[this.name]||s.mesh===void 0)return null;let n=e.meshes[s.mesh];for(let c of n.primitives)if(c.mode!==E.TRIANGLES&&c.mode!==E.TRIANGLE_STRIP&&c.mode!==E.TRIANGLE_FAN&&c.mode!==void 0)return null;let o=s.extensions[this.name].attributes,a=[],i={};for(let c in o)a.push(this.parser.getDependency("accessor",o[c]).then(u=>(i[c]=u,i[c])));return a.length<1?null:(a.push(this.parser.createNodeMesh(t)),Promise.all(a).then(c=>{let u=c.pop(),l=u.isGroup?u.children:[u],d=c[0].count,h=[];for(let m of l){let A=new H,g=new L,x=new W,M=new L(1,1,1),y=new nt(m.geometry,m.material,d);for(let R=0;R<d;R++)i.TRANSLATION&&g.fromBufferAttribute(i.TRANSLATION,R),i.ROTATION&&x.fromBufferAttribute(i.ROTATION,R),i.SCALE&&M.fromBufferAttribute(i.SCALE,R),y.setMatrixAt(R,A.compose(g,x,M));for(let R in i)if(R==="_COLOR_0"){let w=i[R];y.instanceColor=new ae(w.array,w.itemSize,w.normalized)}else R!=="TRANSLATION"&&R!=="ROTATION"&&R!=="SCALE"&&m.geometry.setAttribute(R,i[R]);me.prototype.copy.call(y,m),this.parser.assignFinalMaterial(y),h.push(y)}return u.isGroup?(u.clear(),u.add(...h),u):h[0]}))}},vt="glTF",j=12,Lt={JSON:1313821514,BIN:5130562},Ge=class{constructor(t){this.name=T.KHR_BINARY_GLTF,this.content=null,this.body=null;let e=new DataView(t,0,j),s=new TextDecoder;if(this.header={magic:s.decode(new Uint8Array(t.slice(0,4))),version:e.getUint32(4,!0),length:e.getUint32(8,!0)},this.header.magic!==vt)throw new Error("THREE.GLTFLoader: Unsupported glTF-Binary header.");if(this.header.version<2)throw new Error("THREE.GLTFLoader: Legacy binary file detected.");let n=this.header.length-j,r=new DataView(t,j),o=0;for(;o<n;){let a=r.getUint32(o,!0);o+=4;let i=r.getUint32(o,!0);if(o+=4,i===Lt.JSON){let c=new Uint8Array(t,j+o,a);this.content=s.decode(c)}else if(i===Lt.BIN){let c=j+o;this.body=t.slice(c,c+a)}o+=a}if(this.content===null)throw new Error("THREE.GLTFLoader: JSON content not found.")}},Ke=class{constructor(t,e){if(!e)throw new Error("THREE.GLTFLoader: No DRACOLoader instance provided.");this.name=T.KHR_DRACO_MESH_COMPRESSION,this.json=t,this.dracoLoader=e,this.dracoLoader.preload()}decodePrimitive(t,e){let s=this.json,n=this.dracoLoader,r=t.extensions[this.name].bufferView,o=t.extensions[this.name].attributes,a={},i={},c={};for(let u in o){let l=Xe[u]||u.toLowerCase();a[l]=o[u]}for(let u in t.attributes){let l=Xe[u]||u.toLowerCase();if(o[u]!==void 0){let d=s.accessors[t.attributes[u]],h=U[d.componentType];c[l]=h.name,i[l]=d.normalized===!0}}return e.getDependency("bufferView",r).then(function(u){return new Promise(function(l,d){n.decodeDracoFile(u,function(h){for(let m in h.attributes){let A=h.attributes[m],g=i[m];g!==void 0&&(A.normalized=g)}l(h)},a,c,I,d)})})}},ze=class{constructor(){this.name=T.KHR_TEXTURE_TRANSFORM}extendTexture(t,e){return(e.texCoord===void 0||e.texCoord===t.channel)&&e.offset===void 0&&e.rotation===void 0&&e.scale===void 0||(t=t.clone(),e.texCoord!==void 0&&(t.channel=e.texCoord),e.offset!==void 0&&t.offset.fromArray(e.offset),e.rotation!==void 0&&(t.rotation=e.rotation),e.scale!==void 0&&t.repeat.fromArray(e.scale),t.needsUpdate=!0),t}},je=class{constructor(){this.name=T.KHR_MESH_QUANTIZATION}},ee=class extends st{constructor(t,e,s,n){super(t,e,s,n)}copySampleValue_(t){let e=this.resultBuffer,s=this.sampleValues,n=this.valueSize,r=t*n*3+n;for(let o=0;o!==n;o++)e[o]=s[r+o];return e}interpolate_(t,e,s,n){let r=this.resultBuffer,o=this.sampleValues,a=this.valueSize,i=a*2,c=a*3,u=n-e,l=(s-e)/u,d=l*l,h=d*l,m=t*c,A=m-c,g=-2*h+3*d,x=h-d,M=1-g,y=x-d+l;for(let R=0;R!==a;R++){let w=o[A+R+a],O=o[A+R+i]*u,S=o[m+R+a],G=o[m+R]*u;r[R]=M*w+y*O+g*S+x*G}return r}},Dt=new W,Ve=class extends ee{interpolate_(t,e,s,n){let r=super.interpolate_(t,e,s,n);return Dt.fromArray(r).normalize().toArray(r),r}},E={FLOAT:5126,FLOAT_MAT3:35675,FLOAT_MAT4:35676,FLOAT_VEC2:35664,FLOAT_VEC3:35665,FLOAT_VEC4:35666,LINEAR:9729,REPEAT:10497,SAMPLER_2D:35678,POINTS:0,LINES:1,LINE_LOOP:2,LINE_STRIP:3,TRIANGLES:4,TRIANGLE_STRIP:5,TRIANGLE_FAN:6,UNSIGNED_BYTE:5121,UNSIGNED_SHORT:5123},U={5120:Int8Array,5121:Uint8Array,5122:Int16Array,5123:Uint16Array,5125:Uint32Array,5126:Float32Array},Nt={9728:he,9729:X,9984:mt,9985:ut,9986:pt,9987:fe},Ot={33071:Qe,33648:ht,10497:Z},Re={SCALAR:1,VEC2:2,VEC3:3,VEC4:4,MAT2:4,MAT3:9,MAT4:16},Xe={POSITION:"position",NORMAL:"normal",TANGENT:"tangent",TEXCOORD_0:"uv",TEXCOORD_1:"uv1",TEXCOORD_2:"uv2",TEXCOORD_3:"uv3",COLOR_0:"color",WEIGHTS_0:"skinWeight",JOINTS_0:"skinIndex"},v={scale:"scale",translation:"position",rotation:"quaternion",weights:"morphTargetInfluences"},Ft={CUBICSPLINE:void 0,LINEAR:le,STEP:rt},ye={OPAQUE:"OPAQUE",MASK:"MASK",BLEND:"BLEND"};function Ut(f){return f.DefaultMaterial===void 0&&(f.DefaultMaterial=new de({color:16777215,emissive:0,metalness:1,roughness:1,transparent:!1,depthTest:!0,side:et})),f.DefaultMaterial}function B(f,t,e){for(let s in e.extensions)f[s]===void 0&&(t.userData.gltfExtensions=t.userData.gltfExtensions||{},t.userData.gltfExtensions[s]=e.extensions[s])}function N(f,t){t.extras!==void 0&&(typeof t.extras=="object"?Object.assign(f.userData,t.extras):console.warn("THREE.GLTFLoader: Ignoring primitive type .extras, "+t.extras))}function Gt(f,t,e){let s=!1,n=!1,r=!1;for(let c=0,u=t.length;c<u;c++){let l=t[c];if(l.POSITION!==void 0&&(s=!0),l.NORMAL!==void 0&&(n=!0),l.COLOR_0!==void 0&&(r=!0),s&&n&&r)break}if(!s&&!n&&!r)return Promise.resolve(f);let o=[],a=[],i=[];for(let c=0,u=t.length;c<u;c++){let l=t[c];if(s){let d=l.POSITION!==void 0?e.getDependency("accessor",l.POSITION):f.attributes.position;o.push(d)}if(n){let d=l.NORMAL!==void 0?e.getDependency("accessor",l.NORMAL):f.attributes.normal;a.push(d)}if(r){let d=l.COLOR_0!==void 0?e.getDependency("accessor",l.COLOR_0):f.attributes.color;i.push(d)}}return Promise.all([Promise.all(o),Promise.all(a),Promise.all(i)]).then(function(c){let u=c[0],l=c[1],d=c[2];return s&&(f.morphAttributes.position=u),n&&(f.morphAttributes.normal=l),r&&(f.morphAttributes.color=d),f.morphTargetsRelative=!0,f})}function Kt(f,t){if(f.updateMorphTargets(),t.weights!==void 0)for(let e=0,s=t.weights.length;e<s;e++)f.morphTargetInfluences[e]=t.weights[e];if(t.extras&&Array.isArray(t.extras.targetNames)){let e=t.extras.targetNames;if(f.morphTargetInfluences.length===e.length){f.morphTargetDictionary={};for(let s=0,n=e.length;s<n;s++)f.morphTargetDictionary[e[s]]=s}else console.warn("THREE.GLTFLoader: Invalid extras.targetNames length. Ignoring names.")}}function zt(f){let t,e=f.extensions&&f.extensions[T.KHR_DRACO_MESH_COMPRESSION];if(e?t="draco:"+e.bufferView+":"+e.indices+":"+Me(e.attributes):t=f.indices+":"+Me(f.attributes)+":"+f.mode,f.targets!==void 0)for(let s=0,n=f.targets.length;s<n;s++)t+=":"+Me(f.targets[s]);return t}function Me(f){let t="",e=Object.keys(f).sort();for(let s=0,n=e.length;s<n;s++)t+=e[s]+":"+f[e[s]]+";";return t}function qe(f){switch(f){case Int8Array:return 1/127;case Uint8Array:return 1/255;case Int16Array:return 1/32767;case Uint16Array:return 1/65535;default:throw new Error("THREE.GLTFLoader: Unsupported normalized accessor component type.")}}function jt(f){return f.search(/\\.jpe?g($|\\?)/i)>0||f.search(/^data\\:image\\/jpeg/)===0?"image/jpeg":f.search(/\\.webp($|\\?)/i)>0||f.search(/^data\\:image\\/webp/)===0?"image/webp":f.search(/\\.ktx2($|\\?)/i)>0||f.search(/^data\\:image\\/ktx2/)===0?"image/ktx2":"image/png"}var Vt=new H,We=class{constructor(t={},e={}){this.json=t,this.extensions={},this.plugins={},this.options=e,this.cache=new Ht,this.associations=new Map,this.primitiveCache={},this.nodeCache={},this.meshCache={refs:{},uses:{}},this.cameraCache={refs:{},uses:{}},this.lightCache={refs:{},uses:{}},this.sourceCache={},this.textureCache={},this.nodeNamesUsed={};let s=!1,n=-1,r=!1,o=-1;if(typeof navigator<"u"&&typeof navigator.userAgent<"u"){let a=navigator.userAgent;s=/^((?!chrome|android).)*safari/i.test(a)===!0;let i=a.match(/Version\\/(\\d+)/);n=s&&i?parseInt(i[1],10):-1,r=a.indexOf("Firefox")>-1,o=r?a.match(/Firefox\\/([0-9]+)\\./)[1]:-1}typeof createImageBitmap>"u"||s&&n<17||r&&o<98?this.textureLoader=new St(this.options.manager):this.textureLoader=new tt(this.options.manager),this.textureLoader.setCrossOrigin(this.options.crossOrigin),this.textureLoader.setRequestHeader(this.options.requestHeader),this.fileLoader=new ie(this.options.manager),this.fileLoader.setResponseType("arraybuffer"),this.options.crossOrigin==="use-credentials"&&this.fileLoader.setWithCredentials(!0)}setExtensions(t){this.extensions=t}setPlugins(t){this.plugins=t}parse(t,e){let s=this,n=this.json,r=this.extensions;this.cache.removeAll(),this.nodeCache={},this._invokeAll(function(o){return o._markDefs&&o._markDefs()}),Promise.all(this._invokeAll(function(o){return o.beforeRoot&&o.beforeRoot()})).then(function(){return Promise.all([s.getDependencies("scene"),s.getDependencies("animation"),s.getDependencies("camera")])}).then(function(o){let a={scene:o[0][n.scene||0],scenes:o[0],animations:o[1],cameras:o[2],asset:n.asset,parser:s,userData:{}};return B(r,a,n),N(a,n),Promise.all(s._invokeAll(function(i){return i.afterRoot&&i.afterRoot(a)})).then(function(){for(let i of a.scenes)i.updateMatrixWorld();t(a)})}).catch(e)}_markDefs(){let t=this.json.nodes||[],e=this.json.skins||[],s=this.json.meshes||[];for(let n=0,r=e.length;n<r;n++){let o=e[n].joints;for(let a=0,i=o.length;a<i;a++)t[o[a]].isBone=!0}for(let n=0,r=t.length;n<r;n++){let o=t[n];o.mesh!==void 0&&(this._addNodeRef(this.meshCache,o.mesh),o.skin!==void 0&&(s[o.mesh].isSkinnedMesh=!0)),o.camera!==void 0&&this._addNodeRef(this.cameraCache,o.camera)}}_addNodeRef(t,e){e!==void 0&&(t.refs[e]===void 0&&(t.refs[e]=t.uses[e]=0),t.refs[e]++)}_getNodeRef(t,e,s){if(t.refs[e]<=1)return s;let n=s.clone(),r=(o,a)=>{let i=this.associations.get(o);i!=null&&this.associations.set(a,i);for(let[c,u]of o.children.entries())r(u,a.children[c])};return r(s,n),n.name+="_instance_"+t.uses[e]++,n}_invokeOne(t){let e=Object.values(this.plugins);e.push(this);for(let s=0;s<e.length;s++){let n=t(e[s]);if(n)return n}return null}_invokeAll(t){let e=Object.values(this.plugins);e.unshift(this);let s=[];for(let n=0;n<e.length;n++){let r=t(e[n]);r&&s.push(r)}return s}getDependency(t,e){let s=t+":"+e,n=this.cache.get(s);if(!n){switch(t){case"scene":n=this.loadScene(e);break;case"node":n=this._invokeOne(function(r){return r.loadNode&&r.loadNode(e)});break;case"mesh":n=this._invokeOne(function(r){return r.loadMesh&&r.loadMesh(e)});break;case"accessor":n=this.loadAccessor(e);break;case"bufferView":n=this._invokeOne(function(r){return r.loadBufferView&&r.loadBufferView(e)});break;case"buffer":n=this.loadBuffer(e);break;case"material":n=this._invokeOne(function(r){return r.loadMaterial&&r.loadMaterial(e)});break;case"texture":n=this._invokeOne(function(r){return r.loadTexture&&r.loadTexture(e)});break;case"skin":n=this.loadSkin(e);break;case"animation":n=this._invokeOne(function(r){return r.loadAnimation&&r.loadAnimation(e)});break;case"camera":n=this.loadCamera(e);break;default:if(n=this._invokeOne(function(r){return r!=this&&r.getDependency&&r.getDependency(t,e)}),!n)throw new Error("Unknown type: "+t);break}this.cache.add(s,n)}return n}getDependencies(t){let e=this.cache.get(t);if(!e){let s=this,n=this.json[t+(t==="mesh"?"es":"s")]||[];e=Promise.all(n.map(function(r,o){return s.getDependency(t,o)})),this.cache.add(t,e)}return e}loadBuffer(t){let e=this.json.buffers[t],s=this.fileLoader;if(e.type&&e.type!=="arraybuffer")throw new Error("THREE.GLTFLoader: "+e.type+" buffer type is not supported.");if(e.uri===void 0&&t===0)return Promise.resolve(this.extensions[T.KHR_BINARY_GLTF].body);let n=this.options;return new Promise(function(r,o){s.load(P.resolveURL(e.uri,n.path),r,void 0,function(){o(new Error('THREE.GLTFLoader: Failed to load buffer "'+e.uri+'".'))})})}loadBufferView(t){let e=this.json.bufferViews[t];return this.getDependency("buffer",e.buffer).then(function(s){let n=e.byteLength||0,r=e.byteOffset||0;return s.slice(r,r+n)})}loadAccessor(t){let e=this,s=this.json,n=this.json.accessors[t];if(n.bufferView===void 0&&n.sparse===void 0){let o=Re[n.type],a=U[n.componentType],i=n.normalized===!0,c=new a(n.count*o);return Promise.resolve(new K(c,o,i))}let r=[];return n.bufferView!==void 0?r.push(this.getDependency("bufferView",n.bufferView)):r.push(null),n.sparse!==void 0&&(r.push(this.getDependency("bufferView",n.sparse.indices.bufferView)),r.push(this.getDependency("bufferView",n.sparse.values.bufferView))),Promise.all(r).then(function(o){let a=o[0],i=Re[n.type],c=U[n.componentType],u=c.BYTES_PER_ELEMENT,l=u*i,d=n.byteOffset||0,h=n.bufferView!==void 0?s.bufferViews[n.bufferView].byteStride:void 0,m=n.normalized===!0,A,g;if(h&&h!==l){let x=Math.floor(d/h),M="InterleavedBuffer:"+n.bufferView+":"+n.componentType+":"+x+":"+n.count,y=e.cache.get(M);y||(A=new c(a,x*h,n.count*h/u),y=new ce(A,h/u),e.cache.add(M,y)),g=new ue(y,i,d%h/u,m)}else a===null?A=new c(n.count*i):A=new c(a,d,n.count*i),g=new K(A,i,m);if(n.sparse!==void 0){let x=Re.SCALAR,M=U[n.sparse.indices.componentType],y=n.sparse.indices.byteOffset||0,R=n.sparse.values.byteOffset||0,w=new M(o[1],y,n.sparse.count*x),O=new c(o[2],R,n.sparse.count*i);a!==null&&(g=new K(g.array.slice(),g.itemSize,g.normalized)),g.normalized=!1;for(let S=0,G=w.length;S<G;S++){let k=w[S];if(g.setX(k,O[S*i]),i>=2&&g.setY(k,O[S*i+1]),i>=3&&g.setZ(k,O[S*i+2]),i>=4&&g.setW(k,O[S*i+3]),i>=5)throw new Error("THREE.GLTFLoader: Unsupported itemSize in sparse BufferAttribute.")}g.normalized=m}return g})}loadTexture(t){let e=this.json,s=this.options,r=e.textures[t].source,o=e.images[r],a=this.textureLoader;if(o.uri){let i=s.manager.getHandler(o.uri);i!==null&&(a=i)}return this.loadTextureImage(t,r,a)}loadTextureImage(t,e,s){let n=this,r=this.json,o=r.textures[t],a=r.images[e],i=(a.uri||a.bufferView)+":"+o.sampler;if(this.textureCache[i])return this.textureCache[i];let c=this.loadImageSource(e,s).then(function(u){u.flipY=!1,u.name=o.name||a.name||"",u.name===""&&typeof a.uri=="string"&&a.uri.startsWith("data:image/")===!1&&(u.name=a.uri);let d=(r.samplers||{})[o.sampler]||{};return u.magFilter=Nt[d.magFilter]||X,u.minFilter=Nt[d.minFilter]||fe,u.wrapS=Ot[d.wrapS]||Z,u.wrapT=Ot[d.wrapT]||Z,u.generateMipmaps=!u.isCompressedTexture&&u.minFilter!==he&&u.minFilter!==X,n.associations.set(u,{textures:t}),u}).catch(function(){return null});return this.textureCache[i]=c,c}loadImageSource(t,e){let s=this,n=this.json,r=this.options;if(this.sourceCache[t]!==void 0)return this.sourceCache[t].then(l=>l.clone());let o=n.images[t],a=self.URL||self.webkitURL,i=o.uri||"",c=!1;if(o.bufferView!==void 0)i=s.getDependency("bufferView",o.bufferView).then(function(l){c=!0;let d=new Blob([l],{type:o.mimeType});return i=a.createObjectURL(d),i});else if(o.uri===void 0)throw new Error("THREE.GLTFLoader: Image "+t+" is missing URI and bufferView");let u=Promise.resolve(i).then(function(l){return new Promise(function(d,h){let m=d;e.isImageBitmapLoader===!0&&(m=function(A){let g=new ge(A);g.needsUpdate=!0,d(g)}),e.load(P.resolveURL(l,r.path),m,void 0,h)})}).then(function(l){return c===!0&&a.revokeObjectURL(i),N(l,o),l.userData.mimeType=o.mimeType||jt(o.uri),l}).catch(function(l){throw console.error("THREE.GLTFLoader: Couldn't load texture",i),l});return this.sourceCache[t]=u,u}assignTexture(t,e,s,n){let r=this;return this.getDependency("texture",s.index).then(function(o){if(!o)return null;if(s.texCoord!==void 0&&s.texCoord>0&&(o=o.clone(),o.channel=s.texCoord),r.extensions[T.KHR_TEXTURE_TRANSFORM]){let a=s.extensions!==void 0?s.extensions[T.KHR_TEXTURE_TRANSFORM]:void 0;if(a){let i=r.associations.get(o);o=r.extensions[T.KHR_TEXTURE_TRANSFORM].extendTexture(o,a),r.associations.set(o,i)}}return n!==void 0&&(o.colorSpace=n),t[e]=o,o})}assignFinalMaterial(t){let e=t.geometry,s=t.material,n=e.attributes.tangent===void 0,r=e.attributes.color!==void 0,o=e.attributes.normal===void 0;if(t.isPoints){let a="PointsMaterial:"+s.uuid,i=this.cache.get(a);i||(i=new Rt,q.prototype.copy.call(i,s),i.color.copy(s.color),i.map=s.map,i.sizeAttenuation=!1,this.cache.add(a,i)),s=i}else if(t.isLine){let a="LineBasicMaterial:"+s.uuid,i=this.cache.get(a);i||(i=new it,q.prototype.copy.call(i,s),i.color.copy(s.color),i.map=s.map,this.cache.add(a,i)),s=i}if(n||r||o){let a="ClonedMaterial:"+s.uuid+":";n&&(a+="derivative-tangents:"),r&&(a+="vertex-colors:"),o&&(a+="flat-shading:");let i=this.cache.get(a);i||(i=s.clone(),r&&(i.vertexColors=!0),o&&(i.flatShading=!0),n&&(i.normalScale&&(i.normalScale.y*=-1),i.clearcoatNormalScale&&(i.clearcoatNormalScale.y*=-1)),this.cache.add(a,i),this.associations.set(i,this.associations.get(s))),s=i}t.material=s}getMaterialType(){return de}loadMaterial(t){let e=this,s=this.json,n=this.extensions,r=s.materials[t],o,a={},i=r.extensions||{},c=[];if(i[T.KHR_MATERIALS_UNLIT]){let l=n[T.KHR_MATERIALS_UNLIT];o=l.getMaterialType(),c.push(l.extendParams(a,r,e))}else{let l=r.pbrMetallicRoughness||{};if(a.color=new C(1,1,1),a.opacity=1,Array.isArray(l.baseColorFactor)){let d=l.baseColorFactor;a.color.setRGB(d[0],d[1],d[2],I),a.opacity=d[3]}l.baseColorTexture!==void 0&&c.push(e.assignTexture(a,"map",l.baseColorTexture,F)),a.metalness=l.metallicFactor!==void 0?l.metallicFactor:1,a.roughness=l.roughnessFactor!==void 0?l.roughnessFactor:1,l.metallicRoughnessTexture!==void 0&&(c.push(e.assignTexture(a,"metalnessMap",l.metallicRoughnessTexture)),c.push(e.assignTexture(a,"roughnessMap",l.metallicRoughnessTexture))),o=this._invokeOne(function(d){return d.getMaterialType&&d.getMaterialType(t)}),c.push(Promise.all(this._invokeAll(function(d){return d.extendMaterialParams&&d.extendMaterialParams(t,a)})))}r.doubleSided===!0&&(a.side=$e);let u=r.alphaMode||ye.OPAQUE;if(u===ye.BLEND?(a.transparent=!0,a.depthWrite=!1):(a.transparent=!1,u===ye.MASK&&(a.alphaTest=r.alphaCutoff!==void 0?r.alphaCutoff:.5)),r.normalTexture!==void 0&&o!==D&&(c.push(e.assignTexture(a,"normalMap",r.normalTexture)),a.normalScale=new Te(1,1),r.normalTexture.scale!==void 0)){let l=r.normalTexture.scale;a.normalScale.set(l,l)}if(r.occlusionTexture!==void 0&&o!==D&&(c.push(e.assignTexture(a,"aoMap",r.occlusionTexture)),r.occlusionTexture.strength!==void 0&&(a.aoMapIntensity=r.occlusionTexture.strength)),r.emissiveFactor!==void 0&&o!==D){let l=r.emissiveFactor;a.emissive=new C().setRGB(l[0],l[1],l[2],I)}return r.emissiveTexture!==void 0&&o!==D&&c.push(e.assignTexture(a,"emissiveMap",r.emissiveTexture,F)),Promise.all(c).then(function(){let l=new o(a);return r.name&&(l.name=r.name),N(l,r),e.associations.set(l,{materials:t}),r.extensions&&B(n,l,r),l})}createUniqueName(t){let e=yt.sanitizeNodeName(t||"");return e in this.nodeNamesUsed?e+"_"+ ++this.nodeNamesUsed[e]:(this.nodeNamesUsed[e]=0,e)}loadGeometries(t){let e=this,s=this.extensions,n=this.primitiveCache;function r(a){return s[T.KHR_DRACO_MESH_COMPRESSION].decodePrimitive(a,e).then(function(i){return Ct(i,a,e)})}let o=[];for(let a=0,i=t.length;a<i;a++){let c=t[a],u=zt(c),l=n[u];if(l)o.push(l.promise);else{let d;c.extensions&&c.extensions[T.KHR_DRACO_MESH_COMPRESSION]?d=r(c):d=Ct(new re,c,e),n[u]={primitive:c,promise:d},o.push(d)}}return Promise.all(o)}loadMesh(t){let e=this,s=this.json,n=this.extensions,r=s.meshes[t],o=r.primitives,a=[];for(let i=0,c=o.length;i<c;i++){let u=o[i].material===void 0?Ut(this.cache):this.getDependency("material",o[i].material);a.push(u)}return a.push(e.loadGeometries(o)),Promise.all(a).then(function(i){let c=i.slice(0,i.length-1),u=i[i.length-1],l=[];for(let h=0,m=u.length;h<m;h++){let A=u[h],g=o[h],x,M=c[h];if(g.mode===E.TRIANGLES||g.mode===E.TRIANGLE_STRIP||g.mode===E.TRIANGLE_FAN||g.mode===void 0)x=r.isSkinnedMesh===!0?new bt(A,M):new dt(A,M),x.isSkinnedMesh===!0&&x.normalizeSkinWeights(),g.mode===E.TRIANGLE_STRIP?x.geometry=xe(x.geometry,Q):g.mode===E.TRIANGLE_FAN&&(x.geometry=xe(x.geometry,z));else if(g.mode===E.LINES)x=new ct(A,M);else if(g.mode===E.LINE_STRIP)x=new ot(A,M);else if(g.mode===E.LINE_LOOP)x=new at(A,M);else if(g.mode===E.POINTS)x=new At(A,M);else throw new Error("THREE.GLTFLoader: Primitive mode unsupported: "+g.mode);Object.keys(x.geometry.morphAttributes).length>0&&Kt(x,r),x.name=e.createUniqueName(r.name||"mesh_"+t),N(x,r),g.extensions&&B(n,x,g),e.assignFinalMaterial(x),l.push(x)}for(let h=0,m=l.length;h<m;h++)e.associations.set(l[h],{meshes:t,primitives:h});if(l.length===1)return r.extensions&&B(n,l[0],r),l[0];let d=new V;r.extensions&&B(n,d,r),e.associations.set(d,{meshes:t});for(let h=0,m=l.length;h<m;h++)d.add(l[h]);return d})}loadCamera(t){let e,s=this.json.cameras[t],n=s[s.type];if(!n){console.warn("THREE.GLTFLoader: Missing camera parameters.");return}return s.type==="perspective"?e=new Tt(ft.radToDeg(n.yfov),n.aspectRatio||1,n.znear||1,n.zfar||2e6):s.type==="orthographic"&&(e=new gt(-n.xmag,n.xmag,n.ymag,-n.ymag,n.znear,n.zfar)),s.name&&(e.name=this.createUniqueName(s.name)),N(e,s),Promise.resolve(e)}loadSkin(t){let e=this.json.skins[t],s=[];for(let n=0,r=e.joints.length;n<r;n++)s.push(this._loadNodeShallow(e.joints[n]));return e.inverseBindMatrices!==void 0?s.push(this.getDependency("accessor",e.inverseBindMatrices)):s.push(null),Promise.all(s).then(function(n){let r=n.pop(),o=n,a=[],i=[];for(let c=0,u=o.length;c<u;c++){let l=o[c];if(l){a.push(l);let d=new H;r!==null&&d.fromArray(r.array,c*16),i.push(d)}else console.warn('THREE.GLTFLoader: Joint "%s" could not be found.',e.joints[c])}return new Mt(a,i)})}loadAnimation(t){let e=this.json,s=this,n=e.animations[t],r=n.name?n.name:"animation_"+t,o=[],a=[],i=[],c=[],u=[];for(let l=0,d=n.channels.length;l<d;l++){let h=n.channels[l],m=n.samplers[h.sampler],A=h.target,g=A.node,x=n.parameters!==void 0?n.parameters[m.input]:m.input,M=n.parameters!==void 0?n.parameters[m.output]:m.output;A.node!==void 0&&(o.push(this.getDependency("node",g)),a.push(this.getDependency("accessor",x)),i.push(this.getDependency("accessor",M)),c.push(m),u.push(A))}return Promise.all([Promise.all(o),Promise.all(a),Promise.all(i),Promise.all(c),Promise.all(u)]).then(function(l){let d=l[0],h=l[1],m=l[2],A=l[3],g=l[4],x=[];for(let y=0,R=d.length;y<R;y++){let w=d[y],O=h[y],S=m[y],G=A[y],k=g[y];if(w===void 0)continue;w.updateMatrix&&w.updateMatrix();let te=s._createAnimationTracks(w,O,S,G,k);if(te)for(let ne=0;ne<te.length;ne++)x.push(te[ne])}let M=new se(r,void 0,x);return N(M,n),M})}createNodeMesh(t){let e=this.json,s=this,n=e.nodes[t];return n.mesh===void 0?null:s.getDependency("mesh",n.mesh).then(function(r){let o=s._getNodeRef(s.meshCache,n.mesh,r);return n.weights!==void 0&&o.traverse(function(a){if(a.isMesh)for(let i=0,c=n.weights.length;i<c;i++)a.morphTargetInfluences[i]=n.weights[i]}),o})}loadNode(t){let e=this.json,s=this,n=e.nodes[t],r=s._loadNodeShallow(t),o=[],a=n.children||[];for(let c=0,u=a.length;c<u;c++)o.push(s.getDependency("node",a[c]));let i=n.skin===void 0?Promise.resolve(null):s.getDependency("skin",n.skin);return Promise.all([r,Promise.all(o),i]).then(function(c){let u=c[0],l=c[1],d=c[2];d!==null&&u.traverse(function(h){h.isSkinnedMesh&&h.bind(d,Vt)});for(let h=0,m=l.length;h<m;h++)u.add(l[h]);if(u.userData.pivot!==void 0&&l.length>0){let h=u.userData.pivot,m=l[0];u.pivot=new L().fromArray(h),u.position.x-=h[0],u.position.y-=h[1],u.position.z-=h[2],m.position.set(0,0,0),delete u.userData.pivot}return u})}_loadNodeShallow(t){let e=this.json,s=this.extensions,n=this;if(this.nodeCache[t]!==void 0)return this.nodeCache[t];let r=e.nodes[t],o=r.name?n.createUniqueName(r.name):"",a=[],i=n._invokeOne(function(c){return c.createNodeMesh&&c.createNodeMesh(t)});return i&&a.push(i),r.camera!==void 0&&a.push(n.getDependency("camera",r.camera).then(function(c){return n._getNodeRef(n.cameraCache,r.camera,c)})),n._invokeAll(function(c){return c.createNodeAttachment&&c.createNodeAttachment(t)}).forEach(function(c){a.push(c)}),this.nodeCache[t]=Promise.all(a).then(function(c){let u;if(r.isBone===!0?u=new Ye:c.length>1?u=new V:c.length===1?u=c[0]:u=new me,u!==c[0])for(let l=0,d=c.length;l<d;l++)u.add(c[l]);if(r.name&&(u.userData.name=r.name,u.name=o),N(u,r),r.extensions&&B(s,u,r),r.matrix!==void 0){let l=new H;l.fromArray(r.matrix),u.applyMatrix4(l)}else r.translation!==void 0&&u.position.fromArray(r.translation),r.rotation!==void 0&&u.quaternion.fromArray(r.rotation),r.scale!==void 0&&u.scale.fromArray(r.scale);if(!n.associations.has(u))n.associations.set(u,{});else if(r.mesh!==void 0&&n.meshCache.refs[r.mesh]>1){let l=n.associations.get(u);n.associations.set(u,{...l})}return n.associations.get(u).nodes=t,u}),this.nodeCache[t]}loadScene(t){let e=this.extensions,s=this.json.scenes[t],n=this,r=new V;s.name&&(r.name=n.createUniqueName(s.name)),N(r,s),s.extensions&&B(e,r,s);let o=s.nodes||[],a=[];for(let i=0,c=o.length;i<c;i++)a.push(n.getDependency("node",o[i]));return Promise.all(a).then(function(i){for(let u=0,l=i.length;u<l;u++){let d=i[u];d.parent!==null?r.add(Ae(d)):r.add(d)}let c=u=>{let l=new Map;for(let[d,h]of n.associations)(d instanceof q||d instanceof ge)&&l.set(d,h);return u.traverse(d=>{let h=n.associations.get(d);h!=null&&l.set(d,h)}),l};return n.associations=c(r),r})}_createAnimationTracks(t,e,s,n,r){let o=[],a=t.name?t.name:t.uuid,i=[];function c(h){h.morphTargetInfluences&&i.push(h.name?h.name:h.uuid)}v[r.path]===v.weights?(c(t),t.isGroup&&t.children.forEach(c)):i.push(a);let u;switch(v[r.path]){case v.weights:u=pe;break;case v.rotation:u=Y;break;case v.translation:case v.scale:u=J;break;default:s.itemSize===1?u=pe:u=J;break}let l=n.interpolation!==void 0?Ft[n.interpolation]:le,d=this._getArrayFromAccessor(s);for(let h=0,m=i.length;h<m;h++){let A=new u(i[h]+"."+v[r.path],e.array,d,l);n.interpolation==="CUBICSPLINE"&&this._createCubicSplineTrackInterpolant(A),o.push(A)}return o}_getArrayFromAccessor(t){let e=t.array;if(t.normalized){let s=qe(e.constructor),n=new Float32Array(e.length);for(let r=0,o=e.length;r<o;r++)n[r]=e[r]*s;e=n}return e}_createCubicSplineTrackInterpolant(t){t.createInterpolant=function(s){let n=this instanceof Y?Ve:ee;return new n(this.times,this.values,this.getValueSize()/3,s)},t.createInterpolant.isInterpolantFactoryMethodGLTFCubicSpline=!0}};function Xt(f,t,e){let s=t.attributes,n=new Ze;if(s.POSITION!==void 0){let a=e.json.accessors[s.POSITION],i=a.min,c=a.max;if(i!==void 0&&c!==void 0){if(n.set(new L(i[0],i[1],i[2]),new L(c[0],c[1],c[2])),a.normalized){let u=qe(U[a.componentType]);n.min.multiplyScalar(u),n.max.multiplyScalar(u)}}else{console.warn("THREE.GLTFLoader: Missing min/max properties for accessor POSITION.");return}}else return;let r=t.targets;if(r!==void 0){let a=new L,i=new L;for(let c=0,u=r.length;c<u;c++){let l=r[c];if(l.POSITION!==void 0){let d=e.json.accessors[l.POSITION],h=d.min,m=d.max;if(h!==void 0&&m!==void 0){if(i.setX(Math.max(Math.abs(h[0]),Math.abs(m[0]))),i.setY(Math.max(Math.abs(h[1]),Math.abs(m[1]))),i.setZ(Math.max(Math.abs(h[2]),Math.abs(m[2]))),d.normalized){let A=qe(U[d.componentType]);i.multiplyScalar(A)}a.max(i)}else console.warn("THREE.GLTFLoader: Missing min/max properties for accessor POSITION.")}}n.expandByVector(a)}f.boundingBox=n;let o=new wt;n.getCenter(o.center),o.radius=n.min.distanceTo(n.max)/2,f.boundingSphere=o}function Ct(f,t,e){let s=t.attributes,n=[];function r(o,a){return e.getDependency("accessor",o).then(function(i){f.setAttribute(a,i)})}for(let o in s){let a=Xe[o]||o.toLowerCase();a in f.attributes||n.push(r(s[o],a))}if(t.indices!==void 0&&!f.index){let o=e.getDependency("accessor",t.indices).then(function(a){f.setIndex(a)});n.push(o)}return oe.workingColorSpace!==I&&"COLOR_0"in s&&console.warn(\`THREE.GLTFLoader: Converting vertex colors from "srgb-linear" to "\${oe.workingColorSpace}" not supported.\`),N(f,t),Xt(f,t,e),Promise.all(n).then(function(){return t.targets!==void 0?Gt(f,t.targets,e):f})}export{be as GLTFLoader,Ae as cloneSkinned};
`;

// modules/waves/src/assets.js
var ASSET_FILES = Object.freeze({
  blaster: "assets/gun-blaster.glb",
  scatter: "assets/gun-scatter.glb",
  beam: "assets/gun-beam.glb",
  grunt: "assets/enemy-grunt.glb",
  runner: "assets/enemy-runner.glb",
  tank: "assets/enemy-tank.glb",
  crystal: "assets/crystal.glb"
});
function createAssets(api) {
  const THREE = api.THREE;
  const entries = /* @__PURE__ */ new Map();
  let chunk = null;
  let loaded = null;
  function loaderModule() {
    if (!chunk)
      chunk = (async () => {
        globalThis.__wavesTHREE = THREE;
        const url = URL.createObjectURL(new Blob([loader_default], { type: "text/javascript" }));
        try {
          loaded = await import(
            /* @vite-ignore */
            url
          );
          return loaded;
        } finally {
          URL.revokeObjectURL(url);
        }
      })();
    return chunk;
  }
  async function parse(url) {
    if (typeof api.loadModel === "function") {
      const r = await api.loadModel(url);
      return r?.scene ? r : { scene: r, animations: r?.animations ?? [] };
    }
    const m = await loaderModule();
    return new m.GLTFLoader().loadAsync(url);
  }
  function request(key) {
    if (entries.has(key)) return entries.get(key);
    const file = (
      /** @type {any} */
      ASSET_FILES[key]
    );
    const url = file ? api.assetUrl?.(file) : null;
    const entry = { status: "loading", gltf: null };
    entries.set(key, entry);
    if (!url) {
      entry.status = "failed";
      entry.error = file ? file + " is not in the installed module" : "no asset " + key;
      return entry;
    }
    parse(url).then(
      (gltf) => {
        gltf.scene.traverse((o) => {
          if (!o.isMesh) return;
          o.castShadow = true;
          o.receiveShadow = true;
          if (o.isSkinnedMesh) o.frustumCulled = false;
        });
        entry.gltf = gltf;
        entry.status = "ready";
      },
      (error) => {
        entry.status = "failed";
        entry.error = String(error?.message ?? error);
        console.warn("[waves] model " + key + " failed \u2014 the primitive look stays", error);
      }
    );
    return entry;
  }
  function get(key) {
    const e = request(key);
    return e?.status === "ready" ? e.gltf : null;
  }
  function instance(key) {
    const gltf = get(key);
    if (!gltf) return null;
    let skinned = false;
    gltf.scene.traverse((o) => skinned ||= !!o.isSkinnedMesh);
    if (skinned && !loaded) {
      loaderModule();
      return null;
    }
    const clone = skinned ? loaded.cloneSkinned(gltf.scene) : gltf.scene.clone(true);
    const own = /* @__PURE__ */ new Map();
    clone.traverse((o) => {
      if (!o.isMesh || !o.material) return;
      const one = (m) => {
        if (!own.has(m)) own.set(m, m.clone());
        return own.get(m);
      };
      o.material = Array.isArray(o.material) ? o.material.map(one) : one(o.material);
    });
    return { scene: clone, animations: gltf.animations ?? [] };
  }
  return {
    request,
    /** start every model at once (a Waves arena is in the scene: all of them will be asked for) */
    preload: () => Object.keys(ASSET_FILES).forEach((k) => request(k)),
    get,
    instance,
    /** every key's status, for a flight / the debug line */
    status: () => Object.fromEntries(Object.keys(ASSET_FILES).map((k) => [k, entries.get(k)?.status ?? "idle"])),
    errors: () => Object.fromEntries([...entries].filter(([, e]) => e.error).map(([k, e]) => [k, e.error]))
  };
}

// modules/waves/src/avatars.js
function registerAvatars(api, engine, root, assets) {
  const THREE = api.THREE;
  const group = new THREE.Group();
  group.name = "Waves figures";
  root.add(group);
  const clock = () => performance.now() / 1e3;
  const figures = /* @__PURE__ */ new Map();
  const hopped = /* @__PURE__ */ new Map();
  let crystal = null;
  let enabled = true;
  const stats = { made: 0, hits: 0, deaths: 0, walking: 0 };
  const _m = new THREE.Matrix4();
  const _p = new THREE.Vector3();
  const _q = new THREE.Quaternion();
  const _s = new THREE.Vector3();
  const _up = new THREE.Vector3(0, 1, 0);
  const _inv = new THREE.Matrix4();
  function refreshInverse() {
    group.updateWorldMatrix(true, false);
    _inv.copy(group.matrixWorld).invert();
  }
  function placeWorld(object, pos, yaw, scale) {
    _q.setFromAxisAngle(_up, yaw);
    _m.compose(_p.set(pos[0], pos[1], pos[2]), _q, _s.set(scale, scale, scale));
    _m.premultiply(_inv);
    _m.decompose(object.position, object.quaternion, object.scale);
  }
  function hop(object, layer) {
    const was = hopped.get(object);
    if (was === layer || was === void 0 && layer === null) return;
    object.traverse((o) => {
      if (!o.isMesh || !o.layers) return;
      if (was !== void 0) o.layers.disable(was);
      if (layer === null) o.layers.enable(0);
      else {
        o.layers.disable(0);
        o.layers.enable(layer);
      }
    });
    if (layer === null) hopped.delete(object);
    else hopped.set(object, layer);
  }
  function make(uuid, kind) {
    const inst = assets.instance(kind);
    if (!inst) return null;
    const model = new THREE.Group();
    model.name = "Waves figure " + kind;
    const body = inst.scene;
    model.add(body);
    body.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(body);
    const size = box.getSize(new THREE.Vector3());
    const scale = fitScale(size.y, figureOf(kind).height);
    body.position.set(-(box.min.x + box.max.x) / 2, -box.min.y, -(box.min.z + box.max.z) / 2);
    const mixer = new THREE.AnimationMixer(body);
    const actions = {};
    for (const clip of inst.animations) {
      const name = String(clip.name).toLowerCase();
      actions[name] = mixer.clipAction(clip);
    }
    for (const a of Object.values(actions)) a.enabled = true;
    const walk = actions[figureOf(kind).walk] ?? actions.walk ?? actions.run ?? null;
    if (walk) {
      walk.play();
      walk.timeScale = 0;
    }
    for (const k of ["hit", "death"]) {
      const a = actions[k];
      if (!a) continue;
      a.setLoop(THREE.LoopOnce, 1);
      a.clampWhenFinished = k === "death";
    }
    model.visible = false;
    group.add(model);
    stats.made++;
    return { uuid, kind, model, mixer, actions, scale, yaw: 0, last: null, gait: { speed: 0, forward: true }, dyingAt: null, deathPos: null, hitUntil: 0, object: null };
  }
  const walkOf = (f) => f.actions[figureOf(f.kind).walk] ?? f.actions.walk ?? f.actions.run ?? null;
  engine.onEnemy((ev) => {
    const f = figures.get(ev.uuid);
    if (!f) return;
    if (ev.kind === "death") {
      stats.deaths++;
      f.dyingAt = clock();
      f.deathPos = f.last ? [...f.last] : ev.pos;
      const walk = walkOf(f);
      const death = f.actions.death;
      if (death) {
        walk?.fadeOut(0.12);
        f.actions.hit?.stop();
        death.reset().setEffectiveWeight(1).fadeIn(0.08).play();
      } else if (walk) walk.timeScale = 0;
    } else if (f.dyingAt === null) {
      stats.hits++;
      const hit = f.actions.hit;
      if (hit) {
        hit.reset().setEffectiveWeight(1).fadeIn(0.04).play();
        f.hitUntil = clock() + Math.min(0.45, hit.getClip().duration * 0.6);
      }
    }
  });
  function revive(f) {
    f.dyingAt = null;
    f.deathPos = null;
    f.actions.death?.stop();
    f.actions.hit?.stop();
    const walk = walkOf(f);
    if (walk) {
      walk.reset().play();
      walk.setEffectiveWeight(1);
      walk.timeScale = 0;
    }
  }
  let lastT = clock();
  function frame() {
    const t = clock();
    const dt = Math.min(0.1, Math.max(0, t - lastT));
    lastT = t;
    const game = inGame(api);
    const objects = api.objectsGroup();
    refreshInverse();
    const byUuid = /* @__PURE__ */ new Map();
    for (const c of objects?.children ?? []) byUuid.set(c.uuid, c);
    const seen = /* @__PURE__ */ new Set();
    let walking = 0;
    for (const s of engine.all()) {
      for (const e of s.enemies) {
        const object = byUuid.get(e.uuid) ?? objects?.getObjectByProperty("uuid", e.uuid);
        if (!object) continue;
        let f = figures.get(e.uuid);
        if (!f || f.kind !== e.kind) {
          if (f) group.remove(f.model);
          f = enabled ? make(e.uuid, e.kind) : null;
          if (!f) {
            hop(object, null);
            continue;
          }
          figures.set(e.uuid, f);
        }
        seen.add(e.uuid);
        f.object = object;
        const wp = object.getWorldPosition(new THREE.Vector3()).toArray();
        const drop = footDrop(f.kind);
        const feet = [wp[0], wp[1] - drop, wp[2]];
        if (f.dyingAt !== null && deathOver(t - f.dyingAt)) revive(f);
        const dying = f.dyingAt !== null;
        const show = enabled && figureShown({ visible: !!object.visible, y: wp[1], dying });
        hop(object, show ? game ? STAND_IN_LAYER : HELPER_LAYER : null);
        f.model.visible = show;
        if (!show) {
          f.last = null;
          f.gait.speed = 0;
          continue;
        }
        if (dying && f.deathPos) {
          const age = t - /** @type {number} */
          f.dyingAt;
          const d = f.deathPos;
          placeWorld(f.model, [d[0], d[1] - sinkDepth(age), d[2]], f.yaw, f.scale);
          f.mixer.update(dt);
          continue;
        }
        const goal = s.goal;
        const target = goal ? yawTo(feet, goal) : f.yaw;
        f.yaw = f.last ? turnToward(f.yaw, target, dt, 7) : target;
        f.gait = f.last ? gait(f.gait, f.last, feet, dt, f.yaw) : { speed: 0, forward: true };
        f.last = feet;
        placeWorld(f.model, feet, f.yaw, f.scale);
        const walk = walkOf(f);
        if (walk) {
          const rate = f.gait.forward ? walkRate(f.gait.speed, figureOf(f.kind).clipSpeed, 1) : 0;
          walk.timeScale = rate;
          if (rate > 0) walking++;
        }
        if (f.actions.hit && f.hitUntil && t > f.hitUntil) {
          f.actions.hit.fadeOut(0.15);
          f.hitUntil = 0;
        }
        f.mixer.update(dt);
      }
    }
    stats.walking = walking;
    for (const [uuid, f] of figures)
      if (!seen.has(uuid)) {
        group.remove(f.model);
        if (f.object) hop(f.object, null);
        figures.delete(uuid);
      }
    crystalFrame(game);
  }
  function crystalFrame(game) {
    const core = crystal?.source?.parent ? crystal.source : api.objectsGroup()?.getObjectByName?.(CORE);
    if (!core || !enabled) {
      if (crystal) crystal.model.visible = false;
      if (crystal?.source) hop(crystal.source, null);
      return;
    }
    if (!crystal || crystal.source !== core) {
      const inst = assets.instance("crystal");
      if (!inst) return;
      const model = new THREE.Group();
      model.name = "Waves crystal";
      const body = inst.scene;
      model.add(body);
      body.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(body);
      const size = box.getSize(new THREE.Vector3());
      const c = box.getCenter(new THREE.Vector3());
      body.position.set(-c.x, -c.y, -c.z);
      const mats = [];
      body.traverse((o) => {
        if (!o.isMesh) return;
        o.castShadow = false;
        const m = o.material;
        if (m && !Array.isArray(m) && m.emissive) {
          if (!m.emissiveMap && m.map) m.emissiveMap = m.map;
          m.emissive.setHex(m.emissiveMap ? 16777215 : 3793151);
          m.userData.wvGlow = 1;
          mats.push(m);
        }
      });
      if (crystal) group.remove(crystal.model);
      const r = core.geometry?.parameters?.radius ?? 0.42;
      crystal = { model, scale: fitScale(size.y, r * 2.6), source: core, mats };
      group.add(model);
    }
    hop(core, game ? STAND_IN_LAYER : HELPER_LAYER);
    core.updateMatrixWorld?.(true);
    core.matrixWorld.decompose(_p, _q, _s);
    const k = crystal.scale;
    _m.compose(_p, _q, _s.set(k, k, k));
    _m.premultiply(_inv);
    _m.decompose(crystal.model.position, crystal.model.quaternion, crystal.model.scale);
    crystal.model.visible = !!core.visible;
    const cm = core.material;
    const full = cm?.userData?.wvCore ?? cm?.emissiveIntensity ?? 1;
    const level = full > 0 ? (cm?.emissiveIntensity ?? full) / full : 1;
    for (const m of crystal.mats) m.emissiveIntensity = 0.25 + 1.6 * level;
  }
  api.registerFrameTask(() => {
    try {
      frame();
    } catch (error) {
      console.warn("[waves] figures failed", error);
    }
  });
  api.onSceneClear(() => {
    for (const f of figures.values()) group.remove(f.model);
    figures.clear();
    hopped.clear();
    if (crystal) group.remove(crystal.model);
    crystal = null;
  });
  return {
    figures,
    stats,
    /** the figure standing in for enemy `uuid` (the hit flash paints it too) @param {string} uuid */
    of: (uuid) => figures.get(uuid)?.model ?? null,
    crystal: () => crystal?.model ?? null,
    /** the stand-in on/off (a flight's before/after; off = the 30b primitive look) @param {boolean} on */
    setEnabled(on) {
      enabled = !!on;
      if (!enabled) {
        for (const f of figures.values()) {
          f.model.visible = false;
          if (f.object) hop(f.object, null);
        }
        if (crystal) {
          crystal.model.visible = false;
          hop(crystal.source, null);
        }
      }
    },
    enabled: () => enabled,
    /** the layer an enemy object's meshes sit on right now (0 = its own look) @param {any} object */
    layerOf: (object) => hopped.get(object) ?? 0
  };
}

// modules/waves/src/index.js
var ROOT = "waves-module";
var index_default = {
  id: "waves",
  name: "Waves",
  version: "2.1.0",
  description: "A VR wave shooter on the health module: a gun in your hand, five levels of grunts, runners and tanks walking from the portals to your crystal, a loadout of guns and abilities \u2014 every wave derived on every peer, no authority.",
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
    const assets = createAssets(api);
    let avatars = null;
    const fx = registerFx(api, engine, juice, feel, (uuid) => avatars?.of(uuid) ?? null);
    api.registerFrameTask(() => {
      if (!root.parent) api.scene()?.add(root);
    });
    api.registerSystemGroup?.(ROOT);
    const start = registerStart(api, root);
    const weapon = registerWeapon(api, engine, root, juice, prefs, feel, assets);
    avatars = registerAvatars(api, engine, root, assets);
    let preloaded = false;
    api.registerFrameTask(() => {
      if (preloaded || !engine.all().length) return;
      preloaded = true;
      assets.preload();
    });
    const powers = registerPowers(api, engine, root, prefs, feel);
    let spawnSet = false;
    const session = registerSession(api, engine, juice, feel, prefs, start);
    start.setResult(() => {
      const r = session.result();
      if (!r) return null;
      const l = resultLines(r);
      return { title: l.title, lines: l.lines, color: r.won ? "#6fcf7a" : "#ff5a4a" };
    });
    const menu = registerMenu(api, engine, prefs, feel);
    api.registerFrameTask(() => {
      if (spawnSet || typeof api.setSpawn !== "function") return;
      const home = api.objectsGroup()?.children.find((c) => c.name === "Home");
      if (!home || !engine.all().length) return;
      const p = home.getWorldPosition(new api.THREE.Vector3());
      api.setSpawn([p.x, 0, p.z], 0);
      spawnSet = true;
    });
    api.onSceneClear(() => {
      spawnSet = false;
    });
    engine.setGuard(() => powers.shielded());
    player.score = () => Number(api.peerVars.mine("score", 0)) || 0;
    player.best = () => session.best()?.score ?? 0;
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
        session,
        menu,
        assets,
        avatars,
        hud: arenaHud,
        hudGraph,
        snapshot: () => engine.all().map((s) => ({
          id: s.id,
          name: s.name,
          wave: s.wave,
          level: s.level,
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
