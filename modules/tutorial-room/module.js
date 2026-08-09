// Tutorial Room — an in-scene onboarding room built from one button.
//
// The concept comes from the vrvsvr prototype's guided tutorial (a welcome sign,
// a station per lesson, a checklist you work through); the LESSONS are ours, and
// nothing of the original's three-mesh-ui rendering carried over. Asset-free on
// purpose: primitives plus canvas-texture text, so the zip is a single file and
// there is nothing to fetch, share or hash.
//
// Replication — the derived-content pattern:
// - the room lives at the LOCAL scene root (api.scene()), NOT in objectsGroup.
//   An external module cannot create replicated objects from code (that is
//   DEVX-REQUESTS #5, backlogged in core), and derived content should not enter
//   scene sync, saved files or GLTF exports anyway: it would arrive twice, once
//   as geometry and once as the module rebuilding it.
// - so what travels is the INTENT: `{op:'build', at}` and `{op:'clear'}`. Every
//   peer builds the identical room from the same code path — determinism IS the
//   netcode, exactly like the dungeon module's seed.
// - station progress is a set of ids; it replicates as discrete ops and rides
//   registerStateSync so a late joiner sees the same ticks.

export default {
	id: 'tutorial-room',
	name: 'Tutorial Room',
	version: '1.0.0',
	description: 'An in-scene onboarding room: signs and clickable stations.',

	/** @param {any} api */
	register(api) {
		const THREE = api.THREE;
		const GROUP = 'tutorial-room';
		// Layout: a shallow arc in FRONT of the origin (-Z, where the default
		// editor camera looks), not a full circle — every sign has to be readable
		// from one standing spot, and a 270-degree ring puts half the room behind
		// your head.
		const RADIUS = 3.8;
		const SPREAD = Math.PI * 0.8; // 144 degrees across all five stations
		const SIGN_W = 1.9;
		const SIGN_H = 1.2;

		// ---- the lessons -------------------------------------------------------
		// Each station is a sign + a plinth you can click. Keep the text short:
		// it is read at a distance, and in VR through a headset.
		const STATIONS = [
			{
				id: 'select',
				title: '1 · Select & move',
				body: 'Click an object to select it.\nDouble-click opens Properties.\n1 / 2 / 3 switch the gizmo\nbetween move, rotate and scale.',
				color: 0x4ade80
			},
			{
				id: 'build',
				title: '2 · Build',
				body: 'The Add menu (or Shift+A)\ncreates primitives.\nEverything you make, everyone\nin the session sees.',
				color: 0x60a5fa
			},
			{
				id: 'connect',
				title: '3 · Connect',
				body: 'Share your peer ID or invite\nlink from the Connect bar.\nApprove the request and you\nare in the same scene.',
				color: 0xfbbf24
			},
			{
				id: 'flow',
				title: '4 · Flow',
				body: 'Select an object and open Flow\nin the bottom dock. Wire a node\nto make it move — node graphs\nreplicate like everything else.',
				color: 0xf472b6
			},
			{
				id: 'vr',
				title: '5 · VR',
				body: 'Enter VR from the menu.\nTrigger clicks, grip grabs,\nthe left stick moves you.\nYour hands show up for peers.',
				color: 0xa78bfa
			}
		];

		// ---- state -------------------------------------------------------------
		let group = null;
		/** @type {Set<string>} station ids ticked off */
		const done = new Set();
		/** @type {number|null} api.now() stamp the room was built at (null = no room) */
		let builtAt = null;

		// ---- canvas text (no assets: the sign face is drawn at build time) ------
		function signTexture(title, body, color) {
			const canvas = document.createElement('canvas');
			canvas.width = 512;
			canvas.height = 320;
			const g = canvas.getContext('2d');
			g.fillStyle = '#14161c';
			g.fillRect(0, 0, canvas.width, canvas.height);
			// accent bar — write the sRGB bytes straight, no THREE.Color round trip
			// (that would re-linearise the value and come out dark)
			g.fillStyle = '#' + color.toString(16).padStart(6, '0');
			g.fillRect(0, 0, canvas.width, 10);
			g.fillStyle = '#ffffff';
			g.font = 'bold 40px system-ui, sans-serif';
			g.fillText(title, 28, 78);
			g.fillStyle = '#c9d1d9';
			g.font = '30px system-ui, sans-serif';
			body.split('\n').forEach((line, index) => g.fillText(line, 28, 140 + index * 42));
			const texture = new THREE.CanvasTexture(canvas);
			texture.colorSpace = THREE.SRGBColorSpace; // else the text renders washed out
			return texture;
		}

		function tickTexture() {
			const canvas = document.createElement('canvas');
			canvas.width = canvas.height = 64;
			const g = canvas.getContext('2d');
			g.clearRect(0, 0, 64, 64);
			g.strokeStyle = '#4ade80';
			g.lineWidth = 9;
			g.lineCap = 'round';
			g.beginPath();
			g.moveTo(14, 34);
			g.lineTo(28, 48);
			g.lineTo(50, 16);
			g.stroke();
			const texture = new THREE.CanvasTexture(canvas);
			texture.colorSpace = THREE.SRGBColorSpace;
			return texture;
		}

		// ---- build / clear ------------------------------------------------------
		function clear() {
			const scene = api.scene();
			if (group && scene) scene.remove(group);
			group?.traverse?.((/** @type {any} */ object) => {
				object.geometry?.dispose?.();
				if (object.material) {
					object.material.map?.dispose?.();
					object.material.dispose?.();
				}
			});
			group = null;
			builtAt = null;
			done.clear();
		}

		function build(at) {
			const scene = api.scene();
			if (!scene) return;
			clear();
			builtAt = at;

			group = new THREE.Group();
			group.name = GROUP;

			// floor pad
			const floor = new THREE.Mesh(
				new THREE.CylinderGeometry(RADIUS + 1.4, RADIUS + 1.4, 0.08, 48),
				new THREE.MeshStandardMaterial({ color: 0x1e2129, roughness: 0.95 })
			);
			floor.name = 'tutorial-floor';
			floor.position.y = 0.04;
			floor.receiveShadow = true;
			group.add(floor);

			// welcome banner ABOVE the arc, so it titles the row instead of standing
			// in the middle of the room blocking the far signs
			const welcome = new THREE.Mesh(
				new THREE.PlaneGeometry(2.6, 1.05),
				new THREE.MeshBasicMaterial({
					map: signTexture('Welcome', 'Five stations, one lesson each.\nClick a plinth once you have\ntried it — your peers see the\nsame ticks.', 0xffffff),
					toneMapped: false
				})
			);
			welcome.name = 'tutorial-welcome';
			welcome.position.set(0, 3.05, -RADIUS);
			welcome.lookAt(0, 3.05, 0);
			group.add(welcome);

			// the stations, evenly spread across the arc, each facing the middle
			STATIONS.forEach((station, index) => {
				const t = (index / (STATIONS.length - 1) - 0.5) * SPREAD;
				const x = Math.sin(t) * RADIUS;
				const z = -Math.cos(t) * RADIUS;

				const stand = new THREE.Group();
				stand.position.set(x, 0, z);
				stand.lookAt(0, 0, 0); // a plane's face is +Z, so this turns it inward
				stand.name = 'tutorial-station-' + station.id;

				const sign = new THREE.Mesh(
					new THREE.PlaneGeometry(SIGN_W, SIGN_H),
					new THREE.MeshBasicMaterial({
						map: signTexture(station.title, station.body, station.color),
						toneMapped: false
					})
				);
				sign.position.y = 1.65; // eye height, tilted back a touch
				sign.rotation.x = -0.12;
				sign.name = 'tutorial-sign-' + station.id;
				stand.add(sign);

				const plinth = new THREE.Mesh(
					new THREE.CylinderGeometry(0.26, 0.32, 0.75, 20),
					new THREE.MeshStandardMaterial({ color: station.color, roughness: 0.5, emissive: 0x000000 })
				);
				plinth.position.set(0, 0.38, 0.35); // in front of its own sign
				plinth.name = 'tutorial-plinth-' + station.id;
				plinth.castShadow = true;
				stand.add(plinth);

				const tick = new THREE.Mesh(
					new THREE.PlaneGeometry(0.3, 0.3),
					new THREE.MeshBasicMaterial({ map: tickTexture(), transparent: true, toneMapped: false })
				);
				tick.name = 'tutorial-tick-' + station.id;
				tick.position.set(0, 0.92, 0.36);
				tick.visible = false;
				stand.add(tick);

				group.add(stand);
			});

			scene.add(group);
			paint();
		}

		/** every peer paints from the same `done` set */
		function paint() {
			if (!group) return;
			for (const station of STATIONS) {
				const tick = group.getObjectByName('tutorial-tick-' + station.id);
				const plinth = group.getObjectByName('tutorial-plinth-' + station.id);
				const isDone = done.has(station.id);
				if (tick) tick.visible = isDone;
				if (plinth?.material?.emissive)
					plinth.material.emissive.setHex(isDone ? 0x113311 : 0x000000);
			}
		}

		function markDone(id, on) {
			if (on) done.add(id);
			else done.delete(id);
			paint();
		}

		// ---- interaction --------------------------------------------------------
		// Scene-root content is not clickable until the group is registered.
		api.registerInteractiveGroup(GROUP);

		api.registerClickHandler((/** @type {any} */ object) => {
			const name = object?.name ?? '';
			if (!name.startsWith('tutorial-plinth-')) return false;
			const id = name.slice('tutorial-plinth-'.length);
			const on = !done.has(id);
			markDone(id, on);
			api.send({ op: 'mark', id, on });
			const left = STATIONS.length - done.size;
			api.toast(left === 0 ? 'All five done — you know the place now.' : left + ' station' + (left === 1 ? '' : 's') + ' to go');
			return true; // consume: clicking a station must not select it
		});

		api.onMessage((/** @type {any} */ data) => {
			if (data.op === 'build') build(data.at ?? api.now());
			else if (data.op === 'clear') clear();
			else if (data.op === 'mark') markDone(data.id, !!data.on);
		});

		// ---- late joiners --------------------------------------------------------
		// One payload rebuilds the whole room: the stamp says "there is a room",
		// the id list says how far the session got.
		api.registerStateSync({
			getState: () => (builtAt === null ? null : { builtAt, done: [...done] }),
			applyState: (/** @type {any} */ state) => {
				if (!state?.builtAt) return;
				build(state.builtAt);
				for (const id of state.done ?? []) done.add(id);
				paint();
			}
		});

		// ---- card buttons ---------------------------------------------------------
		api.registerMenu('Build the tutorial room', () => {
			const at = api.now();
			build(at);
			api.send({ op: 'build', at });
			api.toast('Tutorial room built — click a plinth once you have tried its lesson');
		});
		api.registerMenu('Remove the tutorial room', () => {
			clear();
			api.send({ op: 'clear' });
		});

		api.onSceneClear(() => clear());
	}
};
