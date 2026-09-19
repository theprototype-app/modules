// waves — THE DEF, the shape core's scripts/author-templates.cjs builds a game template
// from (the football precedent): objects as `{type, name, color, size, pos, physics}`,
// a graph of `{id, type, position, data}` nodes and canonical `e-<src>-<tgt>[.handle]`
// edges, with Object Selectors naming objects by NAME (the author script resolves them).
// One source: the HUD is hud.js; the arena's graph is the toolbox's recipe run on a fixed
// set of enemy boxes. The integrator pastes `waves.def.json` (emitted by
// `npm run build:waves`) into the author script and stages the template.

import { arenaHud, hudGraph } from './hud.js';
import { arenaRecipe } from './toolbox.js';

const ENEMIES = 4;
const SPAWNS = [[-6, 0.4, -10], [0, 0.4, -12], [6, 0.4, -10]];
const GOAL = [0, 0.5, 6];

/** addNodes-shaped `{nodes, edges}` (indices) -> the author script's graph shape
 * @param {{nodes: any[], edges: any[]}} spec @param {string} prefix */
export function toGraph(spec, prefix) {
	const nodes = spec.nodes.map((n, i) => ({
		id: prefix + i,
		type: n.type,
		position: { x: n.x, y: n.y },
		data: { label: n.type, ...(n.data ?? {}) },
		class: 'w-[150px]'
	}));
	const edges = spec.edges.map((e) => {
		const source = prefix + e.from;
		const target = prefix + e.to;
		return {
			id: 'e-' + source + '-' + target + (e.handle ? '.' + e.handle : ''),
			source,
			target,
			...(e.handle ? { targetHandle: e.handle } : {})
		};
	});
	return { nodes, edges };
}

export function wavesDef() {
	const enemyNames = Array.from({ length: ENEMIES }, (_, i) => 'Enemy ' + (i + 1));
	const objects = [
		{ type: 'box', name: 'Ground', color: 0x2b2f36, size: [30, 0.1, 40], pos: [0, -0.05, -2], roughness: 0.95, physics: { mode: 'static', friction: 0.7 } },
		{ type: 'box', name: 'Goal', color: 0x3b7dd8, size: [1.6, 1, 1.6], pos: GOAL, physics: { mode: 'static' } },
		...SPAWNS.map((p, i) => ({ type: 'box', name: 'Spawn ' + (i + 1), color: 0xc94a4a, size: [0.6, 0.1, 0.6], pos: p, physics: { mode: 'static' } })),
		...enemyNames.map((name, i) => ({ type: 'box', name, color: 0xff9c6b, size: [0.8, 0.8, 0.8], pos: [-6 + i * 1.5, 0.4, -8], physics: { mode: 'dynamic', mass: 1, friction: 0.6 } })),
		{ type: 'box', name: 'Home', color: 0x6fcf7a, size: [1, 0.1, 1], pos: [0, 0.05, 9], physics: { mode: 'static' } }
	];
	// selectors name objects by NAME in a def; the recipe takes those in place of uuids
	const arena = arenaRecipe({
		enemies: enemyNames,
		goal: 'Goal',
		row: 0,
		playerHealthId: null,
		options: { name: 'enemy', waves: 3, sizeStart: 2, sizeStep: 1, interval: 3, hp: 3, source: 'hit', speed: 1.5, reach: 1.5, enemyDamage: 1, enemyRate: 1, playerName: 'me', playerHp: 10, playerRegen: 0.5, spawnPrefix: 'Spawn' }
	});
	const hud = hudGraph({ name: 'enemy', playerName: 'me', x: 60, y: 40 + (arena.rows + 1) * 200 });
	const a = toGraph(arena, 'wa');
	const h = toGraph(hud, 'wh');
	return {
		kind: 'game',
		slug: 'waves',
		title: 'Waves',
		description: 'Wave survival: hold the goal against waves of enemies walking in from the spawn points. Knock them down; the round ends when the last wave falls.',
		license: 'CC0-1.0',
		author: 'theprototype',
		tags: ['vr', 'co-op', 'survival'],
		modules: [{ id: 'health', version: '1.0.0' }, { id: 'waves', version: '1.0.0' }],
		installModules: ['health', 'waves'],
		env: { preset: 'dusk', exposure: 0.9 },
		physics: { knock: { enabled: true, gain: 1, maxSpeed: 10, spin: 0.8 }, play: { interaction: 'grab', grounded: true, simOnPlay: true } },
		graphs: { scene: { nodes: [...a.nodes, ...h.nodes], edges: [...a.edges, ...h.edges] } },
		hud: arenaHud(),
		objects
	};
}
