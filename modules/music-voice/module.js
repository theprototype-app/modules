// Music Voice - roadmap #23 C5: a Mic, a Looper, a Synth and a Theremin on the engine.
//
// Four `registerAudioDevice` specs, one file, no top-level imports (`api.THREE` is handed to
// `mesh(three)` by the registry). Core owns the object, the replication, the undo, the saving,
// the cables and the clock; this file owns what each kind sounds like, looks like, and which
// params do what. NOTHING RUNTIME GOES INTO userData (it replicates - toJSON, GLTF extras -
// and arrives on a late joiner as a plain object): every live thing lives in the module-level
// Maps below, keyed by the object's uuid.
//
// THE MIC is this peer's OWN raw microphone into the graph (`api.audio.captureMic`: a separate
// capture from voice chat, no AEC/NS/AGC, never gated by push-to-talk). A take from its face
// goes through `api.audio.record` into the Explorer, and the item's CONTENT HASH is written
// into the device document (`lastTake`), so it replicates, undoes and enters the Scene manifest
// (`assets`). The bytes reach every peer by hash - no new plumbing.
//
// THE LOOPER quantizes its RECORD WINDOW to bar boundaries through the transport's scheduler:
// pressing Record arms it; a one-shot scheduled a beat ahead of the next bar starts a
// MediaRecorder on a MediaStreamDestination, and a GAIN GATE on the shared audio clock opens
// exactly at the bar (`at`) and closes exactly `bars` bars later. Because a MediaRecorder's own
// start is not sample-accurate, the take begins with a 3 ms SYNC PIP that ends exactly where
// the window opens - every peer locates the pip in the decoded bytes and takes exactly
// `bars * 4 * 60 / bpm` seconds after it, so the loop is the same samples everywhere and its
// period is exact. Playback is `api.audio.schedule(startedBeat mod P, fn, {every: P})`, pure of
// `(beat, at, bpm)`: every peer restarts the loop on the same bar at the same audio time, and a
// late joiner (or a peer whose take just landed) starts MID-loop at the phase the transport
// says. An overdub mixes the playing loop (scaled by `feedback`) into the next window; the
// mixed bytes are a new hash. A take is one gesture: `state` previews (armed / recording, no
// history) and ONE `setParams` with `before` when it lands - one undo entry restores the loop
// that was there before.
//
// THE SYNTH is polyphonic osc -> filter -> ADSR voices on the shared context, started at
// `api.audio.timeFor(at)` from the replicated note. Notes carry an optional `gate` (0 = held
// until an `off` note - the VR trigger release - with a safety limit); the oldest voice is
// stolen past `polyphony`.
//
// THE THEREMIN is continuous pitch, so it sends NO notes: in VR a frame task reads
// `api.vrHand(hand)` and writes the hand pose as `previewParams(uuid, {pitch, volume})` at
// ~15 Hz - replicated, history-free - and EVERY peer synthesizes from the document (`onParam`
// glides the oscillator). On desktop the same two params come from the Inspector or a script.

const PREVIEW_MS = 66;
const DISPLAY_HZ = 12;
const LOOPER_HZ = 10;
const THEREMIN_HZ = 15;

/** the looper starts its recorder this many beats (at least LOOP_LEAD_MIN_S) before the bar */
const LOOP_LEAD_BEATS = 1;
const LOOP_LEAD_MIN_S = 0.3;
const LOOP_TAIL_S = 0.4;
/** the sync pip: a short burst that ENDS exactly where the record window opens */
const PIP_SECONDS = 0.003;
const PIP_HZ = 3000;
const PIP_GAIN = 0.5;
const PIP_THRESHOLD = 0.2;
const MAX_RECORD_SECONDS = 120; // core's own cap on one take

/** a held synth note (VR trigger, or a note without a gate) is released after this anyway */
const HOLD_LIMIT_S = 10;
const STEAL_RELEASE_S = 0.03;
const KEY_DIP = 0.012;
const KEY_DIP_MS = 150;
const WHITE_MIDI = [60, 62, 64, 65, 67, 69, 71]; // C4..B4
const BLACK_MIDI = { 0: 61, 1: 63, 3: 66, 4: 68, 5: 70 }; // after C, D, F, G, A
const KEY_STEP = 0.07;

/** the theremin's hand mapping: this many octaves above PITCH_LO over HEIGHT_SPAN metres of
 * hand height; full volume touching the body, silent past REACH metres */
const PITCH_LO = 110;
const PITCH_OCTAVES = 4;
const HEIGHT_SPAN = 1.0;
const REACH = 0.8;
const VOLUME_NEAR = 0.12;

/** the resolved namespaced kinds, once registerAudioDevice resolves */
const KINDS = { mic: '', looper: '', synth: '', theremin: '' };

/** every built mic @type {Map<string, any>} */
const mics = new Map();
/** every built looper @type {Map<string, any>} */
const loopers = new Map();
/** every built synth @type {Map<string, any>} */
const synths = new Map();
/** every built theremin @type {Map<string, any>} */
const theremins = new Map();
/** keys mid-dip (local, transient) @type {WeakSet<any>} */
const dipped = new WeakSet();

/** the local recorder's state (`api.audio.recording()`), for the mic faces */
let recState = { active: false, startedAt: 0, maxSeconds: 0, name: '' };
/** bumped per register, so a stale store subscription from a reloaded instance is ignored */
let generation = 0;

// ---- small helpers -------------------------------------------------------------------------

/** @param {any} v @param {number} lo @param {number} hi @param {number} fallback */
function clamp(v, lo, hi, fallback) {
	const n = Number(v);
	if (!Number.isFinite(n)) return fallback;
	return Math.max(lo, Math.min(hi, n));
}

/** the device object a mesh belongs to (itself or an ancestor carrying a device) @param {any} object */
function deviceRootOf(object) {
	let node = object;
	while (node && !node.userData?.device?.kind) node = node.parent;
	return node ?? null;
}

/** a glide, never a jump - a knob must not click @param {any} param @param {number} value @param {any} ctx */
function glide(param, value, ctx, tc = 0.01) {
	param.setTargetAtTime(value, ctx.currentTime, tc);
}

/** @param {any} src */
function stopNode(src) {
	if (!src) return;
	try {
		src.stop();
	} catch {
		/* already stopped */
	}
	try {
		src.disconnect();
	} catch {
		/* never connected */
	}
}

/** the plug convention the reference modules use: the visible plug carries the vrpatch name and
 * holds a zero-offset `port:<id>` marker @param {any} three @param {'in'|'out'} side @param {string} id @param {number} color @param {number} x @param {number} y @param {number} z */
function plug(three, side, id, color, x, y, z) {
	const mesh = new three.Mesh(
		new three.CylinderGeometry(0.02, 0.02, 0.04, 12),
		new three.MeshStandardMaterial({ color, roughness: 0.4, metalness: 0.6 })
	);
	mesh.rotation.x = Math.PI / 2;
	mesh.position.set(x, y, z);
	mesh.name = 'vrpatch-' + side + ':' + id;
	const marker = new three.Object3D();
	marker.name = 'port:' + id;
	mesh.add(marker);
	return mesh;
}

/** @param {any} three @param {string} name @param {number} color @param {number[]} size @param {number[]} at */
function button(three, name, color, size, at) {
	const mesh = new three.Mesh(new three.BoxGeometry(size[0], size[1], size[2]), new three.MeshStandardMaterial({ color, roughness: 0.5 }));
	mesh.position.set(at[0], at[1], at[2]);
	mesh.name = name;
	return mesh;
}

/** @param {any} three @param {string} name @param {number} color @param {number[]} at */
function led(three, name, color, at) {
	const mesh = new three.Mesh(new three.SphereGeometry(0.012, 10, 8), new three.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.2, roughness: 0.4 }));
	mesh.position.set(at[0], at[1], at[2]);
	mesh.name = name;
	return mesh;
}

/** @param {any} mesh @param {number} color @param {number} [intensity] */
function light(mesh, color, intensity = 0.2) {
	if (!mesh?.material?.color) return;
	mesh.material.color.setHex(color);
	if (mesh.material.emissive) {
		mesh.material.emissive.setHex(color);
		mesh.material.emissiveIntensity = intensity;
	}
}

// ---- the Mic --------------------------------------------------------------------------------

/** @param {any} three */
function micMesh(three) {
	const base = new three.Mesh(
		new three.BoxGeometry(0.3, 0.06, 0.3),
		new three.MeshStandardMaterial({ color: 0x1f2937, roughness: 0.85, metalness: 0.15 })
	);
	base.name = 'Mic';
	const stem = new three.Mesh(new three.CylinderGeometry(0.012, 0.012, 0.36, 10), new three.MeshStandardMaterial({ color: 0x4b5563, roughness: 0.5, metalness: 0.6 }));
	stem.position.set(0, 0.21, 0);
	stem.name = 'mic-stem';
	base.add(stem);
	const capsule = new three.Mesh(new three.SphereGeometry(0.045, 16, 12), new three.MeshStandardMaterial({ color: 0x9ca3af, roughness: 0.35, metalness: 0.7 }));
	capsule.position.set(0, 0.42, 0);
	capsule.name = 'mic-capsule';
	base.add(capsule);
	base.add(button(three, 'mic-rec', 0xdc2626, [0.07, 0.025, 0.05], [0.09, 0.042, 0.08]));
	base.add(led(three, 'mic-led', 0x7f1d1d, [-0.09, 0.045, 0.08]));
	base.add(plug(three, 'out', 'out', 0xfb923c, 0, 0, 0.17));
	return base;
}

/** @param {any} api */
function micSpec(api) {
	return {
		kind: 'mic',
		label: 'Mic',
		icon: '🎤',
		group: 'Music Voice',
		ports: { in: [], out: [{ id: 'out', label: 'Out', kind: 'audio' }] },
		/** 23-D1: the last take is a scene asset by hash @param {any} params */
		assets: (params) => (params?.lastTake ? [{ hash: String(params.lastTake), name: String(params.lastTakeName || 'take') }] : []),
		params: [
			{ key: 'level', label: 'Level', kind: 'range', min: 0, max: 2, step: 0.01, default: 1 },
			{ key: 'monitor', label: 'Monitor', kind: 'toggle', default: false },
			{ key: 'seconds', label: 'Take length', kind: 'range', min: 1, max: 60, step: 1, default: 8, unit: 's' }
			// undeclared, part of the document: lastTake (hash), lastTakeName
		],
		/**
		 * this peer's RAW mic -> level -> out (a cable picks it up there). `monitor` also sends
		 * it to the local instruments bus so you hear yourself without a speaker; off by default,
		 * because sound goes nowhere until cabled. The capture is asynchronous (a permission
		 * prompt on a peer that has not granted it): the graph exists at once, the source lands
		 * when the stream does. @param {any} ctx @param {any} node @param {any} params
		 */
		build(ctx, node, params) {
			const level = ctx.createGain();
			level.gain.value = clamp(params.level, 0, 2, 1);
			const out = ctx.createGain();
			const monitor = ctx.createGain();
			monitor.gain.value = params.monitor ? 1 : 0;
			level.connect(out);
			level.connect(monitor);
			monitor.connect(api.audio.bus('instruments') ?? ctx.destination);
			const h = { ctx, node, level, out, monitor, doc: { ...params }, source: null, stream: null, alive: true, error: '', taking: false };
			mics.set(node.uuid, h);
			Promise.resolve(api.audio.captureMic())
				.then((/** @type {MediaStream} */ stream) => {
					if (!h.alive || !stream) return;
					h.stream = stream;
					h.source = ctx.createMediaStreamSource(stream);
					h.source.connect(level);
				})
				.catch((/** @type {any} */ error) => {
					h.error = String(error?.message ?? error);
				});
			return {
				output: out,
				h,
				dispose() {
					h.alive = false;
					try {
						h.source?.disconnect();
					} catch {
						/* never connected */
					}
					level.disconnect();
					out.disconnect();
					monitor.disconnect();
					mics.delete(node.uuid);
				}
			};
		},
		/** @param {any} built @param {string} key @param {any} value */
		onParam(built, key, value) {
			const h = built.h;
			if (!h) return;
			h.doc[key] = value;
			if (key === 'level') glide(h.level.gain, clamp(value, 0, 2, 1), h.ctx);
			else if (key === 'monitor') glide(h.monitor.gain, value ? 1 : 0, h.ctx);
		},
		mesh: (/** @type {any} */ three) => micMesh(three)
	};
}

/** the face's Record button: a take through core's recorder; the item's HASH is written
 * into the document so it replicates and enters the manifest. Pressed while a take runs, it
 * ends the take early. @param {any} api @param {any} device @param {any} object */
function clickMic(api, device, object) {
	if (String(object?.name ?? '') !== 'mic-rec') return false;
	const h = mics.get(device.uuid);
	if (recState.active) {
		api.audio.stopRecording();
		api.haptic(0.4, 30);
		return true;
	}
	const doc = api.audio.device(device.uuid)?.params ?? h?.doc ?? {};
	const seconds = clamp(doc.seconds, 1, MAX_RECORD_SECONDS, 8);
	const name = 'mic-' + device.uuid.slice(0, 4) + '-' + new Date().toISOString().slice(11, 19).replace(/:/g, '');
	if (h) h.taking = true;
	Promise.resolve(api.audio.record({ maxSeconds: seconds, name }))
		.then((/** @type {any} */ item) => {
			if (h) h.taking = false;
			if (!item || !item.hash) return;
			api.audio.setParams(device.uuid, { lastTake: item.hash, lastTakeName: item.name });
		})
		.catch(() => {
			if (h) h.taking = false;
		});
	api.haptic(0.6, 50);
	return true;
}

// ---- the Looper -----------------------------------------------------------------------------

/** the loop's length in beats: `bars` bars of four @param {any} doc */
function loopBeatsOf(doc) {
	return clamp(doc?.loopBars, 1, 8, 2) * 4;
}
/** the loop's length in seconds at the tempo it was recorded at @param {any} doc */
function loopSecondsOf(doc) {
	return (loopBeatsOf(doc) * 60) / clamp(doc?.loopBpm, 20, 400, 120);
}

/**
 * Trim a decoded take to THE LOOP: find the sync pip's leading edge (the first sample over
 * PIP_THRESHOLD), skip the pip, and take exactly `seconds` of audio from there - zero-padded
 * if the take ended short. Deterministic in the bytes, so every peer cuts the same samples
 * and the period is exact to the sample. @param {any} ctx @param {any} raw @param {number} seconds
 */
function trimLoop(ctx, raw, seconds) {
	const sr = raw.sampleRate;
	const channels = Math.max(1, raw.numberOfChannels);
	let edge = -1;
	for (let c = 0; c < channels && edge < 0; c++) {
		const data = raw.getChannelData(c);
		for (let i = 0; i < data.length; i++) {
			if (Math.abs(data[i]) > PIP_THRESHOLD) {
				edge = i;
				break;
			}
		}
	}
	// no pip found (a take made some other way): the loop starts where the bytes do
	const start = edge < 0 ? 0 : edge + Math.round(PIP_SECONDS * sr);
	const length = Math.max(1, Math.round(seconds * sr));
	const out = ctx.createBuffer(channels, length, sr);
	for (let c = 0; c < channels; c++) {
		const src = raw.getChannelData(c);
		const dst = out.getChannelData(c);
		const n = Math.max(0, Math.min(length, src.length - start));
		if (n > 0) dst.set(src.subarray(start, start + n));
	}
	return { buffer: out, edge, start };
}

/** fetch and trim the document's loop; every peer pulls and decodes its own copy by hash
 * @param {any} api @param {any} h */
function loadLoop(api, h) {
	const hash = String(h.doc.loop || '');
	h.buffer = null;
	h.trim = null;
	stopLoopSource(h, h.ctx.currentTime);
	if (!hash) {
		syncLoop(api, h);
		return;
	}
	const wanted = hash;
	Promise.resolve(api.audio.sample(hash))
		.then((/** @type {any} */ raw) => {
			if (!raw || !h.alive || String(h.doc.loop || '') !== wanted) return;
			const trimmed = trimLoop(h.ctx, raw, loopSecondsOf(h.doc));
			h.buffer = trimmed.buffer;
			h.trim = { edge: trimmed.edge, start: trimmed.start, rawSeconds: raw.duration };
			syncLoop(api, h);
		})
		.catch(() => {});
}

/** @param {any} h @param {number} at */
function stopLoopSource(h, at) {
	const src = h.src;
	h.src = null;
	if (!src) return;
	try {
		src.stop(at);
	} catch {
		/* already stopped */
	}
}

/** start one pass of the loop at audio time `at`, `offset` seconds in, at `rate`
 * @param {any} h @param {number} at @param {number} offset @param {number} rate */
function startLoopSource(h, at, offset, rate) {
	const src = h.ctx.createBufferSource();
	src.buffer = h.buffer;
	src.playbackRate.value = rate;
	src.connect(h.loopGain);
	src.start(at, Math.max(0, Math.min(h.buffer.duration - 0.001, offset)));
	h.src = src;
	h.passes++;
	src.onended = () => {
		try {
			src.disconnect();
		} catch {
			/* gone */
		}
		if (h.src === src) h.src = null;
	};
}

/**
 * The scheduler's callback at a loop boundary - PURE of (at, bpm): stop the running pass
 * there and start the next from sample 0, at the tempo ratio. A boundary the scheduler hands
 * over late (an `at` already gone) starts NOW at the offset that keeps it in phase rather
 * than from the top. @param {any} h @param {number} at @param {number} bpm
 */
function restartLoop(h, at, bpm) {
	if (!h.buffer || !h.doc.play) return;
	const rate = bpm / clamp(h.doc.loopBpm, 20, 400, 120);
	const now = h.ctx.currentTime;
	if (at >= now) {
		stopLoopSource(h, at);
		startLoopSource(h, at, 0, rate);
	} else {
		stopLoopSource(h, now);
		startLoopSource(h, now, (now - at) * rate, rate);
	}
}

/** start MID-loop at the phase the transport says (a take that just landed, a late joiner, a
 * transport restart): the same derivation on every peer @param {any} api @param {any} h */
function catchUp(api, h) {
	if (h.src || !h.buffer || !h.doc.play) return;
	const t = api.audio.transport();
	if (!t.playing) return;
	const P = loopBeatsOf(h.doc);
	const phase = ((((t.beat - (Number(h.doc.startedBeat) || 0)) % P) + P) % P);
	const rate = t.bpm / clamp(h.doc.loopBpm, 20, 400, 120);
	const offset = (phase * 60) / clamp(h.doc.loopBpm, 20, 400, 120);
	if (offset >= h.buffer.duration - 0.02) return; // the boundary is about to restart it anyway
	h.catchUps++;
	startLoopSource(h, h.ctx.currentTime, offset, rate);
}

/** make playback match the document: a repeat at every loop boundary from the bar the window
 * started on (`startedBeat mod P`, `every: P`), plus a mid-loop catch-up now
 * @param {any} api @param {any} h */
function syncLoop(api, h) {
	h.syncs++;
	stopLoopSource(h, h.ctx.currentTime);
	h.cancel?.();
	h.cancel = null;
	if (!h.buffer || !h.doc.play) return;
	const P = loopBeatsOf(h.doc);
	const offset = ((((Number(h.doc.startedBeat) || 0) % P) + P) % P);
	h.cancel = api.audio.schedule(
		offset,
		(/** @type {{beat: number, at: number, late: boolean, bpm: number}} */ e) => {
			if (e.late) return; // a boundary already gone is not a restart to fire now
			restartLoop(h, e.at, e.bpm);
			h.boundaries.push({ beat: e.beat, at: e.at, wall: Date.now() + (e.at - h.ctx.currentTime) * 1000, lateBy: Math.max(0, h.ctx.currentTime - e.at) });
			if (h.boundaries.length > 64) h.boundaries.splice(0, h.boundaries.length - 64);
		},
		{ every: P, swing: false }
	);
	catchUp(api, h);
}

/** @param {any} three */
function looperMesh(three) {
	const body = new three.Mesh(
		new three.BoxGeometry(0.44, 0.1, 0.34),
		new three.MeshStandardMaterial({ color: 0x292524, roughness: 0.85, metalness: 0.15 })
	);
	body.name = 'Looper';
	body.add(button(three, 'lp-rec', 0xdc2626, [0.09, 0.03, 0.07], [-0.13, 0.065, 0.09]));
	body.add(button(three, 'lp-play', 0x22c55e, [0.09, 0.03, 0.07], [0, 0.065, 0.09]));
	body.add(button(three, 'lp-clear', 0x64748b, [0.09, 0.03, 0.07], [0.13, 0.065, 0.09]));
	body.add(led(three, 'lp-led', 0x3f3f46, [-0.13, 0.062, 0.02]));
	// a ring that turns with the loop's position
	const ring = new three.Mesh(
		new three.TorusGeometry(0.06, 0.008, 8, 32),
		new three.MeshStandardMaterial({ color: 0x475569, roughness: 0.5, metalness: 0.4 })
	);
	ring.rotation.x = Math.PI / 2;
	ring.position.set(0.07, 0.055, -0.03);
	ring.name = 'lp-ring';
	const mark = new three.Mesh(new three.BoxGeometry(0.012, 0.012, 0.03), new three.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.6 }));
	mark.position.set(0, -0.06, 0);
	mark.name = 'lp-mark';
	ring.add(mark);
	body.add(ring);
	body.add(plug(three, 'in', 'in', 0x38bdf8, -0.1, 0, 0.19));
	body.add(plug(three, 'out', 'out', 0xfb923c, 0.1, 0, 0.19));
	return body;
}

/** @param {any} api */
function looperSpec(api) {
	return {
		kind: 'looper',
		label: 'Looper',
		icon: '🔁',
		group: 'Music Voice',
		ports: { in: [{ id: 'in', label: 'In', kind: 'audio' }], out: [{ id: 'out', label: 'Out', kind: 'audio' }] },
		/** the loop is a scene asset by hash @param {any} params */
		assets: (params) => (params?.loop ? [{ hash: String(params.loop), name: String(params.loopName || 'loop') }] : []),
		params: [
			{ key: 'bars', label: 'Bars', kind: 'range', min: 1, max: 8, step: 1, default: 2 },
			{ key: 'level', label: 'Level', kind: 'range', min: 0, max: 1, step: 0.01, default: 0.9 },
			{ key: 'feedback', label: 'Feedback', kind: 'range', min: 0, max: 1, step: 0.01, default: 0.9 },
			{ key: 'play', label: 'Play', kind: 'toggle', default: true },
			{ key: 'thru', label: 'Thru', kind: 'toggle', default: true }
			// undeclared, part of the document: loop (hash), loopName, startedBeat, startedBar,
			// startedAt, loopBars, loopBpm, takes, state (idle / armed / recording)
		],
		/**
		 * in -> thru -> out, and the loop's own gain -> out. The record gate is made per take.
		 * @param {any} ctx @param {any} node @param {any} params
		 */
		build(ctx, node, params) {
			const input = ctx.createGain();
			const thru = ctx.createGain();
			thru.gain.value = params.thru === false ? 0 : 1;
			const out = ctx.createGain();
			out.gain.value = clamp(params.level, 0, 1, 0.9);
			const loopGain = ctx.createGain();
			input.connect(thru);
			thru.connect(out);
			loopGain.connect(out);
			const h = {
				ctx,
				node,
				input,
				thru,
				out,
				loopGain,
				doc: { ...params },
				buffer: null,
				trim: null,
				src: null,
				cancel: null,
				alive: true,
				state: 'idle', // this peer's own take: idle / armed / recording
				armed: null, // {cancel, before, at}
				passes: 0,
				catchUps: 0,
				syncs: 0,
				/** @type {{beat: number, at: number, wall: number, lateBy: number}[]} */ boundaries: []
			};
			loopers.set(node.uuid, h);
			loadLoop(api, h);
			return {
				input,
				output: out,
				h,
				dispose() {
					h.alive = false;
					h.armed?.cancel?.();
					h.armed = null;
					h.cancel?.();
					h.cancel = null;
					stopLoopSource(h, ctx.currentTime);
					input.disconnect();
					thru.disconnect();
					out.disconnect();
					loopGain.disconnect();
					loopers.delete(node.uuid);
				}
			};
		},
		/** @param {any} built @param {string} key @param {any} value */
		onParam(built, key, value) {
			const h = built.h;
			if (!h) return;
			h.doc[key] = value;
			if (key === 'level') glide(h.out.gain, clamp(value, 0, 1, 0.9), h.ctx);
			else if (key === 'thru') glide(h.thru.gain, value === false ? 0 : 1, h.ctx);
			else if (key === 'loop') loadLoop(api, h);
			else if (key === 'play' || key === 'startedBeat' || key === 'loopBars' || key === 'loopBpm') syncLoop(api, h);
		},
		mesh: (/** @type {any} */ three) => looperMesh(three)
	};
}

/**
 * Arm the looper: the record window starts at the NEXT bar boundary with room for the lead,
 * and lasts `bars` bars. A one-shot on the transport's scheduler, a beat ahead of the bar,
 * starts the recorder; the gate and the pip are placed on the audio clock from the callback's
 * exact `at`. The whole take is one gesture: `before` is captured HERE.
 * @param {any} api @param {any} device @param {any} h
 */
function armLooper(api, device, h) {
	const uuid = device.uuid;
	if (h.state === 'armed') {
		// a second press while armed disarms
		h.armed?.cancel?.();
		h.armed = null;
		h.state = 'idle';
		api.audio.previewParams(uuid, { state: 'idle' });
		return;
	}
	if (h.state === 'recording') return;
	let t = api.audio.transport();
	if (!t.playing) {
		api.audio.play();
		t = api.audio.transport();
	}
	const bars = clamp(api.audio.device(uuid)?.params?.bars ?? h.doc.bars, 1, 8, 2);
	const lead = Math.max(LOOP_LEAD_BEATS, (LOOP_LEAD_MIN_S * t.bpm) / 60);
	let bar = Math.floor(t.beat / 4) + 1;
	while (bar * 4 - lead - t.beat < 0.15) bar++;
	const startBeat = bar * 4;
	const before = api.audio.device(uuid);
	h.state = 'armed';
	const armedAt = Date.now();
	const cancel = api.audio.schedule(startBeat - lead, (/** @type {any} */ e) => beginWindow(api, uuid, h, e, { startBeat, bars, lead, before, armedAt }), { swing: false });
	h.armed = { cancel, before, at: armedAt, startBeat };
	api.audio.previewParams(uuid, { state: 'armed' });
}

/**
 * The lead callback: the recorder starts now (up to a beat and a bit before the bar), the
 * GATE opens at the bar's exact audio time and closes `bars` bars later, the sync pip sits in
 * the 3 ms before the gate. The old loop (scaled by `feedback`) is mixed into the window -
 * that is the overdub. When the take lands, ONE setParams writes the hash and the window's
 * bar so every peer plays the same bytes from the same bar.
 * @param {any} api @param {string} uuid @param {any} h @param {{at: number, bpm: number, beat: number}} e
 * @param {{startBeat: number, bars: number, lead: number, before: any, armedAt: number}} spec
 */
function beginWindow(api, uuid, h, e, spec) {
	if (h.state !== 'armed' || !h.alive) return;
	h.armed = null;
	const ctx = h.ctx;
	const secondsPerBeat = 60 / e.bpm;
	const at = e.at + spec.lead * secondsPerBeat; // the bar boundary, on the audio clock
	if (at < ctx.currentTime + 0.05) {
		// the lead callback came too late to place the pip before the bar (a stalled main
		// thread): a loop that cannot be aligned is not recorded at all
		h.state = 'idle';
		api.audio.previewParams(uuid, { state: 'idle' });
		api.toast('Music Voice: missed the bar, press Record again');
		return;
	}
	const seconds = spec.bars * 4 * secondsPerBeat;
	const dest = ctx.createMediaStreamDestination();
	const gate = ctx.createGain();
	gate.gain.value = 0;
	h.input.connect(gate);
	gate.connect(dest);
	const fb = ctx.createGain();
	fb.gain.value = clamp(h.doc.feedback, 0, 1, 0.9);
	h.loopGain.connect(fb);
	fb.connect(gate);
	gate.gain.setValueAtTime(0, Math.max(ctx.currentTime, at - 0.001));
	gate.gain.setValueAtTime(1, at);
	gate.gain.setValueAtTime(0, at + seconds);
	const pip = ctx.createOscillator();
	pip.frequency.value = PIP_HZ;
	const pipGain = ctx.createGain();
	pipGain.gain.value = PIP_GAIN;
	pip.connect(pipGain);
	pipGain.connect(dest);
	const pipAt = Math.max(ctx.currentTime, at - PIP_SECONDS);
	pip.start(pipAt);
	pip.stop(at);
	const startedAt = Date.now() + (at - ctx.currentTime) * 1000;
	const maxSeconds = Math.min(MAX_RECORD_SECONDS, Math.ceil(spec.lead * secondsPerBeat + 0.3 + seconds + LOOP_TAIL_S));
	h.state = 'recording';
	h.window = { at, seconds, startBeat: spec.startBeat, startedAt };
	api.audio.previewParams(uuid, { state: 'recording' });
	const name = 'loop-' + uuid.slice(0, 4) + '-' + ((Number(h.doc.takes) || 0) + 1);
	let stopTimer = null;
	const cleanup = () => {
		clearTimeout(stopTimer);
		try {
			h.input.disconnect(gate);
		} catch {
			/* gone */
		}
		try {
			h.loopGain.disconnect(fb);
		} catch {
			/* gone */
		}
		fb.disconnect();
		gate.disconnect();
		stopNode(pip);
		pipGain.disconnect();
	};
	const done = Promise.resolve(api.audio.record({ maxSeconds, stream: dest.stream, name }));
	// end the take a little after the gate closes; the recorder's own cap is the backstop
	stopTimer = setTimeout(() => api.audio.stopRecording(), Math.max(0, (at + seconds + LOOP_TAIL_S - ctx.currentTime) * 1000));
	done
		.then((/** @type {any} */ item) => {
			cleanup();
			h.state = 'idle';
			h.window = null;
			if (!h.alive) return;
			if (!item || !item.hash) {
				api.audio.previewParams(uuid, { state: 'idle' });
				api.toast('Music Voice: the loop was not recorded');
				return;
			}
			api.audio.setParams(
				uuid,
				{
					loop: item.hash,
					loopName: item.name,
					startedBeat: spec.startBeat,
					startedBar: spec.startBeat / 4,
					startedAt,
					loopBars: spec.bars,
					loopBpm: e.bpm,
					takes: (Number(h.doc.takes) || 0) + 1,
					state: 'idle'
				},
				{ before: spec.before }
			);
		})
		.catch(() => {
			cleanup();
			h.state = 'idle';
			h.window = null;
			if (h.alive) api.audio.previewParams(uuid, { state: 'idle' });
		});
}

/** @param {any} api @param {any} device @param {any} object */
function clickLooper(api, device, object) {
	const name = String(object?.name ?? '');
	const h = loopers.get(device.uuid);
	if (!h) return false;
	if (name === 'lp-rec') {
		armLooper(api, device, h);
		api.haptic(0.6, 50);
		return true;
	}
	if (name === 'lp-play') {
		const doc = api.audio.device(device.uuid)?.params ?? h.doc;
		api.audio.setParams(device.uuid, { play: doc.play === false });
		api.haptic(0.4, 30);
		return true;
	}
	if (name === 'lp-clear') {
		if (h.state === 'armed') armLooper(api, device, h); // disarm first
		api.audio.setParams(device.uuid, { loop: '', loopName: '', takes: 0, state: 'idle' });
		api.haptic(0.4, 30);
		return true;
	}
	return false;
}

// ---- the Synth ------------------------------------------------------------------------------

/** the note a key mesh stands for, from userData or - when a replication path dropped that -
 * from its name @param {any} object @returns {number|null} */
function noteOf(object) {
	const midi = object?.userData?.midi;
	if (typeof midi === 'number') return midi;
	const named = typeof object?.name === 'string' && object.name.startsWith('key-') ? Number(object.name.slice(4)) : NaN;
	return Number.isFinite(named) ? named : null;
}

/** dip the key a note belongs to - from onNote, so every peer moves the same key
 * @param {any} node @param {number} note */
function dipKey(node, note) {
	const key = node?.getObjectByName?.('key-' + note);
	if (!key || dipped.has(key)) return;
	dipped.add(key);
	key.position.y -= KEY_DIP;
	setTimeout(() => {
		key.position.y += KEY_DIP;
		dipped.delete(key);
	}, KEY_DIP_MS);
}

/** @param {any} three */
function synthMesh(three) {
	const body = new three.Mesh(
		new three.BoxGeometry(0.62, 0.1, 0.34),
		new three.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.8, metalness: 0.2 })
	);
	body.name = 'Synth';
	const left = -((WHITE_MIDI.length - 1) * KEY_STEP) / 2;
	const white = new three.MeshStandardMaterial({ color: 0xf5f5f0, roughness: 0.6 });
	const black = new three.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.5 });
	WHITE_MIDI.forEach((midi, index) => {
		const key = new three.Mesh(new three.BoxGeometry(0.064, 0.03, 0.16), white);
		key.position.set(left + index * KEY_STEP, 0.06, 0.08);
		// the CLICK reads this (desktop and VR trigger are one path), and so does onNote; the
		// NAME carries the same number because userData rides GLTF extras on the late-joiner path
		key.userData.midi = midi;
		key.name = 'key-' + midi;
		body.add(key);
	});
	for (const [afterWhite, midi] of Object.entries(BLACK_MIDI)) {
		const key = new three.Mesh(new three.BoxGeometry(0.04, 0.035, 0.1), black);
		key.position.set(left + (Number(afterWhite) + 0.5) * KEY_STEP, 0.08, 0.05);
		key.userData.midi = midi;
		key.name = 'key-' + midi;
		body.add(key);
	}
	// a panel of knobs (decor; the params live in the Inspector and the toolbox)
	for (let i = 0; i < 4; i++) {
		const knob = new three.Mesh(new three.CylinderGeometry(0.018, 0.018, 0.02, 12), new three.MeshStandardMaterial({ color: 0x94a3b8, roughness: 0.5, metalness: 0.5 }));
		knob.position.set(-0.21 + i * 0.14, 0.06, -0.1);
		knob.name = 'sy-knob-' + i;
		body.add(knob);
	}
	body.add(plug(three, 'out', 'out', 0xfb923c, 0, 0, 0.19));
	return body;
}

/** the release segment of the envelope at `t`, from wherever the envelope is then: a hold
 * at `t`, a ramp to zero over `release`, the oscillator stopped after it
 * @param {any} voice @param {number} t @param {number} release */
function envelopeRelease(voice, t, release) {
	const g = voice.amp.gain;
	if (typeof g.cancelAndHoldAtTime === 'function') g.cancelAndHoldAtTime(t);
	else {
		g.cancelScheduledValues(t);
		g.setValueAtTime(Math.max(0.0001, g.value), t);
	}
	g.linearRampToValueAtTime(0, t + release);
	try {
		voice.osc.stop(t + release + 0.05);
	} catch {
		/* stop() may only be called once: the earlier stop stands, the envelope is at zero anyway */
	}
}

/** release a voice NOW-ish (an `off` note, a steal): it no longer counts against polyphony
 * @param {any} h @param {any} voice @param {number} t @param {number} release */
function releaseVoice(h, voice, t, release) {
	if (voice.released) return;
	voice.released = true;
	clearTimeout(voice.gateTimer);
	envelopeRelease(voice, t, release);
}

/** @param {any} h @param {any} voice */
function dropVoice(h, voice) {
	const index = h.voices.indexOf(voice);
	if (index >= 0) h.voices.splice(index, 1);
	try {
		voice.osc.disconnect();
		voice.filter.disconnect();
		voice.amp.disconnect();
	} catch {
		/* gone */
	}
}

/** @param {any} api */
function synthSpec(api) {
	return {
		kind: 'synth',
		label: 'Synth',
		icon: '🎛️',
		group: 'Music Voice',
		ports: { in: [], out: [{ id: 'out', label: 'Out', kind: 'audio' }] },
		params: [
			{
				key: 'wave',
				label: 'Wave',
				kind: 'select',
				default: 'sawtooth',
				options: [
					{ value: 'sine', label: 'Sine' },
					{ value: 'triangle', label: 'Triangle' },
					{ value: 'sawtooth', label: 'Saw' },
					{ value: 'square', label: 'Square' }
				]
			},
			{ key: 'attack', label: 'Attack', kind: 'range', min: 0.001, max: 2, step: 0.001, default: 0.01, unit: 's' },
			{ key: 'decay', label: 'Decay', kind: 'range', min: 0.01, max: 2, step: 0.01, default: 0.15, unit: 's' },
			{ key: 'sustain', label: 'Sustain', kind: 'range', min: 0, max: 1, step: 0.01, default: 0.6 },
			{ key: 'release', label: 'Release', kind: 'range', min: 0.02, max: 4, step: 0.01, default: 0.4, unit: 's' },
			{ key: 'cutoff', label: 'Cutoff', kind: 'range', min: 40, max: 16000, step: 1, default: 2500, unit: 'Hz' },
			{ key: 'resonance', label: 'Resonance', kind: 'range', min: 0.1, max: 20, step: 0.1, default: 1 },
			{ key: 'level', label: 'Level', kind: 'range', min: 0, max: 1, step: 0.01, default: 0.5 },
			{ key: 'polyphony', label: 'Polyphony', kind: 'range', min: 1, max: 16, step: 1, default: 8 },
			{ key: 'gate', label: 'Gate', kind: 'range', min: 0.05, max: 4, step: 0.01, default: 0.5, unit: 's' }
		],
		/** one gain, connected to NOTHING; every voice lands here and a cable picks it up
		 * @param {any} ctx @param {any} node @param {any} params */
		build(ctx, node, params) {
			const out = ctx.createGain();
			out.gain.value = clamp(params.level, 0, 1, 0.5);
			const h = { ctx, node, out, doc: { ...params }, /** @type {any[]} */ voices: [], alive: true };
			synths.set(node.uuid, h);
			return {
				output: out,
				h,
				dispose() {
					h.alive = false;
					for (const voice of [...h.voices]) {
						clearTimeout(voice.gateTimer);
						stopNode(voice.osc);
						dropVoice(h, voice);
					}
					out.disconnect();
					synths.delete(node.uuid);
				}
			};
		},
		/** every param is live: the filter and the level glide on the running voices too
		 * @param {any} built @param {string} key @param {any} value */
		onParam(built, key, value) {
			const h = built.h;
			if (!h) return;
			h.doc[key] = value;
			if (key === 'level') glide(h.out.gain, clamp(value, 0, 1, 0.5), h.ctx);
			else if (key === 'cutoff') for (const v of h.voices) glide(v.filter.frequency, clamp(value, 40, 16000, 2500), h.ctx, 0.02);
			else if (key === 'resonance') for (const v of h.voices) glide(v.filter.Q, clamp(value, 0.1, 20, 1), h.ctx, 0.02);
			else if (key === 'wave') for (const v of h.voices) v.osc.type = String(value);
		},
		/**
		 * A note on every peer from the same stamp: `at` is WALL CLOCK off the wire, and
		 * `api.audio.timeFor` is the only correct way to place it on this context. `gate`
		 * (seconds) overrides the document's; 0 holds the note until an `off` note for the
		 * same pitch (the VR trigger release) or HOLD_LIMIT_S. Past `polyphony`, the oldest
		 * voice is stolen. @param {any} built @param {any} event @param {any} node
		 */
		onNote(built, { note, velocity, at, gate, off }, node) {
			const h = built.h;
			if (!h) return;
			const n = Math.round(Number(note));
			const t = api.audio.timeFor(typeof at === 'number' ? at : Date.now());
			const doc = h.doc;
			const release = clamp(doc.release, 0.02, 4, 0.4);
			if (off) {
				for (const v of h.voices) if (v.note === n && !v.released) releaseVoice(h, v, Math.max(t, h.ctx.currentTime), release);
				return;
			}
			const polyphony = Math.round(clamp(doc.polyphony, 1, 16, 8));
			while (h.voices.filter((v) => !v.released).length >= polyphony) {
				const oldest = h.voices.find((v) => !v.released);
				if (!oldest) break;
				releaseVoice(h, oldest, h.ctx.currentTime, STEAL_RELEASE_S);
				oldest.stolen = true;
			}
			const ctx = h.ctx;
			const osc = ctx.createOscillator();
			osc.type = String(doc.wave || 'sawtooth');
			osc.frequency.value = 440 * Math.pow(2, (n - 69) / 12);
			const filter = ctx.createBiquadFilter();
			filter.type = 'lowpass';
			filter.frequency.value = clamp(doc.cutoff, 40, 16000, 2500);
			filter.Q.value = clamp(doc.resonance, 0.1, 20, 1);
			const amp = ctx.createGain();
			const peak = Math.max(0.001, Math.min(1, Number(velocity ?? 0.9)));
			const attack = clamp(doc.attack, 0.001, 2, 0.01);
			const decay = clamp(doc.decay, 0.01, 2, 0.15);
			const sustain = clamp(doc.sustain, 0, 1, 0.6);
			amp.gain.setValueAtTime(0, t);
			amp.gain.linearRampToValueAtTime(peak, t + attack);
			amp.gain.linearRampToValueAtTime(peak * sustain, t + attack + decay);
			osc.connect(filter);
			filter.connect(amp);
			amp.connect(h.out);
			osc.start(t);
			const hold = typeof gate === 'number' ? gate : clamp(doc.gate, 0.05, 4, 0.5);
			const gateAt = t + (hold > 0 ? hold : HOLD_LIMIT_S);
			const voice = { note: n, osc, filter, amp, at: t, gateAt, released: false, stolen: false, gateTimer: null };
			h.voices.push(voice);
			osc.onended = () => dropVoice(h, voice);
			// the gate's release is SCHEDULED on the audio clock (sample-accurate, the same on
			// every peer); an `off` note or a steal may still cut in earlier. The voice stops
			// counting against polyphony once its gate has passed.
			envelopeRelease(voice, gateAt, release);
			voice.gateTimer = setTimeout(() => {
				voice.released = true;
			}, Math.max(0, (gateAt - ctx.currentTime) * 1000));
			dipKey(node, n);
		},
		mesh: (/** @type {any} */ three) => synthMesh(three)
	};
}

/** notes held by a VR trigger: released when that hand's trigger lets go
 * @type {{uuid: string, note: number, hand: string}[]} */
let held = [];

/** a key: a replicated note. In VR, the pressing hand's trigger holds the note (gate 0) and
 * its release sends the `off`; on desktop the document's gate releases it.
 * @param {any} api @param {any} device @param {any} object */
function clickSynth(api, device, object) {
	const midi = noteOf(object);
	if (midi === null) return false;
	const inVR = typeof api.isVR === 'function' && api.isVR();
	const hand = inVR ? ['right', 'left'].find((hd) => api.vrHand?.(hd)?.trigger) ?? null : null;
	if (hand) {
		api.audio.note(device.uuid, { note: midi, velocity: 0.9, gate: 0 });
		held.push({ uuid: device.uuid, note: midi, hand });
	} else api.audio.note(device.uuid, { note: midi, velocity: 0.9 });
	api.haptic(0.6, 60);
	return true;
}

/** @param {any} api */
function updateHeld(api) {
	if (!held.length) return;
	held = held.filter((entry) => {
		const hand = api.vrHand?.(entry.hand);
		if (hand && hand.trigger) return true;
		api.audio.note(entry.uuid, { note: entry.note, velocity: 0, off: true });
		return false;
	});
}

// ---- the Theremin ---------------------------------------------------------------------------

/** @param {any} three */
function thereminMesh(three) {
	const body = new three.Mesh(
		new three.BoxGeometry(0.36, 0.12, 0.24),
		new three.MeshStandardMaterial({ color: 0x3f2d1e, roughness: 0.8, metalness: 0.1 })
	);
	body.name = 'Theremin';
	const antenna = new three.Mesh(new three.CylinderGeometry(0.008, 0.008, 0.6, 8), new three.MeshStandardMaterial({ color: 0xd1d5db, roughness: 0.3, metalness: 0.8 }));
	antenna.position.set(0.15, 0.36, 0);
	antenna.name = 'th-pitch-antenna';
	body.add(antenna);
	const loop = new three.Mesh(new three.TorusGeometry(0.07, 0.006, 8, 24), new three.MeshStandardMaterial({ color: 0xd1d5db, roughness: 0.3, metalness: 0.8 }));
	loop.position.set(-0.25, 0.1, 0);
	loop.rotation.y = Math.PI / 2;
	loop.name = 'th-volume-loop';
	body.add(loop);
	body.add(led(three, 'th-led', 0x1e3a8a, [0, 0.065, 0.08]));
	body.add(plug(three, 'out', 'out', 0xfb923c, 0, 0, 0.14));
	return body;
}

/** @param {any} api */
function thereminSpec(api) {
	return {
		kind: 'theremin',
		label: 'Theremin',
		icon: '👋',
		group: 'Music Voice',
		ports: { in: [], out: [{ id: 'out', label: 'Out', kind: 'audio' }] },
		params: [
			{ key: 'pitch', label: 'Pitch', kind: 'range', min: 55, max: 1760, step: 0.1, default: 440, unit: 'Hz' },
			{ key: 'volume', label: 'Volume', kind: 'range', min: 0, max: 1, step: 0.01, default: 0 },
			{
				key: 'wave',
				label: 'Wave',
				kind: 'select',
				default: 'sine',
				options: [
					{ value: 'sine', label: 'Sine' },
					{ value: 'triangle', label: 'Triangle' },
					{ value: 'sawtooth', label: 'Saw' }
				]
			},
			{ key: 'hand', label: 'Hand', kind: 'select', default: 'right', options: [{ value: 'right', label: 'Right' }, { value: 'left', label: 'Left' }] }
		],
		/** one oscillator that never stops, a volume gain, the output. Everything audible
		 * derives from the DOCUMENT - the hand only writes it. @param {any} ctx @param {any} node @param {any} params */
		build(ctx, node, params) {
			const osc = ctx.createOscillator();
			osc.type = String(params.wave || 'sine');
			osc.frequency.value = clamp(params.pitch, 55, 1760, 440);
			const vol = ctx.createGain();
			vol.gain.value = clamp(params.volume, 0, 1, 0);
			const out = ctx.createGain();
			osc.connect(vol);
			vol.connect(out);
			osc.start();
			const h = { ctx, node, osc, vol, out, doc: { ...params }, local: { inReach: false, lastSent: 0 } };
			theremins.set(node.uuid, h);
			return {
				output: out,
				h,
				dispose() {
					stopNode(osc);
					vol.disconnect();
					out.disconnect();
					theremins.delete(node.uuid);
				}
			};
		},
		/** glides: a hand moves continuously, the sound must too @param {any} built @param {string} key @param {any} value */
		onParam(built, key, value) {
			const h = built.h;
			if (!h) return;
			h.doc[key] = value;
			if (key === 'pitch') glide(h.osc.frequency, clamp(value, 55, 1760, 440), h.ctx, 0.03);
			else if (key === 'volume') glide(h.vol.gain, clamp(value, 0, 1, 0), h.ctx, 0.03);
			else if (key === 'wave') h.osc.type = String(value);
		},
		mesh: (/** @type {any} */ three) => thereminMesh(three)
	};
}

/** the VR hand -> the document, at THEREMIN_HZ: hand height above the body is pitch, the
 * hand's distance from the body is volume. Written as previews (replicated, history-free);
 * a hand that leaves reach writes volume 0 once. Nothing here is heard directly - every
 * peer, this one included, synthesizes from the document. @param {any} api @param {number} nowMs */
function updateTheremins(api, nowMs) {
	if (typeof api.isVR !== 'function' || !api.isVR()) return;
	for (const [uuid, h] of theremins) {
		const hand = api.vrHand?.(String(h.doc.hand || 'right'));
		if (!hand || !hand.connected || !h.node?.getWorldPosition) continue;
		const at = h.node.getWorldPosition(new api.THREE.Vector3());
		const dx = hand.position[0] - at.x;
		const dy = hand.position[1] - at.y;
		const dz = hand.position[2] - at.z;
		const d = Math.hypot(dx, dz);
		if (d > REACH || dy < -0.2) {
			if (h.local.inReach) {
				h.local.inReach = false;
				api.audio.previewParams(uuid, { volume: 0 });
			}
			continue;
		}
		h.local.inReach = true;
		if (nowMs - h.local.lastSent < PREVIEW_MS) continue;
		const height = Math.max(0, Math.min(1, (dy - 0.05) / HEIGHT_SPAN));
		const pitch = Math.round(PITCH_LO * Math.pow(2, height * PITCH_OCTAVES) * 10) / 10;
		const volume = Math.round(Math.max(0, Math.min(1, 1 - (d - VOLUME_NEAR) / (REACH - VOLUME_NEAR))) * 100) / 100;
		const pitchNow = Number(h.doc.pitch) || 440;
		if (Math.abs(pitch - pitchNow) / pitchNow < 0.004 && Math.abs(volume - (Number(h.doc.volume) || 0)) < 0.02) continue;
		h.local.lastSent = nowMs;
		api.audio.previewParams(uuid, { pitch, volume });
	}
}

// ---- the frame task ----------------------------------------------------------------------------

let nextDisplay = 0;
let nextLooper = 0;
let nextTheremin = 0;

/** @param {any} api @param {number} time seconds */
function voiceFrame(api, time) {
	updateHeld(api);
	const nowMs = performance.now();
	if (time >= nextTheremin) {
		nextTheremin = time + 1 / THEREMIN_HZ;
		updateTheremins(api, nowMs);
	}
	if (time >= nextLooper) {
		nextLooper = time + 1 / LOOPER_HZ;
		const t = api.audio.transport();
		for (const h of loopers.values()) {
			if (!t.playing) {
				if (h.src) stopLoopSource(h, h.ctx.currentTime);
				continue;
			}
			if (h.src) {
				// a tempo change mid-pass: keep the running pass at the new ratio
				const rate = t.bpm / clamp(h.doc.loopBpm, 20, 400, 120);
				if (Math.abs(h.src.playbackRate.value - rate) > 1e-6) h.src.playbackRate.setTargetAtTime(rate, h.ctx.currentTime, 0.01);
			} else catchUp(api, h);
		}
	}
	if (time < nextDisplay) return;
	nextDisplay = time + 1 / DISPLAY_HZ;
	for (const h of mics.values()) {
		const lamp = h.node?.getObjectByName?.('mic-led');
		if (lamp) light(lamp, recState.active ? 0xef4444 : h.source ? 0x16a34a : 0x7f1d1d, recState.active ? 0.9 : 0.2);
	}
	const t = api.audio.transport();
	for (const h of loopers.values()) {
		const lamp = h.node?.getObjectByName?.('lp-led');
		const state = String(h.doc.state || 'idle');
		if (lamp) light(lamp, state === 'recording' ? 0xef4444 : state === 'armed' ? 0xf59e0b : h.buffer ? 0x22c55e : 0x3f3f46, state === 'idle' ? 0.2 : 0.9);
		const play = h.node?.getObjectByName?.('lp-play');
		if (play) light(play, h.doc.play === false ? 0x166534 : 0x22c55e, 0);
		const ring = h.node?.getObjectByName?.('lp-ring');
		if (ring && h.buffer && t.playing) {
			const P = loopBeatsOf(h.doc);
			const phase = ((((t.beat - (Number(h.doc.startedBeat) || 0)) % P) + P) % P) / P;
			ring.rotation.z = -phase * Math.PI * 2;
		}
	}
	for (const h of theremins.values()) {
		const lamp = h.node?.getObjectByName?.('th-led');
		const volume = clamp(h.doc.volume, 0, 1, 0);
		if (lamp) light(lamp, volume > 0.01 ? 0x60a5fa : 0x1e3a8a, volume);
	}
}

// ---- the module -----------------------------------------------------------------------------

export default {
	id: 'music-voice',
	name: 'Music Voice',
	version: '0.1.1',
	description: 'A Mic, a Looper, a Synth and a Theremin on the engine: sing into the graph, loop what is patched in on the bar, play chords, wave a hand.',
	/** @param {any} api */
	register(api) {
		void api.THREE; // handed to mesh(three) by the registry; never imported
		const mine = ++generation;
		api.registerAudioDevice(micSpec(api)).then((/** @type {string} */ kind) => (KINDS.mic = kind));
		api.registerAudioDevice(looperSpec(api)).then((/** @type {string} */ kind) => (KINDS.looper = kind));
		api.registerAudioDevice(synthSpec(api)).then((/** @type {string} */ kind) => (KINDS.synth = kind));
		api.registerAudioDevice(thereminSpec(api)).then((/** @type {string} */ kind) => (KINDS.theremin = kind));

		// the local recorder's state, for the mic faces (a store behind a promise)
		Promise.resolve(api.audio.recording?.())
			.then((/** @type {any} */ store) => {
				if (!store?.subscribe) return;
				store.subscribe((/** @type {any} */ value) => {
					if (mine === generation && value) recState = value;
				});
			})
			.catch(() => {});

		// PLAY pieces (the mic's and looper's buttons, the synth keys): Interact and Play.
		// In Edit a click selects the device.
		api.registerClickHandler(
			(/** @type {any} */ object) => {
				const device = deviceRootOf(object);
				const kind = device?.userData?.device?.kind;
				if (!kind) return false;
				if (kind === KINDS.mic) return clickMic(api, device, object);
				if (kind === KINDS.looper) return clickLooper(api, device, object);
				if (kind === KINDS.synth) return clickSynth(api, device, object);
				return false;
			},
			{ modes: ['interact', 'play'] }
		);
		api.registerFrameTask((/** @type {number} */ time) => voiceFrame(api, time));

		api.registerMenu('Music Voice: demo', () => {
			const synth = api.audio.addDevice('synth', { position: [-1.2, 0.8, -2] });
			const looper = api.audio.addDevice('looper', { position: [-0.2, 0.8, -2] });
			const mic = api.audio.addDevice('mic', { position: [0.7, 0.8, -2] });
			const theremin = api.audio.addDevice('theremin', { position: [1.5, 0.8, -2] });
			if (!synth || !looper || !mic || !theremin) return api.toast('Music Voice: could not add the devices');
			api.audio.cable({ from: { uuid: synth.uuid, port: 'out' }, to: { uuid: looper.uuid, port: 'in' } });
			// a Music Lab speaker if that module is here: the rig reaches the room through it
			const speaker = api.audio.addDevice('mod-music-lab-speaker', { position: [0, 0, -3.2] });
			const spec = speaker && api.audio.device(speaker.uuid);
			if (speaker && spec) {
				for (const from of [looper, mic, theremin]) api.audio.cable({ from: { uuid: from.uuid, port: 'out' }, to: { uuid: speaker.uuid, port: 'in' } });
			}
			api.toast('Music Voice: play the synth, press Record on the looper' + (speaker ? '' : ', then cable the looper, the mic and the theremin to a speaker'));
		});

		api.onSceneClear(() => {
			mics.clear();
			loopers.clear();
			synths.clear();
			theremins.clear();
			held = [];
		});
	}
};
