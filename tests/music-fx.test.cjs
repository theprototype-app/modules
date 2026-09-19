// music-fx test-flight (#23 C3): a mixer and five pedals, measured through the tap.
//
// Everything here is asserted through the SPECTRUM at the destination tap, never
// through the document alone: a pedal that builds, cables and reports itself
// perfectly while changing nothing about the sound is the failure this module exists
// to prevent. A filter moves the centroid, distortion and the bitcrusher put energy
// above the fundamental, the delay and the reverb keep sounding after the source
// stops, a re-ordered chain reads differently and repeatably, the mixer's mute and
// solo drop one tone and keep the other, and a fader move is a param write with no
// click and no restart.
//
// The SOURCE and the SINK are test kinds registered in-page on every peer (the
// core suite's shape), so the flight depends on nothing but this module: the source's
// output reaches no bus of its own and the sink is the only thing here touching one.
//
// THE GPU FLAGS ARE PART OF THE MEASUREMENT (h.AUDIO_ARGS): a SwiftShader page starves
// the sampling loop — see the note over GPU_ARGS in helpers.cjs.
const h = require('./helpers.cjs');

/** run a body in the page with the audio stores bound (the core suites' shape) */
const inPage = (page, body, arg) =>
	page.evaluate(
		([src, a]) =>
			Object.getPrototypeOf(async function () {}).constructor('s', 'ad', 'ap', 'eng', 'arg', src)(
				window.__stores,
				window.__stores.audioDevices,
				window.__stores.audioPatch,
				window.__stores.audioEngine,
				a
			),
		[body, arg ?? null]
	);

const SILENT = 0.001; // the RMS floor the core helpers count as silence
const K = (kind) => 'mod-music-fx-' + kind;
const PEDALS = ['filter', 'distortion', 'delay', 'reverb', 'bitcrush'];
const KINDS = ['mixer', ...PEDALS].map(K);

/**
 * The two test kinds. `fx-src` is an oscillator whose params are audible (freq, gain,
 * wave) and whose output connects to NOTHING; `fx-sink` connects its input to the
 * instruments bus. `__oscStarts` counts every oscillator start, so a check can prove a
 * fader move never rebuilt a source.
 */
const TEST_KINDS =
	'window.__oscStarts = window.__oscStarts || 0;' +
	'ad.registerAudioDevice({' +
	"  kind: 'fx-src', label: 'FX test source', group: 'test'," +
	"  ports: { in: [], out: [{ id: 'out', label: 'Out', kind: 'audio' }] }," +
	'  params: [' +
	"    { key: 'freq', label: 'Frequency', kind: 'range', min: 20, max: 5000, step: 1, default: 220, unit: 'Hz' }," +
	"    { key: 'gain', label: 'Level', kind: 'range', min: 0, max: 1, step: 0.01, default: 0 }," +
	"    { key: 'wave', label: 'Wave', kind: 'select', default: 'sine', options: [{ value: 'sine', label: 'Sine' }, { value: 'sawtooth', label: 'Saw' }] }" +
	'  ],' +
	'  build(ctx, node, params) {' +
	'    const osc = ctx.createOscillator(); osc.type = params.wave; osc.frequency.value = params.freq;' +
	'    const amp = ctx.createGain(); amp.gain.value = params.gain;' +
	'    osc.connect(amp); osc.start(); window.__oscStarts++;' +
	'    return { output: amp, osc, amp, dispose() { osc.stop(); osc.disconnect(); amp.disconnect(); } };' +
	'  },' +
	"  onParam(hd, key, value) { if (key === 'freq') hd.osc.frequency.value = value; if (key === 'gain') hd.amp.gain.value = value; if (key === 'wave') hd.osc.type = value; }" +
	'});' +
	'ad.registerAudioDevice({' +
	"  kind: 'fx-sink', label: 'FX test sink', group: 'test'," +
	"  ports: { in: [{ id: 'in', label: 'In', kind: 'audio' }], out: [] }, params: []," +
	"  build(ctx) { const input = ctx.createGain(); input.connect(eng.bus('instruments')); return { input, dispose() { input.disconnect(); } }; }" +
	'});' +
	'return ad.devicesDebug().kinds;';

const kinds = (page) => inPage(page, 'return ad.devicesDebug().kinds');
const built = (page) => inPage(page, 'return ad.devicesDebug().built');
const isBuilt = (list, uuid, kind) => list.some((d) => d.uuid === uuid && d.builtAs === kind && d.fellBackFrom === null);
const setParam = (page, uuid, key, value) => inPage(page, "return ad.setDeviceParam(arg.uuid, arg.key, arg.value)", { uuid, key, value });
const setParams = async (page, uuid, params) => {
	for (const [key, value] of Object.entries(params)) await setParam(page, uuid, key, value);
};
const docOn = (page, uuid) =>
	inPage(page, 'const g = await new Promise((r) => s.objectsGroup.subscribe(r)()); const o = g.getObjectByProperty("uuid", arg); return o ? o.userData.device ?? null : null', uuid);
const addDevice = (page, kind, x) => inPage(page, "const o = ad.addDevice(arg.kind, { position: [arg.x, 1, -2] }); return o ? o.uuid : null", { kind, x });
const cable = (page, from, fromPort, to, toPort) =>
	inPage(page, 'return ap.addCable({ from: { uuid: arg.from, port: arg.fromPort }, to: { uuid: arg.to, port: arg.toPort } })', { from, fromPort, to, toPort });
const uncable = (page, ids) => inPage(page, 'for (const id of arg) ap.removeCable(id); return true', ids);
const cablesOf = (page, uuid) => inPage(page, 'return ap.cablesOf(arg).length', uuid);
const wait = (page, ms) => page.waitForTimeout(ms);

/** Plug a source through ONE pedal into the sink; returns the cable ids to pull later. */
async function chain(page, uuids) {
	const ids = [];
	for (let i = 0; i + 1 < uuids.length; i++) {
		const [from, fromPort] = Array.isArray(uuids[i]) ? uuids[i] : [uuids[i], 'out'];
		const [to, toPort] = Array.isArray(uuids[i + 1]) ? uuids[i + 1] : [uuids[i + 1], 'in'];
		ids.push(await cable(page, from, fromPort, to, toPort));
	}
	await wait(page, 350); // routing reconciles per frame; the glides settle in ~75 ms
	return ids;
}

/**
 * Sample every tapped context for `ms` and describe what was heard, from the LOUDEST
 * frame: peak and minimum RMS, the magnitude-weighted centroid, the strongest bin,
 * the share of POWER above `hfHz` (a pure sine reads ~0 here; harmonics and aliases
 * read well above it), the MAGNITUDE share's maximum over every frame (`hfMax`: a
 * click is a frame of broadband energy), and the level in dB at each frequency in `hz`.
 */
const measure = (peer, opts) =>
	peer.page.evaluate(async (arg) => {
		const tapped = window.__audioTap.all();
		const scratch = tapped.map((t) => ({
			analyser: t.analyser,
			context: t.context,
			time: new Float32Array(t.analyser.fftSize),
			freq: new Float32Array(t.analyser.frequencyBinCount)
		}));
		/** the share of the frame above `hfHz`: by POWER (a harmonic series reads well
		 * above a pure sine's ~0) or by MAGNITUDE (a step's 1/f leakage is a few tenths
		 * here and a thousandth by power — the click metric) */
		const share = (freq, binHz, byMagnitude) => {
			let above = 0;
			let total = 0;
			for (let b = 1; b < freq.length; b++) {
				const weight = Math.pow(10, freq[b] / (byMagnitude ? 20 : 10));
				total += weight;
				if (b * binHz >= arg.hfHz) above += weight;
			}
			return total ? above / total : 0;
		};
		let peak = 0;
		let minRms = Infinity;
		let sum = 0;
		let samples = 0;
		let hfMax = 0;
		let loudest = null;
		let binHz = 0;
		const deadline = performance.now() + arg.ms;
		while (performance.now() < deadline) {
			await new Promise((r) => setTimeout(r, 10));
			samples++;
			let tickRms = 0;
			let winner = null;
			for (const entry of scratch) {
				entry.analyser.getFloatTimeDomainData(entry.time);
				let square = 0;
				for (let i = 0; i < entry.time.length; i++) square += entry.time[i] * entry.time[i];
				const rms = Math.sqrt(square / entry.time.length);
				if (rms > tickRms) {
					tickRms = rms;
					winner = entry;
				}
			}
			sum += tickRms;
			if (tickRms < minRms) minRms = tickRms;
			if (winner && tickRms > 0.002) {
				winner.analyser.getFloatFrequencyData(winner.freq);
				const width = winner.context.sampleRate / winner.analyser.fftSize;
				const ratio = share(winner.freq, width, true);
				if (ratio > hfMax) hfMax = ratio;
				if (tickRms > peak) {
					loudest = winner.freq.slice();
					binHz = width;
				}
			}
			if (tickRms > peak) peak = tickRms;
		}
		let centroid = 0;
		let peakHz = 0;
		let hf = 0;
		const levels = {};
		if (loudest) {
			let weighted = 0;
			let total = 0;
			let best = -Infinity;
			for (let b = 1; b < loudest.length; b++) {
				const magnitude = Math.pow(10, loudest[b] / 20);
				weighted += magnitude * b * binHz;
				total += magnitude;
				if (loudest[b] > best) {
					best = loudest[b];
					peakHz = b * binHz;
				}
			}
			centroid = total ? weighted / total : 0;
			hf = share(loudest, binHz);
			for (const hz of arg.hz ?? []) levels[hz] = loudest[Math.round(hz / binHz)];
		}
		return { peak, minRms: samples ? minRms : 0, mean: samples ? sum / samples : 0, samples, centroid, peakHz, hf, hfMax, levels, contexts: tapped.length };
	}, { ms: 500, hfHz: 600, hz: [], ...opts });

/**
 * Stop a source (its gain to 0, a replicated write) and read the loudest RMS between
 * `from` and `to` ms after — a pedal with memory keeps sounding, a bypass does not.
 */
const tail = (peer, uuid, from, to) =>
	peer.page.evaluate(async (arg) => {
		const tapped = window.__audioTap.all();
		const scratch = tapped.map((t) => ({ analyser: t.analyser, time: new Float32Array(t.analyser.fftSize) }));
		const rmsNow = () => {
			let loudest = 0;
			for (const entry of scratch) {
				entry.analyser.getFloatTimeDomainData(entry.time);
				let square = 0;
				for (let i = 0; i < entry.time.length; i++) square += entry.time[i] * entry.time[i];
				loudest = Math.max(loudest, Math.sqrt(square / entry.time.length));
			}
			return loudest;
		};
		const before = rmsNow();
		const t0 = performance.now();
		window.__stores.audioDevices.setDeviceParam(arg.uuid, 'gain', 0);
		let tailPeak = 0;
		let samples = 0;
		while (performance.now() - t0 < arg.to) {
			await new Promise((r) => setTimeout(r, 10));
			if (performance.now() - t0 < arg.from) continue;
			samples++;
			tailPeak = Math.max(tailPeak, rmsNow());
		}
		return { before, tailPeak, samples };
	}, { uuid, from, to });

const fmt = (n, d = 3) => (typeof n === 'number' ? n.toFixed(d) : String(n));
const same = (a, b, tolerance) => Math.abs(a - b) <= tolerance * Math.max(Math.abs(a), Math.abs(b), 1e-9);

h.run(async () => {
	const browser = await h.launch({ args: h.AUDIO_ARGS });
	const A = await h.setupPage(browser, 'A', { audio: true });
	const B = await h.setupPage(browser, 'B', { audio: true });

	await h.installModule(A, 'music-fx');
	await h.installModule(B, 'music-fx');
	await inPage(A.page, TEST_KINDS);
	await inPage(B.page, TEST_KINDS);
	await h.connect(A, B);

	// ---------------------------------------------------------------- section 1
	console.log('\n=== 1. the module supplies six device kinds ===');
	await h.eventually(() => kinds(A.page), (k) => KINDS.every((kind) => k.includes(kind)), '1.1 A registers mixer + five pedals, namespaced mod-music-fx-*');
	await h.eventually(() => kinds(B.page), (k) => KINDS.every((kind) => k.includes(kind)), '1.2 so does B — a module is installed on both, it does not travel');
	const catalog = await inPage(A.page, "return ad.deviceCatalog().filter((k) => k.kind.startsWith('mod-music-fx-')).map((k) => ({ kind: k.kind, ins: k.ports.in.map((p) => p.id), outs: k.ports.out.map((p) => p.id), params: k.params.length }))");
	const mixerCat = catalog.find((k) => k.kind === K('mixer'));
	h.check(
		!!mixerCat && mixerCat.ins.join() === 'in1,in2,in3,in4' && mixerCat.outs.join() === 'out,send',
		'1.3 the mixer declares in1..in4 and out + send (' + JSON.stringify(mixerCat) + ')'
	);
	h.check(
		PEDALS.every((p) => {
			const entry = catalog.find((k) => k.kind === K(p));
			return entry && entry.ins.join() === 'in' && entry.outs.join() === 'out';
		}),
		'1.4 every pedal declares one in and one out'
	);

	// ---------------------------------------------------------------- section 2
	console.log('\n=== 2. a source, a pedal, a sink ===');
	const src = await addDevice(A.page, 'fx-src', -3);
	const src2 = await addDevice(A.page, 'fx-src', -2.5);
	const sink = await addDevice(A.page, 'fx-sink', 3);
	const pedal = {};
	for (let i = 0; i < PEDALS.length; i++) pedal[PEDALS[i]] = await addDevice(A.page, K(PEDALS[i]), -1.5 + i * 0.6);
	const mixer = await addDevice(A.page, K('mixer'), 2);
	h.check(!!src && !!src2 && !!sink && !!mixer && PEDALS.every((p) => !!pedal[p]), '2.1 addDevice made the two sources, the sink, five pedals and the mixer');
	await h.eventually(
		() => built(A.page),
		(list) => PEDALS.every((p) => isBuilt(list, pedal[p], K(p))) && list.some((d) => d.uuid === mixer && d.builtAs === K('mixer') && d.hasInput && d.hasOutput),
		'2.2 all six build as the REAL kinds on A, the mixer with an input and an output'
	);
	await h.eventually(
		() => built(B.page),
		(list) => PEDALS.every((p) => isBuilt(list, pedal[p], K(p))) && isBuilt(list, mixer, K('mixer')) && isBuilt(list, src, 'fx-src') && isBuilt(list, sink, 'fx-sink'),
		'2.3 the objects replicate and build as the real kinds on B too',
		15000
	);
	const meshes = await inPage(
		A.page,
		'const g = await new Promise((r) => s.objectsGroup.subscribe(r)()); return arg.map((u) => { const o = g.getObjectByProperty("uuid", u); return { type: o.type, plugs: [] .concat(...o.children.map((c) => c.name)).filter((n) => n.startsWith("vrpatch-")).sort() }; })',
		[pedal.filter, mixer]
	);
	h.check(
		meshes[0].type === 'Mesh' && meshes[1].type === 'Mesh' && meshes[0].plugs.join() === 'vrpatch-in:in,vrpatch-out:out' && meshes[1].plugs.length === 6,
		'2.4 the device roots are MESHES with a plug per port (' + meshes[0].plugs.join() + ' / ' + meshes[1].plugs.length + ' on the mixer)'
	);
	await setParams(A.page, src, { wave: 'sawtooth', gain: 0.25 });
	const silent = await measure(A, { ms: 300 });
	h.check(silent.peak < SILENT, '2.5 (premise) a source cabled to nothing is SILENT — its output reaches no bus (peak ' + fmt(silent.peak, 5) + ')');
	let ids = await chain(A.page, [src, pedal.filter, sink]);
	h.check(ids.every((id) => typeof id === 'string' && id), '2.6 two cables plug src -> filter -> sink (' + ids.join(', ') + ')');
	await h.eventually(() => cablesOf(B.page, pedal.filter), (n) => n === 2, '2.7 both cables replicate to B');

	// ---------------------------------------------------------------- section 3
	console.log('\n=== 3. the filter moves the centroid ===');
	await setParams(A.page, pedal.filter, { mix: 0 });
	await wait(A.page, 200);
	const bypass = await measure(A, { ms: 500 });
	h.check(bypass.samples > 20, '3.1 (premise) the sampling loop actually ran (' + bypass.samples + ' samples in 500 ms)');
	h.check(bypass.peak > SILENT * 10 && Math.abs(bypass.peakHz - 220) < 40, '3.2 the saw is HEARD through the bypassed pedal at 220 Hz (peak ' + fmt(bypass.peak) + ', strongest bin ' + Math.round(bypass.peakHz) + ' Hz, centroid ' + Math.round(bypass.centroid) + ' Hz)');
	await setParams(A.page, pedal.filter, { mix: 1, type: 'lowpass', cutoff: 300, q: 1 });
	await wait(A.page, 250);
	const low = await measure(A, { ms: 500 });
	h.check(low.centroid < bypass.centroid * 0.5 && low.peak > SILENT * 10, '3.3 a low-pass at 300 Hz halves the centroid (' + Math.round(bypass.centroid) + ' -> ' + Math.round(low.centroid) + ' Hz)');
	await setParams(A.page, pedal.filter, { type: 'highpass', cutoff: 2000 });
	await wait(A.page, 250);
	const high = await measure(A, { ms: 500 });
	h.check(high.centroid > bypass.centroid * 1.3 && high.peakHz > 400, '3.4 a high-pass at 2 kHz raises it and the fundamental is no longer the strongest bin (centroid ' + Math.round(high.centroid) + ' Hz, strongest ' + Math.round(high.peakHz) + ' Hz)');
	await setParams(A.page, pedal.filter, { type: 'lowpass', cutoff: 8000 });
	await uncable(A.page, ids);

	// ---------------------------------------------------------------- section 4
	console.log('\n=== 4. distortion adds harmonics ===');
	await setParams(A.page, src, { wave: 'sine' });
	ids = await chain(A.page, [src, pedal.distortion, sink]);
	await setParams(A.page, pedal.distortion, { mix: 0 });
	await wait(A.page, 200);
	const clean = await measure(A, { ms: 500, hfHz: 600 });
	h.check(clean.peak > SILENT * 10 && clean.hf < 0.01, '4.1 (premise) a bypassed sine has ~no power above 600 Hz (share ' + fmt(clean.hf, 5) + ')');
	await setParams(A.page, pedal.distortion, { mix: 1, drive: 20, tone: 8000 });
	await wait(A.page, 250);
	const driven = await measure(A, { ms: 500, hfHz: 600 });
	h.check(driven.hf > 0.02 && driven.hf > clean.hf * 10, '4.2 driven, the share above 600 Hz jumps (' + fmt(clean.hf, 5) + ' -> ' + fmt(driven.hf, 4) + ')');
	// the tone knob is read above 1 kHz: the 3rd harmonic (660 Hz) sits UNDER a 700 Hz cutoff
	const bright = await measure(A, { ms: 400, hfHz: 1000 });
	await setParams(A.page, pedal.distortion, { tone: 700 });
	await wait(A.page, 250);
	const dark = await measure(A, { ms: 500, hfHz: 1000 });
	h.check(bright.hf > 0.01 && dark.hf < bright.hf * 0.5, '4.3 the tone knob (a post low-pass at 700 Hz) takes most of the power above 1 kHz back (' + fmt(bright.hf, 4) + ' -> ' + fmt(dark.hf, 4) + ')');
	await uncable(A.page, ids);

	// ---------------------------------------------------------------- section 5
	console.log('\n=== 5. the bitcrusher ===');
	await h.eventually(() => inPage(A.page, 'return ad.deviceHandle(arg)?.mode ?? null', pedal.bitcrush), (m) => m === 'worklet' || m === 'script', '5.1 the crusher attached its processor');
	const mode = await inPage(A.page, 'return ad.deviceHandle(arg)?.mode', pedal.bitcrush);
	console.log('  bitcrush path: ' + mode + (mode === 'worklet' ? ' (AudioWorklet from a blob URL)' : ' (ScriptProcessorNode fallback)'));
	ids = await chain(A.page, [src, pedal.bitcrush, sink]);
	await setParams(A.page, pedal.bitcrush, { mix: 0 });
	await wait(A.page, 200);
	const smooth = await measure(A, { ms: 500, hfHz: 600 });
	await setParams(A.page, pedal.bitcrush, { mix: 1, bits: 4, rate: 8 });
	await wait(A.page, 250);
	const crushed = await measure(A, { ms: 500, hfHz: 600 });
	h.check(crushed.peak > SILENT * 10 && crushed.hf > 0.02 && crushed.hf > smooth.hf * 10, '5.2 4 bits at 1/8 rate put energy above the fundamental (share ' + fmt(smooth.hf, 5) + ' -> ' + fmt(crushed.hf, 4) + ', via ' + mode + ')');
	await setParams(A.page, pedal.bitcrush, { bits: 16, rate: 1 });
	await wait(A.page, 250);
	const restored = await measure(A, { ms: 500, hfHz: 600 });
	h.check(restored.hf < crushed.hf * 0.2, '5.3 16 bits at full rate is transparent again (share ' + fmt(restored.hf, 5) + ')');
	await uncable(A.page, ids);

	// ---------------------------------------------------------------- section 6
	console.log('\n=== 6. the delay keeps sounding, and follows the tempo ===');
	ids = await chain(A.page, [src, pedal.delay, sink]);
	await setParams(A.page, pedal.delay, { time: 'free', ms: 250, feedback: 0.5, mix: 0.5 });
	await wait(A.page, 700);
	const echo = await tail(A, src, 150, 900);
	h.check(echo.before > SILENT * 10 && echo.tailPeak > 0.01, '6.1 after the source stops the echoes go on (before ' + fmt(echo.before) + ', tail peak ' + fmt(echo.tailPeak) + ' over ' + echo.samples + ' reads)');
	await wait(A.page, 1500);
	await setParams(A.page, pedal.delay, { mix: 0 });
	await setParams(A.page, src, { gain: 0.25 });
	await wait(A.page, 500);
	const noEcho = await tail(A, src, 150, 600);
	h.check(noEcho.before > SILENT * 10 && noEcho.tailPeak < SILENT * 2, '6.2 bypassed, it stops when the source does (tail peak ' + fmt(noEcho.tailPeak, 5) + ')');
	await setParams(A.page, src, { gain: 0.25 });
	await setParams(A.page, pedal.delay, { time: '1/8', mix: 0.5 });
	await wait(A.page, 200);
	const eighth = await inPage(A.page, 'const h = ad.deviceHandle(arg); return { seconds: h.seconds, bpm: h.bpm, value: h.delay.delayTime.value }', pedal.delay);
	h.check(Math.abs(eighth.seconds - 0.25) < 1e-6 && eighth.bpm === 120, '6.3 synced to 1/8 at the default 120 bpm the time is 0.25 s (' + JSON.stringify(eighth) + ')');
	await inPage(A.page, 's.musicClock.setBpm(90)');
	await h.eventually(
		() => inPage(A.page, 'const h = ad.deviceHandle(arg); return { seconds: h.seconds, value: h.delay.delayTime.value }', pedal.delay),
		(r) => Math.abs(r.seconds - 60 / 90 / 2) < 1e-6 && Math.abs(r.value - 60 / 90 / 2) < 0.01,
		'6.4 setBpm(90) moves it to 0.333 s — the delayTime AudioParam followed the SHARED transport'
	);
	await h.eventually(
		() => inPage(B.page, 'const h = ad.deviceHandle(arg); return h ? { seconds: h.seconds, bpm: h.bpm } : null', pedal.delay),
		(r) => !!r && Math.abs(r.seconds - 60 / 90 / 2) < 1e-6,
		"6.5 B's delay lands on the same 0.333 s from the replicated tempo"
	);
	await inPage(A.page, 's.musicClock.setBpm(120)');
	await uncable(A.page, ids);

	// ---------------------------------------------------------------- section 7
	console.log('\n=== 7. the reverb has a tail ===');
	// a SAW, not a sine, and the module's impulse is SEEDED: a noise burst's response at
	// any one frequency is a random draw, and with Math.random in the module a sine's
	// tail read 0.009..0.039 across runs — the same claim, a different number each time
	await setParams(A.page, src, { wave: 'sawtooth' });
	ids = await chain(A.page, [src, pedal.reverb, sink]);
	await setParams(A.page, pedal.reverb, { size: 1.5, decay: 3, mix: 0.5 });
	await wait(A.page, 700);
	const verb = await tail(A, src, 120, 700);
	h.check(verb.before > SILENT * 10 && verb.tailPeak > 0.004, '7.1 after the source stops the room rings on (tail peak ' + fmt(verb.tailPeak, 4) + ')');
	await wait(A.page, 1500);
	await setParams(A.page, pedal.reverb, { mix: 0 });
	await setParams(A.page, src, { gain: 0.25 });
	await wait(A.page, 400);
	const dryRoom = await tail(A, src, 120, 500);
	h.check(dryRoom.tailPeak < SILENT * 2, '7.2 bypassed, it does not (tail peak ' + fmt(dryRoom.tailPeak, 5) + ')');
	await setParams(A.page, src, { gain: 0.25 });
	await uncable(A.page, ids);

	// ---------------------------------------------------------------- section 8
	console.log('\n=== 8. re-ordering the chain by re-cabling ===');
	await setParams(A.page, src, { wave: 'sawtooth' });
	await setParams(A.page, pedal.filter, { type: 'lowpass', cutoff: 500, q: 1, mix: 1 });
	await setParams(A.page, pedal.distortion, { drive: 20, tone: 12000, mix: 1 });
	const readOrder = async (order) => {
		const cables = await chain(A.page, [src, ...order.map((p) => pedal[p]), sink]);
		await wait(A.page, 200);
		const first = await measure(A, { ms: 400, hfHz: 1500 });
		const second = await measure(A, { ms: 400, hfHz: 1500 });
		await uncable(A.page, cables);
		return { first, second };
	};
	const fd = await readOrder(['filter', 'distortion']);
	const df = await readOrder(['distortion', 'filter']);
	const describe = (r) => 'hf ' + fmt(r.hf, 4) + ' / centroid ' + Math.round(r.centroid);
	h.check(same(fd.first.hf, fd.second.hf, 0.35) && same(fd.first.centroid, fd.second.centroid, 0.2), '8.1 filter -> distortion reads the same twice (' + describe(fd.first) + ' vs ' + describe(fd.second) + ')');
	h.check(same(df.first.hf, df.second.hf, 0.35) && same(df.first.centroid, df.second.centroid, 0.2), '8.2 distortion -> filter reads the same twice (' + describe(df.first) + ' vs ' + describe(df.second) + ')');
	h.check(fd.first.hf > df.first.hf * 3 && fd.first.centroid > df.first.centroid * 1.3, '8.3 and the two orders differ: distortion AFTER the filter regenerates the harmonics the filter removed (' + describe(fd.first) + ' vs ' + describe(df.first) + ')');

	// ---------------------------------------------------------------- section 9
	console.log('\n=== 9. the mixer ===');
	await setParams(A.page, src, { wave: 'sine', freq: 220, gain: 0.25 });
	await setParams(A.page, src2, { wave: 'sine', freq: 880, gain: 0.25 });
	ids = await chain(A.page, [[src, 'out'], [mixer, 'in1']]);
	ids.push(...(await chain(A.page, [[src2, 'out'], [mixer, 'in2']])));
	ids.push(...(await chain(A.page, [[mixer, 'out'], [sink, 'in']])));
	await wait(A.page, 200);
	const both = await measure(A, { ms: 400, hz: [220, 880] });
	h.check(both.peak > SILENT * 10 && Math.abs(both.levels[220] - both.levels[880]) < 12, '9.1 two sources on in1 and in2 both reach out (220 Hz at ' + fmt(both.levels[220], 1) + ' dB, 880 Hz at ' + fmt(both.levels[880], 1) + ' dB)');
	await setParam(A.page, mixer, 'mute2', true);
	await wait(A.page, 250);
	const muted = await measure(A, { ms: 400, hz: [220, 880] });
	h.check(muted.levels[880] < both.levels[880] - 20 && Math.abs(muted.levels[220] - both.levels[220]) < 3, '9.2 muting channel 2 drops 880 Hz by ' + fmt(both.levels[880] - muted.levels[880], 0) + ' dB and leaves 220 Hz alone');
	await setParam(A.page, mixer, 'mute2', false);
	await setParam(A.page, mixer, 'solo1', true);
	await wait(A.page, 250);
	const soloed = await measure(A, { ms: 400, hz: [220, 880] });
	h.check(soloed.levels[880] < both.levels[880] - 20 && Math.abs(soloed.levels[220] - both.levels[220]) < 3, '9.3 soloing channel 1 isolates it (880 Hz down ' + fmt(both.levels[880] - soloed.levels[880], 0) + ' dB, 220 Hz within ' + fmt(Math.abs(soloed.levels[220] - both.levels[220]), 1) + ' dB)');
	await setParam(A.page, mixer, 'solo1', false);
	await wait(A.page, 250);
	const unsoloed = await measure(A, { ms: 400, hz: [220, 880] });
	h.check(Math.abs(unsoloed.levels[880] - both.levels[880]) < 3, '9.4 solo off brings channel 2 back (880 Hz at ' + fmt(unsoloed.levels[880], 1) + ' dB)');
	// the fader: a continuous gesture, so it must be a param write that glides the running
	// node — no click (no frame of broadband energy), no gap, no rebuilt input, no restart
	const before = await inPage(A.page, 'window.__fxIn1 = ad.deviceHandle(arg).inputs.in1; return { starts: window.__oscStarts }', mixer);
	const rest = await measure(A, { ms: 400, hfHz: 3000 });
	const moving = measure(A, { ms: 900, hfHz: 3000 });
	for (let i = 0; i < 8; i++) {
		await wait(A.page, 90);
		await setParam(A.page, mixer, 'gain1', i % 2 ? 1 : 0.5);
	}
	const fader = await moving;
	await setParam(A.page, mixer, 'gain1', 1);
	const after = await inPage(A.page, 'return { same: window.__fxIn1 === ad.deviceHandle(arg).inputs.in1, starts: window.__oscStarts }', mixer);
	h.check(fader.hfMax < Math.max(rest.hfMax * 4, 0.01), '9.5 eight fader writes in 0.9 s do not CLICK — no frame of broadband energy (magnitude share above 3 kHz at rest ' + fmt(rest.hfMax, 5) + ', moving ' + fmt(fader.hfMax, 5) + ')');
	h.check(fader.minRms > fader.peak * 0.35, '9.6 and the level never gaps while it moves (min ' + fmt(fader.minRms) + ' vs peak ' + fmt(fader.peak) + ' over ' + fader.samples + ' reads)');
	h.check(after.same === true, '9.7 the input node a cable is plugged into is the SAME node after the moves — a fader is a param write, never a rebuild');
	h.check(after.starts === before.starts, '9.8 and no source oscillator was restarted (' + after.starts + ' starts before and after)');
	// the send: a second output, post-fader, per channel
	await uncable(A.page, [ids[2]]);
	const sendCable = await cable(A.page, mixer, 'send', sink, 'in');
	await wait(A.page, 300);
	const sendOff = await measure(A, { ms: 300, hz: [220, 880] });
	h.check(sendOff.peak < SILENT, '9.9 (premise) the send bus is silent while every send is 0 (peak ' + fmt(sendOff.peak, 5) + ')');
	await setParam(A.page, mixer, 'send1', 1);
	await wait(A.page, 250);
	const sendOn = await measure(A, { ms: 400, hz: [220, 880] });
	h.check(sendOn.peak > SILENT * 10 && Math.abs(sendOn.peakHz - 220) < 40 && sendOn.levels[880] < sendOn.levels[220] - 20, '9.10 send 1 up puts channel 1 alone on the send port (strongest ' + Math.round(sendOn.peakHz) + ' Hz, 880 Hz ' + fmt(sendOn.levels[220] - sendOn.levels[880], 0) + ' dB below)');
	await setParam(A.page, mixer, 'mute1', true);
	await wait(A.page, 250);
	const sendMuted = await measure(A, { ms: 300 });
	h.check(sendMuted.peak < SILENT * 2, '9.11 the send is post-fader: muting channel 1 silences it (peak ' + fmt(sendMuted.peak, 5) + ')');
	await setParam(A.page, mixer, 'mute1', false);
	await setParam(A.page, mixer, 'send1', 0);
	await uncable(A.page, [ids[0], ids[1], sendCable]);
	await setParam(A.page, src2, 'gain', 0);

	// ---------------------------------------------------------------- section 10
	console.log('\n=== 10. a knob turned on A is heard on B ===');
	await setParams(A.page, src, { wave: 'sawtooth', gain: 0.25 });
	await setParams(A.page, pedal.filter, { type: 'lowpass', cutoff: 8000, q: 1, mix: 1 });
	ids = await chain(A.page, [src, pedal.filter, sink]);
	await wait(B.page, 600);
	const openOnB = await measure(B, { ms: 500 });
	h.check(openOnB.peak > SILENT * 10 && Math.abs(openOnB.peakHz - 220) < 40, '10.1 B hears the chain it built from the replicated document and patch (peak ' + fmt(openOnB.peak) + ', centroid ' + Math.round(openOnB.centroid) + ' Hz)');
	await setParam(A.page, pedal.filter, 'cutoff', 300);
	await h.eventually(() => docOn(B.page, pedal.filter), (d) => d?.params?.cutoff === 300, "10.2 the cutoff written on A lands in B's document");
	await h.eventually(
		() => inPage(B.page, 'return ad.deviceHandle(arg)?.biquad.frequency.value ?? null', pedal.filter),
		(v) => typeof v === 'number' && Math.abs(v - 300) < 15,
		"10.3 and B's built BiquadFilterNode followed it through onParam (frequency -> 300)"
	);
	const closedOnB = await measure(B, { ms: 500 });
	h.check(closedOnB.centroid < openOnB.centroid * 0.5, "10.4 B's own spectrum moved with it (centroid " + Math.round(openOnB.centroid) + ' -> ' + Math.round(closedOnB.centroid) + ' Hz)');

	// ---------------------------------------------------------------- section 11
	console.log('\n=== 11. a late joiner walks into the finished rig ===');
	const C = await h.setupPage(browser, 'C', { audio: true });
	await h.installModule(C, 'music-fx');
	await inPage(C.page, TEST_KINDS);
	await h.connect(C, A);
	await h.eventually(
		() => built(C.page),
		(list) => PEDALS.every((p) => isBuilt(list, pedal[p], K(p))) && isBuilt(list, mixer, K('mixer')) && isBuilt(list, src, 'fx-src') && isBuilt(list, sink, 'fx-sink'),
		'11.1 C holds every device as the REAL kind, not a placeholder',
		20000
	);
	await h.eventually(() => cablesOf(C.page, pedal.filter), (n) => n === 2, '11.2 and the chain came with the handshake');
	const docC = await docOn(C.page, pedal.filter);
	h.check(docC?.params?.cutoff === 300 && docC?.params?.type === 'lowpass', "11.3 with the filter's document as A last wrote it (" + JSON.stringify(docC?.params) + ')');
	await wait(C.page, 500);
	const heardC = await measure(C, { ms: 600 });
	h.check(heardC.peak > SILENT * 10 && heardC.centroid < openOnB.centroid * 0.5, '11.4 C hears the chain, low-passed (peak ' + fmt(heardC.peak) + ', centroid ' + Math.round(heardC.centroid) + ' Hz)');

	await h.finish(browser);
});
