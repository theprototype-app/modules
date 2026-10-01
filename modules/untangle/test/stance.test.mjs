// stance.js + the bar's pose — where a VR player stands, and what they see from there (pure).
import { SPAWN_DIST, spawnDistance, spawnFor, aheadOf } from '../src/stance.js';
import { barPose, BAR_H, BAR_RENDER_ORDER } from '../src/vrbar.js';
import { BOARD } from '../src/def.js';
import { DEFAULT_BOARD } from '../src/puzzle.js';

const EYE = 1.65; // a standing adult's eyes over the feet (the Quest reports the real height)
const GLOBE = 0.92; // index.js GLOBE_R

export function run(check) {
	// ---- the distance ----
	check(spawnDistance(0.85) === 1.35, 'the template board (r 0.85) puts the feet 1.35 m from its centre');
	check(spawnDistance(0.3) === SPAWN_DIST.min && spawnDistance(3) === SPAWN_DIST.max && spawnDistance(NaN) === SPAWN_DIST.base, 'the distance stays in 1.2-1.5 m (a tiny, a huge and a broken radius)');

	// ---- the spawn: in front of the face, facing it ----
	const s0 = spawnFor({ x: 0, z: 0, yaw: 0, radius: 0.85 }, 0.1);
	check(JSON.stringify(s0.position) === '[0,0.1,1.35]' && s0.yaw === 0 && s0.vrOnly === true, 'yaw 0: the feet at (0, stage top 0.1, +1.35), facing -Z, VR-only (' + JSON.stringify(s0) + ')');
	const s1 = spawnFor({ x: 2, z: -3, yaw: Math.PI / 2, radius: 0.85 }, 0);
	check(Math.abs(s1.position[0] - 3.35) < 1e-3 && Math.abs(s1.position[2] + 3) < 1e-3 && Math.abs(s1.yaw - Math.PI / 2) < 1e-3, 'a board turned 90 degrees at (2, -3): the feet at (3.35, -3), turned with it');
	check(spawnFor({ x: 0, z: 0, yaw: 0, radius: 0.85 }, NaN).position[1] === 0, 'no floor found -> the feet at y 0');

	// ---- from that spot the board is AHEAD, centred, at chest height ----
	const view = (board, mode) => {
		const s = spawnFor(board, 0.1);
		const head = { x: s.position[0], y: s.position[1] + EYE, z: s.position[2], yaw: s.yaw };
		return aheadOf(head, [board.x, board.boardY, board.z]);
	};
	for (const mode of ['2d', '3d']) {
		const a = view(BOARD, mode);
		check(a.ok && a.deg < 1 && a.dist >= 1.2 && a.dist <= 1.5 && a.dy < 0 && a.dy > -0.5, mode + ': the template board is ' + a.dist.toFixed(2) + ' m ahead, ' + a.deg.toFixed(1) + ' deg off centre, ' + a.dy.toFixed(2) + ' m below the eyes (chest height)');
	}
	const fb = view({ ...DEFAULT_BOARD }, '2d');
	check(fb.ok && Math.abs(fb.dist - 1.5) < 1e-6, 'the fallback board (no template, r 1.1) is ahead too, at the 1.5 m cap (' + fb.dist.toFixed(2) + ' m, ' + fb.dy.toFixed(2) + ' m)');
	const turned = { ...BOARD, x: -4, z: 2, yaw: -2.2 };
	check(view(turned, '2d').ok, 'a moved and turned board: still dead ahead of its spawn');
	check(!aheadOf({ x: 0, y: 1.6, z: 0, yaw: 0 }, [0, 1.6, 0]).ok, 'standing AT the board (the old origin spawn, inside the dots) is not "in front"');
	check(!aheadOf({ x: 0, y: 1.6, z: 1.35, yaw: Math.PI }, [0, 1.4, 0]).ok, 'facing away is not "in front"');

	// ---- U4: the VR bar is a console in front of the lower edge, clear of the floor ----
	const R = BOARD.radius;
	const g = R * GLOBE;
	for (const mode of ['2d', '3d']) {
		const p = barPose(mode, R, g);
		const worldY = BOARD.boardY + p.y;
		check(p.z > 0 && worldY > 0.6 && worldY < 1.1, mode + ': the bar stands in front of the board (z ' + p.z.toFixed(2) + ') at waist height (' + worldY.toFixed(2) + ' m), far above the stage and any plinth');
		// the line from the eyes on the spawn to the lowest dots passes ABOVE the bar's top edge
		const eyeY = 0.1 + EYE;
		const eyeZ = spawnDistance(R);
		const lowY = mode === '3d' ? -g * 0.7 : -R; // the lowest dot (3D: the lowest dot you see on the front face)
		const lowZ = mode === '3d' ? g * 0.7 : 0;
		const topY = p.y + (BAR_H * R * 0.5) * Math.cos(p.tilt);
		const topZ = p.z - (BAR_H * R * 0.5) * Math.sin(-p.tilt);
		const sight = lowY + ((eyeY - BOARD.boardY - lowY) * (topZ - lowZ)) / (eyeZ - lowZ);
		check(topY < sight, mode + ': the bar\'s top edge (' + topY.toFixed(2) + ') is below the eye line to the lowest dots (' + sight.toFixed(2) + '): it hides no dot');
		check(p.tilt < 0, mode + ': tilted back to face up at the player');
	}
	const pg = barPose('3d', R, g);
	const ringR = Math.sqrt(Math.max(0, g * g - pg.y * pg.y));
	check(pg.z > ringR, '3d: the bar is outside the globe (z ' + pg.z.toFixed(2) + ' > the globe\'s ' + ringR.toFixed(2) + ' at that height)');
	check(BAR_RENDER_ORDER > 0 && BAR_RENDER_ORDER < 1000, 'the bar draws after the scene and before core\'s VR panels (renderOrder ' + BAR_RENDER_ORDER + ' < 1000)');
}
