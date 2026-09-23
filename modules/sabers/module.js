// Sabers — a glowing blade held wherever you point.
//
// Rewritten on the module SDK from the vrvsvr prototype's Sabers.svelte, whose
// actual point was the FALLBACK: parent the blade to the tracked hand when hand
// tracking is on, to the controller when it is not. Our SDK collapses that
// choice — `api.vrHand()` reports either as one pose, and `api.pointerRay()`
// resolves the VR pointer hand or the desktop mouse — so the module poses its
// blades from one place and runs in a headset and at a desk without branching
// on `isPresenting`.
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
// Every newer-SDK call is FEATURE-DETECTED, so the module runs unchanged on an
// app that predates them (see ../../DEVX-REQUESTS.md):
//   api.vrHand  (#2) — both hands in VR; without it, the one pointerRay() hand
//   api.haptic  (#3) — a thump on contact; silent without it
//   api.isVR    (#6) — without it, inferred from recent mouse movement

export default {
	id: 'sabers',
	name: 'Sabers',
	version: '1.0.1',
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
		/** @type {any[]} one blade per held hand */
		const blades = [];
		/** @type {Record<string, any>} peerId -> {meshes, seen} */
		const ghosts = {};
		/** @type {Record<string, number>} hit object uuid -> last hit (api.now) */
		const hits = {};
		let lastSent = 0;
		let lastMouse = 0;
		/** @type {any[]} {mesh, born} */
		let sparks = [];

		// Which hand is holding this? `api.isVR()` and `api.vrHand()` are the 17-A1
		// SDK (DEVX-REQUESTS #2/#6); on an older app we fall back to inferring it,
		// because a VR trigger never emits a mouse pointermove — "a mouse moved
		// recently" means the ray starts at the camera, not at a hand.
		if (typeof window !== 'undefined')
			window.addEventListener('pointermove', (event) => {
				if (event.pointerType !== 'touch') lastMouse = performance.now();
			});
		const inVR = () =>
			typeof api.isVR === 'function' ? api.isVR() : performance.now() - lastMouse >= 3000;
		const atDesk = () => !inVR();
		/** per-hand pose when the app has it, else null (one blade off pointerRay) */
		const handPose = (/** @type {'left'|'right'} */ hand) =>
			typeof api.vrHand === 'function' ? api.vrHand(hand) : null;

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
		// Listed read-only in the object list's "Module content" section, under a name a
		// person reads. The blades are never click-SELECTABLE: a desk blade lies along the
		// pointer ray itself, so a click on it would be every click (see AUTHORING.md).
		api.registerListedGroup?.(GROUP, { label: 'Sabers' });

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
			if (typeof api.haptic === 'function') api.haptic(strength, 25); // (intensity, ms, hand?)
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
			if (on && blades.length === 0) blades.push(addBlade(holder, colorFor(api.peerId())));
			for (const mesh of blades) mesh.visible = on;
			api.send({ op: on ? 'on' : 'off', peer: api.peerId() });
			hum(on ? 180 : 90, 0.25, 0.06);
		}

		function addBlade(holder, color) {
			const mesh = makeBlade(color);
			holder.add(mesh);
			return mesh;
		}

		/**
		 * Where the blades are this frame, as [{p, d}].
		 * With the 17-A1 SDK in VR that is BOTH hands (`api.vrHand`, blade along
		 * the controller's -Z, the three convention). Everywhere else it is the one
		 * hand `pointerRay()` resolves — the VR pointer hand, or the desktop mouse
		 * with the hilt held a little ahead of the camera.
		 */
		function heldPoses() {
			if (inVR() && typeof api.vrHand === 'function') {
				const poses = [];
				for (const hand of ['right', 'left']) {
					const pose = handPose(/** @type {any} */ (hand));
					if (!pose?.connected || !pose.position || !pose.quaternion) continue;
					const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(
						new THREE.Quaternion(...pose.quaternion)
					);
					poses.push({ p: [...pose.position], d: [forward.x, forward.y, forward.z] });
				}
				if (poses.length) return poses;
			}
			const ray = api.pointerRay();
			if (!ray) return [];
			dir.copy(ray.ray.direction).normalize();
			hilt.copy(ray.ray.origin).addScaledVector(dir, atDesk() ? DESK_HOLD : 0);
			return [{ p: [hilt.x, hilt.y, hilt.z], d: [dir.x, dir.y, dir.z] }];
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
				if (time - ghost.seen > GHOST_TTL) for (const mesh of ghost.meshes) mesh.visible = false;
			}

			if (!drawn) return;
			const poses = heldPoses();
			if (poses.length === 0) return; // no pointer yet, no tracked hand

			const holder = root();
			while (holder && blades.length < poses.length)
				blades.push(addBlade(holder, colorFor(api.peerId())));
			blades.forEach((mesh, index) => {
				mesh.visible = index < poses.length;
				if (poses[index]) poseBlade(mesh, poses[index].p, poses[index].d);
			});

			const now = performance.now();
			if (now - lastSent > SEND_MS) {
				lastSent = now;
				api.send({ op: 'pose', peer: api.peerId(), poses });
			}

			// what are the blades touching?
			const objects = api.objectsGroup()?.children ?? [];
			if (objects.length === 0) return;
			for (const pose of poses) {
				hilt.set(pose.p[0], pose.p[1], pose.p[2]);
				dir.set(pose.d[0], pose.d[1], pose.d[2]).normalize();
				hitRay.set(hilt, dir);
				hitRay.far = LENGTH;
				const hit = hitRay.intersectObjects(objects, true)[0];
				if (!hit) continue;
				const target = hit.object;
				if (time - (hits[target.uuid] ?? -10) < HIT_COOLDOWN) continue;
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
		function ghostFor(id, count = 1) {
			const holder = root();
			if (!holder) return null;
			if (!ghosts[id]) ghosts[id] = { meshes: [], seen: api.now() };
			const ghost = ghosts[id];
			while (ghost.meshes.length < count) ghost.meshes.push(addBlade(holder, colorFor(id)));
			return ghost;
		}

		api.onMessage((/** @type {any} */ data) => {
			const id = data.peer ?? 'peer';
			if (data.op === 'pose') {
				const poses = data.poses ?? (data.p ? [{ p: data.p, d: data.d }] : []);
				const ghost = ghostFor(id, poses.length);
				if (!ghost) return;
				ghost.seen = api.now();
				ghost.meshes.forEach((mesh, index) => {
					mesh.visible = index < poses.length;
					if (poses[index]) poseBlade(mesh, poses[index].p, poses[index].d);
				});
			} else if (data.op === 'on') {
				const ghost = ghostFor(id);
				if (ghost) for (const mesh of ghost.meshes) mesh.visible = true;
			} else if (data.op === 'off') {
				if (ghosts[id]) for (const mesh of ghosts[id].meshes) mesh.visible = false;
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
				if (ghost) for (const mesh of ghost.meshes) mesh.visible = true;
			}
		});

		api.onSceneClear(() => {
			for (const { mesh } of sparks) mesh.parent?.remove(mesh);
			sparks = [];
			for (const key of Object.keys(hits)) delete hits[key];
		});
	}
};
