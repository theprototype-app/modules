// 100% WebAudio synthesis, zero audio files. LOCAL feedback for replicated
// events (never part of the sync model). Voices are tiny one-shots; the
// context resumes lazily on the first call after a user gesture.

/** @type {AudioContext | null} */ let ctx = null;
/** @type {GainNode | null} */ let bus = null;

function ensure() {
	if (typeof AudioContext === 'undefined') return null;
	if (!ctx) {
		ctx = new AudioContext();
		bus = ctx.createGain();
		bus.gain.value = 0.25;
		bus.connect(ctx.destination);
	}
	if (ctx.state === 'suspended') ctx.resume().catch(() => {});
	return ctx;
}

/** one enveloped oscillator @param {number} freq @param {number} dur @param {OscillatorType} type */
function tone(freq, dur, type = 'triangle', delay = 0, gain = 0.5) {
	const c = ensure();
	if (!c || !bus) return;
	const t0 = c.currentTime + delay;
	const osc = c.createOscillator();
	const env = c.createGain();
	osc.type = type;
	osc.frequency.setValueAtTime(freq, t0);
	env.gain.setValueAtTime(0, t0);
	env.gain.linearRampToValueAtTime(gain, t0 + 0.012);
	env.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
	osc.connect(env).connect(bus);
	osc.start(t0);
	osc.stop(t0 + dur + 0.05);
}

/** rising-pitch pickup combo @param {number} combo consecutive pickups */
export function gemChime(combo = 0) {
	const base = 620 * Math.pow(2, Math.min(combo, 12) * 0.07);
	tone(base, 0.18, 'triangle');
	tone(base * 1.5, 0.22, 'sine', 0.05, 0.3);
}

export function portalWhoosh() {
	const c = ensure();
	if (!c || !bus) return;
	const t0 = c.currentTime;
	const osc = c.createOscillator();
	const env = c.createGain();
	osc.type = 'sawtooth';
	osc.frequency.setValueAtTime(140, t0);
	osc.frequency.exponentialRampToValueAtTime(880, t0 + 0.5);
	env.gain.setValueAtTime(0.0001, t0);
	env.gain.exponentialRampToValueAtTime(0.3, t0 + 0.2);
	env.gain.exponentialRampToValueAtTime(0.001, t0 + 0.7);
	osc.connect(env).connect(bus);
	osc.start(t0);
	osc.stop(t0 + 0.8);
}

/** the UP portal unsealing */
export function sealBreak() {
	tone(392, 0.3, 'square', 0, 0.2);
	tone(523, 0.3, 'square', 0.1, 0.2);
	tone(784, 0.5, 'triangle', 0.2, 0.35);
}

export function startThump() {
	tone(110, 0.35, 'sine', 0, 0.6);
	tone(220, 0.2, 'triangle', 0.05, 0.25);
}

export function winFanfare() {
	[523, 659, 784, 1046].forEach((f, i) => tone(f, 0.5, 'triangle', i * 0.16, 0.4));
	tone(1568, 0.9, 'sine', 0.64, 0.2);
}
