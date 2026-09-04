// music-dj test-flight (#23 C4): two decks and a crossfader, the deck's position derived by
// every peer from three replicated numbers, a scrub as previews + ONE commit.
//
// Every audible claim is read at the destination tap (spectrum: the strongest bin and the
// level at each deck's tone); every position claim is the module's own derivation read on
// two peers at the same instant. THE GPU FLAGS ARE PART OF THE MEASUREMENT (h.AUDIO_ARGS).
const h = require('./helpers.cjs');

const inPage = (page, body, arg) =>
	page.evaluate(
		([src, a]) =>
			Object.getPrototypeOf(async function () {}).constructor('s', 'ad', 'ap', 'arg', src)(window.__stores, window.__stores.audioDevices, window.__stores.audioPatch, a),
		[body, arg ?? null]
	);

const K = { deck: 'mod-music-dj-deck', xf: 'mod-music-dj-crossfader' };
const SINK = "ad.registerAudioDevice({ kind: 'dj-sink', label: 'Sink', ports: { in: [{ id: 'in', kind: 'audio' }], out: [] }, params: [], build(ctx) { const g = ctx.createGain(); g.connect(window.__stores.audioEngine.bus('instruments')); return { input: g, dispose() { g.disconnect(); } }; } }); return 1";

const docOf = (page, uuid) => inPage(page, 'return ad.deviceOf(ad.findDeviceObject(arg))?.params ?? null', uuid);
const posOf = (page, uuid) => inPage(page, 'const hd = ad.deviceHandle(arg); return hd?.h ? { pos: hd.h.position(), at: Date.now(), decoded: !!hd.h.buffer, playing: !!hd.h.doc.playing } : null', uuid);
const undoLen = (page) => page.evaluate(() => { let n = 0; window.__stores.history.undoStack.subscribe((v) => (n = v.length))(); return n; });
const clickMesh = (page, uuid, name) => inPage(page, "const o = ad.findDeviceObject(arg.uuid); const mesh = o?.getObjectByName(arg.name); if (!mesh) return { took: false, missing: true }; return { took: s.moduleSDK.moduleClickHandlers.some((fn) => fn(mesh)) }", { uuid, name });
/** the tap's spectrum: the strongest bin and the dB at two tones, averaged over ~20 reads */
const spectrum = (page, tones) =>
	page.evaluate(async (tones) => {
		const t = window.__audioTap.all()[0];
		const freq = new Float32Array(t.analyser.frequencyBinCount);
		const binHz = t.context.sampleRate / t.analyser.fftSize;
		const acc = new Float32Array(freq.length);
		let reads = 0;
		for (let i = 0; i < 20; i++) {
			await new Promise((r) => setTimeout(r, 20));
			t.analyser.getFloatFrequencyData(freq);
			for (let b = 0; b < freq.length; b++) acc[b] += Number.isFinite(freq[b]) ? freq[b] : -160;
			reads++;
		}
		let best = -Infinity, bestBin = 0;
		for (let b = 1; b < acc.length; b++) if (acc[b] > best) { best = acc[b]; bestBin = b; }
		const at = (hz) => { const b = Math.round(hz / binHz); let m = -Infinity; for (let k = b - 1; k <= b + 1; k++) m = Math.max(m, acc[k] / reads); return m; };
		return { peakHz: bestBin * binHz, db: tones.map(at) };
	}, tones);
const wav = (hz) => {
	const sr = 22050, n = sr * 6;
	const pcm = new Int16Array(n);
	for (let i = 0; i < n; i++) pcm[i] = Math.round(Math.sin((i / sr) * 2 * Math.PI * hz) * 9000);
	const buf = new ArrayBuffer(44 + n * 2);
	const v = new DataView(buf);
	const w = (o, str) => { for (let i = 0; i < str.length; i++) v.setUint8(o + i, str.charCodeAt(i)); };
	w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
	v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, n * 2, true);
	new Int16Array(buf, 44).set(pcm);
	return Array.from(new Uint8Array(buf));
};
/** drop a WAV on a deck through the module's drop handler; returns the item hash */
const load = (page, uuid, hz, name) =>
	page.evaluate(async ({ bytes, uuid, name }) => {
		const item = await window.__stores.explorer.addItemFromBytes(new Uint8Array(bytes).buffer, name, null);
		const deck = window.__stores.audioDevices.findDeviceObject(uuid);
		const took = window.__stores.moduleSDK.moduleDropHandlers.some((fn) => fn(deck.getObjectByName('jog'), { id: item.id, name: item.name, kind: 'audio', hash: item.hash }, { object: deck }));
		return { took, hash: item.hash };
	}, { bytes: wav(hz), uuid, name });
/** the two peers' derived positions at (nearly) the same instant, normalised to A's read time */
async function agree(pa, pb, ua, ub) {
	const [a, b] = await Promise.all([posOf(pa, ua), posOf(pb, ub)]);
	if (!a || !b) return { gap: NaN, a, b };
	const rate = 1;
	const bAtA = b.pos + ((a.at - b.at) / 1000) * rate * (b.playing ? 1 : 0);
	return { gap: Math.abs(a.pos - bAtA) * 1000, a, b };
}

h.run(async () => {
	const browser = await h.launch({ args: h.AUDIO_ARGS });
	const A = await h.setupPage(browser, 'A', { audio: true });
	const B = await h.setupPage(browser, 'B', { audio: true });
	await h.installModule(A, 'music-dj');
	await h.installModule(B, 'music-dj');
	await inPage(A.page, SINK);
	await inPage(B.page, SINK);
	await h.connect(A, B);

	console.log('\n=== 1. the booth: two decks into a crossfader into a sink, tracks by hash ===');
	const kinds = await inPage(A.page, 'return ad.devicesDebug().kinds');
	h.check(kinds.includes(K.deck) && kinds.includes(K.xf), '1.1 deck and crossfader kinds register (' + kinds.filter((k) => k.startsWith('mod-music-dj')).join(', ') + ')');
	const ids = await inPage(A.page, "const l = ad.addDevice(arg.deck, { position: [-0.9, 0.8, -2] }); const r = ad.addDevice(arg.deck, { position: [0.9, 0.8, -2] }); const x = ad.addDevice(arg.xf, { position: [0, 0.8, -1.6] }); const sk = ad.addDevice('dj-sink', { position: [0, 0, -3] }); ap.addCable({ from: { uuid: l.uuid, port: 'out' }, to: { uuid: x.uuid, port: 'a' } }); ap.addCable({ from: { uuid: r.uuid, port: 'out' }, to: { uuid: x.uuid, port: 'b' } }); ap.addCable({ from: { uuid: x.uuid, port: 'out' }, to: { uuid: sk.uuid, port: 'in' } }); return { l: l.uuid, r: r.uuid, x: x.uuid, sk: sk.uuid }", K);
	const left = await load(A.page, ids.l, 330, 'left.wav');
	const right = await load(A.page, ids.r, 660, 'right.wav');
	h.check(left.took && right.took, '1.2 a WAV dropped on a deck is taken by the module (registerDropHandler)');
	const docL = await docOf(A.page, ids.l);
	h.check(docL.track === left.hash && docL.playing === false && docL.offset === 0, '1.3 the deck document holds the track HASH, stopped at 0');
	await h.eventually(() => docOf(B.page, ids.r).then((d) => d?.track ?? null), (v) => v === right.hash, '1.4 B holds the right deck\'s hash');
	await h.eventually(() => posOf(B.page, ids.l).then((p) => p?.decoded ?? false), (v) => v === true, '1.5 B pulled and decoded the left track by hash', 20000);
	await inPage(A.page, 'ad.setDeviceFor(arg, { params: { position: -1 } }); return 1', ids.x);
	// 23-D1: both tracks are SCENE ASSETS by hash (spec.assets), so an export carries them
	await h.eventually(() => inPage(A.page, "let list; s.sceneAssets.sceneAssets.subscribe((v) => (list = v))(); return list.filter((e) => e.group === 'audio').map((e) => e.hash)"), (list) => list.includes(left.hash) && list.includes(right.hash), '1.6 both decks declare their track to the Scene manifest by hash', 6000);

	console.log('\n=== 2. play: the position is derived by every peer, and heard ===');
	const play = await clickMesh(A.page, ids.l, 'dk-play');
	h.check(play.took === true, '2.1 the Play button takes the click');
	await h.eventually(() => docOf(B.page, ids.l).then((d) => d?.playing ?? null), (v) => v === true, '2.2 B\'s document says playing, with startedAt');
	await A.page.waitForTimeout(600);
	const [spA, spB] = await Promise.all([spectrum(A.page, [330, 660]), spectrum(B.page, [330, 660])]);
	h.check(Math.abs(spA.peakHz - 330) < 15 && Math.abs(spB.peakHz - 330) < 15, '2.3 both taps hear the left deck\'s 330 Hz (peak A ' + spA.peakHz.toFixed(0) + ', B ' + spB.peakHz.toFixed(0) + ')');
	const g1 = await agree(A.page, B.page, ids.l, ids.l);
	h.check(g1.gap < 60, '2.4 the two peers derive the same playhead (' + g1.gap.toFixed(1) + ' ms apart)');

	console.log('\n=== 3. a scrub on the platter: previews while it moves, ONE commit, one undo ===');
	// the platter's rim, four points 30 degrees apart, projected to the screen
	const rim = await inPage(A.page, "const d = ad.findDeviceObject(arg); const jog = d.getObjectByName('jog'); const v = new s.THREE.Vector3(); return [0, 30, 60, 90].map((deg) => { const a = (deg * Math.PI) / 180; return jog.localToWorld(v.set(Math.sin(a) * 0.12, 0.02, -Math.cos(a) * 0.12)).toArray(); })", ids.l);
	const pts = [];
	for (const world of rim) pts.push(await h.projectPoint(A.page, world));
	const undo0 = await undoLen(A.page);
	const offsetBefore = (await docOf(B.page, ids.l)).offset;
	await A.page.mouse.move(pts[0].x, pts[0].y);
	const jog = await clickMesh(A.page, ids.l, 'jog');
	h.check(jog.took === true, '3.1 the platter takes the click and opens a gesture');
	for (let i = 1; i < 4; i++) {
		await A.page.mouse.move(pts[i].x, pts[i].y, { steps: 5 });
		await A.page.waitForTimeout(140);
	}
	const mid = await Promise.all([docOf(B.page, ids.l), undoLen(A.page)]);
	h.check(mid[0].offset !== offsetBefore && mid[1] === undo0, '3.2 while the hand moves B already follows the PREVIEWS (offset ' + Number(offsetBefore).toFixed(3) + ' -> ' + Number(mid[0].offset).toFixed(3) + ') and nothing entered history (undo ' + undo0 + ')');
	await A.page.waitForTimeout(1100);
	const after = await undoLen(A.page);
	h.check(after === undo0 + 1, '3.3 the gesture commits ONE write, one undo entry (' + undo0 + ' -> ' + after + ')');
	const g2 = await agree(A.page, B.page, ids.l, ids.l);
	h.check(g2.gap < 60, '3.4 after the scrub the peers agree on the position again (' + g2.gap.toFixed(1) + ' ms apart)');
	await A.page.evaluate(() => window.__stores.history.undo());
	await A.page.waitForTimeout(300);
	const undone = await docOf(A.page, ids.l);
	h.check(Math.abs(undone.offset - offsetBefore) < 1e-6, '3.5 one undo puts the offset back where the scrub started (' + Number(undone.offset).toFixed(3) + ')');

	console.log('\n=== 4. the crossfader: each extreme is ONE deck\'s signal ===');
	await clickMesh(A.page, ids.r, 'dk-play');
	await h.eventually(() => docOf(B.page, ids.r).then((d) => d?.playing ?? null), (v) => v === true, '4.0 (premise) the right deck plays too');
	await A.page.waitForTimeout(400);
	const atA = await spectrum(A.page, [330, 660]);
	h.check(atA.db[0] - atA.db[1] > 30, '4.1 at -1 only the left deck is heard (330 Hz is ' + (atA.db[0] - atA.db[1]).toFixed(0) + ' dB above 660)');
	await inPage(A.page, 'ad.setDeviceFor(arg, { params: { position: 1 } }); return 1', ids.x);
	await A.page.waitForTimeout(400);
	const [atB, atBB] = await Promise.all([spectrum(A.page, [330, 660]), spectrum(B.page, [330, 660])]);
	h.check(atB.db[1] - atB.db[0] > 30 && atBB.db[1] - atBB.db[0] > 30, '4.2 at +1 only the right deck, on A and on B (' + (atB.db[1] - atB.db[0]).toFixed(0) + ' / ' + (atBB.db[1] - atBB.db[0]).toFixed(0) + ' dB)');
	await inPage(A.page, "ad.setDeviceFor(arg, { params: { position: 0, curve: 'power' } }); return 1", ids.x);
	await A.page.waitForTimeout(400);
	const centre = await spectrum(A.page, [330, 660]);
	h.check(Math.abs(centre.db[0] - centre.db[1]) < 6, '4.3 centred, constant power: both within 6 dB (' + (centre.db[0] - centre.db[1]).toFixed(1) + ')');
	// the fader gesture: drag the knob to the left end
	const railPts = await inPage(A.page, "const x = ad.findDeviceObject(arg); const v = new s.THREE.Vector3(); return [0, -0.09, -0.17].map((dx) => x.localToWorld(v.set(dx, 0.06, 0)).toArray())", ids.x);
	const rp = [];
	for (const world of railPts) rp.push(await h.projectPoint(A.page, world));
	const undoX = await undoLen(A.page);
	await A.page.mouse.move(rp[0].x, rp[0].y);
	await clickMesh(A.page, ids.x, 'xf-knob');
	for (let i = 1; i < 3; i++) { await A.page.mouse.move(rp[i].x, rp[i].y, { steps: 5 }); await A.page.waitForTimeout(140); }
	await A.page.waitForTimeout(1100);
	const faded = await Promise.all([docOf(B.page, ids.x), undoLen(A.page)]);
	h.check(faded[0].position <= -0.8 && faded[1] === undoX + 1, '4.4 dragging the knob to the left end is one commit, replicated (position ' + faded[0].position + ', undo ' + undoX + ' -> ' + faded[1] + ')');

	console.log('\n=== 5. the pitch fader re-bases the position so it stays continuous everywhere ===');
	const before5 = await posOf(A.page, ids.l);
	const pitchPts = await inPage(A.page, "const d = ad.findDeviceObject(arg); const v = new s.THREE.Vector3(); return [0, 0.06, 0.11].map((dx) => d.localToWorld(v.set(0.16 + dx, 0.09, -0.12)).toArray())", ids.l);
	const pp = [];
	for (const world of pitchPts) pp.push(await h.projectPoint(A.page, world));
	const undoP = await undoLen(A.page);
	await A.page.mouse.move(pp[0].x, pp[0].y);
	await clickMesh(A.page, ids.l, 'dk-pitch');
	for (let i = 1; i < 3; i++) { await A.page.mouse.move(pp[i].x, pp[i].y, { steps: 5 }); await A.page.waitForTimeout(140); }
	await A.page.waitForTimeout(1100);
	const pitched = await Promise.all([docOf(A.page, ids.l), docOf(B.page, ids.l), undoLen(A.page), posOf(A.page, ids.l)]);
	h.check(pitched[0].rate > 1.3 && pitched[0].rate === pitched[1].rate, '5.1 the fader at the right end is ~1.5x on both (' + pitched[0].rate + ')');
	h.check(pitched[2] === undoP + 1 && typeof pitched[0].startedAt === 'number' && pitched[0].startedAt > before5.at - 5000, '5.2 rate, offset and startedAt commit together as ONE write (re-based, undo ' + undoP + ' -> ' + pitched[2] + ')');
	// the track is 6 s and loops, so the playhead is read on the circle: it must sit between
	// 'elapsed at 1x' and 'elapsed at the new rate' past where it was, never jump elsewhere
	const DUR = 6;
	const elapsed = (pitched[3].at - before5.at) / 1000;
	const lo = (before5.pos + elapsed * 1.0) % DUR, hi = (before5.pos + elapsed * pitched[0].rate) % DUR;
	const circ = (from, to) => ((to - from) % DUR + DUR) % DUR;
	const arc = circ(lo, hi), where = circ(lo, pitched[3].pos);
	h.check(where >= -0.001 && where <= arc + 0.15, '5.3 the playhead is continuous through the change (' + before5.pos.toFixed(2) + ' -> ' + pitched[3].pos.toFixed(2) + ' s after ' + elapsed.toFixed(2) + ' s; expected between ' + lo.toFixed(2) + ' and ' + hi.toFixed(2) + ')');
	const g3 = await agree(A.page, B.page, ids.l, ids.l);
	h.check(g3.gap < 120, '5.4 and the peers still agree (' + g3.gap.toFixed(1) + ' ms apart at 1.5x)');

	console.log('\n=== 6. a late joiner lands at the right position ===');
	await inPage(A.page, 'ad.setDeviceFor(arg, { params: { position: -1 } }); return 1', ids.x);
	const C = await h.setupPage(browser, 'C', { audio: true });
	await h.installModule(C, 'music-dj');
	await inPage(C.page, SINK);
	await h.connect(C, A);
	await h.eventually(() => docOf(C.page, ids.l).then((d) => d?.playing ?? null), (v) => v === true, '6.1 C holds the playing deck from the handshake');
	await h.eventually(() => posOf(C.page, ids.l).then((p) => p?.decoded ?? false), (v) => v === true, '6.2 C pulled and decoded the track', 20000);
	await C.page.waitForTimeout(400);
	const g4 = await agree(A.page, C.page, ids.l, ids.l);
	h.check(g4.gap < 120, '6.3 C derives the same playhead as A (' + g4.gap.toFixed(1) + ' ms apart)');
	const rateC = (await docOf(C.page, ids.l)).rate;
	const spC = await spectrum(C.page, [330 * rateC, 660]);
	h.check(Math.abs(spC.peakHz - 330 * rateC) < 330 * rateC * 0.04, '6.4 and hears it, at the deck\'s rate (peak ' + spC.peakHz.toFixed(0) + ' Hz for 330 x ' + rateC + ')');

	console.log('\n=== 7. pause freezes the offset, play resumes from it ===');
	await clickMesh(A.page, ids.l, 'dk-play');
	await h.eventually(() => docOf(B.page, ids.l).then((d) => d?.playing ?? null), (v) => v === false, '7.1 B sees the pause');
	const frozen = await docOf(A.page, ids.l);
	await A.page.waitForTimeout(500);
	const still = await posOf(B.page, ids.l);
	h.check(Math.abs(still.pos - frozen.offset) < 0.01, '7.2 paused, the position holds at the frozen offset on B (' + still.pos.toFixed(3) + ')');
	await clickMesh(A.page, ids.l, 'dk-play');
	await A.page.waitForTimeout(400);
	const resumed = await posOf(A.page, ids.l);
	h.check(resumed.playing && resumed.pos > frozen.offset && resumed.pos < frozen.offset + 1.2, '7.3 play resumes from the frozen offset (' + frozen.offset.toFixed(3) + ' -> ' + resumed.pos.toFixed(3) + ')');

	await h.finish(browser);
});
