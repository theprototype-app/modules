// navigation — THE NPC BRAIN (G5): senses + states, a PURE step function (no three, no app).
//
//   idle ── (has a Path) ──▶ patrol
//   idle / patrol ── hears a noise ──▶ alert (turns toward it for `alert` s, then walks there)
//   any calm state ── sees a player in its cone (range + line of sight) ──▶ chase
//   chase ── within attack range and still seen ──▶ attack (an "attack" every `every` s)
//   chase ── lost the player for `giveUp` s, or they got `chase` m away ──▶ return (give up)
//   return ── back on its Path / home spot ──▶ patrol (or idle)
//
// Only the AUTHORITY peer runs it (the main half), ~10 times a second. Everything it reads is handed
// in (`see` = a line-of-sight test the caller does with three's raycaster) and everything it decides
// comes back as data: where to go (`goal`), how fast, which way to look, the events to fire and the
// debug label ("chase: target lost 2 s"). A test drives it with plain numbers.

export const NPC_DEFAULTS = Object.freeze({
	/** sight cone, full angle in degrees (360 = eyes in the back of its head) */
	sightAngle: 100,
	/** how far it sees, m */
	sightRange: 12,
	/** how far a normal noise (loudness 1) is heard, m; a louder noise reaches further */
	hearing: 6,
	/** it gives up when the player is further than this, m */
	chaseRange: 25,
	/** it attacks closer than this, m */
	attackRange: 1.6,
	/** s between attacks */
	attackEvery: 1,
	/** s it looks toward a noise before going to see */
	alert: 1.5,
	/** s without seeing (or hearing) the player before it gives up */
	giveUp: 4,
	/** walking speed (return, search, a guard with no Path), m/s */
	speed: 1.6,
	/** chase speed, m/s */
	run: 3.6,
	/** eye height above its feet, m */
	eye: 1.6,
	/** players closer than this are felt even outside the cone, m */
	touch: 1.2
});

const CLAMP = {
	sightAngle: [10, 360],
	sightRange: [0.5, 100],
	hearing: [0, 100],
	chaseRange: [1, 300],
	attackRange: [0.3, 20],
	attackEvery: [0.1, 30],
	alert: [0, 30],
	giveUp: [0.2, 120],
	speed: [0.1, 15],
	run: [0.1, 20],
	eye: [0.1, 5],
	touch: [0, 5]
};

/** clamp every tunable; unknown keys dropped @param {any} raw @returns {typeof NPC_DEFAULTS} */
export function normalizeNpc(raw) {
	/** @type {any} */
	const out = { ...NPC_DEFAULTS };
	for (const k of Object.keys(NPC_DEFAULTS)) {
		const v = Number(raw?.[k]);
		if (raw?.[k] !== undefined && raw?.[k] !== '' && Number.isFinite(v)) out[k] = Math.min(CLAMP[k][1], Math.max(CLAMP[k][0], v));
	}
	return out;
}

/** the states, in the order the debug view colours them */
export const STATES = ['idle', 'patrol', 'alert', 'chase', 'attack', 'return'];
/** the events a brain fires (On NPC Event's choices; `unreachable` / `arrived` come from the mover) */
export const BRAIN_EVENTS = ['spotted', 'heard', 'attack', 'lost', 'gaveup', 'returned'];

const dxz = (/** @type {number[]} */ a, /** @type {number[]} */ b) => Math.hypot(a[0] - b[0], a[2] - b[2]);
/** the longest an alert search may run, s (a noise across a big map) */
const ALERT_CAP = 60;

/** is `p` inside the cone of a viewer at `from` facing `yaw`? An NPC's front is its +Z axis (three's
 * Object3D.lookAt convention, and what glTF / VRM / Mixamo characters face), so yaw 0 looks along +Z.
 * @param {number[]} from @param {number} yaw @param {number[]} p @param {number} angleDeg @param {number} range */
export function inCone(from, yaw, p, angleDeg, range) {
	const d = dxz(from, p);
	if (d > range) return false;
	if (angleDeg >= 360 || d < 1e-6) return true;
	// facing vector of rotation.y = yaw: (sin yaw, cos yaw)
	const fx = Math.sin(yaw);
	const fz = Math.cos(yaw);
	const cos = ((p[0] - from[0]) * fx + (p[2] - from[2]) * fz) / d;
	return cos >= Math.cos(((angleDeg / 2) * Math.PI) / 180);
}

/** the yaw (rotation.y) that faces from `a` toward `b` @param {number[]} a @param {number[]} b */
export function yawToward(a, b) {
	return Math.atan2(b[0] - a[0], b[2] - a[2]);
}

/** a fresh brain @param {number[]} home @param {number} yaw */
export function newBrain(home, yaw = 0) {
	return {
		state: 'idle',
		since: 0,
		home: [...home],
		homeYaw: yaw,
		/** the player being chased (id) */
		target: /** @type {string | null} */ (null),
		/** where the target was last seen / heard */
		lastPos: /** @type {number[] | null} */ (null),
		lastSeen: -Infinity,
		lastAttack: -Infinity,
		/** where a noise came from (alert) */
		noise: /** @type {number[] | null} */ (null),
		/** when it reached the noise and started looking around (-Infinity = not yet) */
		searchAt: -Infinity,
		label: 'idle'
	};
}

/**
 * One think. Mutates `b` and returns what to do.
 * @param {ReturnType<typeof newBrain>} b
 * @param {{
 *   now: number, pos: number[], yaw: number, p: typeof NPC_DEFAULTS,
 *   players: {id: string, pos: number[]}[],
 *   see: (from: number[], to: number[]) => boolean,
 *   noises: {pos: number[], loudness: number}[],
 *   patrol: number[] | null,
 *   reach?: {ok: boolean, why: string} | null
 * }} w `patrol` = where its Path says it should be now (null = no Path: guard the home spot);
 *   `players[].pos` = FEET; `reach` = the mover's verdict on the current goal
 * @returns {{state: string, goal: number[] | null, speed: number, face: number[] | null, events: {name: string, player?: string}[], label: string}}
 */
export function think(b, w) {
	const { now, pos, yaw, p } = w;
	/** @type {{name: string, player?: string}[]} */
	const events = [];
	const enter = (/** @type {string} */ s) => {
		if (b.state !== s) {
			b.state = s;
			b.since = now;
		}
	};
	const eye = [pos[0], pos[1] + p.eye, pos[2]];
	// --- senses --------------------------------------------------------------------------------
	/** @type {{id: string, pos: number[], d: number} | null} */
	let seen = null;
	for (const pl of w.players) {
		const d = dxz(pos, pl.pos);
		const close = d <= p.touch && Math.abs(pl.pos[1] - pos[1]) < 2;
		const cone = close || inCone(pos, yaw, pl.pos, p.sightAngle, p.sightRange);
		if (!cone) continue;
		const chest = [pl.pos[0], pl.pos[1] + 1.2, pl.pos[2]];
		if (!close && !w.see(eye, chest)) continue;
		// keep chasing the one we chase; otherwise the nearest
		if (!seen || pl.id === b.target || (seen.id !== b.target && d < seen.d)) seen = { id: pl.id, pos: pl.pos, d };
	}
	/** @type {{pos: number[], loudness: number} | null} */
	let heard = null;
	for (const n of w.noises) {
		const reach = p.hearing * Math.max(0, n.loudness);
		if (reach > 0 && dxz(pos, n.pos) <= reach && (!heard || n.loudness > heard.loudness)) heard = n;
	}
	const calm = b.state === 'idle' || b.state === 'patrol' || b.state === 'return' || b.state === 'alert';
	// --- transitions -------------------------------------------------------------------------
	if (seen) {
		if (calm || b.target !== seen.id) {
			if (calm) events.push({ name: 'spotted', player: seen.id });
			b.target = seen.id;
		}
		b.lastPos = [...seen.pos];
		b.lastSeen = now;
		// attack range is a reach: the target must be about level with it (not on a ledge above)
		const level = Math.abs(seen.pos[1] - pos[1]) <= 1.2;
		if (seen.d <= p.attackRange && level) enter('attack');
		else if (b.state !== 'attack' || seen.d > p.attackRange * 1.25 || !level) enter('chase');
	} else if (heard && calm) {
		if (b.state !== 'alert' || !b.noise || dxz(b.noise, heard.pos) > 1) {
			events.push({ name: 'heard' });
			b.searchAt = -Infinity;
		}
		b.noise = [...heard.pos];
		enter('alert');
	} else if (heard && (b.state === 'chase' || b.state === 'attack')) {
		// a noise while hunting refreshes where to look, not the "seen" clock
		b.lastPos = [...heard.pos];
	}
	if (b.state === 'attack' && !seen) enter('chase');
	if (b.state === 'chase') {
		const lostFor = now - b.lastSeen;
		const far = b.target && w.players.find((pl) => pl.id === b.target);
		const tooFar = far ? dxz(pos, far.pos) > p.chaseRange : false;
		if (lostFor >= p.giveUp || tooFar || !far) {
			events.push({ name: 'lost', player: b.target ?? undefined });
			events.push({ name: 'gaveup', player: b.target ?? undefined });
			b.target = null;
			enter('return');
		}
	}
	// a search that can never end (a noise it cannot walk to, a path round the whole map) gives up
	if (b.state === 'alert' && (now - b.since > ALERT_CAP || (w.reach && !w.reach.ok && now - b.since > p.alert + p.giveUp))) enter('return');
	// --- what to do ----------------------------------------------------------------------------
	const home = w.patrol ?? b.home;
	let goal = /** @type {number[] | null} */ (null);
	let speed = p.speed;
	let face = /** @type {number[] | null} */ (null);
	let label = b.state;
	switch (b.state) {
		case 'idle':
		case 'patrol': {
			if (w.patrol) enter('patrol');
			else enter('idle');
			goal = home;
			label = b.state === 'patrol' ? 'patrol' : 'idle: guarding';
			// back at its post a guard turns to the way it was set to watch
			if (b.state === 'idle' && dxz(pos, home) < 0.7) face = [home[0] + Math.sin(b.homeYaw) * 5, home[1], home[2] + Math.cos(b.homeYaw) * 5];
			break;
		}
		case 'alert': {
			const waited = now - b.since;
			face = b.noise;
			if (waited < p.alert) {
				goal = null;
				label = 'alert: heard a noise';
			} else {
				goal = b.noise;
				label = 'alert: going to look';
				// there: look around for giveUp s, then walk back
				if (b.noise && dxz(pos, b.noise) < 1.2) {
					if (!Number.isFinite(b.searchAt)) b.searchAt = now;
					goal = null;
					label = 'alert: looking around';
					if (now - b.searchAt >= p.giveUp) {
						events.push({ name: 'gaveup' });
						enter('return');
						goal = home;
					}
				}
			}
			break;
		}
		case 'chase': {
			speed = p.run;
			const lostFor = now - b.lastSeen;
			goal = b.lastPos;
			label = lostFor > 0.3 ? 'chase: target lost ' + Math.floor(lostFor) + ' s' : 'chase';
			break;
		}
		case 'attack': {
			goal = null;
			face = b.lastPos;
			label = 'attack';
			if (now - b.lastAttack >= p.attackEvery) {
				b.lastAttack = now;
				events.push({ name: 'attack', player: b.target ?? undefined });
			}
			break;
		}
		case 'return': {
			goal = home;
			label = 'give up: returning';
			if (dxz(pos, home) < 0.7) {
				events.push({ name: 'returned' });
				enter(w.patrol ? 'patrol' : 'idle');
				label = b.state;
			}
			break;
		}
	}
	if (w.reach && !w.reach.ok && goal) label += ' (can\'t reach: ' + w.reach.why + ')';
	b.label = label;
	return { state: b.state, goal, speed, face, events, label };
}
