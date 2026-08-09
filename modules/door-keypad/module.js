// Door & Keypad — a combination lock that actuates a door.
//
// Rewritten on the module SDK from the vrvsvr prototype's 4-button door-code
// keypad (src/lib/haptics.js) and its sensor door (player/Door.svelte). What
// carried over is the CONCEPT: four buttons, a secret order, wrong press resets,
// the door swings open. Everything else is different, because the SDK already
// answers the hard parts — one click handler serves desktop AND VR, and the
// swing needs no motion messages at all.
//
// Replication (golden rules):
// - the pieces are ordinary replicated objects: `/create Kpbutton1` runs on
//   every peer through the normal create path, so placing, moving, saving and
//   undoing them is the editor's job, not ours
// - the CODE is derived from the door's uuid, so every peer computes the same
//   secret with nothing on the wire, and re-placing a door re-rolls it
// - a press is a discrete event: apply locally + api.send; receivers apply and
//   never re-send
// - the swing is DETERMINISTIC from one `openedAt` stamp on the synced clock —
//   the door animation itself is never transmitted
// - late joiners get {openedAt, entered} through registerStateSync

export default {
	id: 'door-keypad',
	name: 'Door & Keypad',
	version: '1.0.0',
	description: 'A combination-lock keypad that opens an actuated door.',

	/** @param {any} api */
	register(api) {
		const THREE = api.THREE;

		const BUTTONS = 4; // code length AND number of buttons
		const SWING = -1.75; // radians the door turns (~100 degrees)
		const SWING_TIME = 0.9; // seconds
		const PRESS_TIME = 0.25; // button squash

		// ---- state (everything a late joiner needs is in here) ----------------
		/** @type {number[]} button indices pressed so far, 1-based */
		let entered = [];
		/** @type {number|null} api.now() stamp of the unlock, null while locked */
		let openedAt = null;
		/** @type {Record<string, number>} button uuid -> press stamp (visual only) */
		const presses = {};
		/** captured the first time we swing so a moved door still swings from where it is */
		let closedYaw = null;

		// ---- the pieces (replicated objects; the NAME is the kind) ------------
		// Buttons: a shallow cylinder, flat side up.
		for (let i = 1; i <= BUTTONS; i++) {
			api.registerPrimitive(
				'Kpbutton' + i,
				() => new THREE.CylinderGeometry(0.09, 0.1, 0.05, 20),
				{ label: 'Keypad button ' + i, command: '/create Kpbutton' + i, group: 'Door & Keypad' }
			);
		}
		// Door: the geometry is translated so the ORIGIN sits at the hinge edge
		// (bottom-left), which is what lets a plain rotation.y read as a swing.
		api.registerPrimitive(
			'Kpdoor',
			() => {
				const geometry = new THREE.BoxGeometry(1.1, 2.2, 0.12);
				geometry.translate(0.55, 1.1, 0);
				return geometry;
			},
			{ label: 'Door (hinged)', command: '/create Kpdoor', group: 'Door & Keypad' }
		);

		// ---- lookups ----------------------------------------------------------
		const objects = () => api.objectsGroup()?.children ?? [];
		const findDoor = () => objects().find((/** @type {any} */ o) => o.name === 'Kpdoor');
		/** the placed object above a clicked mesh, if it is one of ours */
		const pieceOf = (/** @type {any} */ object) => {
			const group = api.objectsGroup();
			let current = object;
			while (current && current.parent !== group) current = current.parent;
			return current?.name?.startsWith('Kp') ? current : null;
		};

		// ---- the secret ------------------------------------------------------
		// FNV-1a over the door's uuid: identical on every peer, no message, and a
		// new door is a new code. (Math.random() here would desync instantly.)
		function codeFor(door) {
			if (!door) return [];
			let hash = 0x811c9dc5;
			for (const char of door.uuid) {
				hash ^= char.charCodeAt(0);
				hash = Math.imul(hash, 0x01000193) >>> 0;
			}
			const code = [];
			for (let i = 0; i < BUTTONS; i++) {
				code.push((hash % BUTTONS) + 1);
				hash = Math.imul(hash ^ (hash >>> 13), 0x01000193) >>> 0; // advance
			}
			return code;
		}

		// ---- audio (lazy: browsers gate audio on a gesture) -------------------
		const SCALE = [0, 3, 5, 7]; // minor pentatonic-ish, like the original's chime
		let ac = null;
		function blip(semitones, duration = 0.12, gain = 0.1) {
			try {
				ac = ac ?? new (window.AudioContext || window.webkitAudioContext)();
				const osc = ac.createOscillator();
				const g = ac.createGain();
				osc.type = 'triangle';
				osc.frequency.value = 220 * Math.pow(2, semitones / 12);
				g.gain.setValueAtTime(gain, ac.currentTime);
				g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + duration);
				osc.connect(g).connect(ac.destination);
				osc.start();
				osc.stop(ac.currentTime + duration);
			} catch {
				/* audio is decoration; never let it break the lock */
			}
		}

		// api.haptic is not on the SDK yet (DEVX-REQUESTS #3) — feature-detect so
		// this module simply gains the pulse the day it lands.
		function buzz(strength) {
			if (typeof api.haptic === 'function') api.haptic('pointer', strength, 40);
		}

		// ---- visuals ----------------------------------------------------------
		/** Buttons already accepted glow (`entered` only ever holds a correct
		 *  prefix — a wrong press empties it). Local paint only: every peer
		 *  derives the same lights from the same `entered`. */
		function paintButtons() {
			for (const object of objects()) {
				const match = /^Kpbutton(\d)$/.exec(object.name ?? '');
				if (!match || !object.material?.emissive) continue;
				const lit = openedAt !== null || entered.includes(Number(match[1]));
				object.material.emissive.setHex(lit ? 0x224422 : 0x000000);
			}
		}

		function flashWrong() {
			for (const object of objects()) {
				if (object.name?.startsWith('Kpbutton') && object.material?.emissive)
					object.material.emissive.setHex(0x441111);
			}
			setTimeout(paintButtons, 220);
		}

		// ---- the lock ---------------------------------------------------------
		function press(index, uuid, at, local) {
			if (uuid) presses[uuid] = at;
			blip(SCALE[(index - 1) % SCALE.length] + 12);
			if (local) buzz(index / BUTTONS);
			if (openedAt !== null) return; // already open: presses are just noise

			const door = findDoor();
			const code = codeFor(door);
			if (code.length === 0) {
				if (local) api.toast('Add a Door (hinged) — the keypad needs one to unlock');
				return;
			}

			entered.push(index);
			const correctSoFar = entered.every((value, at2) => value === code[at2]);
			if (!correctSoFar) {
				entered = [];
				flashWrong();
				if (local) {
					api.send({ op: 'reset' });
					api.toast('Wrong code — start again');
				}
				return;
			}
			paintButtons();
			if (entered.length === code.length) {
				// whoever completes it decides the moment; peers adopt the stamp
				const stamp = at ?? api.now();
				open(stamp);
				if (local) api.send({ op: 'unlock', at: stamp });
			}
		}

		function open(at) {
			openedAt = at;
			entered = [];
			paintButtons();
			blip(24, 0.5, 0.12);
		}

		function close() {
			openedAt = null;
			closedYaw = null;
			entered = [];
			const door = findDoor();
			if (door) {
				door.rotation.y = 0;
				door.updateMatrix();
			}
			paintButtons();
		}

		// ---- one handler, desktop clicks AND the VR trigger --------------------
		api.registerClickHandler((/** @type {any} */ object) => {
			const piece = pieceOf(object);
			if (!piece) return false;
			const match = /^Kpbutton(\d)$/.exec(piece.name);
			if (!match) return false; // the door itself stays selectable
			const at = api.now();
			const index = Number(match[1]);
			press(index, piece.uuid, at, true);
			api.send({ op: 'press', index, uuid: piece.uuid, at });
			return true; // consume: pressing must not select the button
		});

		// receivers apply the same change, and never re-broadcast
		api.onMessage((/** @type {any} */ data) => {
			if (data.op === 'press') press(data.index, data.uuid, data.at, false);
			else if (data.op === 'unlock') open(data.at ?? api.now());
			else if (data.op === 'reset') {
				entered = [];
				flashWrong();
			} else if (data.op === 'lock') close();
		});

		// ---- per frame: a pure function of (stamp, synced time) ----------------
		api.registerFrameTask((/** @type {number} */ time) => {
			const door = findDoor();
			if (door && openedAt !== null) {
				if (closedYaw === null) closedYaw = door.rotation.y;
				// cubic ease-out, clamped: every peer lands on exactly the same pose
				const t = Math.max(0, Math.min(1, (time - openedAt) / SWING_TIME));
				const eased = 1 - Math.pow(1 - t, 3);
				door.rotation.y = closedYaw + SWING * eased;
				door.updateMatrix();
			}
			for (const [uuid, at] of Object.entries(presses)) {
				const button = api.objectsGroup()?.getObjectByProperty('uuid', uuid);
				if (!button) {
					delete presses[uuid];
					continue;
				}
				const age = time - at;
				if (age < 0 || age > PRESS_TIME) {
					button.scale.y = 1;
					delete presses[uuid];
				} else {
					button.scale.y = 1 - 0.45 * Math.sin((age / PRESS_TIME) * Math.PI);
				}
			}
		});

		// ---- late joiners ------------------------------------------------------
		api.registerStateSync({
			getState: () => ({ openedAt, entered: [...entered] }),
			applyState: (/** @type {any} */ state) => {
				if (!state) return;
				entered = Array.isArray(state.entered) ? [...state.entered] : [];
				if (typeof state.openedAt === 'number') open(state.openedAt);
				else paintButtons();
			}
		});

		// ---- card buttons ------------------------------------------------------
		api.registerMenu('Lock the door', () => {
			close();
			api.send({ op: 'lock' });
			api.toast('Door locked — the code is unchanged');
		});
		api.registerMenu('Reveal the code (this screen only)', () => {
			const code = codeFor(findDoor());
			api.toast(
				code.length
					? 'Code: press buttons ' + code.join(' - ')
					: 'Place a Door (hinged) first — the code comes from it'
			);
		});

		api.onSceneClear(() => {
			openedAt = null;
			closedYaw = null;
			entered = [];
			for (const key of Object.keys(presses)) delete presses[key];
		});
	}
};
