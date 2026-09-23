// SOUND, MUSIC AND HAPTICS — one place that decides what the board sounds and feels like.
//
// Roadmap 30b (the Quest round): the user heard "a weird sound while moving the dots". It
// was the old generative PAD: three detuned oscillators that started on the first pick and
// NEVER stopped, whose low-pass filter got a new `linearRampToValueAtTime` on EVERY
// refresh() — and refresh() runs every frame while a dot is carried, so the filter was
// re-ramped 60-90 times a second (a warbling zipper), plus a fresh blip per pick and drop
// from a module-owned AudioContext. All of that is gone. The board now makes ONE short
// sound per EVENT and nothing per frame:
//
//   pick -> 'pop'   drop -> 'click'   solve -> 'success'   a level unlocked -> 'levelup'
//
// Where the sounds come from (feature-detected, never assumed):
// - a core with the 30b sound set (C5: `api.music` exists) plays them through
//   `api.playSound(name, position)` — the shared SFX bus and the player's "Game sounds"
//   volume. On an older core `playSound` plays a DING for any name it does not know, so it
//   is NOT called there;
// - otherwise a tiny local synth plays the same four as self-stopping one-shots (every
//   voice is an oscillator with a hard `stop()`; nothing is left running).
// Music: `api.music.play('puzzle', {volume})` while the board is being PLAYED (Play or
// Interact), `api.music.stop()` when that ends — edge-triggered, never per frame. An older
// core has no music; the board is then silent between events, which is the point.
// Haptics (C4): `api.hapticPattern(name, hand)` when the core has it, else a mapped
// `api.haptic(intensity, ms, hand)` pulse. Core makes both no-ops in Edit.

/** the four board sounds, and the local fallback voice for each: [freq Hz, end freq, seconds, gain, wave] */
export const FALLBACK = {
	pop: [[720, 1100, 0.07, 0.07, 'sine']],
	click: [[1500, 1400, 0.03, 0.035, 'triangle']],
	success: [
		[523.25, 523.25, 0.18, 0.06, 'triangle', 0],
		[659.25, 659.25, 0.18, 0.06, 'triangle', 0.09],
		[783.99, 783.99, 0.26, 0.06, 'triangle', 0.18],
		[1046.5, 1046.5, 0.4, 0.05, 'sine', 0.27]
	],
	levelup: [
		[587.33, 587.33, 0.12, 0.05, 'sine', 0],
		[880, 880, 0.24, 0.05, 'sine', 0.1]
	]
};
/** api.haptic fallbacks for the C4 presets: [intensity, ms] pulses (the gap between is ms) */
export const HAPTIC_FALLBACK = {
	tap: [[0.25, 15]],
	bump: [[0.5, 35]],
	success: [[0.4, 40], [0.6, 40], [0.9, 80]]
};
/** the puzzle music's volume (quiet: it sits under the SFX) */
export const MUSIC_VOLUME = 0.35;

/** Does this core have the 30b sound set? (C5 ships `api.music` with it) @param {any} api */
export const hasCoreSfx = (api) => typeof api?.music?.play === 'function';

/**
 * @param {any} api
 * @param {{ audioContext?: () => any, setTimeout?: (fn: () => void, ms: number) => any }} [env]
 */
export function makeSfx(api, env = {}) {
	/** every sound and pattern asked for, in order (the test hook reads it) */
	const log = [];
	/** @type {any} */ let ac = null;
	let live = 0; // local fallback voices still sounding
	let musicOn = false;
	const later = env.setTimeout ?? ((fn, ms) => setTimeout(fn, ms));

	function context() {
		if (ac) return ac;
		const make = env.audioContext ?? (() => {
			const AC = typeof window !== 'undefined' ? window.AudioContext || /** @type {any} */ (window).webkitAudioContext : null;
			return AC ? new AC() : null;
		});
		ac = make();
		return ac;
	}

	/** a local one-shot: every oscillator has a hard stop, so nothing keeps sounding */
	function fallback(name) {
		const voices = FALLBACK[name];
		if (!voices) return;
		let ctx;
		try {
			ctx = context();
		} catch {
			return;
		}
		if (!ctx) return;
		if (ctx.state === 'suspended') ctx.resume?.().catch?.(() => {});
		for (const [f0, f1, dur, gain, type, delay = 0] of voices) {
			const t = ctx.currentTime + delay;
			const osc = ctx.createOscillator();
			const g = ctx.createGain();
			osc.type = type;
			osc.frequency.setValueAtTime(f0, t);
			if (f1 !== f0) osc.frequency.exponentialRampToValueAtTime(f1, t + dur);
			g.gain.setValueAtTime(0.0001, t);
			g.gain.exponentialRampToValueAtTime(gain, t + 0.008);
			g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
			osc.connect(g).connect(ctx.destination);
			live++;
			osc.onended = () => {
				live--;
				osc.disconnect();
				g.disconnect();
			};
			osc.start(t);
			osc.stop(t + dur + 0.02);
		}
	}

	return {
		/** one board sound (LOCAL, like every playSound) @param {string} name @param {number[]} [position] */
		play(name, position) {
			log.push(name);
			if (hasCoreSfx(api)) api.playSound?.(name, position);
			else fallback(name);
		},
		/** a haptic preset on one hand (or both) @param {'tap'|'bump'|'success'} name @param {'left'|'right'} [hand] */
		haptic(name, hand) {
			log.push('haptic:' + name + (hand ? ':' + hand : ''));
			if (typeof api.hapticPattern === 'function') {
				api.hapticPattern(name, hand);
				return;
			}
			if (typeof api.haptic !== 'function') return;
			let at = 0;
			for (const [intensity, ms] of HAPTIC_FALLBACK[name] ?? []) {
				if (at === 0) api.haptic(intensity, ms, hand);
				else later(() => api.haptic(intensity, ms, hand), at);
				at += ms + 60;
			}
		},
		/** the puzzle music follows `on` — called every frame, acts only on a change @param {boolean} on */
		music(on) {
			if (on === musicOn) return;
			musicOn = on;
			if (typeof api.music?.play !== 'function') return;
			log.push(on ? 'music:puzzle' : 'music:stop');
			if (on) api.music.play('puzzle', { volume: MUSIC_VOLUME });
			else api.music.stop?.();
		},
		/** record a non-sound moment (the solve's burst / banner) in the same log @param {string} entry */
		note(entry) {
			log.push(entry);
		},
		/** what the flights read: the log, the fallback voices sounding, whether music is on */
		stats: () => ({ log: [...log], live, contexts: ac ? 1 : 0, music: musicOn, core: hasCoreSfx(api) })
	};
}
