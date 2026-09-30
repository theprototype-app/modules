// Music FX — roadmap #23 C3: a mixer and five pedals on the audio engine.
//
// SIX `registerAudioDevice` SPECS AND NOTHING ELSE. Core owns the object, the
// replication, the undo, the saving, the cables and the clock; this file owns what a
// kind sounds like, what it looks like, and which of its params do what. Nothing here
// keeps replicated state of its own and nothing here sends a message. The one thing a
// pedal does that the Music Lab devices do not is READ the shared transport: a synced
// delay's time is `f(params, bpm)`, and bpm is the replicated transport document, so
// every peer computes the same number from the same inputs.
//
// THE RULE THAT MAKES THAT WORK: `build` and `onParam` are PURE FUNCTIONS OF THEIR
// ARGUMENTS. Every peer runs them from the same document; anything read out of local
// state desyncs silently, per peer, with no error anywhere.
//
// A KNOB IS A PARAM WRITE, NEVER A REBUILD (A1's finding 4, the volume that restarted
// its source). Every `onParam` here adjusts the running graph through an AudioParam
// glide (`setTargetAtTime`, ~15 ms); the nodes a cable is plugged into are the SAME
// nodes after the write as before. A pedal whose params rebuilt its graph would cut
// the delay's echoes and the reverb's tail on every touch, and a mixer whose faders
// rebuilt its strips would drop the cables for a frame. The flight measures both.
//
// SOUND GOES NOWHERE UNTIL IT IS CABLED. A pedal's `output` and the mixer's `out` and
// `send` connect to nothing; the only thing here that reaches a bus is whatever you
// cable them into (a Music Lab speaker, say).
//
// EVERY PEDAL: one `in`, one `out`, a dry/wet `mix`. in -> dry -> out and
// in -> [effect] -> wet -> out, so `mix` 0 is a bypass and `mix` 1 is fully wet.

const SMOOTH = 0.015; // s: the time constant every fader and knob glides with
const SYNC_HZ = 4; // how often the delays re-read the shared bpm
const IMPULSE_DEBOUNCE_MS = 120; // a reverb knob regenerates its impulse this long after the last write
const MAX_DELAY_S = 2;
const MIXER_CHANNELS = 4;
const PLUG_COLOR = 0xfb923c; // the app's audio-port colour (flowSockets / audioPatch)

/** Beat fractions a synced delay may take. 'free' reads the `ms` knob instead. */
const DIVISIONS = /** @type {Record<string, number>} */ ({ '1/4': 1, '1/8': 1 / 2, '1/8T': 1 / 3, '1/16': 1 / 4 });

/**
 * Every built delay, so ONE throttled frame task follows the shared bpm for all of
 * them. Keyed by the object uuid; `dispose` removes the entry.
 * @type {Map<string, any>}
 */
const delays = new Map();

// ---- small helpers -----------------------------------------------------------------

/** @param {any} value @param {number} fallback */
function num(value, fallback) {
	const n = Number(value);
	return Number.isFinite(n) ? n : fallback;
}

/** @param {number} value @param {number} lo @param {number} hi */
function clamp(value, lo, hi) {
	return Math.max(lo, Math.min(hi, value));
}

/** A toggle arrives as a boolean from the Inspector, and may arrive as a string or a
 * number from an older document. @param {any} value */
function on(value) {
	return value === true || value === 1 || value === 'true' || value === '1';
}

/**
 * Move an AudioParam WITHOUT a step: an exponential approach with a short time
 * constant, which is what keeps a fader move from clicking. Never `.value =` on a
 * param that is audible while it moves.
 * @param {any} param @param {number} value @param {any} ctx @param {number} [tau]
 */
function glide(param, value, ctx, tau = SMOOTH) {
	param.setTargetAtTime(value, ctx.currentTime, tau);
}

/** @param {any} nodes */
function disconnectAll(nodes) {
	for (const node of nodes) {
		try {
			node.disconnect();
		} catch {
			/* already gone */
		}
	}
}

/**
 * The shape every pedal shares: `input -> dry -> output`, `wet -> output`, and the
 * effect goes between `input` and `wet`. `mix` sets the dry/wet balance.
 * @param {any} ctx @param {any} params
 */
function pedalGraph(ctx, params) {
	const input = ctx.createGain();
	const output = ctx.createGain();
	const dry = ctx.createGain();
	const wet = ctx.createGain();
	const mix = on(params.bypass) ? 0 : clamp(num(params.mix, 0.5), 0, 1);
	dry.gain.value = 1 - mix;
	wet.gain.value = mix;
	input.connect(dry);
	dry.connect(output);
	wet.connect(output);
	return {
		input,
		output,
		dry,
		wet,
		ctx,
		params: { ...params },
		/** @type {any[]} the effect's own nodes, disconnected on dispose */
		nodes: [],
		disposed: false,
		dispose() {
			this.disposed = true;
			disconnectAll([input, dry, wet, output, ...this.nodes]);
		}
	};
}

/** A BYPASSED pedal (its footswitch, 30b) is fully dry whatever `mix` says — the knob keeps
 * its value, so stomping it back on returns the sound you had.
 * @param {any} handle @param {any} value */
function setMix(handle, value) {
	const mix = on(handle.params.bypass) ? 0 : clamp(num(value, 0.5), 0, 1);
	glide(handle.dry.gain, 1 - mix, handle.ctx);
	glide(handle.wet.gain, mix, handle.ctx);
}

// ---- meshes --------------------------------------------------------------------------
//
// A cable attaches to the child named for the port: `vrpatch-in:<id>` / `vrpatch-out:<id>`
// is what the VR patching work and the cable renderer look for, and each plug holds a
// zero-offset `port:<id>` marker for the older name. THE DEVICE ROOT IS A MESH, NOT A
// GROUP (music-lab's finding): the late-joiner object sync sends a Group as a bare
// message, and a device whose root is a Group reached a joiner with its document gone
// on the build C1 ran against. A Mesh with children goes as toJSON(), userData intact.

/**
 * @param {any} three @param {'in'|'out'} side @param {string} id @param {number[]} at
 * @param {'x'|'z'} axis which way the jack points
 */
function plug(three, side, id, at, axis) {
	const mesh = new three.Mesh(
		new three.CylinderGeometry(0.014, 0.014, 0.03, 12),
		new three.MeshStandardMaterial({ color: PLUG_COLOR, roughness: 0.4, metalness: 0.6 })
	);
	if (axis === 'x') mesh.rotation.z = Math.PI / 2;
	else mesh.rotation.x = Math.PI / 2;
	mesh.position.set(at[0], at[1], at[2]);
	mesh.name = 'vrpatch-' + side + ':' + id;
	const marker = new three.Object3D();
	marker.name = 'port:' + id;
	mesh.add(marker);
	return mesh;
}

/** @param {any} three @param {number} color @param {number} roughness @param {number} metalness */
function material(three, color, roughness = 0.6, metalness = 0.2) {
	return new three.MeshStandardMaterial({ color, roughness, metalness });
}

/**
 * A stomp box: a dark body, a coloured top plate (the one thing that tells the five
 * apart across a room), a footswitch, an LED, a row of knobs, and the in jack on the
 * right / out jack on the left the way a real pedal has them.
 * @param {any} three @param {string} label @param {number} color @param {number} knobs
 */
function pedalMesh(three, label, color, knobs) {
	const body = new three.Mesh(new three.BoxGeometry(0.16, 0.06, 0.24), material(three, 0x26262b, 0.7, 0.3));
	body.name = label;
	const top = new three.Mesh(new three.BoxGeometry(0.15, 0.006, 0.23), material(three, color, 0.5, 0.2));
	top.position.y = 0.033;
	top.name = 'top';
	body.add(top);
	const stomp = new three.Mesh(new three.CylinderGeometry(0.018, 0.02, 0.012, 16), material(three, 0xc8c8cc, 0.35, 0.8));
	stomp.position.set(0, 0.042, 0.075);
	stomp.name = 'footswitch';
	body.add(stomp);
	const led = new three.Mesh(
		new three.SphereGeometry(0.006, 8, 6),
		new three.MeshStandardMaterial({ color: 0xff3b30, emissive: 0xff3b30, emissiveIntensity: 0.8 })
	);
	led.position.set(0, 0.04, 0.03);
	led.name = 'led';
	body.add(led);
	const knobMaterial = material(three, 0x111114, 0.5, 0.1);
	for (let k = 0; k < knobs; k++) {
		const knob = new three.Mesh(new three.CylinderGeometry(0.012, 0.012, 0.012, 16), knobMaterial);
		knob.position.set((k - (knobs - 1) / 2) * 0.045, 0.042, -0.06);
		knob.name = 'knob-' + k;
		body.add(knob);
	}
	body.add(plug(three, 'in', 'in', [0.09, 0, -0.03], 'x'));
	body.add(plug(three, 'out', 'out', [-0.09, 0, -0.03], 'x'));
	return body;
}

/** A small desk: four strips with a fader slot and a pan knob, the inputs along the
 * back, out and send on the right side. @param {any} three */
function mixerMesh(three) {
	const desk = new three.Mesh(new three.BoxGeometry(0.6, 0.05, 0.32), material(three, 0x2f3340, 0.75, 0.25));
	desk.name = 'Mixer';
	const slotMaterial = material(three, 0x0c0d10, 0.9, 0);
	const capMaterial = material(three, 0xe5e7eb, 0.4, 0.3);
	const knobMaterial = material(three, 0x111114, 0.5, 0.1);
	for (let i = 0; i < MIXER_CHANNELS; i++) {
		const x = -0.21 + i * 0.14;
		const slot = new three.Mesh(new three.BoxGeometry(0.01, 0.002, 0.16), slotMaterial);
		slot.position.set(x, 0.026, 0.04);
		slot.name = 'slot-' + (i + 1);
		desk.add(slot);
		const cap = new three.Mesh(new three.BoxGeometry(0.03, 0.012, 0.02), capMaterial);
		cap.position.set(x, 0.031, 0.06);
		cap.name = 'fader-' + (i + 1);
		desk.add(cap);
		const knob = new three.Mesh(new three.CylinderGeometry(0.012, 0.012, 0.012, 16), knobMaterial);
		knob.position.set(x, 0.031, -0.09);
		knob.name = 'pan-' + (i + 1);
		desk.add(knob);
		// 30b: a mute BUTTON per strip at the front edge (its own material: it lights red)
		const mute = new three.Mesh(new three.BoxGeometry(0.03, 0.014, 0.022), material(three, MUTE_OFF, 0.5, 0.2));
		mute.position.set(x, 0.032, 0.135);
		mute.name = 'mute-' + (i + 1);
		desk.add(mute);
		desk.add(plug(three, 'in', 'in' + (i + 1), [x, 0, -0.17], 'z'));
	}
	desk.add(plug(three, 'out', 'out', [0.31, 0, -0.06], 'x'));
	desk.add(plug(three, 'out', 'send', [0.31, 0, 0.06], 'x'));
	return desk;
}

// ---- the footswitch and the mute buttons (30b) -------------------------------------------
//
// THE SWEEP HAD NOTHING TO FLIP. A Quest player asked to "hold the trigger and toggle the
// mixer" found the footswitch was decorative and a channel's mute an Inspector param only —
// core's hold-and-sweep fires a device's CLICK, and nothing here answered one. Now a pedal's
// footswitch toggles a `bypass` param and each mixer strip has a mute BUTTON; both go through
// `api.audio.setParams`, so a stomp replicates, saves and undoes like any knob, and the look
// (the LED, the lit button) follows the DOCUMENT on every peer, never local state.

/** Every pedal gets `bypass` + a click on its footswitch. @param {any} spec */
function withFootswitch(spec) {
	const onParam = spec.onParam;
	return {
		...spec,
		params: [...spec.params, { key: 'bypass', label: 'Bypass (footswitch)', kind: 'toggle', default: false }],
		/** @param {any} h @param {string} key @param {any} value */
		onParam(h, key, value) {
			if (key !== 'bypass') return onParam(h, key, value);
			h.params.bypass = value;
			setMix(h, h.params.mix);
		}
	};
}

const MUTE_ON = 0xef4444;
const MUTE_OFF = 0x4b5563;

/**
 * What a click on a music-fx device part does: a pedal's footswitch (or its LED) stomps
 * bypass, a mixer strip's mute button flips that channel's mute. Returns whether it handled
 * the click. @param {any} api @param {any} object
 */
function clickFx(api, object) {
	let device = object;
	while (device && !device.userData?.device?.kind) device = device.parent;
	const kind = String(device?.userData?.device?.kind ?? '');
	if (!kind.startsWith('mod-music-fx-')) return false;
	const doc = api.audio.device(device.uuid);
	const params = doc?.params ?? {};
	/** @type {Record<string, any> | null} */
	let patch = null;
	const mute = /^mute-(\d)$/.exec(object?.name ?? '');
	if (kind === 'mod-music-fx-mixer' && mute) patch = { ['mute' + mute[1]]: !on(params['mute' + mute[1]]) };
	else if (kind !== 'mod-music-fx-mixer' && (object?.name === 'footswitch' || object?.name === 'led')) patch = { bypass: !on(params.bypass) };
	if (!patch) return false;
	api.audio.setParams(device.uuid, patch);
	syncLook(api, device, { ...params, ...patch });
	if (api.hapticPattern) api.hapticPattern('tap');
	else api.haptic?.(0.35, 30);
	api.playSound?.('click');
	return true;
}

/** The LED and the mute buttons show the document. @param {any} api @param {any} device @param {any} params */
function syncLook(api, device, params) {
	for (const child of device.children ?? []) {
		const mute = /^mute-(\d)$/.exec(child.name ?? '');
		if (mute && child.material?.color) child.material.color.setHex(on(params['mute' + mute[1]]) ? MUTE_ON : MUTE_OFF);
		if (child.name === 'led' && child.material) child.material.emissiveIntensity = on(params.bypass) ? 0.05 : 0.8;
	}
}

// ---- the mixer -------------------------------------------------------------------------

/**
 * A channel's fader level from the document: muted is silent, and when ANY channel is
 * soloed every un-soloed one is silent. A pure function of the params, which is what
 * lets every peer's mixer agree. @param {any} params @param {number} channel 1-based
 */
function channelLevel(params, channel) {
	if (on(params['mute' + channel])) return 0;
	let anySolo = false;
	for (let i = 1; i <= MIXER_CHANNELS; i++) if (on(params['solo' + i])) anySolo = true;
	if (anySolo && !on(params['solo' + channel])) return 0;
	return clamp(num(params['gain' + channel], 1), 0, 2);
}

/** @param {any} handle */
function refreshLevels(handle) {
	handle.channels.forEach((/** @type {any} */ strip, /** @type {number} */ index) =>
		glide(strip.fader.gain, channelLevel(handle.params, index + 1), handle.ctx)
	);
}

function mixerSpec() {
	/** @type {any[]} */
	const params = [{ key: 'master', label: 'Master', kind: 'range', min: 0, max: 1.5, step: 0.01, default: 1 }];
	const inPorts = [];
	for (let i = 1; i <= MIXER_CHANNELS; i++) {
		inPorts.push({ id: 'in' + i, label: 'In ' + i, kind: 'audio' });
		params.push(
			{ key: 'gain' + i, label: 'Ch ' + i + ' gain', kind: 'range', min: 0, max: 1.5, step: 0.01, default: 1 },
			{ key: 'pan' + i, label: 'Ch ' + i + ' pan', kind: 'range', min: -1, max: 1, step: 0.01, default: 0 },
			{ key: 'mute' + i, label: 'Ch ' + i + ' mute', kind: 'toggle', default: false },
			{ key: 'solo' + i, label: 'Ch ' + i + ' solo', kind: 'toggle', default: false },
			{ key: 'send' + i, label: 'Ch ' + i + ' send', kind: 'range', min: 0, max: 1, step: 0.01, default: 0 }
		);
	}
	return {
		kind: 'mixer',
		label: 'Mixer',
		icon: '🎚️',
		group: 'Music FX',
		ports: {
			in: inPorts,
			out: [
				{ id: 'out', label: 'Out', kind: 'audio' },
				{ id: 'send', label: 'Send', kind: 'audio' }
			]
		},
		params,
		/**
		 * Per channel: in -> pan -> fader -> out, and fader -> send level -> send (a
		 * post-fader send, so a muted channel leaves the reverb bus too). `inputs` and
		 * `outputs` are the maps core's patch looks a multi-port device's ports up in;
		 * `input`/`output` stand for the first input and the main out (the level meter
		 * reads `output`).
		 * @param {any} ctx @param {any} node @param {any} doc
		 */
		build(ctx, node, doc) {
			const out = ctx.createGain();
			out.gain.value = clamp(num(doc.master, 1), 0, 2);
			const send = ctx.createGain();
			/** @type {Record<string, any>} */
			const inputs = {};
			/** @type {any[]} */
			const channels = [];
			for (let i = 1; i <= MIXER_CHANNELS; i++) {
				const input = ctx.createGain();
				const pan = ctx.createStereoPanner();
				pan.pan.value = clamp(num(doc['pan' + i], 0), -1, 1);
				const fader = ctx.createGain();
				fader.gain.value = channelLevel(doc, i);
				const sendGain = ctx.createGain();
				sendGain.gain.value = clamp(num(doc['send' + i], 0), 0, 1);
				input.connect(pan);
				pan.connect(fader);
				fader.connect(out);
				fader.connect(sendGain);
				sendGain.connect(send);
				inputs['in' + i] = input;
				channels.push({ input, pan, fader, sendGain });
			}
			return {
				inputs,
				outputs: { out, send },
				input: inputs.in1,
				output: out,
				channels,
				ctx,
				params: { ...doc },
				dispose() {
					for (const strip of channels) disconnectAll([strip.input, strip.pan, strip.fader, strip.sendGain]);
					disconnectAll([out, send]);
				}
			};
		},
		/** every fader is a glide on a running node — the strips are never rebuilt */
		onParam(handle, key, value) {
			handle.params[key] = value;
			if (key === 'master') return glide(handle.output.gain, clamp(num(value, 1), 0, 2), handle.ctx);
			const match = /^(gain|pan|mute|solo|send)(\d)$/.exec(key);
			if (!match) return;
			const strip = handle.channels[Number(match[2]) - 1];
			if (!strip) return;
			if (match[1] === 'pan') glide(strip.pan.pan, clamp(num(value, 0), -1, 1), handle.ctx);
			else if (match[1] === 'send') glide(strip.sendGain.gain, clamp(num(value, 0), 0, 1), handle.ctx);
			else refreshLevels(handle); // gain, mute and solo all fold into every channel's level
		},
		/** @param {any} three */
		mesh: (three) => mixerMesh(three)
	};
}

// ---- the pedals -------------------------------------------------------------------------

/** @param {any} value */
function filterType(value) {
	return value === 'highpass' || value === 'bandpass' || value === 'notch' ? value : 'lowpass';
}

function filterSpec() {
	return {
		kind: 'filter',
		label: 'Filter',
		icon: '🎛️',
		group: 'Music FX',
		ports: { in: [{ id: 'in', label: 'In', kind: 'audio' }], out: [{ id: 'out', label: 'Out', kind: 'audio' }] },
		params: [
			{
				key: 'type',
				label: 'Type',
				kind: 'select',
				default: 'lowpass',
				options: [
					{ value: 'lowpass', label: 'Low-pass' },
					{ value: 'highpass', label: 'High-pass' },
					{ value: 'bandpass', label: 'Band-pass' },
					{ value: 'notch', label: 'Notch' }
				]
			},
			{ key: 'cutoff', label: 'Cutoff', kind: 'range', min: 40, max: 16000, step: 1, default: 8000, unit: 'Hz' },
			{ key: 'q', label: 'Q', kind: 'range', min: 0.1, max: 20, step: 0.1, default: 1 },
			{ key: 'mix', label: 'Mix', kind: 'range', min: 0, max: 1, step: 0.01, default: 1 }
		],
		/** in -> biquad -> wet. @param {any} ctx @param {any} node @param {any} params */
		build(ctx, node, params) {
			const h = pedalGraph(ctx, params);
			const biquad = ctx.createBiquadFilter();
			biquad.type = filterType(params.type);
			biquad.frequency.value = clamp(num(params.cutoff, 8000), 20, 20000);
			biquad.Q.value = clamp(num(params.q, 1), 0.01, 40);
			h.input.connect(biquad);
			biquad.connect(h.wet);
			h.nodes.push(biquad);
			return Object.assign(h, { biquad });
		},
		onParam(h, key, value) {
			h.params[key] = value;
			if (key === 'type') h.biquad.type = filterType(value);
			else if (key === 'cutoff') glide(h.biquad.frequency, clamp(num(value, 8000), 20, 20000), h.ctx);
			else if (key === 'q') glide(h.biquad.Q, clamp(num(value, 1), 0.01, 40), h.ctx);
			else if (key === 'mix') setMix(h, value);
		},
		/** @param {any} three */
		mesh: (three) => pedalMesh(three, 'Filter', 0xf59e0b, 3)
	};
}

/** A soft clipper, once: tanh over [-1, 1], normalised so a signal that never reaches
 * the knee passes at unit gain. The DRIVE is the pre-gain in front of it, so a hotter
 * signal folds harder into the same curve. */
function softClipCurve() {
	const n = 2048;
	const curve = new Float32Array(n);
	const k = 2;
	const scale = 1 / Math.tanh(k);
	for (let i = 0; i < n; i++) curve[i] = Math.tanh(k * ((i * 2) / (n - 1) - 1)) * scale;
	return curve;
}

function distortionSpec() {
	return {
		kind: 'distortion',
		label: 'Distortion',
		icon: '🔥',
		group: 'Music FX',
		ports: { in: [{ id: 'in', label: 'In', kind: 'audio' }], out: [{ id: 'out', label: 'Out', kind: 'audio' }] },
		params: [
			{ key: 'drive', label: 'Drive', kind: 'range', min: 1, max: 50, step: 0.5, default: 10 },
			{ key: 'tone', label: 'Tone', kind: 'range', min: 500, max: 16000, step: 10, default: 8000, unit: 'Hz' },
			{ key: 'mix', label: 'Mix', kind: 'range', min: 0, max: 1, step: 0.01, default: 0.8 }
		],
		/** in -> drive -> shaper -> tone (low-pass) -> trim -> wet. @param {any} ctx @param {any} node @param {any} params */
		build(ctx, node, params) {
			const h = pedalGraph(ctx, params);
			const drive = ctx.createGain();
			drive.gain.value = clamp(num(params.drive, 10), 1, 100);
			const shaper = ctx.createWaveShaper();
			shaper.curve = softClipCurve();
			shaper.oversample = '4x';
			const tone = ctx.createBiquadFilter();
			tone.type = 'lowpass';
			tone.frequency.value = clamp(num(params.tone, 8000), 100, 20000);
			// a saturated signal sits near full scale whatever came in; bring the wet side
			// back to about where the dry side is
			const trim = ctx.createGain();
			trim.gain.value = 0.4;
			h.input.connect(drive);
			drive.connect(shaper);
			shaper.connect(tone);
			tone.connect(trim);
			trim.connect(h.wet);
			h.nodes.push(drive, shaper, tone, trim);
			return Object.assign(h, { drive, shaper, tone });
		},
		onParam(h, key, value) {
			h.params[key] = value;
			if (key === 'drive') glide(h.drive.gain, clamp(num(value, 10), 1, 100), h.ctx);
			else if (key === 'tone') glide(h.tone.frequency, clamp(num(value, 8000), 100, 20000), h.ctx);
			else if (key === 'mix') setMix(h, value);
		},
		/** @param {any} three */
		mesh: (three) => pedalMesh(three, 'Distortion', 0xef4444, 3)
	};
}

/**
 * The delay time a document asks for at a tempo. A synced division is a fraction of
 * the beat at the SHARED bpm; 'free' is the `ms` knob. Pure of its two arguments.
 * @param {any} params @param {number} bpm
 */
function delaySeconds(params, bpm) {
	const division = DIVISIONS[String(params.time)];
	const seconds = division ? (60 / clamp(num(bpm, 120), 20, 300)) * division : num(params.ms, 350) / 1000;
	return clamp(seconds, 0.001, MAX_DELAY_S);
}

/** Re-aim one delay at a tempo; a no-op when nothing changed. A delay-time change is a
 * glide too — a step in delayTime is a splice in the echo. @param {any} h @param {number} bpm */
function applyDelayTime(h, bpm) {
	const seconds = delaySeconds(h.params, bpm);
	if (seconds === h.seconds) return;
	h.seconds = seconds;
	h.bpm = bpm;
	glide(h.delay.delayTime, seconds, h.ctx, 0.02);
}

/** @param {any} api */
function delaySpec(api) {
	return {
		kind: 'delay',
		label: 'Delay',
		icon: '🔁',
		group: 'Music FX',
		ports: { in: [{ id: 'in', label: 'In', kind: 'audio' }], out: [{ id: 'out', label: 'Out', kind: 'audio' }] },
		params: [
			{
				key: 'time',
				label: 'Time',
				kind: 'select',
				default: '1/8',
				options: [
					{ value: '1/4', label: '1/4 (sync)' },
					{ value: '1/8', label: '1/8 (sync)' },
					{ value: '1/8T', label: '1/8 triplet (sync)' },
					{ value: '1/16', label: '1/16 (sync)' },
					{ value: 'free', label: 'Free (ms)' }
				]
			},
			{ key: 'ms', label: 'Free time', kind: 'range', min: 10, max: 2000, step: 1, default: 350, unit: 'ms' },
			{ key: 'feedback', label: 'Feedback', kind: 'range', min: 0, max: 0.95, step: 0.01, default: 0.35 },
			{ key: 'mix', label: 'Mix', kind: 'range', min: 0, max: 1, step: 0.01, default: 0.4 }
		],
		/**
		 * in -> delay -> wet, with delay -> feedback -> delay as the loop. The delay time
		 * is set from the transport the moment it is built, so a peer who builds this
		 * after a tempo change lands on the same time as everyone else.
		 * @param {any} ctx @param {any} node @param {any} params
		 */
		build(ctx, node, params) {
			const h = pedalGraph(ctx, params);
			const delay = ctx.createDelay(MAX_DELAY_S);
			const feedback = ctx.createGain();
			feedback.gain.value = clamp(num(params.feedback, 0.35), 0, 0.95);
			h.input.connect(delay);
			delay.connect(feedback);
			feedback.connect(delay);
			delay.connect(h.wet);
			h.nodes.push(delay, feedback);
			const bpm = api.audio.transport().bpm;
			const seconds = delaySeconds(params, bpm);
			delay.delayTime.value = seconds;
			const handle = Object.assign(h, { delay, feedback, seconds, bpm, uuid: node.uuid });
			const dispose = h.dispose;
			handle.dispose = function () {
				delays.delete(node.uuid);
				dispose.call(this);
			};
			delays.set(node.uuid, handle);
			return handle;
		},
		onParam(h, key, value) {
			h.params[key] = value;
			if (key === 'feedback') glide(h.feedback.gain, clamp(num(value, 0.35), 0, 0.95), h.ctx);
			else if (key === 'mix') setMix(h, value);
			else if (key === 'time' || key === 'ms') applyDelayTime(h, api.audio.transport().bpm);
		},
		/** @param {any} three */
		mesh: (three) => pedalMesh(three, 'Delay', 0x2dd4bf, 3)
	};
}

/**
 * A GENERATED impulse: a stereo noise burst that decays as (1 - t/size)^decay. A few
 * lines, sounds like a room, and keeps the zip a single file. The noise comes from a
 * SEEDED generator, so the impulse is a pure function of (size, decay): every peer
 * builds the same room from the same document, and a device rebuilt after an undo
 * sounds like the one it replaced. (Math.random here would give each peer a room
 * whose response at any one frequency is a different random draw — the flight
 * measured a 4x spread in the tail of one sine between builds.)
 * @param {any} ctx @param {any} size seconds @param {any} decay exponent
 */
function impulse(ctx, size, decay) {
	const seconds = clamp(num(size, 1.5), 0.1, 6);
	const exponent = clamp(num(decay, 3), 0.5, 10);
	const length = Math.max(1, Math.floor(ctx.sampleRate * seconds));
	const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
	// xorshift32 off the two knobs; never a zero state
	let state = ((Math.round(seconds * 1000) * 7919 + Math.round(exponent * 1000) * 104729) | 0) || 0x9e3779b9;
	const noise = () => {
		state ^= state << 13;
		state ^= state >>> 17;
		state ^= state << 5;
		return ((state >>> 0) / 4294967296) * 2 - 1;
	};
	for (let channel = 0; channel < 2; channel++) {
		const data = buffer.getChannelData(channel);
		for (let i = 0; i < length; i++) data[i] = noise() * Math.pow(1 - i / length, exponent);
	}
	return buffer;
}

function reverbSpec() {
	return {
		kind: 'reverb',
		label: 'Reverb',
		icon: '🏛️',
		group: 'Music FX',
		ports: { in: [{ id: 'in', label: 'In', kind: 'audio' }], out: [{ id: 'out', label: 'Out', kind: 'audio' }] },
		params: [
			{ key: 'size', label: 'Size', kind: 'range', min: 0.1, max: 6, step: 0.1, default: 1.5, unit: 's' },
			{ key: 'decay', label: 'Decay', kind: 'range', min: 0.5, max: 10, step: 0.1, default: 3 },
			{ key: 'mix', label: 'Mix', kind: 'range', min: 0, max: 1, step: 0.01, default: 0.35 }
		],
		/** in -> convolver -> wet. @param {any} ctx @param {any} node @param {any} params */
		build(ctx, node, params) {
			const h = pedalGraph(ctx, params);
			const convolver = ctx.createConvolver();
			convolver.normalize = true;
			convolver.buffer = impulse(ctx, params.size, params.decay);
			h.input.connect(convolver);
			convolver.connect(h.wet);
			h.nodes.push(convolver);
			const handle = Object.assign(h, { convolver, timer: null });
			const dispose = h.dispose;
			handle.dispose = function () {
				clearTimeout(this.timer);
				dispose.call(this);
			};
			return handle;
		},
		/** size and decay regenerate the impulse, DEBOUNCED — a knob drag writes many
		 * times a second and a 6 s buffer is not free */
		onParam(h, key, value) {
			h.params[key] = value;
			if (key === 'mix') return setMix(h, value);
			if (key !== 'size' && key !== 'decay') return;
			clearTimeout(h.timer);
			h.timer = setTimeout(() => {
				if (h.disposed) return;
				h.convolver.buffer = impulse(h.ctx, h.params.size, h.params.decay);
			}, IMPULSE_DEBOUNCE_MS);
		},
		/** @param {any} three */
		mesh: (three) => pedalMesh(three, 'Reverb', 0x8b5cf6, 3)
	};
}

// ---- the bitcrusher --------------------------------------------------------------------
//
// An AudioWorklet, loaded from a BLOB URL built from the string below, so the module
// stays one file: `URL.createObjectURL(new Blob([src]))` + `audioWorklet.addModule(url)`,
// once per AudioContext. If the worklet cannot load (no `audioWorklet`, a CSP that
// refuses blob workers), the same algorithm runs in a ScriptProcessorNode on the main
// thread and the handle says so in `mode`.

const CRUSHER_NAME = 'music-fx-bitcrush';

/** The processor: quantise to `bits` and hold each value for `rate` samples. Both
 * are k-rate AudioParams, so a knob is a `.value` write on the node. */
const CRUSHER_SOURCE =
	'class MusicFxBitcrush extends AudioWorkletProcessor {\n' +
	'  static get parameterDescriptors() {\n' +
	"    return [{ name: 'bits', defaultValue: 6, minValue: 1, maxValue: 16, automationRate: 'k-rate' },\n" +
	"            { name: 'rate', defaultValue: 6, minValue: 1, maxValue: 64, automationRate: 'k-rate' }];\n" +
	'  }\n' +
	'  constructor() { super(); this.phase = 0; this.held = [0, 0]; }\n' +
	'  process(inputs, outputs, parameters) {\n' +
	'    const input = inputs[0]; const output = outputs[0];\n' +
	'    if (!input || !input.length || !output || !output.length) return true;\n' +
	'    const step = Math.pow(2, Math.max(1, parameters.bits[0]) - 1);\n' +
	'    const rate = Math.max(1, parameters.rate[0]);\n' +
	'    let phase = this.phase;\n' +
	'    for (let channel = 0; channel < output.length; channel++) {\n' +
	'      const from = input[channel] || input[0]; const to = output[channel];\n' +
	'      let held = this.held[channel] || 0; phase = this.phase;\n' +
	'      for (let i = 0; i < to.length; i++) {\n' +
	'        phase += 1;\n' +
	'        if (phase >= rate) { phase -= rate; held = Math.round(from[i] * step) / step; }\n' +
	'        to[i] = held;\n' +
	'      }\n' +
	'      this.held[channel] = held;\n' +
	'    }\n' +
	'    this.phase = phase;\n' +
	'    return true;\n' +
	'  }\n' +
	'}\n' +
	"registerProcessor('" + CRUSHER_NAME + "', MusicFxBitcrush);\n";

/** One load per context: resolves true when the worklet is usable, false to fall back.
 * @type {WeakMap<any, Promise<boolean>>} */
const crusherLoads = new WeakMap();

/** @param {any} ctx */
function crusherReady(ctx) {
	let job = crusherLoads.get(ctx);
	if (!job) {
		job = (async () => {
			if (!ctx.audioWorklet || typeof Blob === 'undefined' || typeof URL === 'undefined' || typeof AudioWorkletNode === 'undefined') return false;
			const url = URL.createObjectURL(new Blob([CRUSHER_SOURCE], { type: 'application/javascript' }));
			try {
				await ctx.audioWorklet.addModule(url);
				return true;
			} catch (error) {
				console.warn('[music-fx] the bitcrush worklet did not load; using a ScriptProcessorNode', error);
				return false;
			} finally {
				URL.revokeObjectURL(url);
			}
		})();
		crusherLoads.set(ctx, job);
	}
	return job;
}

/** @param {any} h */
function attachWorklet(h) {
	const crusher = new AudioWorkletNode(h.ctx, CRUSHER_NAME, {
		numberOfInputs: 1,
		numberOfOutputs: 1,
		outputChannelCount: [2],
		parameterData: { bits: clamp(num(h.params.bits, 6), 1, 16), rate: clamp(num(h.params.rate, 6), 1, 64) }
	});
	h.input.connect(crusher);
	crusher.connect(h.wet);
	h.nodes.push(crusher);
	h.crusher = crusher;
	h.mode = 'worklet';
}

/** The same algorithm on the main thread, reading the params off the handle. @param {any} h */
function attachScriptProcessor(h) {
	const processor = h.ctx.createScriptProcessor(1024, 2, 2);
	let phase = 0;
	const held = [0, 0];
	processor.onaudioprocess = (/** @type {any} */ event) => {
		const step = Math.pow(2, clamp(num(h.params.bits, 6), 1, 16) - 1);
		const rate = clamp(num(h.params.rate, 6), 1, 64);
		const start = phase;
		for (let channel = 0; channel < event.outputBuffer.numberOfChannels; channel++) {
			const from = event.inputBuffer.getChannelData(Math.min(channel, event.inputBuffer.numberOfChannels - 1));
			const to = event.outputBuffer.getChannelData(channel);
			let value = held[channel] || 0;
			phase = start;
			for (let i = 0; i < to.length; i++) {
				phase += 1;
				if (phase >= rate) {
					phase -= rate;
					value = Math.round(from[i] * step) / step;
				}
				to[i] = value;
			}
			held[channel] = value;
		}
	};
	h.input.connect(processor);
	processor.connect(h.wet);
	h.nodes.push(processor);
	h.crusher = processor;
	h.mode = 'script';
}

function bitcrushSpec() {
	return {
		kind: 'bitcrush',
		label: 'Bitcrush',
		icon: '👾',
		group: 'Music FX',
		ports: { in: [{ id: 'in', label: 'In', kind: 'audio' }], out: [{ id: 'out', label: 'Out', kind: 'audio' }] },
		params: [
			{ key: 'bits', label: 'Bits', kind: 'range', min: 1, max: 16, step: 1, default: 6 },
			{ key: 'rate', label: 'Rate divisor', kind: 'range', min: 1, max: 64, step: 1, default: 6 },
			{ key: 'mix', label: 'Mix', kind: 'range', min: 0, max: 1, step: 0.01, default: 0.8 }
		],
		/**
		 * in -> crusher -> wet. The worklet module loads asynchronously the first time a
		 * crusher is built on a context; until it lands the dry path is all there is,
		 * and `mode` reads 'loading'. @param {any} ctx @param {any} node @param {any} params
		 */
		build(ctx, node, params) {
			const h = Object.assign(pedalGraph(ctx, params), { crusher: null, mode: 'loading' });
			crusherReady(ctx).then((ok) => {
				if (h.disposed) return;
				try {
					if (ok) attachWorklet(h);
					else attachScriptProcessor(h);
				} catch (error) {
					console.warn('[music-fx] bitcrush could not attach its worklet; using a ScriptProcessorNode', error);
					if (h.mode !== 'script') attachScriptProcessor(h);
				}
			});
			return h;
		},
		onParam(h, key, value) {
			h.params[key] = value;
			if (key === 'mix') return setMix(h, value);
			if (h.mode !== 'worklet' || !h.crusher) return; // the script path reads h.params live
			if (key === 'bits') h.crusher.parameters.get('bits').value = clamp(num(value, 6), 1, 16);
			else if (key === 'rate') h.crusher.parameters.get('rate').value = clamp(num(value, 6), 1, 64);
		},
		/** @param {any} three */
		mesh: (three) => pedalMesh(three, 'Bitcrush', 0x84cc16, 3)
	};
}

// ---- the demo chain ------------------------------------------------------------------

/** Device objects in the scene by kind, for the demo chain to plug into whatever Music
 * Lab gear is already in the room. @param {any} api @param {string[]} kinds */
function devicesByKind(api, kinds) {
	/** @type {Record<string, any>} */
	const found = {};
	api.objectsGroup()?.traverse?.((/** @type {any} */ node) => {
		const kind = node?.userData?.device?.kind;
		if (typeof kind === 'string' && kinds.includes(kind) && !found[kind]) found[kind] = node;
	});
	return found;
}

// ---- the module -----------------------------------------------------------------------

export default {
	id: 'music-fx',
	name: 'Music FX',
	version: '0.2.0',
	description: 'A four-channel mixer and five pedals (delay, reverb, filter, distortion, bitcrush) as audio devices. Cable them in any order.',
	/** @param {any} api */
	register(api) {
		// `mesh(three)` is handed the app's own three by the registry — never `import` it
		void api.THREE;

		api.registerAudioDevice(mixerSpec());
		api.registerAudioDevice(withFootswitch(filterSpec()));
		api.registerAudioDevice(withFootswitch(distortionSpec()));
		api.registerAudioDevice(withFootswitch(delaySpec(api)));
		api.registerAudioDevice(withFootswitch(reverbSpec()));
		api.registerAudioDevice(withFootswitch(bitcrushSpec()));

		// 30b: the footswitch and the mute buttons answer a click — and so a VR sweep
		api.registerClickHandler((/** @type {any} */ object) => clickFx(api, object), { modes: ['interact', 'play'] });
		// the lit parts follow the DOCUMENT (a peer's stomp, an undo, a late join)
		let nextLook = 0;
		api.registerFrameTask(() => {
			const now = performance.now();
			if (now < nextLook) return;
			nextLook = now + 250;
			api.objectsGroup()?.traverse?.((/** @type {any} */ node) => {
				const kind = node?.userData?.device?.kind;
				if (typeof kind === 'string' && kind.startsWith('mod-music-fx-')) syncLook(api, node, api.audio.device(node.uuid)?.params ?? {});
			});
		});

		// ONE task for every synced delay: re-read the shared bpm a few times a second
		// and re-aim whichever delays it moved. The bpm is the replicated transport, so
		// every peer's delays land on the same time from the same number.
		let nextSync = 0;
		api.registerFrameTask(() => {
			const now = performance.now();
			if (now < nextSync || delays.size === 0) return;
			nextSync = now + 1000 / SYNC_HZ;
			const bpm = api.audio.transport().bpm;
			for (const h of delays.values()) if (DIVISIONS[String(h.params.time)] && h.bpm !== bpm) applyDelayTime(h, bpm);
		});

		api.registerMenu('Music FX: demo chain', () => {
			const order = ['filter', 'distortion', 'bitcrush', 'delay', 'reverb'];
			const pedals = order.map((kind, index) => api.audio.addDevice(kind, { position: [-1.6 + index * 0.5, 0.9, -2] }));
			const mixer = api.audio.addDevice('mixer', { position: [1.2, 0.9, -2] });
			if (pedals.some((pedal) => !pedal) || !mixer) return api.toast('Music FX: could not add the devices');
			for (let i = 0; i + 1 < pedals.length; i++)
				api.audio.cable({ from: { uuid: pedals[i].uuid, port: 'out' }, to: { uuid: pedals[i + 1].uuid, port: 'in' } });
			api.audio.cable({ from: { uuid: pedals[pedals.length - 1].uuid, port: 'out' }, to: { uuid: mixer.uuid, port: 'in1' } });
			// Music Lab gear already in the room joins the chain; otherwise say what to plug
			const lab = devicesByKind(api, ['mod-music-lab-piano', 'mod-music-lab-speaker']);
			const piano = lab['mod-music-lab-piano'];
			const speaker = lab['mod-music-lab-speaker'];
			if (piano) api.audio.cable({ from: { uuid: piano.uuid, port: 'out' }, to: { uuid: pedals[0].uuid, port: 'in' } });
			if (speaker) api.audio.cable({ from: { uuid: mixer.uuid, port: 'out' }, to: { uuid: speaker.uuid, port: 'in' } });
			if (piano && speaker) api.toast('Music FX: the piano runs through five pedals into the mixer and out of the speaker');
			else api.toast('Music FX: cable an instrument into the Filter and the mixer Out into a speaker');
		});

		api.onSceneClear(() => delays.clear());
	}
};
