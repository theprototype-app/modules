// levels, kinds, the breach, the results — pure (30b P3).
import { levelOf, levelSpeed, opensLevel, killScore, KINDS, kindOf } from '../src/curve.js';
import { betterRun, resultLines } from '../src/session.js';
import { wavesDef, ROSTER, HP, RUN } from '../src/def.js';
import { arenaRecipe } from '../src/toolbox.js';
import { standHeight, ENEMY_LOOKS } from '../src/look.js';

/** @param {(ok: boolean, label: string) => void} check */
export function run(check) {
	check(levelOf(1, 3) === 1 && levelOf(3, 3) === 1 && levelOf(4, 3) === 2 && levelOf(15, 3) === 5, 'levelOf: three waves a level');
	check(levelOf(9, 0) === 1 && levelOf(9, undefined) === 1, '  no perLevel: one level (the pre-30b run)');
	check(levelSpeed(1, 0.12) === 1 && Math.abs(levelSpeed(3, 0.12) - 1.24) < 1e-9 && levelSpeed(4, undefined) === 1, 'levelSpeed: +12% a level, none when unset');
	check(opensLevel(4, 3) && opensLevel(7, 3) && !opensLevel(1, 3) && !opensLevel(5, 3) && !opensLevel(4, 0), 'opensLevel: the first wave of every level after the first');
	check(killScore(100, 1) === 100 && killScore(400, 3) === 1200, 'killScore: points times the level');

	// the roster is the curve: grunts, then runners, then tanks
	check(ROSTER.length === 10 && [...ROSTER].sort().join() === ROSTER.join(), 'the roster: ten enemies, already in the name order the engine uses');
	const kinds = ROSTER.map(kindOf);
	const sizeOf = (/** @type {number} */ n) => Math.min(ROSTER.length, RUN.sizeStart + RUN.sizeStep * (n - 1));
	const inLevel = (/** @type {number} */ L) => new Set(kinds.slice(0, sizeOf(L * RUN.perLevel)));
	check([...inLevel(1)].join() === 'grunt', '  level 1 is grunts only');
	check(inLevel(2).has('runner') && !inLevel(2).has('tank'), '  level 2 brings the runners');
	check(inLevel(3).has('tank'), '  level 3 the tanks');
	check(RUN.waves === 15 && RUN.perLevel === 3, '  five levels of three waves');
	check(HP.tank > HP.grunt && HP.grunt > HP.runner && KINDS.runner.speed > 1 && KINDS.tank.speed < 1, 'kinds: a runner is fast and fragile, a tank slow and tough');
	check(standHeight('grunt') === 0.62 && standHeight('tank') > standHeight('grunt') && standHeight('runner') < standHeight('grunt'), 'each kind stands on the ground at its own height');
	check(ENEMY_LOOKS.runner.body !== ENEMY_LOOKS.grunt.body && ENEMY_LOOKS.tank.body !== ENEMY_LOOKS.grunt.body, '  and has its own colour');

	// the def
	const d = wavesDef();
	const g = d.graphs.scene;
	const waves = g.nodes.find((n) => n.type === 'waves');
	check(waves.data.waves === 15 && waves.data.perLevel === 3 && waves.data.levelSpeed === 0.12 && waves.data.breach === true, 'the Waves node: 15 waves, levels of 3, +12% a level, the breach on');
	const healths = g.nodes.filter((n) => n.type === 'health' && n.data.scope === 'object');
	const maxOf = (/** @type {string} */ name) => {
		const sel = g.nodes.find((n) => n.type === 'objectselector' && n.data.selected === name && g.edges.some((e) => e.source === n.id && e.targetHandle === 'target'));
		const e = g.edges.find((x) => x.source === sel?.id && x.targetHandle === 'target');
		return g.nodes.find((n) => n.id === e?.target)?.data.max;
	};
	check(healths.length === 10 && ROSTER.every((n) => maxOf(n) === HP[kindOf(n)]), 'every enemy\'s health max follows its kind (3 / 2 / 8)');
	check(!g.nodes.some((n) => n.type === 'damage' && n.data.source === 'zone'), 'no zone chains: the enemies hurt through the breach');
	check(g.nodes.filter((n) => n.type === 'damage' && n.data.amount === 1).every((n) => n.data.source === 'wired') && !g.nodes.some((n) => n.type === 'damage' && (n.data.source === 'hit' || n.data.source === 'click')), 'enemies die only to SHOTS (wired damage): a knock or a click on them deals none');
	const breach = g.nodes.find((n) => n.type === 'wavesevent' && n.data.event === 'breach');
	const bd = g.edges.find((e) => e.source === breach?.id && e.targetHandle === 'trigger');
	const bdNode = g.nodes.find((n) => n.id === bd?.target);
	check(!!bdNode && bdNode.type === 'damage' && bdNode.data.amount === 2 && bdNode.data.source === 'wired', 'breach -> a wired damage of 2');
	const player = g.nodes.find((n) => n.type === 'health' && n.data.scope === 'player');
	const pc = g.edges.find((e) => e.source === bdNode?.id && e.targetHandle === 'pulse')?.target;
	check(!!pc && g.edges.some((e) => e.source === pc && e.target === player.id && e.targetHandle === 'damage'), '  into the crystal\'s (the player health\'s) counter');
	check(player.data.max === 10 && player.data.regen === 0 && player.data.deathAction === 'nothing', 'the crystal: 10, no regen, no respawn');
	const death = g.nodes.find((n) => n.type === 'healthevent' && n.data.event === 'death' && n.data.name === 'me');
	const lost = g.edges.find((e) => e.source === death?.id);
	check(g.nodes.find((n) => n.id === lost?.target)?.data.state === 'over' && g.nodes.find((n) => n.id === lost?.target)?.data.outcome === 'lost', 'the crystal at zero ends the round (over, lost)');
	check(d.physics.play.interaction === 'click' && d.physics.play.spawn.position[2] === 9 && d.physics.play.locomotion.teleport === false, 'play: a click is a shot, the spawn is the home pad, no teleport');
	check(d.modules.find((m) => m.id === 'waves').version === '2.1.0', 'the def asks for waves 2.1.0');

	// the recipe: the old shape stays unless asked
	const o = { name: 'enemy', waves: 2, sizeStart: 2, sizeStep: 1, interval: 1, hp: 2, source: 'click', speed: 4, reach: 1.5, enemyDamage: 1, enemyRate: 1, playerName: 'me', playerHp: 10, playerRegen: 0, spawnPrefix: 'Spawn' };
	const old = arenaRecipe({ enemies: ['a', 'b'], goal: 'g', options: o, row: 0, playerHealthId: null });
	check(!('perLevel' in old.nodes[0].data) && !('breach' in old.nodes[0].data) && !old.nodes.some((n) => n.data.event === 'breach'), 'a recipe without the 30b options is the pre-30b recipe');
	const hp = arenaRecipe({ enemies: ['a', 'b'], hps: [5], goal: 'g', options: o, row: 0, playerHealthId: null });
	check(hp.nodes.filter((n) => n.type === 'health' && n.data.scope === 'object').map((n) => n.data.max).join() === '5,2', 'hps: a per-enemy max, the option\'s hp otherwise');

	// results
	check(betterRun(null, { score: 1 }).score === 1 && betterRun({ score: 5, level: 2 }, { score: 3, level: 4 }).score === 5 && betterRun({ score: 5, level: 2 }, { score: 5, level: 3 }).level === 3, 'betterRun: the higher score, then the higher level');
	const won = resultLines({ won: true, level: 5, wave: 15, waves: 15, score: 12345, kills: 60, best: null, isBest: true });
	check(won.title === 'ARENA CLEARED' && won.lines[1] === 'Score 12,345 · 60 kills' && won.lines[2] === 'NEW BEST!', 'resultLines: a win');
	const lost2 = resultLines({ won: false, level: 2, wave: 5, waves: 15, score: 900, kills: 1, best: { score: 4000, level: 3 }, isBest: false });
	check(lost2.title === 'CRYSTAL DESTROYED' && lost2.lines[0].startsWith('Fell on wave 5 of 15') && lost2.lines[1].endsWith('1 kill') && lost2.lines[2] === 'Best: 4,000 · level 3', 'resultLines: a loss, and the best to beat');
}
