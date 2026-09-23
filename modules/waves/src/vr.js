// waves — THE HANDS, pure (30b). The maths every VR input in this module stands on: a
// controller's aim ray from its world pose, a ray against a flat rectangle, a button's
// press EDGE, and "is this peer in the game right now". No THREE here — plain arrays, so
// the node tests hold it without a browser.

/** rotate `v` by the unit quaternion `q` ([x, y, z, w]) @param {number[]} q @param {number[]} v @returns {number[]} */
export function rotate(q, v) {
	const [qx, qy, qz, qw] = q;
	const [vx, vy, vz] = v;
	// t = 2 * cross(q.xyz, v); v' = v + w * t + cross(q.xyz, t)
	const tx = 2 * (qy * vz - qz * vy);
	const ty = 2 * (qz * vx - qx * vz);
	const tz = 2 * (qx * vy - qy * vx);
	return [vx + qw * tx + (qy * tz - qz * ty), vy + qw * ty + (qz * tx - qx * tz), vz + qw * tz + (qx * ty - qy * tx)];
}

/** A controller's aim ray: its target-ray space looks down its own -Z (WebXR).
 * @param {{position: number[], quaternion: number[]}} hand @returns {{origin: number[], dir: number[]}} */
export function aimRay(hand) {
	return { origin: hand.position.slice(0, 3), dir: rotate(hand.quaternion, [0, 0, -1]) };
}

/** The heading (radians about +Y) a direction points along, 0 = looking down -Z.
 * @param {number[]} dir */
export function yawOf(dir) {
	return Math.atan2(-dir[0], -dir[2]);
}

/**
 * Where a ray meets a flat rectangle, or null. The rectangle stands at `center`, faces
 * along `normal` (unit), and is `w` x `h` with its width along `right` (unit).
 * @param {{origin: number[], dir: number[]}} ray
 * @param {{center: number[], normal: number[], right: number[], w: number, h: number}} rect
 * @returns {{t: number, u: number, v: number} | null} t = distance along the ray; u, v in -0.5..0.5
 */
export function rayRect(ray, rect) {
	const d = ray.dir;
	const n = rect.normal;
	const denom = d[0] * n[0] + d[1] * n[1] + d[2] * n[2];
	if (Math.abs(denom) < 1e-6) return null;
	const o = ray.origin;
	const c = rect.center;
	const t = ((c[0] - o[0]) * n[0] + (c[1] - o[1]) * n[1] + (c[2] - o[2]) * n[2]) / denom;
	if (!(t > 0)) return null;
	const p = [o[0] + d[0] * t - c[0], o[1] + d[1] * t - c[1], o[2] + d[2] * t - c[2]];
	const r = rect.right;
	// up = normal x right
	const up = [n[1] * r[2] - n[2] * r[1], n[2] * r[0] - n[0] * r[2], n[0] * r[1] - n[1] * r[0]];
	const u = (p[0] * r[0] + p[1] * r[1] + p[2] * r[2]) / rect.w;
	const v = (p[0] * up[0] + p[1] * up[1] + p[2] * up[2]) / rect.h;
	if (Math.abs(u) > 0.5 || Math.abs(v) > 0.5) return null;
	return { t, u, v };
}

/** A press-edge tracker: `edge(key, down)` is true on the frame `down` goes true, once. */
export function createEdges() {
	/** @type {Map<string, boolean>} */
	const prev = new Map();
	return {
		/** @param {string} key @param {boolean} down */
		edge(key, down) {
			const was = prev.get(key) === true;
			prev.set(key, !!down);
			return !!down && !was;
		},
		/** @param {string} key @param {boolean} down  true on the frame `down` goes false */
		release(key, down) {
			const was = prev.get(key) === true;
			prev.set(key, !!down);
			return !down && was;
		},
		clear() {
			prev.clear();
		}
	};
}

/**
 * Is THIS peer in the game (not editing)? Desktop Play (the pointer lock), or the editor's
 * Interact mode — which is where a VR Play lands (30b C1: "PLAY in VR enters INTERACT").
 * An Edit-mode headset is the editor, never the game: no gun, no shots.
 * @param {any} api
 */
export function inGame(api) {
	if (api.isPlaying?.()) return true;
	return typeof api.editorMode === 'function' && api.editorMode() === 'interact';
}
