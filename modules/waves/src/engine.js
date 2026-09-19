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

import { curveOf, sizeOf, killsOf, waveOf, aliveIn, usedIn, healsBefore, enemyPosition, spawnFor, runEntry, appendRun, clamp, DEFAULTS } from './curve.js';

const SWEEP = 0.1;
const LOG_PREFIX = 'waves:';
/** the game shell stamps its round in session milliseconds; the trigger log and
 * api.now() are seconds of day — one conversion, here @param {number} ms */
const toSeconds = (ms) => (ms / 1000) % 86400;
const KILLS_ROW = 'kills';

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
	/** enemy uuid -> its parked pose (where it stands when no run is on) */
	const parked = new Map();
	/** health id -> the heal count we expect the counter to show once our local pulses
	 * land — flowValues republishes ~6/s, and firing again before it does would heal
	 * twice */
	const healExpected = new Map();
	/** the listeners the toolbox uses @type {Set<() => void>} */
	const listeners = new Set();

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
			out.push({
				healthId: node.id,
				uuid,
				label: object?.name || (uuid ? uuid.slice(0, 8) + '…' : '(no target)'),
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
		const goalUuid = selectorInto(g, node, 'goal');
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

	// ---- movement --------------------------------------------------------------------------
	/** @param {ReturnType<typeof derive>} s */
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
				object.position.fromArray(enemyPosition({ start, goal: /** @type {number[]} */ (s.goal), waveStart: s.waveStart, index, now: now(), speed: s.speed, stagger: s.stagger }));
			} else if (!s.running) {
				// no run: everyone stands where the scene put them
				object.position.fromArray(home);
			} else if (index >= 0 && !alive.has(k) === false) {
				// used, alive, but no goal: at its spawn point
				object.position.fromArray(spawnFor(index, s.spawns, home));
			}
			object.updateMatrixWorld?.();
		}
		// a run that ended (or was abandoned) lets go of the parked poses once restored
		if (!s.running) for (const e of s.enemies) parked.delete(e.uuid);
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
		waveSeen.set(s.id, s.wave);
		doneSeen.set(s.id, s.done);
		runSeen.set(s.id, s.running);
		if (firstSight) return;
		if (s.running && prevRun === false) emit(s.name, 'start');
		if (typeof prevWave === 'number' && s.wave > prevWave && !s.done) emit(s.name, 'wave');
		if (s.done && prevDone === false) {
			emit(s.name, 'over');
			logRun(s);
		}
	}

	/** the run into gameState.vars — the same entry from every peer (deterministic inputs),
	 * appended idempotently by its `at` @param {ReturnType<typeof derive>} s */
	function logRun(s) {
		if (typeof s.clearedAt !== 'number') return;
		const names = new Map((api.peerNames?.() ?? []).map((/** @type {any} */ p) => [p.id, p.label ?? p.name]));
		const rows = (api.peerVars.all(KILLS_ROW) ?? []).map((/** @type {any} */ r) => ({ name: names.get(r.id) ?? 'peer ' + String(r.id).slice(0, 4), kills: r.value }));
		const entry = runEntry({ at: s.clearedAt, waves: s.curve.waves, reached: s.wave, cleared: true, rows });
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
		// once the counter shows what we fired (or a reset took it below), forget the expectation
		for (const s of state.values())
			for (const e of s.enemies) {
				const expected = healExpected.get(e.healthId);
				if (expected !== undefined && (e.heals >= expected || (e.heals === 0 && e.hits === 0))) healExpected.delete(e.healthId);
			}
		for (const fn of listeners) fn();
	}

	let lastSweep = -1;
	api.registerFrameTask(() => {
		const t = performance.now() / 1000;
		if (t - lastSweep < SWEEP) return;
		lastSweep = t;
		try {
			sweep();
		} catch (error) {
			console.warn('[waves] sweep failed', error);
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
		doneSeen.clear();
		runSeen.clear();
		parked.clear();
		healExpected.clear();
	}

	return {
		state,
		stateOf: (/** @type {string} */ id) => state.get(id) ?? null,
		read,
		all: () => [...state.values()],
		graphView,
		runLog,
		sweep,
		onChange: (/** @type {() => void} */ fn) => {
			listeners.add(fn);
			return () => listeners.delete(fn);
		},
		clear
	};
}
