// WHERE THE PLAYER IS AIMING, as a world ray — the one question the carry, the hover
// ring and the pick all ask.
//
// - VR: `api.pointerRay()` is the pointer hand's controller ray. Use it.
// - Free cursor (the editor, or play with `play.cursor: 'free'`): the cursor ray. For a
//   pointer EVENT we build it from the event's own clientX/Y (a touch press can arrive
//   before any pointermove, and `api.pointerRay()` is null until one); per frame,
//   `api.pointerRay()` is the documented recipe and tracks the cursor window-wide.
// - Under a POINTER LOCK the player aims with the CROSSHAIR. A 1.16 core's
//   `api.pointerRay()` still answers the LAST MOUSE POSITION there, which never moves under
//   a lock — the stale ray the roadmap-30 findings pinned. A core with 30-core-modes P4
//   returns the crosshair ray itself. We DETECT which by comparing the api's ray with the
//   camera's forward: equal -> trust the api ('api'), otherwise build the NDC (0,0) ray
//   from the same camera ('crosshair').
//
// The camera: a Raycaster remembers the camera it was set from (`ray.camera`), so the
// api's own ray names the active camera; before the first pointer event (api ray null) we
// fall back to the scene camera nearest `api.playerPosition()`, which core reads off that
// same active camera.

/** @param {any} api @param {any} THREE */
export function makeAim(api, THREE) {
	const ndc = new THREE.Vector2();
	const forward = new THREE.Vector3();
	const at = new THREE.Vector3();
	const want = new THREE.Vector3();
	/** 'vr' | 'cursor' | 'api' | 'crosshair' | 'none' — how the LAST ray was made */
	let lastMode = 'none';

	const locked = () => typeof document !== 'undefined' && !!document.pointerLockElement;

	function sceneCamera() {
		const scene = api.scene?.();
		if (!scene) return null;
		const pos = api.playerPosition?.();
		if (pos) want.set(pos[0], pos[1], pos[2]);
		/** @type {any} */ let best = null;
		let bestD = Infinity;
		scene.traverse((/** @type {any} */ o) => {
			if (!o.isCamera) return;
			const d = pos ? o.getWorldPosition(at).distanceToSquared(want) : 0;
			if (d < bestD) {
				bestD = d;
				best = o;
			}
		});
		return best;
	}

	function camera() {
		const r = api.pointerRay?.();
		return r?.camera ?? sceneCamera();
	}

	/** the ray through a client pixel on `canvas` (a pointer event's own position) */
	function fromClient(x, y, canvas) {
		if (locked()) return crosshair();
		const cam = camera();
		if (!cam || !canvas?.getBoundingClientRect) return null;
		const rect = canvas.getBoundingClientRect();
		ndc.set(((x - rect.left) / rect.width) * 2 - 1, -((y - rect.top) / rect.height) * 2 + 1);
		const ray = new THREE.Raycaster();
		ray.setFromCamera(ndc, cam);
		lastMode = 'cursor';
		return ray;
	}

	/** the crosshair ray: the api's when it IS the crosshair, else built at NDC (0,0) */
	function crosshair() {
		const r = api.pointerRay?.();
		const cam = r?.camera ?? sceneCamera();
		if (!cam) return r ?? null;
		cam.updateMatrixWorld?.();
		cam.getWorldDirection(forward);
		if (r && r.ray.direction.angleTo(forward) < 0.002) {
			lastMode = 'api';
			return r;
		}
		const ray = new THREE.Raycaster();
		ray.setFromCamera(ndc.set(0, 0), cam);
		lastMode = 'crosshair';
		return ray;
	}

	/** the per-frame aim: VR hand, crosshair under a lock, else the cursor */
	function current() {
		if (api.isVR?.()) {
			lastMode = 'vr';
			return api.pointerRay?.() ?? null;
		}
		if (locked()) return crosshair();
		lastMode = 'cursor';
		return api.pointerRay?.() ?? null;
	}

	return { current, fromClient, crosshair, camera, locked, mode: () => lastMode };
}
