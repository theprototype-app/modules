// Drivable car (K-F): body + 4 wheels as REPLICATED primitives, held together
// by P-B's motorized revolute joints and driven through P-A's simulation.
// Sync model = AUTHORITATIVE (golden rule 8, never mixed): whoever started the
// physics sim steps the world; the DRIVER (whoever claimed the car by clicking
// its body) broadcasts {op:'drive', throttle, steer} at ~20Hz and ONLY the
// initiator applies wheel motors (differential/tank steering v1 — steered
// front knuckles are a backlog item). Claims live in module state (late
// joiners adopt them) and free when the claimant disconnects (pong's paddle
// pattern). Driver != initiator adds ~150-250ms input latency — acceptable
// for a prototype toy, by design.
// C3 (roadmap #13): claims are allowed anytime, but DRIVING + the chase camera
// engage only while Play mode is active AND a simulation runs — engagement
// claims 'keys' (pausing play-mode walking) and reuses the possess follow cam
// (possess.startFollowCam), both released when play mode/sim/claim ends.

export default {
	id: 'car',
	name: 'Drivable Car',
	version: '1.2.1',
	description: 'Spawn a jointed demo car; click its body in Interact mode (I) to claim it, then drive with WASD in Play mode while a simulation runs.',
	/** @param {any} api */
	register(api) {
		const THREE = api.THREE;
		/** @type {Record<string, string>} car body uuid -> driver peerId */
		const claims = {};
		// C3 tuning: stable & grippy — lower top speed/force + softer wheel grip
		// than the 1.0 params (300/14/1.4 could flip the car at full throttle)
		const MAX_VEL = 10; // rad/s wheel speed at full throttle
		const STEER_VEL = 6;
		const FORCE = 120;
		let lastDrive = 0;

		api.registerBindings([
			{ label: 'Drive claimed car (Play mode + running sim)', keys: 'W / S' },
			{ label: 'Steer claimed car', keys: 'A / D' }
		]);

		// C3 play-gate: driving + the chase camera engage only while the main
		// play button is active AND a simulation is running; the claim itself is
		// allowed anytime (pre-claim while editing). Engagement claims 'keys'
		// (pausing play-mode walking, K-C) and follows via the possess chase cam.
		let playMode = false;
		let simOn = false;
		let engaged = false;
		const myCarId = () => {
			const me = api.peerId() ?? 'me';
			const mine = Object.entries(claims).find(([, peerId]) => peerId === me);
			return mine ? mine[0] : null;
		};
		const syncEngagement = () => {
			const car = myCarId();
			const want = !!car && playMode && simOn;
			if (want && !engaged) {
				engaged = true;
				api.claimInput('keys');
				api.followCam(car);
			} else if (!want && engaged) {
				engaged = false;
				api.releaseInput('keys');
				api.stopFollowCam();
			}
		};
		// the app exposes play mode and "a sim is running" as plain reads, so the
		// gate is polled once per frame instead of subscribing to app stores
		api.registerFrameTask(() => {
			const nowPlay = !!api.isPlaying();
			const nowSim = !!api.physics.running();
			if (nowPlay === playMode && nowSim === simOn) return;
			playMode = nowPlay;
			simOn = nowSim;
			syncEngagement();
		});

		// body geometry so '/create Carbody' replicates like any primitive
		api.registerPrimitive('Carbody', () => {
			const geometry = new THREE.BoxGeometry(2, 0.6, 3);
			geometry.translate(0, 0.3, 0); // rest on y=0 like the other builders
			return geometry;
		});

		const spawnDemoCar = async () => {
			// api.create runs the SAME replicated /create the sidebar does and hands
			// back the uuids; api.moveObject / api.physics.set / api.physics.createJoint
			// broadcast the rest. No app internals reached into (17-A1 DEVX #5).
			const bodyIds = await api.create('/create Carbody');
			/** @type {string[]} */ const wheelIds = [];
			for (let i = 0; i < 4; i++) wheelIds.push(...(await api.create('/create Cylinder 0.4 0.4 0.3')));
			const bodyId = bodyIds[0];
			if (!bodyId || wheelIds.length !== 4) {
				api.toast('Car spawn failed — try again');
				return;
			}
			// C3 tuning: heavier body (lower effective CG under load) + wider
			// stance keep the assembly planted through full-throttle turns
			api.moveObject(bodyId, { pos: [0, 0.55, 0] });
			api.physics.set(bodyId, { mode: 'dynamic', mass: 30, friction: 0.3 });
			const corners = [
				[1.3, -1.0],
				[-1.3, -1.0],
				[1.3, 1.0],
				[-1.3, 1.0]
			];
			wheelIds.forEach((uuid, index) => {
				// cylinder axis Y -> X (the axle)
				api.moveObject(uuid, { pos: [corners[index][0], 0.4, corners[index][1]], rot: [0, 0, Math.PI / 2] });
				api.physics.set(uuid, { mode: 'dynamic', mass: 2, collider: 'hull', friction: 1.1 });
			});
			// axle hinges: revolute about the BODY's local X, anchored at each wheel
			wheelIds.forEach((uuid) => api.physics.createJoint('revolute', bodyId, uuid, 'x', { vel: 0, maxForce: FORCE }));
			api.toast('Car spawned — press I (Interact) and click the body to claim it, then Play + a running simulation to drive');
		};

		api.registerMenu('Car: spawn demo car', spawnDemoCar);

		/** claim/release by clicking the body (walk up from the hit mesh).
		 * The car-body KIND derives from the NAME the replicated create assigns
		 * (deterministic on every peer — userData set locally would not be). */
		// Claiming is PLAY-side: it runs in Interact (the editor's play-style mode — the
		// pre-claim before Play) and in Play. An Edit click selects the body instead, so the
		// car can be moved with the gizmo.
		api.registerClickHandler((/** @type {any} */ object) => {
			const group = api.objectsGroup();
			let current = object;
			while (current && current.parent !== group) current = current.parent;
			if (current?.name !== 'Carbody') return false;
			const me = api.peerId() ?? 'me';
			const holder = claims[current.uuid];
			if (holder && holder !== me) {
				api.toast('Someone else is driving that car');
				return true;
			}
			const next = holder === me ? '' : me; // toggle
			applyClaim(current.uuid, next);
			api.send({ op: 'claim', carId: current.uuid, peerId: next });
			api.toast(next ? 'Car claimed — press ▶ Play with a running simulation, WASD drives' : 'Car released');
			return true;
		}, { modes: ['interact', 'play'] });

		const applyClaim = (/** @type {string} */ carId, /** @type {string} */ peerId) => {
			if (peerId) claims[carId] = peerId;
			else delete claims[carId];
			syncEngagement(); // C3: my claim appearing/vanishing (incl. remote release)
		};

		/** the initiator turns a drive op into wheel motor velocities */
		const applyDrive = (/** @type {string} */ carId, /** @type {number} */ throttle, /** @type {number} */ steer) => {
			if (!api.physics.isInitiator()) return;
			api.physics.joints().then((/** @type {any[]} */ defs) => {
				for (const def of defs) {
					if (def.a !== carId || def.kind !== 'revolute') continue;
					// differential steering: the axle side comes from the attach-time
					// body-local anchor's X sign
					const side = (def.anchorA?.[0] ?? 0) >= 0 ? 1 : -1;
					api.physics.setJointMotor(def.id, throttle * MAX_VEL + side * steer * STEER_VEL, FORCE);
				}
			});
		};

		// the driver forwards INPUT at ~20Hz; every peer sees the op, only the
		// initiator applies motors (driver == initiator short-circuits the same path).
		// C3: gated on Play mode — outside it WASD stays with the editor/camera.
		api.registerFrameTask(() => {
			if (!playMode) return;
			const me = api.peerId() ?? 'me';
			const mine = Object.entries(claims).find(([, peerId]) => peerId === me);
			if (!mine) return;
			const now = performance.now();
			if (now - lastDrive < 50) return;
			lastDrive = now;
			const { codes, axes } = api.input();
			const dead = (/** @type {number} */ v) => (Math.abs(v) > 0.15 ? v : 0);
			const throttle = Math.max(-1, Math.min(1, (codes.has('KeyW') ? 1 : 0) - (codes.has('KeyS') ? 1 : 0) - dead(axes.ly)));
			const steer = Math.max(-1, Math.min(1, (codes.has('KeyD') ? 1 : 0) - (codes.has('KeyA') ? 1 : 0) + dead(axes.lx)));
			api.send({ op: 'drive', carId: mine[0], throttle, steer });
			applyDrive(mine[0], throttle, steer); // local (driver may BE the initiator)
		});

		api.onMessage((/** @type {any} */ data) => {
			if (data.op === 'claim') applyClaim(data.carId, data.peerId);
			else if (data.op === 'drive') applyDrive(data.carId, data.throttle ?? 0, data.steer ?? 0);
		});

		api.registerStateSync({
			getState: () => ({ claims: { ...claims } }),
			applyState: (/** @type {any} */ state) =>
				Object.entries(state?.claims ?? {}).forEach(([carId, peerId]) => applyClaim(carId, /** @type {string} */ (peerId)))
		});

		// free a disconnected driver's claim (pong's roster pattern). Polled from
		// the gate task rather than subscribing to an app store; a stale claim only
		// has to clear before someone tries to re-claim, so once a second is plenty.
		let lastSweep = 0;
		api.registerFrameTask(() => {
			const now = performance.now();
			if (now - lastSweep < 1000) return;
			lastSweep = now;
			const ids = new Set(api.peerIds());
			const me = api.peerId() ?? 'me';
			for (const [carId, peerId] of Object.entries(claims))
				if (peerId !== me && !ids.has(peerId)) delete claims[carId];
		});
	}
};
