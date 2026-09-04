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

export default {
	id: 'music-lab',
	name: 'Music Lab',
	version: '0.1.0',
	description: 'Two audio devices on the engine: a Piano you play and a Speaker that puts it in the room. Cable one into the other.',
	/** @param {any} api */
	register(api) {
		// `mesh(three)` is handed the app's own three by the registry, which is the only
		// place this module needs it — but the rule stands: never `import` it.
		void api.THREE;

		api.registerAudioDevice(speakerSpec(api));
		api.registerAudioDevice(pianoSpec(api)).then((/** @type {string} */ kind) => (PIANO_KIND = kind));

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
		api.registerClickHandler((/** @type {any} */ object) => {
			const midi = noteOf(object);
			if (midi === null) return false;
			let node = object;
			while (node && node.userData?.device?.kind !== PIANO_KIND) node = node.parent;
			if (!node || !PIANO_KIND) return false;
			api.audio.note(node.uuid, { note: midi, velocity: 0.9 });
			api.haptic(0.6, 60);
			return true;
		});

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
