// vrmenu.js — the VR level picker's layout, cell states and the hole in core's panel (pure).
import { pickerLayout, pickerHit, pickerCells, panelHole, menuCrop, stageRect, PX_W, PX_H, COLS } from '../src/vrmenu.js';
import { defaultProgress, recordSolve, MAX_LEVEL } from '../src/progress.js';
import { untangleHud } from '../src/def.js';

export function run(check) {
	// ---- the layout ----
	const L = pickerLayout();
	const ids = L.map((r) => r.id);
	check(ids.includes('mode:3d') && ids.includes('mode:2d') && ids.includes('continue') && !ids.includes('close'), 'the menu placement: Board 3D globe / 2D board, Continue (no Close)');
	check(ids.filter((i) => i.startsWith('level:')).length === MAX_LEVEL, 'all ' + MAX_LEVEL + ' levels are cells');
	check(pickerLayout({ close: true }).some((r) => r.id === 'close'), 'the on-board placement adds Close');
	check(L.every((r) => r.x >= 0 && r.y >= 0 && r.x + r.w <= PX_W && r.y + r.h <= PX_H), 'every rect inside the canvas');
	const overlap = L.some((a, i) => L.some((b, j) => j > i && a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h));
	check(!overlap, 'no two rects overlap (a press means one thing)');
	check(L.every((r) => pickerHit(L, r.x + r.w / 2, r.y + r.h / 2) === r.id), 'the centre of every rect hits that rect');
	check(pickerHit(L, 2, 2) === null, 'the frame margin hits nothing');
	const l7 = L.find((r) => r.id === 'level:7');
	const l1 = L.find((r) => r.id === 'level:1');
	check(l7.y > l1.y && Math.abs(l7.x - l1.x) < 1e-9 && COLS === 6, 'six to a row: level 7 starts the second row under level 1');
	const smallest = Math.min(...L.map((r) => Math.min(r.w, r.h)));
	check(smallest >= 60, 'every target is at least 60 px of 960 (a laser can land on it; smallest ' + Math.round(smallest) + ')');

	// ---- the states ----
	let p = defaultProgress();
	let c = pickerCells({ mode: '2d', level: 1, progress: p }, ids);
	check(c['mode:2d'].state === 'on' && !c['mode:2d'].enabled && c['mode:3d'].enabled && c['mode:3d'].label === '3D globe', 'on the board: "2D board" is lit, "3D globe" is the switch');
	check(c['level:1'].state === 'current' && c['level:2'].state === 'locked' && !c['level:2'].enabled, 'a new player: level 1 current, level 2 locked');
	check(c.continue.label === 'Continue · Level 1', 'Continue names its level');
	p = recordSolve(recordSolve(p, '3d', 1, 1).progress, '3d', 2, 1).progress;
	c = pickerCells({ mode: '2d', level: 1, progress: p }, ids);
	check(c['level:2'].state === 'solved' && c['level:3'].state === 'next' && c['level:3'].enabled && c['level:4'].state === 'locked', 'two globe solves: on the 2D picker 2 is ticked, 3 is next, 4 locked (U6: one progress)');
	check(c.continue.label === 'Continue · Level 3', '...and Continue says level 3');

	// ---- the hole in core's VR panel: the template's menu screen ----
	const menu = untangleHud().scene.screens.find((s) => s.id === 'menu');
	const crop = menuCrop(menu);
	// core's own numbers (vrGamePanel.js): 0.0016 m per stage px, a 96 px footer under the crop
	const W = crop.w * 0.0016;
	const H = (crop.h + 96) * 0.0016;
	const hole = panelHole(menu, 'levels', W, H);
	check(crop.w === 720 && crop.h === 632 && crop.x === 280 && crop.y === 44, 'the menu screen crops to 720 x 632 at (280, 44) — core\'s panelCrop rule (' + JSON.stringify(crop) + ')');
	check(!!hole && Math.abs(hole.w - 480 * 0.0016) < 1e-9 && Math.abs(hole.h - 330 * 0.0016) < 1e-9, 'the hole is the levels element, 0.768 x 0.528 m on that panel');
	check(!!hole && Math.abs(hole.x) < 1e-9 && hole.y > 0, 'centred across, a little above the panel middle (the footer is below) (' + (hole ? hole.y.toFixed(3) : '?') + ')');
	const start = stageRect(menu.elements.find((e) => e.id === 'start-btn'));
	const lv = stageRect(menu.elements.find((e) => e.id === 'levels'));
	check(lv.top + lv.h <= start.top && lv.top >= stageRect(menu.elements.find((e) => e.id === 'subtitle')).top, 'between the subtitle and Start: the picker covers no core button');
	check(panelHole(menu, 'levels', W, H * 0.7) === null, 'a panel of another shape (a solved or pause card) is not the menu: no hole');
	check(panelHole(menu, 'levels', W * 2, H * 2) !== null, 'a panel scaled uniformly still is (the metres per px may change)');
	check(panelHole(menu, 'nope', W, H) === null && panelHole(null, 'levels', W, H) === null, 'no such element / no screen -> no hole');
	const solved = untangleHud().scene.screens.find((s) => s.id === 'solved');
	const sc = menuCrop(solved);
	check(panelHole(menu, 'levels', sc.w * 0.0016, (sc.h + 96) * 0.0016) === null, 'the solved card\'s panel is refused');
}
