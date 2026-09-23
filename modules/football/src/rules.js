// football — THE RULES, pure. No api, no THREE, no clock: every function here is a
// plain function of its arguments so `test/rules.test.mjs` proves each one in node with
// no app running. game.js feeds these with replicated state and applies what they
// return; nothing in this file knows which peer it runs on.
//
// Teams: 'red' defends the red gate (the gate a `fbgate team:red` node names), 'blue'
// the blue one. A ball entering the RED gate scores for BLUE, whoever touched it last;
// who touched it last decides whose SHEET the goal lands on (goals or owngoals).

export const TEAMS = ['red', 'blue'];
export const MODES = ['duel', 'teams', 'freeforall', 'practice'];
export const WIN_BY = ['goals', 'time', 'either'];
export const SERVE = ['auto', 'button'];
export const OWN_GOALS = ['count', 'ignore'];
export const ACTIONS = ['none', 'join-red', 'join-blue', 'spectate', 'start', 'new-match', 'swap-sides', 'serve', 'rematch'];
/** 30b: what a level score at the whistle means — a GOLDEN GOAL (the next goal wins) or a draw */
export const TIE = ['golden', 'draw'];

/** 30b: the casual-VR-football defaults — first to 5 OR the higher score after 3:00, a level
 * score at the whistle goes to a golden goal; `serveDelay` is the kick-off COUNTDOWN (3-2-1)
 * and `serveSpeed` the kick-off NUDGE (a slow roll into the kicking team's half, never a
 * shot — see kickoffImpulse) */
export const DEFAULT_RULES = {
	mode: 'teams',
	winBy: 'either',
	goalsToWin: 5,
	matchSeconds: 180,
	serve: 'auto',
	serveDelay: 3,
	ownGoals: 'count',
	serveSpeed: 0.5,
	tie: 'golden'
};

/** 30b: the celebration after a goal — the ball rests in the net this long before it goes
 * back to the centre spot for the kick-off countdown */
export const CELEBRATE_SECONDS = 2.5;

/** how many matches the saved sheet keeps (B5, fork 3) */
export const MATCH_LOG_CAP = 50;
/** a ball that moved less than this in REST_SECONDS is re-served */
export const REST_DISTANCE = 0.03;
export const REST_SECONDS = 3;

/** @param {any} v @param {number} lo @param {number} hi @param {number} d */
function num(v, lo, hi, d) {
	const n = Number(v);
	if (!Number.isFinite(n)) return d;
	return Math.min(hi, Math.max(lo, n));
}
/** @param {any} v @param {string[]} options @param {string} d */
function pick(v, options, d) {
	return options.includes(v) ? v : d;
}

/** Clamp a rules object to what the game accepts. Unknown fields are dropped. @param {any} raw */
export function normalizeRules(raw) {
	const r = raw && typeof raw === 'object' ? raw : {};
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

/** @param {string} team */
export function otherTeam(team) {
	return team === 'red' ? 'blue' : team === 'blue' ? 'red' : null;
}

/** FNV-1a over a seed and parts — the dungeon-realms derivation, so a serve direction is
 * the same on every peer that agrees on the stamp. @param {number} seed @param {...any} parts */
export function hash32(seed, ...parts) {
	let h = 0x811c9dc5 ^ (seed >>> 0);
	for (const part of parts) {
		const s = String(part);
		for (let i = 0; i < s.length; i++) {
			h ^= s.charCodeAt(i);
			h = Math.imul(h, 0x01000193);
		}
		h ^= 0x9e3779b9;
		h = Math.imul(h, 0x01000193);
	}
	return h >>> 0;
}

// ---- slots ------------------------------------------------------------------------

/** @typedef {{red: string[], blue: string[]}} Slots */

/** @returns {Slots} */
export function emptySlots() {
	return { red: [], blue: [] };
}

/** @param {Slots} slots @param {string} peerId @returns {'red'|'blue'|null} */
export function teamOf(slots, peerId) {
	if (!peerId) return null;
	if (slots.red.includes(peerId)) return 'red';
	if (slots.blue.includes(peerId)) return 'blue';
	return null;
}

/**
 * May `peerId` take a place on `team` under `mode`? 'none' (spectate) is always allowed.
 * @param {Slots} slots @param {'red'|'blue'|'none'} team @param {string} peerId @param {string} mode
 * @returns {{ok: boolean, reason: string}}
 */
export function canJoin(slots, team, peerId, mode) {
	if (team === 'none') return { ok: true, reason: '' };
	if (!TEAMS.includes(team)) return { ok: false, reason: 'no such team' };
	if (teamOf(slots, peerId) === team) return { ok: true, reason: 'already there' };
	if (mode === 'duel' && slots[team].length >= 1) return { ok: false, reason: team + ' is taken (duel: one per side)' };
	return { ok: true, reason: '' };
}

/**
 * The slots after `peerId` joins `team` (or leaves both with 'none'). Pure: returns a new
 * object; the caller decides whether canJoin allowed it.
 * @param {Slots} slots @param {'red'|'blue'|'none'} team @param {string} peerId @returns {Slots}
 */
export function applySlot(slots, team, peerId) {
	const next = { red: slots.red.filter((id) => id !== peerId), blue: slots.blue.filter((id) => id !== peerId) };
	if (team === 'red' || team === 'blue') next[team] = [...next[team], peerId];
	return next;
}

/** Drop every slotted peer not in `liveIds` (a disconnect frees its slot, DEVX #15).
 * @param {Slots} slots @param {string[]} liveIds @returns {{slots: Slots, freed: string[]}} */
export function freeVanished(slots, liveIds) {
	const live = new Set(liveIds);
	const freed = [];
	const keep = (/** @type {string} */ id) => {
		if (live.has(id)) return true;
		freed.push(id);
		return false;
	};
	return { slots: { red: slots.red.filter(keep), blue: slots.blue.filter(keep) }, freed };
}

/** Red and blue trade ends: every red player is now blue and vice versa. @param {Slots} slots */
export function swapSlots(slots) {
	return { red: [...slots.blue], blue: [...slots.red] };
}

/** 30b: the team a player who never picked one is put on — the SMALLER team, and on a tie
 * `prefer` (the half they stand in). Casual games auto-balance: nobody has to understand
 * "Join" to play. @param {Slots} slots @param {'red'|'blue'} [prefer] @returns {'red'|'blue'} */
export function balancedTeam(slots, prefer = 'red') {
	const r = slots.red.length;
	const b = slots.blue.length;
	if (r < b) return 'red';
	if (b < r) return 'blue';
	return prefer === 'blue' ? 'blue' : 'red';
}

// ---- goals --------------------------------------------------------------------------

/**
 * @typedef {{by: string, team: 'red'|'blue'|null, at: number} | null} LastTouch
 * @typedef {{team: 'red'|'blue'|null, by: string|null, own: boolean, counts: boolean,
 *   credit: 'goals'|'owngoals'|null, reason: string}} Attribution
 */

/**
 * Who scores when the ball enters the gate `gateTeam` defends.
 *
 *   teams / duel: the OTHER team scores. The last toucher's team decides the sheet — an
 *   attacker's touch is a goal on their row, a defender's touch is an own goal on theirs
 *   (and with `ownGoals: 'ignore'` the goal does not count at all: the ball is re-served).
 *   A spectator's or nobody's touch still counts for the attackers, credited to nobody.
 *   freeforall: teams do not exist; the toucher scores one, whoever's gate it was. No
 *   touch = nobody scores.
 *   practice: nothing scores, ever.
 * @param {{gateTeam: 'red'|'blue', lastTouch: LastTouch, slots: Slots, mode: string, ownGoals: string}} input
 * @returns {Attribution}
 */
export function attributeGoal({ gateTeam, lastTouch, slots, mode, ownGoals }) {
	if (mode === 'practice') return { team: null, by: null, own: false, counts: false, credit: null, reason: 'practice' };
	const by = lastTouch?.by ?? null;
	// the toucher's team is read from the SLOTS at goal time, not from the touch: a
	// player who swapped sides between touch and goal scores where they stand now
	const toucherTeam = by ? teamOf(slots, by) : null;
	if (mode === 'freeforall') {
		if (!by) return { team: null, by: null, own: false, counts: false, credit: null, reason: 'nobody touched it' };
		return { team: null, by, own: false, counts: true, credit: 'goals', reason: 'free for all' };
	}
	const scoring = otherTeam(gateTeam);
	if (!by || !toucherTeam) return { team: scoring, by: null, own: false, counts: true, credit: null, reason: by ? 'spectator touch' : 'no touch' };
	if (toucherTeam === scoring) return { team: scoring, by, own: false, counts: true, credit: 'goals', reason: 'goal' };
	// a defender put it in their own gate
	if (ownGoals === 'ignore') return { team: scoring, by, own: true, counts: false, credit: null, reason: 'own goal ignored' };
	return { team: scoring, by, own: true, counts: true, credit: 'owngoals', reason: 'own goal' };
}

/** @param {{red: number, blue: number}} score @param {Attribution} a */
export function applyGoal(score, a) {
	if (!a.counts || !a.team) return { ...score };
	return { ...score, [a.team]: (score[a.team] ?? 0) + 1 };
}

// ---- modes end the match ------------------------------------------------------------

/**
 * @param {{score: {red: number, blue: number}, rules: any, elapsed: number,
 *   playerGoals?: Record<string, number>}} input
 * @returns {{winner: string, reason: 'goals'|'time'} | null} winner is a team, a peer id
 *   (free for all) or 'draw'
 */
export function matchOutcome({ score, rules, elapsed, playerGoals }) {
	const r = normalizeRules(rules);
	if (r.mode === 'practice') return null;
	const byGoals = r.winBy === 'goals' || r.winBy === 'either';
	const byTime = r.winBy === 'time' || r.winBy === 'either';
	if (byGoals) {
		if (r.mode === 'freeforall') {
			for (const [id, n] of Object.entries(playerGoals ?? {})) if (n >= r.goalsToWin) return { winner: id, reason: 'goals' };
		} else {
			if (score.red >= r.goalsToWin && score.red > score.blue) return { winner: 'red', reason: 'goals' };
			if (score.blue >= r.goalsToWin && score.blue > score.red) return { winner: 'blue', reason: 'goals' };
		}
	}
	if (byTime && elapsed >= r.matchSeconds) {
		if (r.mode === 'freeforall') {
			let best = null;
			let tie = false;
			for (const [id, n] of Object.entries(playerGoals ?? {})) {
				if (!best || n > best.n) {
					best = { id, n };
					tie = false;
				} else if (n === best.n) tie = true;
			}
			if (tie && r.tie === 'golden') return null; // 30b: level at the whistle plays on
			return { winner: best && !tie ? best.id : 'draw', reason: 'time' };
		}
		// 30b: level at the whistle is a GOLDEN GOAL — play on, the next goal decides it
		if (score.red === score.blue) return r.tie === 'golden' ? null : { winner: 'draw', reason: 'time' };
		return { winner: score.red > score.blue ? 'red' : 'blue', reason: 'time' };
	}
	return null;
}

/** seconds left in a timed match, or null when the mode has no clock @param {any} rules @param {number} elapsed */
export function secondsLeft(rules, elapsed) {
	const r = normalizeRules(rules);
	if (r.winBy === 'goals' || r.mode === 'practice') return null;
	return Math.max(0, r.matchSeconds - elapsed);
}

// ---- the serve -------------------------------------------------------------------------

/**
 * A unit direction for the kick-off, seeded by the stamp so every peer that logs the serve
 * agrees on where it went: along the pitch axis (z, toward one gate — the bit decides
 * which) with a little sideways lean. Pure and transcendental-free.
 * @param {number} at @returns {number[]} [x, y, z]
 */
export function serveDirection(at) {
	const h = hash32(Math.floor(at), 'serve');
	const sign = h & 1 ? 1 : -1;
	const lean = (((h >>> 8) & 0xff) / 255 - 0.5) * 0.6; // -0.3 .. 0.3
	const len = Math.hypot(lean, 1);
	return [lean / len, 0, sign / len];
}

/**
 * The kick-off IMPULSE for a ball at `pos` when the centre is `centre`: a ball that sits
 * away from the centre (inside a gate after a goal) is kicked back toward it; a ball at
 * the centre is kicked along the seeded serve direction. Impulse = mass x speed.
 * @param {number[]} pos @param {number[]} centre @param {number} mass @param {number} speed @param {number} at
 */
export function serveImpulse(pos, centre, mass, speed, at) {
	const dx = centre[0] - pos[0];
	const dz = centre[2] - pos[2];
	const dist = Math.hypot(dx, dz);
	const dir = dist > 0.5 ? [dx / dist, 0, dz / dist] : serveDirection(at);
	const m = Math.max(0.01, mass || 1) * Math.max(0, speed);
	return [dir[0] * m, dir[1] * m, dir[2] * m];
}

// ---- 30b: the match flow — kick-off, celebration, the clock that stops ----------------------
//
// A goal is a moment, not a number: the ball rests in the net for CELEBRATE_SECONDS, goes
// back to the centre spot, a 3-2-1 countdown runs and the team that CONCEDED kicks off with
// a slow nudge into its own half. All of it is a pure function of stamps every peer already
// holds (the goal op's `at`, the start op's `at`), so every peer shows the same countdown
// with no message of its own; only the authority moves the ball.

/**
 * Is a level score past the whistle being played on (golden goal)?
 * @param {{score: {red: number, blue: number}, rules: any, elapsed: number, playerGoals?: Record<string, number>}} input
 */
export function goldenGoal({ score, rules, elapsed, playerGoals }) {
	const r = normalizeRules(rules);
	if (r.mode === 'practice' || r.tie !== 'golden') return false;
	if (r.winBy !== 'time' && r.winBy !== 'either') return false;
	if (!(elapsed >= r.matchSeconds)) return false;
	if (r.mode === 'freeforall') {
		const counts = Object.values(playerGoals ?? {});
		const best = counts.length ? Math.max(...counts) : 0;
		return counts.filter((n) => n === best).length !== 1;
	}
	return score.red === score.blue;
}

/**
 * Where a match stands at `now` (synced seconds): 'menu' (no match), 'over' (results),
 * 'celebrate' (a goal just went in), 'countdown' (3-2-1 before a kick-off) or 'live'.
 * @param {{started: boolean, outcome: any, celebrateUntil?: number, serveAt?: number}} s @param {number} now
 */
export function matchPhase(s, now) {
	if (!s.started) return s.outcome ? 'over' : 'menu';
	if (s.celebrateUntil && now < s.celebrateUntil) return 'celebrate';
	if (s.serveAt) return 'countdown';
	return 'live';
}

/** The number a countdown shows at `now` — 3, 2, 1 — or 0 once the kick-off is due.
 * @param {number} serveAt @param {number} now */
export function countdownNumber(serveAt, now) {
	if (!serveAt || now >= serveAt) return 0;
	return Math.max(1, Math.ceil(serveAt - now - 1e-9));
}

/** Who kicks off the FIRST time, seeded by the start stamp so every peer agrees.
 * @param {number} at @returns {'red'|'blue'} */
export function startKickTeam(at) {
	return (hash32(Math.floor(at * 1000), 'kickoff') >>> 16) & 1 ? 'blue' : 'red';
}

/**
 * The kick-off NUDGE: a slow roll from the centre spot into `team`'s own half — toward the
 * gate that team defends, leaning 35 degrees to one side (seeded) so a nudge nobody touches
 * can never roll straight into that team's own net. `redGate` / `blueGate` are the two gate
 * positions (x, z used), so the pitch may face any way. Impulse = mass x speed.
 * @param {'red'|'blue'} team @param {number[]} redGate @param {number[]} blueGate
 * @param {number} mass @param {number} speed @param {number} at
 */
export function kickoffImpulse(team, redGate, blueGate, mass, speed, at) {
	const toward = team === 'blue' ? blueGate : redGate;
	const away = team === 'blue' ? redGate : blueGate;
	let ax = toward[0] - away[0];
	let az = toward[2] - away[2];
	const len = Math.hypot(ax, az);
	if (len < 1e-6) {
		ax = 0;
		az = team === 'blue' ? 1 : -1;
	} else {
		ax /= len;
		az /= len;
	}
	const side = (hash32(Math.floor(at * 1000), 'lean') >>> 16) & 1 ? 1 : -1;
	const c = Math.cos(0.61); // ~35 degrees
	const s = Math.sin(0.61) * side;
	const dx = ax * c - az * s;
	const dz = ax * s + az * c;
	const m = Math.max(0.01, mass || 1) * Math.max(0, speed);
	return [dx * m, 0, dz * m];
}

/** Seconds PLAYED: the clock runs only while the ball is live (it stops for a celebration
 * and a countdown, the casual-game convention). @param {{clockBase?: number, liveSince?: number}} s @param {number} now */
export function playedSeconds(s, now) {
	const base = Number(s.clockBase) || 0;
	const since = Number(s.liveSince) || 0;
	return base + (since ? Math.max(0, now - since) : 0);
}

/**
 * 30b C1: where a player of `team` starts when they enter Interact/Play — `depth` metres from
 * the centre spot into their OWN half (the side of the gate they defend), feet on the pitch
 * (y 0), facing the gate they attack. `yaw` in three's convention: 0 faces -z.
 * @param {'red'|'blue'} team @param {number[]} redGate @param {number[]} blueGate
 * @returns {{position: number[], yaw: number}}
 */
export function teamSpawn(team, redGate, blueGate, depth = 1.6) {
	const own = team === 'red' ? redGate : blueGate;
	const cx = (redGate[0] + blueGate[0]) / 2;
	const cz = (redGate[2] + blueGate[2]) / 2;
	let dx = own[0] - cx;
	let dz = own[2] - cz;
	const d = Math.hypot(dx, dz);
	if (d < 1e-6) {
		dx = 0;
		dz = team === 'red' ? -1 : 1;
	} else {
		dx /= d;
		dz /= d;
	}
	// facing = -(dx, dz); a three.js yaw y faces (-sin y, -cos y), so y = atan2(dx, dz)
	return { position: [cx + dx * depth, 0, cz + dz * depth], yaw: Math.atan2(dx, dz) };
}

/** `Red 2 - 1 Blue`, the announce banner's sub line @param {{red: number, blue: number}} score */
export function bannerScore(score) {
	return 'Red ' + (score.red ?? 0) + ' - ' + (score.blue ?? 0) + ' Blue';
}

// ---- the sheet -------------------------------------------------------------------------

/**
 * One saved match. Names, not ids — ids change per session (fork 3).
 * @param {{at: number, score: {red: number, blue: number}, winner: string, rows: {name: string, goals: number}[]}} input
 */
export function matchLogEntry({ at, score, winner, rows }) {
	return {
		at: Math.floor(at),
		red: score.red,
		blue: score.blue,
		winner,
		scorers: (rows ?? []).filter((r) => r.goals > 0).map((r) => ({ name: String(r.name), goals: r.goals }))
	};
}

/** @param {any[]} log @param {any} entry @param {number} [cap] newest LAST, oldest dropped */
export function appendMatchLog(log, entry, cap = MATCH_LOG_CAP) {
	const list = Array.isArray(log) ? [...log, entry] : [entry];
	return list.slice(-Math.max(1, cap));
}

/**
 * 30: the scoreboard CLOCK, `m:ss` — the time LEFT in a timed match, the time PLAYED in a
 * goals match (counting up), `0:00` before a kick-off. `elapsed` in seconds, null = no match.
 * @param {any} rules @param {number | null} elapsed
 */
export function matchClock(rules, elapsed) {
	if (elapsed == null || !Number.isFinite(elapsed)) return '0:00';
	const left = secondsLeft(rules, Math.max(0, elapsed));
	const s = Math.max(0, Math.floor(left == null ? elapsed : Math.ceil(left)));
	return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}

/** `RED 3 — 2 BLUE`, the scoreboard line @param {{red: number, blue: number}} score */
export function scoreLine(score) {
	return 'RED ' + (score.red ?? 0) + ' — ' + (score.blue ?? 0) + ' BLUE';
}
