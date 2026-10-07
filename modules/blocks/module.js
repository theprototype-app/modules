// Blocks (roadmap 37 R19): 100 rigid bodies drawn as ONE InstancedMesh — a performance
// showcase, after the old vrvsvr `example/Blocks.svelte`.
//
// THE SYNC MODEL IS DETERMINISTIC, NOT AUTHORITATIVE (golden rule 8). A drop is one small
// message — {op:'drop', seed, at} — and every peer builds the same 100 bodies from the seed and
// steps them in a world of its OWN (api.physics.rapier(): the rapier core already loaded, used
// for a local world beside the shared simulation). Nothing streams: a hundred bodies at 10 Hz
// would be the heaviest thing in the session for a toy. Each peer's pile is its own rendering
// of the same drop — identical starts, a fixed timestep, the same wasm — so they agree closely
// but are not promised to the millimetre; nothing gameplay-side may read a block's pose.
//
// The blocks fall onto the ground and onto every OBJECT in the scene, approximated by its
// world bounding box (static boxes taken at drop time). They live at the scene root (golden
// rule 5): never saved, never in an object sync. A late joiner sees the last drop (state sync)
// replayed from its seed.
//
// Needs core 1.27 (api.physics.rapier); an older core says so and does nothing.

export default {
	id: 'blocks',
	name: 'Blocks',
	version: '1.0.0',
	description: 'Drop 100 blocks that tumble and pile up: one instanced draw call and a local physics world — a performance showcase.',
	/** @param {any} api */
	register(api) {
		const THREE = api.THREE;
		const GROUP = 'blocks-module';
		const COUNT = 100;
		const SIZE = 0.4;
		const STEP = 1 / 60;
		const MAX_SUBSTEPS = 8; // core physics caps at 8 too: a slow frame catches up instead of falling behind
		const PALETTE = ['#f97316', '#38bdf8', '#a3e635', '#f43f5e', '#facc15', '#c084fc'];

		/** @type {any} */ let RAPIER = null;
		/** @type {any} */ let world = null;
		/** @type {any[]} */ let bodies = [];
		/** @type {any} */ let mesh = null;
		/** @type {any} */ let group = null;
		/** @type {{seed: number, at: number[]} | null} */ let lastDrop = null;
		let acc = 0;
		let lastT = 0;
		let settledFor = 0;
		let running = false;
		const stats = { drops: 0, steps: 0, stepMs: 0, maxStepMs: 0, statics: 0, drawCalls: 1 };

		/** @param {number} seed */
		function rng(seed) {
			let t = seed >>> 0;
			return () => {
				t = (t + 0x6d2b79f5) >>> 0;
				let r = Math.imul(t ^ (t >>> 15), t | 1);
				r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
				return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
			};
		}

		function ensureMesh() {
			if (mesh) return;
			const scene = api.scene();
			if (!scene) return;
			group = new THREE.Group();
			group.name = GROUP;
			const geometry = new THREE.BoxGeometry(SIZE, SIZE, SIZE);
			const material = new THREE.MeshStandardMaterial({ roughness: 0.55, metalness: 0.05 });
			mesh = new THREE.InstancedMesh(geometry, material, COUNT);
			mesh.name = 'blocks-instances';
			mesh.castShadow = true;
			mesh.receiveShadow = true;
			mesh.frustumCulled = false; // the instances leave any bounds computed at drop time
			const colour = new THREE.Color();
			for (let i = 0; i < COUNT; i++) mesh.setColorAt(i, colour.set(PALETTE[i % PALETTE.length]));
			mesh.count = 0;
			group.add(mesh);
			scene.add(group);
			api.own?.(group);
		}

		function freeWorld() {
			world?.free?.();
			world = null;
			bodies = [];
			running = false;
		}

		/** static boxes for the ground and every top-level scene object, from world bounds */
		function addStatics() {
			const ground = RAPIER.ColliderDesc.cuboid(50, 0.1, 50).setTranslation(0, -0.1, 0).setFriction(0.8);
			world.createCollider(ground);
			stats.statics = 1;
			const box = new THREE.Box3();
			const centre = new THREE.Vector3();
			const half = new THREE.Vector3();
			for (const object of api.objectsGroup()?.children ?? []) {
				if (!object.visible) continue;
				box.setFromObject(object);
				if (box.isEmpty()) continue;
				box.getCenter(centre);
				box.getSize(half).multiplyScalar(0.5);
				// lights/empties/huge sky domes are not things to land on
				if (half.x < 0.01 || half.y < 0.01 || half.z < 0.01 || Math.max(half.x, half.y, half.z) > 40) continue;
				if (![centre.x, centre.y, centre.z, half.x, half.y, half.z].every(Number.isFinite)) continue;
				world.createCollider(RAPIER.ColliderDesc.cuboid(half.x, half.y, half.z).setTranslation(centre.x, centre.y, centre.z).setFriction(0.7));
				stats.statics++;
			}
		}

		/** Build the drop on THIS peer. @param {number} seed @param {number[]} at */
		async function dropLocal(seed, at) {
			RAPIER = RAPIER ?? (await api.physics.rapier?.());
			if (!RAPIER) {
				api.toast('Blocks needs a newer app (1.27 or later)');
				return;
			}
			ensureMesh();
			if (!mesh) return;
			freeWorld();
			lastDrop = { seed, at: [...at] };
			world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
			world.timestep = STEP;
			addStatics();
			const rand = rng(seed);
			// a loose 5 x 4 x 5 column above `at`, each block jittered and turned
			for (let i = 0; i < COUNT; i++) {
				const gx = i % 5;
				const gz = Math.floor(i / 5) % 5;
				const gy = Math.floor(i / 25);
				const x = at[0] + (gx - 2) * SIZE * 1.6 + (rand() - 0.5) * 0.2;
				const y = at[1] + gy * SIZE * 2.2 + rand() * 0.3;
				const z = at[2] + (gz - 2) * SIZE * 1.6 + (rand() - 0.5) * 0.2;
				const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rand() * 6.28, rand() * 6.28, rand() * 6.28));
				const body = world.createRigidBody(
					RAPIER.RigidBodyDesc.dynamic().setTranslation(x, y, z).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
				);
				world.createCollider(RAPIER.ColliderDesc.cuboid(SIZE / 2, SIZE / 2, SIZE / 2).setFriction(0.6).setRestitution(0.1).setDensity(1), body);
				bodies.push(body);
			}
			mesh.count = COUNT;
			writeInstances();
			acc = 0;
			lastT = 0;
			settledFor = 0;
			running = true;
			stats.drops++;
			stats.steps = 0;
			stats.maxStepMs = 0;
		}

		const m4 = new THREE.Matrix4();
		const p = new THREE.Vector3();
		const qq = new THREE.Quaternion();
		const one = new THREE.Vector3(1, 1, 1);
		function writeInstances() {
			for (let i = 0; i < bodies.length; i++) {
				const t = bodies[i].translation();
				const r = bodies[i].rotation();
				mesh.setMatrixAt(i, m4.compose(p.set(t.x, t.y, t.z), qq.set(r.x, r.y, r.z, r.w), one));
			}
			mesh.instanceMatrix.needsUpdate = true;
		}

		// the local world steps on a fixed timestep (so two peers' piles agree), driven by the
		// frame loop; it stops once every block has rested for a second (or fallen away)
		api.registerFrameTask(() => {
			if (!running || !world) return;
			const now = performance.now();
			const dt = lastT ? Math.min((now - lastT) / 1000, 0.25) : STEP;
			lastT = now;
			acc += dt;
			let n = 0;
			const t0 = performance.now();
			while (acc >= STEP && n < MAX_SUBSTEPS) {
				world.step();
				acc -= STEP;
				n++;
			}
			if (n === MAX_SUBSTEPS) acc = 0; // a stalled tab does not owe a backlog
			if (n) {
				const ms = (performance.now() - t0) / n;
				stats.steps += n;
				stats.stepMs = stats.stepMs ? stats.stepMs * 0.9 + ms * 0.1 : ms;
				stats.maxStepMs = Math.max(stats.maxStepMs, ms);
				writeInstances();
			}
			let moving = false;
			for (const body of bodies) {
				const v = body.linvel();
				if (body.translation().y > -20 && v.x * v.x + v.y * v.y + v.z * v.z > 0.01) {
					moving = true;
					break;
				}
			}
			settledFor = moving ? 0 : settledFor + dt;
			if (settledFor > 1) running = false;
		});

		/** where a drop lands: above the selected object, else above the world origin */
		function dropPoint() {
			const uuid = api.selectedUuid?.();
			const object = uuid ? api.objectsGroup()?.getObjectByProperty('uuid', uuid) : null;
			if (object) {
				const box = new THREE.Box3().setFromObject(object);
				const c = box.getCenter(new THREE.Vector3());
				if (Number.isFinite(c.x)) return [c.x, box.max.y + 3, c.z];
			}
			return [0, 4, 0];
		}

		async function drop() {
			const seed = (Math.random() * 2 ** 31) | 0;
			const at = dropPoint();
			api.send({ op: 'drop', seed, at });
			await dropLocal(seed, at);
			if (RAPIER) api.toast(`${COUNT} blocks dropped — one draw call, ${stats.statics} static shapes`);
		}

		function clearLocal() {
			freeWorld();
			lastDrop = null;
			if (mesh) mesh.count = 0;
		}

		api.registerMenu('Blocks: drop 100 blocks', drop);
		api.registerMenu('Blocks: clear', () => {
			clearLocal();
			api.send({ op: 'clear' });
		});

		api.onMessage((/** @type {any} */ data) => {
			if (data?.op === 'drop' && Number.isFinite(data.seed) && Array.isArray(data.at)) dropLocal(data.seed, data.at);
			else if (data?.op === 'clear') clearLocal();
		});

		// a late joiner replays the last drop from its seed (it starts falling then — the
		// pile is decoration, so a fresh fall beats a teleported heap)
		api.registerStateSync({
			getState: () => ({ lastDrop }),
			applyState: (/** @type {any} */ state) => {
				const d = state?.lastDrop;
				if (d && Number.isFinite(d.seed) && Array.isArray(d.at)) dropLocal(d.seed, d.at);
			}
		});

		api.registerListedGroup?.(GROUP, { label: 'Blocks' });
		api.onUnload?.(() => {
			freeWorld();
			mesh = null;
			group = null;
		});

		// test/debug view (a module has no other way to be read from a flight)
		if (typeof window !== 'undefined')
			/** @type {any} */ (window).__blocks = {
				stats: () => ({ ...stats, running, bodies: bodies.length, count: mesh?.count ?? 0 }),
				pose: (/** @type {number} */ i) => {
					const t = bodies[i]?.translation();
					return t ? [t.x, t.y, t.z] : null;
				},
				drop: (/** @type {number} */ seed, /** @type {number[]} */ at) => dropLocal(seed, at),
				lastDrop: () => lastDrop
			};
	}
};
