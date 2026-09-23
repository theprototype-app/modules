// sfx.js — the board's sounds, music and haptics, with a fake api and a fake AudioContext.
import { makeSfx, hasCoreSfx, MUSIC_VOLUME, FALLBACK } from '../src/sfx.js';

/** a fake AudioContext that records every oscillator and whether it was told to stop */
function fakeContext() {
	const oscs = [];
	const param = () => ({ value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {}, linearRampToValueAtTime() {} });
	const node = () => ({ connect(n) { return n; }, disconnect() {} });
	return {
		oscs,
		state: 'running',
		currentTime: 0,
		destination: node(),
		createOscillator() {
			const o = { ...node(), type: 'sine', frequency: param(), started: false, stopAt: null, onended: null, start() { this.started = true; }, stop(t) { this.stopAt = t; } };
			oscs.push(o);
			return o;
		},
		createGain() {
			return { ...node(), gain: param() };
		}
	};
}

export function run(check) {
	// ---- an older core (no api.music): playSound would DING an unknown name, so it is never called
	{
		const calls = [];
		const api = { playSound: (...a) => calls.push(a), haptic: () => {} };
		const ctx = fakeContext();
		const sfx = makeSfx(api, { audioContext: () => ctx });
		check(!hasCoreSfx(api), 'no api.music -> the core sound set is NOT assumed');
		sfx.play('pop');
		sfx.play('click');
		check(calls.length === 0, 'an older core: api.playSound is never called with the 30b names (it would ding)');
		const want = FALLBACK.pop.length + FALLBACK.click.length;
		check(ctx.oscs.length === want && ctx.oscs.every((o) => o.started), 'the local fallback plays pop + click as ' + want + ' one-shot voices');
		check(ctx.oscs.every((o) => typeof o.stopAt === 'number' && o.stopAt <= 0.2), 'every fallback voice has a hard stop within 0.2 s — nothing keeps sounding (the old pad never stopped)');
		check(sfx.stats().live === want, 'the voices count as live until they end');
		ctx.oscs.forEach((o) => o.onended());
		check(sfx.stats().live === 0, 'and none are live once they ended');
		sfx.play('nonsense');
		check(ctx.oscs.length === want, 'an unknown name is a no-op locally too');
		check(JSON.stringify(sfx.stats().log) === JSON.stringify(['pop', 'click', 'nonsense']), 'the log records each sound asked for, once');
	}
	// ---- a 30b core (C5): the sounds go through api.playSound, with the position
	{
		const calls = [];
		const music = [];
		let made = 0;
		const api = { playSound: (...a) => calls.push(a), music: { play: (...a) => music.push(['play', ...a]), stop: () => music.push(['stop']) } };
		const sfx = makeSfx(api, { audioContext: () => (made++, fakeContext()) });
		sfx.play('pop', [1, 2, 3]);
		sfx.play('success');
		check(calls.length === 2 && calls[0][0] === 'pop' && JSON.stringify(calls[0][1]) === '[1,2,3]' && calls[1][0] === 'success', 'a 30b core: api.playSound(name, position) per event');
		check(made === 0, 'and the module makes no AudioContext of its own');
		for (let f = 0; f < 60; f++) sfx.music(true);
		check(music.length === 1 && music[0][1] === 'puzzle' && music[0][2]?.volume === MUSIC_VOLUME, 'music(true) every frame -> ONE music.play("puzzle", {volume ' + MUSIC_VOLUME + '})');
		for (let f = 0; f < 60; f++) sfx.music(false);
		check(music.length === 2 && music[1][0] === 'stop', 'music(false) every frame -> ONE music.stop()');
		check(MUSIC_VOLUME > 0 && MUSIC_VOLUME <= 0.5, 'the music is quiet (volume ' + MUSIC_VOLUME + ')');
	}
	// ---- haptics: the C4 preset when the core has it, else mapped api.haptic pulses
	{
		const patterns = [];
		const sfx = makeSfx({ hapticPattern: (...a) => patterns.push(a), haptic: () => patterns.push(['raw']) });
		sfx.haptic('tap', 'right');
		check(patterns.length === 1 && patterns[0][0] === 'tap' && patterns[0][1] === 'right', 'hapticPattern(name, hand) when the core has it');
		const pulses = [];
		const timers = [];
		const old = makeSfx({ haptic: (...a) => pulses.push(a) }, { setTimeout: (fn, ms) => timers.push([fn, ms]) });
		old.haptic('bump', 'left');
		check(pulses.length === 1 && pulses[0][0] === 0.5 && pulses[0][2] === 'left', 'an older core: bump -> one api.haptic(0.5, 35, hand)');
		old.haptic('success', 'left');
		timers.forEach(([fn]) => fn());
		check(pulses.length === 4 && timers.length === 2 && timers[0][1] < timers[1][1], 'success -> three rising pulses, the later two on timers');
		check(pulses[3][0] > pulses[1][0], 'the success pulses rise');
		const none = makeSfx({});
		none.haptic('tap');
		check(true, 'no haptic api at all is a quiet no-op');
	}
}
