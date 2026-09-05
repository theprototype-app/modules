// music-voice test-flight (#23 C5): a Mic, a Looper, a Synth and a Theremin on the engine, on
// Chrome's fake media device (a generated signal, so the mic reads real bytes with no hardware).
//
// Every audible claim is read at the destination tap of an in-page SINK device (music-dj's
// idiom: a kind that connects its input to the instruments bus) that each device under test
// is cabled into. Every timing claim is measured SAMPLE-ACCURATELY: the onset detector below
// (music-beat-lab's) chains an 8192-sample analyser off the tap and back-dates each crossing
// by its offset inside the window, so a JavaScript loop that stalls under load (this box is
// shared) still yields the true onset time - a measurement of the scheduler, not of setTimeout.
// Wall clock (Date.now), never ticks. THE GPU FLAGS ARE PART OF THE MEASUREMENT (h.AUDIO_ARGS).
const h = require('./helpers.cjs');

const inPage = (page, body, arg) =>
	page.evaluate(
		([src, a]) =>
			Object.getPrototypeOf(async function () {}).constructor('s', 'ad', 'ap', 'mc', 'arg', src)(
				window.__stores,
				window.__stores.audioDevices,
				window.__stores.audioPatch,
				window.__stores.musicClock,
				a
			),
		[body, arg ?? null]
	);

const MEDIA_ARGS = ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'];
const K = { mic: 'mod-music-voice-mic', looper: 'mod-music-voice-looper', synth: 'mod-music-voice-synth', theremin: 'mod-music-voice-theremin' };
const BAR_MS = 2000; // 120 bpm, four beats
const SILENT = 0.001;

/** the sink: an in-page kind whose input reaches the instruments bus (and so the tap) */
const SINK = "ad.registerAudioDevice({ kind: 'vt-sink', label: 'Sink', ports: { in: [{ id: 'in', kind: 'audio' }], out: [] }, params: [], build(ctx) { const g = ctx.createGain(); g.connect(window.__stores.audioEngine.bus('instruments')); return { input: g, dispose() { g.disconnect(); } }; } }); return 1";
/** a test oscillator: a 150 ms burst of `hz` at EVERY BAR through the transport's scheduler,
 * pure of `at` - so a loop of it carries one onset exactly on the bar */
const OSC = "ad.registerAudioDevice({ kind: 'vt-osc', label: 'Test osc', ports: { in: [], out: [{ id: 'out', kind: 'audio' }] }, params: [{ key: 'hz', kind: 'range', min: 20, max: 4000, step: 1, default: 330 }], build(ctx, node, params) { const out = ctx.createGain(); const hz = Number(params.hz) || 330; const burst = (at) => { const o = ctx.createOscillator(); o.frequency.value = hz; const g = ctx.createGain(); g.gain.setValueAtTime(0, at); g.gain.linearRampToValueAtTime(0.6, at + 0.002); g.gain.setValueAtTime(0.6, at + 0.14); g.gain.linearRampToValueAtTime(0, at + 0.15); o.connect(g); g.connect(out); o.start(at); o.stop(at + 0.16); }; const cancel = mc.schedule(0, (e) => { if (!e.late) burst(e.at); }, { every: 4, swing: false }); return { output: out, dispose() { cancel(); out.disconnect(); } }; } }); return 1";

const docOf = (page, uuid) => inPage(page, 'return ad.deviceOf(ad.findDeviceObject(arg))?.params ?? null', uuid);
const handleOf = (page, uuid, body, extra = {}) => inPage(page, 'const hd = ad.deviceHandle(arg.uuid); const h = hd?.h; if (!h) return null; ' + body, { uuid, ...extra });
const undoLen = (page) => page.evaluate(() => { let n = 0; window.__stores.history.undoStack.subscribe((v) => (n = v.length))(); return n; });
const setParams = (page, uuid, params) => inPage(page, 'ad.setDeviceFor(arg.uuid, { params: arg.params }); return 1', { uuid, params });
const preview = (page, uuid, params) => inPage(page, 'ad.previewDeviceParams(arg.uuid, arg.params, { broadcast: true }); return 1', { uuid, params });
/** the click seam: the module's registered handler, called with the exact mesh the way core's
 * tap / raycast would; returns the page's clock and beat at the click */
const clickMesh = (page, uuid, name) =>
	inPage(page, "const o = ad.findDeviceObject(arg.uuid); const mesh = o?.getObjectByName(arg.name); if (!mesh) return { took: false, missing: true }; const y0 = mesh.position.y; const took = s.moduleSDK.moduleClickHandlers.some((fn) => fn(mesh)); return { took, at: Date.now(), beat: mc.transportNow().beat, dipped: mesh.position.y < y0 - 0.005 }", { uuid, name });
/** the SHARED transport as this peer holds it */
const transportOf = (page) => inPage(page, 'let st; mc.transport.subscribe((v) => (st = v))(); const t = mc.transportNow(); return { startedAt: st.startedAt, bpm: st.bpm, playing: st.playing, beat: t.beat, now: Date.now() }');
const wait = (page, ms) => page.waitForTimeout(ms);

/**
 * The tap's spectrum for `ms`: the strongest bin, and the dB at each of `tones` - MAX-HELD over
 * the reads (so a burst counts fully) or averaged (`mean: true`) for a steady signal. `delay`
 * lets an attack land first.
 */
const spectrum = (page, tones, opts = {}) =>
	page.evaluate(
		async ({ tones, ms, delay, mean }) => {
			await new Promise((r) => setTimeout(r, delay));
			const t = window.__audioTap.all()[0];
			const freq = new Float32Array(t.analyser.frequencyBinCount);
			const binHz = t.context.sampleRate / t.analyser.fftSize;
			const acc = new Float32Array(freq.length).fill(mean ? 0 : -Infinity);
			let reads = 0;
			const deadline = performance.now() + ms;
			while (performance.now() < deadline) {
				await new Promise((r) => setTimeout(r, 16));
				t.analyser.getFloatFrequencyData(freq);
				for (let b = 0; b < freq.length; b++) {
					const v = Number.isFinite(freq[b]) ? freq[b] : -160;
					acc[b] = mean ? acc[b] + v : Math.max(acc[b], v);
				}
				reads++;
			}
			const val = (b) => (mean ? acc[b] / Math.max(1, reads) : acc[b]);
			let best = -Infinity;
			let bestBin = 0;
			for (let b = 1; b < acc.length; b++) if (val(b) > best) { best = val(b); bestBin = b; }
			const at = (hz) => { const b = Math.round(hz / binHz); let m = -Infinity; for (let k = b - 1; k <= b + 1; k++) m = Math.max(m, val(k)); return m; };
			return { peakHz: bestBin * binHz, peakDb: best, db: tones.map(at), reads, binHz };
		},
		{ tones, ms: opts.ms ?? 600, delay: opts.delay ?? 0, mean: !!opts.mean }
	);

/**
 * Onsets at this peer's tap for `ms`, SAMPLE-ACCURATE (music-beat-lab's detector): a big
 * analyser window (8192 samples) chained off every tapped analyser, each read scanning only
 * the samples that arrived since the previous read in 64-sample chunks, back-dating a
 * threshold crossing by its offset inside the window. Threshold 35% of the loudest chunk
 * (re-arm below 12%). Returns the onsets (Date.now ms), the peak, and the read count.
 */
const onsets = (peer, ms) =>
	peer.page.evaluate(async (ms) => {
		const N = 8192;
		const CHUNK = 64;
		const taps = window.__audioTap.all().map((t) => {
			const mine = t.context.createAnalyser();
			mine.fftSize = N;
			mine.smoothingTimeConstant = 0;
			t.analyser.connect(mine);
			return { src: t.analyser, mine, sr: t.context.sampleRate, buf: new Float32Array(N) };
		});
		const ctx = taps[0].mine.context;
		const sr = taps[0].sr;
		/** @type {{t: number, v: number, fresh: boolean}[]} */
		const chunks = [];
		const t0 = Date.now();
		let lastAudio = ctx.currentTime;
		let stalls = 0;
		let lost = 0;
		while (Date.now() - t0 < ms) {
			const wall = Date.now();
			// scan ONLY what the AUDIO clock says arrived since the previous read: a window that
			// has not advanced (the renderer stalled) is not re-scanned - re-reading a static
			// window would stamp its rising edge again, later. More than a window gone (this
			// loop stalled) is counted, and the first chunk after it is not trusted as a rise.
			const audioNow = ctx.currentTime;
			const arrived = Math.round((audioNow - lastAudio) * sr);
			lastAudio = audioNow;
			if (arrived < CHUNK) {
				stalls++;
				await new Promise((r) => setTimeout(r, 4));
				continue;
			}
			const dropped = arrived > N;
			if (dropped) lost++;
			const advanced = Math.min(N, arrived);
			const merged = new Float32Array(Math.floor(advanced / CHUNK));
			for (const tap of taps) {
				tap.mine.getFloatTimeDomainData(tap.buf);
				const from = N - merged.length * CHUNK;
				for (let c = 0; c < merged.length; c++) {
					const a = from + c * CHUNK;
					const b = a + CHUNK;
					let sum = 0;
					for (let i = a; i < b; i++) sum += tap.buf[i] * tap.buf[i];
					merged[c] = Math.max(merged[c], Math.sqrt(sum / CHUNK));
				}
			}
			for (let c = 0; c < merged.length; c++) {
				const endIndex = N - merged.length * CHUNK + (c + 1) * CHUNK;
				chunks.push({ t: wall - ((N - endIndex) / sr) * 1000, v: merged[c], fresh: !(dropped && c === 0) });
			}
			await new Promise((r) => setTimeout(r, 4));
		}
		for (const tap of taps) tap.src.disconnect(tap.mine);
		let peak = 0;
		for (const c of chunks) peak = Math.max(peak, c.v);
		const high = peak * 0.35;
		const low = peak * 0.12;
		let armed = true;
		let last = -Infinity;
		const out = [];
		for (const c of chunks) {
			if (!c.fresh) armed = false; // a rise that happened while samples were lost is not an onset we can place
			if (armed && c.v >= high) {
				if (c.t - last > 120) out.push(Math.round(c.t));
				last = c.t;
				armed = false;
			} else if (!armed && c.v <= low) armed = true;
		}
		// a burst already IN PROGRESS when the detector starts reads as an onset AT the start
		// (there is no rising edge to back-date): the first 250 ms are not a measurement
		return { onsets: out.filter((t) => t - t0 > 250), peak, reads: chunks.length, stalls, lost };
	}, ms);

/** the phase of a set of onsets on a period grid, in ms, and how far each strays from it */
function grid(times, period) {
	if (times.length < 2) return { phase: NaN, maxDev: NaN, spacing: [] };
	const first = times[0];
	const rel = times.map((t) => t - first);
	let sx = 0, sy = 0;
	for (const r of rel) { const a = (2 * Math.PI * (r % period)) / period; sx += Math.cos(a); sy += Math.sin(a); }
	const phase = ((Math.atan2(sy, sx) / (2 * Math.PI)) * period + period) % period;
	let maxDev = 0;
	for (const r of rel) { let d = ((r - phase) % period + period) % period; if (d > period / 2) d -= period; maxDev = Math.max(maxDev, Math.abs(d)); }
	const spacing = rel.slice(1).map((r, i) => r - rel[i]);
	return { phase: (phase + first) % period, maxDev, spacing };
}
/** circular distance between two phases on a period */
const phaseGap = (a, b, period) => { let d = Math.abs(a - b) % period; return Math.min(d, period - d); };
/** the phase a set of onsets holds against a bar grid anchored at `startedAt` */
const barGap = (times, startedAt) => phaseGap(grid(times, BAR_MS).phase, ((startedAt % BAR_MS) + BAR_MS) % BAR_MS, BAR_MS);

/** the RMS at the tap in windows (ms after `fire`), sampled every 10 ms: an envelope */
const envelope = (page, uuid, note, windows) =>
	inPage(
		page,
		'const t = window.__audioTap.all()[0]; const buf = new Float32Array(t.analyser.fftSize); const acc = arg.windows.map(() => ({ sum: 0, n: 0 })); const t0 = performance.now(); ad.noteDevice(arg.uuid, { note: arg.note, velocity: 0.9 }); const end = Math.max(...arg.windows.map((w) => w[1])); while (performance.now() - t0 < end) { await new Promise((r) => setTimeout(r, 10)); const at = performance.now() - t0; t.analyser.getFloatTimeDomainData(buf); let sq = 0; for (let i = 0; i < buf.length; i++) sq += buf[i] * buf[i]; const rms = Math.sqrt(sq / buf.length); arg.windows.forEach((w, i) => { if (at >= w[0] && at < w[1]) { acc[i].sum += rms; acc[i].n++; } }); } return acc.map((a) => (a.n ? a.sum / a.n : 0));',
		{ uuid, note, windows }
	);

const isHash = (v) => typeof v === 'string' && /^[0-9a-f]{40,64}$/.test(v);

h.run(async () => {
	const browser = await h.launch({ args: [...h.AUDIO_ARGS, ...MEDIA_ARGS] });
	const A = await h.setupPage(browser, 'A', { audio: true });
	const B = await h.setupPage(browser, 'B', { audio: true });
	await h.installModule(A, 'music-voice');
	await h.installModule(B, 'music-voice');
	await inPage(A.page, SINK);
	await inPage(B.page, SINK);
	await inPage(A.page, OSC); // A only: on B the test oscillator is a placeholder, so B's sink hears only what replicates
	await h.connect(A, B);

	console.log('\n=== 1. the module supplies four device kinds ===');
	await h.eventually(() => inPage(A.page, 'return ad.devicesDebug().kinds'), (k) => Object.values(K).every((kind) => k.includes(kind)), '1.1 A registers mic, looper, synth and theremin, namespaced mod-music-voice-*');
	await h.eventually(() => inPage(B.page, 'return ad.devicesDebug().kinds'), (k) => Object.values(K).every((kind) => k.includes(kind)), '1.2 so does B - a module does not travel, it is installed on both');

	console.log('\n=== 2. the mic: this peer\'s RAW microphone into the graph, a take by hash ===');
	const rig = await inPage(A.page, "const sk = ad.addDevice('vt-sink', { position: [0, 0, -3] }); const m = ad.addDevice(arg.mic, { position: [0.7, 0.8, -2] }); const c = ap.addCable({ from: { uuid: m.uuid, port: 'out' }, to: { uuid: sk.uuid, port: 'in' } }); return { sink: sk.uuid, mic: m.uuid, micCable: c }", K);
	const stream = await (async () => { let last = null; for (let i = 0; i < 25 && !last?.tracks; i++) { last = await handleOf(A.page, rig.mic, "const tr = h.stream?.getAudioTracks?.()[0]; if (!tr) return { tracks: 0, error: h.error }; const st = tr.getSettings(); let micOn; s.voiceChat.micActive.subscribe((v) => (micOn = v))(); return { tracks: 1, enabled: tr.enabled, state: tr.readyState, aec: st.echoCancellation, ns: st.noiseSuppression, agc: st.autoGainControl, micOn, source: !!h.source }"); if (!last?.tracks) await wait(A.page, 400); } return last; })();
	h.check(!!stream && stream.tracks === 1 && stream.enabled === true && stream.state === 'live' && stream.source, '2.1 the mic builds on this peer\'s raw capture: a live, ENABLED track into a MediaStreamSource (' + JSON.stringify(stream) + ')');
	h.check(!!stream && stream.aec === false && stream.ns === false && stream.agc === false && stream.micOn === false, '2.2 with echo cancellation, noise suppression and auto gain OFF, while voice chat\'s mic toggle is off');
	const heard = await h.audioMetrics(A, 700);
	h.check(heard.peak > SILENT * 2 && heard.samples > 10, '2.3 the mic carries SIGNAL to the sink with the mic toggle off (peak ' + heard.peak.toFixed(4) + ', ' + heard.samples + ' samples) - a node on the voice stream would read silence here');
	await setParams(A.page, rig.mic, { level: 0 });
	await wait(A.page, 400);
	const muted = await h.audioMetrics(A, 500);
	h.check(muted.peak < SILENT, '2.4 level 0 is silent (peak ' + muted.peak.toFixed(5) + ')');
	await setParams(A.page, rig.mic, { level: 1 });
	await h.eventually(() => handleOf(B.page, rig.mic, 'return { built: true, stream: !!h.stream, source: !!h.source }'), (v) => v?.built && v.stream && v.source, '2.5 B builds the replicated mic as the real kind, on ITS OWN raw capture (a Mic is each peer\'s own mic; the takes are what travel)', 15000);
	// a take from the face
	await setParams(A.page, rig.mic, { seconds: 2 });
	const undoMic = await undoLen(A.page);
	const rec = await clickMesh(A.page, rig.mic, 'mic-rec');
	h.check(rec.took === true, '2.6 the Record button takes the click');
	await h.eventually(() => inPage(A.page, 'let st; s.micCapture.recording.subscribe((v) => (st = v))(); return st'), (st) => st?.active === true && st.maxSeconds === 2, '2.7 core\'s recorder runs with the face\'s take length (the LED reads this store)', 3000);
	await h.eventually(() => docOf(A.page, rig.mic).then((d) => d?.lastTake ?? null), (v) => isHash(v), '2.8 the take lands and its CONTENT HASH is written into the device document', 9000);
	const takeA = await docOf(A.page, rig.mic);
	const item = await inPage(A.page, 'const it = s.explorer.itemByHash(arg); return it ? { kind: it.kind, name: it.name, size: it.size } : null', takeA.lastTake);
	h.check(!!item && item.kind === 'audio' && item.name === takeA.lastTakeName && /^mic-.*\.(webm|ogg|m4a)$/.test(item.name) && item.size > 1000, '2.9 it is an Explorer AUDIO item (' + JSON.stringify(item) + ') and the document names it');
	h.check((await undoLen(A.page)) === undoMic + 1, '2.10 the take is one undo entry');
	await h.eventually(() => docOf(B.page, rig.mic).then((d) => d?.lastTake ?? null), (v) => v === takeA.lastTake, '2.11 B holds the hash in its document');
	await h.eventually(() => B.page.evaluate((hash) => !!window.__stores.explorer.itemByHash(hash), takeA.lastTake), (v) => v === true, '2.12 B received the bytes by content hash (assetShare)', 20000);
	// the manifest is a debounced VIEW (400 ms), polled
	await h.eventually(() => inPage(A.page, "let list; s.sceneAssets.sceneAssets.subscribe((v) => (list = v))(); return list.filter((e) => e.group === 'audio').map((e) => ({ hash: e.hash, name: e.name, item: !!e.itemId }))"), (list) => list.some((e) => e.hash === takeA.lastTake && e.name === takeA.lastTakeName && e.item), '2.13 the take is in the Scene manifest by hash, named, with its Explorer item (spec.assets)', 6000);
	// a second press ends a long take early
	await setParams(A.page, rig.mic, { seconds: 20 });
	await clickMesh(A.page, rig.mic, 'mic-rec');
	await wait(A.page, 600);
	const stop = await clickMesh(A.page, rig.mic, 'mic-rec');
	await h.eventually(() => docOf(A.page, rig.mic).then((d) => d?.lastTake ?? null), (v) => isHash(v) && v !== takeA.lastTake, '2.14 pressing Record while a 20 s take runs ends it early: a new take lands within seconds (' + (stop.took ? 'took' : 'missed') + ')', 6000);
	await inPage(A.page, 'ap.removeCable(arg); return 1', rig.micCable); // the fake device must not colour the spectra below

	console.log('\n=== 3. the looper: a record window on the BAR, the same bytes on every peer, in phase ===');
	const lp = await inPage(A.page, "const o = ad.addDevice('vt-osc', { position: [-1.5, 0.8, -2], params: { hz: 330 } }); const l = ad.addDevice(arg.K.looper, { position: [-0.2, 0.8, -2] }); const c1 = ap.addCable({ from: { uuid: o.uuid, port: 'out' }, to: { uuid: l.uuid, port: 'in' } }); ap.addCable({ from: { uuid: l.uuid, port: 'out' }, to: { uuid: arg.sink, port: 'in' } }); ad.setDeviceFor(l.uuid, { params: { bars: 1, thru: false } }); return { osc: o.uuid, looper: l.uuid, oscCable: c1 }", { K, sink: rig.sink });
	await h.eventually(() => inPage(B.page, 'const b = ad.devicesDebug().built.find((d) => d.uuid === arg); return b ? { as: b.builtAs, i: b.hasInput, o: b.hasOutput } : null', lp.looper), (v) => v?.as === K.looper && v.i && v.o, '3.1 the looper builds on B as the real kind with an input and an output');
	await inPage(A.page, 'mc.setBpm(120); mc.playTransport(); return 1');
	await wait(A.page, 400);
	const tp0 = await transportOf(A.page);
	const undo0 = await undoLen(A.page);
	const arm = await clickMesh(A.page, lp.looper, 'lp-rec');
	h.check(arm.took === true && tp0.playing && tp0.bpm === 120, '3.2 Record takes the click on a running 120 bpm transport (armed at beat ' + arm.beat.toFixed(2) + ')');
	const armedDoc = await docOf(A.page, lp.looper);
	h.check(armedDoc.state === 'armed' && !armedDoc.loop, '3.3 the looper is ARMED (a preview in the document) and holds no loop yet');
	await h.eventually(() => docOf(B.page, lp.looper).then((d) => d?.state ?? null), (v) => v === 'armed' || v === 'recording', '3.4 B\'s copy shows the armed / recording state - the LED preview replicates');
	await h.eventually(() => docOf(A.page, lp.looper).then((d) => d?.loop ?? null), (v) => isHash(v), '3.5 the loop lands by hash (lead + one bar + tail + encode)', 9000);
	const land = await inPage(A.page, 'return Date.now()');
	const loop1 = await docOf(A.page, lp.looper);
	h.check(land - arm.at < 6500, '3.6 within maxSeconds + margin of the press (' + (land - arm.at) + ' ms)');
	h.check(loop1.startedBeat % 4 === 0 && loop1.startedBeat > arm.beat && loop1.startedBar === loop1.startedBeat / 4 && loop1.loopBars === 1 && loop1.loopBpm === 120, '3.7 the record window started on a BAR BOUNDARY after the press (beat ' + loop1.startedBeat + ', bar ' + loop1.startedBar + ', armed at ' + arm.beat.toFixed(2) + ')');
	const expectedAt = tp0.startedAt + (loop1.startedBeat * 60000) / 120;
	h.check(Math.abs(loop1.startedAt - expectedAt) < 30 && loop1.startedAt > arm.at, '3.8 startedAt is that bar on the transport\'s own grid (' + (loop1.startedAt - expectedAt).toFixed(1) + ' ms from it, ' + (loop1.startedAt - arm.at) + ' ms after the press)');
	h.check(loop1.state === 'idle' && (await undoLen(A.page)) === undo0 + 1, '3.9 the whole take - previews and the commit - is ONE undo entry (' + undo0 + ' -> ' + (await undoLen(A.page)) + ')');
	await h.eventually(() => handleOf(A.page, lp.looper, 'return h.buffer ? { n: h.buffer.length, sr: h.buffer.sampleRate, edge: h.trim.edge, start: h.trim.start, raw: h.trim.rawSeconds } : null'), (v) => !!v && v.n === Math.round(2 * v.sr) && v.edge > 0, '3.10 A decoded its own take, found the sync pip and cut EXACTLY one bar: 2.000 s to the sample', 8000);
	const trimA = await handleOf(A.page, lp.looper, 'return { edge: h.trim.edge, sr: h.buffer.sampleRate, raw: h.trim.rawSeconds }');
	console.log('  A trim: pip edge at ' + (trimA.edge / trimA.sr * 1000).toFixed(1) + ' ms of a ' + trimA.raw.toFixed(2) + ' s take');
	const spA = await spectrum(A.page, [330], { ms: 2300 });
	h.check(Math.abs(spA.peakHz - 330) < 25, '3.11 the loop PLAYS at the sink on A at 330 Hz (peak ' + spA.peakHz.toFixed(0) + ' Hz; thru is off, so this is the loop)');
	await h.eventually(() => docOf(B.page, lp.looper).then((d) => d?.loop ?? null), (v) => v === loop1.loop, '3.12 B holds the same hash and bar');
	await h.eventually(() => handleOf(B.page, lp.looper, 'return h.buffer ? { n: h.buffer.length, sr: h.buffer.sampleRate, edge: h.trim.edge } : null'), (v) => !!v && v.n === Math.round(2 * v.sr) && v.edge === trimA.edge, '3.13 B pulled the bytes by hash and cut the SAME samples (pip edge ' + trimA.edge + ')', 20000);
	const spB = await spectrum(B.page, [330], { ms: 2300 });
	h.check(Math.abs(spB.peakHz - 330) < 25, '3.14 and hears the loop at 330 Hz (peak ' + spB.peakHz.toFixed(0) + ' Hz)');
	const [oa, ob] = await Promise.all([onsets(A, 4600), onsets(B, 4600)]);
	const ga = grid(oa.onsets, BAR_MS), gb = grid(ob.onsets, BAR_MS);
	h.check(oa.onsets.length >= 2 && oa.onsets.length <= 3 && ga.maxDev < 25, '3.15 across two loops A\'s onsets sit on a 2000 ms grid (' + oa.onsets.length + ' onsets, max deviation ' + ga.maxDev.toFixed(1) + ' ms) - the period is exact');
	const tpA = await transportOf(A.page);
	h.check(barGap(oa.onsets, tpA.startedAt) < 30, '3.16 and ON THE BAR of the shared transport (' + barGap(oa.onsets, tpA.startedAt).toFixed(1) + ' ms from the bar grid)');
	h.check(ob.onsets.length >= 2 && gb.maxDev < 25 && phaseGap(ga.phase, gb.phase, BAR_MS) < 35, '3.17 B plays it IN PHASE with A (' + phaseGap(ga.phase, gb.phase, BAR_MS).toFixed(1) + ' ms apart, ' + ob.onsets.length + ' onsets, max deviation ' + gb.maxDev.toFixed(1) + ' ms)');
	// an OVERDUB with a second tone
	const od = await inPage(A.page, "ap.removeCable(arg.c); const o2 = ad.addDevice('vt-osc', { position: [-1.5, 0.8, -1.4], params: { hz: 440 } }); ap.addCable({ from: { uuid: o2.uuid, port: 'out' }, to: { uuid: arg.l, port: 'in' } }); return o2.uuid", { c: lp.oscCable, l: lp.looper });
	await wait(A.page, 300);
	const undo1 = await undoLen(A.page);
	const arm2 = await clickMesh(A.page, lp.looper, 'lp-rec');
	await h.eventually(() => docOf(A.page, lp.looper).then((d) => d?.loop ?? null), (v) => isHash(v) && v !== loop1.loop, '3.18 the overdub lands as a NEW hash', 9000);
	const loop2 = await docOf(A.page, lp.looper);
	h.check(arm2.took && loop2.takes === 2 && loop2.startedBeat % 4 === 0 && loop2.startedBeat > arm2.beat && (await undoLen(A.page)) === undo1 + 1, '3.19 on a bar boundary again, take 2, one more undo entry');
	await h.eventually(() => handleOf(A.page, lp.looper, 'return h.buffer && h.doc.loop === arg.hash ? h.trim.edge : -1', { hash: loop2.loop }).catch(() => -1), (v) => v > 0, '3.20 A decoded the overdub', 8000);
	const sp2 = await spectrum(A.page, [330, 440], { ms: 2300 });
	h.check(sp2.peakDb > -80 && sp2.db[0] > sp2.peakDb - 15 && sp2.db[1] > sp2.peakDb - 15, '3.21 the overdub carries BOTH tones: 330 Hz (the first loop, through feedback) and 440 Hz (the new take) within 15 dB of the peak (' + sp2.db.map((d) => d.toFixed(0)).join(' / ') + ' dB, peak ' + sp2.peakDb.toFixed(0) + ')');
	await h.eventually(() => docOf(B.page, lp.looper).then((d) => d?.loop ?? null), (v) => v === loop2.loop, '3.22 B holds the new hash');
	await h.eventually(() => handleOf(B.page, lp.looper, 'return h.buffer && h.doc.loop === arg.hash ? h.trim.edge : -1', { hash: loop2.loop }).catch(() => -1), (v) => v > 0, '3.23 and decoded it', 20000);
	const sp2b = await spectrum(B.page, [330, 440], { ms: 2300 });
	h.check(sp2b.peakDb > -80 && sp2b.db[0] > sp2b.peakDb - 15 && sp2b.db[1] > sp2b.peakDb - 15, '3.24 B hears both tones too (' + sp2b.db.map((d) => d.toFixed(0)).join(' / ') + ' dB)');
	await A.page.evaluate(() => window.__stores.history.undo());
	await wait(A.page, 300);
	h.check((await docOf(A.page, lp.looper)).loop === loop1.loop, '3.25 one undo puts the FIRST loop back (the commit carried the document from before the take)');
	await h.eventually(() => docOf(B.page, lp.looper).then((d) => d?.loop ?? null), (v) => v === loop1.loop, '3.26 and B follows');
	const play = await clickMesh(A.page, lp.looper, 'lp-play');
	await wait(A.page, 500);
	const stopped = await h.audioMetrics(A, 500);
	h.check(play.took && stopped.peak < SILENT * 3, '3.27 the Play button stops the loop (peak ' + stopped.peak.toFixed(5) + ')');
	await h.eventually(() => docOf(B.page, lp.looper).then((d) => d?.play ?? null), (v) => v === false, '3.28 replicated to B');
	await inPage(A.page, 'mc.stopTransport(); return 1'); // the test oscillators only sound while it runs
	await wait(A.page, 400);

	console.log('\n=== 4. the synth: polyphonic, the oldest stolen, ADSR, notes replicated ===');
	const sy = await inPage(A.page, "const o = ad.addDevice(arg.K.synth, { position: [-1.2, 0.8, -2] }); ap.addCable({ from: { uuid: o.uuid, port: 'out' }, to: { uuid: arg.sink, port: 'in' } }); ad.setDeviceFor(o.uuid, { params: { wave: 'sine', polyphony: 4, gate: 1.6, release: 0.5, attack: 0.005, decay: 0.05, sustain: 0.8, cutoff: 8000 } }); return o.uuid", { K, sink: rig.sink });
	await h.eventually(() => inPage(B.page, 'const b = ad.devicesDebug().built.find((d) => d.uuid === arg); return { poly: ad.deviceOf(ad.findDeviceObject(arg))?.params?.polyphony ?? null, built: b?.builtAs ?? null, cables: ap.cablesOf(arg).length }', sy), (v) => v?.poly === 4 && v.built === K.synth && v.cables === 1, '4.0 (premise) B holds the synth document (polyphony 4), built it, and has its cable to the sink');
	await wait(B.page, 300); // the routing sweep runs per frame once the cable is in
	const CHORD = [60, 64, 67, 72];
	const HZ = CHORD.map((n) => 440 * Math.pow(2, (n - 69) / 12));
	const remote = spectrum(B.page, HZ, { ms: 900 });
	await wait(A.page, 120);
	await inPage(A.page, 'for (const n of arg.notes) ad.noteDevice(arg.uuid, { note: n, velocity: 0.9 }); return 1', { uuid: sy, notes: CHORD });
	const chordA = await spectrum(A.page, HZ, { ms: 500, delay: 120, mean: true });
	h.check(chordA.peakDb > -80 && chordA.db.every((d) => d > chordA.peakDb - 15), '4.1 four simultaneous notes: all four fundamentals within 15 dB of the peak on A (' + chordA.db.map((d) => d.toFixed(0)).join(' / ') + ' dB)');
	const live = await handleOf(A.page, sy, 'return h.voices.filter((v) => !v.released).map((v) => v.note)');
	h.check(JSON.stringify(live) === JSON.stringify(CHORD), '4.2 four live voices (' + live.join(',') + ')');
	const chordB = await remote;
	// a silent tap reads -160 dB on EVERY bin and would pass the relative test vacuously: signal first
	h.check(chordB.peakDb > -80 && chordB.db.every((d) => d > chordB.peakDb - 15), '4.3 B synthesizes the same chord from the replicated notes (' + chordB.db.map((d) => d.toFixed(0)).join(' / ') + ' dB, peak ' + chordB.peakDb.toFixed(0) + ')');
	await inPage(A.page, 'ad.noteDevice(arg.uuid, { note: 76, velocity: 0.9 }); return 1', { uuid: sy });
	const after = await handleOf(A.page, sy, 'return { live: h.voices.filter((v) => !v.released).map((v) => v.note), stolen: h.voices.filter((v) => v.stolen).map((v) => v.note) }');
	h.check(JSON.stringify(after.live) === JSON.stringify([64, 67, 72, 76]) && JSON.stringify(after.stolen) === JSON.stringify([60]), '4.4 a fifth note past polyphony 4 STEALS THE OLDEST (live ' + after.live.join(',') + ', stolen ' + after.stolen.join(',') + ')');
	const HZ5 = [HZ[0], 440 * Math.pow(2, (76 - 69) / 12)];
	const steal = await spectrum(A.page, HZ5, { ms: 400, delay: 100, mean: true });
	h.check(steal.db[1] > steal.peakDb - 15 && steal.db[0] < chordA.db[0] - 12, '4.5 the spectrum agrees: 659 Hz is in, 262 Hz is gone (' + chordA.db[0].toFixed(0) + ' -> ' + steal.db[0].toFixed(0) + ' dB)');
	await wait(A.page, 2400);
	await setParams(A.page, sy, { gate: 0.6, release: 1.0 });
	const env = await envelope(A.page, sy, 69, [[150, 450], [900, 1300], [1900, 2200]]);
	h.check(env[0] > 0.003, '4.6 ADSR: the note sustains while the gate is open (rms ' + env[0].toFixed(4) + ')');
	h.check(env[1] > env[0] * 0.1 && env[1] < env[0] * 0.9, '4.7 mid-way through a 1 s release it is decaying (' + (env[1] / env[0] * 100).toFixed(0) + '% of the sustain)');
	h.check(env[2] < env[0] * 0.05, '4.8 and after the release it is gone (' + (env[2] / env[0] * 100).toFixed(1) + '%)');
	const key = await clickMesh(A.page, sy, 'key-64');
	h.check(key.took === true && key.dipped === true, '4.9 a key on the face takes the click and dips FROM onNote');
	await h.eventually(() => handleOf(B.page, sy, 'return h.voices.length'), (v) => v >= 1, '4.10 B got the key\'s note - the click went through api.audio.note, replicated', 3000);
	await wait(A.page, 1800);

	console.log('\n=== 5. the theremin: the hand pose is the DOCUMENT, every peer synthesizes it ===');
	const th = await inPage(A.page, "const o = ad.addDevice(arg.K.theremin, { position: [1.5, 0.8, -2] }); ap.addCable({ from: { uuid: o.uuid, port: 'out' }, to: { uuid: arg.sink, port: 'in' } }); return o.uuid", { K, sink: rig.sink });
	await h.eventually(() => docOf(B.page, th).then((d) => d?.hand ?? null), (v) => v === 'right', '5.0 (premise) B holds the theremin (hand: right)');
	const undoT = await undoLen(A.page);
	await preview(A.page, th, { pitch: 440, volume: 0.8 });
	await wait(A.page, 400);
	const t440 = await spectrum(A.page, [440], { ms: 400, mean: true });
	h.check(Math.abs(t440.peakHz - 440) < 25, '5.1 previewParams {pitch 440, volume 0.8}: the sink\'s strongest bin is 440 Hz on A (' + t440.peakHz.toFixed(0) + ')');
	await h.eventually(() => docOf(B.page, th), (d) => d?.pitch === 440 && d?.volume === 0.8, '5.2 B holds the pose in its document');
	const t440b = await spectrum(B.page, [440], { ms: 400, mean: true });
	h.check(Math.abs(t440b.peakHz - 440) < 25, '5.3 and B synthesizes it: 440 Hz at B\'s sink (' + t440b.peakHz.toFixed(0) + ')');
	await preview(A.page, th, { pitch: 880 });
	await wait(A.page, 400);
	const [t880, t880b] = await Promise.all([spectrum(A.page, [880, 1760], { ms: 400, mean: true }), spectrum(B.page, [880], { ms: 400, mean: true })]);
	h.check(Math.abs(t880.peakHz - 880) < 25 && Math.abs(t880b.peakHz - 880) < 25, '5.4 pitch 880 moves the bin on both (' + t880.peakHz.toFixed(0) + ' / ' + t880b.peakHz.toFixed(0) + ')');
	await preview(A.page, th, { wave: 'sawtooth' });
	await wait(A.page, 300);
	const saw = await spectrum(A.page, [1760], { ms: 300, mean: true });
	h.check(saw.db[0] > t880.db[1] + 20, '5.5 wave = saw adds the second harmonic at 1760 Hz (' + t880.db[1].toFixed(0) + ' -> ' + saw.db[0].toFixed(0) + ' dB)');
	await preview(A.page, th, { volume: 0 });
	await wait(A.page, 500);
	const [quietA, quietB] = await Promise.all([h.audioMetrics(A, 400), h.audioMetrics(B, 400)]);
	h.check(quietA.peak < SILENT && quietB.peak < SILENT, '5.6 volume 0 silences it on A and B (' + quietA.peak.toFixed(5) + ' / ' + quietB.peak.toFixed(5) + ')');
	h.check((await undoLen(A.page)) === undoT, '5.7 none of those previews entered history (undo ' + undoT + ')');
	await setParams(A.page, th, { volume: 0.5 });
	await wait(A.page, 700);
	const afterT = await Promise.all([docOf(A.page, th), docOf(B.page, th), undoLen(A.page)]);
	h.check(afterT[2] === undoT + 1 && afterT[0].volume === 0.5 && afterT[0].pitch === 880 && afterT[1].volume === 0.5 && afterT[1].pitch === 880, '5.8 a real setParams is one entry, and on desktop (no VR hand) nothing overwrote the written pose (' + JSON.stringify({ pitch: afterT[0].pitch, volume: afterT[0].volume }) + ')');
	await setParams(A.page, th, { volume: 0 });

	console.log('\n=== 6. a late joiner walks into the finished rig ===');
	await setParams(A.page, lp.looper, { play: true });
	await inPage(A.page, 'mc.setBpm(120); mc.playTransport(); return 1');
	const C = await h.setupPage(browser, 'C', { audio: true });
	await h.installModule(C, 'music-voice');
	await inPage(C.page, SINK);
	await h.connect(C, A);
	await h.eventually(() => docOf(C.page, lp.looper).then((d) => d?.loop ?? null), (v) => v === loop1.loop, '6.1 C holds the looper\'s loop hash and bar from the handshake');
	await h.eventually(() => handleOf(C.page, lp.looper, 'return h.buffer && h.doc.loop === arg.hash ? h.trim.edge : -1', { hash: loop1.loop }).catch(() => -1), (v) => v === trimA.edge, '6.2 C pulled the bytes and cut the same samples', 25000);
	await wait(C.page, 500);
	const [oa2, oc] = await Promise.all([onsets(A, 4600), onsets(C, 4600)]);
	const ga2 = grid(oa2.onsets, BAR_MS), gc = grid(oc.onsets, BAR_MS);
	h.check(oc.onsets.length >= 2 && gc.maxDev < 25 && phaseGap(ga2.phase, gc.phase, BAR_MS) < 40, '6.3 C plays the loop on the grid, IN PHASE with A (' + phaseGap(ga2.phase, gc.phase, BAR_MS).toFixed(1) + ' ms apart, ' + oc.onsets.length + ' onsets, max deviation ' + gc.maxDev.toFixed(1) + ' ms)');
	const docsC = await Promise.all([docOf(C.page, th), docOf(C.page, rig.mic)]);
	h.check(docsC[0]?.pitch === 880 && isHash(docsC[1]?.lastTake), '6.4 C holds the theremin pose and the mic\'s take hash too');

	await h.finish(browser);
});
