// waves — HOW A SHOT FEELS (30b): the sound and the buzz, through the player's options and
// FEATURE-DETECTED against the core calls the 30b round adds (the game SFX set with
// `api.music`, 30b C5; `api.hapticPattern`, 30b C4). On a core without them a shot is silent
// (the old ping set would answer every name with the same chime) and the buzz falls back to
// `api.haptic` with the pattern's rough shape. Core already makes both a no-op in Edit.

/** a pattern's rough single-pulse stand-in: [intensity 0..1, ms] */
export const HAPTIC_FALLBACK = Object.freeze({ tap: [0.2, 18], bump: [0.45, 35], hit: [0.8, 70], success: [0.6, 120], fail: [0.7, 160], rumble: [0.5, 220], heartbeat: [0.5, 90] });

/** is the 30b game-sound set there? (C5 lands the SFX names and `api.music` together) @param {any} api */
export const hasGameSounds = (api) => !!api.music && typeof api.music.play === 'function';

/** @param {any} api @param {ReturnType<import('./prefs.js').createPrefs>} prefs */
export function createFeel(api, prefs) {
	return {
		/** @param {string} name @param {number[]=} at */
		sound(name, at) {
			if (!prefs.get().sfx || !hasGameSounds(api)) return;
			api.playSound?.(name, at);
		},
		/** @param {string} pattern @param {string=} hand 'right' | 'left' ('desk' and absent buzz nothing / both) */
		haptic(pattern, hand) {
			if (!prefs.get().haptics || hand === 'desk') return;
			if (typeof api.hapticPattern === 'function') api.hapticPattern(pattern, hand);
			else {
				const [i, ms] = /** @type {any} */ (HAPTIC_FALLBACK)[pattern] ?? [0.4, 40];
				api.haptic?.(i, ms, hand);
			}
		}
	};
}
