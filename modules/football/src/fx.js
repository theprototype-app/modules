// football — THE PRESENTATION: banners, sounds, confetti, haptics, music. Every call goes
// through here so the module FEATURE-DETECTS the 30b core contract (C2 announce, C4
// hapticPattern, C5 sounds + music, C6 effects) in one place and runs on an older core with
// the nearest thing it has — and so a test can read what the game ASKED for (`log()`)
// without a headset, a speaker or the new core.
//
// All of it is LOCAL: every peer applies the same replicated op and presents it itself, so
// nothing here ever sends.

/** 30b C5: the procedural SFX a 1.17 core does not have fall back to its four pings */
const LEGACY_SOUND = { goal: 'bell', whistle: 'chime', kick: 'pop', click: 'pluck', cheer: null, hit: null, success: 'bell', fail: null };

/** 30b C4: the presets, as plain pulses for a core with only api.haptic */
const LEGACY_HAPTIC = {
	tap: [0.2, 20],
	bump: [0.4, 35],
	hit: [0.7, 45],
	success: [0.8, 160],
	fail: [0.5, 220],
	rumble: [0.6, 400],
	heartbeat: [0.5, 90]
};

export const LOG_CAP = 80;

/** @param {any} api */
export function createFx(api) {
	/** @type {{kind: string, name: string, opts?: any, native: boolean}[]} */
	const calls = [];
	/** @param {string} kind @param {string} name @param {any} opts @param {boolean} native */
	const note = (kind, name, opts, native) => {
		calls.push({ kind, name, ...(opts === undefined ? {} : { opts }), native });
		while (calls.length > LOG_CAP) calls.shift();
	};
	/** C5 landed with api.music; before it, playSound only knows the pings */
	const hasSfx = () => !!api.music && typeof api.music.play === 'function';

	return {
		/**
		 * A big centred banner (C2): "GOAL!", "3", "RED WINS". Without api.announce a
		 * `toast: true` banner (a goal, a result) becomes a toast on desktop; a countdown
		 * digit is simply dropped (three toasts a second would be noise).
		 * @param {string} text @param {{sub?: string, ms?: number, color?: string, toast?: boolean}} [opts]
		 */
		announce(text, opts = {}) {
			const { toast, ...rest } = opts;
			const native = typeof api.announce === 'function';
			note('announce', text, rest, native);
			if (native) api.announce(text, rest);
			else if (toast && !api.isVR?.()) api.toast?.(rest.sub ? text + '  ' + rest.sub : text);
		},
		/** @param {string} name @param {number[]} [pos] world position */
		sound(name, pos) {
			const native = hasSfx();
			note('sound', name, undefined, native);
			if (native) api.playSound?.(name, pos);
			else {
				const legacy = /** @type {any} */ (LEGACY_SOUND)[name];
				if (legacy) api.playSound?.(legacy, pos);
			}
		},
		/** C6: a pooled particle burst at a WORLD position @param {number[]} pos @param {any} opts */
		burst(pos, opts) {
			const native = typeof api.effects?.burst === 'function';
			note('burst', opts?.kind ?? 'sparkle', opts, native);
			if (native) api.effects.burst(pos, opts);
		},
		/** C4: a named haptic preset (core makes it a no-op in Edit) @param {string} name @param {'left'|'right'} [hand] */
		haptic(name, hand) {
			const native = typeof api.hapticPattern === 'function';
			note('haptic', name, hand ? { hand } : undefined, native);
			if (native) api.hapticPattern(name, hand);
			else {
				const pulse = /** @type {any} */ (LEGACY_HAPTIC)[name];
				if (pulse && typeof api.haptic === 'function') api.haptic(pulse[0], pulse[1], hand);
			}
		},
		/** a raw pulse scaled by the caller (a kick's impulse) @param {number} intensity @param {number} ms @param {'left'|'right'} [hand] */
		pulse(intensity, ms, hand) {
			note('pulse', String(Math.round(intensity * 100) / 100), hand ? { hand } : undefined, typeof api.haptic === 'function');
			api.haptic?.(intensity, ms, hand);
		},
		/** C5 music: a procedural loop, LOCAL; core stops it on leaving Play/Interact @param {string} preset @param {any} [opts] */
		music(preset, opts) {
			const native = hasSfx();
			note('music', preset, opts, native);
			if (native) api.music.play(preset, opts);
		},
		stopMusic() {
			const native = hasSfx();
			note('music', 'stop', undefined, native);
			if (native) api.music.stop?.();
		},
		/** what the game asked for, oldest first (the flight's and the unit test's window) */
		log: () => calls.map((c) => ({ ...c })),
		clearLog: () => {
			calls.length = 0;
		}
	};
}
