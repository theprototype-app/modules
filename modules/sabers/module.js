// Sabers — a glowing blade held wherever you point.
//
// Rewritten on the module SDK from the vrvsvr prototype's Sabers.svelte, whose
// actual point was the FALLBACK: parent the blade to the tracked hand when hand
// tracking is on, to the controller when it is not. Our SDK collapses that
// choice into one call — `api.pointerRay()` already resolves to the VR pointer
// hand or the desktop mouse — so the module poses one blade from one source and
// works in a headset and at a desk without branching.
//
// Replication:
// - the blade is LOCAL scene content (api.scene(), never objectsGroup): it is
//   derived state, so it must not enter scene sync, saves or GLTF exports
// - what peers need is your POSE, so it streams as a throttled module op
//   (~12/s) and each peer renders a ghost blade for you; a blade that stops
//   reporting fades out, which doubles as disconnect handling
// - hits are AUTHORITATIVE where physics is: only the peer stepping the sim
//   applies an impulse, everyone else just sees the sparks
//
// Known SDK gaps this module works around (see ../../DEVX-REQUESTS.md):
//   #2 per-hand VR pose  — one hand only; the off hand is not addressable
//   #3 api.haptic        — feature-detected, silent until it lands
//   #6 api.isVR()        — inferred from recent mouse movement

export default {
	id: 'sabers',
	name: 'Sabers',
	version: '1.0.0',
	description: 'A glowing blade held wherever you point, with hit sparks.',

	/** @param {any} api */
	register(api) {
		const THREE = api.THREE;

		const GROUP = 'sabers-module';
		const LENGTH = 1.2;
		const RADIUS = 0.02;
		const DESK_HOLD = 0.55; // how far in front of the camera the hilt sits
		const SEND_MS = 80; // ~12 pose updates a second
		const GHOST_TTL = 3; // seconds without an update before a peer blade fades
		const HIT_COOLDOWN = 0.25;

		let drawn = false;
		let group = null;
		let blade = null;
		/** @type {Record<string, any>} peerId -> {mesh, seen} */
		const ghosts = {};
		/** @type {Record<string, number>} hit object uuid -> last hit (api.now) */
		const hits = {};
		let lastSent = 0;
		let lastMouse = 0;
		/** @type {any[]} {mesh, born} */
		let sparks = [];

		// DEVX #6: no api.isVR(), so infer the holder. A VR trigger never emits a
		// mouse pointermove, so "a mouse moved recently" is a good enough proxy
		// for "the ray starts at the camera, not at a hand".
		if (typeof window !== 'undefined')
			window.addEventListener('pointermove', (event) => {
				if (event.pointerType !== 'touch') lastMouse = performance.now();
			});
		const atDesk = () => performance.now() - lastMouse < 3000;

		// ---- colour: stable per peer, so two blades in a room read apart -------
		function colorFor(id) {
			let hash = 0x811c9dc5;
			for (const char of String(id ?? 'me')) {
				hash ^= char.charCodeAt(0);
				hash = Math.imul(hash, 0x01000193) >>> 0;
			}
			return new THREE.Color().setHSL((hash % 360) / 360, 0.85, 0.55, THREE.SRGBColorSpace);
		}

		// ---- meshes -----------------------------------------------------------
		function root() {
			if (group) return group;
			const scene = api.scene();
			if (!scene) return null;
			group = new THREE.Group();
			group.name = GROUP;
			scene.add(group);
			api.registerSystemGroup?.(GROUP);
			return group;
		}

		function makeBlade(color) {
			const holder = new THREE.Group();
			const core = new THREE.Mesh(
				new THREE.CylinderGeometry(RADIUS, RADIUS, LENGTH, 12),
				new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: color, emissiveIntensity: 1.6 })
			);
			// the glow keeps depthWrite ON: a depthWrite:false shell would have the
			// AO and outline passes paint whatever is BEHIND it across its face
			const glow = new THREE.Mesh(
				new THREE.CylinderGeometry(RADIUS * 2.6, RADIUS * 2.2, LENGTH, 12),
				new THREE.MeshStandardMaterial({
					color: color,
					emissive: color,
					emissiveIntensity: 0.8,
					transparent: true,
					opacity: 0.32
				})
			);
			const hilt = new THREE.Mesh(
				new THREE.CylinderGeometry(RADIUS * 2.2, RADIUS * 2, 0.16, 10),
				new THREE.MeshStandardMaterial({ color: 0x2b2b31, roughness: 0.6, metalness: 0.7 })
			);
			hilt.position.y = -0.08;
			core.position.y = LENGTH / 2;
			glow.position.y = LENGTH / 2;
			holder.add(hilt, core, glow);
			holder.name = 'saber-blade';
			return holder;
		}

		/** point a blade holder from `origin` along `direction` (+Y is the blade) */
		const up = new THREE.Vector3(0, 1, 0);
		function poseBlade(mesh, origin, direction) {
			mesh.position.set(origin[0], origin[1], origin[2]);
			mesh.quaternion.setFromUnitVectors(
				up,
				new THREE.Vector3(direction[0], direction[1], direction[2]).normalize()
			);
			mesh.updateMatrix();
		}

		// ---- sparks (local decoration, deterministic enough to not need sync) --
		function spark(point, color) {
			const holder = root();
			if (!holder) return;
			const mesh = new THREE.Mesh(
				new THREE.SphereGeometry(0.045, 8, 6),
				new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: color, emissiveIntensity: 2 })
			);
			mesh.name = 'saber-spark';
			mesh.position.copy(point);
			holder.add(mesh);
			sparks.push({ mesh, born: api.now() });
		}

		function buzz(strength) {
			if (typeof api.haptic === 'function') api.haptic('pointer', strength, 25);
		}

		let ac = null;
		function hum(freq, duration = 0.09, gain = 0.08) {
			try {
				ac = ac ?? new (window.AudioContext || window.webkitAudioContext)();
				const osc = ac.createOscillator();
				const g = ac.createGain();
				osc.type = 'sawtooth';
				osc.frequency.value = freq;
				g.gain.setValueAtTime(gain, ac.currentTime);
				g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + duration);
				osc.connect(g).connect(ac.destination);
				osc.start();
				osc.stop(ac.currentTime + duration);
			} catch {
				/* decoration only */
			}
		}

		// ---- draw / sheathe ----------------------------------------------------
		function setDrawn(on) {
			drawn = on;
			const holder = root();
			if (!holder) return;
			if (on && !blade) {
				blade = makeBlade(colorFor(api.peerId()));
				holder.add(blade);
			}
			if (blade) blade.visible = on;
			api.send({ op: on ? 'on' : 'off', peer: api.peerId() });
			hum(on ? 180 : 90, 0.25, 0.06);
		}

		api.registerBindings([{ label: 'Draw / sheathe the saber', keys: 'K' }]);
		// NOT claimInput('keys'): the saber does not need exclusive keys, and
		// claiming would stop the editor's own WASD fly while it is drawn.
		api.onInput((/** @type {string} */ kind, /** @type {string} */ code) => {
			if (kind === 'down' && code === 'KeyK') setDrawn(!drawn);
		});
		api.registerMenu('Draw / sheathe the saber (K)', () => setDrawn(!drawn));

		// ---- per frame ---------------------------------------------------------
		const hitRay = new THREE.Raycaster();
		const hilt = new THREE.Vector3();
		const dir = new THREE.Vector3();

		api.registerFrameTask((/** @type {number} */ time) => {
			// sparks fade wherever they came from
			if (sparks.length) {
				sparks = sparks.filter(({ mesh, born }) => {
					const age = time - born;
					if (age > 0.6 || age < 0) {
						mesh.parent?.remove(mesh);
						mesh.geometry.dispose();
						mesh.material.dispose();
						return false;
					}
					mesh.scale.setScalar(1 + age * 4);
					mesh.material.opacity = 1;
					return true;
				});
			}

			// peer blades fade out when their owner stops reporting
			for (const ghost of Object.values(ghosts)) {
				if (time - ghost.seen > GHOST_TTL) ghost.mesh.visible = false;
			}

			if (!drawn || !blade) return;
			const ray = api.pointerRay();
			if (!ray) return; // no pointer yet (fresh page, never moved a mouse)

			dir.copy(ray.ray.direction).normalize();
			hilt.copy(ray.ray.origin).addScaledVector(dir, atDesk() ? DESK_HOLD : 0);
			poseBlade(blade, hilt.toArray(), dir.toArray());

			const now = performance.now();
			if (now - lastSent > SEND_MS) {
				lastSent = now;
				api.send({
					op: 'pose',
					peer: api.peerId(),
					p: [hilt.x, hilt.y, hilt.z],
					d: [dir.x, dir.y, dir.z]
				});
			}

			// what is the blade touching?
			const objects = api.objectsGroup()?.children ?? [];
			if (objects.length === 0) return;
			hitRay.set(hilt, dir);
			hitRay.far = LENGTH;
			const hit = hitRay.intersectObjects(objects, true)[0];
			if (!hit) return;
			const target = hit.object;
			if (time - (hits[target.uuid] ?? -10) < HIT_COOLDOWN) return;
			hits[target.uuid] = time;
			spark(hit.point, colorFor(api.peerId()));
			hum(320 + Math.random() * 60, 0.07, 0.06);
			buzz(0.6);
			api.send({ op: 'hit', peer: api.peerId(), point: hit.point.toArray() });
			// AUTHORITATIVE half: only the peer stepping the sim may push a body.
			// Everyone else has already drawn the spark; nobody simulates twice.
			if (api.physics?.isInitiator?.()) {
				const uuid = rootUuid(target);
				if (uuid) api.physics.applyImpulse(uuid, [dir.x * 1.5, 0.6, dir.z * 1.5]);
			}
		});

		/** the replicated object above a hit mesh (impulses key on that uuid) */
		function rootUuid(object) {
			const objects = api.objectsGroup();
			let current = object;
			while (current && current.parent !== objects) current = current.parent;
			return current?.uuid ?? null;
		}

		// ---- peers -------------------------------------------------------------
		function ghostFor(id) {
			const holder = root();
			if (!holder) return null;
			if (!ghosts[id]) {
				const mesh = makeBlade(colorFor(id));
				holder.add(mesh);
				ghosts[id] = { mesh, seen: api.now() };
			}
			return ghosts[id];
		}

		api.onMessage((/** @type {any} */ data) => {
			const id = data.peer ?? 'peer';
			if (data.op === 'pose') {
				const ghost = ghostFor(id);
				if (!ghost) return;
				ghost.seen = api.now();
				ghost.mesh.visible = true;
				poseBlade(ghost.mesh, data.p, data.d);
			} else if (data.op === 'on') {
				const ghost = ghostFor(id);
				if (ghost) ghost.mesh.visible = true;
			} else if (data.op === 'off') {
				if (ghosts[id]) ghosts[id].mesh.visible = false;
			} else if (data.op === 'hit') {
				spark(new THREE.Vector3(data.point[0], data.point[1], data.point[2]), colorFor(id));
			}
		});

		// a late joiner learns who is holding a blade (each peer sends its own)
		api.registerStateSync({
			getState: () => ({ peer: api.peerId(), on: drawn }),
			applyState: (/** @type {any} */ state) => {
				if (!state?.peer || !state.on) return;
				const ghost = ghostFor(state.peer);
				if (ghost) ghost.mesh.visible = true;
			}
		});

		api.onSceneClear(() => {
			for (const { mesh } of sparks) mesh.parent?.remove(mesh);
			sparks = [];
			for (const key of Object.keys(hits)) delete hits[key];
		});
	}
};
