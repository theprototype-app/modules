// waves — THE CURVE, pure. Which enemies a wave uses, how many kills each needs, which
// wave the counters say we are in, and where an enemy stands at a given time. Every peer
// holds the same counters and the same clock, so every peer derives the same wave and
// the same positions — nothing about a wave is ever sent.
//
// THE LEDGER TRICK. An enemy is a pre-placed object with a health chain (the health
// module's Counter of hits). Its hits never reset between waves: at the start of each
// wave every peer heals it back to full with LOCAL heal pulses, so its counter reads
// `hp × kills`. Wave n is complete when every enemy it uses has been killed once per wave
// it appeared in. That is a pure function of the hit counters, which travel with their
// stamps in the trigger-log handshake — so a late joiner lands on the same wave.

export const DEFAULTS = Object.freeze({
	name: 'enemy',
	waves: 3,
	sizeStart: 2,
	sizeStep: 1,
	interval: 3,
	speed: 1.5,
	stagger: 0.6,
	reach: 1.5
});

/** @param {any} n @param {number} lo @param {number} hi @param {number} fallback */
export function clamp(n, lo, hi, fallback = lo) {
	const v = Number(n);
	if (!Number.isFinite(v)) return fallback;
	return Math.min(hi, Math.max(lo, v));
}

/** @typedef {{waves: number, sizeStart: number, sizeStep: number, enemies: number}} Curve */

/** the curve's numbers, clamped @param {any} data @param {number} enemies @returns {Curve} */
export function curveOf(data, enemies) {
	return {
		waves: Math.round(clamp(data?.waves, 1, 50, DEFAULTS.waves)),
		sizeStart: Math.round(clamp(data?.sizeStart, 1, 200, DEFAULTS.sizeStart)),
		sizeStep: Math.round(clamp(data?.sizeStep, 0, 50, DEFAULTS.sizeStep)),
		enemies: Math.max(0, Math.round(Number(enemies) || 0))
	};
}

/** how many enemies wave `n` (1-based) uses — never more than there are @param {number} n @param {Curve} c */
export function sizeOf(n, c) {
	if (n < 1) return 0;
	return Math.min(c.enemies, c.sizeStart + c.sizeStep * (n - 1));
}

/** the first wave enemy `i` (0-based) appears in, or null if it never does @param {number} i @param {Curve} c */
export function firstWaveOf(i, c) {
	for (let n = 1; n <= c.waves; n++) if (i < sizeOf(n, c)) return n;
	return null;
}

/** kills enemy `i` must have taken for wave `n` to be complete @param {number} i @param {number} n @param {Curve} c */
export function killsNeeded(i, n, c) {
	const first = firstWaveOf(i, c);
	if (first === null || n < first) return 0;
	return n - first + 1;
}

/** kills from a hit counter: the overkill guard makes `hits` a multiple of `hp`, and the
 * floor keeps a stray extra hit from counting as a life @param {number} hits @param {number} hp */
export function killsOf(hits, hp) {
	const max = clamp(hp, 1, 1e6, 1);
	return Math.floor(Math.max(0, Number(hits) || 0) / max);
}

/** is wave `n` complete on these kills? @param {number} n @param {number[]} kills @param {Curve} c */
export function waveComplete(n, kills, c) {
	const size = sizeOf(n, c);
	if (size <= 0) return false;
	for (let i = 0; i < size; i++) if ((kills[i] ?? 0) < killsNeeded(i, n, c)) return false;
	return true;
}

/**
 * THE WAVE, derived: how many waves are complete, which one is on, and whether the
 * run is over. `wave` stays at the last wave once everything is dead (`done`).
 * @param {number[]} kills per enemy @param {Curve} c
 * @returns {{completed: number, wave: number, done: boolean}}
 */
export function waveOf(kills, c) {
	let completed = 0;
	while (completed < c.waves && waveComplete(completed + 1, kills, c)) completed++;
	const done = completed >= c.waves;
	return { completed, wave: done ? c.waves : completed + 1, done };
}

/** the enemies alive in wave `n`: used by it and not yet killed for it @param {number} n @param {number[]} kills @param {Curve} c */
export function aliveIn(n, kills, c) {
	/** @type {number[]} */
	const out = [];
	for (let i = 0; i < sizeOf(n, c); i++) if ((kills[i] ?? 0) < killsNeeded(i, n, c)) out.push(i);
	return out;
}

/** the enemies wave `n` uses (alive or not) @param {number} n @param {Curve} c */
export function usedIn(n, c) {
	/** @type {number[]} */
	const out = [];
	for (let i = 0; i < sizeOf(n, c); i++) out.push(i);
	return out;
}

/** how many full heals enemy `i` should have received before wave `n` starts — one per
 * earlier wave it was killed in @param {number} i @param {number} n @param {Curve} c */
export function healsBefore(i, n, c) {
	const first = firstWaveOf(i, c);
	if (first === null || n <= first) return 0;
	return n - first;
}

/**
 * 30b: THE ENEMY KINDS, read off the object's NAME (a pure rule every peer applies to the
 * same replicated name): a Runner is fast and light, a Tank slow and heavy, anything else a
 * Grunt. `speed` scales the walk, `knock` is how far one hit shoves it back (metres), `points`
 * what a kill scores.
 */
export const KINDS = Object.freeze({
	grunt: Object.freeze({ speed: 1, knock: 0.55, points: 100 }),
	runner: Object.freeze({ speed: 1.8, knock: 0.8, points: 150 }),
	tank: Object.freeze({ speed: 0.6, knock: 0.16, points: 400 })
});
/** @param {any} label @returns {'grunt' | 'runner' | 'tank'} */
export function kindOf(label) {
	const s = String(label ?? '');
	if (/runner/i.test(s)) return 'runner';
	if (/tank/i.test(s)) return 'tank';
	return 'grunt';
}

/**
 * Where enemy `index` of a wave stands: it leaves `start` `stagger × index` seconds after
 * the wave starts and walks straight to `goal` at `speed`, then stays. Pure in (data,
 * time), so every peer places it identically with nothing sent.
 * 30b: `setback` metres (the knockback its hits bought, itself a pure function of the hit
 * counter) are taken off how far it has come — never behind its start, never past the goal.
 * @param {{start: number[], goal: number[], waveStart: number, index: number, now: number, speed: any, stagger: any, setback?: number}} p
 * @returns {number[]}
 */
export function enemyPosition(p) {
	const speed = clamp(p.speed, 0.01, 100, DEFAULTS.speed);
	const stagger = clamp(p.stagger, 0, 60, DEFAULTS.stagger);
	const t = p.now - p.waveStart - stagger * p.index;
	if (!(t > 0)) return p.start.slice();
	const dx = p.goal[0] - p.start[0];
	const dz = p.goal[2] - p.start[2];
	const dist = Math.hypot(dx, dz);
	if (dist < 1e-6) return p.start.slice();
	const along = Math.min(dist, Math.max(0, t * speed - Math.max(0, Number(p.setback) || 0)));
	const f = along / dist;
	return [p.start[0] + dx * f, p.start[1], p.start[2] + dz * f];
}

/** 30b: the knockback an enemy's hits in THIS life buy: every hit since its last heal shoves
 * it `knock` metres back along its lane @param {number} hits @param {number} heals @param {number} max @param {number} knock */
export function setbackOf(hits, heals, max, knock) {
	const taken = Math.max(0, Math.min(max, (Number(hits) || 0) - (Number(heals) || 0)));
	return taken * Math.max(0, Number(knock) || 0);
}

/** distance on the ground plane @param {number[]} a @param {number[]} b */
export function groundDistance(a, b) {
	return Math.hypot(a[0] - b[0], a[2] - b[2]);
}

/** the spawn point for enemy `i`: points cycle @param {number} i @param {number[][]} points @param {number[]} fallback */
export function spawnFor(i, points, fallback) {
	if (!points.length) return fallback.slice();
	return points[i % points.length].slice();
}

/** the match-log entry for a finished (or abandoned) run — deterministic from replicated
 * inputs so every peer appends the same object @param {{at: number, waves: number, reached: number, cleared: boolean, rows: {name: string, kills: number}[]}} r */
export function runEntry(r) {
	return {
		at: r.at,
		// 30: the round's stamp, the entry's identity when known (absent on an old entry)
		...(typeof r.round === 'number' ? { round: r.round } : {}),
		waves: r.waves,
		reached: r.reached,
		cleared: !!r.cleared,
		players: r.rows.map((x) => ({ name: String(x.name ?? ''), kills: Number(x.kills) || 0 })).sort((a, b) => b.kills - a.kills || a.name.localeCompare(b.name))
	};
}

/** append idempotently, capped, newest last: an entry of the same ROUND (or, for entries with
 * no round, the same `at`) is the same run and is replaced
 * @param {any} log @param {ReturnType<typeof runEntry>} entry @param {number} cap */
export function appendRun(log, entry, cap = 50) {
	const same = (/** @type {any} */ e) => (typeof entry.round === 'number' && e.round === entry.round) || e.at === entry.at;
	const list = Array.isArray(log) ? log.filter((e) => e && !same(e)) : [];
	list.push(entry);
	return list.slice(-cap);
}
