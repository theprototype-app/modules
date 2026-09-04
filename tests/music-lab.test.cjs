// music-lab test-flight (#23 C1): the audio-device architecture, end to end, with
// two devices and one cable between them.
//
// Everything here is asserted through ACTUAL SOUND at the destination tap, never
// through the document alone: a device that builds, cables and reports itself
// perfectly while making no noise is the failure this module exists to prevent. The
// numbers that matter are peaks — silent uncabled, loud cabled, quiet when the
// speaker is carried away or turned around, silent again when it is unplugged.
//
// THE GPU FLAGS ARE PART OF THE MEASUREMENT (h.AUDIO_ARGS). On this Linux box a
// SwiftShader page starves the sampling loop badly enough that an 80 ms note reads
// as silence — see the note over GPU_ARGS in helpers.cjs.
const h = require('./helpers.cjs');

/** run a body in the page with the audio stores bound (the core suites' shape) */
const inPage = (page, body, arg) =>
	page.evaluate(
		([src, a]) =>
			Object.getPrototypeOf(async function () {}).constructor('s', 'ad', 'ap', 'arg', src)(
				window.__stores,
				window.__stores.audioDevices,
				window.__stores.audioPatch,
				a
			),
		[body, arg ?? null]
	);

const SILENT = 0.001; // the RMS floor the core helpers count as silence
const KIND_PIANO = 'mod-music-lab-piano';
const KIND_SPEAKER = 'mod-music-lab-speaker';

const kinds = (page) => inPage(page, 'return ad.devicesDebug().kinds');
const built = (page) => inPage(page, 'return ad.devicesDebug().built');

/** the AudioListener follows this camera, so the geometry of every check is measured
 * from it rather than assumed */
const cameraPos = (page) =>
	page.evaluate(
		() =>
			new Promise((r) =>
				window.__stores.globalCamera.subscribe((c) =>
					r(c ? c.getWorldPosition(new window.__stores.THREE.Vector3()).toArray() : null)
				)()
			)
	);

/**
 * Watch one peer for `ms`: the loudest RMS at any tapped context, the strongest FFT
 * bin at that moment (a triangle wave's fundamental — the harness centroid is a
 * weighted mean that the noise floor drags around), and how far the piano's A4 key
 * moved while we looked. `fire` plays the note from THIS peer first; leaving it off
 * and starting the watch before another peer plays is how the remote cases are read.
 */
const watch = (peer, options) =>
	peer.page.evaluate(async (arg) => {
		const stores = window.__stores;
		const group = await new Promise((r) => stores.objectsGroup.subscribe(r)());
		const key = arg.piano ? group.getObjectByProperty('uuid', arg.piano)?.getObjectByName('key-' + arg.note) : null;
		const base = key ? key.position.y : 0;
		const tapped = window.__audioTap.all();
		const scratch = tapped.map((t) => ({
			analyser: t.analyser,
			context: t.context,
			time: new Float32Array(t.analyser.fftSize),
			freq: new Float32Array(t.analyser.frequencyBinCount)
		}));
		if (arg.fire) stores.audioDevices.noteDevice(arg.piano, { note: arg.note, velocity: 0.9 });
		let peak = 0;
		let loudest = null;
		let binHz = 0;
		let dip = base;
		let samples = 0;
		const deadline = performance.now() + arg.ms;
		while (performance.now() < deadline) {
			await new Promise((r) => setTimeout(r, 10));
			samples++;
			if (key) dip = Math.min(dip, key.position.y);
			for (const entry of scratch) {
				entry.analyser.getFloatTimeDomainData(entry.time);
				let square = 0;
				for (let i = 0; i < entry.time.length; i++) square += entry.time[i] * entry.time[i];
				const rms = Math.sqrt(square / entry.time.length);
				if (rms > peak) {
					peak = rms;
					entry.analyser.getFloatFrequencyData(entry.freq);
					loudest = entry.freq.slice();
					binHz = entry.context.sampleRate / entry.analyser.fftSize;
				}
			}
		}
		let hz = 0;
		let best = -Infinity;
		if (loudest)
			for (let b = 1; b < loudest.length; b++)
				if (loudest[b] > best) {
					best = loudest[b];
					hz = b * binHz;
				}
		return { peak, hz, samples, contexts: tapped.length, base, dip, after: key ? key.position.y : 0, hadKey: !!key };
	}, { ms: 800, note: 69, fire: false, piano: null, ...options });

/**
 * Move / turn a device object the way the app's own transform gizmo does: write the
 * pose locally and broadcast the `move` message. Both halves matter — the local write
 * is what the module's frame task re-aims the panner from, and the broadcast is what
 * makes the peers' copies of the rig the same rig.
 */
async function place(page, uuid, pose) {
	const moved = await inPage(
		page,
		'const group = await new Promise((r) => s.objectsGroup.subscribe(r)());' +
			"const o = group.getObjectByProperty('uuid', arg.uuid);" +
			'if (!o) return null;' +
			'if (arg.pos) o.position.fromArray(arg.pos);' +
			"if (typeof arg.rotY === 'number') o.rotation.y = arg.rotY;" +
			'o.updateMatrixWorld(true);' +
			'const peer = await new Promise((r) => s.peers.subscribe(r)());' +
			"if (peer) peer.send({ type: 'move', uuid: o.uuid, pos: o.position.toArray(), rot: o.rotation.toArray(), scale: o.scale.toArray() });" +
			'return o.position.toArray();',
		{ uuid, ...pose }
	);
	await page.evaluate(() => window.__stores.objectsGroup.update((v) => v));
	await page.waitForTimeout(400); // the module re-aims its panners at 20 Hz
	return moved;
}

/** where a peer holds an object, and which way it faces */
const poseOf = (page, uuid) =>
	inPage(
		page,
		'const group = await new Promise((r) => s.objectsGroup.subscribe(r)());' +
			"const o = group.getObjectByProperty('uuid', arg);" +
			'return o ? { pos: o.position.toArray(), rotY: o.rotation.y } : null;',
		uuid
	);

const wait = (page, ms) => page.waitForTimeout(ms);

h.run(async () => {
	const browser = await h.launch({ args: h.AUDIO_ARGS });
	const A = await h.setupPage(browser, 'A', { audio: true });
	const B = await h.setupPage(browser, 'B', { audio: true });

	await h.installModule(A, 'music-lab');
	await h.installModule(B, 'music-lab');
	await h.connect(A, B);

	// ---------------------------------------------------------------- section 1
	console.log('\n=== 1. the module supplies two device kinds ===');
	await h.eventually(
		() => kinds(A.page),
		(k) => k.includes(KIND_PIANO) && k.includes(KIND_SPEAKER),
		'1.1 A registers both kinds, namespaced mod-music-lab-*'
	);
	await h.eventually(
		() => kinds(B.page),
		(k) => k.includes(KIND_PIANO) && k.includes(KIND_SPEAKER),
		'1.2 so does B — a module does not travel, it is installed on both'
	);

	// ---------------------------------------------------------------- section 2
	console.log('\n=== 2. a piano, a speaker, and a cable ===');
	// the listener sits at the camera, so put the speaker 4 m in FRONT of it (the
	// speaker's cone points down its own -Z) and the piano off to one side
	const cam = await cameraPos(A.page);
	console.log('  A camera at ' + cam.map((n) => n.toFixed(1)).join(', '));
	const NEAR = [cam[0], cam[1], cam[2] + 4];
	const FAR = [cam[0] + 60, cam[1], cam[2] + 60];
	const rig = await inPage(
		A.page,
		"const p = ad.addDevice('" + KIND_PIANO + "', { position: arg.piano });" +
			"const k = ad.addDevice('" + KIND_SPEAKER + "', { position: arg.speaker });" +
			'return { piano: p ? p.uuid : null, speaker: k ? k.uuid : null, keys: p ? p.children.filter((c) => typeof c.userData.midi === "number").length : 0 };',
		{ piano: [cam[0] - 2, cam[1] - 1, cam[2] + 4], speaker: NEAR }
	);
	h.check(!!rig.piano && !!rig.speaker, '2.1 addDevice made both objects');
	h.check(rig.keys === 12, '2.2 the piano mesh carries one octave of keys with userData.midi (' + rig.keys + ')');
	await h.eventually(
		() => built(A.page),
		(list) => list.some((d) => d.builtAs === KIND_PIANO && d.hasOutput) && list.some((d) => d.builtAs === KIND_SPEAKER && d.hasInput),
		'2.3 both build as the REAL kinds on A — the piano with an output, the speaker with an input'
	);
	await h.eventually(
		() => built(B.page),
		(list) => list.some((d) => d.builtAs === KIND_PIANO) && list.some((d) => d.builtAs === KIND_SPEAKER),
		'2.4 the objects replicate and build as the real kinds on B too'
	);
	// PLACE the rig explicitly. `addDevice`'s own `position` does not reach the peers on
	// this build (core bug, reported: the broadcast toJSON is taken before three has
	// updated the object's matrix, so every peer receives it at the origin) — and a rig
	// that is somewhere else on B is not the same rig, which is the whole subject here.
	await place(A.page, rig.speaker, { pos: NEAR });
	await place(A.page, rig.piano, { pos: [cam[0] - 2, cam[1] - 1, cam[2] + 4] });
	await h.eventually(
		() => poseOf(B.page, rig.speaker),
		(p) => !!p && Math.hypot(p.pos[0] - NEAR[0], p.pos[1] - NEAR[1], p.pos[2] - NEAR[2]) < 0.01,
		'2.5 B holds the speaker at the same place — the two peers have the SAME rig'
	);
	const cable = await inPage(
		A.page,
		"return ap.addCable({ from: { uuid: arg.piano, port: 'out' }, to: { uuid: arg.speaker, port: 'in' } })",
		rig
	);
	h.check(typeof cable === 'string' && !!cable, '2.6 addCable plugs the piano into the speaker (' + cable + ')');
	await h.eventually(
		() => inPage(B.page, 'return ap.cablesOf(arg).length', rig.piano),
		(n) => n === 1,
		'2.7 the cable replicates to B'
	);

	// ---------------------------------------------------------------- section 3
	console.log('\n=== 3. it makes a sound, and the key dips ===');
	const quiet = await watch(A, { ms: 400 });
	h.check(quiet.peak < SILENT, '3.1 (premise) nothing is playing (peak ' + quiet.peak.toFixed(5) + ', ' + quiet.samples + ' samples, ' + quiet.contexts + ' context(s))');
	const near = await watch(A, { piano: rig.piano, fire: true, ms: 900 });
	h.check(near.samples > 20, '3.2 (premise) the sampling loop actually ran (' + near.samples + ' samples — SwiftShader reads ~2)');
	h.check(near.peak > SILENT * 10 && Math.abs(near.hz - 440) < 40, '3.3 A4 is HEARD through the speaker at 440 Hz (peak ' + near.peak.toFixed(4) + ', strongest bin ' + Math.round(near.hz) + ' Hz)');
	h.check(near.hadKey && near.dip <= near.base - 0.015, '3.4 the pressed key dipped (' + near.base.toFixed(3) + ' -> ' + near.dip.toFixed(3) + ')');
	await wait(A.page, 500);
	const back = await watch(A, { piano: rig.piano, ms: 200 });
	h.check(Math.abs(back.after - back.base) < 1e-6, '3.5 and came back up');

	// ---------------------------------------------------------------- section 4
	console.log('\n=== 4. the peer hears the same note ===');
	const remote = watch(B, { piano: rig.piano, ms: 1100 });
	await wait(A.page, 120);
	await inPage(A.page, "return ad.noteDevice(arg, { note: 69, velocity: 0.9 })", rig.piano);
	const onB = await remote;
	h.check(onB.peak > SILENT * 10 && Math.abs(onB.hz - 440) < 40, '4.1 B synthesizes the replicated note itself (peak ' + onB.peak.toFixed(4) + ', ' + Math.round(onB.hz) + ' Hz)');
	h.check(onB.hadKey && onB.dip <= onB.base - 0.015, "4.2 and B's key dips too — the dip runs from onNote, never from the click");
	await wait(A.page, 800);

	// ---------------------------------------------------------------- section 5
	console.log('\n=== 5. moving the speaker moves where it sounds from ===');
	await place(A.page, rig.speaker, { pos: FAR });
	const far = await watch(A, { piano: rig.piano, fire: true, ms: 900 });
	const drop = 1 - far.peak / near.peak;
	h.check(far.peak < near.peak * 0.3, '5.1 60 m away the same note is far quieter (' + near.peak.toFixed(4) + ' -> ' + far.peak.toFixed(4) + ', ' + Math.round(drop * 100) + '% down)');
	await wait(A.page, 800);
	await place(A.page, rig.speaker, { pos: NEAR });
	const restored = await watch(A, { piano: rig.piano, fire: true, ms: 900 });
	h.check(restored.peak > far.peak * 3, '5.2 carrying it back restores it (peak ' + restored.peak.toFixed(4) + ')');
	await wait(A.page, 800);

	// ---------------------------------------------------------------- section 6
	console.log('\n=== 6. unplugging drops the bus to the noise floor ===');
	await inPage(A.page, 'ap.removeCable(arg); return true', cable);
	await wait(A.page, 400);
	const unplugged = await watch(A, { piano: rig.piano, fire: true, ms: 900 });
	h.check(unplugged.peak < SILENT, '6.1 with the cable pulled the note is SILENT — the piano reaches no bus of its own (peak ' + unplugged.peak.toFixed(5) + ')');
	await wait(A.page, 600);
	const cable2 = await inPage(
		A.page,
		"return ap.addCable({ from: { uuid: arg.piano, port: 'out' }, to: { uuid: arg.speaker, port: 'in' } })",
		rig
	);
	await wait(A.page, 400);
	const replugged = await watch(A, { piano: rig.piano, fire: true, ms: 900 });
	h.check(!!cable2 && replugged.peak > SILENT * 10, '6.2 plugging it back in brings it straight back (peak ' + replugged.peak.toFixed(4) + ')');
	await wait(A.page, 800);

	// ---------------------------------------------------------------- section 7
	console.log('\n=== 7. a late joiner walks into the finished rig ===');
	const C = await h.setupPage(browser, 'C', { audio: true });
	await h.installModule(C, 'music-lab');
	await h.connect(C, A);
	await h.eventually(
		() => built(C.page),
		(list) => list.some((d) => d.builtAs === KIND_PIANO) && list.some((d) => d.builtAs === KIND_SPEAKER),
		'7.1 C holds both devices as the REAL kinds, not placeholders'
	);
	await h.eventually(
		() => inPage(C.page, 'return ap.cablesOf(arg).length', rig.piano),
		(n) => n === 1,
		'7.2 and the cable came with the handshake'
	);
	const onC = watch(C, { ms: 1100 });
	await wait(A.page, 120);
	await inPage(A.page, "return ad.noteDevice(arg, { note: 69, velocity: 0.9 })", rig.piano);
	const heardC = await onC;
	h.check(heardC.peak > SILENT * 10 && Math.abs(heardC.hz - 440) < 40, '7.3 C hears a note played on A (peak ' + heardC.peak.toFixed(4) + ', ' + Math.round(heardC.hz) + ' Hz)');
	await wait(A.page, 800);

	// ---------------------------------------------------------------- section 8
	console.log('\n=== 8. pointing it matters ===');
	await place(A.page, rig.speaker, { rotY: Math.PI });
	const away = await watch(A, { piano: rig.piano, fire: true, ms: 900 });
	h.check(away.peak < restored.peak * 0.6, '8.1 turned 180 deg the same note reads quieter — the cone (facing ' + restored.peak.toFixed(4) + ' -> away ' + away.peak.toFixed(4) + ')');
	await wait(A.page, 800);
	await place(A.page, rig.speaker, { rotY: 0 });
	const facing = await watch(A, { piano: rig.piano, fire: true, ms: 900 });
	h.check(facing.peak > away.peak * 1.5, '8.2 turning it back to face the listener restores it (peak ' + facing.peak.toFixed(4) + ')');

	await h.finish(browser);
});
