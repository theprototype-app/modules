// waves — THE ENGINE: one 10 Hz sweep that derives the wave from the enemies' hit
// counters, heals the survivors into the next wave with LOCAL pulses, walks the living
// enemies along a line every peer computes, and fires the events a graph reacts to.
//
// Nothing here is sent. The enemies are pre-placed objects carrying the health module's
// chains (their counters travel with their stamps in the trigger-log handshake), the
// wave is a pure function of those counters (src/curve.js), and the enemy positions are
// a pure function of (the wave's start stamp, the clock). A late joiner lands on the same
// wave because it lands on the same counters.
//
// FIRST SIGHT NEVER FIRES: a run that was already under way when this peer first saw the
// waves node fires no `wave`/`over` event and appends no log entry here — those moments
// were somebody else's to witness.

import { curveOf, sizeOf, killsOf, waveOf, aliveIn, usedIn, healsBefore, enemyPosition, spawnFor, runEntry, appendRun, clamp, DEFAULTS, KINDS, kindOf, setbackOf, pushedBy, appendFx, fxOf, levelOf, levelSpeed, opensLevel, killScore, groundDistance } from './curve.js';

const SWEEP = 0.1;
const LOG_PREFIX = 'waves:';
/** 30b: the round's ability events (Slow-mo windows, Pulse shoves) — a replicated game var */
const FX_PREFIX = 'waves:fx:';
/** the game shell stamps its round in session milliseconds; the trigger log and
 * api.now() are seconds of day — one conversion, here @param {number} ms */
const toSeconds = (ms) => (ms / 1000) % 86400;
const KILLS_ROW = 'kills';
/** 30b: the per-player score, on the scorer's own row (the kills row's rule) */
const SCORE_ROW = 'score';
/** 30b: where an enemy waits while its wave does not use it, or once it is dead — under the
 * ground, out of sight AND out of reach (a hidden body still collides) */
const STASH_DEPTH = -30;

/** @param {any} api */
export function createWavesEngine(api) {
	/** @type {Map<string, any>} waves node id -> derived state */
	const state = new Map();
	/** waves node id -> the wave we last saw (for the `wave` event edge) */
	const waveSeen = new Map();
	/** waves node id -> done we last saw */
	const doneSeen = new Map();
	/** waves node id -> was the run active last sweep */
	const runSeen = new Map();
	/** waves node id -> the last round stamp it saw running (the shell has already left the
	 * round by the time the `over` edge logs the run, so roundCutoff() alone reads null there) */
	const roundSeen = new Map();
	/** enemy uuid -> its parked pose (where it stands when no run is on) */
	const parked = new Map();
	/** health id -> the heal count we expect the counter to show once our local pulses
	 * land — flowValues republishes ~6/s, and firing again before it does would heal
	 * twice */
	const healExpected = new Map();
	/** the listeners the toolbox uses @type {Set<() => void>} */
	const listeners = new Set();
	/** 30b: health id -> the hit count THIS peer's shots should have made the counter show
	 * (the counter republishes ~6/s; a second shot must not re-kill the dead or credit twice) */
	const hitExpected = new Map();
	/** 30b: enemy uuid -> {hits, kills} as last swept, for the hurt/death EDGES the juice reads */
	const seenHits = new Map();
	/** 30b: enemy uuid -> kills this peer already announced (its own shot's kill shows at once) */
	const announcedKills = new Map();
	/** 30b: the enemies THIS module hid (unused by the wave), so it restores exactly those */
	const stashed = new Set();
	/** 30b: waves node id -> the round it last saw RUNNING (a Restart changes it mid-run) */
	const roundRun = new Map();
	/** 30b: enemy uuid -> the life (its kills count) it already breached in */
	const breached = new Map();
	/** 30b: waves node id -> when this peer first saw it (seconds, performance clock) */
	const firstSeen = new Map();
	/** 30b: run listeners (start / wave / level / over / breach), LOCAL edges
	 * @type {Set<(e: {kind: string, s: any, enemy?: any, pos?: number[]}) => void>} */
	const runListeners = new Set();
	/** 30b: a local rule a breach asks before it hurts THIS player (the Shield) */
	let guard = () => false;
	/** 30b: hurt/death listeners @type {Set<(e: {kind: 'hurt' | 'death', uuid: string, pos: number[], enemy: any, mine: boolean}) => void>} */
	const enemyListeners = new Set();

	const now = () => api.now();
	/** @param {string|null} uuid */
	function objectOf(uuid) {
		if (!uuid) return null;
		return api.objectsGroup()?.getObjectByProperty('uuid', uuid) ?? null;
	}
	/** @param {any} object @returns {number[]} */
	const worldPos = (object) => object.getWorldPosition(new api.THREE.Vector3()).toArray();

	// ---- graph reads ------------------------------------------------------------------
	function graphView() {
		const nodes = api.flow.nodes();
		const edges = api.flow.edges();
		/** @type {Map<string, any>} */
		const byId = new Map(nodes.map((n) => [n.id, n]));
		/** @type {Map<string, any[]>} */
		const byTarget = new Map();
		for (const e of edges) {
			if (!byTarget.has(e.target)) byTarget.set(e.target, []);
			byTarget.get(e.target)?.push(e);
		}
		return { nodes, edges, byId, byTarget };
	}

	/** the ids wired into `nodeId` on `handle` @param {any} g @param {string} nodeId @param {string} handle */
	const into = (g, nodeId, handle) => (g.byTarget.get(nodeId) ?? []).filter((/** @type {any} */ e) => (e.targetHandle ?? null) === handle).map((/** @type {any} */ e) => e.source);

	/** the object an Object Selector wired into `handle` names @param {any} g @param {any} node @param {string} handle */
	function selectorInto(g, node, handle) {
		for (const id of into(g, node.id, handle)) {
			const src = g.byId.get(id);
			if (src?.type !== 'objectselector') continue;
			const selected = String(src.data?.selected ?? '');
			if (selected && selected !== '-None-') return selected;
		}
		if (handle === 'target' && node.graphId && node.graphId !== 'scene') return node.graphId;
		return null;
	}

	/** @param {any} node @returns {string} */
	const nameOf = (node) => String(node?.data?.name ?? '').trim() || DEFAULTS.name;

	/**
	 * The enemies of a run: every object-scoped health node carrying the run's name, in a
	 * DETERMINISTIC order (object name, then node id) so enemy `i` is the same enemy on
	 * every peer. Each brings its hit counter (the ledger), its heal counter and its max.
	 * @param {any} g @param {string} name
	 */
	function enemiesOf(g, name) {
		/** @type {any[]} */
		const out = [];
		for (const node of g.nodes) {
			if (node.type !== 'health' || node.data?.scope === 'player') continue;
			if (nameOf(node) !== name) continue;
			const uuid = selectorInto(g, node, 'target');
			const object = objectOf(uuid);
			const damageCounters = into(g, node.id, 'damage').filter((id) => g.byId.get(id)?.type === 'counter');
			const healCounters = into(g, node.id, 'heal').filter((id) => g.byId.get(id)?.type === 'counter');
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
			// 30b: a shot lands on the damage node that feeds this enemy's hit counter
			const damageId = damageCounters.flatMap((c) => into(g, c, 'pulse').filter((id) => g.byId.get(id)?.type === 'damage'))[0] ?? null;
			const label = object?.name || (uuid ? uuid.slice(0, 8) + '…' : '(no target)');
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
				healNodes: g.nodes.filter((n) => n.type === 'heal' && healCounters.some((c) => (g.byTarget.get(c) ?? []).some((/** @type {any} */ e) => e.source === n.id))).map((n) => n.id)
			});
		}
		out.sort((a, b) => a.label.localeCompare(b.label) || a.healthId.localeCompare(b.healthId));
		return out;
	}

	/** spawn points: objects whose name starts with the prefix, sorted by name @param {string} prefix */
	function spawnPoints(prefix) {
		const p = String(prefix ?? '').trim();
		if (!p) return [];
		const root = api.objectsGroup();
		const found = (root?.children ?? []).filter((/** @type {any} */ c) => String(c.name ?? '').startsWith(p));
		found.sort((/** @type {any} */ a, /** @type {any} */ b) => String(a.name).localeCompare(String(b.name)));
		return found.map((/** @type {any} */ c) => worldPos(c));
	}

	// ---- the derivation ---------------------------------------------------------------
	/** @param {any} node @param {any} g */
	function derive(node, g) {
		const d = node.data ?? {};
		const name = nameOf(node);
		const enemies = enemiesOf(g, name);
		const curve = curveOf(d, enemies.length);
		const kills = enemies.map((e) => e.kills);
		const { completed, wave, done } = waveOf(kills, curve);
		const cutoff = api.game.roundCutoff();
		const underway = api.game.roundUnderway();
		const running = underway && typeof cutoff === 'number' && Number.isFinite(cutoff) && enemies.length > 0 && !done;
		const interval = clamp(d.interval, 0, 600, DEFAULTS.interval);
		// when the current wave started: the round for wave 1, the previous wave's last
		// kill plus the interval after that — both replicated stamps. The round's stamp is
		// session MILLISECONDS; the trigger log and api.now() are seconds of day.
		let waveStart = typeof cutoff === 'number' && Number.isFinite(cutoff) ? toSeconds(cutoff) : null;
		let clearedAt = null;
		if (completed > 0) {
			let last = null;
			for (const i of usedIn(completed, curve)) {
				const e = enemies[i];
				if (e?.lastHit !== null && e?.lastHit !== undefined && (last === null || e.lastHit > last)) last = e.lastHit;
			}
			clearedAt = last;
			if (last !== null && !done) waveStart = last + interval;
		}
		const started = running && waveStart !== null && now() >= waveStart;
		if (typeof cutoff === 'number' && Number.isFinite(cutoff)) roundSeen.set(node.id, cutoff);
		const round = roundSeen.get(node.id) ?? null;
		const goalUuid = selectorInto(g, node, 'goal');
		const goalObject = objectOf(goalUuid);
		// 30b: the abilities' events of THIS round (a joiner reads the same variable)
		const fx = running ? fxOf(api.game.getVar(FX_PREFIX + name, null), round) : [];
		// 30b: levels (0 waves per level = none, the old behaviour)
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
			slows: fx.filter((/** @type {any} */ e) => e?.k === 'slow'),
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
			spawns: spawnPoints(d.spawnPrefix ?? 'Spawn'),
			speed: clamp(d.speed, 0.01, 100, DEFAULTS.speed),
			stagger: clamp(d.stagger, 0, 60, DEFAULTS.stagger),
			reach: clamp(d.reach, 0.1, 100, DEFAULTS.reach)
		};
	}

	// ---- heals into the next wave ----------------------------------------------------------
	/** every peer fires the LOCAL heal pulses the current wave owes each enemy it uses —
	 * idempotent against the heal counter, so a joiner (whose counter arrived healed)
	 * fires nothing @param {ReturnType<typeof derive>} s */
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
				api.fireNodeTrigger('heal', (/** @type {any} */ _d, /** @type {string} */ id) => id === target, { replicate: false });
			healExpected.set(e.healthId, heals + fire);
		}
	}

	// ---- movement ----------------------------------------------------------------------------
	/** the hits this enemy has taken as far as THIS peer knows: the counter, or more if its own
	 * shots are still on their way into it @param {any} e */
	const hitsOf = (e) => Math.max(e.hits, hitExpected.get(e.healthId) ?? 0);

	/** @param {any} object @param {number[]} to */
	function stash(object, to) {
		object.position.fromArray(to);
	}

	/** @param {ReturnType<typeof derive>} s */
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
						goal: /** @type {number[]} */ (s.goal),
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
				if (s.breach && groundDistance(e.pos, /** @type {number[]} */ (s.goal)) <= s.reach) breachBy(s, e, object);
			} else if (!s.running) {
				// no run: everyone stands where the scene put them
				object.position.fromArray(home);
			} else if (index >= 0 && alive.has(k)) {
				// used, alive, not walking yet (the gap between waves, or no goal): at its portal
				object.position.fromArray(spawnFor(index, s.spawns, home));
			} else {
				// 30b: a run is on and this enemy is not in it (unused by this wave, or dead):
				// under the ground, and hidden if the wave does not use it — so the arena holds
				// only the wave, and nothing invisible stands in anyone's way
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
		// a run that ended (or was abandoned) lets go of the parked poses once restored
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

	/**
	 * 30b: THE BREACH. An enemy that walks into the goal's reach explodes against it: it dies
	 * (LOCAL pulses for what it had left — every peer derives the same arrival from the same
	 * clock and counters, the heal sweep's rule) and every player takes the breach's damage
	 * through the run's `breach` event (LOCAL too: each peer hurts its own row) — unless THIS
	 * player's guard (the Shield) holds. No kill credit, no score. Once per enemy per life, and
	 * never in the first second this peer sees the run (a joiner's first frames are history).
	 * @param {ReturnType<typeof derive>} s @param {any} e @param {any} object
	 */
	function breachBy(s, e, object) {
		const life = killsOf(hitsOf(e), e.max);
		if (breached.get(e.uuid) === life) return;
		if (performance.now() / 1000 - (firstSeen.get(s.id) ?? Infinity) < 1) return;
		const left = e.max - Math.max(0, hitsOf(e) - e.heals);
		if (left <= 0 || !e.damageId) return;
		breached.set(e.uuid, life);
		for (let i = 0; i < left; i++) api.fireNodeTrigger('damage', (/** @type {any} */ _d, /** @type {string} */ id) => id === e.damageId, { replicate: false });
		hitExpected.set(e.healthId, hitsOf(e) + left);
		announcedKills.set(e.uuid, killsOf(hitsOf(e), e.max));
		const pos = object.getWorldPosition(new api.THREE.Vector3()).toArray();
		const blocked = guard();
		if (!blocked) emit(s.name, 'breach');
		emitRun({ kind: 'breach', s, enemy: e, pos, blocked });
	}

	/** @param {{kind: string, s: any, enemy?: any, pos?: number[], blocked?: boolean}} ev */
	function emitRun(ev) {
		for (const fn of runListeners) {
			try {
				fn(ev);
			} catch (error) {
				console.warn('[waves] run listener failed', error);
			}
		}
	}

	// ---- 30b: shots -----------------------------------------------------------------------
	/** the enemies a shot may hit right now: in a running, started wave, used by it, alive
	 * (as this peer knows it) — never a parked or stashed one @returns {any[]} */
	function targets() {
		/** @type {any[]} */
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

	/**
	 * THIS peer's shot hit enemy `uuid` for `n` points. The pulses REPLICATE (only this peer
	 * saw its shot), exactly one per point, fired on the damage node that feeds the enemy's
	 * hit counter — the counter every peer derives the enemy's health, the wave and the kill
	 * from. Never more than the enemy has left (the overkill guard, against this peer's own
	 * view). A killing shot credits this peer's own `kills` row (the health module's rule).
	 * @param {string} uuid @param {number} n
	 * @returns {{landed: number, killed: boolean, enemy: any} | null}
	 */
	function hit(uuid, n) {
		const e = targets().find((x) => x.uuid === uuid);
		if (!e) return null;
		const landed = Math.max(0, Math.min(Math.floor(n), e.hp));
		if (!landed) return null;
		for (let i = 0; i < landed; i++) api.fireNodeTrigger('damage', (/** @type {any} */ _d, /** @type {string} */ id) => id === e.damageId);
		hitExpected.set(e.healthId, hitsOf(e) + landed);
		const killed = landed >= e.hp;
		const pos = objectOf(uuid)?.getWorldPosition(new api.THREE.Vector3()).toArray() ?? e.pos ?? [0, 0, 0];
		if (killed) {
			api.peerVars.setMine(KILLS_ROW, api.peerVars.mine(KILLS_ROW, 0) + 1);
			// 30b: the kill scores its kind's points times the level, on this player's own row
			const points = killScore((KINDS[e.kind] ?? KINDS.grunt).points, e.level ?? 1);
			api.peerVars.setMine(SCORE_ROW, api.peerVars.mine(SCORE_ROW, 0) + points);
			const kills = killsOf(hitsOf(e), e.max);
			announcedKills.set(uuid, kills);
			emitEnemy({ kind: 'death', uuid, pos, enemy: e, mine: true });
		} else emitEnemy({ kind: 'hurt', uuid, pos, enemy: e, mine: true });
		const seen = seenHits.get(uuid);
		if (seen) seenHits.set(uuid, { hits: hitsOf(e), kills: killsOf(hitsOf(e), e.max) });
		return { landed, killed, enemy: e };
	}

	/**
	 * 30b: an ability's REPLICATED event (Slow-mo, Pulse) into the running round's list — the
	 * one write, from the player who used it; every peer's walk reads it back.
	 * @param {any} event {k: 'slow', at, until} | {k: 'push', at, d: {uuid: metres}}
	 * @returns {boolean}
	 */
	function addFx(event) {
		const s = [...state.values()].find((x) => x.running);
		if (!s || typeof s.round !== 'number') return false;
		const key = FX_PREFIX + s.name;
		api.game.setVar(key, appendFx(api.game.getVar(key, null), s.round, event));
		// this peer sees it at once (the next sweep would anyway)
		s.fx = fxOf(api.game.getVar(key, null), s.round);
		s.slows = s.fx.filter((/** @type {any} */ e) => e?.k === 'slow');
		return true;
	}

	/** @param {{kind: 'hurt' | 'death', uuid: string, pos: number[], enemy: any, mine: boolean}} ev */
	function emitEnemy(ev) {
		for (const fn of enemyListeners) {
			try {
				fn(ev);
			} catch (error) {
				console.warn('[waves] enemy listener failed', error);
			}
		}
	}

	/** the hurt/death EDGES of every enemy, from the swept counters — a peer's shot, a knock,
	 * anyone's: the juice every peer shows. First sight (and a round's reset) never fires.
	 * @param {ReturnType<typeof derive>} s */
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
				emitEnemy({ kind: 'death', uuid: e.uuid, pos, enemy: e, mine: false });
			} else emitEnemy({ kind: 'hurt', uuid: e.uuid, pos, enemy: e, mine: false });
		}
	}

	// ---- events + the run log --------------------------------------------------------------
	/** @param {string} name @param {string} kind */
	function emit(name, kind) {
		api.fireNodeTrigger('wavesevent', (/** @type {any} */ d) => nameOf({ data: d }) === name && String(d?.event ?? 'wave') === kind, { replicate: false });
	}

	/** @param {ReturnType<typeof derive>} s @param {boolean} firstSight */
	function edges(s, firstSight) {
		const prevWave = waveSeen.get(s.id);
		const prevDone = doneSeen.get(s.id);
		const prevRun = runSeen.get(s.id);
		// 30b: a Restart leaves one round for a NEW one without ever stopping: that is a start too
		const prevRound = roundRun.get(s.id);
		roundRun.set(s.id, s.running ? s.round : null);
		waveSeen.set(s.id, s.wave);
		doneSeen.set(s.id, s.done);
		runSeen.set(s.id, s.running);
		if (firstSight) return;
		if (s.running && (prevRun === false || (typeof prevRound === 'number' && prevRound !== s.round))) {
			emit(s.name, 'start');
			emitRun({ kind: 'start', s });
		}
		if (typeof prevWave === 'number' && s.wave > prevWave && !s.done) {
			emit(s.name, 'wave');
			// 30b: the first wave of a new level also opens the level
			if (opensLevel(s.wave, s.perLevel)) {
				emit(s.name, 'level');
				emitRun({ kind: 'level', s });
			} else emitRun({ kind: 'wave', s });
		}
		if (s.done && prevDone === false) {
			emit(s.name, 'over');
			logRun(s);
			emitRun({ kind: 'over', s, won: true });
		} else if (!s.running && prevRun === true && !s.done) emitRun({ kind: 'over', s, won: false });
	}

	/** the run into gameState.vars — the same entry from every peer (deterministic inputs),
	 * appended idempotently by its ROUND (30: a knock landing on a dead, hidden enemy after the
	 * last kill moves its last-hit stamp, so `at` alone let two peers log one run twice) @param {ReturnType<typeof derive>} s */
	function logRun(s) {
		if (typeof s.clearedAt !== 'number') return;
		const names = new Map((api.peerNames?.() ?? []).map((/** @type {any} */ p) => [p.id, p.label ?? p.name]));
		const rows = (api.peerVars.all(KILLS_ROW) ?? []).map((/** @type {any} */ r) => ({ name: names.get(r.id) ?? 'peer ' + String(r.id).slice(0, 4), kills: r.value }));
		const entry = runEntry({ at: s.clearedAt, round: s.round, waves: s.curve.waves, reached: s.wave, cleared: true, rows });
		const key = LOG_PREFIX + s.name;
		const held = api.game.getVar(key, null);
		api.game.setVar(key, { runs: appendRun(held && typeof held === 'object' ? held.runs : [], entry) });
	}

	/** @param {string} name */
	function runLog(name) {
		const v = api.game.getVar(LOG_PREFIX + name, null);
		return v && typeof v === 'object' && Array.isArray(v.runs) ? v.runs : [];
	}

	// ---- the sweep -------------------------------------------------------------------------
	function sweep() {
		const g = graphView();
		const live = new Set();
		for (const node of g.nodes) {
			if (node.type !== 'waves') continue;
			live.add(node.id);
			const firstSight = !state.has(node.id);
			if (firstSight) firstSeen.set(node.id, performance.now() / 1000);
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
		// once the counter shows what we fired (or a reset took it below), forget the expectation
		for (const s of state.values())
			for (const e of s.enemies) {
				const expected = healExpected.get(e.healthId);
				if (expected !== undefined && (e.heals >= expected || (e.heals === 0 && e.hits === 0))) healExpected.delete(e.healthId);
				const shot = hitExpected.get(e.healthId);
				if (shot !== undefined && (e.hits >= shot || (e.hits === 0 && !s.running))) hitExpected.delete(e.healthId);
			}
		for (const fn of listeners) fn();
	}

	// 30b P0: the DERIVATION runs at 10 Hz, the WALK every frame. Placing the enemies only on
	// the 10 Hz tick moved them in 15 cm hops — a stutter nobody reads as walking, least of all
	// at a headset's 72-90 Hz. The position is a pure function of the clock, so placing it every
	// frame from the last derivation costs one lerp per enemy and changes no peer's answer.
	let lastSweep = -1;
	api.registerFrameTask(() => {
		const t = performance.now() / 1000;
		if (t - lastSweep >= SWEEP) {
			lastSweep = t;
			try {
				sweep();
			} catch (error) {
				console.warn('[waves] sweep failed', error);
			}
		}
		try {
			for (const s of state.values()) moveSweep(s);
		} catch (error) {
			console.warn('[waves] walk failed', error);
		}
	});

	/** @param {string} name */
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
		stateOf: (/** @type {string} */ id) => state.get(id) ?? null,
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
		onChange: (/** @type {() => void} */ fn) => {
			listeners.add(fn);
			return () => listeners.delete(fn);
		},
		clear
	};
}
