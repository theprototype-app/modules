// football — THE GAME LAYER: replicated match state, the ops that change it, who is
// allowed to decide what, and the per-frame tick that watches the ball.
//
// Replication, one model per feature (AUTHORING.md §4):
//   slots / start / new-match / swap   EVENTS from the peer who pressed; every peer applies
//                                       the same pure rule (rules.js) to the same event.
//   last touch                          DERIVED from the knock's hit feed, which every peer
//                                       receives (api.onHit, A2) — no module message at all.
//   goal / serve / over                 AUTHORITATIVE: the physics initiator (the only peer
//                                       stepping the ball) detects and broadcasts; receivers
//                                       apply. With no simulation anywhere, the lowest peer
//                                       id stands in so a stalled session still ends.
//   per-player sheet                    api.peerVars: the ONE peer whose id the goal names
//                                       bumps its OWN row (F7). Nobody else can.
//   late joiners                        registerStateSync carries the whole match state.
//
// Everything here is applied through the same function whether it came from a local press
// or the wire; receivers never re-send.

import {
	DEFAULT_RULES,
	MATCH_LOG_CAP,
	REST_DISTANCE,
	REST_SECONDS,
	normalizeRules,
	emptySlots,
	teamOf,
	canJoin,
	applySlot,
	freeVanished,
	swapSlots,
	attributeGoal,
	applyGoal,
	matchOutcome,
	secondsLeft,
	serveImpulse,
	matchLogEntry,
	appendMatchLog,
	scoreLine
} from './rules.js';

export const MODULE_ID = 'football';
/** gameState.vars key the saved sheet lives under (B5) */
export const LOG_VAR = 'football';

/** @param {any} api */
export function createGame(api) {
	const THREE = api.THREE;

	const state = {
		/** rules from the toolbox when no Match Rules node is alive */
		rulesOverride: /** @type {any} */ (null),
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
		playerGoals: /** @type {Record<string, number>} */ ({}),
		/** @type {{winner: string, reason: string} | null} */
		outcome: null,
		/** the last op stamp — a late joiner adopts the newer state */
		at: 0
	};

	// live node-config (nodes.js writes; absent node = null = toolbox/default)
	const config = {
		rules: /** @type {any} */ (null),
		/** @type {Record<string, {team: 'red'|'blue', label: string}>} gate object uuid -> team */
		gates: {},
		ballUuid: /** @type {string | null} */ (null)
	};

	/** @type {Set<(what: string, data?: any) => void>} */
	const listeners = new Set();
	const emit = (what, data) => {
		for (const fn of listeners) {
			try {
				fn(what, data);
			} catch (error) {
				console.log('football listener failed', error);
			}
		}
	};

	const me = () => api.peerId() ?? 'me';
	const now = () => api.now();
	const rules = () => normalizeRules(config.rules ?? state.rulesOverride ?? DEFAULT_RULES);

	/** @returns {{id: string, name: string, label: string, me: boolean}[]} */
	function roster() {
		const rows = typeof api.peerNames === 'function' ? api.peerNames() : [];
		if (!rows.some((r) => r.me)) rows.push({ id: me(), name: '', label: 'you', me: true });
		return rows;
	}
	/** @param {string} peerId */
	function nameOf(peerId) {
		if (peerId === me()) {
			const mine = roster().find((r) => r.me);
			return mine?.name || state.names[peerId] || 'you';
		}
		return roster().find((r) => r.id === peerId)?.label || state.names[peerId] || 'peer ' + String(peerId).slice(0, 4);
	}
	const liveIds = () => {
		const ids = typeof api.peerIds === 'function' ? api.peerIds() : [];
		return ids.includes(me()) ? ids : [me(), ...ids];
	};

	/** Who decides goals, serves and the end: the physics initiator; with no sim anywhere,
	 * the lowest peer id (deterministic on every peer). */
	function isAuthority() {
		if (api.physics?.running?.()) return !!api.physics.isInitiator();
		const ids = liveIds().slice().sort();
		return ids[0] === me();
	}

	const ball = () => (config.ballUuid ? api.objectsGroup()?.getObjectByProperty('uuid', config.ballUuid) ?? null : null);

	// ---- applying ops (shared by the local press and the wire) ----------------------

	/** @param {any} data */
	function stamp(data) {
		const at = Number(data?.at) || now();
		if (at > state.at) state.at = at;
		return at;
	}

	/** @param {{team: 'red'|'blue'|'none', peerId: string, name?: string, at?: number}} data */
	function applySlotOp(data) {
		const team = data.team === 'red' || data.team === 'blue' ? data.team : 'none';
		const verdict = canJoin(state.slots, team, data.peerId, rules().mode);
		if (!verdict.ok) return false;
		state.slots = applySlot(state.slots, team, data.peerId);
		if (data.name) state.names[data.peerId] = data.name;
		stamp(data);
		emit('slots');
		return true;
	}

	/** @param {{at: number}} data */
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
		emit('start');
		fireEvent('start');
		api.game?.setState?.('playing', '');
		return true;
	}

	/** @param {{at: number}} data */
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
		emit('reset');
		fireEvent('reset');
		api.game?.setState?.('menu', '');
		void at;
		return true;
	}

	/** @param {{at: number}} data */
	function applySwap(data) {
		stamp(data);
		state.slots = swapSlots(state.slots);
		emit('slots');
		return true;
	}

	/**
	 * A goal, as the authority saw it. Every peer applies the shared score; ONLY the peer
	 * the goal names touches its own sheet row.
	 * @param {{gate: string, gateTeam: 'red'|'blue', by: string|null, own: boolean, counts: boolean,
	 *   credit: string|null, team: string|null, at: number}} data
	 */
	function applyGoalOp(data) {
		if (!state.started) return false;
		const at = stamp(data);
		const a = { team: data.team ?? null, by: data.by ?? null, own: !!data.own, counts: !!data.counts, credit: data.credit ?? null, reason: '' };
		state.score = applyGoal(state.score, a);
		if (a.counts && a.by && rules().mode === 'freeforall') state.playerGoals[a.by] = (state.playerGoals[a.by] ?? 0) + 1;
		if (a.counts) state.goals++;
		// F7: my row is mine alone to write
		if (a.by === me() && a.credit && api.peerVars?.setMine) api.peerVars.setMine(a.credit, api.peerVars.mine(a.credit, 0) + 1);
		state.lastTouch = null;
		state.serveAt = rules().serve === 'auto' ? at + rules().serveDelay : 0;
		const gate = api.objectsGroup()?.getObjectByProperty('uuid', data.gate);
		const where = gate ? gate.getWorldPosition(new THREE.Vector3()).toArray() : undefined;
		if (a.counts) api.playSound?.('ding', where);
		emit('goal', a);
		fireEvent('goal');
		if (a.counts && a.team) fireEvent(a.team + 'goal');
		return true;
	}

	/** @param {{at: number, dir?: number[]}} data */
	function applyServeOp(data) {
		stamp(data);
		state.serves++;
		state.serveAt = 0;
		state.lastTouch = null;
		emit('serve');
		fireEvent('serve');
		return true;
	}

	/** @param {{at: number, winner: string, reason: string, log?: any}} data */
	function applyOver(data) {
		if (!state.started) return false;
		const at = stamp(data);
		state.started = false;
		state.endedAt = at;
		state.serveAt = 0;
		state.outcome = { winner: String(data.winner ?? 'draw'), reason: String(data.reason ?? '') };
		emit('over', state.outcome);
		fireEvent('over');
		api.game?.setState?.('over', outcomeText());
		return true;
	}

	/** @param {{rules: any, at: number}} data */
	function applyRulesOp(data) {
		stamp(data);
		state.rulesOverride = normalizeRules(data.rules);
		emit('rules');
		return true;
	}

	// ---- the actions a button, a HUD button or the toolbox can take -------------------

	/** @param {string} action @returns {boolean} */
	function act(action) {
		const at = now();
		switch (action) {
			case 'join-red':
			case 'join-blue':
			case 'spectate': {
				const team = action === 'join-red' ? 'red' : action === 'join-blue' ? 'blue' : 'none';
				const verdict = canJoin(state.slots, team, me(), rules().mode);
				if (!verdict.ok) {
					api.toast('Football: ' + verdict.reason);
					return false;
				}
				const data = { op: 'slot', team, peerId: me(), name: nameOf(me()), at };
				applySlotOp(data);
				api.send(data);
				return true;
			}
			case 'start': {
				if (state.started) return false;
				const data = { op: 'start', at };
				applyStart(data);
				api.send(data);
				return true;
			}
			case 'new-match': {
				const data = { op: 'reset', at };
				applyReset(data);
				api.send(data);
				return true;
			}
			case 'swap-sides': {
				const data = { op: 'swap', at };
				applySwap(data);
				api.send(data);
				return true;
			}
			case 'serve':
				return serve('button');
			default:
				return false;
		}
	}

	/** the toolbox's host settings when no Match Rules node owns them @param {any} patch */
	function setRules(patch) {
		const data = { op: 'rules', rules: normalizeRules({ ...rules(), ...patch }), at: now() };
		applyRulesOp(data);
		api.send(data);
	}

	// ---- the authority's half: serve, goal detection, the end ---------------------------

	/** @param {'auto'|'button'|'rest'} why */
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
		const data = { op: 'serve', at, why };
		applyServeOp(data);
		api.send(data);
		return pushed;
	}

	/** the pitch centre = the midpoint between the two gates (or the origin) */
	function pitchCentre() {
		const group = api.objectsGroup();
		const gates = Object.keys(config.gates)
			.map((uuid) => group?.getObjectByProperty('uuid', uuid))
			.filter(Boolean);
		if (gates.length < 2) return [0, 0, 0];
		const c = new THREE.Vector3();
		for (const g of gates) c.add(g.getWorldPosition(new THREE.Vector3()));
		return c.multiplyScalar(1 / gates.length).toArray();
	}

	/** @type {Record<string, boolean>} gate uuid -> the ball was inside last frame */
	const inside = {};
	const _box = new THREE.Box3();
	const _pos = new THREE.Vector3();

	function watchGoals() {
		const object = ball();
		if (!object) return;
		object.getWorldPosition(_pos);
		const group = api.objectsGroup();
		for (const [uuid, gate] of Object.entries(config.gates)) {
			const sensor = group?.getObjectByProperty('uuid', uuid);
			if (!sensor) continue;
			_box.setFromObject(sensor);
			const isIn = _box.containsPoint(_pos);
			const was = !!inside[uuid];
			inside[uuid] = isIn;
			// ENTER edge only, and only while a match runs with no serve pending
			if (!isIn || was || !state.started || state.serveAt) continue;
			const r = rules();
			const a = attributeGoal({ gateTeam: gate.team, lastTouch: state.lastTouch, slots: state.slots, mode: r.mode, ownGoals: r.ownGoals });
			const data = { op: 'goal', gate: uuid, gateTeam: gate.team, team: a.team, by: a.by, own: a.own, counts: a.counts, credit: a.credit, at: now() };
			applyGoalOp(data);
			api.send(data);
		}
	}

	let restPos = /** @type {number[] | null} */ (null);
	let restSince = 0;
	/** a ball that sits still mid-match for REST_SECONDS is re-served toward the centre */
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
			if (rules().serve === 'auto') serve('rest');
		}
	}

	function watchEnd() {
		if (!state.started) return;
		const outcome = matchOutcome({ score: state.score, rules: rules(), elapsed: now() - state.startedAt, playerGoals: state.playerGoals });
		if (!outcome) return;
		const data = { op: 'over', at: now(), ...outcome };
		applyOver(data);
		api.send(data);
		writeMatchLog();
	}

	// ---- B5: the saved sheet ------------------------------------------------------------

	function writeMatchLog() {
		if (!api.game?.setVar || !api.game?.getVar) return;
		const rows = sheetRows().map((r) => ({ name: r.name, goals: r.goals }));
		const entry = matchLogEntry({ at: now(), score: state.score, winner: outcomeWinnerName(), rows });
		const current = api.game.getVar(LOG_VAR, null);
		const matches = appendMatchLog(current && typeof current === 'object' ? current.matches : [], entry, MATCH_LOG_CAP);
		api.game.setVar(LOG_VAR, { matches });
	}

	/** the saved matches, newest last @returns {any[]} */
	function matchLog() {
		const v = api.game?.getVar?.(LOG_VAR, null);
		return v && typeof v === 'object' && Array.isArray(v.matches) ? v.matches : [];
	}

	// ---- last touch: the knock's hit feed ----------------------------------------------

	/** @param {any} hit */
	function onHit(hit) {
		if (!hit || !config.ballUuid || hit.uuid !== config.ballUuid) return;
		const by = String(hit.by ?? '');
		if (!by) return;
		const team = teamOf(state.slots, by);
		// a spectator's hit moves the ball (that is physics) but attributes nothing
		state.lastTouch = { by, team, at: Number(hit.at) || now() };
		if (by === me() && state.started && api.peerVars?.setMine) api.peerVars.setMine('touches', api.peerVars.mine('touches', 0) + 1);
		emit('touch', state.lastTouch);
		if (by === me()) fireEvent('touch');
	}

	/** A2's seam, feature-detected; the debug hook is the A1-only fallback. */
	function wireHits() {
		if (typeof api.onHit === 'function') {
			api.onHit(onHit);
			return 'api.onHit';
		}
		const knock = typeof window !== 'undefined' ? /** @type {any} */ (window).__stores?.knock : null;
		if (knock?.registerHitListener) {
			knock.registerHitListener((/** @type {any} */ hit) => onHit(hit));
			return '__stores.knock';
		}
		return 'none';
	}

	// ---- events into the graph -----------------------------------------------------------

	/** pulse `fbevent` nodes of this kind. REPLICATED, so only the peer where the event
	 * originated fires — which is whoever ran the op locally first: for goal/serve/over
	 * the authority, for start/reset the presser, for touch the hitter. @param {string} kind */
	let firing = false;
	function fireEvent(kind) {
		if (!lastOpLocal || typeof api.fireNodeTrigger !== 'function') return;
		if (firing) return;
		firing = true;
		try {
			api.fireNodeTrigger('fbevent', (d) => (d?.event ?? 'goal') === kind);
		} finally {
			firing = false;
		}
	}
	/** true while the op being applied was born on THIS peer (set by act/serve/watch) */
	let lastOpLocal = true;

	// ---- netcode --------------------------------------------------------------------------

	/** @param {any} data */
	function handleMessage(data) {
		lastOpLocal = false;
		try {
			switch (data?.op) {
				case 'slot':
					return applySlotOp(data);
				case 'start':
					return applyStart(data);
				case 'reset':
					return applyReset(data);
				case 'swap':
					return applySwap(data);
				case 'goal':
					return applyGoalOp(data);
				case 'serve':
					return applyServeOp(data);
				case 'over':
					return applyOver(data);
				case 'rules':
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

	/** @param {any} remote */
	function applyState(remote) {
		if (!remote || typeof remote !== 'object') return;
		if ((Number(remote.at) || 0) < state.at) return; // ours is newer
		lastOpLocal = false;
		state.at = Number(remote.at) || 0;
		state.rulesOverride = remote.rulesOverride ? normalizeRules(remote.rulesOverride) : null;
		state.slots = { red: [...(remote.slots?.red ?? [])], blue: [...(remote.slots?.blue ?? [])] };
		state.names = { ...(remote.names ?? {}) };
		state.started = !!remote.started;
		state.startedAt = Number(remote.startedAt) || 0;
		state.endedAt = Number(remote.endedAt) || 0;
		state.score = { red: Number(remote.score?.red) || 0, blue: Number(remote.score?.blue) || 0 };
		state.lastTouch = remote.lastTouch ? { by: String(remote.lastTouch.by), team: remote.lastTouch.team ?? null, at: Number(remote.lastTouch.at) || 0 } : null;
		state.serveAt = Number(remote.serveAt) || 0;
		state.serves = Number(remote.serves) || 0;
		state.goals = Number(remote.goals) || 0;
		state.playerGoals = { ...(remote.playerGoals ?? {}) };
		state.outcome = remote.outcome ? { winner: String(remote.outcome.winner), reason: String(remote.outcome.reason ?? '') } : null;
		lastOpLocal = true;
		emit('state');
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
		emit('reset');
	}

	// ---- the tick --------------------------------------------------------------------------

	let lastSweep = 0;
	/** @param {number} t seconds */
	function tick(t) {
		// a vanished peer frees its slot (DEVX #15 — the roster is on the api now)
		if (t - lastSweep > 1) {
			lastSweep = t;
			const { slots, freed } = freeVanished(state.slots, liveIds());
			if (freed.length) {
				state.slots = slots;
				emit('slots');
			}
		}
		if (!isAuthority()) return;
		if (state.started && state.serveAt && now() >= state.serveAt) serve('auto');
		watchGoals();
		watchRest(t);
		watchEnd();
	}

	// ---- reads for the nodes, the HUD and the toolbox --------------------------------------

	function outcomeWinnerName() {
		const o = state.outcome;
		if (!o) return '';
		if (o.winner === 'red' || o.winner === 'blue' || o.winner === 'draw') return o.winner;
		return nameOf(o.winner);
	}
	function outcomeText() {
		const o = state.outcome;
		if (!o) return '';
		const who = o.winner === 'draw' ? 'Draw' : o.winner === 'red' ? 'RED wins' : o.winner === 'blue' ? 'BLUE wins' : nameOf(o.winner) + ' wins';
		return who + (o.reason === 'time' ? " — time's up" : '') + ' · ' + scoreLine(state.score);
	}
	/** every player on the sheet: slotted peers plus anyone holding a row */
	function sheetRows() {
		const rows = api.peerVars?.all ? api.peerVars.all('goals') : [];
		const byId = new Map(rows.map((r) => [r.id, r]));
		const ids = new Set([...state.slots.red, ...state.slots.blue, ...rows.map((r) => r.id)]);
		const read = (/** @type {string} */ id, /** @type {string} */ name) =>
			id === me() ? api.peerVars?.mine?.(name, 0) ?? 0 : (api.peerVars?.all?.(name) ?? []).find((r) => r.id === id)?.value ?? 0;
		return [...ids].map((id) => ({
			id,
			name: byId.get(id)?.name || nameOf(id),
			team: teamOf(state.slots, id),
			goals: read(id, 'goals'),
			touches: read(id, 'touches'),
			owngoals: read(id, 'owngoals'),
			me: id === me()
		}));
	}
	const left = () => (state.started ? secondsLeft(rules(), now() - state.startedAt) : null);

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
		onChange: (/** @type {(what: string, data?: any) => void} */ fn) => {
			listeners.add(fn);
			return () => listeners.delete(fn);
		}
	};
}
