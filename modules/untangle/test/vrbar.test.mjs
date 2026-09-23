// vrbar.js — the VR level bar's layout and labels (pure; the THREE drawing is the flight's).
import { CELLS, WIDTHS, cellAt, cellCentre, barCells } from '../src/vrbar.js';
import { defaultProgress, recordSolve } from '../src/progress.js';

export function run(check) {
	const total = WIDTHS.reduce((a, b) => a + b, 0);
	check(Math.abs(total - 1) < 1e-9 && WIDTHS.length === CELLS.length, 'the five cells fill the bar exactly');
	check(CELLS.every((_, k) => cellAt(cellCentre(k)) === k), 'every cell centre maps back to its own cell');
	check(cellAt(0) === 0 && cellAt(1) === CELLS.length - 1, 'the bar ends belong to the end cells');
	check(cellAt(-0.01) === -1 && cellAt(1.01) === -1 && cellAt(NaN) === -1, 'outside the bar is no cell');

	let p = defaultProgress();
	const at = (level, mode = '2d', extra = {}) => barCells({ level, mode, progress: p, running: false, shell: true, ...extra });
	const byId = (cells) => Object.fromEntries(cells.map((c) => [c.id, c]));
	let c = byId(at(1));
	check(!c.prev.enabled && !c.next.enabled, 'a new player on level 1: no previous level, the next is still locked');
	check(c.level.enabled && /Level 1 .*Start/.test(c.level.label), 'the menu is up (shell, not running): the middle cell starts the round ("' + c.level.label + '")');
	check(c.mode.label === 'Globe' && byId(at(1, '3d')).mode.label === 'Flat', 'the mode cell names the OTHER mode');
	p = recordSolve(p, '2d', 1, 20000).progress;
	c = byId(at(1));
	check(c.next.enabled, 'solving level 1 unlocks the ▶ to level 2');
	check(!byId(at(1, '3d')).next.enabled, 'progress is per mode: the globe\'s level 2 is still locked');
	c = byId(at(2, '2d', { running: true }));
	check(c.prev.enabled && !c.level.enabled && c.level.label === 'Level 2', 'mid-round: ◀ works, the middle cell is just the level');
	check(!byId(at(2, '2d', { shell: false })).level.enabled, 'no game shell (the fallback board): nothing to start');
	check(!byId(at(30)).next.enabled, 'level 30 has no ▶');
}
