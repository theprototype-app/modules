// waves — THE QUALITY LEVEL (31 W2): how much the figures and the effects may cost on THIS
// device right now. LOCAL, never sent, never saved in a scene (a level is a fact about a device).
//
//   0 HIGH    the figures cast shadows, the near ones at full detail, every effect
//   1 MEDIUM  no figure shadows, LOD1 from 6 m, far figures animate at half rate, fewer shards
//   2 LOW     no figure shadows, LOD1 from 3 m, every figure past 3 m animates at half rate,
//             the kill pop keeps its core + 3 shards and throws no sparks/smoke burst
//
// WHERE THE LEVEL COMES FROM (first that applies):
//   1. the player's pick in prefs (`quality`: 'high' | 'medium' | 'low'; 'auto' = the rest)
//   2. core's `api.quality` (31-perf K4, feature-detected): its level (0 best … 9) mapped
//      0 -> high, 1-2 -> medium, 3+ -> low, followed through `api.quality.onChange`
//   3. the module's OWN governor: the frame task runs inside the XR loop too (core's own
//      governor reads window rAF, which a headset session does not run), so it measures the
//      frames a Quest actually draws. Too slow for 2 s -> one step down; fast for 8 s -> one up.
// Everything the level decides is a pure function here (`budgetOf`, `stepGovernor`).

export const LEVELS = Object.freeze(['high', 'medium', 'low']);
export const QUALITY = Object.freeze(['auto', ...LEVELS]);

/** what a level buys @param {number} level 0 high … 2 low */
export function budgetOf(level) {
	const l = Math.max(0, Math.min(2, Math.round(Number(level) || 0)));
	return [
		{ level: 0, shadows: true, lodFar: 12, halfRateFrom: 16, shards: 10, burst: 1 },
		{ level: 1, shadows: false, lodFar: 6, halfRateFrom: 9, shards: 6, burst: 0.5 },
		{ level: 2, shadows: false, lodFar: 3, halfRateFrom: 3, shards: 3, burst: 0 }
	][l];
}

/** core's level (0 best … 9, 31-perf: 1 shadows off — where a headset starts —, 2 resolution
 * 85%, 3 resolution 72%, …) as ours: 0 high, 1-2 medium, 3+ (the device is losing frames even
 * at a lower resolution) low @param {any} n */
export function fromCoreLevel(n) {
	const v = Math.round(Number(n));
	if (!Number.isFinite(v) || v <= 0) return 0;
	return v <= 2 ? 1 : 2;
}

/** LOD with hysteresis: a figure at LOD1 comes back to LOD0 only 1 m inside the switch
 * @param {number} distance @param {boolean} far now at LOD1? @param {number} lodFar */
export function lodFar(distance, far, lodFar) {
	return far ? distance > lodFar - 1 : distance > lodFar;
}

/** THE GOVERNOR, pure. `frames` are the last frame times (ms, newest last), `budget` the frame
 * time the display wants (13.9 ms at 72 Hz). Too slow = the 90th percentile over budget × 1.25
 * across the last `slow` seconds; fast = under budget × 1.05 across `fast` seconds.
 * @param {{level: number, since: number}} s the level and when it last changed (seconds)
 * @param {number[]} frames @param {number} budget @param {number} now
 * @returns {{level: number, since: number}} */
export function stepGovernor(s, frames, budget, now, slow = 2, fast = 8) {
	const window = (/** @type {number} */ seconds) => {
		/** @type {number[]} */
		const out = [];
		let total = 0;
		for (let i = frames.length - 1; i >= 0 && total < seconds * 1000; i--) {
			out.push(frames[i]);
			total += frames[i];
		}
		return total >= seconds * 1000 * 0.9 ? out : null;
	};
	const p90 = (/** @type {number[]} */ l) => l.slice().sort((a, b) => a - b)[Math.floor(l.length * 0.9)];
	const recent = window(slow);
	if (now - s.since >= slow && recent && p90(recent) > budget * 1.25 && s.level < 2) return { level: s.level + 1, since: now };
	const calm = window(fast);
	if (now - s.since >= fast && calm && p90(calm) < budget * 1.05 && s.level > 0) return { level: s.level - 1, since: now };
	return s;
}

/**
 * @param {any} api
 * @param {{get: () => any, onChange: (fn: (p: any) => void) => any}} prefs
 */
export function createQuality(api, prefs) {
	/** @type {Set<(level: number) => void>} */
	const listeners = new Set();
	let governed = { level: 0, since: performance.now() / 1000 };
	/** the last frame times, ms — a fixed ring (the frame task allocates nothing) */
	const ring = new Float32Array(1024);
	let head = 0;
	let filled = 0;
	let last = 0;
	let nextStep = 0;
	let current = -1;
	const core = () => (api.quality && typeof api.quality === 'object' && 'level' in api.quality ? api.quality : null);

	function level() {
		const pick = prefs.get().quality;
		const i = LEVELS.indexOf(pick);
		if (i >= 0) return i;
		const c = core();
		if (c) return fromCoreLevel(c.level);
		return governed.level;
	}
	function publish() {
		const l = level();
		if (l === current) return;
		current = l;
		for (const fn of listeners) fn(l);
	}
	prefs.onChange(publish);
	try {
		core()?.onChange?.(publish);
	} catch {
		/* a core without onChange: the frame task polls it */
	}
	api.registerFrameTask(() => {
		const t = performance.now();
		if (last) {
			ring[head] = t - last;
			head = (head + 1) % ring.length;
			filled = Math.min(ring.length, filled + 1);
		}
		last = t;
		// the governor runs only when nobody else decides (a pick, or core's level) — twice a second
		if (t < nextStep) return;
		nextStep = t + 500;
		if (!LEVELS.includes(prefs.get().quality) && !core()) {
			/** @type {number[]} oldest first */
			const frames = [];
			for (let i = filled; i > 0; i--) frames.push(ring[(head - i + ring.length) % ring.length]);
			const budget = api.isVR?.() ? 1000 / 72 : 1000 / 60;
			governed = stepGovernor(governed, frames, budget, t / 1000);
		}
		publish();
	});
	return {
		level: () => (current < 0 ? level() : current),
		budget: () => budgetOf(current < 0 ? level() : current),
		/** where the level comes from, for the debug line @returns {string} */
		source: () => (LEVELS.includes(prefs.get().quality) ? 'pick' : core() ? 'core' : 'auto'),
		/** @param {(level: number) => void} fn */
		onChange(fn) {
			listeners.add(fn);
			return () => listeners.delete(fn);
		}
	};
}
