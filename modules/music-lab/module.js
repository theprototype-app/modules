// Music Lab — roadmap #23 C1: the audio-device architecture proven end to end with
// two devices, a Piano and a Speaker, and one cable between them.
//
// THE WHOLE MODULE IS TWO `registerAudioDevice` SPECS. Core owns the object, the
// replication, the undo, the saving, the cables and the clock; this file owns what a
// kind sounds like, what it looks like, and which of its params do what. Nothing here
// keeps replicated state of its own and nothing here sends a message: a note goes out
// through `api.audio.note`, which stamps it and hands every peer the same
// `onNote(handle, {note, velocity, at})` to run.
//
// THE ONE RULE THAT MAKES THAT WORK: `build`, `onParam` and `onNote` must be PURE
// FUNCTIONS OF THEIR ARGUMENTS. Every peer runs them, from the same document and the
// same stamp; anything read out of local state (which key I clicked, what time it is
// here) desyncs silently, per peer, with no error anywhere. So the key that dips is
// found from the NOTE inside `onNote`, never from the click that started it — the peer
// who did not click has to dip the same key.
//
// SOUND GOES NOWHERE UNTIL IT IS CABLED. The piano's voices land on its own output
// gain, and that gain connects to nothing; the speaker is the only thing here that
// reaches `api.audio.bus('instruments')`. Pull the cable and the master bus drops to
// the noise floor. That is the design, not an omission.

const WHITE_MIDI = [60, 62, 64, 65, 67, 69, 71]; // C4..B4
const BLACK_MIDI = { 0: 61, 1: 63, 3: 66, 4: 68, 5: 70 }; // after C, D, F, G, A
const KEY_STEP = 0.24;
const KEY_DIP = 0.02;
const KEY_DIP_MS = 150;

/** How often the panners are re-aimed. 20 Hz is far more than a speaker being
 * carried across a room needs, and the app's own AudioListener update is 10 Hz. */
const FOLLOW_HZ = 20;

/** The NAMESPACED kind (`mod-music-lab-piano`), once registerAudioDevice resolves —
 * what the click handler matches an object's `userData.device.kind` against. */
let PIANO_KIND = '';

/**
 * Every built speaker, so ONE frame task moves every panner. A panner that does not
 * follow its object is a speaker you can carry around silently — the whole point of a
 * device being an object is that moving it moves where it sounds from.
 * @type {Map<string, {node: any, panner: any}>}
 */
const speakers = new Map();

// ---- meshes --------------------------------------------------------------------------
//
// A cable attaches to the child named for the port. Core's renderer looks for
// `port:<id>`; the VR patching work names the same thing `vrpatch-in:<id>` /
// `vrpatch-out:<id>`. Both names are here — the visible plug carries the vrpatch name
// and holds a zero-offset `port:<id>` marker — so the cable lands on the plug whichever
// convention the build we are running looks for.

/** @param {any} three @param {'in'|'out'} side @param {string} id @param {number} color @param {number} z */
function plug(three, side, id, color, z) {
	const mesh = new three.Mesh(
		new three.CylinderGeometry(0.02, 0.02, 0.04, 12),
		new three.MeshStandardMaterial({ color, roughness: 0.4, metalness: 0.6 })
	);
	mesh.rotation.x = Math.PI / 2; // lie along Z, sticking out of the back
	mesh.position.set(0, 0, z);
	mesh.name = 'vrpatch-' + side + ':' + id;
	const marker = new three.Object3D();
	marker.name = 'port:' + id;
	mesh.add(marker);
	return mesh;
}

/**
 * THE DEVICE ROOT IS A MESH, NOT A GROUP, and that is load-bearing: the late-joiner
 * object sync sends a `Group` as a bare `{type:'group', name, uuid, pos, rot, scale}`
 * message with NO userData, so a device whose mesh() returns a Group reaches a joiner
 * as an ordinary group with its `userData.device` gone — no kind, no sound. A mesh
 * WITH children goes as `toJSON()` (userData intact) plus its children after it. Core's
 * own placeholder and default device mesh are meshes for the same reason.
 * @param {any} three
 */
function speakerMesh(three) {
	const cabinet = new three.Mesh(
		new three.BoxGeometry(0.5, 0.7, 0.4),
		new three.MeshStandardMaterial({ color: 0x2b2b30, roughness: 0.85, metalness: 0.05 })
	);
	cabinet.name = 'Speaker';
	// the driver, on the FRONT (-Z). Which way it points is AUDIBLE — the panner's cone
	// is aimed down this same -Z — so it has to be visible from across the room.
	const cone = new three.Mesh(
		new three.ConeGeometry(0.17, 0.12, 24, 1, true),
		new three.MeshStandardMaterial({ color: 0xd8b26a, roughness: 0.55, metalness: 0.3, side: three.DoubleSide })
	);
	cone.rotation.x = -Math.PI / 2; // the cone's +Y axis onto -Z
	cone.position.set(0, -0.06, -0.23);
	cone.name = 'grille';
	cabinet.add(cone);
	const tweeter = new three.Mesh(
		new three.CylinderGeometry(0.055, 0.055, 0.03, 16),
		new three.MeshStandardMaterial({ color: 0x111114, roughness: 0.5 })
	);
	tweeter.rotation.x = Math.PI / 2;
	tweeter.position.set(0, 0.22, -0.21);
	tweeter.name = 'tweeter';
	cabinet.add(tweeter);
	cabinet.add(plug(three, 'in', 'in', 0xfb923c, 0.22));
	return cabinet;
}

/** @param {any} three */
function pianoMesh(three) {
	const body = new three.Mesh(
		new three.BoxGeometry(WHITE_MIDI.length * KEY_STEP + 0.08, 0.1, 1.05),
		new three.MeshStandardMaterial({ color: 0x5c3a21, roughness: 0.8 })
	);
	body.name = 'Piano';
	const left = -((WHITE_MIDI.length - 1) * KEY_STEP) / 2;
	const white = new three.MeshStandardMaterial({ color: 0xf5f5f0, roughness: 0.6 });
	const black = new three.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.5 });
	WHITE_MIDI.forEach((midi, index) => {
		const key = new three.Mesh(new three.BoxGeometry(0.22, 0.06, 0.9), white);
		key.position.set(left + index * KEY_STEP, 0.08, 0);
		// the CLICK reads this (desktop and VR trigger are one path), and so does onNote.
		// The NAME carries the same number, because userData rides GLTF extras on the
		// late-joiner path and a name rides the node itself.
		key.userData.midi = midi;
		key.name = 'key-' + midi;
		body.add(key);
	});
	for (const [afterWhite, midi] of Object.entries(BLACK_MIDI)) {
		const key = new three.Mesh(new three.BoxGeometry(0.13, 0.07, 0.55), black);
		key.position.set(left + (Number(afterWhite) + 0.5) * KEY_STEP, 0.125, -0.17);
		key.userData.midi = midi;
		key.name = 'key-' + midi;
		body.add(key);
	}
	body.add(plug(three, 'out', 'out', 0xfb923c, 0.55));
	return body;
}

// ---- the key dip ---------------------------------------------------------------------

/**
 * The note a mesh stands for, from its userData or — when a replication path dropped
 * that — from its name. @param {any} object @returns {number|null}
 */
function noteOf(object) {
	const midi = object?.userData?.midi;
	if (typeof midi === 'number') return midi;
	const named = typeof object?.name === 'string' && object.name.startsWith('key-') ? Number(object.name.slice(4)) : NaN;
	return Number.isFinite(named) ? named : null;
}

/**
 * Dip the key a note belongs to. Driven from `onNote`, so the peer who clicked and the
 * peer who only heard about it move the same key. Purely visual and purely local: a
 * dropped dip is a missed frame, never a desync.
 * @param {any} node the device object @param {number} note
 */
function dipKey(node, note) {
	if (!node) return;
	let key = node.getObjectByName?.('key-' + note) ?? null;
	if (!key)
		node.traverse?.((/** @type {any} */ child) => {
			if (!key && noteOf(child) === note) key = child;
		});
	if (!key || key.userData.dipped) return;
	key.userData.dipped = true;
	key.position.y -= KEY_DIP;
	setTimeout(() => {
		key.position.y += KEY_DIP;
		key.userData.dipped = false;
	}, KEY_DIP_MS);
}

// ---- the device specs ------------------------------------------------------------------

/** @param {any} panner @param {number} inner the one knob; the outer angle derives from it */
function applyCone(panner, inner) {
	const innerAngle = Math.max(10, Math.min(360, Number(inner) || 120));
	panner.coneInnerAngle = innerAngle;
	panner.coneOuterAngle = Math.min(360, innerAngle + 60);
	// not zero: a speaker behind you is quieter, not gone. 0.25 is about a bookshelf
	// cabinet heard from behind.
	panner.coneOuterGain = 0.25;
}

/** @param {any} api */
function speakerSpec(api) {
	return {
		kind: 'speaker',
		label: 'Speaker',
		icon: '🔊',
		group: 'Music Lab',
		ports: { in: [{ id: 'in', label: 'In', kind: 'audio' }], out: [] },
		params: [
			{ key: 'level', label: 'Level', kind: 'range', min: 0, max: 1, step: 0.01, default: 0.8 },
			{ key: 'cone', label: 'Cone width', kind: 'range', min: 10, max: 360, step: 1, default: 120, unit: '°' },
			{ key: 'rolloff', label: 'Rolloff', kind: 'range', min: 0.1, max: 5, step: 0.1, default: 1 },
			{ key: 'maxDistance', label: 'Max distance', kind: 'range', min: 5, max: 200, step: 1, default: 40, unit: 'm' }
		],
		/**
		 * in -> level -> HRTF panner -> the instruments bus. The panner is what makes this
		 * a place in the room rather than a track in a mix; `maxDistance` defaults to 40 m,
		 * the same distance voice chat carries.
		 * @param {any} ctx @param {any} node @param {any} params
		 */
		build(ctx, node, params) {
			const input = ctx.createGain();
			const gain = ctx.createGain();
			gain.gain.value = Number(params.level ?? 0.8);
			const panner = ctx.createPanner();
			panner.panningModel = 'HRTF';
			panner.distanceModel = 'inverse';
			panner.refDistance = 1;
			panner.rolloffFactor = Number(params.rolloff ?? 1);
			panner.maxDistance = Number(params.maxDistance ?? 40);
			applyCone(panner, params.cone ?? 120);
			input.connect(gain);
			gain.connect(panner);
			panner.connect(api.audio.bus('instruments') ?? ctx.destination);
			// the panner starts WHERE THE OBJECT IS, not at the origin: one frame at the
			// wrong place is an audible click on a device that was just dropped in
			aim(node, panner);
			speakers.set(node.uuid, { node, panner });
			return {
				input,
				panner,
				gain,
				dispose() {
					speakers.delete(node.uuid);
					try {
						input.disconnect();
						gain.disconnect();
						panner.disconnect();
					} catch {
						/* already gone */
					}
				}
			};
		},
		/** every param is live — a knob must not restart the audio it is adjusting */
		onParam(handle, key, value) {
			if (key === 'level') handle.gain.gain.value = Number(value);
			else if (key === 'cone') applyCone(handle.panner, value);
			else if (key === 'rolloff') handle.panner.rolloffFactor = Number(value);
			else if (key === 'maxDistance') handle.panner.maxDistance = Number(value);
		},
		/** @param {any} three */
		mesh: (three) => speakerMesh(three)
	};
}

/** @param {any} api */
function pianoSpec(api) {
	return {
		kind: 'piano',
		label: 'Piano',
		icon: '🎹',
		group: 'Music Lab',
		ports: { in: [], out: [{ id: 'out', label: 'Out', kind: 'audio' }] },
		params: [
			{ key: 'level', label: 'Level', kind: 'range', min: 0, max: 1, step: 0.01, default: 0.8 },
			{ key: 'release', label: 'Release', kind: 'range', min: 0.05, max: 2, step: 0.01, default: 0.4, unit: 's' },
			{
				key: 'wave',
				label: 'Wave',
				kind: 'select',
				default: 'triangle',
				options: [
					{ value: 'sine', label: 'Sine' },
					{ value: 'triangle', label: 'Triangle' },
					{ value: 'sawtooth', label: 'Saw' },
					{ value: 'square', label: 'Square' }
				]
			}
		],
		/**
		 * One gain, connected to NOTHING. Every voice lands here, and here is where a
		 * cable picks it up — an instrument that reached a bus by itself would still be
		 * heard with its cable pulled, which is the one thing a patch has to mean.
		 * The params ride the handle because `onNote` gets the handle, not the document.
		 * @param {any} ctx @param {any} node @param {any} params
		 */
		build(ctx, node, params) {
			const output = ctx.createGain();
			output.gain.value = 1;
			return {
				output,
				params: { ...params },
				/** @type {any[]} */
				voices: [],
				dispose() {
					for (const voice of this.voices) {
						try {
							voice.dispose();
						} catch {
							/* already disposed */
						}
					}
					this.voices.length = 0;
					output.disconnect();
				}
			};
		},
		onParam(handle, key, value) {
			handle.params[key] = value;
		},
		/**
		 * A note, on every peer, from the same stamp. `at` is WALL CLOCK and comes down the
		 * wire raw; `api.audio.timeFor` is the only correct way to turn it into a time this
		 * context can schedule at — a `ctx.currentTime + something` of our own would put
		 * two peers' notes tens of milliseconds apart, which is audible as a flam.
		 * @param {any} handle @param {any} event @param {any} node
		 */
		onNote(handle, { note, velocity, at }, node) {
			const level = Number(handle.params.level ?? 0.8);
			const gain = Math.max(0.001, Math.min(1, Number(velocity ?? 1))) * level;
			const voice = api.audio.voice({
				type: handle.params.wave ?? 'triangle',
				freq: 440 * Math.pow(2, (Number(note) - 69) / 12),
				gain,
				attack: 0.005,
				decay: 0.08,
				sustain: 0.5,
				release: Number(handle.params.release ?? 0.4),
				destination: handle.output
			});
			if (!voice) return;
			const t = api.audio.timeFor(typeof at === 'number' ? at : Date.now());
			voice.start(t);
			voice.stop(t + 0.35);
			handle.voices.push(voice);
			// polyphony is a LIST of voices, each cleaned up after its own release
			setTimeout(() => {
				const index = handle.voices.indexOf(voice);
				if (index >= 0) handle.voices.splice(index, 1);
				voice.dispose();
			}, 1000);
			dipKey(node, Number(note));
		},
		/** @param {any} three */
		mesh: (three) => pianoMesh(three)
	};
}

// ---- the panner follow ------------------------------------------------------------------

/** Point one panner at its object's world pose. @param {any} node @param {any} panner */
function aim(node, panner) {
	node.updateWorldMatrix?.(true, false);
	const m = node.matrixWorld?.elements;
	if (!m) return;
	const px = m[12];
	const py = m[13];
	const pz = m[14];
	// the -Z column of the world matrix is the object's forward, normalized (the matrix
	// carries scale, and an unnormalized orientation makes the cone nonsense)
	let fx = -m[8];
	let fy = -m[9];
	let fz = -m[10];
	const length = Math.hypot(fx, fy, fz) || 1;
	fx /= length;
	fy /= length;
	fz /= length;
	if (panner.positionX) {
		panner.positionX.value = px;
		panner.positionY.value = py;
		panner.positionZ.value = pz;
		panner.orientationX.value = fx;
		panner.orientationY.value = fy;
		panner.orientationZ.value = fz;
	} else {
		// Safari and anything else still on the pre-AudioParam PannerNode
		panner.setPosition(px, py, pz);
		panner.setOrientation(fx, fy, fz);
	}
}

// ---- the module -----------------------------------------------------------------------

// ---- 23-C2: the beat lab ----------------------------------------------------------------
//
// Three more devices. A TRANSPORT you walk up to - the face of the SHARED clock: play/stop,
// BPM, tap tempo, a bar counter - because a room full of sequenced devices needs one obvious
// place to start and stop. A DRUM MACHINE, 16 steps x 8 pads: THE PATTERN LIVES IN
// userData.device (the `pattern` param, one string), so it replicates, saves and undoes as
// one thing with no new channel - the whole payoff of the A3 contract. SAMPLER pads, 4x4,
// a sample per pad dropped from the Explorer (api.registerDropHandler).
//
// Steps are scheduled through the engine's look-ahead scheduler (api.audio.schedule): every
// peer runs the same pattern from the same transport, so every peer's kick lands on the same
// sample frame and nothing crosses the wire during playback. The only writes are
// api.audio.setParams (one undo entry each) and the shared transport's own play/setBpm.
// A paint stroke across the grid previews LOCALLY (the way a knob scrub previews) and
// commits ONE write when it ends, so a drag is one undo entry.

const STEPS = 16;
const DRUM_PADS = 8;
const DRUM_NAMES = ['Kick', 'Snare', 'Hat', 'Open hat', 'Clap', 'Tom', 'Rim', 'Crash'];
const DRUM_COLORS = [0xef4444, 0xf59e0b, 0xfacc15, 0xa3e635, 0x22d3ee, 0x818cf8, 0xf472b6, 0xe5e7eb];
const SAMPLER_PADS = 16;
/** pad n of a drum machine or a sampler plays as note BASE + n, so a flow Note Trigger
 * (23-B3) and the piano's own note path reach the pads with no extra API */
const PAD_BASE_NOTE = 36;
const STEP_ON = '7'; // the velocity digit a click paints (0..9 -> 0..1)
const STROKE_IDLE_MS = 900; // a paint stroke commits this long after its last new step
const FLASH_MS = 90;
const DISPLAY_HZ = 12;
const CELL_X0 = -0.33;
const CELL_DX = 0.05;
const ROW_Z0 = -0.19;
const ROW_DZ = 0.054;

/** the resolved namespaced kinds, once registerAudioDevice resolves */
const KINDS = { drums: '', sampler: '', transport: '' };

// ---- the pattern (pure helpers) ---------------------------------------------------------

/** @returns {string} DRUM_PADS rows of STEPS velocity digits, joined by '/' */
function emptyPattern() {
	return Array.from({ length: DRUM_PADS }, () => '0'.repeat(STEPS)).join('/');
}
/** @param {any} pattern @returns {string[]} */
function patternRows(pattern) {
	const rows = String(pattern ?? '').split('/');
	return Array.from({ length: DRUM_PADS }, (_, r) => (rows[r] ?? '').padEnd(STEPS, '0').slice(0, STEPS));
}
/** @param {string[]} rows @param {number} pad @param {number} step */
function stepDigit(rows, pad, step) {
	const d = Number.parseInt(rows[pad]?.[step] ?? '0', 10);
	return Number.isFinite(d) ? Math.max(0, Math.min(9, d)) : 0;
}
/** @param {string[]} rows @param {number} pad @param {number} step @param {number|string} digit */
function withStepDigit(rows, pad, step, digit) {
	return rows.map((row, r) => (r === pad ? row.slice(0, step) + String(digit) + row.slice(step + 1) : row)).join('/');
}
/** per-pad settings live in ONE JSON string param: {"<pad>": {sample, name, level, pan, mute, choke, pitch, start, loop, gate}}
 * @param {any} json */
function padTable(json) {
	try {
		const v = JSON.parse(json || '{}');
		return v && typeof v === 'object' ? v : {};
	} catch {
		return {};
	}
}
/** @param {any} table @param {number} pad @param {string} key @param {any} fallback */
function padSetting(table, pad, key, fallback) {
	const v = table?.[pad]?.[key];
	return v === undefined || v === null ? fallback : v;
}

// ---- voices ------------------------------------------------------------------------------

/** one deterministic noise buffer per context (an LCG, so every peer's snare is the same
 * noise) @type {WeakMap<any, any>} */
const noiseBuffers = new WeakMap();
/** @param {any} ctx */
function noiseBuffer(ctx) {
	let buffer = noiseBuffers.get(ctx);
	if (buffer) return buffer;
	buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 1.5), ctx.sampleRate);
	const data = buffer.getChannelData(0);
	let seed = 1234567;
	for (let i = 0; i < data.length; i++) {
		seed = (seed * 1664525 + 1013904223) >>> 0;
		data[i] = (seed / 4294967296) * 2 - 1;
	}
	noiseBuffers.set(ctx, buffer);
	return buffer;
}

/**
 * A synthesized drum at audio time `at` - a pure function of (pad, velocity, at), which is
 * what lets every peer play the identical hit from the identical schedule.
 * @param {any} ctx @param {any} destination @param {number} pad @param {number} velocity @param {number} at
 */
function playDrum(ctx, destination, pad, velocity, at) {
	const v = Math.max(0.05, Math.min(1, velocity));
	/** @type {any[]} */
	const sources = [];
	/** @param {string} type @param {number} f0 @param {number} f1 @param {number} dur @param {number} peak */
	const tone = (type, f0, f1, dur, peak) => {
		const osc = ctx.createOscillator();
		osc.type = type;
		osc.frequency.setValueAtTime(f0, at);
		if (f1 !== f0) osc.frequency.exponentialRampToValueAtTime(f1, at + dur * 0.8);
		const gain = ctx.createGain();
		gain.gain.setValueAtTime(peak * v, at);
		gain.gain.exponentialRampToValueAtTime(0.001, at + dur);
		osc.connect(gain);
		gain.connect(destination);
		osc.start(at);
		osc.stop(at + dur + 0.02);
		sources.push(osc);
	};
	/** @param {string} filter @param {number} freq @param {number} q @param {number} dur @param {number} peak @param {number} [delay] */
	const noise = (filter, freq, q, dur, peak, delay = 0) => {
		const src = ctx.createBufferSource();
		src.buffer = noiseBuffer(ctx);
		const biquad = ctx.createBiquadFilter();
		biquad.type = filter;
		biquad.frequency.value = freq;
		biquad.Q.value = q;
		const gain = ctx.createGain();
		gain.gain.setValueAtTime(0.0001, at + delay);
		gain.gain.linearRampToValueAtTime(peak * v, at + delay + 0.003);
		gain.gain.exponentialRampToValueAtTime(0.001, at + delay + dur);
		src.connect(biquad);
		biquad.connect(gain);
		gain.connect(destination);
		src.start(at + delay);
		src.stop(at + delay + dur + 0.02);
		sources.push(src);
	};
	switch (pad) {
		case 0: tone('sine', 160, 45, 0.28, 1.0); noise('lowpass', 900, 0.7, 0.02, 0.4); break;
		case 1: tone('triangle', 200, 160, 0.12, 0.5); noise('bandpass', 1800, 0.8, 0.18, 0.8); break;
		case 2: noise('highpass', 7000, 1, 0.05, 0.6); break;
		case 3: noise('highpass', 6500, 1, 0.35, 0.5); break;
		case 4: noise('bandpass', 1300, 1.2, 0.05, 0.7); noise('bandpass', 1300, 1.2, 0.05, 0.6, 0.02); noise('bandpass', 1300, 1.2, 0.16, 0.7, 0.04); break;
		case 5: tone('sine', 220, 90, 0.3, 0.9); break;
		case 6: tone('square', 1000, 1000, 0.03, 0.35); noise('bandpass', 3000, 2, 0.04, 0.4); break;
		default: noise('highpass', 5000, 0.5, 1.2, 0.5); break;
	}
	return {
		/** @param {number} t */
		stop(t) {
			for (const s of sources) {
				try { s.stop(t); } catch { /* already stopped */ }
			}
		}
	};
}

/**
 * A sample at audio time `at`: pitch in semitones, start as a fraction of the buffer, loop,
 * gate (seconds, 0 = one-shot to the end).
 * @param {any} ctx @param {any} destination @param {any} buffer @param {number} at
 * @param {{pitch?: number, start?: number, loop?: boolean, gate?: number, level?: number, velocity?: number}} opts
 */
function playSample(ctx, destination, buffer, at, opts = {}) {
	const src = ctx.createBufferSource();
	src.buffer = buffer;
	src.playbackRate.value = Math.pow(2, (Number(opts.pitch) || 0) / 12);
	src.loop = !!opts.loop;
	const gain = ctx.createGain();
	gain.gain.value = Math.max(0, Math.min(1, Number(opts.level ?? 1))) * Math.max(0, Math.min(1, Number(opts.velocity ?? 1)));
	src.connect(gain);
	gain.connect(destination);
	const start = Math.max(0, Math.min(buffer.duration, (Number(opts.start) || 0) * buffer.duration));
	src.start(at, start);
	const gate = Number(opts.gate) || 0;
	if (!opts.loop && gate > 0) src.stop(at + Math.max(0.02, gate));
	return {
		/** @param {number} t */
		stop(t) {
			try {
				gain.gain.setTargetAtTime(0, t, 0.01);
				src.stop(t + 0.06);
			} catch { /* already stopped */ }
		}
	};
}

/** the pad's own panner, made once and connected to the device output @param {any} h @param {number} pad @param {number} pan */
function padDestination(h, pad, pan) {
	let node = h.panners.get(pad);
	if (!node) {
		node = h.ctx.createStereoPanner ? h.ctx.createStereoPanner() : h.ctx.createGain();
		node.connect(h.out);
		h.panners.set(pad, node);
	}
	if (node.pan) node.pan.value = Math.max(-1, Math.min(1, Number(pan) || 0));
	return node;
}

/** fetch every pad sample the table names and is not decoded yet @param {any} api @param {any} h */
function prefetchPadSamples(api, h) {
	for (const pad of Object.keys(h.pads)) {
		const hash = padSetting(h.pads, Number(pad), 'sample', '');
		if (!hash || h.buffers.has(hash) || h.pending.has(hash)) continue;
		h.pending.add(hash);
		Promise.resolve(api.audio.sample(hash))
			.then((/** @type {any} */ buffer) => {
				if (buffer) h.buffers.set(hash, buffer);
			})
			.catch(() => {})
			.finally(() => h.pending.delete(hash));
	}
}

/**
 * One pad hit at audio time `at`: its sample when it has one and it is decoded, else the
 * synthesized drum. A pad in a choke group stops the group's other pads (the closed hat
 * closes the open one). Every peer runs this from the same schedule or the same note stamp.
 * @param {any} api @param {any} h @param {number} pad @param {number} velocity @param {number} at
 */
function hitPad(api, h, pad, velocity, at) {
	const level = Number(padSetting(h.pads, pad, 'level', 1));
	const pan = Number(padSetting(h.pads, pad, 'pan', 0));
	const dest = padDestination(h, pad, pan);
	const group = Number(padSetting(h.pads, pad, 'choke', h.kind === 'drums' && (pad === 2 || pad === 3) ? 1 : 0)) || 0;
	if (group)
		for (const [other, live] of h.live) {
			if (other !== pad && live.group === group) {
				live.stop(at);
				h.live.delete(other);
			}
		}
	const hash = String(padSetting(h.pads, pad, 'sample', '') || '');
	const buffer = hash ? h.buffers.get(hash) : null;
	/** @type {any} */
	let voice;
	if (buffer) {
		voice = playSample(h.ctx, dest, buffer, at, {
			level,
			velocity,
			pitch: Number(padSetting(h.pads, pad, 'pitch', 0)),
			start: Number(padSetting(h.pads, pad, 'start', 0)),
			loop: !!padSetting(h.pads, pad, 'loop', false),
			gate: Number(padSetting(h.pads, pad, 'gate', 0))
		});
	} else if (h.kind === 'drums') {
		voice = playDrum(h.ctx, dest, pad, velocity * level, at);
	} else {
		// an empty sampler pad still answers: a soft tick, so the pad is felt before it is filled
		voice = playDrum(h.ctx, dest, 6, velocity * level * 0.4, at);
	}
	h.live.set(pad, { stop: voice.stop, group });
	flashLater(h, h.kind === 'drums' ? 'pad-' + pad : 'spad-' + pad, at);
}

/** a visual flash at the moment the hit is HEARD (audio time -> a local timeout). Purely
 * visual and purely local. @param {any} h @param {string} name @param {number} at */
function flashLater(h, name, at) {
	const mesh = h.node?.getObjectByName?.(name);
	if (!mesh) return;
	const wait = Math.max(0, (at - h.ctx.currentTime) * 1000);
	setTimeout(() => {
		if (flashing.has(mesh)) return;
		flashing.add(mesh);
		mesh.scale.set(1.35, 1.6, 1.35);
		setTimeout(() => {
			mesh.scale.set(1, 1, 1);
			flashing.delete(mesh);
		}, FLASH_MS);
	}, wait);
}

/** the scheduler's callback for a drum machine: a 16th, on every peer, from the same
 * transport. `beat` is the unswung beat (the step index), `at` the swung audio time.
 * @param {any} api @param {any} h @param {{beat: number, at: number, late: boolean}} e */
function drumStep(api, h, e) {
	if (e.late) return; // a beat already gone is not a hit to fire now (a late joiner's catch-up)
	const step = (((Math.round(e.beat * 4) % STEPS) + STEPS) % STEPS);
	for (let pad = 0; pad < DRUM_PADS; pad++) {
		const digit = stepDigit(h.rows, pad, step);
		if (!digit || padSetting(h.pads, pad, 'mute', false)) continue;
		hitPad(api, h, pad, digit / 9, e.at);
	}
	h.hits.push({ step, at: e.at, wall: Date.now() + (e.at - h.ctx.currentTime) * 1000 });
	if (h.hits.length > 512) h.hits.splice(0, h.hits.length - 512);
}

// ---- meshes ------------------------------------------------------------------------------

/** the x of a step column @param {number} step */
function cellX(step) {
	return CELL_X0 + step * CELL_DX;
}
/** the z of a pad row @param {number} pad */
function rowZ(pad) {
	return ROW_Z0 + pad * ROW_DZ;
}

/** @param {any} three */
function drumsMesh(three) {
	const body = new three.Mesh(
		new three.BoxGeometry(1.0, 0.12, 0.55),
		new three.MeshStandardMaterial({ color: 0x2a2a2e, roughness: 0.85, metalness: 0.1 })
	);
	body.name = 'Drum machine';
	const off = new three.MeshStandardMaterial({ color: 0x4b4b52, roughness: 0.7 });
	for (let pad = 0; pad < DRUM_PADS; pad++) {
		const button = new three.Mesh(
			new three.BoxGeometry(0.06, 0.03, 0.045),
			new three.MeshStandardMaterial({ color: DRUM_COLORS[pad], roughness: 0.5 })
		);
		button.position.set(-0.42, 0.075, rowZ(pad));
		button.name = 'pad-' + pad;
		button.userData.drumPad = pad;
		body.add(button);
		for (let step = 0; step < STEPS; step++) {
			const cell = new three.Mesh(new three.BoxGeometry(0.038, 0.02, 0.04), off);
			cell.position.set(cellX(step), 0.07, rowZ(pad));
			cell.name = 'step-' + pad + '-' + step;
			cell.userData.drumPad = pad;
			cell.userData.drumStep = step;
			body.add(cell);
		}
	}
	const playhead = new three.Mesh(
		new three.BoxGeometry(0.044, 0.006, 0.5),
		new three.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.4, transparent: true, opacity: 0.35 })
	);
	playhead.position.set(cellX(0), 0.085, 0);
	playhead.name = 'playhead';
	body.add(playhead);
	body.add(plug(three, 'out', 'out', 0xfb923c, 0.3));
	return body;
}

/** @param {any} three */
function samplerMesh(three) {
	const body = new three.Mesh(
		new three.BoxGeometry(0.5, 0.12, 0.5),
		new three.MeshStandardMaterial({ color: 0x1f2937, roughness: 0.85, metalness: 0.1 })
	);
	body.name = 'Sampler';
	for (let pad = 0; pad < SAMPLER_PADS; pad++) {
		const col = pad % 4;
		const row = Math.floor(pad / 4);
		const button = new three.Mesh(
			new three.BoxGeometry(0.095, 0.03, 0.095),
			new three.MeshStandardMaterial({ color: 0x9ca3af, roughness: 0.6 })
		);
		button.position.set(-0.165 + col * 0.11, 0.075, 0.165 - row * 0.11);
		button.name = 'spad-' + pad;
		button.userData.samplerPad = pad;
		body.add(button);
	}
	body.add(plug(three, 'out', 'out', 0xfb923c, 0.27));
	return body;
}

/** @param {any} three */
function transportMesh(three) {
	const stand = new three.Mesh(
		new three.BoxGeometry(0.42, 0.95, 0.3),
		new three.MeshStandardMaterial({ color: 0x374151, roughness: 0.8, metalness: 0.2 })
	);
	stand.name = 'Transport';
	const display = new three.Mesh(
		new three.PlaneGeometry(0.36, 0.14),
		new three.MeshBasicMaterial({ color: 0x0b1220 })
	);
	display.position.set(0, 0.32, -0.151);
	display.rotation.y = Math.PI; // faces -Z, the front, like the speaker's driver
	display.name = 'tp-display';
	stand.add(display);
	/** @param {string} name @param {number} color @param {number} x @param {number} w */
	const button = (name, color, x, w) => {
		const mesh = new three.Mesh(
			new three.BoxGeometry(w, 0.06, 0.03),
			new three.MeshStandardMaterial({ color, roughness: 0.5 })
		);
		mesh.position.set(x, 0.18, -0.16);
		mesh.name = name;
		mesh.userData.transport = name.slice(3);
		stand.add(mesh);
	};
	button('tp-play', 0x22c55e, -0.12, 0.12);
	button('tp-bpm-', 0x64748b, 0.0, 0.05);
	button('tp-bpm+', 0x64748b, 0.07, 0.05);
	button('tp-tap', 0xf59e0b, 0.155, 0.08);
	return stand;
}

/** the grid's materials per device object - a module-level WeakMap, NEVER userData:
 * userData replicates (toJSON, GLTF extras), and a Map or a material serialized into it
 * arrives on a late joiner as a plain object and breaks the build there
 * @type {WeakMap<any, {off: any, lit: Map<number, any>}>} */
const gridStyles = new WeakMap();
/** meshes mid-flash (local, transient) @type {WeakSet<any>} */
const flashing = new WeakSet();
/** cells currently lit (a WeakSet for the same reason) @type {WeakSet<any>} */
const litCells = new WeakSet();
/** @param {any} api @param {any} node */
function gridStyle(api, node) {
	let style = gridStyles.get(node);
	if (style) return style;
	const three = api.THREE;
	style = { off: new three.MeshStandardMaterial({ color: 0x4b4b52, roughness: 0.7 }), lit: new Map() };
	gridStyles.set(node, style);
	return style;
}
/** paint the grid from the rows: a lit cell shares its pad's colored material, an unlit
 * one the grey; nothing per cell to allocate @param {any} api @param {any} node @param {string[]} rows */
function paintPattern(api, node, rows) {
	if (!node?.traverse || !api?.THREE) return;
	const style = gridStyle(api, node);
	node.traverse((/** @type {any} */ child) => {
		const parsed = stepOf(child);
		if (!parsed) return;
		const digit = stepDigit(rows, parsed.pad, parsed.step);
		if (!digit) {
			child.material = style.off;
			litCells.delete(child);
			return;
		}
		let material = style.lit.get(parsed.pad);
		if (!material) {
			material = new api.THREE.MeshStandardMaterial({ color: DRUM_COLORS[parsed.pad], emissive: DRUM_COLORS[parsed.pad], emissiveIntensity: 0.6, roughness: 0.5 });
			style.lit.set(parsed.pad, material);
		}
		child.material = material;
		litCells.add(child);
	});
}
/** is this step cell lit? (for the face and the flights) @param {any} cell */
function isLit(cell) {
	return litCells.has(cell);
}

/** the step a mesh stands for, from userData or - when a replication path dropped that -
 * from its name @param {any} object @returns {{pad: number, step: number}|null} */
function stepOf(object) {
	if (typeof object?.userData?.drumStep === 'number' && typeof object.userData.drumPad === 'number')
		return { pad: object.userData.drumPad, step: object.userData.drumStep };
	const name = typeof object?.name === 'string' ? object.name : '';
	if (!name.startsWith('step-')) return null;
	const [pad, step] = name.slice(5).split('-').map(Number);
	return Number.isFinite(pad) && Number.isFinite(step) ? { pad, step } : null;
}
/** @param {any} object @param {string} prefix @returns {number|null} */
function padOf(object, prefix) {
	const key = prefix === 'pad-' ? 'drumPad' : 'samplerPad';
	if (typeof object?.userData?.[key] === 'number' && !stepOf(object)) return object.userData[key];
	const name = typeof object?.name === 'string' ? object.name : '';
	if (!name.startsWith(prefix)) return null;
	const n = Number(name.slice(prefix.length));
	return Number.isFinite(n) ? n : null;
}
/** the device object a mesh belongs to (itself or an ancestor carrying a device) @param {any} object */
function deviceRootOf(object) {
	let node = object;
	while (node && !node.userData?.device?.kind) node = node.parent;
	return node ?? null;
}

// ---- the device specs (C2) ---------------------------------------------------------------

/** the per-object state a drum machine or a sampler carries on its handle
 * @param {any} ctx @param {any} node @param {any} params @param {'drums'|'sampler'} kind */
function padHandle(ctx, node, params, kind) {
	const out = ctx.createGain();
	out.gain.value = Number(params.level ?? 0.8);
	return {
		kind,
		ctx,
		node,
		out,
		rows: patternRows(params.pattern),
		pads: padTable(params.pads),
		/** @type {Map<string, any>} */ buffers: new Map(),
		/** @type {Set<string>} */ pending: new Set(),
		/** @type {Map<number, any>} */ panners: new Map(),
		/** @type {Map<number, {stop: (t: number) => void, group: number}>} */ live: new Map(),
		/** @type {{step: number, at: number, wall: number}[]} */ hits: [],
		/** @type {(() => void)|null} */ cancel: null
	};
}

/** 23-D1: what a pad device references by content hash - every pad sample in `pads` - so
 * the Scene manifest (and a .tpscene export) carries the bytes @param {any} params */
function padAssets(params) {
	const table = padTable(params?.pads);
	/** @type {{hash: string, name: string}[]} */
	const refs = [];
	for (const key of Object.keys(table)) {
		const hash = padSetting(table, Number(key), 'sample', '');
		if (hash) refs.push({ hash: String(hash), name: String(padSetting(table, Number(key), 'name', '') || 'pad ' + (Number(key) + 1)) });
	}
	return refs;
}

/** @param {any} api */
function drumsSpec(api) {
	return {
		kind: 'drums',
		label: 'Drum machine',
		icon: '🥁',
		group: 'Music Lab',
		ports: { in: [], out: [{ id: 'out', label: 'Out', kind: 'audio' }] },
		assets: padAssets,
		params: [
			{ key: 'level', label: 'Level', kind: 'range', min: 0, max: 1, step: 0.01, default: 0.8 },
			// `pattern` and `pads` are part of the document too (undeclared: the face edits
			// them, the Inspector does not list them); their defaults are applied in build
		],
		/** @param {any} ctx @param {any} node @param {any} params */
		build(ctx, node, params) {
			const h = padHandle(ctx, node, params, 'drums');
			if (typeof params.pattern !== 'string') h.rows = patternRows(emptyPattern());
			paintPattern(api, node, h.rows);
			prefetchPadSamples(api, h);
			// a 16th, forever, from beat 0: the callback is pure of (beat, at), so every peer
			// fires the same pads at the same audio time from the same transport
			h.cancel = api.audio.schedule(0, (/** @type {any} */ e) => drumStep(api, h, e), { every: 0.25 });
			padDevices.set(node.uuid, h);
			return {
				output: h.out,
				h,
				dispose() {
					h.cancel?.();
					h.cancel = null;
					for (const live of h.live.values()) live.stop(ctx.currentTime);
					h.live.clear();
					h.out.disconnect();
					padDevices.delete(node.uuid);
				}
			};
		},
		/** @param {any} built @param {string} key @param {any} value @param {any} node */
		onParam(built, key, value, node) {
			const h = built.h;
			if (!h) return;
			if (key === 'level') h.out.gain.value = Number(value) || 0;
			else if (key === 'pattern') {
				h.rows = patternRows(value);
				paintPattern(api, node ?? h.node, h.rows);
			} else if (key === 'pads') {
				h.pads = padTable(value);
				prefetchPadSamples(api, h);
			}
		},
		/** a one-shot pad hit, replicated as a note: pad = note - PAD_BASE_NOTE
		 * @param {any} built @param {{note: number, velocity: number, at: number}} ev */
		onNote(built, { note, velocity, at }) {
			const h = built.h;
			const pad = Math.round(Number(note)) - PAD_BASE_NOTE;
			if (!h || pad < 0 || pad >= DRUM_PADS) return;
			hitPad(api, h, pad, typeof velocity === 'number' ? velocity : 0.9, api.audio.timeFor(typeof at === 'number' ? at : Date.now()));
		},
		mesh: (/** @type {any} */ three) => drumsMesh(three)
	};
}

/** @param {any} api */
function samplerSpec(api) {
	return {
		kind: 'sampler',
		label: 'Sampler pads',
		icon: '🎛️',
		group: 'Music Lab',
		ports: { in: [], out: [{ id: 'out', label: 'Out', kind: 'audio' }] },
		assets: padAssets,
		params: [{ key: 'level', label: 'Level', kind: 'range', min: 0, max: 1, step: 0.01, default: 0.8 }],
		/** @param {any} ctx @param {any} node @param {any} params */
		build(ctx, node, params) {
			const h = padHandle(ctx, node, params, 'sampler');
			prefetchPadSamples(api, h);
			padDevices.set(node.uuid, h);
			return {
				output: h.out,
				h,
				dispose() {
					for (const live of h.live.values()) live.stop(ctx.currentTime);
					h.live.clear();
					h.out.disconnect();
					padDevices.delete(node.uuid);
				}
			};
		},
		/** @param {any} built @param {string} key @param {any} value */
		onParam(built, key, value) {
			const h = built.h;
			if (!h) return;
			if (key === 'level') h.out.gain.value = Number(value) || 0;
			else if (key === 'pads') {
				h.pads = padTable(value);
				prefetchPadSamples(api, h);
			}
		},
		/** @param {any} built @param {{note: number, velocity: number, at: number}} ev */
		onNote(built, { note, velocity, at }) {
			const h = built.h;
			const pad = Math.round(Number(note)) - PAD_BASE_NOTE;
			if (!h || pad < 0 || pad >= SAMPLER_PADS) return;
			hitPad(api, h, pad, typeof velocity === 'number' ? velocity : 0.9, api.audio.timeFor(typeof at === 'number' ? at : Date.now()));
		},
		mesh: (/** @type {any} */ three) => samplerMesh(three)
	};
}

/** every built drum machine / sampler, for the playheads and the strokes @type {Map<string, any>} */
const padDevices = new Map();
/** every built transport face @type {Map<string, {node: any, canvas: any, ctx2d: any, texture: any, last: string}>} */
const transports = new Map();

/** @param {any} api */
function transportSpec(api) {
	return {
		kind: 'transport',
		label: 'Transport',
		icon: '⏯️',
		group: 'Music Lab',
		ports: { in: [], out: [] },
		params: [],
		/** no audio of its own: the face of the SHARED clock. The display is a canvas
		 * texture made HERE, on every peer, so it never has to replicate.
		 * @param {any} ctx @param {any} node */
		build(ctx, node) {
			const three = api.THREE;
			const display = node.getObjectByName?.('tp-display');
			/** @type {any} */
			let entry = null;
			if (display && three && typeof document !== 'undefined') {
				const canvas = document.createElement('canvas');
				canvas.width = 256;
				canvas.height = 96;
				const texture = new three.CanvasTexture(canvas);
				display.material = new three.MeshBasicMaterial({ map: texture });
				entry = { node, canvas, ctx2d: canvas.getContext('2d'), texture, last: '' };
				transports.set(node.uuid, entry);
				drawTransport(entry, api.audio.transport());
			}
			return {
				dispose() {
					transports.delete(node.uuid);
					entry?.texture?.dispose?.();
				}
			};
		},
		mesh: (/** @type {any} */ three) => transportMesh(three)
	};
}

/** @param {{canvas: any, ctx2d: any, texture: any, last: string}} entry @param {any} t */
function drawTransport(entry, t) {
	const bar = Math.floor(t.beat / 4) + 1;
	const beat = (Math.floor(t.beat) % 4) + 1;
	const key = t.bpm + '|' + bar + '|' + beat + '|' + (t.playing ? 1 : 0);
	if (key === entry.last || !entry.ctx2d) return;
	entry.last = key;
	const c = entry.ctx2d;
	c.fillStyle = '#0b1220';
	c.fillRect(0, 0, 256, 96);
	c.fillStyle = t.playing ? '#22c55e' : '#94a3b8';
	c.font = 'bold 44px monospace';
	c.textBaseline = 'top';
	c.fillText(String(Math.round(t.bpm)), 12, 8);
	c.font = '18px monospace';
	c.fillStyle = '#cbd5e1';
	c.fillText('BPM', 130, 30);
	c.fillText((t.playing ? 'PLAY ' : 'STOP ') + bar + '.' + beat, 12, 62);
	entry.texture.needsUpdate = true;
}

// ---- interaction (C2) --------------------------------------------------------------------

/** the open paint stroke on a drum grid, if any: local preview, ONE write at the end
 * @type {{uuid: string, digit: string, pattern: string, lastAt: number, cells: any[]}|null} */
let stroke = null;
/** recent tap-tempo presses (local; only the RESULTING bpm is written, replicated) @type {number[]} */
let taps = [];

/** @param {any} api @param {string} uuid @param {string} pattern */
function previewPattern(api, uuid, pattern) {
	const h = padDevices.get(uuid);
	if (!h) return;
	h.rows = patternRows(pattern);
	paintPattern(api, h.node, h.rows);
}

/** commit the open stroke as one setParams write (one undo entry) @param {any} api */
function endStroke(api) {
	const open = stroke;
	stroke = null;
	if (!open) return;
	const doc = api.audio.device(open.uuid);
	if (doc && String(doc.params?.pattern ?? emptyPattern()) === open.pattern) return; // nothing changed
	api.audio.setParams(open.uuid, { pattern: open.pattern });
}

/** a click on a drum machine: a step toggles (and opens a stroke), a pad button plays the
 * pad now (replicated as a note) @param {any} api @param {any} device @param {any} object */
function clickDrums(api, device, object) {
	const step = stepOf(object);
	if (step) {
		const doc = api.audio.device(device.uuid);
		const base = stroke?.uuid === device.uuid ? stroke.pattern : String(doc?.params?.pattern ?? emptyPattern());
		const rows = patternRows(base);
		const digit = stepDigit(rows, step.pad, step.step) ? '0' : STEP_ON;
		const next = withStepDigit(rows, step.pad, step.step, digit);
		if (stroke && stroke.uuid !== device.uuid) endStroke(api);
		stroke = { uuid: device.uuid, digit, pattern: next, lastAt: performance.now(), cells: gridCells(device) };
		previewPattern(api, device.uuid, next);
		api.haptic(0.3, 30);
		return true;
	}
	const pad = padOf(object, 'pad-');
	if (pad !== null) {
		api.audio.note(device.uuid, { note: PAD_BASE_NOTE + pad, velocity: 0.9 });
		api.haptic(0.5, 40);
		return true;
	}
	return false;
}

/** @param {any} device */
function gridCells(device) {
	/** @type {any[]} */
	const cells = [];
	device.traverse?.((/** @type {any} */ child) => {
		if (stepOf(child)) cells.push(child);
	});
	return cells;
}

/** the stroke follows the pointer ray across the grid (desktop drag, VR sweep): each new
 * cell it crosses takes the stroke's digit; idle for STROKE_IDLE_MS ends it @param {any} api */
function updateStroke(api) {
	if (!stroke) return;
	const now = performance.now();
	const ray = api.pointerRay?.();
	if (ray && stroke.cells.length) {
		const hits = ray.intersectObjects(stroke.cells, false);
		const cell = hits[0]?.object;
		const parsed = cell ? stepOf(cell) : null;
		if (parsed) {
			const rows = patternRows(stroke.pattern);
			if (String(stepDigit(rows, parsed.pad, parsed.step)) !== stroke.digit) {
				stroke.pattern = withStepDigit(rows, parsed.pad, parsed.step, stroke.digit);
				stroke.lastAt = now;
				previewPattern(api, stroke.uuid, stroke.pattern);
			}
		}
	}
	if (now - stroke.lastAt > STROKE_IDLE_MS) endStroke(api);
}

/** @param {any} api @param {any} device @param {any} object */
function clickSampler(api, device, object) {
	const pad = padOf(object, 'spad-');
	if (pad === null) return false;
	api.audio.note(device.uuid, { note: PAD_BASE_NOTE + pad, velocity: 0.9 });
	api.haptic(0.5, 40);
	return true;
}

/** @param {any} api @param {any} device @param {any} object */
function clickTransport(api, device, object) {
	const which = typeof object?.userData?.transport === 'string' ? object.userData.transport : String(object?.name ?? '').startsWith('tp-') ? String(object.name).slice(3) : '';
	if (!which || which === 'display') return false;
	const t = api.audio.transport();
	if (which === 'play') api.audio.play(!t.playing);
	else if (which === 'bpm-') api.audio.setBpm(Math.max(40, Math.round(t.bpm) - 5));
	else if (which === 'bpm+') api.audio.setBpm(Math.min(240, Math.round(t.bpm) + 5));
	else if (which === 'tap') {
		const now = performance.now();
		taps = taps.filter((at) => now - at < 2500);
		taps.push(now);
		if (taps.length >= 3) {
			let sum = 0;
			for (let i = 1; i < taps.length; i++) sum += taps[i] - taps[i - 1];
			const bpm = Math.round(60000 / (sum / (taps.length - 1)));
			if (bpm >= 40 && bpm <= 240) api.audio.setBpm(bpm);
		}
	} else return false;
	api.haptic(0.4, 40);
	return true;
}

/** the beat lab's per-frame work: transport faces (throttled), playheads, the open stroke
 * @param {any} api @param {number} time */
let nextDisplay = 0;
/** @param {any} api @param {number} time */
function beatLabFrame(api, time) {
	updateStroke(api);
	if (time < nextDisplay) return;
	nextDisplay = time + 1 / DISPLAY_HZ;
	const t = api.audio.transport();
	for (const entry of transports.values()) drawTransport(entry, t);
	const step = (((Math.floor(t.beat * 4) % STEPS) + STEPS) % STEPS);
	for (const h of padDevices.values()) {
		if (h.kind !== 'drums') continue;
		const playhead = h.node?.getObjectByName?.('playhead');
		if (playhead) {
			playhead.position.x = cellX(step);
			playhead.visible = !!t.playing;
		}
	}
}

/** an Explorer AUDIO item dropped on a pad becomes that pad's sample - one setParams write
 * @param {any} api @param {any} hit @param {{kind: string, hash: string, name: string}} item */
function dropSample(api, hit, item) {
	if (item.kind !== 'audio' || !item.hash) return false;
	const device = deviceRootOf(hit);
	if (!device) return false;
	const kind = device.userData.device.kind;
	let pad = null;
	if (kind === KINDS.sampler) pad = padOf(hit, 'spad-');
	else if (kind === KINDS.drums) pad = padOf(hit, 'pad-');
	else return false;
	const doc = api.audio.device(device.uuid);
	const table = padTable(doc?.params?.pads);
	if (pad === null) {
		// dropped on the body: the first EMPTY pad
		const count = kind === KINDS.sampler ? SAMPLER_PADS : DRUM_PADS;
		for (let i = 0; i < count && pad === null; i++) if (!padSetting(table, i, 'sample', '')) pad = i;
		if (pad === null) pad = 0;
	}
	table[pad] = { ...(table[pad] ?? {}), sample: item.hash, name: item.name };
	api.audio.setParams(device.uuid, { pads: JSON.stringify(table) });
	api.toast('Music Lab: "' + item.name + '" on pad ' + (pad + 1));
	return true;
}

/** @param {any} api */
function registerBeatLab(api) {
	api.registerAudioDevice(transportSpec(api)).then((/** @type {string} */ kind) => (KINDS.transport = kind));
	api.registerAudioDevice(drumsSpec(api)).then((/** @type {string} */ kind) => (KINDS.drums = kind));
	api.registerAudioDevice(samplerSpec(api)).then((/** @type {string} */ kind) => (KINDS.sampler = kind));

	// PLAY pieces (a step, a pad, the transport's buttons): Interact and Play. In Edit a
	// click selects the device, so it can be moved like any other object.
	api.registerClickHandler(
		(/** @type {any} */ object) => {
			const device = deviceRootOf(object);
			const kind = device?.userData?.device?.kind;
			if (!kind) return false;
			if (kind === KINDS.drums) return clickDrums(api, device, object);
			if (kind === KINDS.sampler) return clickSampler(api, device, object);
			if (kind === KINDS.transport) return clickTransport(api, device, object);
			return false;
		},
		{ modes: ['interact', 'play'] }
	);
	api.registerDropHandler?.((/** @type {any} */ hit, /** @type {any} */ item) => dropSample(api, hit, item));
	api.registerFrameTask((/** @type {number} */ time) => beatLabFrame(api, time));

	api.registerMenu('Music Lab: beat lab', () => {
		const transport = api.audio.addDevice('transport', { position: [-1.6, 0.5, -2] });
		const drums = api.audio.addDevice('drums', { position: [0, 0.8, -2] });
		const sampler = api.audio.addDevice('sampler', { position: [1.2, 0.8, -2] });
		const speaker = api.audio.addDevice('speaker', { position: [0, 0, -3.2] });
		if (!transport || !drums || !sampler || !speaker) return api.toast('Music Lab: could not add the devices');
		api.audio.cable({ from: { uuid: drums.uuid, port: 'out' }, to: { uuid: speaker.uuid, port: 'in' } });
		api.audio.cable({ from: { uuid: sampler.uuid, port: 'out' }, to: { uuid: speaker.uuid, port: 'in' } });
		api.audio.setParams(drums.uuid, { pattern: '7000700070007000/0000700000007000/7070707070707070/0000000000000070/0000700000007000/0000000000000000/0000000000000000/0000000000000000' });
		api.toast('Music Lab: press Play on the transport, paint the grid');
	});

	api.onSceneClear(() => {
		padDevices.clear();
		transports.clear();
		stroke = null;
	});
}

export default {
	id: 'music-lab',
	name: 'Music Lab',
	version: '0.2.1',
	description: 'A Piano, a Speaker, a Transport, a Drum machine and Sampler pads on the engine. Cable them, paint a beat, press Play.',
	/** @param {any} api */
	register(api) {
		// `mesh(three)` is handed the app's own three by the registry, which is the only
		// place this module needs it — but the rule stands: never `import` it.
		void api.THREE;

		api.registerAudioDevice(speakerSpec(api));
		api.registerAudioDevice(pianoSpec(api)).then((/** @type {string} */ kind) => (PIANO_KIND = kind));
		registerBeatLab(api); // 23-C2: transport, drum machine, sampler pads

		// ONE task for every speaker, throttled — the panners only have to keep up with a
		// person carrying a cabinet, and `time` is the synced clock in seconds
		let nextFollow = 0;
		api.registerFrameTask((/** @type {number} */ time) => {
			if (time < nextFollow) return;
			nextFollow = time + 1 / FOLLOW_HZ;
			for (const entry of speakers.values()) aim(entry.node, entry.panner);
		});

		// Desktop click AND VR trigger, one path — the handler gets the exact mesh that was
		// hit, so the key carries the note and the walk up to the device carries the uuid.
		// The note goes through api.audio.note, which replicates it: no api.send here.
		// A key is a PLAY piece — Interact and Play; an Edit click selects the piano.
		api.registerClickHandler(
			(/** @type {any} */ object) => {
				const midi = noteOf(object);
				if (midi === null) return false;
				let node = object;
				while (node && node.userData?.device?.kind !== PIANO_KIND) node = node.parent;
				if (!node || !PIANO_KIND) return false;
				api.audio.note(node.uuid, { note: midi, velocity: 0.9 });
				api.haptic(0.6, 60);
				return true;
			},
			{ modes: ['interact', 'play'] }
		);

		api.registerMenu('Music Lab: piano + speaker', () => {
			const piano = api.audio.addDevice('piano', { position: [-1, 0, -2] });
			const speaker = api.audio.addDevice('speaker', { position: [1, 0, -2] });
			if (!piano || !speaker) return api.toast('Music Lab: could not add the devices');
			api.audio.cable({ from: { uuid: piano.uuid, port: 'out' }, to: { uuid: speaker.uuid, port: 'in' } });
			api.toast('Music Lab: click a key');
		});

		api.onSceneClear(() => speakers.clear());
	}
};
