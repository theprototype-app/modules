// THE STICK REELS THE BOARD — roadmap 33 G2. The user on a Quest: "I can make bigger/smaller
// the globe but cannot use up/down on stick to move it further/closer and I want to be able to
// do this, just as in edit mode for objects."
//
// Edit's object grab (core vrControls grabStickAdjust): the holding hand's stick Y REELS the
// object along the hand (forward pushes it away, back pulls it in, a share of the distance per
// frame) and X SCALES it. Untangle's globe hold had Y on scale, because a module could not pause
// the right stick's snap turn — a core with the 'sticks' input scope (1.19) can, so the hold now
// maps exactly like Edit. And pointing the right laser at the board (or the globe) with the stick
// up/down pushes it away / pulls it closer along the ray, the same reel without holding.
//
// Pure: the numbers only (test/reel.test.mjs). index.js applies them to the LOCAL hold.

/** a share of the distance per frame at full deflection — Edit's reel (grabStickAdjust) */
export const REEL_RATE = 0.03;
/** a share of the size per frame at full deflection — Edit's stick scale */
export const SCALE_RATE = 0.025;
/** the stick's dead zone (Edit's) */
export const DEAD = 0.15;
/** how near / far a reel may take the board from the hand, metres */
export const REACH = [0.15, 12];

const dead = (/** @type {number} */ v) => (Math.abs(v) > DEAD ? v : 0);

/**
 * One frame of the HOLDING hand's stick: y reels `dist` (xr-standard: forward is y < 0 and
 * pushes away), x scales within `range`. Pure.
 * @param {{dist: number, scale: number, x: number, y: number, range: number[]}} input
 * @returns {{dist: number, scale: number}}
 */
export function heldStick({ dist, scale, x, y, range }) {
	return {
		dist: Math.min(Math.max(dist * (1 - dead(y) * REEL_RATE), REACH[0]), REACH[1]),
		scale: Math.min(Math.max(scale * (1 + dead(x) * SCALE_RATE), range[0]), range[1])
	};
}

/**
 * One frame of the stick while POINTING at the board `dist` metres along the ray: the metres it
 * moves AWAY along the ray (negative = toward you). Pure.
 * @param {number} dist @param {number} y
 */
export function pointPush(dist, y) {
	const next = Math.min(Math.max(dist * (1 - dead(y) * REEL_RATE), REACH[0] * 2), REACH[1]);
	return next - dist;
}
