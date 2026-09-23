// modules/football/src/rules.js
var TEAMS = ["red", "blue"];
var MODES = ["duel", "teams", "freeforall", "practice"];
var WIN_BY = ["goals", "time", "either"];
var SERVE = ["auto", "button"];
var OWN_GOALS = ["count", "ignore"];
var ACTIONS = ["none", "join-red", "join-blue", "spectate", "start", "new-match", "swap-sides", "serve"];
var DEFAULT_RULES = {
  mode: "teams",
  winBy: "goals",
  goalsToWin: 5,
  matchSeconds: 180,
  serve: "auto",
  serveDelay: 2,
  ownGoals: "count",
  serveSpeed: 3
};
var MATCH_LOG_CAP = 50;
var REST_DISTANCE = 0.03;
var REST_SECONDS = 3;
function num(v, lo, hi, d) {
  const n = Number(v);
  if (!Number.isFinite(n)) return d;
  return Math.min(hi, Math.max(lo, n));
}
function pick(v, options, d) {
  return options.includes(v) ? v : d;
}
function normalizeRules(raw) {
  const r = raw && typeof raw === "object" ? raw : {};
  const d = DEFAULT_RULES;
  return {
    mode: pick(r.mode, MODES, d.mode),
    winBy: pick(r.winBy, WIN_BY, d.winBy),
    goalsToWin: Math.round(num(r.goalsToWin, 1, 20, d.goalsToWin)),
    matchSeconds: Math.round(num(r.matchSeconds, 30, 1800, d.matchSeconds)),
    serve: pick(r.serve, SERVE, d.serve),
    serveDelay: num(r.serveDelay, 0.5, 5, d.serveDelay),
    ownGoals: pick(r.ownGoals, OWN_GOALS, d.ownGoals),
    serveSpeed: num(r.serveSpeed, 0.5, 10, d.serveSpeed)
  };
}
function otherTeam(team) {
  return team === "red" ? "blue" : team === "blue" ? "red" : null;
}
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
function emptySlots() {
  return { red: [], blue: [] };
}
function teamOf(slots, peerId) {
  if (!peerId) return null;
  if (slots.red.includes(peerId)) return "red";
  if (slots.blue.includes(peerId)) return "blue";
  return null;
}
function canJoin(slots, team, peerId, mode) {
  if (team === "none") return { ok: true, reason: "" };
  if (!TEAMS.includes(team)) return { ok: false, reason: "no such team" };
  if (teamOf(slots, peerId) === team) return { ok: true, reason: "already there" };
  if (mode === "duel" && slots[team].length >= 1) return { ok: false, reason: team + " is taken (duel: one per side)" };
  return { ok: true, reason: "" };
}
function applySlot(slots, team, peerId) {
  const next = { red: slots.red.filter((id) => id !== peerId), blue: slots.blue.filter((id) => id !== peerId) };
  if (team === "red" || team === "blue") next[team] = [...next[team], peerId];
  return next;
}
function freeVanished(slots, liveIds) {
  const live = new Set(liveIds);
  const freed = [];
  const keep = (id) => {
    if (live.has(id)) return true;
    freed.push(id);
    return false;
  };
  return { slots: { red: slots.red.filter(keep), blue: slots.blue.filter(keep) }, freed };
}
function swapSlots(slots) {
  return { red: [...slots.blue], blue: [...slots.red] };
}
function attributeGoal({ gateTeam, lastTouch, slots, mode, ownGoals }) {
  if (mode === "practice") return { team: null, by: null, own: false, counts: false, credit: null, reason: "practice" };
  const by = lastTouch?.by ?? null;
  const toucherTeam = by ? teamOf(slots, by) : null;
  if (mode === "freeforall") {
    if (!by) return { team: null, by: null, own: false, counts: false, credit: null, reason: "nobody touched it" };
    return { team: null, by, own: false, counts: true, credit: "goals", reason: "free for all" };
  }
  const scoring = otherTeam(gateTeam);
  if (!by || !toucherTeam) return { team: scoring, by: null, own: false, counts: true, credit: null, reason: by ? "spectator touch" : "no touch" };
  if (toucherTeam === scoring) return { team: scoring, by, own: false, counts: true, credit: "goals", reason: "goal" };
  if (ownGoals === "ignore") return { team: scoring, by, own: true, counts: false, credit: null, reason: "own goal ignored" };
  return { team: scoring, by, own: true, counts: true, credit: "owngoals", reason: "own goal" };
}
function applyGoal(score, a) {
  if (!a.counts || !a.team) return { ...score };
  return { ...score, [a.team]: (score[a.team] ?? 0) + 1 };
}
function matchOutcome({ score, rules, elapsed, playerGoals }) {
  const r = normalizeRules(rules);
  if (r.mode === "practice") return null;
  const byGoals = r.winBy === "goals" || r.winBy === "either";
  const byTime = r.winBy === "time" || r.winBy === "either";
  if (byGoals) {
    if (r.mode === "freeforall") {
      for (const [id, n] of Object.entries(playerGoals ?? {})) if (n >= r.goalsToWin) return { winner: id, reason: "goals" };
    } else {
      if (score.red >= r.goalsToWin && score.red > score.blue) return { winner: "red", reason: "goals" };
      if (score.blue >= r.goalsToWin && score.blue > score.red) return { winner: "blue", reason: "goals" };
    }
  }
  if (byTime && elapsed >= r.matchSeconds) {
    if (r.mode === "freeforall") {
      let best = null;
      let tie = false;
      for (const [id, n] of Object.entries(playerGoals ?? {})) {
        if (!best || n > best.n) {
          best = { id, n };
          tie = false;
        } else if (n === best.n) tie = true;
      }
      return { winner: best && !tie ? best.id : "draw", reason: "time" };
    }
    if (score.red === score.blue) return { winner: "draw", reason: "time" };
    return { winner: score.red > score.blue ? "red" : "blue", reason: "time" };
  }
  return null;
}
function secondsLeft(rules, elapsed) {
  const r = normalizeRules(rules);
  if (r.winBy === "goals" || r.mode === "practice") return null;
  return Math.max(0, r.matchSeconds - elapsed);
}
function serveDirection(at) {
  const h = hash32(Math.floor(at), "serve");
  const sign = h & 1 ? 1 : -1;
  const lean = ((h >>> 8 & 255) / 255 - 0.5) * 0.6;
  const len = Math.hypot(lean, 1);
  return [lean / len, 0, sign / len];
}
function serveImpulse(pos, centre, mass, speed, at) {
  const dx = centre[0] - pos[0];
  const dz = centre[2] - pos[2];
  const dist = Math.hypot(dx, dz);
  const dir = dist > 0.5 ? [dx / dist, 0, dz / dist] : serveDirection(at);
  const m = Math.max(0.01, mass || 1) * Math.max(0, speed);
  return [dir[0] * m, dir[1] * m, dir[2] * m];
}
function matchLogEntry({ at, score, winner, rows }) {
  return {
    at: Math.floor(at),
    red: score.red,
    blue: score.blue,
    winner,
    scorers: (rows ?? []).filter((r) => r.goals > 0).map((r) => ({ name: String(r.name), goals: r.goals }))
  };
}
function appendMatchLog(log, entry, cap = MATCH_LOG_CAP) {
  const list = Array.isArray(log) ? [...log, entry] : [entry];
  return list.slice(-Math.max(1, cap));
}
function scoreLine(score) {
  return "RED " + (score.red ?? 0) + " \u2014 " + (score.blue ?? 0) + " BLUE";
}

// modules/football/src/game.js
var LOG_VAR = "football";
function createGame(api) {
  const THREE = api.THREE;
  const state = {
    /** rules from the toolbox when no Match Rules node is alive */
    rulesOverride: (
      /** @type {any} */
      null
    ),
    slots: emptySlots(),
    /** @type {Record<string, string>} peerId -> name at join time (the sheet's names) */
    names: {},
    started: false,
    startedAt: 0,
    endedAt: 0,
    score: { red: 0, blue: 0 },
    /** @type {import('./rules.js').LastTouch} */
    lastTouch: null,
    /** when the next serve is due (synced seconds), 0 = none pending */
    serveAt: 0,
    serves: 0,
    goals: 0,
    /** free-for-all: goals per player, replicated with the goal op */
    playerGoals: (
      /** @type {Record<string, number>} */
      {}
    ),
    /** @type {{winner: string, reason: string} | null} */
    outcome: null,
    /** the last op stamp — a late joiner adopts the newer state */
    at: 0
  };
  const config = {
    rules: (
      /** @type {any} */
      null
    ),
    /** @type {Record<string, {team: 'red'|'blue', label: string}>} gate object uuid -> team */
    gates: {},
    ballUuid: (
      /** @type {string | null} */
      null
    )
  };
  const listeners = /* @__PURE__ */ new Set();
  const emit = (what, data) => {
    for (const fn of listeners) {
      try {
        fn(what, data);
      } catch (error) {
        console.log("football listener failed", error);
      }
    }
  };
  const me = () => api.peerId() ?? "me";
  const now = () => api.now();
  const rules = () => normalizeRules(config.rules ?? state.rulesOverride ?? DEFAULT_RULES);
  function roster() {
    const rows = typeof api.peerNames === "function" ? api.peerNames() : [];
    if (!rows.some((r) => r.me)) rows.push({ id: me(), name: "", label: "you", me: true });
    return rows;
  }
  function nameOf(peerId) {
    if (peerId === me()) {
      const mine = roster().find((r) => r.me);
      return mine?.name || state.names[peerId] || "you";
    }
    return roster().find((r) => r.id === peerId)?.label || state.names[peerId] || "peer " + String(peerId).slice(0, 4);
  }
  const liveIds = () => {
    const ids = typeof api.peerIds === "function" ? api.peerIds() : [];
    return ids.includes(me()) ? ids : [me(), ...ids];
  };
  function isAuthority() {
    if (api.physics?.running?.()) return !!api.physics.isInitiator();
    const ids = liveIds().slice().sort();
    return ids[0] === me();
  }
  const ball = () => config.ballUuid ? api.objectsGroup()?.getObjectByProperty("uuid", config.ballUuid) ?? null : null;
  function stamp(data) {
    const at = Number(data?.at) || now();
    if (at > state.at) state.at = at;
    return at;
  }
  function applySlotOp(data) {
    const team = data.team === "red" || data.team === "blue" ? data.team : "none";
    const verdict = canJoin(state.slots, team, data.peerId, rules().mode);
    if (!verdict.ok) return false;
    state.slots = applySlot(state.slots, team, data.peerId);
    if (data.name) state.names[data.peerId] = data.name;
    stamp(data);
    emit("slots");
    return true;
  }
  function applyStart(data) {
    if (state.started) return false;
    const at = stamp(data);
    state.started = true;
    state.startedAt = at;
    state.endedAt = 0;
    state.score = { red: 0, blue: 0 };
    state.playerGoals = {};
    state.lastTouch = null;
    state.outcome = null;
    state.goals = 0;
    state.serveAt = at + rules().serveDelay;
    emit("start");
    fireEvent("start");
    api.game?.setState?.("playing", "");
    return true;
  }
  function applyReset(data) {
    const at = stamp(data);
    state.started = false;
    state.startedAt = 0;
    state.endedAt = 0;
    state.score = { red: 0, blue: 0 };
    state.playerGoals = {};
    state.lastTouch = null;
    state.outcome = null;
    state.serveAt = 0;
    emit("reset");
    fireEvent("reset");
    api.game?.setState?.("menu", "");
    void at;
    return true;
  }
  function applySwap(data) {
    stamp(data);
    state.slots = swapSlots(state.slots);
    emit("slots");
    return true;
  }
  function applyGoalOp(data) {
    if (!state.started) return false;
    const at = stamp(data);
    const a = { team: data.team ?? null, by: data.by ?? null, own: !!data.own, counts: !!data.counts, credit: data.credit ?? null, reason: "" };
    state.score = applyGoal(state.score, a);
    if (a.counts && a.by && rules().mode === "freeforall") state.playerGoals[a.by] = (state.playerGoals[a.by] ?? 0) + 1;
    if (a.counts) state.goals++;
    if (a.by === me() && a.credit && api.peerVars?.setMine) api.peerVars.setMine(a.credit, api.peerVars.mine(a.credit, 0) + 1);
    state.lastTouch = null;
    state.serveAt = rules().serve === "auto" ? at + rules().serveDelay : 0;
    const gate = api.objectsGroup()?.getObjectByProperty("uuid", data.gate);
    const where = gate ? gate.getWorldPosition(new THREE.Vector3()).toArray() : void 0;
    if (a.counts) api.playSound?.("ding", where);
    emit("goal", a);
    fireEvent("goal");
    if (a.counts && a.team) fireEvent(a.team + "goal");
    return true;
  }
  function applyServeOp(data) {
    stamp(data);
    state.serves++;
    state.serveAt = 0;
    state.lastTouch = null;
    emit("serve");
    fireEvent("serve");
    return true;
  }
  function applyOver(data) {
    if (!state.started) return false;
    const at = stamp(data);
    state.started = false;
    state.endedAt = at;
    state.serveAt = 0;
    state.outcome = { winner: String(data.winner ?? "draw"), reason: String(data.reason ?? "") };
    emit("over", state.outcome);
    fireEvent("over");
    api.game?.setState?.("over", outcomeText());
    return true;
  }
  function applyRulesOp(data) {
    stamp(data);
    state.rulesOverride = normalizeRules(data.rules);
    emit("rules");
    return true;
  }
  function act(action) {
    const at = now();
    switch (action) {
      case "join-red":
      case "join-blue":
      case "spectate": {
        const team = action === "join-red" ? "red" : action === "join-blue" ? "blue" : "none";
        const verdict = canJoin(state.slots, team, me(), rules().mode);
        if (!verdict.ok) {
          api.toast("Football: " + verdict.reason);
          return false;
        }
        const data = { op: "slot", team, peerId: me(), name: nameOf(me()), at };
        applySlotOp(data);
        api.send(data);
        return true;
      }
      case "start": {
        if (state.started) return false;
        const data = { op: "start", at };
        applyStart(data);
        api.send(data);
        return true;
      }
      case "new-match": {
        const data = { op: "reset", at };
        applyReset(data);
        api.send(data);
        return true;
      }
      case "swap-sides": {
        const data = { op: "swap", at };
        applySwap(data);
        api.send(data);
        return true;
      }
      case "serve":
        return serve("button");
      default:
        return false;
    }
  }
  function setRules(patch) {
    const data = { op: "rules", rules: normalizeRules({ ...rules(), ...patch }), at: now() };
    applyRulesOp(data);
    api.send(data);
  }
  function serve(why) {
    if (!isAuthority()) return false;
    const object = ball();
    if (!object) return false;
    const at = now();
    const mass = Number(object.userData?.physics?.mass) || 1;
    const r = rules();
    const centre = pitchCentre();
    centre[1] = object.position.y;
    const impulse = serveImpulse(object.position.toArray(), centre, mass, r.serveSpeed, at);
    const pushed = api.physics.applyImpulse(object.uuid, impulse);
    const data = { op: "serve", at, why };
    applyServeOp(data);
    api.send(data);
    return pushed;
  }
  function pitchCentre() {
    const group = api.objectsGroup();
    const gates = Object.keys(config.gates).map((uuid) => group?.getObjectByProperty("uuid", uuid)).filter(Boolean);
    if (gates.length < 2) return [0, 0, 0];
    const c = new THREE.Vector3();
    for (const g of gates) c.add(g.getWorldPosition(new THREE.Vector3()));
    return c.multiplyScalar(1 / gates.length).toArray();
  }
  const inside = {};
  const _box = new THREE.Box3();
  const _pos = new THREE.Vector3();
  function watchGoals() {
    const object = ball();
    if (!object) return;
    object.getWorldPosition(_pos);
    const group = api.objectsGroup();
    for (const [uuid, gate] of Object.entries(config.gates)) {
      const sensor = group?.getObjectByProperty("uuid", uuid);
      if (!sensor) continue;
      _box.setFromObject(sensor);
      const isIn = _box.containsPoint(_pos);
      const was = !!inside[uuid];
      inside[uuid] = isIn;
      if (!isIn || was || !state.started || state.serveAt) continue;
      const r = rules();
      const a = attributeGoal({ gateTeam: gate.team, lastTouch: state.lastTouch, slots: state.slots, mode: r.mode, ownGoals: r.ownGoals });
      const data = { op: "goal", gate: uuid, gateTeam: gate.team, team: a.team, by: a.by, own: a.own, counts: a.counts, credit: a.credit, at: now() };
      applyGoalOp(data);
      api.send(data);
    }
  }
  let restPos = (
    /** @type {number[] | null} */
    null
  );
  let restSince = 0;
  function watchRest(t) {
    const object = ball();
    if (!object || !state.started || state.serveAt) {
      restPos = null;
      return;
    }
    const p = object.position.toArray();
    if (!restPos || Math.hypot(p[0] - restPos[0], p[1] - restPos[1], p[2] - restPos[2]) > REST_DISTANCE) {
      restPos = p;
      restSince = t;
      return;
    }
    if (t - restSince >= REST_SECONDS) {
      restPos = null;
      if (rules().serve === "auto") serve("rest");
    }
  }
  function watchEnd() {
    if (!state.started) return;
    const outcome = matchOutcome({ score: state.score, rules: rules(), elapsed: now() - state.startedAt, playerGoals: state.playerGoals });
    if (!outcome) return;
    const data = { op: "over", at: now(), ...outcome };
    applyOver(data);
    api.send(data);
    writeMatchLog();
  }
  function writeMatchLog() {
    if (!api.game?.setVar || !api.game?.getVar) return;
    const rows = sheetRows().map((r) => ({ name: r.name, goals: r.goals }));
    const entry = matchLogEntry({ at: now(), score: state.score, winner: outcomeWinnerName(), rows });
    const current = api.game.getVar(LOG_VAR, null);
    const matches = appendMatchLog(current && typeof current === "object" ? current.matches : [], entry, MATCH_LOG_CAP);
    api.game.setVar(LOG_VAR, { matches });
  }
  function matchLog() {
    const v = api.game?.getVar?.(LOG_VAR, null);
    return v && typeof v === "object" && Array.isArray(v.matches) ? v.matches : [];
  }
  function onHit(hit) {
    if (!hit || !config.ballUuid || hit.uuid !== config.ballUuid) return;
    const by = String(hit.by ?? "");
    if (!by) return;
    const team = teamOf(state.slots, by);
    state.lastTouch = { by, team, at: Number(hit.at) || now() };
    if (by === me() && state.started && api.peerVars?.setMine) api.peerVars.setMine("touches", api.peerVars.mine("touches", 0) + 1);
    emit("touch", state.lastTouch);
    if (by === me()) fireEvent("touch");
  }
  function wireHits() {
    if (typeof api.onHit === "function") {
      api.onHit(onHit);
      return "api.onHit";
    }
    const knock = typeof window !== "undefined" ? (
      /** @type {any} */
      window.__stores?.knock
    ) : null;
    if (knock?.registerHitListener) {
      knock.registerHitListener((hit) => onHit(hit));
      return "__stores.knock";
    }
    return "none";
  }
  let firing = false;
  function fireEvent(kind) {
    if (!lastOpLocal || typeof api.fireNodeTrigger !== "function") return;
    if (firing) return;
    firing = true;
    try {
      api.fireNodeTrigger("fbevent", (d) => (d?.event ?? "goal") === kind);
    } finally {
      firing = false;
    }
  }
  let lastOpLocal = true;
  function handleMessage(data) {
    lastOpLocal = false;
    try {
      switch (data?.op) {
        case "slot":
          return applySlotOp(data);
        case "start":
          return applyStart(data);
        case "reset":
          return applyReset(data);
        case "swap":
          return applySwap(data);
        case "goal":
          return applyGoalOp(data);
        case "serve":
          return applyServeOp(data);
        case "over":
          return applyOver(data);
        case "rules":
          return applyRulesOp(data);
        default:
          return false;
      }
    } finally {
      lastOpLocal = true;
    }
  }
  function getState() {
    return {
      v: 1,
      at: state.at,
      rulesOverride: state.rulesOverride,
      slots: { red: [...state.slots.red], blue: [...state.slots.blue] },
      names: { ...state.names },
      started: state.started,
      startedAt: state.startedAt,
      endedAt: state.endedAt,
      score: { ...state.score },
      lastTouch: state.lastTouch ? { ...state.lastTouch } : null,
      serveAt: state.serveAt,
      serves: state.serves,
      goals: state.goals,
      playerGoals: { ...state.playerGoals },
      outcome: state.outcome ? { ...state.outcome } : null
    };
  }
  function applyState(remote) {
    if (!remote || typeof remote !== "object") return;
    if ((Number(remote.at) || 0) < state.at) return;
    lastOpLocal = false;
    state.at = Number(remote.at) || 0;
    state.rulesOverride = remote.rulesOverride ? normalizeRules(remote.rulesOverride) : null;
    state.slots = { red: [...remote.slots?.red ?? []], blue: [...remote.slots?.blue ?? []] };
    state.names = { ...remote.names ?? {} };
    state.started = !!remote.started;
    state.startedAt = Number(remote.startedAt) || 0;
    state.endedAt = Number(remote.endedAt) || 0;
    state.score = { red: Number(remote.score?.red) || 0, blue: Number(remote.score?.blue) || 0 };
    state.lastTouch = remote.lastTouch ? { by: String(remote.lastTouch.by), team: remote.lastTouch.team ?? null, at: Number(remote.lastTouch.at) || 0 } : null;
    state.serveAt = Number(remote.serveAt) || 0;
    state.serves = Number(remote.serves) || 0;
    state.goals = Number(remote.goals) || 0;
    state.playerGoals = { ...remote.playerGoals ?? {} };
    state.outcome = remote.outcome ? { winner: String(remote.outcome.winner), reason: String(remote.outcome.reason ?? "") } : null;
    lastOpLocal = true;
    emit("state");
  }
  function clear() {
    state.rulesOverride = null;
    state.slots = emptySlots();
    state.names = {};
    state.started = false;
    state.startedAt = 0;
    state.endedAt = 0;
    state.score = { red: 0, blue: 0 };
    state.lastTouch = null;
    state.serveAt = 0;
    state.serves = 0;
    state.goals = 0;
    state.playerGoals = {};
    state.outcome = null;
    state.at = 0;
    config.gates = {};
    config.ballUuid = null;
    for (const key of Object.keys(inside)) delete inside[key];
    emit("reset");
  }
  let lastSweep = 0;
  function tick(t) {
    if (t - lastSweep > 1) {
      lastSweep = t;
      const { slots, freed } = freeVanished(state.slots, liveIds());
      if (freed.length) {
        state.slots = slots;
        emit("slots");
      }
    }
    if (!isAuthority()) return;
    if (state.started && state.serveAt && now() >= state.serveAt) serve("auto");
    watchGoals();
    watchRest(t);
    watchEnd();
  }
  function outcomeWinnerName() {
    const o = state.outcome;
    if (!o) return "";
    if (o.winner === "red" || o.winner === "blue" || o.winner === "draw") return o.winner;
    return nameOf(o.winner);
  }
  function outcomeText() {
    const o = state.outcome;
    if (!o) return "";
    const who = o.winner === "draw" ? "Draw" : o.winner === "red" ? "RED wins" : o.winner === "blue" ? "BLUE wins" : nameOf(o.winner) + " wins";
    return who + (o.reason === "time" ? " \u2014 time's up" : "") + " \xB7 " + scoreLine(state.score);
  }
  function sheetRows() {
    const rows = api.peerVars?.all ? api.peerVars.all("goals") : [];
    const byId = new Map(rows.map((r) => [r.id, r]));
    const ids = /* @__PURE__ */ new Set([...state.slots.red, ...state.slots.blue, ...rows.map((r) => r.id)]);
    const read = (id, name) => id === me() ? api.peerVars?.mine?.(name, 0) ?? 0 : (api.peerVars?.all?.(name) ?? []).find((r) => r.id === id)?.value ?? 0;
    return [...ids].map((id) => ({
      id,
      name: byId.get(id)?.name || nameOf(id),
      team: teamOf(state.slots, id),
      goals: read(id, "goals"),
      touches: read(id, "touches"),
      owngoals: read(id, "owngoals"),
      me: id === me()
    }));
  }
  const left = () => state.started ? secondsLeft(rules(), now() - state.startedAt) : null;
  return {
    state,
    config,
    rules,
    me,
    nameOf,
    isAuthority,
    act,
    setRules,
    serve,
    handleMessage,
    getState,
    applyState,
    clear,
    tick,
    wireHits,
    onHit,
    sheetRows,
    matchLog,
    writeMatchLog,
    secondsLeft: left,
    scoreLine: () => scoreLine(state.score),
    outcomeText,
    pitchCentre,
    ball,
    onChange: (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    }
  };
}

// modules/football/src/pitch.js
var RED = 14240330;
var BLUE = 4881881;
var LAMP_DIM = 2237998;
var LAMPS_PER_GATE = 10;
var DEFAULT_DIMS = {
  length: 5,
  width: 3,
  height: 2.4,
  gateWidth: 1.2,
  gateHeight: 0.8,
  mouthY: 1.35,
  ballY: 1.3,
  ballRadius: 0.22,
  sensorDepth: 0.5
};
function num2(v, lo, hi, d) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d;
}
function normalizeDims(raw) {
  const r = raw && typeof raw === "object" ? raw : {};
  const d = DEFAULT_DIMS;
  const length = num2(r.length, 2, 30, d.length);
  const width = num2(r.width, 1.5, 20, d.width);
  return {
    length,
    width,
    height: num2(r.height, 1.8, 8, d.height),
    gateWidth: num2(r.gateWidth, 0.5, Math.min(width, 6), Math.min(d.gateWidth, width)),
    gateHeight: num2(r.gateHeight, 0.3, 3, d.gateHeight),
    mouthY: num2(r.mouthY, 0.5, 2.2, d.mouthY),
    ballY: num2(r.ballY, 0.3, 2.2, d.ballY),
    ballRadius: num2(r.ballRadius, 0.08, 0.6, d.ballRadius),
    sensorDepth: num2(r.sensorDepth, 0.3, 1.5, d.sensorDepth)
  };
}
var NAMES = {
  pitch: "Pitch",
  ball: "Football",
  redGate: "Red gate",
  blueGate: "Blue gate",
  joinRed: "Join red",
  joinBlue: "Join blue",
  start: "Start match",
  newMatch: "New match",
  lamp: (team, i) => (team === "red" ? "Red" : "Blue") + " lamp " + i
};
function pitchObjects(dims) {
  const d = normalizeDims(dims);
  const hl = d.length / 2;
  const hw = d.width / 2;
  const wall = 0.05;
  const mouthZ = hl - 0.3;
  const sensorZ = mouthZ + d.sensorDepth / 2;
  const endZ = mouthZ + d.sensorDepth + 0.05;
  const post = 0.06;
  const out = [];
  const stat = (extra) => ({ mode: "static", ...extra ?? {} });
  out.push({ type: "box", name: NAMES.pitch, color: 3820093, size: [d.width, wall, endZ * 2], pos: [0, -wall / 2, 0], roughness: 0.95, physics: stat({ friction: 0.6 }) });
  const ghost = { color: 10413823, opacity: 0.06 };
  out.push({ type: "box", name: "Wall left", ...ghost, size: [wall, d.height, endZ * 2], pos: [-hw - wall / 2, d.height / 2, 0], physics: stat() });
  out.push({ type: "box", name: "Wall right", ...ghost, size: [wall, d.height, endZ * 2], pos: [hw + wall / 2, d.height / 2, 0], physics: stat() });
  out.push({ type: "box", name: "Wall red end", ...ghost, size: [d.width, d.height, wall], pos: [0, d.height / 2, -endZ - wall / 2], physics: stat() });
  out.push({ type: "box", name: "Wall blue end", ...ghost, size: [d.width, d.height, wall], pos: [0, d.height / 2, endZ + wall / 2], physics: stat() });
  out.push({ type: "box", name: "Ceiling", ...ghost, size: [d.width, wall, endZ * 2], pos: [0, d.height + wall / 2, 0], physics: stat() });
  for (
    const team of
    /** @type {const} */
    ["red", "blue"]
  ) {
    const sign = team === "red" ? -1 : 1;
    const color = team === "red" ? RED : BLUE;
    const z = sign * mouthZ;
    const gx = d.gateWidth / 2;
    const gy = d.gateHeight / 2;
    const frame = { color, emissive: color, emissiveIntensity: 0.9, roughness: 0.4 };
    const T = team === "red" ? "Red" : "Blue";
    out.push({ type: "box", name: T + " post left", ...frame, size: [post, d.gateHeight + post, post], pos: [-gx, d.mouthY, z], physics: stat() });
    out.push({ type: "box", name: T + " post right", ...frame, size: [post, d.gateHeight + post, post], pos: [gx, d.mouthY, z], physics: stat() });
    out.push({ type: "box", name: T + " bar top", ...frame, size: [d.gateWidth + post, post, post], pos: [0, d.mouthY + gy, z], physics: stat() });
    out.push({ type: "box", name: T + " bar bottom", ...frame, size: [d.gateWidth + post, post, post], pos: [0, d.mouthY - gy, z], physics: stat() });
    out.push({
      type: "box",
      name: team === "red" ? NAMES.redGate : NAMES.blueGate,
      color,
      opacity: 0.12,
      size: [d.gateWidth, d.gateHeight, d.sensorDepth],
      pos: [0, d.mouthY, sign * sensorZ],
      physics: stat({ sensor: true, collider: "box" })
    });
    const lampY0 = d.mouthY + gy + 0.25;
    for (let i = 1; i <= LAMPS_PER_GATE; i++) {
      const row = i <= 5 ? 0 : 1;
      const col = (i - 1) % 5;
      out.push({
        type: "box",
        name: NAMES.lamp(team, i),
        color: LAMP_DIM,
        emissive: LAMP_DIM,
        emissiveIntensity: 0.2,
        size: [0.16, 0.16, 0.06],
        pos: [-0.5 + col * 0.25, lampY0 + row * 0.22, z],
        physics: stat()
      });
    }
    out.push({
      type: "box",
      name: team === "red" ? NAMES.joinRed : NAMES.joinBlue,
      color,
      emissive: color,
      emissiveIntensity: 0.5,
      size: [0.3, 0.12, 0.3],
      pos: [sign * -1 * (hw - 0.3), 1.05, sign * (mouthZ - 0.6)],
      physics: stat()
    });
  }
  out.push({ type: "box", name: NAMES.start, color: 5021290, emissive: 5021290, emissiveIntensity: 0.5, size: [0.3, 0.12, 0.3], pos: [hw - 0.3, 1.05, -0.35], physics: stat() });
  out.push({ type: "box", name: NAMES.newMatch, color: 9080730, emissive: 9080730, emissiveIntensity: 0.4, size: [0.3, 0.12, 0.3], pos: [hw - 0.3, 1.05, 0.35], physics: stat() });
  out.push({
    type: "sphere",
    name: NAMES.ball,
    color: 15921906,
    r: d.ballRadius,
    pos: [0, d.ballY, 0],
    roughness: 0.6,
    physics: { mode: "dynamic", mass: 0.45, restitution: 0.7, friction: 0.2 }
  });
  return out;
}
var PITCH_PHYSICS = {
  gravity: 0,
  ground: { enabled: false },
  damping: { linear: 0.35, angular: 0.5 },
  ccd: true,
  knock: { enabled: true, gain: 1, maxSpeed: 10, spin: 0.8 },
  play: { interaction: "grab", grounded: false, simOnPlay: true }
};
function createCommand(o) {
  if (o.type === "sphere") return "/create Sphere " + o.r;
  const [w, h, dpt] = o.size;
  return "/create Box " + w + " " + h + " " + dpt;
}
function pitchGraph(names, opts = {}) {
  const sel = (name) => names?.[name] ?? name;
  const nodes = [];
  const edges = [];
  const N = (id, type, label, x, y2, data) => {
    nodes.push({ id, type, position: { x, y: y2 }, data: { label, ...data }, class: "w-[150px]" });
    return id;
  };
  const E = (source, target, handle) => {
    edges.push({ id: "e-" + source + "-" + target + (handle ? "." + handle : ""), source, target, ...handle ? { targetHandle: handle } : {} });
  };
  let y = 40;
  const row = () => y += 150;
  N("rules", "fbrules", "Match Rules", 280, y, {});
  N("selpitch", "objectselector", "Pitch", 520, y, { selected: sel(NAMES.pitch) });
  E("rules", "selpitch");
  N("selball", "objectselector", "Football", 40, y, { selected: sel(NAMES.ball) });
  E("selball", "rules", "ball");
  row();
  N("gater", "fbgate", "Red gate", 280, y, { team: "red" });
  N("selgater", "objectselector", "Red gate sensor", 520, y, { selected: sel(NAMES.redGate) });
  E("gater", "selgater");
  row();
  N("gateb", "fbgate", "Blue gate", 280, y, { team: "blue" });
  N("selgateb", "objectselector", "Blue gate sensor", 520, y, { selected: sel(NAMES.blueGate) });
  E("gateb", "selgateb");
  row();
  N("records", "fbrecords", "Records", 280, y, {
    show: "all",
    element: opts.hudButtons ? "fb-sheet,fb-sheet-play" : "fb-sheet",
    scoreElement: opts.hudButtons ? "fb-score,fb-score-over" : "fb-score",
    logElement: opts.hudButtons ? "fb-log" : ""
  });
  E("records", "selpitch");
  row();
  const buttons = [
    ["bjoinr", NAMES.joinRed, "join-red"],
    ["bjoinb", NAMES.joinBlue, "join-blue"],
    ["bstart", NAMES.start, "start"],
    ["bnew", NAMES.newMatch, "new-match"]
  ];
  for (const [id, name, action] of buttons) {
    N(id, "fbbutton", "Button: " + action, 280, y, { action });
    N("sel" + id, "objectselector", name, 520, y, { selected: sel(name) });
    E(id, "sel" + id);
    if (opts.hudButtons) {
      N("h" + id, "hudbutton", "HUD " + action, 40, y, { element: "fb-" + action, perPlayer: true });
      N("d" + id, "delay", "HUD " + action + " press", 160, y, { seconds: 0.05, pulse: 0.3 });
      E("h" + id, "d" + id, "trigger");
      E("d" + id, id, "press");
    }
    row();
  }
  for (const team of ["red", "blue"]) {
    for (let i = 1; i <= LAMPS_PER_GATE; i++) {
      const id = "lamp" + team + i;
      const x = 40 + (i - 1) % 5 * 240;
      if ((i - 1) % 5 === 0 && i > 1) row();
      N(id, "fblamp", (team === "red" ? "Red" : "Blue") + " lamp " + i, x, y, { team, index: i });
      N("sel" + id, "objectselector", NAMES.lamp(team, i), x, y + 70, { selected: sel(NAMES.lamp(team, i)) });
      E(id, "sel" + id);
    }
    row();
  }
  if (opts.hudButtons) {
    for (const [id, element] of [["bnewover", "fb-new-match"], ["bnewpause", "fb-new-match-pause"]]) {
      N(id, "fbbutton", "Button: new-match (" + element + ")", 280, y, { action: "new-match" });
      E(id, "selbnew");
      N("h" + id, "hudbutton", "HUD " + element, 40, y, { element, perPlayer: true });
      N("d" + id, "delay", "HUD " + element + " press", 160, y, { seconds: 0.05, pulse: 0.3 });
      E("h" + id, "d" + id, "trigger");
      E("d" + id, id, "press");
      row();
    }
    N("pkey", "keypress", "Press P", 40, y, { code: "KeyP", edge: "down", pulse: 0.3 });
    N("pausetoggle", "hudscreen", "Toggle pause menu", 280, y, { screen: "pause", action: "toggle" });
    E("pkey", "pausetoggle", "trigger");
    row();
    N("bresume", "hudbutton", "Resume button", 40, y, { element: "resume-btn" });
    N("resumehide", "hudscreen", "Close pause menu", 280, y, { screen: "pause", action: "hide" });
    E("bresume", "resumehide", "trigger");
    row();
    N("bquit", "hudbutton", "Quit to menu button", 40, y, { element: "quit-btn" });
    N("doquit", "setgamestate", "Quit to menu", 280, y, { state: "menu", outcome: "", reset: true });
    N("quithide", "hudscreen", "Close pause on quit", 520, y, { screen: "pause", action: "hide" });
    E("bquit", "doquit", "trigger");
    E("bquit", "quithide", "trigger");
    row();
  }
  N("evstart", "fbevent", "On match start", 40, y, { event: "start" });
  N("gostart", "setgamestate", "Match: playing", 280, y, { state: "playing", outcome: "", reset: false });
  E("evstart", "gostart", "trigger");
  row();
  N("evover", "fbevent", "On match over", 40, y, { event: "over" });
  N("goover", "setgamestate", "Match: over", 280, y, { state: "over", outcome: "Match over", reset: false });
  E("evover", "goover", "trigger");
  row();
  N("evnew", "fbevent", "On new match", 40, y, { event: "reset" });
  N("gomenu", "setgamestate", "Match: menu", 280, y, { state: "menu", outcome: "", reset: true });
  E("evnew", "gomenu", "trigger");
  row();
  return { nodes, edges };
}

// modules/football/src/nodes.js
var EXPIRE_FRAMES = 40;
function registerNodes(api, game) {
  let frame = 0;
  let rulesSeen = -1;
  const gateSeen = {};
  const buttons = /* @__PURE__ */ new Map();
  const pressLevel = /* @__PURE__ */ new Map();
  const serveLevel = /* @__PURE__ */ new Map();
  api.registerNodeGroup({
    group: "Football",
    items: [
      {
        type: "fbrules",
        label: "Match Rules",
        defaults: { ...DEFAULT_RULES, ball: "", apply: true },
        params: [
          { key: "mode", kind: "select", options: MODES },
          { key: "winBy", kind: "select", options: WIN_BY },
          { key: "goalsToWin", kind: "range", min: 1, max: 20, step: 1 },
          { key: "matchSeconds", kind: "range", min: 30, max: 1800, step: 10 },
          { key: "serve", kind: "select", options: SERVE },
          { key: "serveDelay", kind: "range", min: 0.5, max: 5, step: 0.1 },
          { key: "serveSpeed", kind: "range", min: 0.5, max: 10, step: 0.1 },
          { key: "ownGoals", kind: "select", options: OWN_GOALS },
          { key: "apply", kind: "toggle" }
        ]
      },
      {
        type: "fbgate",
        label: "Team Gate",
        defaults: { team: "red", label: "" },
        params: [
          { key: "team", kind: "select", options: ["red", "blue"] },
          { key: "label", kind: "text", placeholder: "gate label", maxLength: 24 }
        ]
      },
      {
        type: "fbbutton",
        label: "Match Button",
        defaults: { action: "start", press: 0 },
        params: [{ key: "action", kind: "select", options: ACTIONS }]
      },
      {
        type: "fbserve",
        label: "Serve",
        defaults: { trigger: 0 },
        params: []
      },
      {
        type: "fblamp",
        label: "Score Lamp",
        defaults: { team: "red", index: 1 },
        params: [
          { key: "team", kind: "select", options: ["red", "blue"] },
          { key: "index", kind: "range", min: 1, max: 20, step: 1 }
        ]
      },
      {
        type: "fbrecords",
        label: "Records",
        defaults: { show: "all", element: "fb-sheet", scoreElement: "fb-score", logElement: "" },
        params: [
          { key: "show", kind: "select", options: ["goals", "touches", "owngoals", "all"] },
          { key: "element", kind: "text", placeholder: "HUD list id (sheet)", maxLength: 40 },
          { key: "scoreElement", kind: "text", placeholder: "HUD list id (score)", maxLength: 40 },
          { key: "logElement", kind: "text", placeholder: "HUD list id (match log)", maxLength: 40 }
        ]
      },
      {
        type: "fbvalue",
        label: "Football Value",
        defaults: { read: "red" },
        params: [
          {
            key: "read",
            kind: "select",
            options: ["red", "blue", "goals", "myteam", "lastteam", "started", "left", "players", "serves", "mygoals", "matches"]
          }
        ]
      },
      {
        type: "fbevent",
        label: "Football Event",
        defaults: { event: "goal" },
        params: [{ key: "event", kind: "select", options: ["goal", "redgoal", "bluegoal", "serve", "start", "over", "reset", "touch"] }]
      }
    ]
  });
  api.registerEffect(
    "fbrules",
    (object, base, data) => {
      if (data.apply === false) return;
      rulesSeen = frame;
      const next = {
        mode: data.mode,
        winBy: data.winBy,
        goalsToWin: data.goalsToWin,
        matchSeconds: data.matchSeconds,
        serve: data.serve,
        serveDelay: data.serveDelay,
        serveSpeed: data.serveSpeed,
        ownGoals: data.ownGoals
      };
      if (JSON.stringify(game.config.rules) !== JSON.stringify(next)) game.config.rules = next;
      const wired = typeof data.ball === "string" && data.ball && data.ball !== "-None-" ? data.ball : null;
      const uuid = wired ?? api.objectsGroup()?.getObjectByName("Football")?.uuid ?? null;
      if (uuid !== game.config.ballUuid) game.config.ballUuid = uuid;
    },
    { inputs: { ball: "object" } }
  );
  api.registerEffect("fbgate", (object, base, data) => {
    const team = data.team === "blue" ? "blue" : "red";
    gateSeen[object.uuid] = frame;
    const current = game.config.gates[object.uuid];
    if (!current || current.team !== team || current.label !== (data.label ?? ""))
      game.config.gates[object.uuid] = { team, label: data.label ?? "" };
  });
  api.registerEffect(
    "fbbutton",
    (object, base, data, time, ctx) => {
      const action = ACTIONS.includes(data.action) ? data.action : "none";
      buttons.set(object.uuid, { action, frame, id: ctx?.id ?? object.uuid });
      const level = Number(data.press) > 0 ? 1 : 0;
      const key = ctx?.id ?? object.uuid;
      const was = pressLevel.get(key);
      pressLevel.set(key, level);
      if (was === void 0 || was === level) return;
      if (level === 1) game.act(action);
    },
    // 'number', not 'event': a pulse reaches a module node as a VALUE (1 while the
    // window is open), and an event output coerces to a number — so an On Click, a
    // Delay bridging a HUD Button, a Compare or a Toggle all drive this input
    { inputs: { press: "number" } }
  );
  api.registerEffect(
    "fbserve",
    (object, base, data, time, ctx) => {
      const level = Number(data.trigger) > 0 ? 1 : 0;
      const key = ctx?.id ?? object.uuid;
      const was = serveLevel.get(key);
      serveLevel.set(key, level);
      if (was === void 0 || was === level) return;
      if (level === 1) game.serve("button");
    },
    { inputs: { trigger: "number" } }
    // the `press` rule, one node over
  );
  api.registerEffect("fblamp", (object, base, data) => {
    const team = data.team === "blue" ? "blue" : "red";
    const index = Math.max(1, Math.round(Number(data.index) || 1));
    const lit = (game.state.score[team] ?? 0) >= index;
    const material = object.material;
    if (!material || Array.isArray(material)) return;
    const want = lit ? team === "red" ? RED : BLUE : LAMP_DIM;
    if (material.userData.fbLit === lit && material.userData.fbTeam === team) return;
    material.userData.fbLit = lit;
    material.userData.fbTeam = team;
    material.color?.setHex(want);
    if (material.emissive) {
      material.emissive.setHex(want);
      material.emissiveIntensity = lit ? 1.4 : 0.2;
    }
  });
  let lastRows = "";
  api.registerEffect("fbrecords", (object, base, data) => {
    if (!api.hud?.rows) return;
    const show = data.show ?? "all";
    const rows = game.sheetRows().map((r) => {
      const team = r.team ? r.team.toUpperCase() : "watching";
      if (show === "goals") return r.name + " \u2014 " + r.goals;
      if (show === "touches") return r.name + " \u2014 " + r.touches;
      if (show === "owngoals") return r.name + " \u2014 " + r.owngoals;
      return r.name + " (" + team + ") \u2014 " + r.goals + " goals \xB7 " + r.touches + " touches \xB7 " + r.owngoals + " own";
    });
    const touch = game.state.lastTouch ? "last touch: " + game.nameOf(game.state.lastTouch.by) : "last touch: \u2014";
    const left = game.secondsLeft();
    const score = [game.scoreLine(), touch, ...left == null ? [] : [Math.ceil(left) + "s left"], ...game.state.outcome ? [game.outcomeText()] : []];
    const log = game.matchLog().slice(-8).reverse().map((m) => "RED " + m.red + " \u2014 " + m.blue + " BLUE \xB7 " + m.winner);
    const key = JSON.stringify([rows, score, log]);
    if (key === lastRows) return;
    lastRows = key;
    const each = (field, list) => {
      for (const id of String(field ?? "").split(",")) if (id.trim()) api.hud.rows(id.trim(), list);
    };
    each(data.element, rows);
    each(data.scoreElement, score);
    each(data.logElement, log);
  });
  api.registerValueNode(
    "fbvalue",
    (data) => {
      const s = game.state;
      switch (data?.read) {
        case "blue":
          return s.score.blue;
        case "goals":
          return s.goals;
        case "myteam":
          return teamOf(s.slots, game.me()) === "red" ? 1 : teamOf(s.slots, game.me()) === "blue" ? 2 : 0;
        case "lastteam":
          return s.lastTouch?.team === "red" ? 1 : s.lastTouch?.team === "blue" ? 2 : 0;
        case "started":
          return s.started ? 1 : 0;
        case "left": {
          const left = game.secondsLeft();
          return left == null ? -1 : Math.ceil(left);
        }
        case "players":
          return s.slots.red.length + s.slots.blue.length;
        case "serves":
          return s.serves;
        case "mygoals":
          return api.peerVars?.mine?.("goals", 0) ?? 0;
        case "matches":
          return game.matchLog().length;
        default:
          return s.score.red;
      }
    },
    { vtype: "number" }
  );
  api.registerValueNode("fbevent", () => 0, { vtype: "event" });
  function clickButton(mesh) {
    let cursor = mesh;
    while (cursor && !buttons.has(cursor.uuid)) cursor = cursor.parent;
    if (!cursor) return false;
    const entry = buttons.get(cursor.uuid);
    if (!entry || frame - entry.frame > EXPIRE_FRAMES) return false;
    game.act(entry.action);
    if (typeof api.haptic === "function") api.haptic(0.6, 40);
    return true;
  }
  function tick() {
    frame++;
    if (rulesSeen >= 0 && frame - rulesSeen > EXPIRE_FRAMES) {
      rulesSeen = -1;
      game.config.rules = null;
    }
    for (const [uuid, at] of Object.entries(gateSeen)) {
      if (frame - at > EXPIRE_FRAMES) {
        delete gateSeen[uuid];
        delete game.config.gates[uuid];
      }
    }
    for (const [uuid, entry] of buttons) if (frame - entry.frame > EXPIRE_FRAMES) buttons.delete(uuid);
  }
  return { tick, clickButton, buttons: () => [...buttons.entries()].map(([uuid, e]) => ({ uuid, action: e.action })) };
}

// modules/football/src/toolbox.js
function registerToolbox(api, game, info) {
  function elem(tag, props, css) {
    const node = document.createElement(tag);
    Object.assign(node, props ?? {});
    if (css) node.setAttribute("style", css);
    return node;
  }
  const SELECT_CSS = "background:rgba(0,0,0,0.25);color:inherit;border:1px solid rgba(255,255,255,0.15);border-radius:4px;font-size:11px;padding:1px 3px;";
  const rulesNode = () => api.flow?.nodes ? api.flow.nodes("fbrules")[0] ?? null : null;
  function writeRules(patch) {
    const node = rulesNode();
    if (node && api.flow.setNodeData(node.id, patch)) return;
    game.setRules(patch);
  }
  let built = {};
  async function buildPitch(dims) {
    if (!api.create || !api.flow?.addNodes || !api.physics?.set) {
      api.toast("Football: this app cannot build a pitch (needs api.create / flow.addNodes)");
      return null;
    }
    const objects = pitchObjects(dims);
    const names = {};
    for (const o of objects) {
      const [uuid] = await api.create(createCommand(o), { at: o.pos });
      if (!uuid) continue;
      names[o.name] = uuid;
      const object = api.objectsGroup()?.getObjectByProperty("uuid", uuid);
      if (object) {
        object.name = o.name;
        const m = object.material;
        if (m && !Array.isArray(m)) {
          if (o.color != null) m.color.setHex(o.color);
          if (o.emissive != null && m.emissive) {
            m.emissive.setHex(o.emissive);
            m.emissiveIntensity = o.emissiveIntensity ?? 1;
          }
          if (o.roughness != null) m.roughness = o.roughness;
          if (o.opacity != null && o.opacity < 1) {
            m.transparent = true;
            m.opacity = o.opacity;
          }
        }
      }
      if (o.physics) api.physics.set(uuid, o.physics);
    }
    const graph = pitchGraph(names, { hudButtons: true });
    const index = new Map(graph.nodes.map((n, i) => [n.id, i]));
    api.flow.addNodes({
      nodes: graph.nodes.map((n) => ({ type: n.type, x: n.position.x, y: n.position.y, data: n.data })),
      edges: graph.edges.map((e) => ({ from: index.get(e.source), to: index.get(e.target), ...e.targetHandle ? { handle: e.targetHandle } : {} }))
    });
    if (typeof api.physics.setScene === "function") api.physics.setScene(PITCH_PHYSICS);
    else api.toast("Pitch built \u2014 set Inspector \u25B8 Physics: gravity 0, ground off, Knock on");
    built = names;
    return names;
  }
  function fitPitch(dims, centre = [0, 0, 0]) {
    const group = api.objectsGroup();
    if (!group || !api.moveObject) return 0;
    let moved = 0;
    for (const o of pitchObjects(dims)) {
      if (o.physics?.mode === "dynamic") continue;
      const uuid = built[o.name] ?? group.getObjectByName(o.name)?.uuid;
      const object = uuid ? group.getObjectByProperty("uuid", uuid) : null;
      if (!object) continue;
      const pos = [o.pos[0] + centre[0], o.pos[1] + centre[1], o.pos[2] + centre[2]];
      const scale = o.type === "box" ? o.size.map((v, i) => v / (object.userData.fbSize?.[i] ?? object.geometry?.parameters?.[["width", "height", "depth"][i]] ?? v)) : void 0;
      api.moveObject(uuid, { pos, ...scale ? { scale } : {} });
      moved++;
    }
    return moved;
  }
  function roomBounds() {
    const session = api.xrSession?.() ?? null;
    const space = api.xrReferenceSpace?.() ?? null;
    const geometry = space?.boundsGeometry;
    if (!session || !geometry || geometry.length < 3) return null;
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const p of geometry) {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minZ = Math.min(minZ, p.z);
      maxZ = Math.max(maxZ, p.z);
    }
    return { width: maxX - minX, length: maxZ - minZ, centre: [(minX + maxX) / 2, 0, (minZ + maxZ) / 2] };
  }
  function roomAnchor() {
    const a = api.colocation?.roomAnchor?.() ?? api.roomAnchor?.() ?? null;
    return a && Array.isArray(a.position) ? a : null;
  }
  function mount(el) {
    el.innerHTML = "";
    const r = game.rules();
    const dims = { ...DEFAULT_DIMS };
    const status = elem("div", { className: "tbx-label" }, "white-space:pre-wrap;font-size:11px;opacity:0.85;margin-bottom:6px;");
    el.appendChild(status);
    const row = (label, control) => {
      const line = elem("div", { className: "tbx-row" }, "display:flex;align-items:center;gap:6px;margin:3px 0;");
      line.appendChild(elem("span", { className: "tbx-label", textContent: label }, "flex:1;font-size:11px;"));
      line.appendChild(control);
      el.appendChild(line);
      return line;
    };
    const select = (key, options, value) => {
      const node = (
        /** @type {HTMLSelectElement} */
        elem("select", {}, SELECT_CSS)
      );
      for (const o of options) node.appendChild(elem("option", { value: o, textContent: o }));
      node.value = value;
      node.onchange = () => writeRules({ [key]: node.value });
      return node;
    };
    const number = (key, value, min, max, step) => {
      const node = (
        /** @type {HTMLInputElement} */
        elem("input", { type: "number", value: String(value), min: String(min), max: String(max), step: String(step) }, SELECT_CSS + "width:64px;")
      );
      node.onchange = () => writeRules({ [key]: Number(node.value) });
      return node;
    };
    row("Mode", select("mode", MODES, r.mode));
    row("Win by", select("winBy", WIN_BY, r.winBy));
    row("Goals to win", number("goalsToWin", r.goalsToWin, 1, 20, 1));
    row("Match seconds", number("matchSeconds", r.matchSeconds, 30, 1800, 10));
    row("Serve", select("serve", SERVE, r.serve));
    row("Own goals", select("ownGoals", OWN_GOALS, r.ownGoals));
    const buttons = elem("div", {}, "display:flex;flex-wrap:wrap;gap:4px;margin:6px 0;");
    const button = (label, fn, primary) => {
      const b = elem("button", { className: "tbx-btn" + (primary ? " tbx-primary" : ""), textContent: label });
      b.onclick = fn;
      buttons.appendChild(b);
      return b;
    };
    button("Start", () => game.act("start"), true);
    button("New match", () => game.act("new-match"));
    button("Serve", () => game.act("serve"));
    button("Swap sides", () => game.act("swap-sides"));
    button("Join red", () => game.act("join-red"));
    button("Join blue", () => game.act("join-blue"));
    button("Spectate", () => game.act("spectate"));
    el.appendChild(buttons);
    el.appendChild(elem("div", { className: "tbx-label", textContent: "Pitch (metres)" }, "margin-top:8px;font-size:11px;opacity:0.7;"));
    const dim = (key, min, max) => {
      const node = (
        /** @type {HTMLInputElement} */
        elem("input", { type: "number", value: String(dims[key]), min: String(min), max: String(max), step: "0.1" }, SELECT_CSS + "width:64px;")
      );
      node.onchange = () => dims[key] = Number(node.value);
      return node;
    };
    const lengthInput = dim("length", 2, 30);
    const widthInput = dim("width", 1.5, 20);
    row("Length", lengthInput);
    row("Width", widthInput);
    row("Gate height", dim("mouthY", 0.5, 2.2));
    const pitchButtons = elem("div", {}, "display:flex;flex-wrap:wrap;gap:4px;margin:6px 0;");
    el.appendChild(pitchButtons);
    const pbutton = (label, fn) => {
      const b = elem("button", { className: "tbx-btn", textContent: label });
      b.onclick = fn;
      pitchButtons.appendChild(b);
      return b;
    };
    pbutton("Build pitch", () => {
      buildPitch(dims).then((names) => names && api.toast("Football pitch built (" + Object.keys(names).length + " objects) \u2014 press Play"));
    });
    pbutton("Fit pitch", () => {
      const moved = fitPitch(normalizeDims(dims));
      api.toast(moved ? "Pitch fitted (" + moved + " objects moved)" : "No pitch to fit \u2014 build one first");
    });
    pbutton("Fit to room", () => {
      const bounds = roomBounds();
      if (!bounds) {
        api.toast("No room bounds from the headset \u2014 use the Length / Width sliders");
        return;
      }
      dims.length = Math.max(2, bounds.length - 0.4);
      dims.width = Math.max(1.5, bounds.width - 0.4);
      lengthInput.value = dims.length.toFixed(1);
      widthInput.value = dims.width.toFixed(1);
      fitPitch(normalizeDims(dims), bounds.centre);
      api.toast("Pitch fitted to the room bounds");
    });
    pbutton("Centre on room", () => {
      const anchor = roomAnchor();
      if (!anchor) {
        api.toast("Not colocated \u2014 no room anchor to centre on");
        return;
      }
      fitPitch(normalizeDims(dims), [anchor.position[0], 0, anchor.position[2]]);
      api.toast("Pitch centred on the room anchor");
    });
    const timer = setInterval(() => {
      const s = game.state;
      const left = game.secondsLeft();
      status.textContent = game.scoreLine() + (s.started ? "  \xB7  playing" : s.outcome ? "  \xB7  " + game.outcomeText() : "  \xB7  menu") + (left == null ? "" : "  \xB7  " + Math.ceil(left) + "s") + "\nred: " + (s.slots.red.map(game.nameOf).join(", ") || "\u2014") + "  \xB7  blue: " + (s.slots.blue.map(game.nameOf).join(", ") || "\u2014") + "\nlast touch: " + (s.lastTouch ? game.nameOf(s.lastTouch.by) : "\u2014") + "  \xB7  " + (game.isAuthority() ? "authority: me" : "authority: peer") + "  \xB7  hits: " + info.hitSource();
    }, 500);
    return () => clearInterval(timer);
  }
  const id = api.registerToolbox({ id: "match", title: "Football", width: 280, minW: 240, playMode: true, mount });
  api.registerMenu("Open Football", () => api.openToolbox(id));
  return { buildPitch, fitPitch, roomBounds, roomAnchor, builtNames: () => built, NAMES };
}

// modules/football/src/hud.js
var PANEL = { bg: "rgba(20, 26, 36, 0.92)", radius: 16, border: "1px solid rgba(136, 192, 208, 0.25)" };
var BUTTON = (bg) => ({ size: 16, weight: "600", bg, color: "#ffffff", radius: 10 });
function pitchHud() {
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
            { id: "menu-panel", kind: "panel", anchor: "center", x: 0, y: 0, w: 480, h: 400, z: 0, label: "", style: PANEL },
            { id: "title", kind: "text", anchor: "center", x: 0, y: -150, w: 400, h: 54, z: 1, label: "FOOTBALL", style: { size: 40, weight: "700", color: "#ffd45e", align: "center" } },
            { id: "subtitle", kind: "text", anchor: "center", x: 0, y: -100, w: 440, h: 44, z: 1, label: "Pick a side, then Start. Hit the floating ball with your hands; a ball through the other gate is a goal.", style: { size: 14, color: "#d8dee9", align: "center" }, wrap: true },
            { id: "fb-join-red", kind: "button", anchor: "center", x: -110, y: -30, w: 190, h: 44, z: 1, label: "Join RED", enabled: true, style: BUTTON("#c94a4a") },
            { id: "fb-join-blue", kind: "button", anchor: "center", x: 110, y: -30, w: 190, h: 44, z: 1, label: "Join BLUE", enabled: true, style: BUTTON("#3b7dd8") },
            { id: "fb-start", kind: "button", anchor: "center", x: 0, y: 30, w: 220, h: 48, z: 1, label: "Start match", enabled: true, style: BUTTON("#4c9e6a") },
            { id: "fb-sheet", kind: "list", anchor: "center", x: 0, y: 105, w: 440, h: 70, z: 1, label: "", rows: [], style: { size: 12, color: "#c8d0dc", align: "center" } },
            { id: "menu-hint", kind: "text", anchor: "center", x: 0, y: 165, w: 440, h: 30, z: 1, label: "Walk into the ball to knock it  \xB7  Grab: hold click  \xB7  Pause: P", style: { size: 12, color: "#8b97a8", align: "center" }, wrap: true }
          ]
        },
        {
          id: "hud",
          name: "HUD",
          showWhile: "playing",
          input: "game",
          elements: [
            { id: "fb-score", kind: "list", anchor: "top-center", x: 0, y: 14, w: 420, h: 70, z: 1, label: "", rows: [], style: { size: 18, weight: "600", color: "#e5e9f0", align: "center" } },
            { id: "fb-sheet-play", kind: "list", anchor: "top-right", x: 16, y: 14, w: 260, h: 120, z: 1, label: "", rows: [], style: { size: 12, color: "#c8d0dc", align: "right" } },
            { id: "play-hint", kind: "text", anchor: "bottom-center", x: 0, y: 12, w: 520, h: 20, z: 1, label: "Hit the ball toward the other gate.  Press P to pause.", style: { size: 11, color: "#8b97a8", align: "center" } }
          ]
        },
        {
          id: "pause",
          name: "Pause",
          input: "menu",
          elements: [
            { id: "pause-panel", kind: "panel", anchor: "center", x: 0, y: 0, w: 380, h: 300, z: 0, label: "", style: PANEL },
            { id: "pause-title", kind: "text", anchor: "center", x: 0, y: -95, w: 340, h: 36, z: 1, label: "PAUSED", style: { size: 26, weight: "700", color: "#e5e9f0", align: "center" } },
            { id: "resume-btn", kind: "button", anchor: "center", x: 0, y: -30, w: 240, h: 42, z: 1, label: "Resume", enabled: true, style: BUTTON("#3b7dd8") },
            { id: "fb-new-match-pause", kind: "button", anchor: "center", x: 0, y: 22, w: 240, h: 42, z: 1, label: "New match", enabled: true, style: BUTTON("#4c9e6a") },
            { id: "quit-btn", kind: "button", anchor: "center", x: 0, y: 74, w: 240, h: 42, z: 1, label: "Quit to menu", enabled: true, style: { size: 15, weight: "500", bg: "#3a4150", color: "#e5e9f0", radius: 10 } }
          ]
        },
        {
          id: "over",
          name: "Match over",
          showWhile: "over",
          input: "menu",
          elements: [
            { id: "over-panel", kind: "panel", anchor: "center", x: 0, y: 0, w: 460, h: 360, z: 0, label: "", style: PANEL },
            { id: "over-title", kind: "text", anchor: "center", x: 0, y: -130, w: 420, h: 40, z: 1, label: "MATCH OVER", style: { size: 30, weight: "700", color: "#ffd45e", align: "center" } },
            { id: "fb-score-over", kind: "list", anchor: "center", x: 0, y: -70, w: 420, h: 60, z: 1, label: "", rows: [], style: { size: 16, color: "#e5e9f0", align: "center" } },
            { id: "fb-log", kind: "list", anchor: "center", x: 0, y: 20, w: 420, h: 100, z: 1, label: "", rows: [], style: { size: 12, color: "#c8d0dc", align: "center" } },
            { id: "fb-new-match", kind: "button", anchor: "center", x: 0, y: 120, w: 220, h: 44, z: 1, label: "New match", enabled: true, style: BUTTON("#3b7dd8") }
          ]
        }
      ]
    }
  };
}

// modules/football/src/index.js
var index_default = {
  id: "football",
  name: "Football",
  version: "1.0.0",
  description: "VR football on the knock: floating ball, two team gates, last-touch attribution, modes, per-player records and a saved match log \u2014 every rule a flow node.",
  /** @param {any} api the module SDK surface */
  register(api) {
    const game = createGame(api);
    const nodes = registerNodes(api, game);
    const hitSource = game.wireHits();
    const toolbox = registerToolbox(api, game, { hitSource: () => hitSource });
    api.registerClickHandler((mesh) => nodes.clickButton(mesh), { modes: ["interact", "play"] });
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
    if (api.hud?.registerDebugLine)
      api.hud.registerDebugLine(() => "football " + game.scoreLine() + (game.state.started ? " playing" : "") + " \xB7 hits via " + hitSource);
    if (api.hud?.registerAction)
      for (const action of ["join-red", "join-blue", "start", "new-match", "spectate", "swap-sides"])
        api.hud.registerAction({ key: action, label: "Football: " + action, group: "Football", role: "press", node: "fbbutton", data: { action }, handle: "press" });
    if (typeof window !== "undefined") {
      window.__football = {
        game,
        nodes,
        toolbox,
        hud: pitchHud,
        hitSource: () => hitSource,
        snapshot: () => ({
          ...game.getState(),
          rules: game.rules(),
          gates: { ...game.config.gates },
          ball: game.config.ballUuid,
          authority: game.isAuthority(),
          buttons: nodes.buttons(),
          sheet: game.sheetRows(),
          log: game.matchLog(),
          hitSource
        })
      };
    }
  }
};
export {
  index_default as default
};
