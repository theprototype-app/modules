// the hands' maths — pure (30b): aim rays, a ray against the board, press edges, the game gate.
import { rotate, aimRay, yawOf, rayRect, createEdges, inGame } from '../src/vr.js';

const near = (/** @type {number} */ a, /** @type {number} */ b, e = 1e-6) => Math.abs(a - b) < e;
const nearV = (/** @type {number[]} */ a, /** @type {number[]} */ b, e = 1e-6) => a.every((x, i) => near(x, b[i], e));

/** @param {(ok: boolean, label: string) => void} check */
export function run(check) {
	const s = Math.SQRT1_2;
	check(nearV(rotate([0, 0, 0, 1], [1, 2, 3]), [1, 2, 3]), 'rotate: the identity leaves a vector alone');
	check(nearV(rotate([0, s, 0, s], [0, 0, -1]), [-1, 0, 0]), 'rotate: 90° about +Y turns -Z to -X');
	check(nearV(aimRay({ position: [1, 1.2, 0], quaternion: [0, 0, 0, 1] }).dir, [0, 0, -1]), 'aimRay: an untouched controller aims down -Z (the WebXR target ray)');
	check(near(yawOf([0, 0, -1]), 0) && near(yawOf([-1, 0, 0]), Math.PI / 2), 'yawOf: -Z is heading 0, -X is +90°');
	const rect = { center: [0, 1.5, -2], normal: [0, 0, 1], right: [1, 0, 0], w: 1.6, h: 0.9 };
	const hit = rayRect({ origin: [0, 1.5, 0], dir: [0, 0, -1] }, rect);
	check(!!hit && near(hit.t, 2) && near(hit.u, 0) && near(hit.v, 0), 'rayRect: straight at the board hits its centre, 2 m out');
	check(!!rayRect({ origin: [0.7, 1.9, 0], dir: [0, 0, -1] }, rect), 'rayRect: inside the corner hits');
	check(rayRect({ origin: [0.9, 1.5, 0], dir: [0, 0, -1] }, rect) === null, 'rayRect: past the edge misses');
	check(rayRect({ origin: [0, 1.5, 0], dir: [0, 0, 1] }, rect) === null, 'rayRect: aimed away misses (no hit behind the hand)');
	check(rayRect({ origin: [0, 1.5, 0], dir: [1, 0, 0] }, rect) === null, 'rayRect: parallel to the board misses');
	const e = createEdges();
	check(e.edge('t', true) === true && e.edge('t', true) === false && e.edge('t', false) === false && e.edge('t', true) === true, 'edges: a press fires once until it is released');
	check(e.release('g', true) === false && e.release('g', false) === true && e.release('g', false) === false, 'edges: a release fires once');
	check(inGame({ isPlaying: () => true, editorMode: () => 'edit' }) === true, 'inGame: desktop Play is the game');
	check(inGame({ isPlaying: () => false, editorMode: () => 'interact' }) === true, 'inGame: Interact (where a VR Play lands) is the game');
	check(inGame({ isPlaying: () => false, editorMode: () => 'edit' }) === false, 'inGame: Edit is the editor — no gun, no shots');
}
