// my-module — the module template. It IS a working module (install the zip and
// you get a clickable beacon), so you can verify your toolchain before you write
// a line of your own code. Replace the beacon with whatever you are building.
//
// THE THREE RULES (long version in ../../AUTHORING.md):
//   1. Self-contained: NO import statements. Everything comes from `api`
//      (api.THREE, api.assetUrl, api.scene, ...). The app imports this file as a
//      blob URL, where a bare specifier like "three" has nothing to resolve to.
//   2. Your module runs on EVERY peer. A change one user makes must end up on
//      the others: apply it locally AND api.send() it; receivers apply WITHOUT
//      re-sending. Late joiners catch up through registerStateSync.
//   3. Pick ONE sync model per feature — deterministic (same inputs + synced
//      clock, no messages) or authoritative (one peer decides, broadcasts the
//      result). Mixing them desyncs.

export default {
	id: 'my-module', // stable + unique: it routes your messages
	name: 'My Module',
	version: '1.0.0', // peers toast when versions differ; bump on behavior changes
	description: 'One line describing what this module adds to a session.',

	/** @param {any} api the module SDK surface — see AUTHORING.md */
	register(api) {
		const THREE = api.THREE;

		// ---- state -----------------------------------------------------------
		// Keyed by object uuid so it survives peers, saves and undo. Anything a
		// late joiner needs must be reachable from registerStateSync's getState.
		/** @type {Record<string, number>} beacon uuid -> last pulse (api.now seconds) */
		const pulses = {};

		// ---- a creatable object ----------------------------------------------
		// registerPrimitive makes `/create Mybeacon` work on every peer, so the
		// object itself replicates through the normal create path — no netcode of
		// your own. The NAME is what replicates, so derive behavior from it
		// (never from locally-set userData, which peers do not have).
		// Primitive names are global: prefix them with your module.
		api.registerPrimitive(
			'Mybeacon',
			() => new THREE.ConeGeometry(0.35, 0.9, 16),
			{ label: 'Beacon', command: '/create Mybeacon', group: 'My Module' }
		);

		/** the beacon root above a clicked mesh (clicks report the exact mesh hit) */
		const beaconOf = (/** @type {any} */ object) => {
			const group = api.objectsGroup();
			let current = object;
			while (current && current.parent !== group) current = current.parent;
			return current?.name === 'Mybeacon' ? current : null;
		};

		// ---- interaction: desktop click AND VR trigger, one handler -----------
		const pulse = (/** @type {any} */ beacon, /** @type {number} */ at) => {
			pulses[beacon.uuid] = at;
		};

		api.registerClickHandler((/** @type {any} */ object) => {
			const beacon = beaconOf(object);
			if (!beacon) return false; // not ours — let normal selection happen
			const at = api.now(); // the SYNCED clock: stamp replicated times with it
			pulse(beacon, at); // apply locally...
			api.send({ op: 'pulse', uuid: beacon.uuid, at }); // ...and tell peers
			return true; // consume the click (no selection)
		});

		// receivers apply the SAME change and never re-broadcast
		api.onMessage((/** @type {any} */ data) => {
			if (data.op !== 'pulse') return;
			const beacon = api.objectsGroup()?.getObjectByProperty('uuid', data.uuid);
			if (beacon) pulse(beacon, data.at);
		});

		// ---- per-frame: a pure function of (stamp, time) ----------------------
		// Deterministic: every peer runs this off the same stamp and the same
		// synced clock, so nothing about the animation needs to be sent.
		api.registerFrameTask((/** @type {number} */ time) => {
			const group = api.objectsGroup();
			if (!group) return;
			for (const [uuid, at] of Object.entries(pulses)) {
				const beacon = group.getObjectByProperty('uuid', uuid);
				if (!beacon) {
					delete pulses[uuid]; // deleted out from under us
					continue;
				}
				const age = time - at;
				if (age < 0 || age > 1) {
					beacon.scale.setScalar(1);
					delete pulses[uuid];
				} else {
					beacon.scale.setScalar(1 + 0.35 * Math.sin((age / 1) * Math.PI));
				}
			}
		});

		// ---- late joiners ------------------------------------------------------
		// getState() rides the connection handshake to anyone who joins later.
		api.registerStateSync({
			getState: () => ({ pulses: { ...pulses } }),
			applyState: (/** @type {any} */ state) => {
				Object.entries(state?.pulses ?? {}).forEach(([uuid, at]) => {
					pulses[uuid] = Number(at);
				});
			}
		});

		// ---- a button on your card in Modules ▸ User --------------------------
		api.registerMenu('Say hello', () => api.toast('My Module is alive'));

		// ---- more of the API (uncomment what you need) -------------------------
		//
		// Flow nodes + a per-frame effect (deterministic, zero messages):
		//   api.registerNodeGroup({ group: 'My Module', items: [
		//     { type: 'mywave', label: 'Wave (mine)', defaults: { amplitude: 0.4 },
		//       params: [{ key: 'amplitude', kind: 'range', min: 0, max: 1.5, step: 0.05 }] }
		//   ]});
		//   api.registerEffect('mywave', (object, base, data, time) => {
		//     object.rotation.z = base.rot[2] + Math.sin(time * 2) * (data.amplitude ?? 0.4);
		//   });
		//
		// Code-editable nodes shipped with the module (see modules/flow-toolkit):
		//   api.registerNodeDefs([{ key: 'wobble', name: 'Wobble', params: [], code: '...' }]);
		//
		// Your own scene content (NOT part of the shared scene — rebuild it from
		// your state on every peer instead of syncing meshes):
		//   const group = new THREE.Group();
		//   group.name = 'my-module';           // fixed name, scene root
		//   api.scene().add(group);
		//   api.registerInteractiveGroup('my-module');   // make it clickable
		//   api.onSceneClear(() => { /* remove it + reset state */ });
		//
		// Keyboard / VR sticks:
		//   api.registerBindings([{ label: 'Do the thing', keys: 'G' }]);
		//   api.claimInput('keys');   // pause the editor's own WASD; ALWAYS release
		//   api.registerFrameTask(() => { if (api.input().codes.has('KeyG')) doThing(); });
		//   api.releaseInput('keys');
		//
		// Pointing (desktop mouse or the VR pointer hand), for drag interactions:
		//   const ray = api.pointerRay();   // THREE.Raycaster in world space or null
		//
		// Physics — mutations are INITIATOR-ONLY (the peer running the sim):
		//   if (api.physics.isInitiator()) api.physics.applyImpulse(uuid, [0, 5, 0]);
		//
		// Packaged files (list them in manifest.json "files"):
		//   const url = api.assetUrl('assets/chime.mp3');
	}
};
