// VR essentials (K-E): a tutorial-flavored set of clickable interactables that
// make an empty room demo-able — Button, Lever, Spawner pad, Teleport pad,
// Sound tile, Target block. Everything is a REPLICATED primitive (spawned via
// the normal /create path, so it persists, syncs and undoes like any object);
// the interactable KIND is derived from the object NAME the create command
// assigns (deterministic on every peer — no extra state to sync). Sync models:
// the Button/Target pulse the flow graph via the already-replicated nodetrigger
// (fireObjectClick); the Lever broadcasts a tiny module op + late-joiner state;
// the Spawner creates through the replicated create path (no op needed); the
// Teleport jump is strictly LOCAL; the Sound tile op lets every peer chime at
// the tile. Works with desktop clicks and the VR trigger (same dispatch).

export default {
	id: 'essentials',
	name: 'VR Essentials',
	version: '1.1.0',
	description: 'Clickable starter interactables: button, lever, spawner, teleport pad, sound tile, target.',
	/** @param {any} api */
	register(api) {
		const THREE = api.THREE;
		/** @type {Record<string, boolean>} lever uuid -> on */
		const levers = {};
		/** @type {Record<string, number>} spawner uuid -> last spawn (api.now seconds) */
		const cooldowns = {};
		/** @type {Record<string, number>} button/target uuid -> press time */
		const presses = {};

		// ---- the six primitives (geometry builders; names become the kind) ----
		api.registerPrimitive('Essbutton', () => new THREE.CylinderGeometry(0.35, 0.45, 0.25, 24), {
			label: 'Button (click ▸ flow)',
			command: '/create Essbutton',
			group: 'VR Essentials'
		});
		api.registerPrimitive('Esslever', () => {
			const geometry = new THREE.BoxGeometry(0.15, 1, 0.15);
			geometry.translate(0, 0.5, 0); // pivot at the base so the tilt reads
			return geometry;
		}, {
			label: 'Lever (toggle)',
			command: '/create Esslever',
			group: 'VR Essentials'
		});
		api.registerPrimitive('Essspawner', () => new THREE.CylinderGeometry(0.7, 0.7, 0.1, 24), {
			label: 'Spawner pad',
			command: '/create Essspawner',
			group: 'VR Essentials'
		});
		api.registerPrimitive('Essteleport', () => new THREE.CylinderGeometry(0.7, 0.7, 0.05, 24), {
			label: 'Teleport pad (local)',
			command: '/create Essteleport',
			group: 'VR Essentials'
		});
		api.registerPrimitive('Esssound', () => new THREE.BoxGeometry(0.8, 0.15, 0.8), {
			label: 'Sound tile',
			command: '/create Esssound',
			group: 'VR Essentials'
		});
		api.registerPrimitive('Esstarget', () => new THREE.TorusGeometry(0.5, 0.12, 12, 24), {
			label: 'Target (click ▸ flow)',
			command: '/create Esstarget',
			group: 'VR Essentials'
		});

		/** the interactable root above a clicked mesh (walk up to objectsGroup) */
		const rootOf = (/** @type {any} */ object) => {
			const group = api.objectsGroup();
			let current = object;
			while (current && current.parent !== group) current = current.parent;
			return current && current.name?.startsWith('Ess') ? current : null;
		};

		// ---- behaviors ---------------------------------------------------------
		const press = (/** @type {any} */ target, /** @type {number} */ t, /** @type {boolean} */ local) => {
			presses[target.uuid] = t;
			if (local) {
				// the flow pulse (nodetrigger) is already replicated; the press op
				// only carries the squash visual to peers
				api.fireObjectClick(target.uuid);
				api.send({ op: 'press', uuid: target.uuid, t });
			}
		};

		const setLever = (/** @type {any} */ target, /** @type {boolean} */ on, /** @type {boolean} */ local) => {
			levers[target.uuid] = on;
			target.rotation.z = on ? -0.45 : 0.45;
			target.updateMatrix();
			if (local) {
				api.fireObjectClick(target.uuid);
				api.send({ op: 'lever', uuid: target.uuid, on });
			}
		};

		const chime = (/** @type {any} */ target, /** @type {boolean} */ local) => {
			api.playSound('pluck', target.getWorldPosition(new THREE.Vector3()).toArray());
			if (local) api.send({ op: 'tile', uuid: target.uuid });
		};

		api.registerClickHandler((/** @type {any} */ object) => {
			const target = rootOf(object);
			if (!target) return false;
			const kind = target.name;
			const now = api.now();
			if (kind === 'Essbutton' || kind === 'Esstarget') {
				press(target, now, true);
			} else if (kind === 'Esslever') {
				setLever(target, !levers[target.uuid], true);
			} else if (kind === 'Essspawner') {
				if (now - (cooldowns[target.uuid] ?? -10) < 1) return true; // 1s cooldown
				cooldowns[target.uuid] = now;
				// replicated create; land the cube 1m above the pad
				const p = target.getWorldPosition(new THREE.Vector3());
				api.create('/create Box 0.6 0.6 0.6', { at: [p.x, p.y + 1, p.z] });
			} else if (kind === 'Essteleport') {
				// strictly LOCAL: jump the editor camera to (a linked twin or) the pad
				const linked = target.userData.essentialLink
					? api.objectsGroup()?.getObjectByProperty('uuid', target.userData.essentialLink)
					: null;
				const dest = (linked ?? target).getWorldPosition(new THREE.Vector3());
				// api.flyTo goes through objectActions.flyTo, which also bumps the
				// cameraClaim handover signal - writing camera.position directly is
				// reverted by OrbitControls.update() on the next frame
				api.flyTo([dest.x + 2.5, dest.y + 2.4, dest.z + 2.5], [dest.x, dest.y + 1.2, dest.z]);
			} else if (kind === 'Esssound') {
				chime(target, true);
			} else {
				return false;
			}
			return true; // consume the click (no selection)
		});

		// press squash: a short deterministic tween off the stamped time
		api.registerFrameTask((/** @type {number} */ time) => {
			const group = api.objectsGroup();
			if (!group) return;
			for (const [uuid, t] of Object.entries(presses)) {
				const age = time - t;
				const target = group.getObjectByProperty('uuid', uuid);
				if (!target) {
					delete presses[uuid];
					continue;
				}
				if (age >= 0 && age < 0.3) {
					const squash = 1 - 0.4 * Math.sin((age / 0.3) * Math.PI);
					target.scale.y = squash;
				} else {
					target.scale.y = 1;
					delete presses[uuid];
				}
			}
		});

		api.onMessage((/** @type {any} */ data) => {
			const group = api.objectsGroup();
			const target = group?.getObjectByProperty('uuid', data.uuid);
			if (!target) return;
			if (data.op === 'press') press(target, data.t, false);
			else if (data.op === 'lever') setLever(target, !!data.on, false);
			else if (data.op === 'tile') chime(target, false);
		});

		// late joiners adopt the lever states
		api.registerStateSync({
			getState: () => ({ levers: { ...levers } }),
			applyState: (/** @type {any} */ state) => {
				const group = api.objectsGroup();
				Object.entries(state?.levers ?? {}).forEach(([uuid, on]) => {
					const target = group?.getObjectByProperty('uuid', uuid);
					if (target) setLever(target, !!on, false);
				});
			}
		});

		api.registerMenu('Spawn essentials demo row', async () => {
			const kinds = ['Essbutton', 'Esslever', 'Essspawner', 'Essteleport', 'Esssound', 'Esstarget'];
			// api.create returns the uuids the replicated create produced, and
			// api.moveObject broadcasts the placement - no reaching into the app
			let x = -3;
			for (const kind of kinds) {
				const uuids = await api.create('/create ' + kind);
				for (const uuid of uuids) {
					api.moveObject(uuid, { pos: [x, 0.2, -2], rot: [0, 0, 0], scale: [1, 1, 1] });
					x += 1.5;
				}
			}
			api.toast('Essentials spawned — click them (desktop) or point + trigger (VR)');
		});
	}
};
