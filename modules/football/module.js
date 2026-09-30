// modules/football/src/rules.js
var TEAMS = ["red", "blue"];
var MODES = ["duel", "teams", "freeforall", "practice"];
var WIN_BY = ["goals", "time", "either"];
var SERVE = ["auto", "button"];
var OWN_GOALS = ["count", "ignore"];
var ACTIONS = ["none", "join-red", "join-blue", "spectate", "start", "new-match", "swap-sides", "serve", "rematch"];
var TIE = ["golden", "draw"];
var DEFAULT_RULES = {
  mode: "teams",
  winBy: "either",
  goalsToWin: 5,
  matchSeconds: 180,
  serve: "auto",
  serveDelay: 3,
  ownGoals: "count",
  serveSpeed: 0.5,
  tie: "golden"
};
var CELEBRATE_SECONDS = 2.5;
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
    serveSpeed: num(r.serveSpeed, 0.2, 10, d.serveSpeed),
    tie: pick(r.tie, TIE, d.tie)
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
function balancedTeam(slots, prefer = "red") {
  const r = slots.red.length;
  const b = slots.blue.length;
  if (r < b) return "red";
  if (b < r) return "blue";
  return prefer === "blue" ? "blue" : "red";
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
      if (tie && r.tie === "golden") return null;
      return { winner: best && !tie ? best.id : "draw", reason: "time" };
    }
    if (score.red === score.blue) return r.tie === "golden" ? null : { winner: "draw", reason: "time" };
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
function goldenGoal({ score, rules, elapsed, playerGoals }) {
  const r = normalizeRules(rules);
  if (r.mode === "practice" || r.tie !== "golden") return false;
  if (r.winBy !== "time" && r.winBy !== "either") return false;
  if (!(elapsed >= r.matchSeconds)) return false;
  if (r.mode === "freeforall") {
    const counts = Object.values(playerGoals ?? {});
    const best = counts.length ? Math.max(...counts) : 0;
    return counts.filter((n) => n === best).length !== 1;
  }
  return score.red === score.blue;
}
function matchPhase(s, now) {
  if (!s.started) return s.outcome ? "over" : "menu";
  if (s.celebrateUntil && now < s.celebrateUntil) return "celebrate";
  if (s.serveAt) return "countdown";
  return "live";
}
function countdownNumber(serveAt, now) {
  if (!serveAt || now >= serveAt) return 0;
  return Math.max(1, Math.ceil(serveAt - now - 1e-9));
}
function startKickTeam(at) {
  return hash32(Math.floor(at * 1e3), "kickoff") >>> 16 & 1 ? "blue" : "red";
}
function kickoffImpulse(team, redGate, blueGate, mass, speed, at) {
  const toward = team === "blue" ? blueGate : redGate;
  const away = team === "blue" ? redGate : blueGate;
  let ax = toward[0] - away[0];
  let az = toward[2] - away[2];
  const len = Math.hypot(ax, az);
  if (len < 1e-6) {
    ax = 0;
    az = team === "blue" ? 1 : -1;
  } else {
    ax /= len;
    az /= len;
  }
  const side = hash32(Math.floor(at * 1e3), "lean") >>> 16 & 1 ? 1 : -1;
  const c = Math.cos(0.61);
  const s = Math.sin(0.61) * side;
  const dx = ax * c - az * s;
  const dz = ax * s + az * c;
  const m = Math.max(0.01, mass || 1) * Math.max(0, speed);
  return [dx * m, 0, dz * m];
}
function playedSeconds(s, now) {
  const base = Number(s.clockBase) || 0;
  const since = Number(s.liveSince) || 0;
  return base + (since ? Math.max(0, now - since) : 0);
}
function teamSpawn(team, redGate, blueGate, depth = 1.6) {
  const own = team === "red" ? redGate : blueGate;
  const cx = (redGate[0] + blueGate[0]) / 2;
  const cz = (redGate[2] + blueGate[2]) / 2;
  let dx = own[0] - cx;
  let dz = own[2] - cz;
  const d = Math.hypot(dx, dz);
  if (d < 1e-6) {
    dx = 0;
    dz = team === "red" ? -1 : 1;
  } else {
    dx /= d;
    dz /= d;
  }
  return { position: [cx + dx * depth, 0, cz + dz * depth], yaw: Math.atan2(dx, dz) };
}
function bannerScore(score) {
  return "Red " + (score.red ?? 0) + " - " + (score.blue ?? 0) + " Blue";
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
function matchClock(rules, elapsed) {
  if (elapsed == null || !Number.isFinite(elapsed)) return "0:00";
  const left = secondsLeft(rules, Math.max(0, elapsed));
  const s = Math.max(0, Math.floor(left == null ? elapsed : Math.ceil(left)));
  return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
}
function scoreLine(score) {
  return "RED " + (score.red ?? 0) + " \u2014 " + (score.blue ?? 0) + " BLUE";
}

// modules/football/src/fx.js
var LEGACY_SOUND = { goal: "bell", whistle: "chime", kick: "pop", click: "pluck", cheer: null, hit: null, success: "bell", fail: null };
var LEGACY_HAPTIC = {
  tap: [0.2, 20],
  bump: [0.4, 35],
  hit: [0.7, 45],
  success: [0.8, 160],
  fail: [0.5, 220],
  rumble: [0.6, 400],
  heartbeat: [0.5, 90]
};
var LOG_CAP = 80;
function createFx(api) {
  const calls = [];
  const note = (kind, name, opts, native) => {
    calls.push({ kind, name, ...opts === void 0 ? {} : { opts }, native });
    while (calls.length > LOG_CAP) calls.shift();
  };
  const hasSfx = () => !!api.music && typeof api.music.play === "function";
  return {
    /**
     * A big centred banner (C2): "GOAL!", "3", "RED WINS". Without api.announce a
     * `toast: true` banner (a goal, a result) becomes a toast on desktop; a countdown
     * digit is simply dropped (three toasts a second would be noise).
     * @param {string} text @param {{sub?: string, ms?: number, color?: string, toast?: boolean}} [opts]
     */
    announce(text, opts = {}) {
      const { toast, ...rest } = opts;
      const native = typeof api.announce === "function";
      note("announce", text, rest, native);
      if (native) api.announce(text, rest);
      else if (toast && !api.isVR?.()) api.toast?.(rest.sub ? text + "  " + rest.sub : text);
    },
    /** @param {string} name @param {number[]} [pos] world position */
    sound(name, pos) {
      const native = hasSfx();
      note("sound", name, void 0, native);
      if (native) api.playSound?.(name, pos);
      else {
        const legacy = (
          /** @type {any} */
          LEGACY_SOUND[name]
        );
        if (legacy) api.playSound?.(legacy, pos);
      }
    },
    /** C6: a pooled particle burst at a WORLD position @param {number[]} pos @param {any} opts */
    burst(pos, opts) {
      const native = typeof api.effects?.burst === "function";
      note("burst", opts?.kind ?? "sparkle", opts, native);
      if (native) api.effects.burst(pos, opts);
    },
    /** C4: a named haptic preset (core makes it a no-op in Edit) @param {string} name @param {'left'|'right'} [hand] */
    haptic(name, hand) {
      const native = typeof api.hapticPattern === "function";
      note("haptic", name, hand ? { hand } : void 0, native);
      if (native) api.hapticPattern(name, hand);
      else {
        const pulse = (
          /** @type {any} */
          LEGACY_HAPTIC[name]
        );
        if (pulse && typeof api.haptic === "function") api.haptic(pulse[0], pulse[1], hand);
      }
    },
    /** a raw pulse scaled by the caller (a kick's impulse) @param {number} intensity @param {number} ms @param {'left'|'right'} [hand] */
    pulse(intensity, ms, hand) {
      note("pulse", String(Math.round(intensity * 100) / 100), hand ? { hand } : void 0, typeof api.haptic === "function");
      api.haptic?.(intensity, ms, hand);
    },
    /** C5 music: a procedural loop, LOCAL; core stops it on leaving Play/Interact @param {string} preset @param {any} [opts] */
    music(preset, opts) {
      const native = hasSfx();
      note("music", preset, opts, native);
      if (native) api.music.play(preset, opts);
    },
    stopMusic() {
      const native = hasSfx();
      note("music", "stop", void 0, native);
      if (native) api.music.stop?.();
    },
    /** is there game music on this core (C5) */
    hasMusic: () => hasSfx(),
    /** the preset playing now, or null */
    musicNow: () => hasSfx() ? api.music.current?.() ?? null : null,
    /** record a call the game made on another api (setSpawn) @param {string} kind @param {string} name @param {any} [opts] */
    note: (kind, name, opts) => note(kind, name, opts, true),
    /** what the game asked for, oldest first (the flight's and the unit test's window) */
    log: () => calls.map((c) => ({ ...c })),
    clearLog: () => {
      calls.length = 0;
    }
  };
}

// modules/football/src/kick.js
var TIP_RADIUS = 0.07;
var TIP_OFFSET = 0.05;
var MIN_KICK_SPEED = 0.35;
var KICK_GAIN = 1.3;
var MAX_KICK_SPEED = 10;
var VELOCITY_WINDOW_MS = 90;
var DEDUPE_MS = 250;
var CLICK_REACH = 2.5;
var CLICK_KICK_SPEED = 4;
function rotate(v, q) {
  const [x, y, z] = v;
  const [qx, qy, qz, qw] = q;
  const tx = 2 * (qy * z - qz * y);
  const ty = 2 * (qz * x - qx * z);
  const tz = 2 * (qx * y - qy * x);
  return [x + qw * tx + (qy * tz - qz * ty), y + qw * ty + (qz * tx - qx * tz), z + qw * tz + (qx * ty - qy * tx)];
}
function tipPoint(pos, quat, offset = TIP_OFFSET) {
  if (!quat) return [pos[0], pos[1], pos[2]];
  const f = rotate([0, 0, -offset], quat);
  return [pos[0] + f[0], pos[1] + f[1], pos[2] + f[2]];
}
function pushSample(ring, p, t, windowMs = VELOCITY_WINDOW_MS) {
  if (ring.length && t < ring[ring.length - 1].t) ring.length = 0;
  ring.push({ t, p: [p[0], p[1], p[2]] });
  while (ring.length > 2 && t - ring[0].t > windowMs) ring.shift();
  return ring;
}
function ringVelocity(ring) {
  if (ring.length < 2) return [0, 0, 0];
  const a = ring[0];
  const b = ring[ring.length - 1];
  const dt = (b.t - a.t) / 1e3;
  if (!(dt > 1e-4)) return [0, 0, 0];
  return [(b.p[0] - a.p[0]) / dt, (b.p[1] - a.p[1]) / dt, (b.p[2] - a.p[2]) / dt];
}
function kickContact(tip, tipVel, tipR, ball, ballVel, ballR) {
  const dx = ball[0] - tip[0];
  const dy = ball[1] - tip[1];
  const dz = ball[2] - tip[2];
  const d = Math.hypot(dx, dy, dz);
  const overlap = d < tipR + ballR;
  let n = d > 1e-6 ? [dx / d, dy / d, dz / d] : null;
  if (!n) {
    const s = Math.hypot(tipVel[0], tipVel[1], tipVel[2]);
    n = s > 1e-6 ? [tipVel[0] / s, tipVel[1] / s, tipVel[2] / s] : [0, 0, -1];
  }
  const rel = [tipVel[0] - ballVel[0], tipVel[1] - ballVel[1], tipVel[2] - ballVel[2]];
  const approach = rel[0] * n[0] + rel[1] * n[1] + rel[2] * n[2];
  return { overlap, n, approach, distance: d };
}
function kickImpulse(n, approach, mass, ballVel, gain = KICK_GAIN, maxSpeed = MAX_KICK_SPEED) {
  let dv = Math.max(0, approach) * gain;
  const m = Math.max(0.01, mass || 1);
  const after = [ballVel[0] + n[0] * dv, ballVel[1] + n[1] * dv, ballVel[2] + n[2] * dv];
  const speed = Math.hypot(after[0], after[1], after[2]);
  if (speed > maxSpeed && dv > 0) {
    const b = ballVel[0] * n[0] + ballVel[1] * n[1] + ballVel[2] * n[2];
    const c = ballVel[0] ** 2 + ballVel[1] ** 2 + ballVel[2] ** 2 - maxSpeed * maxSpeed;
    const disc = b * b - c;
    dv = disc >= 0 ? Math.max(0, Math.min(dv, -b + Math.sqrt(disc))) : 0;
  }
  return [n[0] * dv * m, n[1] * dv * m, n[2] * dv * m];
}
function kickHaptic(speed) {
  return Math.min(1, 0.25 + Math.max(0, speed) / 8);
}
function bounced(before, after, minSpeed = 0.6) {
  const a = Math.hypot(before[0], before[1], before[2]);
  const b = Math.hypot(after[0], after[1], after[2]);
  if (a < minSpeed || b < minSpeed * 0.5) return false;
  const cos = (before[0] * after[0] + before[1] * after[1] + before[2] * after[2]) / (a * b);
  return cos < 0.35;
}
function armStep(state, distance, reach, release = 0.03) {
  if (distance > reach + release) state.spent = false;
  return !state.spent && distance < reach;
}

// modules/football/src/game.js
var LOG_VAR = "football";
var TEAM_CSS = { red: "#e0524f", blue: "#4f86e6" };
function createGame(api) {
  const THREE = api.THREE;
  const fx = createFx(api);
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
    // 30b: the match flow (rules.js matchPhase) — all derived from op stamps
    /** a goal's celebration runs until this synced second (0 = none) */
    celebrateUntil: 0,
    /** the gate (sensor uuid) the last goal went into — the ball rests there */
    goalGate: "",
    /** @type {'red'|'blue'} who takes the next kick-off */
    kickTeam: (
      /** @type {'red'|'blue'} */
      "red"
    ),
    /** seconds played before the current live stretch; the clock stops between them */
    clockBase: 0,
    /** when the current live stretch began (0 = the clock is stopped) */
    liveSince: 0,
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
    state.celebrateUntil = 0;
    state.goalGate = "";
    state.kickTeam = startKickTeam(at);
    state.clockBase = 0;
    state.liveSince = 0;
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
    state.celebrateUntil = 0;
    state.goalGate = "";
    state.clockBase = 0;
    state.liveSince = 0;
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
    if (state.liveSince) state.clockBase += Math.max(0, at - state.liveSince);
    state.liveSince = 0;
    state.celebrateUntil = at + CELEBRATE_SECONDS;
    state.goalGate = String(data.gate ?? "");
    state.kickTeam = data.gateTeam === "blue" ? "blue" : "red";
    state.serveAt = rules().serve === "auto" ? state.celebrateUntil + rules().serveDelay : 0;
    const gate = api.objectsGroup()?.getObjectByProperty("uuid", data.gate);
    const where = gate ? gate.getWorldPosition(new THREE.Vector3()).toArray() : void 0;
    presentGoal(a, where);
    emit("goal", a);
    fireEvent("goal");
    if (a.counts && a.team) fireEvent(a.team + "goal");
    return true;
  }
  function applyServeOp(data) {
    const at = stamp(data);
    state.serves++;
    state.serveAt = 0;
    state.lastTouch = null;
    if (state.started && !state.liveSince) state.liveSince = at;
    if (state.started && data.why !== "rest") {
      fx.sound("whistle", ballWorld());
      fx.announce("GO!", { ms: 700, color: TEAM_CSS[state.kickTeam] });
    }
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
    state.celebrateUntil = 0;
    if (state.liveSince) state.clockBase += Math.max(0, at - state.liveSince);
    state.liveSince = 0;
    state.outcome = { winner: String(data.winner ?? "draw"), reason: String(data.reason ?? "") };
    presentOver();
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
  let spectating = false;
  function myHalf() {
    const p = typeof api.playerPosition === "function" ? api.playerPosition() : null;
    const red = gateLocal("red");
    const blue = gateLocal("blue");
    if (!p || !red || !blue) return "red";
    const d = (g) => Math.hypot(p[0] - g[0], p[2] - g[2]);
    return d(red) <= d(blue) ? "red" : "blue";
  }
  function autoJoin() {
    const mode = rules().mode;
    if (spectating || mode === "freeforall" || mode === "practice") return false;
    if (teamOf(state.slots, me())) return false;
    const team = balancedTeam(state.slots, myHalf());
    if (!canJoin(state.slots, team, me(), mode).ok) return false;
    const data = { op: "slot", team, peerId: me(), name: nameOf(me()), at: now() };
    applySlotOp(data);
    api.send(data);
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
        spectating = team === "none";
        const data = { op: "slot", team, peerId: me(), name: nameOf(me()), at };
        applySlotOp(data);
        api.send(data);
        return true;
      }
      case "start": {
        if (state.started) return false;
        autoJoin();
        const data = { op: "start", at: now() };
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
      case "rematch": {
        act("new-match");
        return act("start");
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
  function localPos(uuid) {
    const o = uuid ? api.objectsGroup()?.getObjectByProperty("uuid", uuid) : null;
    return o ? o.position.toArray() : null;
  }
  function gateLocal(team) {
    const uuid = Object.keys(config.gates).find((u) => config.gates[u].team === team);
    return uuid ? localPos(uuid) : null;
  }
  function kickoffSpot() {
    const red = gateLocal("red");
    const blue = gateLocal("blue");
    if (!red || !blue) return null;
    return [(red[0] + blue[0]) / 2, (red[1] + blue[1]) / 2, (red[2] + blue[2]) / 2];
  }
  function ballWorld() {
    const o = ball();
    return o ? o.getWorldPosition(new THREE.Vector3()).toArray() : void 0;
  }
  function placeBall(spot) {
    const o = ball();
    if (!o || !spot || !api.physics?.running?.()) return false;
    const p = o.position;
    if (Math.hypot(p.x - spot[0], p.y - spot[1], p.z - spot[2]) < 0.02) return false;
    api.moveObject?.(o.uuid, { pos: spot, rot: [0, 0, 0] });
    return true;
  }
  let pendingNudge = null;
  function serve(why) {
    if (!isAuthority()) return false;
    const object = ball();
    if (!object) return false;
    const at = now();
    const mass = Number(object.userData?.physics?.mass) || 1;
    const r = rules();
    let pushed = false;
    if (why === "rest") {
      const centre = pitchCentre();
      centre[1] = object.position.y;
      pushed = api.physics.applyImpulse(object.uuid, serveImpulse(object.position.toArray(), centre, mass, Math.max(r.serveSpeed, 0.8), at));
    } else {
      const red = gateLocal("red") ?? [0, 0, -1];
      const blue = gateLocal("blue") ?? [0, 0, 1];
      const moved = placeBall(kickoffSpot() ?? object.position.toArray());
      const impulse = kickoffImpulse(state.kickTeam, red, blue, mass, r.serveSpeed, at);
      pushed = !moved && api.physics.applyImpulse(object.uuid, impulse);
      const ms = performance.now();
      pendingNudge = pushed ? null : { impulse, after: moved ? ms + 350 : 0, until: ms + 1800 };
      why = why === "button" ? "button" : "kickoff";
    }
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
    const live = matchPhase(state, now()) === "live";
    for (const [uuid, gate] of Object.entries(config.gates)) {
      const sensor = group?.getObjectByProperty("uuid", uuid);
      if (!sensor) continue;
      _box.setFromObject(sensor);
      const isIn = _box.containsPoint(_pos);
      const was = !!inside[uuid];
      inside[uuid] = isIn;
      if (!isIn || was || !live) continue;
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
    if (!object || matchPhase(state, now()) !== "live") {
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
    if (matchPhase(state, now()) === "celebrate") return;
    const outcome = matchOutcome({ score: state.score, rules: rules(), elapsed: elapsed() ?? 0, playerGoals: state.playerGoals });
    if (!outcome) return;
    const data = { op: "over", at: now(), ...outcome };
    applyOver(data);
    api.send(data);
    writeMatchLog();
  }
  function driveBall() {
    const phase2 = matchPhase(state, now());
    if (phase2 === "celebrate") placeBall(localPos(state.goalGate) ?? kickoffSpot() ?? []);
    else if (phase2 === "countdown") placeBall(kickoffSpot() ?? []);
    else if (phase2 === "live" && state.celebrateUntil && placedFor !== state.celebrateUntil) {
      placedFor = state.celebrateUntil;
      if (rules().serve !== "auto") placeBall(kickoffSpot() ?? []);
    }
    if (pendingNudge && performance.now() >= pendingNudge.after) {
      const o = ball();
      if (!o || performance.now() > pendingNudge.until || api.physics.applyImpulse(o.uuid, pendingNudge.impulse)) pendingNudge = null;
    }
  }
  let placedFor = 0;
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
    const by = String(hit.by || (hit.local ? me() : ""));
    if (!by) return;
    coreHitAt.set(by, performance.now());
    lastTouchPerf = performance.now();
    fx.sound("kick", ballWorld());
    if (by === me()) onCoreHitByMe();
    const team = teamOf(state.slots, by);
    state.lastTouch = { by, team, at: Number(hit.at) || now() };
    if (by === me() && state.started && api.peerVars?.setMine) api.peerVars.setMine("touches", api.peerVars.mine("touches", 0) + 1);
    emit("touch", state.lastTouch);
    if (by === me()) {
      fireEvent("touch");
      if (hit.local !== false) touchedByMe();
    }
  }
  const coreHitAt = /* @__PURE__ */ new Map();
  let lastTouchPerf = -Infinity;
  let onCoreHitByMe = () => {
  };
  function applyKick(data, local) {
    if (!config.ballUuid || data?.uuid !== config.ballUuid) return false;
    const by = String(data.by || (local ? me() : ""));
    let impulse = Array.isArray(data.impulse) ? data.impulse.slice(0, 3).map((n) => Number(n) || 0) : null;
    const mass = Number(ball()?.userData?.physics?.mass) || 0.45;
    const size = impulse ? Math.hypot(impulse[0], impulse[1], impulse[2]) : 0;
    if (impulse && size > MAX_KICK_SPEED * mass) impulse = impulse.map((n) => n * MAX_KICK_SPEED * mass / size);
    if (impulse && api.physics?.isInitiator?.()) {
      const recent = coreHitAt.get(by) ?? -Infinity;
      if (local || performance.now() - recent >= DEDUPE_MS) api.physics.applyImpulse(data.uuid, impulse);
    }
    lastTouchPerf = performance.now();
    fx.sound("kick", ballWorld());
    if (!by) return true;
    state.lastTouch = { by, team: teamOf(state.slots, by), at: Number(data.at) || now() };
    if (by === me() && state.started && api.peerVars?.setMine) api.peerVars.setMine("touches", api.peerVars.mine("touches", 0) + 1);
    emit("touch", state.lastTouch);
    if (by === me() && local) {
      fireEvent("touch");
      touchedByMe();
    }
    return true;
  }
  function touchedByMe() {
    if (!localActive()) return;
    const phase2 = matchPhase(state, now());
    if (phase2 === "menu") act("start");
    else if (state.started && !teamOf(state.slots, me())) {
      if (autoJoin()) state.lastTouch = { by: me(), team: teamOf(state.slots, me()), at: state.lastTouch?.at ?? now() };
    }
  }
  function localActive() {
    if (api.isPlaying?.()) return true;
    const mode = typeof api.editorMode === "function" ? api.editorMode() : "edit";
    if (mode === "interact") return true;
    return !!api.isVR?.() && typeof api.setSpawn !== "function";
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
  function presentGoal(a, where) {
    if (!a.counts) {
      fx.announce("NO GOAL", { sub: a.reason === "practice" ? "Practice \u2014 nothing counts" : "Own goals are ignored", ms: 1400, color: "#c8d0dc" });
      fx.sound("whistle", where);
      return;
    }
    const team = a.team;
    const colour = team ? TEAM_CSS[team] : "#ffd45e";
    let sub = bannerScore(state.score);
    if (!team && a.by) sub = nameOf(a.by) + " \u2014 " + (state.playerGoals[a.by] ?? 0);
    else if (a.by) sub = (a.own ? "Own goal by " : "") + nameOf(a.by) + " \xB7 " + bannerScore(state.score);
    fx.announce(a.own ? "OWN GOAL!" : "GOAL!", { sub, ms: 2200, color: colour, toast: true });
    fx.sound("goal", where);
    fx.sound("cheer", where);
    if (where) fx.burst(where, { kind: "confetti", color: colour, count: 90 });
    const mine = teamOf(state.slots, me());
    if (team && mine === team) fx.haptic("success");
    else if (team && mine) fx.haptic("fail");
    else if (!team && a.by === me()) fx.haptic("success");
  }
  function presentOver() {
    const o = state.outcome;
    if (!o) return;
    const winner = o.winner;
    const colour = winner === "red" || winner === "blue" ? TEAM_CSS[winner] : "#ffd45e";
    const title = winner === "draw" ? "DRAW" : winner === "red" ? "RED WINS!" : winner === "blue" ? "BLUE WINS!" : nameOf(winner).toUpperCase() + " WINS!";
    fx.sound("whistle", ballWorld());
    fx.announce(title, { sub: bannerScore(state.score) + (goldenPlayed ? " \xB7 golden goal" : ""), ms: 3200, color: colour, toast: true });
    if (winner !== "draw") fx.sound("cheer", ballWorld());
    const mine = teamOf(state.slots, me());
    if (mine && mine === winner) fx.haptic("success");
    else if (mine && winner !== "draw") fx.haptic("fail");
    else if (winner === me()) fx.haptic("success");
  }
  let shownCount = "";
  let goldenPlayed = false;
  let musicOn = false;
  function presentTick() {
    const t = now();
    if (state.started && state.serveAt && matchPhase(state, t) === "countdown") {
      const n = countdownNumber(state.serveAt, t);
      const key = state.serveAt + ":" + n;
      if (n > 0 && n <= 3 && key !== shownCount) {
        shownCount = key;
        const team = state.kickTeam;
        fx.announce(String(n), { sub: (team === "red" ? "Red" : "Blue") + " kicks off", ms: 800, color: TEAM_CSS[team] });
        fx.sound("click", ballWorld());
      }
    }
    const golden2 = state.started && goldenGoal({ score: state.score, rules: rules(), elapsed: elapsed() ?? 0, playerGoals: state.playerGoals });
    if (golden2 && !goldenPlayed) {
      goldenPlayed = true;
      fx.sound("whistle", ballWorld());
      fx.announce("GOLDEN GOAL", { sub: "Level at full time \u2014 the next goal wins", ms: 2600, color: "#ffd45e", toast: true });
    }
    if (!state.started && !state.outcome) goldenPlayed = false;
    const want = !!config.ballUuid && localActive();
    const ms = performance.now();
    if (want !== musicOn) {
      musicOn = want;
      musicTry = ms;
      if (want) fx.music("stadium", { volume: 0.55 });
      else fx.stopMusic();
    } else if (want && fx.hasMusic() && fx.musicNow() !== "stadium" && ms - musicTry > 2e3) {
      musicTry = ms;
      fx.music("stadium", { volume: 0.55 });
    }
    placeSpawn();
  }
  let musicTry = 0;
  let spawnKey = "";
  function placeSpawn() {
    if (typeof api.setSpawn !== "function" || !config.ballUuid) return;
    const red = gateLocal("red");
    const blue = gateLocal("blue");
    if (!red || !blue) return;
    const team = teamOf(state.slots, me()) ?? "blue";
    const key = team + ":" + red.map((n) => n.toFixed(2)).join() + ":" + blue.map((n) => n.toFixed(2)).join();
    if (key === spawnKey) return;
    spawnKey = key;
    const { position, yaw } = teamSpawn(team, red, blue);
    fx.note("spawn", team, { position, yaw });
    api.setSpawn(position, yaw);
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
        case "kick":
          return applyKick(data, false);
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
      outcome: state.outcome ? { ...state.outcome } : null,
      celebrateUntil: state.celebrateUntil,
      goalGate: state.goalGate,
      kickTeam: state.kickTeam,
      clockBase: state.clockBase,
      liveSince: state.liveSince
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
    state.celebrateUntil = Number(remote.celebrateUntil) || 0;
    state.goalGate = String(remote.goalGate ?? "");
    state.kickTeam = remote.kickTeam === "blue" ? "blue" : "red";
    state.clockBase = Number(remote.clockBase) || 0;
    state.liveSince = remote.clockBase == null && remote.liveSince == null ? state.startedAt : Number(remote.liveSince) || 0;
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
    state.celebrateUntil = 0;
    state.goalGate = "";
    state.kickTeam = "red";
    state.clockBase = 0;
    state.liveSince = 0;
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
    presentTick();
    if (!isAuthority()) return;
    if (state.started && state.serveAt && now() >= state.serveAt) serve("kickoff");
    driveBall();
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
  const elapsed = () => state.started || state.endedAt && state.startedAt ? playedSeconds(state, now()) : null;
  const left = () => state.started ? secondsLeft(rules(), elapsed() ?? 0) : null;
  const golden = () => state.started && goldenGoal({ score: state.score, rules: rules(), elapsed: elapsed() ?? 0, playerGoals: state.playerGoals });
  const phase = () => matchPhase(state, now());
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
    elapsed,
    golden,
    phase,
    fx,
    localActive,
    kickoffSpot,
    applyKick,
    lastTouchMs: () => lastTouchPerf,
    onCoreHitByMe: (fn) => {
      onCoreHitByMe = fn;
    },
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
var GLASS = {
  color: 15267583,
  opacity: 0.1,
  physical: true,
  transmission: 1,
  thickness: 0.02,
  ior: 1.45,
  // near-zero specular: the floodlights' spot highlights on the side panes read as glow blobs
  // floating at pitch height
  roughness: 0.2,
  specularIntensity: 0.06,
  shadow: false,
  pick: "through"
};
function lampStripY(d) {
  return d.mouthY + d.gateHeight / 2 + 0.15;
}
function lampX(i, width) {
  const pitch = Math.min(0.22, (width - 0.3) / LAMPS_PER_GATE);
  return (i - (LAMPS_PER_GATE + 1) / 2) * pitch;
}
var DEFAULT_DIMS = {
  length: 5,
  width: 3,
  height: 2.4,
  gateWidth: 1.5,
  gateHeight: 1,
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
var CONSOLE_OUT = 0.45;
function consolePositions(d) {
  const x = d.width / 2 + CONSOLE_OUT;
  const far = Math.min(1.3, d.length / 2 - 0.7);
  return {
    [NAMES.joinRed]: [x, 1.05, -far],
    [NAMES.start]: [x, 1.05, -0.42],
    [NAMES.newMatch]: [x, 1.05, 0.42],
    [NAMES.joinBlue]: [x, 1.05, far]
  };
}
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
  out.push({ type: "box", name: NAMES.pitch, color: 3111484, size: [d.width, wall, endZ * 2], pos: [0, -wall / 2, 0], roughness: 0.95, physics: stat({ friction: 0.6 }) });
  const ghost = { ...GLASS };
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
    const frame = { color, emissive: color, emissiveIntensity: 2.4, roughness: 0.3 };
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
      shadow: false,
      size: [d.gateWidth, d.gateHeight, d.sensorDepth],
      pos: [0, d.mouthY, sign * sensorZ],
      physics: stat({ sensor: true, collider: "box" })
    });
    const lampY = lampStripY(d);
    for (let i = 1; i <= LAMPS_PER_GATE; i++) {
      out.push({
        type: "box",
        name: NAMES.lamp(team, i),
        color: LAMP_DIM,
        emissive: LAMP_DIM,
        emissiveIntensity: 0.2,
        clearcoat: 1,
        roughness: 0.35,
        size: [0.16, 0.16, 0.05],
        pos: [lampX(i, d.width), lampY, z],
        physics: stat()
      });
    }
    const joinName = team === "red" ? NAMES.joinRed : NAMES.joinBlue;
    out.push({
      type: "box",
      name: joinName,
      color,
      emissive: color,
      emissiveIntensity: 1.2,
      size: [0.3, 0.12, 0.3],
      pos: consolePositions(d)[joinName],
      physics: stat()
    });
  }
  out.push({ type: "box", name: NAMES.start, color: 5021290, emissive: 5021290, emissiveIntensity: 1.2, size: [0.3, 0.12, 0.3], pos: consolePositions(d)[NAMES.start], physics: stat() });
  out.push({ type: "box", name: NAMES.newMatch, color: 15262416, emissive: 14209728, emissiveIntensity: 0.9, size: [0.3, 0.12, 0.3], pos: consolePositions(d)[NAMES.newMatch], physics: stat() });
  out.push({
    type: "sphere",
    name: NAMES.ball,
    color: 16053488,
    r: d.ballRadius,
    pos: [0, d.ballY, 0],
    roughness: 0.45,
    // 30: a lacquered match ball
    clearcoat: 1,
    clearcoatRoughness: 0.08,
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
  // 30b C1: Play/Interact puts the player on the pitch's blue half facing the red gate (a core
  // before C1 ignores the field); no fly, no teleport (locomotion absent = walk)
  play: { interaction: "grab", grounded: false, simOnPlay: true, spawn: { position: [0, 0, 1.6], yaw: 0 } }
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
    // 30: in play the score is the scoreboard's own numbers; the RED x — y BLUE list
    // `fb-score` lives on the over screen
    scoreElement: "fb-score",
    logElement: opts.hudButtons ? "fb-log" : "",
    // 30: the scoreboard's clock (the def's HUD only — a recipe pitch has no such list)
    ...opts.hudButtons ? { clockElement: "fb-clock", tickerElement: "fb-ticker" } : {}
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
    for (const [id, element, action] of [["bnewover", "fb-new-match", "new-match"], ["bnewpause", "fb-new-match-pause", "new-match"], ["brematch", "fb-rematch", "rematch"]]) {
      N(id, "fbbutton", "Button: " + action + " (" + element + ")", 280, y, { action, physical: false });
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
          { key: "tie", kind: "select", options: TIE },
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
        defaults: { action: "start", press: 0, physical: true },
        params: [
          { key: "action", kind: "select", options: ACTIONS },
          // 30b: off = only the wired `press` acts; a click on the target object is left to
          // the object's own Match Button (several HUD buttons may share one target)
          { key: "physical", kind: "toggle" }
        ]
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
        defaults: { show: "all", element: "fb-sheet", scoreElement: "fb-score", logElement: "", clockElement: "", tickerElement: "" },
        params: [
          { key: "show", kind: "select", options: ["goals", "touches", "owngoals", "all"] },
          { key: "element", kind: "text", placeholder: "HUD list id (sheet)", maxLength: 40 },
          { key: "scoreElement", kind: "text", placeholder: "HUD list id (score)", maxLength: 40 },
          { key: "logElement", kind: "text", placeholder: "HUD list id (match log)", maxLength: 40 },
          { key: "clockElement", kind: "text", placeholder: "HUD list id (clock m:ss)", maxLength: 40 },
          { key: "tickerElement", kind: "text", placeholder: "HUD list id (last touch)", maxLength: 40 }
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
        ownGoals: data.ownGoals,
        tie: data.tie
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
      if (data.physical !== false) buttons.set(object.uuid, { action, frame, id: ctx?.id ?? object.uuid });
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
    const clock = data.clockElement ? [matchClock(game.rules(), game.elapsed())] : [];
    const phase = game.phase();
    const line = game.golden() ? "GOLDEN GOAL \u2014 next goal wins" : phase === "countdown" ? (game.state.kickTeam === "blue" ? "Blue" : "Red") + " kicks off" : phase === "celebrate" ? "GOAL!" : touch;
    const ticker = data.tickerElement ? [line] : [];
    const key = JSON.stringify([rows, score, log, clock, ticker]);
    if (key === lastRows) return;
    lastRows = key;
    const each = (field, list) => {
      for (const id of String(field ?? "").split(",")) if (id.trim()) api.hud.rows(id.trim(), list);
    };
    each(data.element, rows);
    each(data.scoreElement, score);
    each(data.logElement, log);
    if (data.clockElement) each(data.clockElement, clock);
    if (data.tickerElement) each(data.tickerElement, ticker);
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

// modules/football/src/arena.js
var ARENA = "Arena";
var FLAT = [-Math.PI / 2, 0, 0];

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
    const arena = group.getObjectByName(ARENA);
    if (arena && arena.parent === group) {
      const d = normalizeDims(dims);
      const span = (x) => x.length / 2 - 0.3 + x.sensorDepth + 0.05;
      api.moveObject(arena.uuid, { pos: [...centre], scale: [d.width / DEFAULT_DIMS.width, 1, span(d) / span(DEFAULT_DIMS)] });
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
var PANEL = { bg: "rgba(12, 18, 28, 0.9)", radius: 18, border: "1px solid rgba(255, 212, 94, 0.28)" };
var BUTTON = (bg) => ({ size: 16, weight: "700", bg, color: "#ffffff", radius: 12 });
var RED_BG = "#c94a4a";
var BLUE_BG = "#3b7dd8";
var GREEN_BG = "#3f9a61";
var HOW_TO_PLAY = [
  "Hit the ball: swing a controller through it (desktop: walk into it or click it).",
  "Score in the OTHER team's gate: red attacks the blue gate, blue attacks the red.",
  "First to 5 goals, or the higher score after 3:00. Level at the whistle: golden goal.",
  "After a goal the ball goes back to the centre; the team that conceded kicks off.",
  "No need to pick a side: hit the ball or press Start and you join the smaller team."
];
function scoreboard(y) {
  const block = (team, x, bg) => [
    { id: "sb-" + team + "-block", kind: "panel", anchor: "top-center", x, y: y + 6, w: 118, h: 60, z: 1, label: "", style: { bg, radius: 12 } },
    { id: "sb-" + team + "-name", kind: "text", anchor: "top-center", x, y: y + 8, w: 100, h: 16, z: 2, label: team.toUpperCase(), style: { size: 11, weight: "800", color: "rgba(255,255,255,0.85)", align: "left" } },
    { id: "fb-" + team + "-score", kind: "text", anchor: "top-center", x, y: y + 22, w: 100, h: 42, z: 2, label: "0", style: { size: 34, weight: "800", color: "#ffffff", align: "left" } }
  ];
  return [
    { id: "sb-panel", kind: "panel", anchor: "top-center", x: 0, y, w: 400, h: 72, z: 0, label: "", style: { bg: "rgba(10, 14, 22, 0.92)", radius: 16, border: "1px solid rgba(255, 255, 255, 0.12)" } },
    ...block("red", -134, RED_BG),
    ...block("blue", 134, BLUE_BG),
    { id: "fb-clock", kind: "list", anchor: "top-center", x: 0, y: y + 12, w: 74, h: 34, z: 2, label: "", rows: [], rowHeight: 30, style: { size: 26, weight: "800", color: "#ffd45e", align: "center", bg: "transparent", pad: 0 } },
    { id: "sb-label", kind: "text", anchor: "top-center", x: 0, y: y + 46, w: 62, h: 18, z: 2, label: "FOOTBALL", style: { size: 10, weight: "700", color: "#8b97a8", align: "center" } },
    { id: "fb-ticker", kind: "list", anchor: "top-center", x: 0, y: y + 76, w: 400, h: 22, z: 1, label: "", rows: [], rowHeight: 18, style: { size: 12, color: "#c8d0dc", align: "center", bg: "transparent", pad: 0 } }
  ];
}
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
            { id: "menu-panel", kind: "panel", anchor: "center", x: 0, y: 0, w: 600, h: 620, z: 0, label: "", style: PANEL },
            { id: "menu-stripe-red", kind: "panel", anchor: "center", x: -150, y: -306, w: 300, h: 8, z: 1, label: "", style: { bg: RED_BG, radius: 4 } },
            { id: "menu-stripe-blue", kind: "panel", anchor: "center", x: 150, y: -306, w: 300, h: 8, z: 1, label: "", style: { bg: BLUE_BG, radius: 4 } },
            { id: "title", kind: "text", anchor: "center", x: 0, y: -262, w: 540, h: 54, z: 1, label: "FOOTBALL", style: { size: 44, weight: "800", color: "#ffd45e", align: "left" } },
            { id: "subtitle", kind: "text", anchor: "center", x: 0, y: -222, w: 540, h: 24, z: 1, label: "Red vs Blue. Knock the floating ball through the other team's gate.", style: { size: 14, color: "#d8dee9", align: "left" }, wrap: true },
            // 30b: the rules, on the menu (the user: "it's not clear how to play it")
            { id: "howto-title", kind: "text", anchor: "center", x: 0, y: -190, w: 540, h: 20, z: 1, label: "HOW TO PLAY", style: { size: 12, weight: "800", color: "#ffd45e", align: "left" } },
            ...HOW_TO_PLAY.map((line, i) => ({ id: "howto-" + (i + 1), kind: "text", anchor: "center", x: 0, y: -156 + i * 34, w: 540, h: 34, z: 1, label: line, style: { size: 13, color: "#e5e9f0", align: "left" }, wrap: true })),
            { id: "fb-join-red", kind: "button", anchor: "center", x: -136, y: 40, w: 256, h: 48, z: 1, label: "Join RED", enabled: true, style: BUTTON(RED_BG) },
            { id: "fb-join-blue", kind: "button", anchor: "center", x: 136, y: 40, w: 256, h: 48, z: 1, label: "Join BLUE", enabled: true, style: BUTTON(BLUE_BG) },
            { id: "fb-start", kind: "button", anchor: "center", x: 0, y: 100, w: 528, h: 52, z: 1, label: "Start match", enabled: true, style: { ...BUTTON(GREEN_BG), size: 18 } },
            { id: "fb-sheet", kind: "list", anchor: "center", x: 0, y: 164, w: 528, h: 58, z: 1, label: "", rows: [], style: { size: 12, color: "#c8d0dc", align: "center", bg: "rgba(255, 255, 255, 0.05)", radius: 10 } },
            { id: "menu-hint", kind: "text", anchor: "center", x: 0, y: 226, w: 540, h: 40, z: 1, label: "Pause: P  \xB7  Esc leaves play  \xB7  In VR the Y button switches Edit / Interact", style: { size: 12, color: "#8b97a8", align: "left" }, wrap: true }
          ]
        },
        {
          id: "hud",
          name: "HUD",
          showWhile: "playing",
          input: "game",
          elements: [
            ...scoreboard(12),
            { id: "fb-sheet-play", kind: "list", anchor: "top-right", x: 16, y: 14, w: 380, h: 96, z: 1, label: "", rows: [], style: { size: 12, weight: "600", color: "#e5e9f0", align: "right", bg: "transparent" } },
            { id: "play-hint", kind: "text", anchor: "bottom-center", x: 0, y: 12, w: 520, h: 20, z: 1, label: "Knock the ball into the other gate  \xB7  first to 5 or 3:00  \xB7  P pauses", style: { size: 11, color: "#c8d0dc", align: "center" } }
          ]
        },
        {
          id: "pause",
          name: "Pause",
          input: "menu",
          elements: [
            { id: "pause-panel", kind: "panel", anchor: "center", x: 0, y: 0, w: 380, h: 300, z: 0, label: "", style: PANEL },
            { id: "pause-title", kind: "text", anchor: "center", x: 0, y: -95, w: 260, h: 36, z: 1, label: "PAUSED", style: { size: 28, weight: "800", color: "#e5e9f0", align: "left" } },
            { id: "resume-btn", kind: "button", anchor: "center", x: 0, y: -30, w: 260, h: 44, z: 1, label: "Resume", enabled: true, style: BUTTON(BLUE_BG) },
            { id: "fb-new-match-pause", kind: "button", anchor: "center", x: 0, y: 24, w: 260, h: 44, z: 1, label: "New match", enabled: true, style: BUTTON(GREEN_BG) },
            { id: "quit-btn", kind: "button", anchor: "center", x: 0, y: 78, w: 260, h: 44, z: 1, label: "Quit to menu", enabled: true, style: { size: 15, weight: "600", bg: "#3a4150", color: "#e5e9f0", radius: 12 } }
          ]
        },
        {
          id: "over",
          name: "Match over",
          showWhile: "over",
          input: "menu",
          elements: [
            { id: "over-panel", kind: "panel", anchor: "center", x: 0, y: 0, w: 480, h: 380, z: 0, label: "", style: PANEL },
            { id: "over-title", kind: "text", anchor: "center", x: 0, y: -140, w: 440, h: 44, z: 1, label: "MATCH OVER", style: { size: 34, weight: "800", color: "#ffd45e", align: "left" } },
            { id: "fb-score", kind: "list", anchor: "center", x: 0, y: -74, w: 440, h: 64, z: 1, label: "", rows: [], style: { size: 18, weight: "700", color: "#e5e9f0", align: "center", bg: "rgba(255, 255, 255, 0.05)", radius: 10 } },
            { id: "fb-log", kind: "list", anchor: "center", x: 0, y: 20, w: 440, h: 100, z: 1, label: "", rows: [], style: { size: 12, color: "#c8d0dc", align: "center", bg: "transparent" } },
            // 30b: Rematch (same sides, straight to the kick-off) beside back-to-menu
            { id: "fb-rematch", kind: "button", anchor: "center", x: -112, y: 128, w: 200, h: 48, z: 1, label: "Rematch", enabled: true, style: BUTTON(GREEN_BG) },
            { id: "fb-new-match", kind: "button", anchor: "center", x: 112, y: 128, w: 200, h: 48, z: 1, label: "Menu", enabled: true, style: { size: 16, weight: "700", bg: "#3a4150", color: "#e5e9f0", radius: 12 } }
          ]
        }
      ]
    }
  };
}

// modules/football/src/kicker.js
var FEED_HOLD_MS = 600;
var BOUNCE_GAP_MS = 160;
function createKicker(api, game) {
  const THREE = api.THREE;
  const rings = { left: [], right: [] };
  const arms = { left: { spent: false }, right: { spent: false } };
  const fedUntil = { left: 0, right: 0 };
  const ballRing = [];
  const velHistory = [];
  let lastBounce = 0;
  let kicks = 0;
  const _v = new THREE.Vector3();
  let radiusCache = { key: "", r: 0.22 };
  function ballRadius(o) {
    const key = (o.geometry?.uuid ?? "") + "|" + o.scale.x + "|" + o.scale.y + "|" + o.scale.z;
    if (radiusCache.key !== key) {
      if (o.geometry && !o.geometry.boundingSphere) o.geometry.computeBoundingSphere?.();
      const r = o.geometry?.boundingSphere?.radius ?? 0.22;
      radiusCache = { key, r: r * Math.max(Math.abs(o.scale.x), Math.abs(o.scale.y), Math.abs(o.scale.z)) };
    }
    return radiusCache.r;
  }
  const mass = (o) => Number(o?.userData?.physics?.mass) || 0.45;
  function toGroup(p) {
    const group = api.objectsGroup();
    _v.fromArray(p);
    if (group) {
      group.updateWorldMatrix(true, false);
      group.worldToLocal(_v);
    }
    return _v.toArray();
  }
  let lastCoreHit = -Infinity;
  function noteCoreHit() {
    lastCoreHit = performance.now();
  }
  function fire(o, n, approach, probe, hand) {
    const ballVel = ringVelocity(ballRing);
    const impulse = kickImpulse(n, approach, mass(o), ballVel);
    const speed = Math.hypot(impulse[0], impulse[1], impulse[2]) / mass(o);
    if (!(speed > 0)) return false;
    const data = { op: "kick", uuid: o.uuid, impulse, speed, by: game.me(), at: api.now(), probe };
    game.applyKick(data, true);
    api.send(data);
    game.fx.pulse(kickHaptic(speed), 40, hand);
    kicks++;
    return true;
  }
  function evaluate(hand, o) {
    const ring = rings[hand];
    if (ring.length < 2) return 0;
    const tip = ring[ring.length - 1].p;
    const ballR = ballRadius(o);
    const reach = TIP_RADIUS + ballR;
    const c = kickContact(tip, ringVelocity(ring), TIP_RADIUS, o.position.toArray(), ringVelocity(ballRing), ballR);
    if (!armStep(arms[hand], c.distance, reach)) return 0;
    if (c.approach <= MIN_KICK_SPEED) return 0;
    arms[hand].spent = true;
    if (performance.now() - lastCoreHit < DEDUPE_MS) return 0;
    return fire(o, c.n, c.approach, "tip-" + hand, hand) ? 1 : 0;
  }
  const tipsLive = () => !!api.isVR?.() && game.localActive();
  function tick() {
    const o = game.ball();
    if (!o) {
      ballRing.length = 0;
      return;
    }
    const now = performance.now();
    pushSample(ballRing, o.position.toArray(), now);
    watchBounce(o, now);
    if (!tipsLive()) {
      rings.left.length = 0;
      rings.right.length = 0;
      return;
    }
    for (
      const hand of
      /** @type {const} */
      ["left", "right"]
    ) {
      if (now < fedUntil[hand]) continue;
      const snap = api.vrHand?.(hand);
      if (!snap?.position) {
        rings[hand].length = 0;
        continue;
      }
      pushSample(rings[hand], toGroup(tipPoint(snap.position, snap.quaternion ?? null)), now);
      evaluate(hand, o);
    }
  }
  function watchBounce(o, now) {
    const v = ringVelocity(ballRing);
    velHistory.push({ t: now, v });
    while (velHistory.length > 2 && now - velHistory[0].t > 220) velHistory.shift();
    if (game.phase() !== "live" && game.phase() !== "menu") return;
    if (now - lastBounce < BOUNCE_GAP_MS || now - game.lastTouchMs() < BOUNCE_GAP_MS) return;
    const old = velHistory.find((e) => now - e.t >= 100);
    if (!old || !bounced(old.v, v)) return;
    lastBounce = now;
    velHistory.length = 0;
    game.fx.sound("hit", o.getWorldPosition(new THREE.Vector3()).toArray());
  }
  function feed(hand, worldPos, worldQuat, tMs) {
    const o = game.ball();
    const live = tipsLive();
    if (!o || !live) return { kicks: 0, live };
    fedUntil[hand] = performance.now() + FEED_HOLD_MS;
    pushSample(rings[hand], toGroup(tipPoint(worldPos, worldQuat)), tMs);
    return { kicks: evaluate(hand, o), live };
  }
  function clickKick(mesh) {
    const o = game.ball();
    if (!o || !game.localActive()) return false;
    let cursor = mesh;
    while (cursor && cursor !== o) cursor = cursor.parent;
    if (!cursor) return false;
    const player = typeof api.playerPosition === "function" ? api.playerPosition() : null;
    const ballWorld = o.getWorldPosition(new THREE.Vector3());
    if (!player) return false;
    const d = [ballWorld.x - player[0], (ballWorld.y - player[1]) * 0.4, ballWorld.z - player[2]];
    const dist = Math.hypot(ballWorld.x - player[0], ballWorld.y - player[1], ballWorld.z - player[2]);
    if (dist > CLICK_REACH) return false;
    const l = Math.hypot(d[0], d[1], d[2]) || 1;
    const group = api.objectsGroup();
    const dir = new THREE.Vector3(d[0] / l, d[1] / l, d[2] / l);
    if (group) dir.applyQuaternion(group.getWorldQuaternion(new THREE.Quaternion()).invert());
    const ballVel = ringVelocity(ballRing);
    const n = dir.toArray();
    const along = ballVel[0] * n[0] + ballVel[1] * n[1] + ballVel[2] * n[2];
    fire(o, n, Math.max(0, CLICK_KICK_SPEED - along), "click");
    return true;
  }
  return { tick, feed, clickKick, noteCoreHit, kicks: () => kicks, tipsLive };
}

// modules/football/src/index.js
var index_default = {
  id: "football",
  name: "Football",
  version: "1.2.0",
  description: "VR football on the knock: floating ball, two team gates, last-touch attribution, modes, per-player records and a saved match log \u2014 every rule a flow node.",
  /** @param {any} api the module SDK surface */
  register(api) {
    const game = createGame(api);
    const nodes = registerNodes(api, game);
    const hitSource = game.wireHits();
    const toolbox = registerToolbox(api, game, { hitSource: () => hitSource });
    const kicker = createKicker(api, game);
    game.onCoreHitByMe(() => kicker.noteCoreHit());
    api.registerClickHandler((mesh) => nodes.clickButton(mesh) || kicker.clickKick(mesh), { modes: ["interact", "play"] });
    api.onMessage((data) => game.handleMessage(data));
    api.registerStateSync({
      getState: () => game.getState(),
      applyState: (remote) => game.applyState(remote)
    });
    api.onSceneClear(() => game.clear());
    api.registerFrameTask((time) => {
      nodes.tick();
      game.tick(time);
      kicker.tick();
    });
    if (api.hud?.registerDebugLine)
      api.hud.registerDebugLine(() => "football " + game.scoreLine() + (game.state.started ? " playing" : "") + " \xB7 hits via " + hitSource);
    if (api.hud?.registerAction)
      for (const action of ["join-red", "join-blue", "start", "new-match", "spectate", "swap-sides", "rematch"])
        api.hud.registerAction({ key: action, label: "Football: " + action, group: "Football", role: "press", node: "fbbutton", data: { action }, handle: "press" });
    if (typeof window !== "undefined") {
      window.__football = {
        game,
        nodes,
        toolbox,
        kicker,
        hud: pitchHud,
        hitSource: () => hitSource,
        /** 30b: where this viewer stands (the click kick's reach) */
        player: () => typeof api.playerPosition === "function" ? api.playerPosition() : null,
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
