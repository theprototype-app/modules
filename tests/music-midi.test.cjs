// music-midi test-flight (core roadmap 75 MU1-MU3): a MIDI keyboard plays the Music Lab Piano and
// the Music Voice Synth for as long as a key is down; the core piano roll plays the Synth at a
// note's DRAWN length (its `gate`) on both peers; and the two filter cutoffs declare log ranges.
//
// Needs a core build with Web MIDI input (roadmap 75). The browser's MIDI layer
// is faked in the page (one input the flight writes bytes into); everything after that is the
// real path: core's midiInput routes the key to the target device as a replicated note with
// `gate: 0`, the key-up as `{off: true}`, and the device's onNote holds and releases its voice.
// Measured as SOUND at the destination tap on BOTH peers: a held key still sounds well past the
// piano's own 0.35 s note, and the release silences it.
const h = require('./helpers.cjs');

const inPage = (page, body, arg) =>
	page.evaluate(
		([src, a]) =>
			Object.getPrototypeOf(async function () {}).constructor('s', 'ad', 'ap', 'mi', 'arg', src)(
				window.__stores,
				window.__stores.audioDevices,
				window.__stores.audioPatch,
				window.__stores.midiInput,
				a
			),
		[body, arg ?? null]
	);

const SILENT = 0.001;
const KIND_PIANO = 'mod-music-lab-piano';
const KIND_SPEAKER = 'mod-music-lab-speaker';
const KIND_SYNTH = 'mod-music-voice-synth';

/** a fake MIDI input, installed AFTER boot (midiInput reads navigator at call time) */
const FAKE_MIDI = () => {
	const input = { id: 'fake-in-1', name: 'Fake Keys', manufacturer: 'flight', state: 'connected', type: 'input', onmidimessage: null };
	const access = { inputs: new Map([[input.id, input]]), outputs: new Map(), onstatechange: null };
	window.__fakeMidi = { send: (b) => input.onmidimessage?.({ data: new Uint8Array(b), target: input }) };
	Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: async () => access });
};

const cameraPos = (page) =>
	page.evaluate(
		() => new Promise((r) => window.__stores.globalCamera.subscribe((c) => r(c ? c.getWorldPosition(new window.__stores.THREE.Vector3()).toArray() : null))())
	);
const wait = (page, ms) => page.waitForTimeout(ms);
const peak = async (peer, ms) => (await h.audioMetrics(peer, ms)).peak;

h.run(async () => {
	const browser = await h.launch({ args: h.AUDIO_ARGS });
	const A = await h.setupPage(browser, 'A', { audio: true });
	const B = await h.setupPage(browser, 'B', { audio: true });
	for (const P of [A, B]) {
		await h.installModule(P, 'music-lab');
		await h.installModule(P, 'music-voice');
		await h.installModule(P, 'music-fx');
	}
	await h.connect(A, B);
	const hasMidi = await A.page.evaluate(() => !!window.__stores.midiInput);
	h.check(hasMidi, '0.1 (premise) this core has Web MIDI input (75 MU1)');
	if (!hasMidi) return h.finish(browser);
	await A.page.evaluate(FAKE_MIDI);
	h.check((await inPage(A.page, 'return mi.enableMidi()')) === 'on', '0.2 MIDI connected on A');

	console.log('\n=== 1. the piano holds a key for as long as it is down ===');
	const kinds = await inPage(A.page, 'return ad.devicesDebug().kinds');
	h.check(kinds.includes(KIND_PIANO) && kinds.includes(KIND_SYNTH), '1.0 piano + synth registered');
	const cam = await cameraPos(A.page);
	const rig = await inPage(
		A.page,
		"const p = ad.addDevice('" + KIND_PIANO + "', { position: arg.piano }); const y = ad.addDevice('" + KIND_SYNTH + "', { position: arg.synth }); const k = ad.addDevice('" + KIND_SPEAKER + "', { position: arg.speaker });" +
			"ap.addCable({ from: { uuid: p.uuid, port: 'out' }, to: { uuid: k.uuid, port: 'in' } }); ap.addCable({ from: { uuid: y.uuid, port: 'out' }, to: { uuid: k.uuid, port: 'in' } });" +
			'return { piano: p.uuid, synth: y.uuid, speaker: k.uuid, held: !!ad.deviceSpec(p.userData.device.kind).heldNotes && !!ad.deviceSpec(y.userData.device.kind).heldNotes }',
		{ piano: [cam[0] - 2, cam[1] - 1, cam[2] + 4], synth: [cam[0] + 2, cam[1] - 1, cam[2] + 4], speaker: [cam[0], cam[1], cam[2] + 4] }
	);
	h.check(rig.held, '1.1 both specs declare heldNotes');
	await h.eventually(() => inPage(B.page, 'return ad.devicesDebug().built.map((d) => d.uuid)'), (u) => u.includes(rig.piano) && u.includes(rig.synth), '1.2 B built the rig');
	await wait(A.page, 600);
	h.check((await peak(B, 400)) < SILENT, '1.3 (premise) B is silent');
	await inPage(A.page, 'mi.midiTarget.set(arg)', rig.piano);
	await A.page.evaluate(() => window.__fakeMidi.send([0x90, 69, 110]));
	await wait(A.page, 1200);
	const heldA = await peak(A, 400);
	const heldB = await peak(B, 400);
	h.check(heldA > SILENT * 5 && heldB > SILENT * 5, '1.4 1.2 s into the key A4 still sounds on A and B (0.35 s is the piano\'s own note) (' + heldA.toFixed(4) + ' / ' + heldB.toFixed(4) + ')');
	await A.page.evaluate(() => window.__fakeMidi.send([0x80, 69, 0]));
	await wait(A.page, 1200); // the release tail (0.4 s) and a margin
	const relA = await peak(A, 400);
	const relB = await peak(B, 400);
	h.check(relA < SILENT && relB < SILENT, '1.5 the key-up releases it on both (' + relA.toFixed(5) + ' / ' + relB.toFixed(5) + ')');

	console.log('\n=== 2. a click on a key still plays the short note ===');
	await inPage(A.page, 'ad.noteDevice(arg, { note: 69, velocity: 0.9 })', rig.piano);
	await wait(A.page, 150);
	h.check((await peak(B, 200)) > SILENT * 5, '2.1 the click note sounds');
	await wait(A.page, 900);
	h.check((await peak(B, 300)) < SILENT, '2.2 and ends by itself (no off needed)');

	console.log('\n=== 3. the synth holds too ===');
	await inPage(A.page, 'mi.midiTarget.set(arg)', rig.synth);
	await A.page.evaluate(() => window.__fakeMidi.send([0x90, 57, 110]));
	await wait(A.page, 1500);
	h.check((await peak(B, 400)) > SILENT * 5, '3.1 1.5 s into the key the synth still sounds on B');
	await A.page.evaluate(() => window.__fakeMidi.send([0x80, 57, 0]));
	await wait(A.page, 1500);
	h.check((await peak(B, 400)) < SILENT, '3.2 released on B');

	console.log('\n=== 4. the piano roll plays the synth at the drawn length ===');
	const hasRoll = await A.page.evaluate(() => !!window.__stores.pianoRoll);
	h.check(hasRoll, '4.0 (premise) this core has the piano roll (75 MU2)');
	if (hasRoll) {
		// one A3 three beats long (1.5 s at 120) in a two-bar clip: the synth's own gate is 0.5 s
		await A.page.evaluate((u) => {
			window.__stores.musicClock.setBpm(120);
			window.__stores.pianoRoll.setRoll(u, { bars: 2, on: true, notes: [[57, 0, 3, 0.9]] });
		}, rig.synth);
		await h.eventually(() => B.page.evaluate((u) => window.__stores.pianoRoll.rollFor(u).notes.length, rig.synth), (n) => n === 1, '4.1 B holds the clip');
		await wait(A.page, 800);
		const t0 = await A.page.evaluate(() => (window.__stores.musicClock.playTransport(), Date.now()));
		await wait(A.page, Math.max(0, 1050 - (Date.now() - t0)));
		const mid = await peak(B, 300); // 1.05-1.35 s: past the synth's own 0.5 s gate + 0.4 s release
		h.check(mid > SILENT * 5, '4.2 1.1 s in, the three-beat note still sounds on B (the clip length is the gate) (' + mid.toFixed(4) + ')');
		await wait(A.page, Math.max(0, 2600 - (Date.now() - t0)));
		const gap = await peak(B, 300); // 2.6-2.9 s: ended at 1.5 s + 0.4 s release
		h.check(gap < SILENT, '4.3 and it ends where it was drawn (' + gap.toFixed(5) + ')');
		await wait(A.page, Math.max(0, 4100 - (Date.now() - t0)));
		const again = await peak(B, 300); // the second loop
		h.check(again > SILENT * 5, '4.4 the clip loops (' + again.toFixed(4) + ')');
		await A.page.evaluate(() => window.__stores.musicClock.stopTransport());
	}

	console.log('\n=== 5. the filter cutoffs are log ranges ===');
	const scales = await inPage(A.page, "const out = {}; for (const k of ad.devicesDebug().kinds) { const p = (ad.deviceSpec(k).params || []).find((x) => x.key === 'cutoff'); if (p) out[k] = p.scale || 'linear'; } return out");
	h.check(Object.keys(scales).length >= 2 && Object.values(scales).every((v) => v === 'log'), '5.1 every cutoff declares scale: log (' + JSON.stringify(scales) + ')');

	await h.finish(browser);
});
