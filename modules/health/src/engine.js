// health — THE ENGINE: one 10 Hz sweep that DERIVES every health from replicated state
// and fires the pulses that change it. Nothing here is sent on a timer; the only things
// that ever leave this peer are pulses through core's own `nodetrigger` path (a click,
// a touch, a knock this peer reports) and this peer's own peerVars row.
//
// THE RULE EVERY SOURCE FOLLOWS — who fires, and does it replicate:
//   - a REPLICATED source (a stamp on a wired event node, the knock feed every peer
//     receives): every peer derives the same pulse and fires it LOCALLY
//     (`{replicate:false}`); the counters converge because every peer applied the same
//     set of pulses, and a joiner gets the counts in the handshake.
//   - a source only THIS peer can see (its own click, its own touch): this peer fires a
//     REPLICATED pulse, and the others apply it once — the collectible's model.
//   - a PLAYER's health: the same pulses, always local, plus the row write — one writer.
//
// FIRST SIGHT NEVER FIRES (the collectible's rule, core's `actionSeenAt`): a stamp that
// was already there when this peer first saw a node is history, adopted and never acted
// on. It is what stops a late joiner from re-applying every hit in the handshake.

import { objectHp, playerHp, applyDelta, pulsesFor, fraction, respawnDue, DEFAULTS, clamp } from './ledger.js';
import { indexGraph, targetsOf, chainsOf, feedersOf, triggerSourcesOf, zoneOf, nameOf } from './graph.js';

const SWEEP = 0.1;
const AT_SUFFIX = '.at';
/** the per-player kill count, on the killer's own row */
const KILLS_ROW = 'kills';

/** @param {any} api */
export function createEngine(api) {
	/** derived, per health node id
	 * @type {Map<string, {id: string, name: string, scope: string, max: number, regen: number, deathAction: string, respawnDelay: number, hp: number, dead: boolean, uuid: string|null, deadAt: number|null, label: string}>} */
	const state = new Map();
	/** node id -> last stamp acted on (damage/heal wired sources); null = seeded, none yet */
	const acted = new Map();
	/** health id -> previous `dead`, for the death edge */
	const wasDead = new Map();
	/** health id -> previous hp, for the `damage` event edge */
	const lastHp = new Map();
	/** health id -> the deadAt a respawn was already fired for */
	const respawned = new Map();
	/** damage node id -> the object uuids the local player is currently inside (touch/zone) */
	const inside = new Map();
	/** damage node id -> performance.now()/1000 of the last zone tick */
	const zoneTick = new Map();
	/** uuid -> the knock stamp already applied (the feed fires once per hit per peer;
	 * this is the belt to that brace) */
	const knocked = new Map();
	/** the objects THIS module hid (uuid -> true), so it gives back exactly those and
	 * never fights a manual hide — the 21-F2 rule, kept by hand because health is a value
	 * node, not an effect (an effect would pin its target's pose) */
	const hidden = new Set();
	/** the round cutoff we last saw (null = not seen yet) */
	let roundSeen = /** @type {any} */ (undefined);
	/** the listeners the toolbox uses (a local refresh, never a wire) @type {Set<() => void>} */
	const listeners = new Set();

	const now = () => api.now();

	// ---- reads ----------------------------------------------------------------------
	function graphView() {
		const nodes = api.flow.nodes();
		const edges = api.flow.edges();
		return indexGraph(nodes, edges);
	}

	/** @param {any} node */
	function numberValue(node) {
		const v = api.flow.nodeValue(node.id);
		return Number.isFinite(Number(v)) ? Number(v) : 0;
	}

	/** the local player's row for a name @param {string} name */
	function myRow(name) {
		const base = api.peerVars.mine(name, null);
		const at = api.peerVars.mine(name + AT_SUFFIX, null);
		return {
			base: typeof base === 'number' ? base : null,
			at: typeof at === 'number' ? at : null
		};
	}

	/** @param {string} name @param {number} base @param {number} at */
	function writeRow(name, base, at) {
		api.peerVars.setMine(name, base);
		api.peerVars.setMine(name + AT_SUFFIX, at);
	}

	/** the object an id names, if it is in the replicated scene @param {string|null} uuid */
	function objectOf(uuid) {
		if (!uuid) return null;
		return api.objectsGroup()?.getObjectByProperty('uuid', uuid) ?? null;
	}

	// ---- the derivation -------------------------------------------------------------
	/** @param {any} node @param {import('./graph.js').GraphIndex} g */
	function derive(node, g) {
		const d = node.data ?? {};
		const name = nameOf(node);
		const scope = d.scope === 'player' ? 'player' : 'object';
		const max = clamp(d.max, 1, 1e6, DEFAULTS.max);
		const regen = clamp(d.regen, 0, 1e6, 0);
		const t = now();
		let hp = max;
		let dead = false;
		let deadAt = null;
		let uuid = null;
		if (scope === 'player') {
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
			label: scope === 'player' ? 'player' : object?.name || (uuid ? uuid.slice(0, 8) + '…' : '(no target)')
		};
	}

	// ---- pulses ---------------------------------------------------------------------
	/**
	 * Fire `n` pulses from a damage/heal node. `local` keeps them in this peer's log
	 * (every peer derives the same ones); otherwise they replicate (only this peer saw
	 * the cause). Player-scoped chains also write this peer's row.
	 * `credit` names this peer as the one who caused it (its click, its own hand's knock):
	 * a killing blow then bumps this peer's own `kills` row — per-player scoring on the
	 * peerVars one-writer rule, the football sheet's shape.
	 * @param {any} node the damage or heal node
	 * @param {number} n pulses (hit points)
	 * @param {{local: boolean, sign: 1|-1, credit?: boolean}} how
	 * @param {import('./graph.js').GraphIndex} g
	 * @returns {number} pulses fired
	 */
	function pulse(node, n, how, g) {
		if (n <= 0) return 0;
		const chains = chainsOf(node, g);
		if (!chains.length) return 0;
		// the overkill guard: a pulse aimed only at the dead is dropped, so a hit landing
		// after the killing blow does not carry into the next life (every peer derives
		// `dead` from the same counters, so every peer drops the same pulse)
		const live = chains.filter((c) => {
			const s = state.get(c.health.id);
			return !s || !s.dead || how.sign > 0;
		});
		if (!live.length) return 0;
		const t = now();
		for (let i = 0; i < n; i++)
			api.fireNodeTrigger(node.type, (/** @type {any} */ _d, /** @type {string} */ id) => id === node.id, how.local ? { replicate: false } : undefined);
		// the counter's value republishes ~6/s, so "did this kill" is read off the LAST
		// sweep's number minus what we just fired — the same arithmetic every peer does
		if (how.credit && how.sign < 0)
			for (const chain of live) {
				const s = state.get(chain.health.id);
				if (!s || s.scope === 'player' || s.dead) continue;
				if (s.hp - n <= 0) api.peerVars.setMine(KILLS_ROW, api.peerVars.mine(KILLS_ROW, 0) + 1);
			}
		for (const chain of live) {
			const s = state.get(chain.health.id);
			if (!s || s.scope !== 'player') continue;
			const row = myRow(s.name);
			const next = applyDelta({ max: s.max, regen: s.regen, base: row.base, at: row.at, now: t }, how.sign * n);
			writeRow(s.name, next.base, next.at);
		}
		return n;
	}

	/** the source-side sweep: wired stamps on every damage/heal node
	 * @param {import('./graph.js').GraphIndex} g */
	function wiredSweep(g) {
		for (const node of g.nodes) {
			if (node.type !== 'damage' && node.type !== 'heal') continue;
			const sources = triggerSourcesOf(node, g);
			let newest = null;
			for (const id of sources) {
				const stamp = api.flow.triggerStamp(id);
				if (stamp && (newest === null || stamp.stamp > newest)) newest = stamp.stamp;
			}
			if (!acted.has(node.id)) {
				acted.set(node.id, newest); // seed, never act
				continue;
			}
			if (newest === null || acted.get(node.id) === newest) continue;
			acted.set(node.id, newest);
			if (node.type === 'damage' && (node.data?.source ?? 'wired') !== 'wired') continue;
			const n = pulsesFor({ amount: node.data?.amount ?? 1 });
			// the stamp REPLICATED, so every peer fires its own local copy of this pulse
			pulse(node, n, { local: true, sign: node.type === 'heal' ? 1 : -1 }, g);
		}
		// forgotten nodes forget their seed, so an undo that brings one back re-seeds
		for (const id of [...acted.keys()]) if (!g.byId.has(id)) acted.delete(id);
	}

	/**
	 * Damage nodes of `source` kind whose health targets one of `uuids`, fired with
	 * `amount` pulses (speed-scaled when the node says so). `local` says whether every
	 * peer derives this cause itself (a knock message everyone receives) or only this
	 * peer saw it (its own click, its own touch), in which case the pulse replicates.
	 * @param {string[]} uuids @param {string} source @param {{speed?: number, local: boolean, credit?: boolean, g?: any}} how
	 * @returns {number} damage nodes fired
	 */
	function hitObjects(uuids, source, how) {
		if (!uuids.length) return 0;
		const wanted = new Set(uuids);
		const g = how.g ?? graphView();
		let fired = 0;
		for (const node of g.nodes) {
			if (node.type !== 'damage' || (node.data?.source ?? 'wired') !== source) continue;
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

	// ---- the knock feed: `hit` ---------------------------------------------------------
	// Every peer receives every knock (one `hit` message, identical `at` stamps), so every
	// peer fires its own LOCAL pulses — the replicated-source rule. A joiner's log starts
	// empty, which is exactly "first sight never fires" for free.
	if (typeof api.onHit === 'function')
		api.onHit((/** @type {any} */ hit) => {
			if (!hit?.uuid) return;
			if (knocked.get(hit.uuid) === hit.at) return;
			knocked.set(hit.uuid, hit.at);
			hitObjects([hit.uuid], 'hit', { speed: Number(hit.speed) || 0, local: true, credit: !!hit.local });
		});

	// ---- self-proximity: `touch` (an edge) and `zone` (per second, while inside) ----------
	// Each peer detects ITSELF near an object — no sensor, no sim, no initiator. An OBJECT
	// chain hurts the object the toucher walked into (this peer alone saw it: replicated);
	// a PLAYER chain hurts the toucher, near the object wired into `zone` (local + the row).
	/** @param {import('./graph.js').GraphIndex} g */
	function proximitySweep(g) {
		if (!api.isPlaying()) {
			inside.clear();
			return;
		}
		const position = api.playerPosition();
		if (!position) return;
		const here = new api.THREE.Vector3(position[0], position[1], position[2]);
		const tick = performance.now() / 1000;
		for (const node of g.nodes) {
			if (node.type !== 'damage') continue;
			const source = node.data?.source ?? 'wired';
			if (source !== 'touch' && source !== 'zone') continue;
			const radius = clamp(node.data?.radius, 0.1, 100, 1.5);
			const chains = chainsOf(node, g);
			/** @type {{uuid: string, local: boolean}[]} */
			const targets = [];
			for (const chain of chains) {
				if (chain.health.data?.scope === 'player') {
					const zone = zoneOf(node, g);
					if (zone) targets.push({ uuid: zone, local: true });
				} else for (const uuid of targetsOf(chain.health, g)) targets.push({ uuid, local: false });
			}
			const was = inside.get(node.id) ?? new Set();
			const nowIn = new Set();
			for (const t of targets) {
				const object = objectOf(t.uuid);
				if (!object) continue;
				if (object.getWorldPosition(new api.THREE.Vector3()).distanceTo(here) > radius) continue;
				nowIn.add(t.uuid);
				if (source === 'touch' && !was.has(t.uuid)) fireAt(node, t, g);
			}
			if (source === 'zone' && nowIn.size) {
				const every = 1 / clamp(node.data?.perSecond, 0.1, 100, 1);
				const last = zoneTick.get(node.id) ?? -Infinity;
				if (tick - last >= every) {
					zoneTick.set(node.id, tick);
					for (const t of targets) if (nowIn.has(t.uuid)) fireAt(node, t, g);
				}
			} else if (source === 'zone') zoneTick.delete(node.id);
			inside.set(node.id, nowIn);
		}
		for (const id of [...inside.keys()]) if (!g.byId.has(id)) inside.delete(id);
	}

	/** @param {any} node @param {{uuid: string, local: boolean}} t @param {import('./graph.js').GraphIndex} g */
	function fireAt(node, t, g) {
		const n = pulsesFor({ amount: node.data?.amount ?? 1 });
		pulse(node, n, { local: t.local, sign: -1, credit: !t.local }, g);
	}

	// ---- events + respawn -----------------------------------------------------------
	/** a LOCAL pulse on every healthevent node of this name and kind (each peer derives
	 * the same edge, so each fires its own) @param {string} name @param {string} kind */
	function emit(name, kind) {
		api.fireNodeTrigger(
			'healthevent',
			(/** @type {any} */ d) => nameOf({ data: d }) === name && String(d?.event ?? 'death') === kind,
			{ replicate: false }
		);
	}

	/** a LOCAL pulse on every healthreset node of this name — the counters it feeds
	 * zero on this peer, and every peer does the same at the same derived moment
	 * @param {string} name */
	function reset(name) {
		api.fireNodeTrigger('healthreset', (/** @type {any} */ d) => nameOf({ data: d }) === name, { replicate: false });
	}

	/** @param {ReturnType<typeof derive>} s @param {boolean} firstSight */
	function edges(s, firstSight) {
		const before = wasDead.get(s.id);
		wasDead.set(s.id, s.dead);
		const prevHp = lastHp.get(s.id);
		lastHp.set(s.id, s.hp);
		if (firstSight) return;
		if (s.dead && before === false) emit(s.name, 'death');
		if (typeof prevHp === 'number' && s.hp < prevHp - 1e-9) emit(s.name, 'damage');
		if (!s.dead && before === true) emit(s.name, 'respawn');
	}

	/** @param {ReturnType<typeof derive>} s */
	function respawnSweep(s) {
		if (s.deathAction !== 'respawn') return;
		if (!s.dead) {
			respawned.delete(s.id);
			return;
		}
		if (!respawnDue(s.deadAt, s.respawnDelay, now())) return;
		if (respawned.get(s.id) === s.deadAt) return;
		respawned.set(s.id, s.deadAt);
		if (s.scope === 'player') {
			writeRow(s.name, s.max, now());
			const at = respawnPoint(s);
			if (at) api.flyTo(at);
		} else reset(s.name);
	}

	/** where a player comes back: the object wired into `respawnAt`, if any
	 * @param {ReturnType<typeof derive>} s @returns {number[]|null} */
	function respawnPoint(s) {
		const g = graphView();
		const node = g.byId.get(s.id);
		if (!node) return null;
		for (const edge of g.byTarget.get(s.id) ?? []) {
			if ((edge.targetHandle ?? null) !== 'respawnAt') continue;
			const src = g.byId.get(edge.source);
			const uuid = src?.type === 'objectselector' ? String(src.data?.selected ?? '') : '';
			const object = objectOf(uuid && uuid !== '-None-' ? uuid : null);
			if (object) return object.getWorldPosition(new api.THREE.Vector3()).toArray();
		}
		return null;
	}

	/** a new round: every counter this module resets goes to zero, every player row to full.
	 * THE JOINER TRAP: the game state lands a moment after the graph, so a joiner's first
	 * sweeps see no shell and then a round already under way — that is history, and firing
	 * a reset on it would zero the counters the handshake just delivered. So the FIRST
	 * sight of the shell in use is a seed, and only a later change to a NEW round acts.
	 * No clock is compared (a joiner's api.now() re-bases on connect), only identity. */
	function roundSweep() {
		const cutoff = api.game.roundCutoff();
		if (cutoff === null) {
			roundSeen = null; // shell not in use: nothing to seed on
			return;
		}
		if (roundSeen === undefined || roundSeen === null) {
			roundSeen = cutoff; // first sight of the shell: history, never a start we witnessed
			return;
		}
		if (cutoff === roundSeen) return;
		roundSeen = cutoff;
		if (typeof cutoff !== 'number' || !Number.isFinite(cutoff)) return; // menu/over: nothing to zero
		const names = new Set();
		for (const s of state.values()) {
			names.add(s.name);
			if (s.scope === 'player') writeRow(s.name, s.max, now());
		}
		for (const name of names) {
			reset(name);
			emit(name, 'reset');
		}
	}

	/** hide a dead object while playing; give back what we hid the moment it is not
	 * (alive again, out of play, action changed) — and only what WE hid */
	function visibilitySweep() {
		const playing = api.isPlaying();
		const shouldHide = new Set();
		for (const s of state.values())
			if (s.scope === 'object' && s.uuid && s.dead && playing && s.deathAction !== 'nothing') shouldHide.add(s.uuid);
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

	// ---- the sweep ------------------------------------------------------------------
	function sweep() {
		const g = graphView();
		const live = new Set();
		for (const node of g.nodes) {
			if (node.type !== 'health') continue;
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
		// a LOCAL schedule (performance.now, not the synced clock, which wraps at midnight)
		const t = performance.now() / 1000;
		if (t - lastSweep < SWEEP) return;
		lastSweep = t;
		try {
			sweep();
		} catch (error) {
			console.warn('[health] sweep failed', error);
		}
	});

	// ---- reads for the nodes, the HUD and the toolbox --------------------------------
	/** every derived health, deterministic order */
	function all() {
		return [...state.values()].sort((a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id));
	}

	/** the numbers for one name: sums over every health carrying it (a group bar), with
	 * `alive` counting the living @param {string} name */
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

	/** every name in use, sorted */
	function names() {
		return [...new Set([...state.values()].map((s) => s.name))].sort();
	}

	/** @param {() => void} fn */
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
		roundSeen = undefined;
	}

	return {
		state,
		stateOf: (/** @type {string} */ id) => state.get(id) ?? null,
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
