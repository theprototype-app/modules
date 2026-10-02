// reel.js — 33 G2: the held globe reels on Y and scales on X (Edit's object grab); pointing reels.
import { heldStick, pointPush, REEL_RATE, SCALE_RATE, REACH } from '../src/reel.js';

export function run(check) {
	const range = [0.35, 4];
	// the holding hand's stick
	let r = heldStick({ dist: 1, scale: 1, x: 0, y: -1, range });
	check(Math.abs(r.dist - (1 + REEL_RATE)) < 1e-12 && r.scale === 1, 'held: stick FORWARD pushes the globe away (1 m -> ' + r.dist.toFixed(3) + ' m), the size stays');
	r = heldStick({ dist: 1, scale: 1, x: 0, y: 1, range });
	check(Math.abs(r.dist - (1 - REEL_RATE)) < 1e-12, 'held: stick BACK pulls it closer (' + r.dist.toFixed(3) + ' m)');
	r = heldStick({ dist: 1, scale: 1, x: 1, y: 0, range });
	check(r.dist === 1 && Math.abs(r.scale - (1 + SCALE_RATE)) < 1e-12, 'held: stick RIGHT grows it (x' + r.scale.toFixed(3) + '), LEFT shrinks — Edit\'s mapping (Y reel, X scale)');
	r = heldStick({ dist: 1, scale: 1, x: 0.1, y: -0.1, range });
	check(r.dist === 1 && r.scale === 1, 'inside the dead zone nothing changes');
	r = heldStick({ dist: REACH[1], scale: range[1], x: 1, y: -1, range });
	check(r.dist === REACH[1] && r.scale === range[1], 'clamped: no farther than ' + REACH[1] + ' m, no bigger than x' + range[1]);
	let d = 1;
	for (let i = 0; i < 72; i++) d = heldStick({ dist: d, scale: 1, x: 0, y: -1, range }).dist;
	check(d > 7 && d < 9, 'a second of full stick at 72 Hz is Edit\'s reel: about 8x the distance (' + d.toFixed(2) + ' m)');
	// pointing
	check(pointPush(2, -1) > 0.05 && pointPush(2, 1) < -0.05, 'pointing: forward pushes the board away, back pulls it closer (' + pointPush(2, -1).toFixed(3) + ' / ' + pointPush(2, 1).toFixed(3) + ' m)');
	check(pointPush(2, 0.1) === 0, 'pointing: the dead zone moves nothing');
	check(pointPush(REACH[0] * 2, 1) === 0 && pointPush(REACH[1], -1) === 0, 'pointing: never nearer than ' + REACH[0] * 2 + ' m, never farther than ' + REACH[1] + ' m');
}
