// navigation — G8: the device caps, enforced with a clear message.
//
// Numbers measured on the test devices (see the docs fragment and the lane's evidence folder):
// NPC count = how many enemies step at once, crowd = agents per navmesh, bake = triangles read
// into one bake, rebake = the slowest bake we let a scene re-run on every edit.
// A device that is over a cap keeps working: the extra enemies stand still and the toast says
// so once, a bake past the triangle cap reads the first part of the scene and says so.

/** @param {any} api */
export function deviceClass(api) {
	const ua = typeof navigator !== 'undefined' ? String(navigator.userAgent || '') : '';
	if (api?.isVR?.() || /OculusBrowser|Quest|Pico/i.test(ua)) return 'headset';
	if (/Android|iPhone|iPad|Mobile/i.test(ua)) return 'phone';
	return 'desktop';
}

export const CAPS = Object.freeze({
	desktop: Object.freeze({ npcs: 64, bakeTriangles: 600000, rebakeMs: 2500 }),
	phone: Object.freeze({ npcs: 24, bakeTriangles: 200000, rebakeMs: 4000 }),
	headset: Object.freeze({ npcs: 24, bakeTriangles: 200000, rebakeMs: 4000 })
});

/** @param {any} api */
export function capsFor(api) {
	const kind = deviceClass(api);
	return { kind, ...CAPS[kind] };
}

/** the message for an over-cap scene @param {{kind: string, npcs: number}} caps @param {number} count */
export function npcCapMessage(caps, count) {
	return 'Navigation: this scene has ' + count + ' enemies; a ' + caps.kind + ' runs ' + caps.npcs + ' at once, the rest stand still.';
}
/** @param {{kind: string, bakeTriangles: number}} caps @param {number} triangles */
export function bakeCapMessage(caps, triangles) {
	return 'Navigation: the scene has more than ' + Math.round(caps.bakeTriangles / 1000) + 'k triangles to walk on (' + Math.round(triangles / 1000) + 'k+); a ' + caps.kind + ' bakes the first part only. Hide or simplify the biggest meshes.';
}
