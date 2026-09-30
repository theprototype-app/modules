// waves — THE PLAYER'S CHOICES (30b): the loadout and the options, remembered ON THIS DEVICE
// through api.storage (LOCAL: never sent, never in a scene file — a peer's gun is its own).
// `normalize` is pure so a corrupt or old stored value always reads back as a valid set.

import { GUN_IDS } from './guns.js';

export const ABILITY_IDS = Object.freeze(['shield', 'slowmo', 'pulse']);
export const HANDS = Object.freeze(['right', 'left', 'both']);
export const MUSIC = Object.freeze(['off', 'low', 'high']);
export const DEFAULT_PREFS = Object.freeze({ gun: 'blaster', ability: 'pulse', hand: 'right', sfx: true, music: 'low', haptics: true });
const KEY = 'prefs';

/** @param {any} raw @returns {typeof DEFAULT_PREFS} */
export function normalize(raw) {
	const r = raw && typeof raw === 'object' ? raw : {};
	return {
		gun: GUN_IDS.includes(r.gun) ? r.gun : DEFAULT_PREFS.gun,
		ability: ABILITY_IDS.includes(r.ability) ? r.ability : DEFAULT_PREFS.ability,
		hand: HANDS.includes(r.hand) ? r.hand : DEFAULT_PREFS.hand,
		sfx: typeof r.sfx === 'boolean' ? r.sfx : DEFAULT_PREFS.sfx,
		music: MUSIC.includes(r.music) ? r.music : DEFAULT_PREFS.music,
		haptics: typeof r.haptics === 'boolean' ? r.haptics : DEFAULT_PREFS.haptics
	};
}

/** the next value in a list, wrapping @template T @param {readonly T[]} list @param {T} value @returns {T} */
export function cycle(list, value) {
	const i = list.indexOf(value);
	return list[(i + 1) % list.length];
}

/** @param {any} api */
export function createPrefs(api) {
	let prefs = normalize(api.storage?.get?.(KEY, null));
	/** @type {Set<(p: typeof DEFAULT_PREFS) => void>} */
	const listeners = new Set();
	return {
		get: () => prefs,
		/** @param {Partial<typeof DEFAULT_PREFS>} patch */
		set(patch) {
			prefs = normalize({ ...prefs, ...patch });
			api.storage?.set?.(KEY, prefs);
			for (const fn of listeners) fn(prefs);
			return prefs;
		},
		/** @param {(p: typeof DEFAULT_PREFS) => void} fn */
		onChange(fn) {
			listeners.add(fn);
			return () => listeners.delete(fn);
		}
	};
}
