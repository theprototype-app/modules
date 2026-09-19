// health — THE LEDGER, pure. Every number a peer shows is derived here from replicated
// inputs, so two peers holding the same inputs show the same number by construction.
//
// TWO OWNERSHIP MODELS, fork 2 of roadmap 29 (locked):
//   object   hp = max - hits + heals, where `hits`/`heals` are core COUNTER values fed by
//            damage/heal pulses. A pulse is a trigger-log entry `(node id, stamp)` applied
//            exactly once per peer, and the count travels WITH the stamp in the DEVX #18
//            handshake, so a late joiner reads the same number. Nobody is an authority.
//   player   my own hit points ride my own peerVars row (ONE writer per row): the row
//            holds the hp base at a stamp, and regen is a pure function of (base, stamp,
//            now) — nothing is sent on a timer.
//
// What this file does NOT know: nodes, peers, the clock. It is the part a node test can
// break on purpose.

/** the health node's defaults, shared by the node spec and the toolbox form */
export const DEFAULTS = Object.freeze({
	name: 'hp',
	scope: 'object',
	max: 5,
	regen: 0,
	deathAction: 'hide',
	respawnDelay: 3
});

export const SCOPES = ['object', 'player'];
export const DEATH_ACTIONS = ['hide', 'respawn', 'nothing'];
export const DAMAGE_SOURCES = ['wired', 'click', 'touch', 'zone', 'hit'];
export const SCALES = ['none', 'speed'];
/** the most pulses one event may fire — the spawner's per-fire cap, same reasoning */
export const MAX_PULSES = 20;
/** the synced clock is seconds of day; a stamp this far "in the future" wrapped midnight */
const HALF_DAY = 43200;
const DAY = 86400;

/** @param {any} n @param {number} lo @param {number} hi @param {number} fallback */
export function clamp(n, lo, hi, fallback = lo) {
	const v = Number(n);
	if (!Number.isFinite(v)) return fallback;
	return Math.min(hi, Math.max(lo, v));
}

/** `later - earlier` on the seconds-of-day clock, midnight-safe. @param {number} later @param {number} earlier */
export function elapsed(later, earlier) {
	let d = later - earlier;
	if (d < -HALF_DAY) d += DAY;
	return d;
}

/**
 * An OBJECT's health from its counters. Heals count 1:1 against hits: a heal past full
 * is REMEMBERED (a shield), because a count-only ledger cannot tell a heal that landed
 * at full from one that did not — the plan's "negative stamp", stated honestly.
 * @param {{max: any, hits: any, heals?: any}} input
 * @returns {{hp: number, dead: boolean}}
 */
export function objectHp({ max, hits, heals }) {
	const cap = clamp(max, 1, 1e6, DEFAULTS.max);
	const taken = Math.max(0, (Number(hits) || 0) - (Number(heals) || 0));
	const hp = clamp(cap - taken, 0, cap, cap);
	return { hp, dead: hp <= 0 };
}

/**
 * A PLAYER's health from their row: `base` is the hp written at `at`, and regen has
 * been ticking since — read at `now`, never stored. A missing row (`base === null`) is a
 * player nobody has hurt yet: full. A base of 0 is DEAD, and the dead do not regenerate;
 * a respawn writes a fresh base.
 * @param {{max: any, regen?: any, base: number|null|undefined, at?: number|null, now: number}} input
 * @returns {{hp: number, dead: boolean}}
 */
export function playerHp({ max, regen, base, at, now }) {
	const cap = clamp(max, 1, 1e6, DEFAULTS.max);
	if (base === null || base === undefined || !Number.isFinite(Number(base))) return { hp: cap, dead: false };
	const held = clamp(base, 0, cap, cap);
	if (held <= 0) return { hp: 0, dead: true };
	const rate = clamp(regen, 0, 1e6, 0);
	const since = typeof at === 'number' ? Math.max(0, elapsed(now, at)) : 0;
	const hp = Math.min(cap, held + rate * since);
	return { hp, dead: false };
}

/**
 * The next row after `delta` hit points land (negative = damage) on a player, on top of
 * whatever regen had restored by `now`. The regen'd value is folded into the new base,
 * which is what makes the stored pair `{base, at}` exact without a heal log.
 * @param {{max: any, regen?: any, base: number|null|undefined, at?: number|null, now: number}} row
 * @param {number} delta
 * @returns {{base: number, at: number}}
 */
export function applyDelta(row, delta) {
	const cap = clamp(row.max, 1, 1e6, DEFAULTS.max);
	const { hp } = playerHp(row);
	return { base: clamp(hp + (Number(delta) || 0), 0, cap, cap), at: row.now };
}

/**
 * How many pulses one event fires. `amount` is hit points per event; `scale: 'speed'`
 * multiplies by how hard the hit was relative to `speedRef` (a knock at twice the
 * reference does double), floored at one point so a hit is never free.
 * @param {{amount: any, scale?: string, speed?: any, speedRef?: any}} input
 */
export function pulsesFor({ amount, scale, speed, speedRef }) {
	const base = clamp(amount, 0, MAX_PULSES, 1);
	if (base <= 0) return 0;
	if (scale !== 'speed') return Math.round(base);
	const ref = clamp(speedRef, 0.1, 1e3, 3);
	const factor = clamp(Number(speed) / ref, 0, 3, 1);
	return Math.max(1, Math.min(MAX_PULSES, Math.round(base * factor)));
}

/** 0..1 for a HUD Bar. @param {number} hp @param {number} max */
export function fraction(hp, max) {
	const cap = clamp(max, 1, 1e6, DEFAULTS.max);
	return clamp(hp / cap, 0, 1, 0);
}

/**
 * Has the respawn moment passed? `deadAt` is the killing pulse's stamp (replicated, so
 * every peer computes the same moment), `delay` the node's seconds.
 * @param {number|null|undefined} deadAt @param {any} delay @param {number} now
 */
export function respawnDue(deadAt, delay, now) {
	if (typeof deadAt !== 'number') return false;
	return elapsed(now, deadAt) >= clamp(delay, 0, 3600, DEFAULTS.respawnDelay);
}
