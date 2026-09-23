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
	scoreLine,
	balancedTeam,
	CELEBRATE_SECONDS,
	goldenGoal,
	matchPhase,
	countdownNumber,
	startKickTeam,
	kickoffImpulse,
	playedSeconds,
	bannerScore,
	teamSpawn
} from './rules.js';
import { createFx } from './fx.js';
import { DEDUPE_MS, MAX_KICK_SPEED } from './kick.js';

export const MODULE_ID = 'football';
/** gameState.vars key the saved sheet lives under (B5) */
export const LOG_VAR = 'football';
/** 30b: the team colours as CSS, for banners and confetti */
export const TEAM_CSS = { red: '#e0524f', blue: '#4f86e6' };

/** @param {any} api */
export function createGame(api) {
	const THREE = api.THREE;
	const fx = createFx(api);

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
		// 30b: the match flow (rules.js matchPhase) — all derived from op stamps
		/** a goal's celebration runs until this synced second (0 = none) */
		celebrateUntil: 0,
		/** the gate (sensor uuid) the last goal went into — the ball rests there */
		goalGate: '',
		/** @type {'red'|'blue'} who takes the next kick-off */
		kickTeam: /** @type {'red'|'blue'} */ ('red'),
		/** seconds played before the current live stretch; the clock stops between them */
		clockBase: 0,
		/** when the current live stretch began (0 = the clock is stopped) */
		liveSince: 0,
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
		// 30b: a match opens on the kick-off countdown; the clock starts at the kick-off
		state.serveAt = at + rules().serveDelay;
		state.celebrateUntil = 0;
		state.goalGate = '';
		state.kickTeam = startKickTeam(at);
		state.clockBase = 0;
		state.liveSince = 0;
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
		state.celebrateUntil = 0;
		state.goalGate = '';
		state.clockBase = 0;
		state.liveSince = 0;
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
		// 30b: the clock stops, the ball rests in the net, then the CONCEDING team kicks off
		if (state.liveSince) state.clockBase += Math.max(0, at - state.liveSince);
		state.liveSince = 0;
		state.celebrateUntil = at + CELEBRATE_SECONDS;
		state.goalGate = String(data.gate ?? '');
		state.kickTeam = data.gateTeam === 'blue' ? 'blue' : 'red';
		state.serveAt = rules().serve === 'auto' ? state.celebrateUntil + rules().serveDelay : 0;
		const gate = api.objectsGroup()?.getObjectByProperty('uuid', data.gate);
		const where = gate ? gate.getWorldPosition(new THREE.Vector3()).toArray() : undefined;
		presentGoal(a, where);
		emit('goal', a);
		fireEvent('goal');
		if (a.counts && a.team) fireEvent(a.team + 'goal');
		return true;
	}

	/** @param {{at: number, dir?: number[]}} data */
	function applyServeOp(data) {
		const at = stamp(data);
		state.serves++;
		state.serveAt = 0;
		state.lastTouch = null;
		// 30b: a kick-off starts the clock again (a rest re-serve mid-play leaves it running)
		if (state.started && !state.liveSince) state.liveSince = at;
		if (state.started && data.why !== 'rest') {
			fx.sound('whistle', ballWorld());
			fx.announce('GO!', { ms: 700, color: TEAM_CSS[state.kickTeam] });
		}
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
		state.celebrateUntil = 0;
		if (state.liveSince) state.clockBase += Math.max(0, at - state.liveSince);
		state.liveSince = 0;
		state.outcome = { winner: String(data.winner ?? 'draw'), reason: String(data.reason ?? '') };
		presentOver();
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

	/** 30b: this viewer chose to watch — never auto-seated (LOCAL, like the choice itself) */
	let spectating = false;

	/** 30b: the half THIS player stands in — the tie-break when auto-balancing @returns {'red'|'blue'} */
	function myHalf() {
		const p = typeof api.playerPosition === 'function' ? api.playerPosition() : null;
		const red = gateLocal('red');
		const blue = gateLocal('blue');
		if (!p || !red || !blue) return 'red';
		const d = (/** @type {number[]} */ g) => Math.hypot(p[0] - g[0], p[2] - g[2]);
		return d(red) <= d(blue) ? 'red' : 'blue';
	}

	/** 30b: seat this player on the smaller team when they have no seat and did not choose to
	 * watch — pressing Start or touching the ball is enough to play (no "Join" needed).
	 * @returns {boolean} whether a seat was taken */
	function autoJoin() {
		const mode = rules().mode;
		if (spectating || mode === 'freeforall' || mode === 'practice') return false;
		if (teamOf(state.slots, me())) return false;
		const team = balancedTeam(state.slots, myHalf());
		if (!canJoin(state.slots, team, me(), mode).ok) return false;
		const data = { op: 'slot', team, peerId: me(), name: nameOf(me()), at: now() };
		applySlotOp(data);
		api.send(data);
		return true;
	}

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
				spectating = team === 'none';
				const data = { op: 'slot', team, peerId: me(), name: nameOf(me()), at };
				applySlotOp(data);
				api.send(data);
				return true;
			}
			case 'start': {
				if (state.started) return false;
				autoJoin();
				const data = { op: 'start', at: now() };
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
			case 'rematch': {
				// 30b: the results panel's Rematch — same sides, straight to the kick-off
				act('new-match');
				return act('start');
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

	/** a top-level object's position in the OBJECTS GROUP's frame (the physics frame) @param {string} uuid */
	function localPos(uuid) {
		const o = uuid ? api.objectsGroup()?.getObjectByProperty('uuid', uuid) : null;
		return o ? o.position.toArray() : null;
	}
	/** the gate sensor a team defends, local frame @param {'red'|'blue'} team */
	function gateLocal(team) {
		const uuid = Object.keys(config.gates).find((u) => config.gates[u].team === team);
		return uuid ? localPos(uuid) : null;
	}
	/** 30b: the centre spot at mouth height — where every kick-off starts (local frame) */
	function kickoffSpot() {
		const red = gateLocal('red');
		const blue = gateLocal('blue');
		if (!red || !blue) return null;
		return [(red[0] + blue[0]) / 2, (red[1] + blue[1]) / 2, (red[2] + blue[2]) / 2];
	}
	/** the ball's WORLD position (sounds, confetti) */
	function ballWorld() {
		const o = ball();
		return o ? o.getWorldPosition(new THREE.Vector3()).toArray() : undefined;
	}

	/**
	 * 30b: the authority PLACES the ball (a celebration in the net, the centre spot for a
	 * kick-off). On the peer stepping the world a pose written from outside is an EXTERNAL
	 * hold (core physics' deviation rule): the body goes kinematic, stays where it was put,
	 * and 250 ms after the last write drops back to dynamic at rest. Re-placed only when it
	 * drifted (a hand knocked it during the countdown), so a resting ball costs no message.
	 * Only while a simulation runs: in Edit the ball is the gizmo's.
	 * @param {number[]} spot @returns {boolean} whether a move was sent
	 */
	function placeBall(spot) {
		const o = ball();
		if (!o || !spot || !api.physics?.running?.()) return false;
		const p = o.position;
		if (Math.hypot(p.x - spot[0], p.y - spot[1], p.z - spot[2]) < 0.02) return false;
		api.moveObject?.(o.uuid, { pos: spot, rot: [0, 0, 0] });
		return true;
	}

	/** a kick-off nudge the physics refused (the ball was still held): retried until then
	 * @type {{impulse: number[], after: number, until: number} | null} */
	let pendingNudge = null;

	/** @param {'auto'|'button'|'rest'|'kickoff'} why */
	function serve(why) {
		if (!isAuthority()) return false;
		const object = ball();
		if (!object) return false;
		const at = now();
		const mass = Number(object.userData?.physics?.mass) || 1;
		const r = rules();
		let pushed = false;
		if (why === 'rest') {
			// a ball stuck mid-play drifts back toward the centre (never a kick-off)
			const centre = pitchCentre();
			centre[1] = object.position.y;
			pushed = api.physics.applyImpulse(object.uuid, serveImpulse(object.position.toArray(), centre, mass, Math.max(r.serveSpeed, 0.8), at));
		} else {
			// 30b: the KICK-OFF — from the centre spot, a slow nudge into the kicking team's half
			const red = gateLocal('red') ?? [0, 0, -1];
			const blue = gateLocal('blue') ?? [0, 0, 1];
			const moved = placeBall(kickoffSpot() ?? object.position.toArray());
			const impulse = kickoffImpulse(state.kickTeam, red, blue, mass, r.serveSpeed, at);
			// a ball just re-placed is about to go under the placement's hold, which would eat
			// an impulse given now: nudge it once the hold has let go
			pushed = !moved && api.physics.applyImpulse(object.uuid, impulse);
			const ms = performance.now();
			pendingNudge = pushed ? null : { impulse, after: moved ? ms + 350 : 0, until: ms + 1800 };
			why = why === 'button' ? 'button' : 'kickoff';
		}
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
		const live = matchPhase(state, now()) === 'live';
		for (const [uuid, gate] of Object.entries(config.gates)) {
			const sensor = group?.getObjectByProperty('uuid', uuid);
			if (!sensor) continue;
			_box.setFromObject(sensor);
			const isIn = _box.containsPoint(_pos);
			const was = !!inside[uuid];
			inside[uuid] = isIn;
			// ENTER edge only, and only while the ball is LIVE (not resting in a net after a
			// goal, not waiting on the centre spot for a kick-off)
			if (!isIn || was || !live) continue;
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
		if (!object || matchPhase(state, now()) !== 'live') {
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
		// a winning goal is celebrated first; the final whistle blows when it ends
		if (matchPhase(state, now()) === 'celebrate') return;
		const outcome = matchOutcome({ score: state.score, rules: rules(), elapsed: elapsed() ?? 0, playerGoals: state.playerGoals });
		if (!outcome) return;
		const data = { op: 'over', at: now(), ...outcome };
		applyOver(data);
		api.send(data);
		writeMatchLog();
	}

	/** 30b: the authority keeps the ball where the phase wants it */
	function driveBall() {
		const phase = matchPhase(state, now());
		if (phase === 'celebrate') placeBall(localPos(state.goalGate) ?? kickoffSpot() ?? []);
		else if (phase === 'countdown') placeBall(kickoffSpot() ?? []);
		else if (phase === 'live' && state.celebrateUntil && placedFor !== state.celebrateUntil) {
			// serve: 'button' — the celebration is over and nobody kicks off by clock: the
			// ball waits on the centre spot for the Serve button
			placedFor = state.celebrateUntil;
			if (rules().serve !== 'auto') placeBall(kickoffSpot() ?? []);
		}
		if (pendingNudge && performance.now() >= pendingNudge.after) {
			const o = ball();
			if (!o || performance.now() > pendingNudge.until || api.physics.applyImpulse(o.uuid, pendingNudge.impulse)) pendingNudge = null;
		}
	}
	let placedFor = 0;

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
		// 30b: a SOLO session stamps no peer id on its own hits (by = ''), which dropped
		// every touch of a player alone in a headset; my own hit is mine whatever it carries
		const by = String(hit.by || (hit.local ? me() : ''));
		if (!by) return;
		// 30b: every knock on the ball sounds (every peer hears it, like the hit itself), and
		// the kicker learns the hand's core hit so one swing is never two touches
		coreHitAt.set(by, performance.now());
		lastTouchPerf = performance.now();
		fx.sound('kick', ballWorld());
		if (by === me()) onCoreHitByMe();
		const team = teamOf(state.slots, by);
		// a spectator's hit moves the ball (that is physics) but attributes nothing
		state.lastTouch = { by, team, at: Number(hit.at) || now() };
		if (by === me() && state.started && api.peerVars?.setMine) api.peerVars.setMine('touches', api.peerVars.mine('touches', 0) + 1);
		emit('touch', state.lastTouch);
		if (by === me()) {
			fireEvent('touch');
			if (hit.local !== false) touchedByMe();
		}
	}

	/** @type {Map<string, number>} peer id -> its last core knock on the ball (performance.now) */
	const coreHitAt = new Map();
	/** performance.now of the ball's last touch of any kind (the bounce sound waits it out) */
	let lastTouchPerf = -Infinity;
	/** the kicker's hook (index.js wires it) */
	let onCoreHitByMe = () => {};

	/**
	 * 30b: a KICK — a controller tip swung through the ball, or a click on it (kicker.js). Every
	 * peer applies the touch (last touch, the sound, the sheet); the physics INITIATOR alone
	 * applies the impulse (AUTHORING §4.1: authoritative), and drops one that follows the same
	 * peer's core knock within DEDUPE_MS — the kicker's own dedupe cannot see a knock the
	 * initiator logged first.
	 * @param {{uuid: string, impulse: number[], speed?: number, by?: string, at?: number, probe?: string}} data
	 * @param {boolean} local born on this peer
	 */
	function applyKick(data, local) {
		if (!config.ballUuid || data?.uuid !== config.ballUuid) return false;
		const by = String(data.by || (local ? me() : ''));
		let impulse = Array.isArray(data.impulse) ? data.impulse.slice(0, 3).map((n) => Number(n) || 0) : null;
		// never trust the sender's numbers: at most a MAX_KICK_SPEED change of the ball's speed
		const mass = Number(ball()?.userData?.physics?.mass) || 0.45;
		const size = impulse ? Math.hypot(impulse[0], impulse[1], impulse[2]) : 0;
		if (impulse && size > MAX_KICK_SPEED * mass) impulse = impulse.map((n) => (n * MAX_KICK_SPEED * mass) / size);
		if (impulse && api.physics?.isInitiator?.()) {
			const recent = coreHitAt.get(by) ?? -Infinity;
			if (local || performance.now() - recent >= DEDUPE_MS) api.physics.applyImpulse(data.uuid, impulse);
		}
		lastTouchPerf = performance.now();
		fx.sound('kick', ballWorld());
		if (!by) return true;
		state.lastTouch = { by, team: teamOf(state.slots, by), at: Number(data.at) || now() };
		if (by === me() && state.started && api.peerVars?.setMine) api.peerVars.setMine('touches', api.peerVars.mine('touches', 0) + 1);
		emit('touch', state.lastTouch);
		if (by === me() && local) {
			fireEvent('touch');
			touchedByMe();
		}
		return true;
	}

	/**
	 * 30b: MY touch in play does what a casual player expects — with no match running it
	 * KICKS ONE OFF (seating me on the smaller team first), and mid-match an unseated player
	 * is seated. "When the ball reaches the gate nothing changes" was a match nobody could
	 * start: the DOM menu does not draw in a headset, so no Start was ever pressed.
	 */
	function touchedByMe() {
		if (!localActive()) return;
		const phase = matchPhase(state, now());
		if (phase === 'menu') act('start');
		else if (state.started && !teamOf(state.slots, me())) {
			if (autoJoin()) state.lastTouch = { by: me(), team: teamOf(state.slots, me()), at: state.lastTouch?.at ?? now() };
		}
	}

	/** 30b: is THIS viewer playing — Play, Interact, or a headset outside Edit? (C1: VR Play
	 * enters Interact; a core before C1 has no VR editor mode, so a headset counts) */
	function localActive() {
		if (api.isPlaying?.()) return true;
		const mode = typeof api.editorMode === 'function' ? api.editorMode() : 'edit';
		if (mode === 'interact') return true;
		return !!api.isVR?.() && typeof api.setSpawn !== 'function';
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

	// ---- 30b: the presentation — every peer shows what every peer applied -------------------

	/** @param {import('./rules.js').Attribution} a @param {number[] | undefined} where the gate, world */
	function presentGoal(a, where) {
		if (!a.counts) {
			fx.announce('NO GOAL', { sub: a.reason === 'practice' ? 'Practice — nothing counts' : 'Own goals are ignored', ms: 1400, color: '#c8d0dc' });
			fx.sound('whistle', where);
			return;
		}
		const team = a.team;
		const colour = team ? TEAM_CSS[team] : '#ffd45e';
		let sub = bannerScore(state.score);
		if (!team && a.by) sub = nameOf(a.by) + ' — ' + (state.playerGoals[a.by] ?? 0);
		else if (a.by) sub = (a.own ? 'Own goal by ' : '') + nameOf(a.by) + ' · ' + bannerScore(state.score);
		fx.announce(a.own ? 'OWN GOAL!' : 'GOAL!', { sub, ms: 2200, color: colour, toast: true });
		fx.sound('goal', where);
		fx.sound('cheer', where);
		if (where) fx.burst(where, { kind: 'confetti', color: colour, count: 90 });
		const mine = teamOf(state.slots, me());
		if (team && mine === team) fx.haptic('success');
		else if (team && mine) fx.haptic('fail');
		else if (!team && a.by === me()) fx.haptic('success');
	}

	function presentOver() {
		const o = state.outcome;
		if (!o) return;
		const winner = o.winner;
		const colour = winner === 'red' || winner === 'blue' ? TEAM_CSS[winner] : '#ffd45e';
		const title = winner === 'draw' ? 'DRAW' : winner === 'red' ? 'RED WINS!' : winner === 'blue' ? 'BLUE WINS!' : nameOf(winner).toUpperCase() + ' WINS!';
		fx.sound('whistle', ballWorld());
		fx.announce(title, { sub: bannerScore(state.score) + (goldenPlayed ? ' · golden goal' : ''), ms: 3200, color: colour, toast: true });
		if (winner !== 'draw') fx.sound('cheer', ballWorld());
		const mine = teamOf(state.slots, me());
		if (mine && mine === winner) fx.haptic('success');
		else if (mine && winner !== 'draw') fx.haptic('fail');
		else if (winner === me()) fx.haptic('success');
	}

	/** what the countdown last showed (a key) and whether golden goal was announced */
	let shownCount = '';
	let goldenPlayed = false;
	let musicOn = false;
	/**
	 * Per frame, EVERY peer: the 3-2-1 before a kick-off and the golden-goal banner, each
	 * derived from replicated stamps (no message), and the stadium music while this viewer
	 * plays on a pitch.
	 */
	function presentTick() {
		const t = now();
		if (state.started && state.serveAt && matchPhase(state, t) === 'countdown') {
			const n = countdownNumber(state.serveAt, t);
			const key = state.serveAt + ':' + n;
			if (n > 0 && n <= 3 && key !== shownCount) {
				shownCount = key;
				const team = state.kickTeam;
				fx.announce(String(n), { sub: (team === 'red' ? 'Red' : 'Blue') + ' kicks off', ms: 800, color: TEAM_CSS[team] });
				fx.sound('click', ballWorld());
			}
		}
		const golden = state.started && goldenGoal({ score: state.score, rules: rules(), elapsed: elapsed() ?? 0, playerGoals: state.playerGoals });
		if (golden && !goldenPlayed) {
			goldenPlayed = true;
			fx.sound('whistle', ballWorld());
			fx.announce('GOLDEN GOAL', { sub: 'Level at full time — the next goal wins', ms: 2600, color: '#ffd45e', toast: true });
		}
		if (!state.started && !state.outcome) goldenPlayed = false;
		const want = !!config.ballUuid && localActive();
		const ms = performance.now();
		if (want !== musicOn) {
			musicOn = want;
			musicTry = ms;
			if (want) fx.music('stadium', { volume: 0.55 });
			else fx.stopMusic();
		} else if (want && fx.hasMusic() && fx.musicNow() !== 'stadium' && ms - musicTry > 2000) {
			// the core refused (the mode had not flipped yet) or something else took the music:
			// ask again, at most every 2 s
			musicTry = ms;
			fx.music('stadium', { volume: 0.55 });
		}
		placeSpawn();
	}
	let musicTry = 0;

	/** the spawn this peer last asked for (a key), so setSpawn runs on a CHANGE only */
	let spawnKey = '';
	/**
	 * 30b C1: entering Interact/Play puts the player on THEIR team's half, facing the gate they
	 * attack (red defends -z, so a red player starts in the red half looking +z); unseated, the
	 * blue half (the scene's own play.spawn). Feature-detected: a core before C1 has no setSpawn.
	 */
	function placeSpawn() {
		if (typeof api.setSpawn !== 'function' || !config.ballUuid) return;
		const red = gateLocal('red');
		const blue = gateLocal('blue');
		if (!red || !blue) return;
		const team = teamOf(state.slots, me()) ?? 'blue';
		const key = team + ':' + red.map((n) => n.toFixed(2)).join() + ':' + blue.map((n) => n.toFixed(2)).join();
		if (key === spawnKey) return;
		spawnKey = key;
		const { position, yaw } = teamSpawn(team, red, blue);
		fx.note('spawn', team, { position, yaw });
		api.setSpawn(position, yaw);
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
				case 'kick':
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
		// 30b: absent on an older peer's state = no celebration, red kicks off, the clock
		// derived as before (seconds since the start)
		state.celebrateUntil = Number(remote.celebrateUntil) || 0;
		state.goalGate = String(remote.goalGate ?? '');
		state.kickTeam = remote.kickTeam === 'blue' ? 'blue' : 'red';
		state.clockBase = Number(remote.clockBase) || 0;
		state.liveSince = remote.clockBase == null && remote.liveSince == null ? state.startedAt : Number(remote.liveSince) || 0;
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
		state.celebrateUntil = 0;
		state.goalGate = '';
		state.kickTeam = 'red';
		state.clockBase = 0;
		state.liveSince = 0;
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
		presentTick();
		if (!isAuthority()) return;
		if (state.started && state.serveAt && now() >= state.serveAt) serve('kickoff');
		driveBall();
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
	/** 30: seconds played — running while started, frozen at the whistle, null before. 30b:
	 * only LIVE play counts (the clock stops for a celebration and a countdown) */
	const elapsed = () => (state.started || (state.endedAt && state.startedAt) ? playedSeconds(state, now()) : null);
	const left = () => (state.started ? secondsLeft(rules(), elapsed() ?? 0) : null);
	/** 30b: is a level score past the whistle being played on? */
	const golden = () => state.started && goldenGoal({ score: state.score, rules: rules(), elapsed: elapsed() ?? 0, playerGoals: state.playerGoals });
	/** 30b: where the match stands now (menu / countdown / live / celebrate / over) */
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
		onCoreHitByMe: (/** @type {() => void} */ fn) => {
			onCoreHitByMe = fn;
		},
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
