// music-beat-lab test-flight (#23 C2): two people editing the same pattern, and every
// peer's kick landing on the same beat from the same shared transport.
//
// The pattern is a param of the drum machine's device document, so it replicates, saves
// and undoes as one thing; steps are scheduled through the engine's look-ahead scheduler,
// so nothing crosses the wire during playback. Every timing claim here is measured at
// the destination tap as ONSETS against the WALL CLOCK (Date.now), never against tick
// counts - the fixed-timestep lesson - and every peer is read from its own tap.
//
// THE GPU FLAGS ARE PART OF THE MEASUREMENT (h.AUDIO_ARGS) - see music-lab.test.cjs.
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

const K = {
	drums: 'mod-music-lab-drums',
	sampler: 'mod-music-lab-sampler',
	transport: 'mod-music-lab-transport',
	speaker: 'mod-music-lab-speaker'
};
const KICKS = '7000700070007000/0000000000000000/0000000000000000/0000000000000000/0000000000000000/0000000000000000/0000000000000000/0000000000000000';
const BEAT_MS = 500; // 120 bpm

const docOf = (page, uuid) => inPage(page, 'return ad.deviceOf(ad.findDeviceObject(arg))', uuid);
const patternOf = (page, uuid) => docOf(page, uuid).then((d) => d?.params?.pattern ?? null);
const undoLen = (page) => page.evaluate(() => { let n = 0; window.__stores.history.undoStack.subscribe((v) => (n = v.length))(); return n; });
const bpmOf = (page) => inPage(page, 'return mc.transportNow().bpm');
const playingOf = (page) => inPage(page, 'return mc.transportNow().playing');
/** the click seam: the module's registered handler, called with the exact mesh the way
 * core's tap / raycast would (music-vr-patch's precedent) @param {any} page @param {string} uuid @param {string} name */
const clickMesh = (page, uuid, name) =>
	inPage(page, "const o = ad.findDeviceObject(arg.uuid); const mesh = o?.getObjectByName(arg.name); if (!mesh) return { took: false, missing: true }; return { took: s.moduleSDK.moduleClickHandlers.some((fn) => fn(mesh)) }", { uuid, name });

/**
 * Onsets at this peer's tap for `ms`, SAMPLE-ACCURATE: a big analyser window (8192 samples,
 * ~186 ms) is chained off every tapped analyser, and each read scans only the samples that
 * arrived since the previous read, in 64-sample chunks, back-dating a threshold crossing
 * by its offset inside the window. So a JavaScript loop that stalls under CPU load (this
 * box is shared) still yields the true onset time - a measurement of the SCHEDULER, not of
 * setTimeout. Threshold: 35% of the loudest chunk seen (re-arm below 12%). Returns the
 * onsets (Date.now ms), the peak, and the read count.
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
			return { src: t.analyser, mine, sr: t.context.sampleRate, buf: new Float32Array(N), lastRead: 0 };
		});
		/** @type {{t: number, v: number}[]} */
		const chunks = [];
		const t0 = Date.now();
		let lastLoop = performance.now();
		while (Date.now() - t0 < ms) {
			const now = performance.now();
			const wall = Date.now();
			const advanced = Math.min(N, Math.round(((now - lastLoop) / 1000) * taps[0].sr) + 256);
			lastLoop = now;
			/** the loudest tap per chunk position */
			const merged = new Float32Array(Math.ceil(advanced / CHUNK));
			for (const tap of taps) {
				tap.mine.getFloatTimeDomainData(tap.buf);
				const from = N - advanced;
				for (let c = 0; c < merged.length; c++) {
					const a = from + c * CHUNK;
					const b = Math.min(N, a + CHUNK);
					let sum = 0;
					for (let i = a; i < b; i++) sum += tap.buf[i] * tap.buf[i];
					merged[c] = Math.max(merged[c], Math.sqrt(sum / Math.max(1, b - a)));
				}
			}
			for (let c = 0; c < merged.length; c++) {
				const endIndex = N - advanced + (c + 1) * CHUNK;
				chunks.push({ t: wall - ((N - endIndex) / taps[0].sr) * 1000, v: merged[c] });
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
			if (armed && c.v >= high) {
				if (c.t - last > 120) out.push(Math.round(c.t));
				last = c.t;
				armed = false;
			} else if (!armed && c.v <= low) armed = true;
		}
		return { onsets: out, peak, reads: chunks.length };
	}, ms);

/** the phase of a set of onsets on a period grid, in ms, and how far each strays from it */
function grid(times, period) {
	if (times.length < 2) return { phase: NaN, maxDev: NaN, spacing: [] };
	const first = times[0];
	const rel = times.map((t) => t - first);
	// the phase is the circular mean of (t mod period)
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

const wav = () => {
	const sr = 22050, n = sr;
	const pcm = new Int16Array(n);
	for (let i = 0; i < n; i++) pcm[i] = Math.round(Math.sin((i / sr) * 2 * Math.PI * 330) * 12000 * Math.exp((-i / sr) * 6));
	const buf = new ArrayBuffer(44 + n * 2);
	const v = new DataView(buf);
	const w = (o, str) => { for (let i = 0; i < str.length; i++) v.setUint8(o + i, str.charCodeAt(i)); };
	w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
	v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, n * 2, true);
	new Int16Array(buf, 44).set(pcm);
	return Array.from(new Uint8Array(buf));
};

h.run(async () => {
	const browser = await h.launch({ args: h.AUDIO_ARGS });
	const A = await h.setupPage(browser, 'A', { audio: true });
	const B = await h.setupPage(browser, 'B', { audio: true });
	await h.installModule(A, 'music-lab');
	await h.installModule(B, 'music-lab');
	await h.connect(A, B);

	console.log('\n=== 1. the rig: four devices on A, held and BUILT on B ===');
	const kindsA = await inPage(A.page, 'return ad.devicesDebug().kinds');
	h.check([K.drums, K.sampler, K.transport].every((k) => kindsA.includes(k)), '1.1 the beat lab kinds register beside the speaker and the piano (' + kindsA.length + ' kinds)');
	// the speaker sits AT the listener (the camera), so the tap reads the rig loud and clear
	const ids = await inPage(A.page, "const cam = await new Promise((r) => s.globalCamera.subscribe((c) => r(c))()); const at = cam.getWorldPosition(new s.THREE.Vector3()).toArray(); const t = ad.addDevice(arg.transport, { position: [-1.6, 0.5, -2] }); const d = ad.addDevice(arg.drums, { position: [0, 0.8, -2] }); const sm = ad.addDevice(arg.sampler, { position: [1.2, 0.8, -2] }); const sp = ad.addDevice(arg.speaker, { position: at }); ap.addCable({ from: { uuid: d.uuid, port: 'out' }, to: { uuid: sp.uuid, port: 'in' } }); ap.addCable({ from: { uuid: sm.uuid, port: 'out' }, to: { uuid: sp.uuid, port: 'in' } }); return { t: t.uuid, d: d.uuid, sm: sm.uuid, sp: sp.uuid }", K);
	await inPage(A.page, 'ad.setDeviceFor(arg.d, { params: { pattern: arg.p } }); return 1', { d: ids.d, p: KICKS });
	await h.eventually(() => inPage(B.page, 'return ad.devicesDebug().built.map((b) => b.builtAs).sort().join(",")'), (v) => v === [K.drums, K.sampler, K.speaker, K.transport].sort().join(','), '1.2 B built its own copy of all four (' + Object.values(K).length + ' kinds)', 15000);
	await h.eventually(() => patternOf(B.page, ids.d), (v) => v === KICKS, '1.3 the pattern reached B inside the device document - no channel of its own');
	const facesB = await inPage(B.page, "const t = ad.findDeviceObject(arg.t); const d = ad.findDeviceObject(arg.d); let lit = 0; d.traverse((c) => { if (c.name.startsWith('step-') && c.material?.color?.getHex?.() !== 0x4b4b52) lit++; }); return { display: !!t?.getObjectByName('tp-display')?.material?.map, lit, cells: d.children.filter((c) => c.name.startsWith('step-')).length }", ids);
	h.check(facesB.display && facesB.lit === 4 && facesB.cells === 128, '1.4 B drew its own transport display and lit the four kick cells of the replicated grid (' + JSON.stringify(facesB) + ')');

	console.log('\n=== 2. editing: a click is one write, a drag is ONE write, one undo ===');
	const undo0 = await undoLen(A.page);
	const took = await clickMesh(A.page, ids.d, 'step-1-4');
	h.check(took.took === true, '2.1 a step cell takes the click (the module consumed it, no selection)');
	const rowNow = await inPage(A.page, "const hd = ad.deviceHandle(arg); const d = ad.findDeviceObject(arg); return { row: hd.h.rows[1], lit: d.getObjectByName('step-1-4').material?.color?.getHex?.() !== 0x4b4b52, doc: ad.deviceOf(d).params.pattern.split('/')[1] }", ids.d);
	h.check(rowNow.row === '0000700000000000' && rowNow.lit && rowNow.doc === '0000000000000000', '2.2 the cell lights LOCALLY at once (handle + paint) while the DOCUMENT is still untouched - the stroke previews like a knob scrub (' + JSON.stringify(rowNow) + ')');
	await A.page.waitForTimeout(1300);
	const afterClick = await Promise.all([patternOf(A.page, ids.d), undoLen(A.page)]);
	h.check(afterClick[0].split('/')[1] === '0000700000000000' && afterClick[1] === undo0 + 1, '2.3 the stroke commits ONE write when it goes idle (undo ' + undo0 + ' -> ' + afterClick[1] + ')');
	await h.eventually(() => patternOf(B.page, ids.d), (v) => v === afterClick[0], '2.4 and B holds the same pattern');
	// a DRAG: click one cell, then sweep the mouse across three more inside the idle window -
	// the frame task follows api.pointerRay() over the grid
	const cells = await inPage(A.page, "const d = ad.findDeviceObject(arg); const v = new s.THREE.Vector3(); return [0, 1, 2, 3].map((step) => d.getObjectByName('step-3-' + step).getWorldPosition(v.clone()).toArray())", ids.d);
	const points = [];
	for (const world of cells) points.push(await h.projectPoint(A.page, world));
	const undo1 = await undoLen(A.page);
	await A.page.mouse.move(points[0].x, points[0].y);
	await clickMesh(A.page, ids.d, 'step-3-0');
	for (let i = 1; i < 4; i++) {
		await A.page.mouse.move(points[i].x, points[i].y, { steps: 4 });
		await A.page.waitForTimeout(120);
	}
	const during = await inPage(A.page, "return { row: ad.deviceHandle(arg).h.rows[3], doc: ad.deviceOf(ad.findDeviceObject(arg)).params.pattern.split('/')[3] }", ids.d);
	h.check(during.row === '7777000000000000' && during.doc === '0000000000000000', '2.5 the sweep painted all four cells LOCALLY before anything was written (' + JSON.stringify(during) + ')');
	await A.page.waitForTimeout(1300);
	const afterDrag = await Promise.all([patternOf(A.page, ids.d), undoLen(A.page)]);
	h.check(afterDrag[0].split('/')[3] === '7777000000000000' && afterDrag[1] === undo1 + 1, '2.6 the whole drag is ONE write and ONE undo entry (undo ' + undo1 + ' -> ' + afterDrag[1] + ')');
	await h.eventually(() => patternOf(B.page, ids.d), (v) => v === afterDrag[0], '2.7 replicated to B as one document');
	await A.page.evaluate(() => window.__stores.history.undo());
	await A.page.waitForTimeout(500);
	const undone = await Promise.all([patternOf(A.page, ids.d), patternOf(B.page, ids.d)]);
	h.check(undone[0].split('/')[3] === '0000000000000000' && undone[0].split('/')[1] === '0000700000000000', '2.8 one Ctrl+Z reverts the whole drag and leaves the earlier click (' + undone[0].split('/')[3] + ')');
	h.check(undone[1] === undone[0], '2.9 and B follows the undo');
	// back to kicks only for the timing sections
	await inPage(A.page, 'ad.setDeviceFor(arg.d, { params: { pattern: arg.p } }); return 1', { d: ids.d, p: KICKS });
	await h.eventually(() => patternOf(B.page, ids.d), (v) => v === KICKS, '2.10 (premise) kicks-only pattern on both again');

	console.log('\n=== 3. play from the transport face: every peer\'s kick on the same beat ===');
	await inPage(A.page, 'mc.setBpm(120); return 1');
	const play = await clickMesh(A.page, ids.t, 'tp-play');
	h.check(play.took === true, '3.1 the Play button takes the click');
	await h.eventually(() => playingOf(B.page), (v) => v === true, '3.2 the SHARED transport runs on B too');
	await A.page.waitForTimeout(700);
	const [oa, ob] = await Promise.all([onsets(A, 2300), onsets(B, 2300)]);
	h.check(oa.peak > 0.002 && ob.peak > 0.002, '3.3 both taps hear the kicks (peak A ' + oa.peak.toFixed(4) + ', B ' + ob.peak.toFixed(4) + ')');
	h.check(oa.onsets.length >= 4 && oa.onsets.length <= 5 && ob.onsets.length >= 4 && ob.onsets.length <= 5, '3.4 four to five kicks in 2.3 s on each (' + oa.onsets.length + '/' + ob.onsets.length + ')');
	const ga = grid(oa.onsets, BEAT_MS), gb = grid(ob.onsets, BEAT_MS);
	h.check(ga.maxDev < 25 && gb.maxDev < 25, '3.5 each peer is on a 500 ms grid (max deviation A ' + ga.maxDev.toFixed(1) + ' ms, B ' + gb.maxDev.toFixed(1) + ' ms)');
	const gap = phaseGap(ga.phase, gb.phase, BEAT_MS);
	h.check(gap < 35, '3.6 and the two grids are IN PHASE - B synthesizes the same beat from the same transport (' + gap.toFixed(1) + ' ms apart)');

	console.log('\n=== 4. a late joiner lands in phase ===');
	const C = await h.setupPage(browser, 'C', { audio: true });
	await h.installModule(C, 'music-lab');
	await h.connect(C, A);
	await h.eventually(() => patternOf(C.page, ids.d), (v) => v === KICKS, '4.1 C holds the pattern from the handshake');
	await h.eventually(() => playingOf(C.page), (v) => v === true, '4.2 and the running transport');
	await C.page.waitForTimeout(1200);
	const diagC = await inPage(C.page, "const hd = ad.deviceHandle(arg.d); return { built: ad.devicesDebug().built.map((b) => b.builtAs).sort(), cables: ap.patchDebug ? ap.patchDebug().cables?.length ?? null : null, hits: hd?.h?.hits?.length ?? null, ctx: s.audioEngine.ensureAudioContext()?.state, clock: (() => { try { return JSON.stringify(mc.clockDebug()).slice(0, 300); } catch (e) { return String(e); } })() }", ids);
	console.log('  C diag ' + JSON.stringify(diagC));
	const [oa2, oc] = await Promise.all([onsets(A, 2300), onsets(C, 2300)]);
	console.log('  C tap peak ' + oc.peak.toFixed(5) + ' onsets ' + oc.onsets.length + ' reads ' + oc.reads);
	const gc = grid(oc.onsets, BEAT_MS), ga2 = grid(oa2.onsets, BEAT_MS);
	h.check(oc.onsets.length >= 4 && gc.maxDev < 25, '4.3 C\'s kicks sit on the grid (' + oc.onsets.length + ' onsets, max deviation ' + gc.maxDev.toFixed(1) + ' ms)');
	const gapC = phaseGap(ga2.phase, gc.phase, BEAT_MS);
	h.check(gapC < 40, '4.4 in phase with A (' + gapC.toFixed(1) + ' ms apart) - the joiner\'s first hit is the NEXT beat, never a catch-up');

	console.log('\n=== 5. thirty seconds across bar boundaries, no drift ===');
	const long = await onsets(A, 30000);
	const gl = grid(long.onsets, BEAT_MS);
	h.check(long.onsets.length >= 58 && long.onsets.length <= 61, '5.1 ' + long.onsets.length + ' kicks in 30 s (60 expected)');
	h.check(gl.maxDev < 30, '5.2 the last kick is as close to the grid as the first - max deviation ' + gl.maxDev.toFixed(1) + ' ms over 30 s, measured on the wall clock');
	const worst = Math.max(...gl.spacing.map((x) => Math.abs(x - BEAT_MS)));
	h.check(worst < 40, '5.3 no beat is early or late by more than 40 ms (worst ' + worst.toFixed(1) + ')');

	console.log('\n=== 6. the scheduler holds under a throttled tab ===');
	const cdp = await A.page.context().newCDPSession(A.page);
	await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
	const slow = await onsets(A, 3300);
	await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
	const gs = grid(slow.onsets, BEAT_MS);
	h.check(slow.onsets.length >= 5 && slow.onsets.length <= 7, '6.1 kicks keep coming with the CPU throttled 4x (' + slow.onsets.length + ' in 3.3 s)');
	h.check(gs.maxDev < 40, '6.2 and stay on the wall-clock grid (max deviation ' + gs.maxDev.toFixed(1) + ' ms) - the look-ahead, not the tick rate, places them');

	console.log('\n=== 7. the sampler: a sample dropped from the Explorer, heard on every peer ===');
	const stop = await clickMesh(A.page, ids.t, 'tp-play');
	h.check(stop.took === true, '7.0 (premise) Play again stops the transport');
	await h.eventually(() => playingOf(B.page), (v) => v === false, '7.1 stopped on B as well');
	const dropped = await A.page.evaluate(async ({ bytes, uuid }) => {
		const item = await window.__stores.explorer.addItemFromBytes(new Uint8Array(bytes).buffer, 'ping.wav', null);
		const sm = window.__stores.audioDevices.findDeviceObject(uuid);
		const pad = sm.getObjectByName('spad-5');
		const took = window.__stores.moduleSDK.moduleDropHandlers.some((fn) => fn(pad, { id: item.id, name: item.name, kind: 'audio', hash: item.hash }, { object: sm, hit: pad }));
		return { took, hash: item.hash };
	}, { bytes: wav(), uuid: ids.sm });
	h.check(dropped.took === true, '7.2 the module takes an audio item dropped on a pad (registerDropHandler)');
	const padsA = await docOf(A.page, ids.sm).then((d) => JSON.parse(d.params.pads || '{}'));
	h.check(padsA['5']?.sample === dropped.hash && padsA['5']?.name === 'ping.wav', '7.3 pad 6 holds the sample HASH in the device document');
	await h.eventually(() => docOf(B.page, ids.sm).then((d) => JSON.parse(d?.params?.pads || '{}')['5']?.sample ?? null), (v) => v === dropped.hash, '7.4 B holds it too');
	await h.eventually(() => inPage(B.page, "return ad.deviceHandle(arg)?.h?.buffers?.size ?? 0", ids.sm), (v) => v >= 1, '7.5 B pulled and decoded the bytes by hash (api.audio.sample)', 20000);
	const quietB = await onsets(B, 400);
	const watchB = onsets(B, 900);
	await A.page.waitForTimeout(100);
	const hit = await clickMesh(A.page, ids.sm, 'spad-5');
	const heardB = await watchB;
	h.check(hit.took === true && heardB.onsets.length === 1 && heardB.peak > Math.max(0.002, quietB.peak * 3), '7.6 a pad press on A is HEARD once on B - the note replicated, B played its own copy of the sample (peak ' + heardB.peak.toFixed(4) + ')');

	console.log('\n=== 8. the transport face: BPM buttons and tap tempo write the SHARED clock ===');
	await clickMesh(A.page, ids.t, 'tp-bpm+');
	await h.eventually(() => bpmOf(B.page), (v) => v === 125, '8.1 bpm+ is 125 on B');
	await clickMesh(A.page, ids.t, 'tp-bpm-');
	await h.eventually(() => bpmOf(B.page), (v) => v === 120, '8.2 bpm- back to 120 on B');
	for (let i = 0; i < 4; i++) {
		await clickMesh(A.page, ids.t, 'tp-tap');
		if (i < 3) await A.page.waitForTimeout(400);
	}
	const tapped = await Promise.all([bpmOf(A.page), bpmOf(B.page)]);
	h.check(Math.abs(tapped[0] - 150) <= 6 && tapped[0] === tapped[1], '8.3 four taps 400 ms apart set ~150 bpm on both (' + tapped[0] + '/' + tapped[1] + ')');
	await inPage(A.page, 'mc.setBpm(120); return 1');

	await h.finish(browser);
});
