// Music DJ - roadmap #23 C4: two decks and a crossfader on the engine.
//
// THE DECK'S POSITION IS THREE NUMBERS IN THE DEVICE DOCUMENT: `{startedAt, offset, rate}`
// (the sceneMusic shape widened with a rate). Every peer DERIVES the playhead from them and
// its own clock - the playhead is never streamed. A scrub on the platter is a live gesture
// over that shared clock: throttled PREVIEWS (api.audio.previewParams: replicated, applied,
// no history) while the hand moves, then ONE exact commit (api.audio.setParams) when it
// stops - one undo entry per scrub, the pattern every mesh tool in the app uses.
//
// Varispeed, one control: `rate` is pitch AND tempo. The face re-bases `{offset, startedAt}`
// whenever it writes a rate, so the position stays continuous on every peer; a bare `rate`
// write from the Inspector keeps THIS peer's playback continuous but re-derives the document
// position, which is the documented v1 limit (time-stretching is a project, not a phase).
//
// Sound goes nowhere until cabled: a deck's output connects to nothing; the crossfader is a
// device too (two inputs, one output, a curve) because that is what a DJ reaches for.

const TURN_SECONDS = 2; // one platter revolution scrubs this much audio
const GESTURE_IDLE_MS = 700;
const PREVIEW_MS = 66;
const PITCH_MIN = 0.5;
const PITCH_MAX = 1.5;
const PITCH_RAIL = 0.11; // the pitch knob travels -PITCH_RAIL..+PITCH_RAIL along x
const XF_RAIL = 0.17;
const DISPLAY_HZ = 20;

/** the resolved namespaced kinds */
const KINDS = { deck: '', crossfader: '' };

/** every built deck @type {Map<string, any>} */
const decks = new Map();
/** every built crossfader @type {Map<string, any>} */
const faders = new Map();

// ---- the deck model (pure) ----------------------------------------------------------------

/** the playhead in seconds from the document and a wall time - what every peer derives
 * @param {any} doc @param {number} nowMs @param {number} [duration] */
function positionOf(doc, nowMs, duration) {
	const rate = Number(doc?.rate) || 1;
	const offset = Number(doc?.offset) || 0;
	const startedAt = Number(doc?.startedAt) || 0;
	let pos = doc?.playing && startedAt ? offset + (Math.max(0, nowMs - startedAt) / 1000) * rate : offset;
	if (duration && duration > 0) pos = doc?.loop === false ? Math.min(duration, pos) : ((pos % duration) + duration) % duration;
	return Math.max(0, pos);
}

// ---- meshes -------------------------------------------------------------------------------

/** the plug convention music-lab uses: the visible plug carries the vrpatch name and holds a
 * zero-offset `port:<id>` marker @param {any} three @param {'in'|'out'} side @param {string} id @param {number} color @param {number} x @param {number} z */
function plug(three, side, id, color, x, z) {
	const mesh = new three.Mesh(
		new three.CylinderGeometry(0.02, 0.02, 0.04, 12),
		new three.MeshStandardMaterial({ color, roughness: 0.4, metalness: 0.6 })
	);
	mesh.rotation.x = Math.PI / 2;
	mesh.position.set(x, 0, z);
	mesh.name = 'vrpatch-' + side + ':' + id;
	const marker = new three.Object3D();
	marker.name = 'port:' + id;
	mesh.add(marker);
	return mesh;
}

/** @param {any} three */
function deckMesh(three) {
	const body = new three.Mesh(
		new three.BoxGeometry(0.62, 0.12, 0.5),
		new three.MeshStandardMaterial({ color: 0x1f2328, roughness: 0.85, metalness: 0.15 })
	);
	body.name = 'Deck';
	const platter = new three.Mesh(
		new three.CylinderGeometry(0.16, 0.16, 0.02, 48),
		new three.MeshStandardMaterial({ color: 0x374151, roughness: 0.5, metalness: 0.4 })
	);
	platter.position.set(-0.1, 0.07, 0.02);
	platter.name = 'jog';
	// a mark on the platter so the rotation reads
	const mark = new three.Mesh(
		new three.BoxGeometry(0.02, 0.006, 0.1),
		new three.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.6 })
	);
	mark.position.set(0, 0.012, -0.1);
	mark.name = 'jog-mark';
	platter.add(mark);
	body.add(platter);
	/** @param {string} name @param {number} color @param {number} x @param {number} z @param {number} w */
	const button = (name, color, x, z, w) => {
		const mesh = new three.Mesh(new three.BoxGeometry(w, 0.03, 0.05), new three.MeshStandardMaterial({ color, roughness: 0.5 }));
		mesh.position.set(x, 0.075, z);
		mesh.name = name;
		body.add(mesh);
	};
	button('dk-play', 0x22c55e, -0.18, 0.2, 0.1);
	button('dk-cue', 0xf59e0b, -0.04, 0.2, 0.08);
	const rail = new three.Mesh(
		new three.BoxGeometry(PITCH_RAIL * 2 + 0.04, 0.01, 0.03),
		new three.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.9 })
	);
	rail.position.set(0.16, 0.065, -0.12);
	rail.name = 'dk-rail';
	body.add(rail);
	const knob = new three.Mesh(new three.BoxGeometry(0.03, 0.035, 0.05), new three.MeshStandardMaterial({ color: 0xe5e7eb, roughness: 0.5 }));
	knob.position.set(0.16, 0.08, -0.12);
	knob.name = 'dk-pitch';
	body.add(knob);
	body.add(plug(three, 'out', 'out', 0xfb923c, 0.2, 0.27));
	return body;
}

/** @param {any} three */
function crossfaderMesh(three) {
	const body = new three.Mesh(
		new three.BoxGeometry(0.5, 0.1, 0.18),
		new three.MeshStandardMaterial({ color: 0x27272a, roughness: 0.85, metalness: 0.15 })
	);
	body.name = 'Crossfader';
	const rail = new three.Mesh(new three.BoxGeometry(XF_RAIL * 2 + 0.04, 0.01, 0.03), new three.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.9 }));
	rail.position.set(0, 0.055, 0);
	rail.name = 'xf-rail';
	body.add(rail);
	const knob = new three.Mesh(new three.BoxGeometry(0.035, 0.035, 0.06), new three.MeshStandardMaterial({ color: 0xe5e7eb, roughness: 0.5 }));
	knob.position.set(0, 0.07, 0);
	knob.name = 'xf-knob';
	body.add(knob);
	body.add(plug(three, 'in', 'a', 0x38bdf8, -0.15, 0.11));
	body.add(plug(three, 'in', 'b', 0xf472b6, 0.15, 0.11));
	body.add(plug(three, 'out', 'out', 0xfb923c, 0, -0.11));
	return body;
}

/** the device object a mesh belongs to @param {any} object */
function deviceRootOf(object) {
	let node = object;
	while (node && !node.userData?.device?.kind) node = node.parent;
	return node ?? null;
}

// ---- the deck runtime -------------------------------------------------------------------------

/** load the deck's track by content hash; every peer pulls and decodes its own copy
 * @param {any} api @param {any} h */
function loadTrack(api, h) {
	const hash = String(h.doc.track || '');
	h.buffer = null;
	stopSource(h);
	if (!hash) return;
	const wanted = hash;
	Promise.resolve(api.audio.sample(hash))
		.then((/** @type {any} */ buffer) => {
			if (!buffer || h.doc.track !== wanted) return;
			h.buffer = buffer;
			syncDeck(api, h);
		})
		.catch(() => {});
}

/** @param {any} h */
function stopSource(h) {
	const src = h.src;
	h.src = null;
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

/**
 * Make the audible playback match the document: derive the playhead from the three numbers
 * and (re)start a BufferSource there. A future `startedAt` starts at its exact audio time
 * (api.audio.timeFor), a past one at the derived position now - the same answer on every
 * peer, whenever the message arrives. @param {any} api @param {any} h
 */
function syncDeck(api, h) {
	stopSource(h);
	const doc = h.doc;
	const buffer = h.buffer;
	if (!buffer || !doc.playing) return;
	const ctx = h.ctx;
	const now = Date.now();
	const rate = Math.max(PITCH_MIN, Math.min(PITCH_MAX, Number(doc.rate) || 1));
	const loop = doc.loop !== false;
	const src = ctx.createBufferSource();
	src.buffer = buffer;
	src.loop = loop;
	src.playbackRate.value = rate;
	src.connect(h.out);
	const startedAt = Number(doc.startedAt) || now;
	if (startedAt > now + 5) {
		const offset = ((Number(doc.offset) || 0) % buffer.duration + buffer.duration) % buffer.duration;
		src.start(api.audio.timeFor(startedAt), offset);
	} else {
		const pos = positionOf(doc, now, buffer.duration);
		if (!loop && pos >= buffer.duration - 0.005) return;
		src.start(ctx.currentTime, pos);
	}
	h.src = src;
	src.onended = () => {
		if (h.src === src) h.src = null;
	};
}

/** the deck's playhead NOW, for the face and the flights @param {any} h */
function deckPosition(h) {
	return positionOf(h.doc, Date.now(), h.buffer?.duration);
}

/** @param {any} api */
function deckSpec(api) {
	return {
		kind: 'deck',
		label: 'Deck',
		icon: '💿',
		group: 'Music DJ',
		ports: { in: [], out: [{ id: 'out', label: 'Out', kind: 'audio' }] },
		/** 23-D1: the deck's track is a scene asset by content hash @param {any} p */
		assets: (p) => (p?.track ? [{ hash: String(p.track), name: String(p.name || 'track') }] : []),
		params: [
			{ key: 'level', label: 'Level', kind: 'range', min: 0, max: 1, step: 0.01, default: 0.9 },
			{ key: 'rate', label: 'Pitch', kind: 'range', min: PITCH_MIN, max: PITCH_MAX, step: 0.005, default: 1 },
			{ key: 'loop', label: 'Loop', kind: 'toggle', default: true }
			// undeclared, part of the document: track (hash), name, playing, startedAt, offset, cue
		],
		/** @param {any} ctx @param {any} node @param {any} params */
		build(ctx, node, params) {
			const out = ctx.createGain();
			out.gain.value = Number(params.level ?? 0.9);
			const h = { ctx, node, out, doc: { ...params }, buffer: null, src: null, position: () => deckPosition(h) };
			decks.set(node.uuid, h);
			loadTrack(api, h);
			return {
				output: out,
				h,
				dispose() {
					stopSource(h);
					out.disconnect();
					decks.delete(node.uuid);
				}
			};
		},
		/** @param {any} built @param {string} key @param {any} value */
		onParam(built, key, value) {
			const h = built.h;
			if (!h) return;
			h.doc[key] = value;
			if (key === 'level') h.out.gain.setTargetAtTime(Number(value) || 0, h.ctx.currentTime, 0.01);
			else if (key === 'track') loadTrack(api, h);
			else if (key === 'rate' && h.src) h.src.playbackRate.setTargetAtTime(Math.max(PITCH_MIN, Math.min(PITCH_MAX, Number(value) || 1)), h.ctx.currentTime, 0.01);
			else if (key === 'playing' || key === 'startedAt' || key === 'offset' || key === 'loop') syncDeck(api, h);
		},
		mesh: (/** @type {any} */ three) => deckMesh(three)
	};
}

// ---- the crossfader -----------------------------------------------------------------------------

/** the two gains for a position and a curve - a pure function, the same on every peer
 * @param {number} p -1..1 @param {string} curve */
function faderGains(p, curve) {
	const x = Math.max(-1, Math.min(1, Number(p) || 0));
	if (curve === 'power') {
		const a = ((x + 1) / 2) * (Math.PI / 2);
		return { a: Math.cos(a), b: Math.sin(a) };
	}
	if (curve === 'sharp') {
		// full until the last fifth of the travel, then a fast cut - the scratch curve
		return { a: Math.max(0, Math.min(1, (1 - x) / 0.4)), b: Math.max(0, Math.min(1, (1 + x) / 0.4)) };
	}
	return { a: (1 - x) / 2, b: (1 + x) / 2 };
}

/** @param {any} api */
function crossfaderSpec(api) {
	return {
		kind: 'crossfader',
		label: 'Crossfader',
		icon: '🎚️',
		group: 'Music DJ',
		ports: { in: [{ id: 'a', label: 'A', kind: 'audio' }, { id: 'b', label: 'B', kind: 'audio' }], out: [{ id: 'out', label: 'Out', kind: 'audio' }] },
		params: [
			{ key: 'position', label: 'Position', kind: 'range', min: -1, max: 1, step: 0.01, default: 0 },
			{ key: 'curve', label: 'Curve', kind: 'select', default: 'power', options: [{ value: 'linear', label: 'Linear' }, { value: 'power', label: 'Constant power' }, { value: 'sharp', label: 'Sharp' }] }
		],
		/** @param {any} ctx @param {any} node @param {any} params */
		build(ctx, node, params) {
			const a = ctx.createGain();
			const b = ctx.createGain();
			const out = ctx.createGain();
			a.connect(out);
			b.connect(out);
			const h = { ctx, node, a, b, out, doc: { ...params } };
			const g = faderGains(params.position, params.curve);
			a.gain.value = g.a;
			b.gain.value = g.b;
			faders.set(node.uuid, h);
			return {
				inputs: { a, b },
				outputs: { out },
				input: a,
				output: out,
				h,
				dispose() {
					a.disconnect();
					b.disconnect();
					out.disconnect();
					faders.delete(node.uuid);
				}
			};
		},
		/** a glide, never a jump - a fader move must not click @param {any} built @param {string} key @param {any} value */
		onParam(built, key, value) {
			const h = built.h;
			if (!h) return;
			h.doc[key] = value;
			const g = faderGains(h.doc.position, h.doc.curve);
			h.a.gain.setTargetAtTime(g.a, h.ctx.currentTime, 0.008);
			h.b.gain.setTargetAtTime(g.b, h.ctx.currentTime, 0.008);
		},
		mesh: (/** @type {any} */ three) => crossfaderMesh(three)
	};
}

// ---- gestures ------------------------------------------------------------------------------------

/** the open live gesture: jog scrub, pitch fader or crossfader. Previews while it runs, ONE
 * commit when it ends. @type {{kind: 'jog'|'pitch'|'xf', uuid: string, target: any, before: any, lastAt: number, lastSent: number, pending: any, angle?: number, offset?: number}|null} */
let gesture = null;

/** @param {any} api */
function endGesture(api) {
	const open = gesture;
	gesture = null;
	if (!open || !open.pending) return;
	// the previews already wrote these values: the commit carries the document captured when
	// the gesture STARTED, so the one history entry restores that on undo
	api.audio.setParams(open.uuid, open.pending, { before: open.before });
}

/** @param {any} api @param {any} open @param {any} params */
function previewGesture(api, open, params) {
	open.pending = { ...(open.pending ?? {}), ...params };
	open.lastAt = performance.now();
	if (open.lastAt - open.lastSent < PREVIEW_MS) return;
	open.lastSent = open.lastAt;
	api.audio.previewParams(open.uuid, params);
}

/** the angle of a world point around the platter's axis, read in the DECK's frame: the
 * platter itself turns with the playhead every frame, so its own frame would report motion
 * under a hand that is perfectly still @param {any} platter @param {any} point */
function platterAngle(platter, point) {
	const deck = platter.parent ?? platter;
	const local = deck.worldToLocal(point.clone());
	return Math.atan2(local.x - platter.position.x, -(local.z - platter.position.z));
}

/** @param {any} api */
function updateGesture(api) {
	const open = gesture;
	if (!open) return;
	const now = performance.now();
	const ray = api.pointerRay?.();
	if (ray && open.target) {
		if (open.kind === 'jog') {
			const hits = ray.intersectObject(open.target, true);
			if (hits[0]) {
				const angle = platterAngle(open.target, hits[0].point);
				let delta = angle - (open.angle ?? angle);
				if (delta > Math.PI) delta -= 2 * Math.PI;
				if (delta < -Math.PI) delta += 2 * Math.PI;
				open.angle = angle;
				if (Math.abs(delta) > 0.002) {
					const h = decks.get(open.uuid);
					const duration = h?.buffer?.duration || 0;
					let offset = (open.offset ?? 0) + (delta / (2 * Math.PI)) * TURN_SECONDS;
					if (duration > 0) offset = ((offset % duration) + duration) % duration;
					open.offset = offset;
					previewGesture(api, open, { offset, startedAt: Date.now() });
				}
			}
		} else {
			// sliders: the hit on the device's top face, read along x in the device's frame
			const device = deviceRootOf(open.target);
			const hits = device ? ray.intersectObject(device, true) : [];
			if (hits[0] && device) {
				const local = device.worldToLocal(hits[0].point.clone());
				if (open.kind === 'pitch') {
					const t = Math.max(-1, Math.min(1, (local.x - 0.16) / PITCH_RAIL));
					const rate = Math.round(((t + 1) / 2) * (PITCH_MAX - PITCH_MIN) * 200) / 200 + PITCH_MIN;
					const h = decks.get(open.uuid);
					if (h && Math.abs(rate - (Number(h.doc.rate) || 1)) >= 0.005) {
						// re-base so the position stays continuous on EVERY peer
						const offset = deckPosition(h);
						previewGesture(api, open, h.doc.playing ? { rate, offset, startedAt: Date.now() } : { rate });
					}
				} else if (open.kind === 'xf') {
					const position = Math.round(Math.max(-1, Math.min(1, local.x / XF_RAIL)) * 100) / 100;
					const h = faders.get(open.uuid);
					if (h && position !== Number(h.doc.position)) previewGesture(api, open, { position });
				}
			}
		}
	}
	if (now - open.lastAt > GESTURE_IDLE_MS) endGesture(api);
}

/** @param {any} api @param {any} device @param {any} object */
function clickDeck(api, device, object) {
	const name = String(object?.name ?? '');
	const h = decks.get(device.uuid);
	const doc = api.audio.device(device.uuid)?.params ?? h?.doc ?? {};
	if (name === 'dk-play') {
		if (gesture) endGesture(api);
		if (doc.playing) api.audio.setParams(device.uuid, { playing: false, offset: h ? deckPosition(h) : Number(doc.offset) || 0, startedAt: 0 });
		else api.audio.setParams(device.uuid, { playing: true, startedAt: Date.now(), offset: Number(doc.offset) || 0 });
		api.haptic(0.5, 40);
		return true;
	}
	if (name === 'dk-cue') {
		if (gesture) endGesture(api);
		// playing: jump to the cue point; stopped: set the cue point here
		if (doc.playing) api.audio.setParams(device.uuid, { offset: Number(doc.cue) || 0, startedAt: Date.now() });
		else api.audio.setParams(device.uuid, { cue: Number(doc.offset) || 0 });
		api.haptic(0.4, 30);
		return true;
	}
	if (name === 'jog' || name === 'jog-mark') {
		const platter = name === 'jog' ? object : object.parent;
		if (gesture && gesture.uuid !== device.uuid) endGesture(api);
		gesture = { kind: 'jog', uuid: device.uuid, target: platter, before: api.audio.device(device.uuid), lastAt: performance.now(), lastSent: 0, pending: null, angle: undefined, offset: h ? deckPosition(h) : Number(doc.offset) || 0 };
		api.haptic(0.3, 30);
		return true;
	}
	if (name === 'dk-pitch' || name === 'dk-rail') {
		if (gesture && gesture.uuid !== device.uuid) endGesture(api);
		gesture = { kind: 'pitch', uuid: device.uuid, target: object, before: api.audio.device(device.uuid), lastAt: performance.now(), lastSent: 0, pending: null };
		return true;
	}
	return false;
}

/** @param {any} api @param {any} device @param {any} object */
function clickCrossfader(api, device, object) {
	const name = String(object?.name ?? '');
	if (name !== 'xf-knob' && name !== 'xf-rail') return false;
	if (gesture && gesture.uuid !== device.uuid) endGesture(api);
	gesture = { kind: 'xf', uuid: device.uuid, target: object, before: api.audio.device(device.uuid), lastAt: performance.now(), lastSent: 0, pending: null };
	return true;
}

/** an Explorer audio item dropped on a deck loads it (by content hash), stopped at 0
 * @param {any} api @param {any} hit @param {{kind: string, hash: string, name: string}} item */
function dropTrack(api, hit, item) {
	if (item.kind !== 'audio' || !item.hash) return false;
	const device = deviceRootOf(hit);
	if (!device || device.userData.device.kind !== KINDS.deck) return false;
	api.audio.setParams(device.uuid, { track: item.hash, name: item.name, playing: false, offset: 0, startedAt: 0, cue: 0 });
	api.toast('Music DJ: "' + item.name + '" on the deck');
	return true;
}

let nextDisplay = 0;
/** platters turn with the derived playhead, knobs sit where the document says
 * @param {any} api @param {number} time */
function djFrame(api, time) {
	updateGesture(api);
	if (time < nextDisplay) return;
	nextDisplay = time + 1 / DISPLAY_HZ;
	for (const h of decks.values()) {
		const platter = h.node?.getObjectByName?.('jog');
		const scrubbing = gesture?.kind === 'jog' && gesture.uuid === h.node?.uuid;
		if (platter && !scrubbing) platter.rotation.y = -((deckPosition(h) % TURN_SECONDS) / TURN_SECONDS) * 2 * Math.PI;
		const knob = h.node?.getObjectByName?.('dk-pitch');
		if (knob) {
			const rate = Math.max(PITCH_MIN, Math.min(PITCH_MAX, Number(h.doc.rate) || 1));
			knob.position.x = 0.16 + (((rate - PITCH_MIN) / (PITCH_MAX - PITCH_MIN)) * 2 - 1) * PITCH_RAIL;
		}
		const play = h.node?.getObjectByName?.('dk-play');
		if (play?.material?.color) play.material.color.setHex(h.doc.playing ? 0x4ade80 : 0x166534);
	}
	for (const h of faders.values()) {
		const knob = h.node?.getObjectByName?.('xf-knob');
		if (knob) knob.position.x = Math.max(-1, Math.min(1, Number(h.doc.position) || 0)) * XF_RAIL;
	}
}

export default {
	id: 'music-dj',
	name: 'Music DJ',
	version: '0.1.0',
	description: 'Two decks and a crossfader on the engine: drop a track on a deck, scrub the platter, ride the pitch, fade between them - every peer hears the same position.',
	/** @param {any} api */
	register(api) {
		void api.THREE; // handed to mesh(three) by the registry; never imported
		api.registerAudioDevice(deckSpec(api)).then((/** @type {string} */ kind) => (KINDS.deck = kind));
		api.registerAudioDevice(crossfaderSpec(api)).then((/** @type {string} */ kind) => (KINDS.crossfader = kind));

		api.registerClickHandler((/** @type {any} */ object) => {
			const device = deviceRootOf(object);
			const kind = device?.userData?.device?.kind;
			if (!kind) return false;
			if (kind === KINDS.deck) return clickDeck(api, device, object);
			if (kind === KINDS.crossfader) return clickCrossfader(api, device, object);
			return false;
		});
		api.registerDropHandler?.((/** @type {any} */ hit, /** @type {any} */ item) => dropTrack(api, hit, item));
		api.registerFrameTask((/** @type {number} */ time) => djFrame(api, time));

		api.registerMenu('Music DJ: booth', () => {
			const left = api.audio.addDevice('deck', { position: [-0.9, 0.8, -2] });
			const right = api.audio.addDevice('deck', { position: [0.9, 0.8, -2] });
			const fader = api.audio.addDevice('crossfader', { position: [0, 0.8, -1.6] });
			if (!left || !right || !fader) return api.toast('Music DJ: could not add the devices');
			api.audio.cable({ from: { uuid: left.uuid, port: 'out' }, to: { uuid: fader.uuid, port: 'a' } });
			api.audio.cable({ from: { uuid: right.uuid, port: 'out' }, to: { uuid: fader.uuid, port: 'b' } });
			// a Music Lab speaker if that module is here: the booth reaches the room through it
			const speaker = api.audio.addDevice('mod-music-lab-speaker', { position: [0, 0, -3.2] });
			const spec = speaker && api.audio.device(speaker.uuid);
			if (speaker && spec) api.audio.cable({ from: { uuid: fader.uuid, port: 'out' }, to: { uuid: speaker.uuid, port: 'in' } });
			api.toast('Music DJ: drop a track from the Explorer on each deck' + (speaker ? '' : ', then cable the crossfader to a speaker'));
		});

		api.onSceneClear(() => {
			decks.clear();
			faders.clear();
			gesture = null;
		});
	}
};
