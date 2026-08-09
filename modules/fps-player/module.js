// FPS Player — walk mode for a capsule: mouse look, WASD with strafe, sprint,
// jump and crouch, plus ground and wall raycasts.
//
// The movement math is rewritten from the vrvsvr prototype's Player.svelte
// (camera-relative velocity, sprint multiplier, jump initial velocity from the
// desired height, crouch height) on our SDK's own primitives. It complements
// core's `possess`, which is TANK drive (A/D turn, no strafe, no jump).
//
// CAMERA. This module owns the BODY — yaw, strafe, jump, crouch, collisions —
// and lets `possess` own the view. With the 17-A1 SDK it asks for
// `camera: 'first'` + `mouseLook` and you are properly inside the capsule; on an
// older app `possess` offers only 'chase' | 'orbit' | 'none' (a hard-coded offset
// behind the object) and nothing on the api can move the editor camera directly,
// so the walk runs in third person and the module takes pointer lock itself for
// the turn. Which one you get is decided by PROBING `api.possessModes`, never by
// passing a mode and hoping: an unrecognised `camera` value degrades to no camera
// control at all rather than failing (DEVX-REQUESTS #1).
//
// Replication: possess already streams throttled `move`s while a direction key
// is held and records ONE undo entry plus a final move on release, so walking
// replicates with no netcode of our own. A jump that lands with no key held is
// the one case peers see late — the next step corrects it.

export default {
	id: 'fps-player',
	name: 'FPS Player',
	version: '1.0.0',
	description: 'Walk mode: mouse look with WASD, sprint, jump and crouch.',

	/** @param {any} api */
	register(api) {
		const THREE = api.THREE;

		const WALK = 3.4; // metres/second
		const SPRINT = 1.7; // multiplier while Shift is held
		const CROUCH = 0.45; // multiplier + capsule squash while C is held
		const GRAVITY = -9.81;
		const JUMP_HEIGHT = 1.1;
		const JUMP_SPEED = Math.sqrt(2 * JUMP_HEIGHT * -GRAVITY);
		const EYE = 1.7; // capsule half-height-ish; the feet offset we keep
		const LOOK = 0.0022; // radians per pixel of mouse movement
		const REACH = 0.45; // wall probe distance

		let uuid = null; // the capsule we are riding
		let vy = 0; // vertical velocity
		let grounded = true;
		let lastTime = 0;
		let baseScaleY = 1;
		let firstPerson = false; // does possess own the mouse look?

		// ---- the body ----------------------------------------------------------
		api.registerPrimitive(
			'Fpsplayer',
			() => new THREE.CapsuleGeometry(0.35, 1.0, 6, 12),
			{ label: 'Player capsule', command: '/create Fpsplayer', group: 'FPS Player' }
		);

		const walking = () => uuid !== null;
		const bodyOf = () => (uuid ? api.objectsGroup()?.getObjectByProperty('uuid', uuid) : null);

		/** the capsule to ride: the selection if it is one, else the only one placed */
		function pickBody() {
			const group = api.objectsGroup();
			if (!group) return null;
			const selected = api.selectedUuid();
			const chosen =
				group.children.find((/** @type {any} */ c) => c.uuid === selected && c.name === 'Fpsplayer') ??
				group.children.find((/** @type {any} */ c) => c.name === 'Fpsplayer');
			return chosen ?? null;
		}

		// ---- mouse look --------------------------------------------------------
		let yaw = 0;
		let hadLock = false; // did we ever actually get pointer lock?
		function onMouseMove(event) {
			if (!walking() || firstPerson || document.pointerLockElement === null) return;
			yaw -= (event.movementX ?? 0) * LOOK;
		}
		function onPointerLockChange() {
			if (document.pointerLockElement) {
				hadLock = true;
				return;
			}
			// LOSING the lock (Esc, alt-tab) leaves walk mode — never strand the
			// input claims possess is holding. But a request that never succeeded
			// (headless, or a browser that refuses it) must NOT end the walk: this
			// event also fires with a null element when the request is denied.
			if (walking() && !firstPerson && hadLock) stop('pointer lock released');
		}
		if (typeof window !== 'undefined') {
			window.addEventListener('mousemove', onMouseMove);
			document.addEventListener('pointerlockchange', onPointerLockChange);
		}

		// ---- enter / leave ------------------------------------------------------
		function start() {
			if (walking()) return stop('toggled off');
			const body = pickBody();
			if (!body) {
				api.toast('Add a Player capsule first (Add ▸ FPS Player), then walk');
				return;
			}
			// First person the moment core offers it (DEVX-REQUESTS #1, shipped in
			// 17-A1), chase camera on older apps. Probe the CAPABILITY, never the
			// mode: an unrecognised `camera` value degrades to no camera control at
			// all rather than failing, so guessing would be silently wrong.
			const modes = Array.isArray(api.possessModes) ? api.possessModes : [];
			firstPerson = modes.includes('first');
			// speed/turnSpeed 0: possess keeps the claims, the lock, the camera and
			// the undo entry, but its TANK controls write nothing — this module owns
			// the motion. Its throttled `move` broadcast still runs, so peers see us.
			const ok = api.possess(body.uuid, {
				camera: firstPerson ? 'first' : 'chase',
				speed: 0,
				turnSpeed: 0,
				eyeHeight: EYE,
				mouseLook: firstPerson // in first person, possess owns yaw + pitch
			});
			if (!ok) return; // locked by a peer, or gone — possess already toasted

			uuid = body.uuid;
			yaw = body.rotation.y;
			baseScaleY = body.scale.y;
			vy = 0;
			grounded = true;
			lastTime = 0;
			// only take pointer lock ourselves when possess is not already doing it
			if (!firstPerson) document.body?.requestPointerLock?.();
			api.toast(
				(firstPerson ? 'Walk mode: ' : 'Walk mode (chase camera): ') +
					'WASD, Shift sprint, Space jump, C crouch. Esc to leave.'
			);
		}

		function stop(_why) {
			if (!walking()) return;
			const body = bodyOf();
			if (body) {
				body.scale.y = baseScaleY;
				body.updateMatrix();
			}
			uuid = null;
			vy = 0;
			firstPerson = false;
			// possess restores the camera, releases 'keys'/'locomotion', records the
			// undo entry and sends the final move
			api.releasePossess();
			if (document.pointerLockElement) document.exitPointerLock?.();
		}

		api.registerBindings([
			{ label: 'Enter / leave walk mode', keys: 'J' },
			{ label: 'Walk forward / back', keys: 'W S' },
			{ label: 'Strafe left / right', keys: 'A D' },
			{ label: 'Sprint', keys: 'Shift (hold)' },
			{ label: 'Jump', keys: 'Space' },
			{ label: 'Crouch', keys: 'C (hold)' },
			{ label: 'Leave walk mode', keys: 'Esc' }
		]);
		// J as well as the card button: key input is suppressed while an app modal
		// is open, so a user who starts from the card must close the manager before
		// WASD does anything — the key path avoids that entirely.
		api.registerMenu('Walk / stop walking (J)', start);

		// Toggle keys are EDGE-DETECTED from the per-frame snapshot rather than
		// api.onInput: onInput registers through an async import inside the SDK, so
		// a module that subscribes at register() time silently misses every key for
		// the first couple of seconds. api.input() is live from the first frame.
		let wasDown = { KeyJ: false, Escape: false };
		function pollToggles(codes) {
			const now = { KeyJ: codes.has('KeyJ'), Escape: codes.has('Escape') };
			if (now.KeyJ && !wasDown.KeyJ) start();
			// possess releases on Escape itself; keep our own state in step
			if (now.Escape && !wasDown.Escape && walking()) stop('escape');
			wasDown = now;
		}

		// ---- per frame ----------------------------------------------------------
		const down = new THREE.Raycaster();
		const ahead = new THREE.Raycaster();
		const DOWN = new THREE.Vector3(0, -1, 0);
		const step = new THREE.Vector3();
		const probe = new THREE.Vector3();

		api.registerFrameTask((/** @type {number} */ time) => {
			const { codes } = api.input();
			pollToggles(codes);
			if (!walking()) return;
			const body = bodyOf();
			if (!body) return stop('body deleted'); // deleted out from under us

			const dt = lastTime ? Math.min(time - lastTime, 0.1) : 0;
			lastTime = time;
			if (dt <= 0) return;

			const crouching = codes.has('KeyC');
			const speed = WALK * (codes.has('ShiftLeft') || codes.has('ShiftRight') ? SPRINT : 1) * (crouching ? CROUCH : 1);

			// camera-relative velocity, but the camera rides the body: yaw IS the
			// facing, so forward/strafe come straight off it
			const forward = (codes.has('KeyW') ? 1 : 0) - (codes.has('KeyS') ? 1 : 0);
			const strafe = (codes.has('KeyD') ? 1 : 0) - (codes.has('KeyA') ? 1 : 0);
			if (firstPerson) yaw = body.rotation.y; // possess owns the turn
			else body.rotation.y = yaw;

			step.set(
				(Math.sin(yaw) * -forward + Math.cos(yaw) * strafe) * speed * dt,
				0,
				(Math.cos(yaw) * -forward - Math.sin(yaw) * strafe) * speed * dt
			);

			// walls: probe along the movement and cancel it on contact (v1 collision
			// is deliberately raycasts, not a rapier capsule — a module may only
			// mutate physics on the peer that steps the sim)
			const solids = api.objectsGroup()?.children?.filter((/** @type {any} */ c) => c.uuid !== uuid) ?? [];
			if (step.lengthSq() > 0 && solids.length) {
				probe.copy(step).normalize();
				ahead.set(body.position.clone().setY(body.position.y + 0.6), probe);
				ahead.far = REACH;
				if (ahead.intersectObjects(solids, true).length) step.setScalar(0);
			}
			body.position.add(step);

			// gravity + ground
			vy += GRAVITY * dt;
			if (grounded && codes.has('Space')) {
				vy = JUMP_SPEED;
				grounded = false;
			}
			body.position.y += vy * dt;

			let floor = 0;
			if (solids.length) {
				down.set(body.position.clone().setY(body.position.y + 2), DOWN);
				down.far = 6;
				const hit = down.intersectObjects(solids, true)[0];
				if (hit) floor = Math.max(floor, hit.point.y);
			}
			if (body.position.y <= floor) {
				body.position.y = floor;
				vy = 0;
				grounded = true;
			} else {
				grounded = false;
			}

			body.scale.y = crouching ? baseScaleY * 0.6 : baseScaleY;
			body.updateMatrix();
		});

		api.onSceneClear(() => stop('scene cleared'));
	}
};
