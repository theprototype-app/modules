// PROGRESS — which levels a player has opened, solved and how fast. PURE (no THREE, no DOM,
// no api) except `makeStorage`, which takes its backends as arguments so a node test can
// hand it fakes (test/progress.test.mjs).
//
// Fork 9 (roadmap 30): `{'2d': {unlocked, solved: [...], best: {level: ms}}, '3d': {...}}`
// under the key `progress`, LOCAL per device (never replicated, never in a scene file):
// the board still replicates as it always did — whoever changes the level changes it for
// everyone — but what YOU have opened is yours. Level 1 is always open; solving N opens N+1.
//
// Storage: `api.storage` (core 1.17, 30-core-flow P4) when the core has it, else this
// module's own wrapper over localStorage writing the SAME key format core uses,
// `tp:mod:untangle:<key>`, JSON, never throwing, an in-memory fallback per key — so progress
// written on a 1.16 core is exactly what a 1.17 core's api.storage reads back.

export const MAX_LEVEL = 30;
export const MODES = ['2d', '3d'];
export const PROGRESS_KEY = 'progress';
export const STORAGE_PREFIX = 'tp:mod:untangle:';

/** @returns {{unlocked: number, solved: number[], best: Record<string, number>}} */
function freshMode() {
	return { unlocked: 1, solved: [], best: {} };
}

/** @returns {Record<string, {unlocked: number, solved: number[], best: Record<string, number>}>} */
export function defaultProgress() {
	/** @type {any} */
	const out = {};
	for (const m of MODES) out[m] = freshMode();
	return out;
}

const isLevel = (/** @type {any} */ n) => Number.isInteger(n) && n >= 1 && n <= MAX_LEVEL;

/**
 * Whatever came out of storage -> a valid progress object. Anything malformed falls back
 * to the default FIELD BY FIELD (a corrupt `best` does not cost you your unlocks), and a
 * value that is not an object at all is the default.
 * @param {any} raw
 */
export function normalizeProgress(raw) {
	const out = defaultProgress();
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
	for (const m of MODES) {
		const src = raw[m];
		if (!src || typeof src !== 'object' || Array.isArray(src)) continue;
		const solved = Array.isArray(src.solved) ? [...new Set(src.solved.filter(isLevel))].sort((a, b) => a - b) : [];
		// unlocked covers every solved level + 1 (a hand-edited file cannot strand a solve)
		const fromSolved = solved.length ? Math.min(MAX_LEVEL, Math.max(...solved) + 1) : 1;
		const unlocked = isLevel(src.unlocked) ? src.unlocked : 1;
		/** @type {Record<string, number>} */
		const best = {};
		if (src.best && typeof src.best === 'object' && !Array.isArray(src.best)) {
			for (const [k, v] of Object.entries(src.best)) {
				const lvl = Number(k);
				if (isLevel(lvl) && typeof v === 'number' && Number.isFinite(v) && v > 0) best[String(lvl)] = Math.round(v);
			}
		}
		out[m] = { unlocked: Math.max(unlocked, fromSolved), solved, best };
	}
	return out;
}

/** @param {any} progress @param {string} mode @param {number} level */
export function isUnlocked(progress, mode, level) {
	const p = progress?.[mode];
	return isLevel(level) && !!p && level <= p.unlocked;
}

/** @param {any} progress @param {string} mode @param {number} level */
export function isSolved(progress, mode, level) {
	return !!progress?.[mode]?.solved?.includes(level);
}

/** the level Continue opens: the lowest unlocked level not yet solved, else the highest unlocked
 * @param {any} progress @param {string} mode */
export function continueLevel(progress, mode) {
	const p = progress?.[mode] ?? freshMode();
	for (let l = 1; l <= p.unlocked; l++) if (!p.solved.includes(l)) return l;
	return Math.min(MAX_LEVEL, p.unlocked);
}

/**
 * Bank a solve. Returns a NEW progress object (the input is not touched) plus what changed.
 * `ms` null = solved without a timed run (no best is recorded).
 * @param {any} progress @param {string} mode @param {number} level @param {number | null} ms
 */
export function recordSolve(progress, mode, level, ms) {
	const next = normalizeProgress(progress);
	const p = next[mode];
	if (!p || !Number.isInteger(level) || level < 1) return { progress: next, unlockedNew: false, newBest: false };
	const lvl = Math.min(level, MAX_LEVEL);
	if (!p.solved.includes(lvl)) p.solved = [...p.solved, lvl].sort((a, b) => a - b);
	const opened = Math.min(MAX_LEVEL, lvl + 1);
	const unlockedNew = opened > p.unlocked;
	if (unlockedNew) p.unlocked = opened;
	let newBest = false;
	if (typeof ms === 'number' && Number.isFinite(ms) && ms > 0) {
		const prior = p.best[String(lvl)];
		if (!(prior > 0) || ms < prior) {
			p.best[String(lvl)] = Math.round(ms);
			newBest = true;
		}
	}
	return { progress: next, unlockedNew, newBest };
}

/** @param {any} progress @param {string} mode @param {number} level @returns {number | null} ms */
export function bestOf(progress, mode, level) {
	const v = progress?.[mode]?.best?.[String(level)];
	return typeof v === 'number' && v > 0 ? v : null;
}

/** m:ss for a HUD (null -> an em dash) @param {number | null | undefined} ms */
export function formatTime(ms) {
	if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) return '—';
	const s = Math.floor(ms / 1000);
	return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}

/**
 * The module's storage: `api.storage` when present, else a wrapper with the SAME key format.
 * @param {any} api
 * @param {() => any} [backing] the localStorage to use (a getter, so a SecurityError on
 *   touching `window.localStorage` is caught like any other failure)
 * @returns {{kind: string, get: (key: string) => any, set: (key: string, value: any) => boolean, remove: (key: string) => void}}
 */
export function makeStorage(api, backing = defaultBacking) {
	const s = api?.storage;
	if (s && typeof s.get === 'function' && typeof s.set === 'function') {
		return {
			kind: 'api',
			get: (key) => {
				try {
					return s.get(key) ?? null;
				} catch {
					return null;
				}
			},
			set: (key, value) => {
				try {
					return s.set(key, value) !== false;
				} catch {
					return false;
				}
			},
			remove: (key) => {
				try {
					s.remove?.(key);
				} catch {}
			}
		};
	}
	/** @type {Map<string, string>} keys whose real write failed (safeStorage's rule) */
	const memory = new Map();
	const store = () => {
		try {
			return backing() ?? null;
		} catch {
			return null;
		}
	};
	return {
		kind: 'local',
		get(key) {
			const full = STORAGE_PREFIX + key;
			let raw = memory.get(full) ?? null;
			if (raw === null) {
				try {
					raw = store()?.getItem(full) ?? null;
				} catch {
					raw = null;
				}
			}
			if (raw === null) return null;
			try {
				return JSON.parse(raw);
			} catch {
				return null; // a corrupt value reads as absent; normalizeProgress supplies defaults
			}
		},
		set(key, value) {
			const full = STORAGE_PREFIX + key;
			const text = JSON.stringify(value);
			const b = store();
			try {
				if (!b) throw new Error('no storage');
				b.setItem(full, text);
				memory.delete(full);
				return true;
			} catch {
				memory.set(full, text);
				return false;
			}
		},
		remove(key) {
			const full = STORAGE_PREFIX + key;
			memory.delete(full);
			try {
				store()?.removeItem(full);
			} catch {}
		}
	};
}

function defaultBacking() {
	return typeof localStorage === 'undefined' ? null : localStorage;
}
